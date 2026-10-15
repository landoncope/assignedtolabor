// How loud are the stored recordings? Read-only: signs each file with the service role,
// lets ffmpeg measure the audio (EBU R128 integrated loudness, loudness range, true
// peak) and prints one line per video plus a summary by device. Speech on social
// video sits around -16 to -20 LUFS; much below -24 and phones need the volume up.
//   node scripts/dev/loudness-audit.mjs [since-ISO-date]      (default: the last 30 days)
// Needs ffmpeg on the PATH and SUPABASE_SERVICE_ROLE_KEY in .env.local.
import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const since = process.argv[2] ?? new Date(Date.now() - 30 * 86400_000).toISOString();

function device(ua) {
  if (!ua) return "uploaded file";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Macintosh/.test(ua) ? "Mac" : "other";
  const v = (/CriOS|FxiOS|EdgiOS/.test(ua) ? null : ua.match(/Version\/(\d+[.\d]*)/)?.[1]) ?? ua.match(/OS (\d+[_\d]*)/)?.[1]?.replaceAll("_", ".") ?? ua.match(/Android (\d+)/)?.[1] ?? "";
  return `${os} ${v}`.trim();
}
function measure(url) {
  const r = spawnSync("ffmpeg", ["-nostats", "-hide_banner", "-i", url, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  // ebur128 prints a running line per frame (starting at -70) and a Summary at the end; only the summary counts.
  const all = r.stderr ?? "";
  const t = all.slice(Math.max(0, all.lastIndexOf("Summary:")));
  const num = (re) => { const m = t.match(re); return m ? parseFloat(m[1]) : null; };
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+(-?[\d.]+) LU/), peak: num(/Peak:\s+(-?[\d.]+) dBFS/), ok: r.status === 0 };
}

const { data: rows, error } = await sb.from("videos")
  .select("id, created_at, uploader_name, status, storage_path, file_purged_at, duration_seconds, capture_meta")
  .gte("created_at", since).is("file_purged_at", null).not("storage_path", "is", null).order("created_at");
if (error) { console.error(error.message); process.exit(1); }
console.log(`${rows.length} videos with a file since ${since.slice(0, 10)}\n`);
console.log(["date", "id", "device", "pipeline", "agc", "secs", "LUFS", "LRA", "peak dBFS", "verdict"].join(" | "));
const results = [];
for (const r of rows) {
  const { data: signed, error: e } = await sb.storage.from("videos").createSignedUrl(r.storage_path, 900);
  if (e) { console.log(`${r.id.slice(0, 8)} | sign failed: ${e.message}`); continue; }
  const m = measure(signed.signedUrl);
  const cm = r.capture_meta;
  const dev = device(cm?.ua ?? cm?.userAgent ?? cm?.device);
  // Recordings before 2026-09-17 had the browser's automatic gain control on (the default); since then it is off.
  const agc = !cm ? "n/a" : r.created_at < "2026-09-17T12:00:00Z" ? "on" : "off";
  const verdict = m.I === null ? "no audio?" : m.I > -14 ? "loud" : m.I >= -20 ? "fine" : m.I >= -24 ? "a bit quiet" : m.I >= -30 ? "quiet" : "very quiet";
  results.push({ dev: dev.split(" ")[0], agc, I: m.I, pipeline: cm?.pipeline ?? "-" });
  console.log([r.created_at.slice(0, 10), r.id.slice(0, 8), dev, cm?.pipeline ?? "-", agc, r.duration_seconds ?? "?", m.I ?? "-", m.LRA ?? "-", m.peak ?? "-", verdict].join(" | "));
}
const med = (a) => { const s = a.filter((x) => x !== null).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
console.log("\nMedian integrated loudness by device and gain control:");
for (const key of [...new Set(results.map((r) => `${r.dev} / agc ${r.agc}`))].sort()) {
  const g = results.filter((r) => `${r.dev} / agc ${r.agc}` === key);
  console.log(`  ${key}: ${g.length} videos, median ${med(g.map((r) => r.I))} LUFS, range ${Math.min(...g.map((r) => r.I ?? 0))} to ${Math.max(...g.map((r) => r.I ?? -99))}`);
}
