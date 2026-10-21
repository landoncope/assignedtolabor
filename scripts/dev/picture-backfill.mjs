// Reads the picture of stored recordings with the recorder's own reader (src/lib/mp4-tracks.ts)
// and, with --write, stores the result as `capture_meta.picture` for recordings that
// never had the on-device check (made before 2026-09-20, the 2026-09-19 event files among
// them), so the review page shows its red "picture freezes" line and the one-tap post
// refuses them before asking Instagram. Only box headers are fetched (HTTP ranges on a
// signed URL), never the media, so a 100 MB file costs a few hundred small requests.
//   node scripts/dev/picture-backfill.mjs [--write] [--all] [since-ISO-date]
// Default: report only, recordings without a stored check, no date limit. --all also
// re-reads recordings that have one (compare, never overwritten). Needs .env.local.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const { readPicture, FROZEN_PICTURE_SECONDS } = await import(process.cwd() + "/src/lib/mp4-tracks.ts");
const args = process.argv.slice(2);
const write = args.includes("--write"), all = args.includes("--all");
const since = args.find((a) => !a.startsWith("--")) ?? "2000-01-01";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

/** The slice of a Blob that readPicture needs, served by HTTP range requests. */
class RangeBlob {
  constructor(url, size) { this.url = url; this.size = size; this.requests = 0; }
  slice(start, end) {
    return { arrayBuffer: async () => {
      this.requests++;
      const r = await fetch(this.url, { headers: { Range: `bytes=${start}-${Math.min(end, this.size) - 1}` } });
      if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status} for range ${start}-${end}`);
      const buf = await r.arrayBuffer();
      return r.status === 200 ? buf.slice(start, end) : buf;
    } };
  }
}
const round1 = (n) => Math.round(n * 10) / 10;

const { data: rows, error } = await sb.from("videos")
  .select("id, created_at, status, uploader_name, storage_path, file_size, capture_meta")
  .gte("created_at", since).is("file_purged_at", null).not("capture_meta", "is", null).order("created_at");
if (error) { console.error(error.message); process.exit(1); }
const todo = rows.filter((r) => all || !("picture" in r.capture_meta));
console.log(`${rows.length} stored recordings since ${since}; ${todo.length} to read${write ? " and write" : ""}\n`);
console.log(["id", "made", "status", "who", "picture ends", "sound ends", "verdict", "stored check"].join(" | "));
let frozen = 0, written = 0;
for (const r of todo) {
  const { data: signed, error: e } = await sb.storage.from("videos").createSignedUrl(r.storage_path, 600);
  if (e) { console.log(`${r.id.slice(0, 8)} | sign failed: ${e.message}`); continue; }
  const head = await fetch(signed.signedUrl, { method: "HEAD" });
  const size = Number(head.headers.get("content-length")) || r.file_size;
  const blob = new RangeBlob(signed.signedUrl, size);
  const p = await readPicture(blob);
  const isFrozen = p ? p.longestHold.seconds > FROZEN_PICTURE_SECONDS : false;
  if (isFrozen) frozen++;
  const verdict = !p ? "not readable" : isFrozen ? `FROZEN ${p.longestHold.seconds.toFixed(1)}s from ${p.longestHold.at.toFixed(1)}s` : `ok (longest frame ${p.longestHold.seconds.toFixed(2)}s)`;
  const stored = r.capture_meta.picture ? `${r.capture_meta.picture.longestHold}s from ${r.capture_meta.picture.holdAt}s${r.capture_meta.picture.audited ? " (audit)" : ""}` : "none";
  console.log([r.id.slice(0, 8), r.created_at.slice(0, 10), r.status, r.uploader_name ?? "-", p ? p.picture.toFixed(1) : "-", p ? p.sound.toFixed(1) : "-", verdict, stored, `${blob.requests} reads`].join(" | "));
  if (write && p && !("picture" in r.capture_meta)) {
    const picture = { seconds: round1(p.picture), sound: round1(p.sound), longestHold: round1(p.longestHold.seconds), holdAt: round1(p.longestHold.at), audited: new Date().toISOString() };
    const { error: wErr } = await sb.from("videos").update({ capture_meta: { ...r.capture_meta, picture } }).eq("id", r.id);
    if (wErr) console.log(`  write failed: ${wErr.message}`); else written++;
  }
}
console.log(`\n${frozen} frozen of ${todo.length} read${write ? `; ${written} stored` : ""}`);
