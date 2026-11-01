import { spawn } from "node:child_process";
import { access, chmod, constants, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import ffmpegStatic from "ffmpeg-static";
import { type Cue, isCueList, noSpaces } from "./caption-cues";
import { captionsConfigured, retimeVideo, RETIME_COLS, type RetimeRow } from "./captions";
import { startPublish, type PublishOutcome } from "./instagram-publish";
import { renderKey, renderSkipReason, STALE_MINUTES } from "./render-state";
import type { RenderMeta, RenderState } from "./types";

/**
 * The render step (2026-11-01): before a one-tap post, the video is re-encoded once with
 * the captions and the headline drawn in (ffmpeg's subtitle renderer, an ASS file, our
 * own fonts) and the loudness brought to what social video sits at, since iPhone browser
 * recordings arrive 15 to 25 dB quiet. ffmpeg comes from the ffmpeg-static package
 * (bundled into the Vercel function by next.config.ts); the rendered file goes into the
 * same private bucket next to the original and is what Instagram fetches. Service role.
 */
export const TARGET_LUFS = -16;
export const TARGET_TP = -1.5;
export const TARGET_LRA = 11;
const FONTS_DIR = path.join(process.cwd(), "assets", "fonts");
const TIMEOUT_MS = 700_000;
const SIGNED_URL_SECONDS = 2 * 3600;

type Db = SupabaseClient;

export type RenderRow = RetimeRow & {
  user_id: string; publish_state: string | null;
  caption_cues: unknown; captions_on: boolean; headline: string | null;
  render_state: RenderState | null; render_path: string | null; render_key: string | null; render_attempts: number; render_started_at: string | null;
};
export const RENDER_COLS = `${RETIME_COLS}, user_id, publish_state, caption_cues, captions_on, headline, render_state, render_path, render_key, render_attempts, render_started_at`;

export class RenderError extends Error {
  constructor(message: string) { super(message); this.name = "RenderError"; }
}

/* ───────────────────────────── ffmpeg ───────────────────────────── */

let binary: string | null = null;
/** The ffmpeg-static binary; copied to /tmp and made executable if the deploy lost the mode bit. */
async function ffmpeg(): Promise<string> {
  if (binary) return binary;
  const p = typeof ffmpegStatic === "string" ? ffmpegStatic : null;
  if (!p) throw new RenderError("ffmpeg is not available in this build");
  try { await access(p, constants.X_OK); binary = p; }
  catch {
    const copy = path.join(tmpdir(), "atl-ffmpeg");
    try { await access(copy, constants.X_OK); } catch { await copyFile(p, copy); await chmod(copy, 0o755); }
    binary = copy;
  }
  return binary;
}

function run(args: string[], timeoutMs = TIMEOUT_MS): Promise<{ code: number | null; stderr: string }> {
  return new Promise(async (resolve, reject) => {
    let bin: string;
    try { bin = await ffmpeg(); } catch (e) { return reject(e); }
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); if (stderr.length > 200_000) stderr = stderr.slice(-100_000); });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new RenderError(`ffmpeg took longer than ${Math.round(timeoutMs / 60000)} minutes`)); }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(new RenderError(`ffmpeg could not start: ${e.message}`)); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stderr }); });
  });
}

export type Probe = { width: number; height: number; fps: number | null; hasAudio: boolean; seconds: number | null };
/** Frame size as displayed (rotation applied), frame rate, audio, duration: from ffmpeg's own stream listing. */
export async function probe(input: string): Promise<Probe> {
  const { stderr } = await run(["-hide_banner", "-i", input], 120_000);
  const video = stderr.match(/Stream #\d+:\d+.*?: Video: .*?(\d{2,5})x(\d{2,5})(?:[^\n]*?,\s*([\d.]+) fps)?/);
  if (!video) throw new RenderError(`ffmpeg could not read the file: ${stderr.trim().split("\n").pop() ?? "no video stream"}`);
  let width = Number(video[1]), height = Number(video[2]);
  const rot = stderr.match(/rotation of (-?[\d.]+) degrees/);
  if (rot && Math.abs(Math.round(Number(rot[1]) / 90) % 2) === 1) [width, height] = [height, width];
  const dur = stderr.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const seconds = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null;
  return { width, height, fps: video[3] ? Number(video[3]) : null, hasAudio: /Stream #\d+:\d+.*?: Audio: /.test(stderr), seconds };
}

export type Loudness = { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string };
/** First loudnorm pass (audio only, fast): what the file measures, for a linear second pass. */
export async function measureLoudness(input: string): Promise<Loudness | null> {
  const { stderr } = await run(["-hide_banner", "-nostats", "-i", input, "-vn", "-af", `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:print_format=json`, "-f", "null", "-"], 300_000);
  const start = stderr.lastIndexOf("{"); const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const j = JSON.parse(stderr.slice(start, end + 1)) as Partial<Loudness>;
    if (!j.input_i || !j.input_tp || !j.input_lra || !j.input_thresh || !j.target_offset) return null;
    if (!Number.isFinite(Number(j.input_i)) || Number(j.input_i) < -70) return null; // silence: leave it alone
    return j as Loudness;
  } catch { return null; }
}

/* ───────────────────────────── the ASS file ───────────────────────────── */

const pad2 = (n: number) => String(n).padStart(2, "0");
function assTime(s: number): string {
  const cs = Math.max(0, Math.round(s * 100));
  return `${Math.floor(cs / 360000)}:${pad2(Math.floor((cs % 360000) / 6000))}:${pad2(Math.floor((cs % 6000) / 100))}.${pad2(cs % 100)}`;
}
/** Braces start override tags and a backslash starts an escape in ASS text; neither belongs in a caption. */
function assText(t: string): string {
  return t.replace(/[\r\n]+/g, " ").replace(/[{}\\]/g, "").replace(/\s+/g, " ").trim();
}
export function fontFor(lang: string | null | undefined): string {
  return noSpaces(lang) ? "Noto Sans TC" : "Noto Sans";
}

/**
 * Captions: white on a dark box, bottom edge at 75% of the height (below the mouth of a
 * selfie, above Instagram's own caption area). Headline: larger, top edge at 15.6% (below
 * the top strip the app covers). Sizes follow the frame width, so every clip looks the same.
 */
export function buildAss(cues: Cue[], headline: string | null, width: number, height: number, font: string, seconds: number | null): string {
  const k = width / 1080;
  const capSize = Math.round(64 * k), headSize = Math.round(76 * k);
  const marginLR = Math.round(100 * k), pad = Math.round(18 * k);
  const capMarginV = Math.round(height * 0.25), headMarginV = Math.round(height * 0.156);
  const style = (name: string, size: number, back: string, align: number, marginV: number) =>
    `Style: ${name},${font},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,${back},-1,0,0,0,100,100,0,0,4,${pad},0,${align},${marginLR},${marginLR},${marginV},1`;
  const lines = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${width}`, `PlayResY: ${height}`, "ScaledBorderAndShadow: yes", "WrapStyle: 0", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style("Caption", capSize, "&H6E000000", 2, capMarginV),
    style("Headline", headSize, "&H5A000000", 8, headMarginV),
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const end = seconds ? seconds + 1 : 36000;
  const h = headline ? assText(headline) : "";
  if (h) lines.push(`Dialogue: 1,${assTime(0)},${assTime(end)},Headline,,0,0,0,,${h}`);
  for (const c of cues) {
    const t = assText(c.text);
    if (t) lines.push(`Dialogue: 0,${assTime(c.s)},${assTime(c.e)},Caption,,0,0,0,,${t}`);
  }
  return lines.join("\n") + "\n";
}

/** A path inside an ffmpeg filter option: backslashes, colons, quotes and commas need escaping. */
const filterPath = (p: string) => p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,");

/* ───────────────────────────── the render ───────────────────────────── */

export type RenderOutcome = { ok: true; meta: RenderMeta } | { ok: false; error: string; skipped?: boolean; busy?: boolean };

async function loadRow(db: Db, videoId: string): Promise<RenderRow | null> {
  const { data, error } = await db.from("videos").select(RENDER_COLS).eq("id", videoId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as RenderRow | null) ?? null;
}

/**
 * Render one video: claim it (one worker at a time), make sure it has cues (transcribing
 * now if the words were never stored), draw the ASS, measure and normalise the loudness,
 * encode, upload next to the original, record what was made. A failure counts an attempt
 * and, when a post is waiting on it, fails that post with the reason.
 */
export async function renderVideo(db: Db, videoId: string): Promise<RenderOutcome> {
  const v = await loadRow(db, videoId);
  if (!v) return { ok: false, error: "Video not found." };
  if (!v.storage_path || v.file_purged_at) return { ok: false, error: "The video file has already been deleted from our storage." };
  const skip = renderSkipReason(v);
  if (skip) { await db.from("videos").update({ render_state: "skipped", render_error: skip }).eq("id", v.id); return { ok: false, error: skip, skipped: true }; }
  // Claim it. Another function rendering it right now is the only thing that stops us.
  const { data: claimed } = await db.from("videos").update({ render_state: "rendering", render_started_at: new Date().toISOString(), render_error: null })
    .eq("id", v.id).or("render_state.is.null,render_state.neq.rendering").select("id");
  if (!claimed?.length) return { ok: false, error: "This video is being rendered already.", busy: true };
  const dir = await mkdtemp(path.join(tmpdir(), "atl-render-"));
  const t0 = Date.now();
  try {
    if (process.env.RENDER_TEST_HOOKS === "1" && (v.headline ?? "").trim() === "RENDERFAIL") throw new RenderError("test hook: the render was told to fail");
    // Cues: the stored ones, or made now from the words, transcribing first if we never kept them.
    let cues: Cue[] = v.captions_on && isCueList(v.caption_cues) ? v.caption_cues : [];
    let note: string | undefined;
    if (v.captions_on && !isCueList(v.caption_cues)) {
      if (captionsConfigured()) {
        const r = await retimeVideo(db, v);
        if (r.cues) cues = r.cues; else note = `No captions: ${r.error ?? "no speech was found"}.`;
      } else note = "No captions: transcription is not configured.";
    }
    const headline = (v.headline ?? "").trim() || null;
    const key = renderKey({ caption_cues: cues, captions_on: v.captions_on, headline });
    const { data: signed, error: signErr } = await db.storage.from("videos").createSignedUrl(v.storage_path, SIGNED_URL_SECONDS);
    if (signErr || !signed?.signedUrl) throw new RenderError(`Could not make a link to the file: ${signErr?.message ?? "no URL"}`);
    const input = signed.signedUrl;
    const p = await probe(input);
    const font = fontFor(v.transcript_language);
    const drawing = cues.length > 0 || !!headline;
    const assPath = path.join(dir, "captions.ass");
    if (drawing) await writeFile(assPath, buildAss(cues, headline, p.width, p.height, font, p.seconds ?? v.duration_seconds), "utf8");
    const loud = p.hasAudio ? await measureLoudness(input) : null;
    const out = path.join(dir, "out.mp4");
    const args = ["-y", "-hide_banner", "-nostats", "-loglevel", "error", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn"];
    if (drawing) {
      args.push("-vf", `subtitles=filename='${filterPath(assPath)}':fontsdir='${filterPath(FONTS_DIR)}'`,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high", "-pix_fmt", "yuv420p");
      if (p.fps && p.fps > 60) args.push("-r", "60");
    } else {
      args.push("-c:v", "copy");
    }
    if (p.hasAudio) {
      if (loud) args.push("-af", `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=${TARGET_LRA}:measured_I=${loud.input_i}:measured_LRA=${loud.input_lra}:measured_TP=${loud.input_tp}:measured_thresh=${loud.input_thresh}:offset=${loud.target_offset}:linear=true`);
      args.push("-c:a", "aac", "-b:a", "128k", "-ar", "48000");
    }
    args.push("-movflags", "+faststart", "-max_muxing_queue_size", "1024", out);
    const r = await run(args);
    if (r.code !== 0) throw new RenderError(`ffmpeg failed: ${r.stderr.trim().split("\n").filter(Boolean).slice(-2).join(" ") || `exit ${r.code}`}`);
    const bytes = await readFile(out);
    if (bytes.length < 1000) throw new RenderError("ffmpeg produced an empty file");
    const renderPath = v.storage_path.replace(/\.[a-z0-9]+$/i, "") + "-captioned.mp4";
    const { error: upErr } = await db.storage.from("videos").upload(renderPath, bytes, { contentType: "video/mp4", upsert: true });
    if (upErr) throw new RenderError(`Could not store the rendered file: ${upErr.message}`);
    if (v.render_path && v.render_path !== renderPath) await db.storage.from("videos").remove([v.render_path]).catch(() => {});
    const meta: RenderMeta = {
      cues: cues.length, headline: !!headline, width: p.width, height: p.height, seconds: p.seconds ?? v.duration_seconds, bytes: bytes.length,
      encodeMs: Date.now() - t0, videoCopied: !drawing, loudness: loud ? { input: Number(loud.input_i), target: TARGET_LUFS } : null, font, ...(note ? { note } : {}),
    };
    await db.from("videos").update({ render_state: "done", render_path: renderPath, render_key: key, render_error: null, render_meta: meta }).eq("id", v.id);
    return { ok: true, meta };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const attempts = v.render_attempts + 1;
    await db.from("videos").update({ render_state: "failed", render_error: message, render_attempts: attempts }).eq("id", v.id);
    if (v.publish_state === "queued") await db.from("videos").update({ publish_state: "failed", publish_error: `Could not add the captions to the video: ${message}` }).eq("id", v.id);
    return { ok: false, error: message };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Render, then carry on with the post that is waiting for it (the render route and the cron). */
export async function renderThenPublish(db: Db, videoId: string): Promise<{ render: RenderOutcome; publish: PublishOutcome | null }> {
  const render = await renderVideo(db, videoId);
  if (!render.ok && !render.skipped) return { render, publish: null };
  const { data: v } = await db.from("videos").select("publish_state").eq("id", videoId).maybeSingle();
  const publish = v?.publish_state === "queued" ? await startPublish(db, videoId) : null;
  return { render, publish };
}

/**
 * Cron: one render per run for a post whose lead left the page before the render route
 * ran (or whose render died: "rendering" for longer than STALE_MINUTES), then the post.
 * `only` scopes it to those videos (tests on a local build read the live database).
 */
export async function sweepRenders(db: Db, dry = false, only: string[] | null = null): Promise<{ id: string; result: string }[]> {
  if (only && only.length === 0) return [];
  const stale = new Date(Date.now() - STALE_MINUTES * 60_000).toISOString();
  let q = db.from("videos").select("id, render_state, render_started_at").eq("publish_state", "queued").or(`render_state.eq.queued,and(render_state.eq.rendering,render_started_at.lt.${stale})`);
  if (only) q = q.in("id", only);
  const { data, error } = await q.order("publish_requested_at", { ascending: true }).limit(1);
  if (error) throw new Error(error.message);
  const out: { id: string; result: string }[] = [];
  for (const row of (data ?? []) as { id: string; render_state: RenderState | null }[]) {
    if (dry) { out.push({ id: row.id, result: row.render_state === "rendering" ? "would take over a stale render" : "would render" }); continue; }
    if (row.render_state === "rendering") await db.from("videos").update({ render_state: "queued" }).eq("id", row.id);
    const r = await renderThenPublish(db, row.id);
    out.push({ id: row.id, result: r.render.ok ? `rendered (${r.render.meta.cues} cues, ${Math.round(r.render.meta.encodeMs / 1000)} s), post ${r.publish?.state ?? "not started"}` : `${r.render.skipped ? "skipped" : "failed"}: ${r.render.error}${r.publish ? `, post ${r.publish.state}` : ""}` });
  }
  return out;
}
