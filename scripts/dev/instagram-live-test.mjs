// Sets up (and tears down) the first REAL Instagram post through the site, on production.
//   node scripts/dev/instagram-live-test.mjs setup    [--file ./clip.mp4]   (default: a 6 s synthetic 1080x1920 clip)
//   node scripts/dev/instagram-live-test.mjs status
//   node scripts/dev/instagram-live-test.mjs cleanup
// setup: an active test team "Instagram test" (language Klingon, so language routing never
// sends anyone's real video to it), and one pending video for the admin landoncope@gmail.com
// assigned to that team, with a short caption. Then, on https://assignedtolabor.org:
//   Review -> Instagram accounts -> Connect Instagram on "Instagram test" (logged in to the
//   test Instagram account in that browser) -> open the video -> Approve and post.
// status: the video's publish state, the connection, and whether the permalink is public
// (fetched signed-out).
// cleanup: disconnects the test team, deletes the test video rows and files, deactivates and
// deletes the team. The Reel itself stays on Instagram (delete it in the Instagram app).
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const cmd = process.argv[2];
const opt = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const TEAM = { name: "Instagram test", language: "Klingon" };
const ADMIN_EMAIL = "landoncope@gmail.com";

async function team() { return (await db.from("areas").select("*").eq("name", TEAM.name).eq("language", TEAM.language).maybeSingle()).data; }

if (cmd === "setup") {
  const { data: admin } = await db.from("profiles").select("id").ilike("email", ADMIN_EMAIL).maybeSingle();
  if (!admin) throw new Error(`no profile for ${ADMIN_EMAIL}`);
  let t = await team();
  if (!t) { t = (await db.from("areas").insert({ ...TEAM, is_active: true, sort_order: 999 }).select("*").single()).data; console.log("team created", t.id); }
  else { await db.from("areas").update({ is_active: true }).eq("id", t.id); console.log("team exists", t.id); }
  let file = opt("--file"), tmp = null;
  if (!file) {
    tmp = mkdtempSync(join(tmpdir(), "ig-live-"));
    file = join(tmp, "synthetic-portrait.mp4");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "6", "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-b:v", "4M", "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-movflags", "+faststart", "-shortest", file]);
  }
  const bytes = readFileSync(file);
  const path = `${admin.id}/ig-live-${Date.now()}.mp4`;
  const { error: upErr } = await db.storage.from("videos").upload(path, bytes, { contentType: "video/mp4" });
  if (upErr) throw new Error(upErr.message);
  const { data: v, error } = await db.from("videos").insert({
    user_id: admin.id, area_id: t.id, language: TEAM.language, storage_path: path, file_name: file.split("/").pop(), file_size: bytes.length, mime_type: "video/mp4",
    duration_seconds: Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim()) | 0,
    script: { hook: "Test post from Assigned To Labor", body: "Checking that approved videos can be posted from the site. This is a test clip.", cta: null },
    uploader_name: "ig-live-test", status: "pending",
  }).select("id").single();
  if (error) throw new Error(error.message);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  console.log(`video ${v.id} (${(bytes.length / 1048576).toFixed(1)} MB) is pending on the test team`);
  console.log(`1. https://assignedtolabor.org/review  -> Instagram accounts -> Connect Instagram on "${TEAM.name}"`);
  console.log(`2. https://assignedtolabor.org/review/${v.id}  -> Approve and post`);
  console.log(`3. node scripts/dev/instagram-live-test.mjs status`);
} else if (cmd === "status") {
  const t = await team();
  if (!t) { console.log("no test team"); process.exit(0); }
  const acct = (await db.from("instagram_accounts").select("username, ig_user_id, token_expires_at, refreshed_at, last_error, connected_at").eq("area_id", t.id).maybeSingle()).data;
  console.log("connection:", acct ? `@${acct.username} (${acct.ig_user_id}) connected ${acct.connected_at.slice(0, 16)} token until ${acct.token_expires_at?.slice(0, 10)}${acct.last_error ? ` LAST ERROR ${acct.last_error}` : ""}` : "none");
  const { data: vids } = await db.from("videos").select("id, status, publish_state, publish_error, post_url, post_media_id, publish_attempts, posted_at, file_size, duration_seconds").eq("area_id", t.id).order("created_at");
  for (const v of vids ?? []) {
    console.log(`video ${v.id}: ${v.status} / ${v.publish_state ?? "-"}${v.publish_error ? ` / ${v.publish_error}` : ""}${v.post_url ? ` / ${v.post_url}` : ""} (${(v.file_size / 1048576).toFixed(1)} MB, ${v.duration_seconds}s, attempts ${v.publish_attempts})`);
    if (v.post_url) {
      const r = await fetch(v.post_url, { headers: { "user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36", accept: "text/html" }, redirect: "manual" });
      const html = r.status === 200 ? await r.text() : "";
      const og = (html.match(/<meta property="og:(?:title|video)" content="([^"]*)"/g) ?? []).map((m) => m.replace(/.*content="/, "").replace(/"$/, "")).slice(0, 2);
      console.log(`  signed-out fetch: HTTP ${r.status}${r.headers.get("location") ? ` -> ${r.headers.get("location")}` : ""}${og.length ? ` og: ${og.join(" | ")}` : ""}${/Page Not Found|Sorry, this page isn't available/.test(html) ? " (NOT FOUND page)" : ""}`);
    }
  }
} else if (cmd === "cleanup") {
  const t = await team();
  if (!t) { console.log("no test team"); process.exit(0); }
  await db.from("instagram_accounts").delete().eq("area_id", t.id);
  const { data: vids } = await db.from("videos").select("id, storage_path").eq("area_id", t.id);
  const paths = (vids ?? []).map((v) => v.storage_path).filter(Boolean);
  if (vids?.length) await db.from("videos").delete().in("id", vids.map((v) => v.id));
  if (paths.length) await db.storage.from("videos").remove(paths);
  await db.from("areas").delete().eq("id", t.id);
  console.log(`removed ${vids?.length ?? 0} video(s), the connection and the team`);
} else {
  console.log("usage: setup [--file clip.mp4] | status | cleanup");
}
