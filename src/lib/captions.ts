import type { SupabaseClient } from "@supabase/supabase-js";
import type { Script } from "./types";

/**
 * AI-suggested captions (server-only, service role). A cron sends each new video's file
 * to ElevenLabs Scribe by URL (the same kind of signed Storage URL Instagram fetches, so
 * the file never passes through Vercel), then gives the transcript to Claude, which
 * drafts a caption in the language spoken and a one-line English summary for the lead.
 * The lead sees the draft in the caption box and may change every word; nothing posts
 * without their tap. Both base URLs can be pointed at a mock (scripts/dev/captions-mock.mjs).
 */
export const STT_BASE = (process.env.ELEVENLABS_BASE ?? "https://api.elevenlabs.io").replace(/\/$/, "");
export const CLAUDE_BASE = (process.env.ANTHROPIC_BASE ?? "https://api.anthropic.com").replace(/\/$/, "");
export const CAPTION_MODEL = process.env.CAPTION_MODEL ?? "claude-sonnet-5-5";
export const STT_MODEL = "scribe_v2";
/** Attempts that count (a bad file, an unusable answer) before the video is left alone. */
export const MAX_ATTEMPTS = 3;
/** Longer files are not transcribed (Instagram refuses them anyway). */
export const MAX_SECONDS = 15 * 60;
export const SIGNED_URL_SECONDS = 3600;
export const MAX_CAPTION = 2200;
export const MAX_SUMMARY = 200;
/** Videos per sweep; each is one transcription (tens of seconds) and one Claude call. */
export const PER_SWEEP = 3;

export function captionsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ANTHROPIC_API_KEY);
}

/**
 * kind "stop": the account or the provider is the problem (quota, key, outage); the video
 * is left as it was and the sweep ends, to try again next run. "retry": this video's
 * attempt failed and counts. "skip": this file can never be captioned.
 */
export class CaptionError extends Error {
  constructor(message: string, readonly kind: "stop" | "retry" | "skip", readonly status?: number) {
    super(message);
    this.name = "CaptionError";
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type Transcript = { text: string; languageCode: string | null; probability: number | null; durationSeconds: number | null };

/** ElevenLabs Scribe: one request with the file's URL; the answer is the whole transcript. */
export async function transcribe(fileUrl: string): Promise<Transcript> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new CaptionError("ELEVENLABS_API_KEY is not set", "stop");
  const form = new FormData();
  form.set("model_id", STT_MODEL);
  form.set("source_url", fileUrl);
  form.set("tag_audio_events", "false");
  form.set("diarize", "false");
  let res: Response;
  try {
    res = await fetch(`${STT_BASE}/v1/speech-to-text`, { method: "POST", headers: { "xi-api-key": key }, body: form, signal: AbortSignal.timeout(240_000) });
  } catch (e) {
    throw new CaptionError(`Speech to text did not answer: ${msg(e)}`, "stop");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw sttError(res.status, body);
  const b = (body ?? {}) as { text?: unknown; language_code?: unknown; language_probability?: unknown; audio_duration_secs?: unknown };
  return {
    text: typeof b.text === "string" ? b.text.trim() : "",
    languageCode: str(b.language_code),
    probability: num(b.language_probability),
    durationSeconds: num(b.audio_duration_secs),
  };
}

/** ElevenLabs errors come as `detail`: a string, an object {status, message}, or a list of {loc, msg, type}. */
function sttError(status: number, body: unknown): CaptionError {
  const d = (body as { detail?: unknown } | null)?.detail;
  let code = "";
  let message = "";
  if (typeof d === "string") message = d;
  else if (Array.isArray(d)) message = d.map((x) => (x as { msg?: string })?.msg ?? JSON.stringify(x)).join("; ");
  else if (d && typeof d === "object") {
    const o = d as { status?: unknown; message?: unknown };
    code = str(o.status) ?? "";
    message = str(o.message) ?? JSON.stringify(d);
  } else message = `HTTP ${status}`;
  const text = `${code} ${message}`.toLowerCase();
  const account = status === 401 || status === 402 || status === 403 || status === 429 || /quota|limit|exceed|insufficient|payment|billing|api key|unauthorized|permission|forbidden/.test(text);
  return new CaptionError(`Speech to text: ${code ? `${code}: ` : ""}${message}`, account || status >= 500 ? "stop" : "retry", status);
}

export type DraftInput = {
  transcript: string;
  transcriptLanguage: string | null;
  declaredLanguage: string | null;
  script: Script | null;
  uploaderName: string | null;
  teamName: string | null;
  teamLanguage: string | null;
  durationSeconds: number | null;
};
export type Draft = { caption: string; summary: string };

const SYSTEM = `You write Instagram captions for Assigned To Labor, a volunteer project in which members and friends of The Church of Jesus Christ of Latter-day Saints record short videos about their faith. Each video is reviewed by a volunteer team lead and posted on the team's Instagram account as a Reel. You are given an automatic transcript of one video (it may contain recognition errors), the language the speaker said they would use, the script they planned (if any; people often depart from it), the team, and the speaker's first name if they gave one.

Write two things and answer with JSON only, in exactly this shape:
{"caption": "...", "summary": "..."}

caption: the Instagram caption, written in the language the speaker actually uses in the transcript (if the transcript is in Tagalog, write Tagalog; if it mixes languages, use the main one). Written the way the team would present this person's words: open with the strongest thought they expressed, quoting a short phrase of theirs where it helps; stay faithful to what they said and add no claims, names, places, scripture references or doctrine they did not say; if they made an invitation (to pray, to read, to learn more, to visit a meeting), end with it in a gentle sentence of their own words; then, on a last line, 3 to 6 relevant hashtags in that language or in English. If a first name is given you may use it; never invent one. Plain text, no markdown, at most one emoji, no mention of a transcript or a recording. Aim for 300 to 700 characters; the hard limit is 2200.

summary: one sentence in English, at most 160 characters, telling the team lead what the person talks about, so they know before watching. Mention anything a reviewer should notice, such as the speaker naming a third person or a sensitive personal detail.

If the transcript has no usable speech, answer {"caption": "", "summary": "No usable speech in the transcript."}.`;

function userMessage(i: DraftInput): string {
  const planned = i.script && (i.script.hook || i.script.body || i.script.cta)
    ? [i.script.hook, i.script.body, i.script.cta].filter(Boolean).join("\n")
    : "(none; they improvised)";
  return [
    `Team: ${i.teamName ?? "(not assigned yet)"}${i.teamLanguage ? ` (${i.teamLanguage})` : ""}`,
    `Language the speaker said they would use: ${i.declaredLanguage ?? "(not given)"}`,
    `Language detected in the audio: ${i.transcriptLanguage ?? "(unknown)"}`,
    `Speaker's first name: ${i.uploaderName?.trim() || "(not given)"}`,
    `Length: ${i.durationSeconds ? `${Math.round(i.durationSeconds)} seconds` : "(unknown)"}`,
    `Planned script:\n${planned}`,
    `Transcript:\n${i.transcript}`,
  ].join("\n\n");
}

/** One Claude call; the answer must be the JSON object described in the system prompt. */
export async function draftCaption(input: DraftInput): Promise<Draft> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new CaptionError("ANTHROPIC_API_KEY is not set", "stop");
  let res: Response;
  try {
    res = await fetch(`${CLAUDE_BASE}/v1/messages`, {
      method: "POST",
      headers: {
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json",
        // An organization-level key must name the workspace to bill; a workspace-scoped key needs nothing.
        ...(process.env.ANTHROPIC_WORKSPACE_ID ? { "anthropic-workspace-id": process.env.ANTHROPIC_WORKSPACE_ID } : {}),
      },
      body: JSON.stringify({ model: CAPTION_MODEL, max_tokens: 1500, temperature: 0.4, system: SYSTEM, messages: [{ role: "user", content: userMessage(input) }] }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (e) {
    throw new CaptionError(`Claude did not answer: ${msg(e)}`, "stop");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as { error?: { type?: string; message?: string } } | null)?.error;
    const detail = `Claude: ${err?.type ? `${err.type}: ` : ""}${err?.message ?? `HTTP ${res.status}`}`;
    // 400 means our request (most likely the transcript) is the problem, unless it is about the key or the
    // workspace (seen live 2026-10-15: an organization-level key without anthropic-workspace-id); everything
    // else is the account or the service. Account and service problems never count against the video.
    const ours = res.status === 400 && !/api key|workspace|authentication|credit|billing/i.test(err?.message ?? "");
    throw new CaptionError(detail, ours ? "retry" : "stop", res.status);
  }
  const content = ((body as { content?: unknown })?.content ?? []) as { type?: string; text?: string }[];
  const text = content.filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text).join("\n");
  return parseDraft(text);
}

/** The model is asked for JSON only; tolerate text around it, refuse anything else. */
export function parseDraft(text: string): Draft {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new CaptionError("Claude did not return the expected JSON", "retry");
  let parsed: unknown;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { throw new CaptionError("Claude returned unreadable JSON", "retry"); }
  const o = (parsed ?? {}) as { caption?: unknown; summary?: unknown };
  const caption = (typeof o.caption === "string" ? o.caption : "").trim().slice(0, MAX_CAPTION);
  const summary = (typeof o.summary === "string" ? o.summary : "").trim().slice(0, MAX_SUMMARY);
  return { caption, summary };
}

/** What the sweep reads for each video. */
export const CAPTION_COLS = "id, status, storage_path, file_purged_at, duration_seconds, language, script, uploader_name, transcript, transcript_language, transcript_confidence, caption_attempts, area:areas(name, language)";
export type CaptionRow = {
  id: string;
  status: string;
  storage_path: string | null;
  file_purged_at: string | null;
  duration_seconds: number | null;
  language: string | null;
  script: Script | null;
  uploader_name: string | null;
  transcript: string | null;
  transcript_language: string | null;
  transcript_confidence: number | null;
  caption_attempts: number;
  area: { name: string; language: string } | null;
};
export type CaptionOutcome = { id: string; result: "done" | "skipped" | "failed" | "deferred" | "would"; detail?: string; language?: string | null };

/** Why a file is not worth sending, or null. */
export function fileProblem(v: Pick<CaptionRow, "storage_path" | "file_purged_at" | "duration_seconds">): string | null {
  if (!v.storage_path || v.file_purged_at) return "The file is no longer stored.";
  if (v.duration_seconds && v.duration_seconds > MAX_SECONDS) return `Longer than ${MAX_SECONDS / 60} minutes.`;
  return null;
}

/** Caption one video: transcribe (unless a transcript is already stored from an earlier try), draft, save. */
export async function captionVideo(db: SupabaseClient, v: CaptionRow): Promise<CaptionOutcome> {
  const skip = fileProblem(v);
  if (skip) {
    await db.from("videos").update({ caption_state: "skipped", caption_error: skip }).eq("id", v.id).is("caption_state", null);
    return { id: v.id, result: "skipped", detail: skip };
  }
  try {
    let t: Transcript;
    if (v.transcript !== null) {
      t = { text: v.transcript, languageCode: v.transcript_language, probability: v.transcript_confidence, durationSeconds: v.duration_seconds };
    } else {
      const { data: signed, error: signErr } = await db.storage.from("videos").createSignedUrl(v.storage_path!, SIGNED_URL_SECONDS);
      if (signErr || !signed?.signedUrl) throw new CaptionError(`Could not sign the file URL: ${signErr?.message ?? "no URL"}`, "retry");
      t = await transcribe(signed.signedUrl);
      // Keep the transcript at once: if the draft fails, the next try does not pay for the audio again.
      await db.from("videos").update({ transcript: t.text, transcript_language: t.languageCode, transcript_confidence: t.probability }).eq("id", v.id);
    }
    if (!t.text) {
      await db.from("videos").update({ caption_state: "skipped", caption_error: "No speech was found in the audio." }).eq("id", v.id).is("caption_state", null);
      return { id: v.id, result: "skipped", detail: "No speech was found in the audio.", language: t.languageCode };
    }
    const d = await draftCaption({
      transcript: t.text, transcriptLanguage: t.languageCode, declaredLanguage: v.language, script: v.script, uploaderName: v.uploader_name,
      teamName: v.area?.name ?? null, teamLanguage: v.area?.language ?? null, durationSeconds: t.durationSeconds ?? v.duration_seconds,
    });
    if (!d.caption) {
      await db.from("videos").update({ caption_state: "skipped", caption_error: d.summary || "No usable speech.", ai_summary: d.summary || null }).eq("id", v.id).is("caption_state", null);
      return { id: v.id, result: "skipped", detail: d.summary || "No usable speech.", language: t.languageCode };
    }
    await db.from("videos").update({ ai_caption: d.caption, ai_summary: d.summary || null, caption_state: "done", captioned_at: new Date().toISOString(), caption_error: null }).eq("id", v.id).is("caption_state", null);
    return { id: v.id, result: "done", language: t.languageCode };
  } catch (e) {
    const err = e instanceof CaptionError ? e : new CaptionError(msg(e), "retry");
    if (err.kind === "skip") {
      await db.from("videos").update({ caption_state: "skipped", caption_error: err.message }).eq("id", v.id).is("caption_state", null);
      return { id: v.id, result: "skipped", detail: err.message };
    }
    if (err.kind === "stop") {
      await db.from("videos").update({ caption_error: err.message }).eq("id", v.id).is("caption_state", null);
      return { id: v.id, result: "deferred", detail: err.message };
    }
    const attempts = v.caption_attempts + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    await db.from("videos").update({ caption_attempts: attempts, caption_error: err.message, ...(failed ? { caption_state: "failed" } : {}) }).eq("id", v.id).is("caption_state", null);
    return { id: v.id, result: failed ? "failed" : "deferred", detail: `${err.message} (attempt ${attempts} of ${MAX_ATTEMPTS})` };
  }
}

/**
 * The videos still waiting for a caption, a few per run: approved ones first (they are
 * about to be posted), then the newest pending ones. Ends early when the provider or
 * the account is the problem, so one bad run does not burn every video's attempts.
 * `only` restricts the sweep to those video ids (the tests, which run a local build
 * against the live database, and a by-hand re-run for one video).
 */
export async function sweepCaptions(db: SupabaseClient, dry: boolean, opts: { limit?: number; only?: string[] } = {}): Promise<CaptionOutcome[]> {
  let q = db
    .from("videos")
    .select(CAPTION_COLS)
    .is("caption_state", null)
    .in("status", ["pending", "approved"]);
  if (opts.only) q = q.in("id", opts.only);
  const { data, error } = await q
    .order("status", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? PER_SWEEP);
  if (error) throw new Error(`Could not list videos: ${error.message}`);
  const rows = (data ?? []) as unknown as CaptionRow[];
  const out: CaptionOutcome[] = [];
  for (const v of rows) {
    if (dry) { const p = fileProblem(v); out.push({ id: v.id, result: p ? "skipped" : "would", detail: p ?? (v.transcript !== null ? "draft from the stored transcript" : "transcribe and draft") }); continue; }
    const o = await captionVideo(db, v);
    out.push(o);
    if (o.result === "deferred" && !/attempt \d/.test(o.detail ?? "")) break;
  }
  return out;
}
