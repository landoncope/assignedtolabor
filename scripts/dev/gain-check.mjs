// Does the recorder's gain stage (src/lib/mic-gain.ts) lift a quiet microphone? Runs
// the real /upload flow twice in this Mac's Chrome with a fake camera and a fake
// microphone playing a quiet speech-like signal (-40 dBFS bursts), once with the gain
// and once with `?gain=off`, saves both recordings and measures them with ffmpeg.
//   build and start the app (NEXT_PUBLIC_TURNSTILE_SITE_KEY= ... npx next start -p 3001), then
//   node scripts/dev/gain-check.mjs http://127.0.0.1:3001 fake-cam.y4m [work-dir]
// Read-only against the project: the flow stops at the review step (--no-upload).
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2] ?? "http://127.0.0.1:3001";
const cam = process.argv[3] ?? "fake-cam.y4m";
const dir = process.argv[4] ?? "/tmp/gain-check";
mkdirSync(dir, { recursive: true });
let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` · ${detail}` : ""}`); };

// A quiet voice: 220 Hz with harmonics, in bursts (speech has gaps), peaks at about -40 dBFS.
const wav = join(dir, "quiet-voice.wav");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "aevalsrc=0.01*(sin(2*PI*220*t)+0.5*sin(2*PI*440*t)+0.25*sin(2*PI*880*t))*gt(sin(2*PI*1.5*t)\\,0):s=48000:d=20", "-ac", "1", "-c:a", "pcm_s16le", wav]);

function measure(file) {
  const r = spawnSync("ffmpeg", ["-nostats", "-hide_banner", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const t = (r.stderr ?? "").slice(Math.max(0, (r.stderr ?? "").lastIndexOf("Summary:")));
  const num = (re) => { const m = t.match(re); return m ? parseFloat(m[1]) : null; };
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), peak: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}
function record(label, query) {
  const out = join(dir, `${label}.mp4`);
  const args = ["scripts/dev/headless-upload-flow.mjs", base, cam, `gain-${label}`, "--fake-audio", wav, "--save", out, "--no-upload", "--clips", "1", "--clip-seconds", "8", ...(query ? ["--query", query] : [])];
  const r = spawnSync("node", args, { encoding: "utf8" });
  const log = (r.stdout ?? "") + (r.stderr ?? "");
  const lines = log.split("\n").filter((l) => /mic gain|audio graph|RESULT|saved:/.test(l));
  console.log(`--- ${label}\n${lines.join("\n")}`);
  return { ok: /RESULT: PASS/.test(log), out, log };
}

const on = record("gain-on", null);
check("flow with the gain stage recorded a clip", on.ok);
check("gain stage started in Chrome", /mic gain on: starting at \+0 dB/.test(on.log), "desktop Chrome starts at +0 dB");
const off = record("gain-off", "gain=off");
check("flow with ?gain=off recorded a clip", off.ok);
check("?gain=off was noted", /TEST MODE: mic gain off/.test(off.log));
const mOn = measure(on.out), mOff = measure(off.out);
console.log(`\ngain on : ${mOn.I} LUFS, true peak ${mOn.peak} dBFS\ngain off: ${mOff.I} LUFS, true peak ${mOff.peak} dBFS`);
check("raw recording is quiet, as fed in", mOff.I !== null && mOff.I < -30, `${mOff.I} LUFS`);
check("levelled recording sits near the target", mOn.I !== null && mOn.I > -24 && mOn.I < -8, `${mOn.I} LUFS`);
check("the gain lifted it by at least 12 dB", mOn.I !== null && mOff.I !== null && mOn.I - mOff.I >= 12, `${(mOn.I - mOff.I).toFixed(1)} dB`);
check("the limiter kept the peaks under 0 dBFS", mOn.peak !== null && mOn.peak <= -0.5, `${mOn.peak} dBFS`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
