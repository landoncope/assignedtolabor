// Finds recordings whose picture stops before the sound does (the iPhone freeze of
// 2026-09-19). Read-only: signs each file with the service role, lets ffprobe read the
// packet timestamps, and compares where the video and audio tracks end.
//   node scripts/dev/freeze-audit.mjs [since-ISO-date]      (default: the last 7 days)
// Needs ffprobe on the PATH and SUPABASE_SERVICE_ROLE_KEY in .env.local.
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const since = process.argv[2] ?? new Date(Date.now() - 7 * 86400_000).toISOString();

function lastPts(url, stream) {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", stream, "-show_entries", "packet=pts_time", "-of", "csv=p=0", url], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const times = out.split("\n").map((l) => parseFloat(l)).filter((n) => Number.isFinite(n));
  return { end: times.length ? Math.max(...times) : null, packets: times.length };
}
function device(ua) {
  if (!ua) return "uploaded file";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : "other";
  // Safari 26 freezes the OS token at 18_6 / 18_7, so its own Version/ is the truth; Chrome for iOS reports the real OS.
  const v = (/CriOS|FxiOS|EdgiOS/.test(ua) ? null : ua.match(/Version\/(\d+[.\d]*)/)?.[1]) ?? ua.match(/OS (\d+[_\d]*)/)?.[1]?.replaceAll("_", ".") ?? ua.match(/Android (\d+)/)?.[1] ?? "";
  return `${os} ${v}`.trim();
}

const { data: rows, error } = await sb.from("videos")
  .select("id, created_at, uploader_name, storage_path, file_purged_at, duration_seconds, capture_meta")
  .gte("created_at", since).is("file_purged_at", null).order("created_at");
if (error) { console.error(error.message); process.exit(1); }

console.log(`${rows.length} videos since ${since}\n`);
console.log(["id", "who", "device", "pipeline", "video ends", "audio ends", "verdict"].join(" | "));
let frozen = 0;
for (const r of rows) {
  const { data: signed, error: e } = await sb.storage.from("videos").createSignedUrl(r.storage_path, 600);
  if (e) { console.log(`${r.id.slice(0, 8)} | sign failed: ${e.message}`); continue; }
  let v, a;
  try { v = lastPts(signed.signedUrl, "v:0"); a = lastPts(signed.signedUrl, "a:0"); }
  catch (err) { console.log(`${r.id.slice(0, 8)} | ffprobe failed: ${String(err.message).slice(0, 80)}`); continue; }
  const gap = v.end !== null && a.end !== null ? a.end - v.end : null;
  const verdict = gap === null ? "no audio or no video" : gap > 1.5 ? `FROZE at ${v.end.toFixed(1)}s (${gap.toFixed(0)}s of sound without picture)` : "ok";
  if (gap !== null && gap > 1.5) frozen++;
  const m = r.capture_meta;
  console.log([r.id.slice(0, 8), r.uploader_name ?? "-", device(m?.ua), m ? (m.pipeline ?? "canvas") : "-", v.end?.toFixed(1) ?? "-", a.end?.toFixed(1) ?? "-", verdict].join(" | "));
}
console.log(`\n${frozen} of ${rows.length} froze`);
