// First live test of Instagram publishing (Instagram API with Instagram Login), no app code.
// Posts ONE stored video as a Reel to the Instagram account behind INSTAGRAM_TEST_TOKEN.
//   node scripts/dev/instagram-post-test.mjs --video <videos.id> [--caption "..."] [--dry]
//   node scripts/dev/instagram-post-test.mjs --file ./clip.mp4 ...   (uploads the file to the
//        bucket under dev-tests/ first, so Meta can fetch it from a signed URL)
// Needs in .env.local: INSTAGRAM_TEST_TOKEN (a user token from the Meta dashboard, "Generate
// access tokens -> Add account", pasted by Landon), NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY. Prints the account, the file facts, each API step, and the
// permalink. --dry stops before creating the container. Nothing is written to the database.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const token = env.INSTAGRAM_TEST_TOKEN;
if (!token) throw new Error("INSTAGRAM_TEST_TOKEN missing from .env.local");
const API = `https://graph.instagram.com/${env.IG_API_VERSION ?? "v24.0"}`;
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function ig(path, { method = "GET", params = {} } = {}) {
  const url = new URL(`${API}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === "GET"
    ? await fetch(`${url}?${body}`)
    : await fetch(url, { method, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(`${method} /${path} -> ${res.status} ${JSON.stringify(json.error ?? json)}`);
  return json;
}

// 1. Who is this token?
const me = await ig("me", { params: { fields: "id,username,account_type,user_id" } });
say("account:", me.username, `(${me.account_type}) ig user id ${me.user_id ?? me.id}`);
const igUserId = me.user_id ?? me.id;

// 2. The file: a stored video (by videos.id) or a local file uploaded for the test.
let path, caption = opt("--caption"), facts = "";
if (opt("--video")) {
  const { data: v, error } = await db.from("videos").select("id, storage_path, mime_type, file_size, duration_seconds, script, language, capture_meta").eq("id", opt("--video")).single();
  if (error) throw new Error(error.message);
  path = v.storage_path;
  const cm = v.capture_meta ?? {};
  facts = `${v.mime_type} ${((v.file_size ?? 0) / 1048576).toFixed(1)} MB ${v.duration_seconds ?? "?"} s ` +
    `camera ${cm.camera ?? "?"} recorded ${cm.recorded ?? "raw"} ${cm.codec ?? ""} fps=${cm.fps ?? "?"} clips=${cm.clips ?? "?"} pipeline=${cm.pipeline ?? "canvas"}` + (cm.picture ? ` picture ${cm.picture.seconds}s sound ${cm.picture.sound}s hold ${cm.picture.longestHold}s` : "");
  caption ??= v.script ? [v.script.hook, v.script.body, v.script.cta].filter(Boolean).join("\n\n") : "";
} else if (opt("--file")) {
  const file = opt("--file");
  path = `dev-tests/${Date.now()}-${basename(file)}`;
  const bytes = readFileSync(file);
  const { error } = await db.storage.from("videos").upload(path, bytes, { contentType: "video/mp4" });
  if (error) throw new Error(error.message);
  facts = `${(bytes.length / 1048576).toFixed(1)} MB uploaded to ${path}`;
} else {
  throw new Error("give --video <id> or --file <path>");
}
caption ??= "";
say("file:", path, facts);
say("caption:", JSON.stringify(caption));

// 3. A URL Meta can fetch (signed for 6 hours; Meta reads it once while processing).
const { data: signed, error: signErr } = await db.storage.from("videos").createSignedUrl(path, 6 * 3600);
if (signErr) throw new Error(signErr.message);
const head = await fetch(signed.signedUrl, { method: "HEAD" });
say("signed url:", head.status, head.headers.get("content-type"), head.headers.get("content-length"), "bytes");
if (args.includes("--dry")) { say("dry run, stopping before the container"); process.exit(0); }

// 4. Container -> poll -> publish.
const container = await ig(`${igUserId}/media`, { method: "POST", params: { media_type: "REELS", video_url: signed.signedUrl, caption, share_to_feed: "true" } });
say("container:", container.id);
let status;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = await ig(container.id, { params: { fields: "status_code,status" } });
  status = s.status_code;
  say("status:", status, s.status ?? "");
  if (status === "FINISHED" || status === "ERROR" || status === "EXPIRED") break;
}
if (status !== "FINISHED") throw new Error(`container ended as ${status}`);
const published = await ig(`${igUserId}/media_publish`, { method: "POST", params: { creation_id: container.id } });
say("published media id:", published.id);
const media = await ig(published.id, { params: { fields: "id,permalink,media_type,media_product_type,timestamp" } });
say("permalink:", media.permalink, media.media_type, media.media_product_type);
