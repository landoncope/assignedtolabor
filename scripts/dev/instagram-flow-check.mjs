// End-to-end check of Instagram connect + one-tap publish against the mock Instagram
// (scripts/dev/instagram-mock.mjs), through the real pages in this Mac's Chrome.
//   1. node scripts/dev/instagram-mock.mjs                      (port 3998)
//   2. INSTAGRAM_APP_ID=mock-app-id INSTAGRAM_APP_SECRET=mock-app-secret \
//      INSTAGRAM_AUTHORIZE_BASE=http://127.0.0.1:3998 INSTAGRAM_OAUTH_BASE=http://127.0.0.1:3998 \
//      INSTAGRAM_GRAPH_BASE=http://127.0.0.1:3998 NEXT_PUBLIC_TURNSTILE_SITE_KEY= \
//      NEXT_PUBLIC_SITE_URL=http://localhost:3001 npx next build && (same env) npx next start -p 3001
//   3. node scripts/dev/instagram-flow-check.mjs http://localhost:3001 [http://127.0.0.1:3998] [screenshot-dir]
// Uses the Supabase project in .env.local (the live one): a throwaway admin, a
// "Klingon" test team, three small videos; everything is deleted at the end.
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:3001";
const mock = process.argv[3] ?? "http://127.0.0.1:3998";
const MOCK_SECRET = process.env.INSTAGRAM_APP_SECRET ?? "mock-app-secret";
const IG_USER_ID = "17841400000000001";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ts = Date.now();
let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` · ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const video = async (id, cols) => (await db.from("videos").select(cols).eq("id", id).single()).data;
const until = async (fn, ms = 30_000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(1000); } };
const signedRequest = (payload, secret = MOCK_SECRET) => { const p = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", issued_at: Math.floor(Date.now() / 1000), ...payload })).toString("base64url"); return `${createHmac("sha256", secret).update(p).digest("base64url")}.${p}`; };
const postForm = (path, form) => fetch(`${base}${path}`, { method: "POST", body: new URLSearchParams(form) });

const created = { userId: null, userId2: null, userId3: null, areaId: null, videoIds: [], paths: [] };
// The member who gets a reminder email from the site: a real inbox (Resend's test address), since the email is really sent.
const email3 = `delivered+igcheck${ts}@resend.dev`;
const tmp = mkdtempSync(join(tmpdir(), "ig-check-"));
let browser;
try {
  // Preconditions.
  check("app is up", (await fetch(`${base}/`)).ok);
  check("mock is up", (await fetch(`${mock}/__state`)).ok);

  // A throwaway admin, a test team, three small videos.
  const email = `ig-check-${ts}@example.com`;
  const { data: u, error: uErr } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (uErr) throw new Error(uErr.message);
  created.userId = u.user.id;
  await until(async () => (await db.from("profiles").select("id").eq("id", created.userId).maybeSingle()).data, 10_000);
  await db.from("profiles").update({ role: "admin", display_name: "IG Check" }).eq("id", created.userId);
  const { data: area, error: aErr } = await db.from("areas").insert({ name: "Instagram Mock Team", language: "Klingon", is_active: true, sort_order: 999 }).select("id").single();
  if (aErr) throw new Error(aErr.message);
  created.areaId = area.id;
  // The admin is also a member of the team (a team's numbers are shown to its members),
  // and a second member, without a goal, is there for the lead's view and the reminder.
  await db.from("area_members").insert({ area_id: created.areaId, user_id: created.userId });
  const { data: u3, error: u3Err } = await db.auth.admin.createUser({ email: email3, email_confirm: true });
  if (u3Err) throw new Error(u3Err.message);
  created.userId3 = u3.user.id;
  await until(async () => (await db.from("profiles").select("id").eq("id", created.userId3).maybeSingle()).data, 10_000);
  await db.from("profiles").update({ display_name: "Goal Member" }).eq("id", created.userId3);
  await db.from("area_members").insert({ area_id: created.areaId, user_id: created.userId3 });
  const file = join(tmp, "clip.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]);
  const bytes = readFileSync(file);
  const scripts = [
    { hook: "Hook one", body: "A short word about faith.", cta: "Learn more at the link." },
    { hook: "Hook two", body: "MOCKFAIL this one", cta: null },
    { hook: "Hook three", body: "Posted by the cron.", cta: null },
    { hook: "Hook four", body: "Queued but never started; the cron picks it up.", cta: null },
    { hook: "Hook five", body: "Too big for Instagram.", cta: null },
    { hook: "Hook six", body: "File already purged.", cta: null },
    { hook: "Hook seven", body: "Disconnected while in flight.", cta: null },
    { hook: "Hook eight", body: "Picture froze 10 s in (a 2026-09-19 iPhone file).", cta: null },
    { hook: "Hook nine", body: "Instagram rejects the token at post time.", cta: null },
    { hook: "Hook ten", body: "The render fails (test hook), the original is posted instead.", cta: null },
  ];
  for (let i = 0; i < scripts.length; i++) {
    const path = `${created.userId}/mock-${ts}-${i}.mp4`;
    const { error: upErr } = await db.storage.from("videos").upload(path, bytes, { contentType: "video/mp4" });
    if (upErr) throw new Error(upErr.message);
    created.paths.push(path);
    const { data: v, error: vErr } = await db.from("videos").insert({ user_id: created.userId, area_id: created.areaId, language: "Klingon", storage_path: path, file_name: `mock-${i}.mp4`, file_size: bytes.length, mime_type: "video/mp4", duration_seconds: 4, script: scripts[i], uploader_name: `ig-check-${i}`, status: "pending" }).select("id").single();
    if (vErr) throw new Error(vErr.message);
    created.videoIds.push(v.id);
  }
  const [A, B, C, D, E, F, G, H, I, J] = created.videoIds;
  // The render step (2026-11-01). A has timed words, three cues and a headline, like a
  // transcribed video; C has captions off and no headline (the sound is still evened out,
  // the picture copied); E posts the original (render skipped), so its size is checked as
  // before; J's headline trips the test hook (RENDER_TEST_HOOKS=1 in the build) so its render fails.
  const WORDS = [["Hook", 0.5, 0.8], ["one,", 0.85, 1.1], ["a", 1.2, 1.3], ["short", 1.35, 1.6], ["word.", 1.62, 1.8], ["Second", 1.9, 2.3], ["line", 2.35, 2.6], ["here.", 2.65, 2.9], ["Third", 3.05, 3.4], ["one.", 3.45, 3.7]].map(([t, s, e]) => ({ t, s, e }));
  const CUES = [{ s: 0.4, e: 1.88, text: "Hook one, a short word." }, { s: 1.9, e: 3.03, text: "Second line here." }, { s: 3.05, e: 3.95, text: "Third one." }];
  await db.from("videos").update({ transcript: "Hook one, a short word. Second line here. Third one.", transcript_language: "eng", transcript_words: WORDS, caption_cues: CUES, headline: "Mock headline", ai_headline: "Mock headline" }).eq("id", A);
  await db.from("videos").update({ captions_on: false, headline: null }).eq("id", C);
  await db.from("videos").update({ render_state: "skipped" }).eq("id", E);
  await db.from("videos").update({ headline: "RENDERFAIL" }).eq("id", J);
  await db.from("videos").update({ file_size: 400 * 1048576 }).eq("id", E);
  await db.from("videos").update({ storage_path: null, file_purged_at: new Date().toISOString() }).eq("id", F);
  // H looks like one of the frozen event recordings after scripts/dev/picture-backfill.mjs stored its check.
  await db.from("videos").update({ capture_meta: {
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1",
    camera: "1080x1920", recorded: "1080x1920", codec: "video/mp4", fps: 30, zoom: 1.5, zoomMode: "native", clips: 1, merged: false, stalledSeconds: 0, events: [],
    picture: { seconds: 83.9, sound: 83.9, longestHold: 73.4, holdAt: 10.5, audited: "2026-10-21T16:00:00.000Z" },
  } }).eq("id", H);
  const shots = join(process.argv[4] ?? tmp, "shots"); mkdirSync(shots, { recursive: true });

  // Unauthenticated callers.
  check("publish-status without a session is 401", (await fetch(`${base}/api/videos/${A}/publish-status`)).status === 401);
  check("publish cron without the secret is 401", (await fetch(`${base}/api/cron/publish`)).status === 401);

  // Sign the admin in through the same link our emails use.
  const { data: link, error: lErr } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (lErr) throw new Error(lErr.message);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (await browser.newContext()).newPage();
  page.on("pageerror", (err) => console.log(`      page error: ${err.message}`));
  page.on("console", (msg) => { if (msg.type() === "error") console.log(`      console error: ${msg.text().slice(0, 300)}`); });
  await page.goto(`${base}/auth/confirm?token_hash=${link.properties.hashed_token}&type=magiclink&next=/review`);
  await page.waitForURL(/\/review/);
  check("signed in on /review", (await page.textContent("body")).includes("Instagram accounts"));

  // Connect the team's Instagram (mock login -> callback -> back on /review).
  const row = page.locator("#instagram li", { hasText: "Instagram Mock Team" });
  check("team shows as not connected", (await row.textContent()).includes("not connected"));
  await row.getByRole("link", { name: "Connect Instagram" }).click();
  await page.waitForURL(/instagram_connected=/, { timeout: 20_000 });
  check("back on /review with the connected notice", (await page.textContent("body")).includes("Instagram connected as @atl_mock_team"));
  check("team row shows the handle", (await page.locator("#instagram li", { hasText: "Instagram Mock Team" }).textContent()).includes("connected as @atl_mock_team"));
  // The team's usual collaborators (2026-11-01), saved on the row and prefilled on every one-tap post.
  const collabForm = page.locator("#instagram li", { hasText: "Instagram Mock Team" }).locator("form");
  await collabForm.getByPlaceholder("@username, up to 3").fill("@atl_friend, Second.One");
  await collabForm.getByRole("button", { name: "Save" }).click();
  await collabForm.getByText("Saved").waitFor({ timeout: 15_000 });
  const savedCollab = (await db.from("areas").select("instagram_collaborators").eq("id", created.areaId).single()).data?.instagram_collaborators;
  check("the team's usual collaborators are saved lower-case without the @", JSON.stringify(savedCollab) === JSON.stringify(["atl_friend", "second.one"]), JSON.stringify(savedCollab));
  const acct = (await db.from("instagram_accounts").select("*").eq("area_id", created.areaId).maybeSingle()).data;
  check("token stored (long-lived) with the account ids", acct?.access_token?.startsWith("long-") && acct.ig_user_id === IG_USER_ID && acct.username === "atl_mock_team", acct ? `expires ${acct.token_expires_at?.slice(0, 10)} scopes ${acct.scopes?.join(",")}` : "no row");
  const areaRow = (await db.from("areas").select("instagram_user_id, instagram_handle, instagram_connected_at").eq("id", created.areaId).single()).data;
  check("team row carries the connection (no token)", areaRow?.instagram_user_id === IG_USER_ID && areaRow.instagram_handle === "atl_mock_team" && !!areaRow.instagram_connected_at);
  const anonSelect = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY).from("instagram_accounts").select("access_token").limit(1);
  check("tokens are unreadable through the public API", !anonSelect.error && (anonSelect.data ?? []).length === 0, anonSelect.error?.message ?? `${(anonSelect.data ?? []).length} rows`);

  // Dashboard (2026-10-30): the team's Instagram numbers, the upload goal, the lead's view.
  await page.goto(`${base}/my`);
  await page.getByText("Upload goal").waitFor({ timeout: 30_000 });
  const dash = await page.textContent("body");
  check("dashboard shows the team's Instagram numbers from the mock", dash.includes("@atl_mock_team") && dash.includes("1,234") && dash.includes("Followers") && dash.includes("57 likes"), dash.includes("@atl_mock_team") ? "" : dash.slice(0, 300));
  check("dashboard shows the last 30 days' reach and views (insights scope granted)", dash.includes("4,321 accounts reached") && dash.includes("9,876 views"));
  check("dashboard shows the team's own numbers", /10 videos sent to the team in the last 30 days/.test(dash) && /2 people on the team/.test(dash));
  const statsRow = (await db.from("instagram_stats").select("*").eq("area_id", created.areaId).maybeSingle()).data;
  check("numbers are cached in instagram_stats with per-post views", statsRow?.profile?.followers === 1234 && (statsRow.media ?? []).length >= 2 && statsRow.insights?.reach === 4321 && statsRow.media[0].views === 120 && !!statsRow.succeeded_at && !statsRow.error, JSON.stringify(statsRow)?.slice(0, 200));
  const pub = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const statsAnon = await pub.from("instagram_stats").select("*");
  check("the cached numbers are unreadable through the public API", !statsAnon.error && (statsAnon.data ?? []).length === 0, statsAnon.error?.message ?? `${(statsAnon.data ?? []).length} rows`);
  await page.getByRole("button", { name: "Once a week" }).click();
  await page.getByText("Due in 7 days").first().waitFor({ timeout: 20_000 });
  const prof = (await db.from("profiles").select("upload_goal, upload_goal_set_at, goal_reminded_for").eq("id", created.userId).single()).data;
  check("goal saved with its start time and a 7-day countdown", prof?.upload_goal === "weekly" && !!prof.upload_goal_set_at && !prof.goal_reminded_for, JSON.stringify(prof));
  const teamCard = page.locator(`[data-team="${created.areaId}"]`);
  const cardText = await teamCard.textContent();
  check("lead's view lists everyone with their goal and last video", /2 people · 1 with a goal · 0 overdue/.test(cardText) && /IG Check/.test(cardText) && /Once a week · Due in 7 days/.test(cardText) && /Last video today/.test(cardText) && /Goal Member/.test(cardText) && /No goal set/.test(cardText), cardText.slice(0, 400));
  const memberRow = teamCard.locator("li", { hasText: "Goal Member" });
  check("a member's row offers an email link and says there is no phone yet", (await memberRow.locator('a[href^="mailto:"]').count()) === 1 && (await memberRow.getByText("No phone on file").count()) === 1);
  await memberRow.getByRole("button", { name: "Send a reminder from the site" }).click();
  await memberRow.getByPlaceholder(/A line from you/).fill("We miss your videos!");
  await memberRow.getByRole("button", { name: "Send the reminder" }).click();
  await memberRow.getByText(/^Sent to /).waitFor({ timeout: 30_000 });
  const nudge = (await db.from("notifications").select("kind, recipient, area_id, provider_id").eq("kind", "goal_nudge").eq("recipient", email3).order("sent_at", { ascending: false }).limit(1).maybeSingle()).data;
  check("a reminder email went out from the site and was logged", nudge?.area_id === created.areaId && !!nudge.provider_id, JSON.stringify(nudge));
  await memberRow.getByRole("button", { name: "Send a reminder from the site" }).click();
  await memberRow.getByRole("button", { name: "Send the reminder" }).click();
  await memberRow.getByText(/already went to them/).waitFor({ timeout: 20_000 });
  check("a second reminder the same day is refused", true);
  await db.from("profiles").update({ phone: "+1 801 555 0199" }).eq("id", created.userId3);
  await page.reload();
  check("a phone number on file adds a Text link", (await page.locator(`[data-team="${created.areaId}"] li`, { hasText: "Goal Member" }).locator('a[href^="sms:+18015550199"]').count()) === 1);
  // The reminder email: move the clock so the next video is due within the day (the test
  // videos are made older than the goal, so the goal's own start is what counts).
  await db.from("videos").update({ created_at: new Date(Date.now() - 8 * 86400_000).toISOString() }).in("id", created.videoIds);
  await db.from("profiles").update({ upload_goal_set_at: new Date(Date.now() - 7 * 86400_000 + 3600_000).toISOString() }).eq("id", created.userId);
  const plan = await (await fetch(`${base}/api/cron/notify?dry=1`, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } })).json();
  check("the notify sweep plans a goal reminder when the due date is a day away", plan.plan?.some((p) => p.kind === "goal_reminder" && p.to === email), JSON.stringify((plan.plan ?? []).filter((p) => p.kind === "goal_reminder")));
  await page.goto(`${base}/my`);
  check("the dashboard shows the goal as due today", (await page.textContent("body")).includes("Due today"));
  // Numbers older than a few hours are refreshed after a dashboard view (never by a cron).
  await db.from("instagram_stats").update({ fetched_at: new Date(Date.now() - 7 * 3600_000).toISOString() }).eq("area_id", created.areaId);
  await page.goto(`${base}/my`);
  const refreshed = await until(async () => { const r = (await db.from("instagram_stats").select("fetched_at").eq("area_id", created.areaId).single()).data; return r && Date.now() - new Date(r.fetched_at).getTime() < 60_000 ? r : null; }, 20_000);
  check("a dashboard view refreshes numbers older than a few hours, after the response", !!refreshed, refreshed ? "" : "fetched_at not updated");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/my`);
  await page.screenshot({ path: join(shots, "dashboard.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });

  // One tap on a pending video, with the team's usual collaborators prefilled.
  await page.goto(`${base}/review/${A}`);
  const captionBox = page.locator("textarea").first();
  check("caption box is prefilled with the script", (await captionBox.inputValue()).includes("A short word about faith."));
  const collabBox = page.getByPlaceholder("@username, up to 3");
  check("collaborators box is prefilled with the team's usual", (await collabBox.inputValue()) === "@atl_friend, @second.one", await collabBox.inputValue());
  // The captions card: the words to check, the headline, a fix that must be saved before posting.
  check("the captions card shows the lines and the headline", (await page.textContent("body")).includes("Check the words (3 lines") && (await page.getByPlaceholder("A few words at the top, or nothing").inputValue()) === "Mock headline");
  await page.getByText(/^Check the words/).click();
  await page.getByLabel("Caption line 1").fill("Hook one, a fixed word.");
  const noteShown = await page.getByText("Save the captions first").waitFor({ timeout: 5000 }).then(() => true, () => false);
  check("an unsaved fix holds the post button", noteShown && await page.getByRole("button", { name: /Approve and post to @atl_mock_team/ }).isDisabled(), noteShown ? "note shown" : `no note; body: ${(await page.textContent("body")).replace(/\s+/g, " ").slice(0, 300)}`);
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByText("Saved", { exact: true }).waitFor({ timeout: 15_000 });
  const cuesA = (await video(A, "caption_cues, captions_on, headline")).caption_cues;
  check("the fixed line is saved with its timing kept", cuesA?.[0]?.text === "Hook one, a fixed word." && cuesA[0].s === 0.4 && cuesA.length === 3, JSON.stringify(cuesA?.[0]));
  check("the post button is back", !(await page.getByRole("button", { name: /Approve and post to @atl_mock_team/ }).isDisabled()));
  await collabBox.fill("@bad name!");
  await page.getByRole("button", { name: /Approve and post to @atl_mock_team/ }).click();
  await page.getByText(/is not an Instagram username/).waitFor({ timeout: 15_000 });
  check("a bad username is refused before anything is sent", (await video(A, "status")).status === "pending");
  await collabBox.fill("@atl_friend, @second.one");
  await fetch(`${mock}/__config?nocollab=1`);
  await page.getByRole("button", { name: /Approve and post to @atl_mock_team/ }).click();
  await page.getByText("Not posted:").waitFor({ timeout: 40_000 });
  check("Instagram refusing the invite shows its reason and the hint", /Invalid parameter: collaborators[\s\S]*clear the collaborators box/.test(await page.textContent("body")));
  await page.getByRole("button", { name: /Try again on @atl_mock_team/ }).click();
  // The rendered file is current, so the retry goes straight to Instagram (the page's "Not posted" from the refusal is still on screen for a moment).
  const started = await until(async () => { const s = (await video(A, "publish_state")).publish_state; return s === "processing" || s === "published" ? s : null; }, 40_000);
  check("post goes in flight", !!started, started ?? JSON.stringify(await video(A, "publish_state, publish_error, render_state, render_error")));
  await page.getByText(/^Posted /).waitFor({ timeout: 40_000 });
  const openPost = await page.getByRole("link", { name: "Open post" }).getAttribute("href");
  check("page shows Posted with the permalink", /instagram\.com\/reel\/MOCK/.test(openPost ?? ""), openPost ?? "");
  const vA = await video(A, "status, publish_state, post_url, post_media_id, post_caption, posted_by, reviewed_by, publish_attempts, post_collaborators");
  check("video A is posted in the database", vA?.status === "posted" && vA.publish_state === "published" && !!vA.post_media_id && vA.posted_by === created.userId && vA.reviewed_by === created.userId, JSON.stringify(vA));
  check("caption posted is the script", vA?.post_caption === "Hook one\n\nA short word about faith.\n\nLearn more at the link.");
  check("collaborators stored with the post", JSON.stringify(vA?.post_collaborators) === JSON.stringify(["atl_friend", "second.one"]), JSON.stringify(vA?.post_collaborators));
  const mockState = await (await fetch(`${mock}/__state`)).json();
  const rA = await video(A, "render_state, render_path, render_key, render_meta, render_attempts");
  check("mock fetched the signed file URL of the rendered file in full", mockState.fetched.some((f) => f.status === 200 && Number(f.length) === rA?.render_meta?.bytes), JSON.stringify({ fetched: mockState.fetched[0], rendered: rA?.render_meta?.bytes }));
  const cA = mockState.containers.find((c) => /^Hook one/.test(c.caption));
  check("mock received the collaborator invites with the container", JSON.stringify(cA?.collaborators) === JSON.stringify(["atl_friend", "second.one"]), JSON.stringify(cA));
  check("posted card names the invitees", (await page.textContent("body")).includes("Collaborator invite sent to @atl_friend, @second.one"));
  // The render: the captions and the headline were drawn into a new file, and that file is what Instagram fetched.
  check("video A was rendered with its three cues and the headline", rA?.render_state === "done" && /-captioned\.mp4$/.test(rA.render_path ?? "") && rA.render_meta?.cues === 3 && rA.render_meta?.headline === true && rA.render_meta?.videoCopied === false && rA.render_meta?.bytes > 1000 && rA.render_meta?.width === 360 && rA.render_meta?.height === 640, JSON.stringify(rA?.render_meta));
  check("the loudness was measured and normalised", typeof rA?.render_meta?.loudness?.input === "number" && rA.render_meta.loudness.target === -16, JSON.stringify(rA?.render_meta?.loudness));
  check("Instagram fetched the rendered file, not the original", mockState.fetched.some((f) => /-captioned\.mp4/.test(f.url)), JSON.stringify(mockState.fetched.map((f) => f.url.split("/").pop())));
  check("posted card says the captions and the headline were drawn in", (await page.textContent("body")).includes("The captions and the headline were drawn into the posted video."));
  // Look at a frame: the caption box and the headline box darken their regions of the test pattern.
  const { data: signedA } = await db.storage.from("videos").createSignedUrl(rA.render_path, 600);
  const renderedA = join(tmp, "rendered-a.mp4");
  writeFileSync(renderedA, Buffer.from(await (await fetch(signedA.signedUrl)).arrayBuffer()));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "2", "-i", file, "-frames:v", "1", join(tmp, "orig.png")]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", "2", "-i", renderedA, "-frames:v", "1", join(tmp, "rendered.png")]);
  execFileSync("cp", [join(tmp, "rendered.png"), join(shots, "rendered-frame.png")]);
  const lum = execFileSync("python3", ["-c", "import sys\nfrom PIL import Image, ImageStat\no = Image.open(sys.argv[1]).convert('L'); r = Image.open(sys.argv[2]).convert('L')\nm = lambda i, b: ImageStat.Stat(i.crop(b)).mean[0]\ncap = (90, 466, 270, 495); head = (90, 70, 270, 104)\nprint(round(m(o, cap)), round(m(r, cap)), round(m(o, head)), round(m(r, head)))", join(tmp, "orig.png"), join(tmp, "rendered.png")]).toString().trim().split(" ").map(Number);
  check("the caption box darkens its region of the frame at 2 s", lum[0] > 30 && lum[1] < 0.8 * lum[0], `original ${lum[0]}, rendered ${lum[1]}`);
  check("the headline box darkens its region at the top", lum[2] > 30 && lum[3] < 0.8 * lum[2], `original ${lum[2]}, rendered ${lum[3]}`);

  // A file Instagram refuses: the page says why and offers a retry; the video stays approved.
  await page.goto(`${base}/review/${B}`);
  await page.getByRole("button", { name: /Approve and post to @atl_mock_team/ }).click();
  await page.getByText("Not posted:").waitFor({ timeout: 40_000 });
  const bodyB = await page.textContent("body");
  check("failure reason shown", bodyB.includes("The video format is not supported"));
  check("retry offered", await page.getByRole("button", { name: /Try again on @atl_mock_team/ }).isVisible());
  check("manual fallback offered", bodyB.includes("Post it by hand instead"));
  const vB = await video(B, "status, publish_state, publish_error, publish_attempts");
  check("video B stays approved with the error", vB?.status === "approved" && vB.publish_state === "failed" && /not supported/.test(vB.publish_error ?? "") && vB.publish_attempts === 1, JSON.stringify(vB));

  // The render fails: the post fails with the reason, and the lead can post the original file instead.
  await page.goto(`${base}/review/${J}`);
  await page.getByRole("button", { name: /Approve and post to @atl_mock_team/ }).click();
  await page.getByText("Not posted:").waitFor({ timeout: 40_000 });
  const bodyJ = await page.textContent("body");
  check("a failed render fails the post with its reason", bodyJ.includes("Could not add the captions to the video") && bodyJ.includes("test hook"));
  const vJ = await video(J, "status, publish_state, render_state, render_error, render_attempts");
  check("video J stays approved, render failed and counted", vJ?.status === "approved" && vJ.publish_state === "failed" && vJ.render_state === "failed" && /test hook/.test(vJ.render_error ?? "") && vJ.render_attempts === 1, JSON.stringify(vJ));
  await page.getByRole("button", { name: /Post the original file instead/ }).click();
  await page.getByText(/^Posted /).waitFor({ timeout: 40_000 });
  const vJ2 = await video(J, "status, render_state, post_media_id");
  check("the original file was posted instead", vJ2?.status === "posted" && vJ2.render_state === "skipped" && !!vJ2.post_media_id && !(await (await fetch(`${mock}/__state`)).json()).fetched.some((f) => /mock-.*-9-captioned/.test(f.url)), JSON.stringify(vJ2));

  // The lead leaves the page: the cron finishes the post.
  await page.goto(`${base}/review/${C}`);
  await page.getByRole("button", { name: /Approve and post to @atl_mock_team/ }).click();
  await page.getByText("Sending to Instagram").waitFor({ timeout: 15_000 });
  await page.goto(`${base}/review`);
  // Scoped to this run's own rows: the local build reads the LIVE database, where real
  // posts may be in flight and real tokens must never meet the mock.
  const cron = () => fetch(`${base}/api/cron/publish?only=${created.videoIds.join(",")}&area=${created.areaId}`, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }).then((r) => r.json());
  const run1 = await cron();
  check("cron run 1 sees the processing post", run1.posts?.some((p) => p.id === C && p.before === "processing"), JSON.stringify(run1).slice(0, 200));
  const run2 = await cron();
  const vC = await video(C, "status, publish_state, post_url");
  check("cron run 2 publishes it", vC?.status === "posted" && vC.publish_state === "published" && /MOCK/.test(vC.post_url ?? ""), JSON.stringify({ vC, run2: run2.posts }));
  const rC = await video(C, "render_state, render_meta");
  check("with captions off and no headline the picture was copied and only the sound evened out", rC?.render_state === "done" && rC.render_meta?.cues === 0 && rC.render_meta?.headline === false && rC.render_meta?.videoCopied === true, JSON.stringify(rC?.render_meta));
  check("cron reports no token work yet", Array.isArray(run2.tokens) && run2.tokens.length === 0, JSON.stringify(run2.tokens));

  // Token refresh: a token close to expiry and old enough is refreshed by the cron.
  const before = (await db.from("instagram_accounts").select("access_token").eq("area_id", created.areaId).single()).data?.access_token;
  // checked_at = now keeps production's daily probe (real Instagram) away from this mock token while connected_at is backdated.
  await db.from("instagram_accounts").update({ token_expires_at: new Date(Date.now() + 5 * 86400_000).toISOString(), connected_at: new Date(Date.now() - 2 * 86400_000).toISOString(), refreshed_at: null, checked_at: new Date().toISOString() }).eq("area_id", created.areaId);
  const runR = await cron();
  const afterR = (await db.from("instagram_accounts").select("access_token, token_expires_at, refreshed_at, last_error").eq("area_id", created.areaId).single()).data;
  const daysLeft = afterR ? (new Date(afterR.token_expires_at) - Date.now()) / 86400_000 : 0;
  check("cron refreshes a token near expiry", /^refreshed until/.test(runR.tokens?.[0]?.result ?? "") && afterR?.access_token !== before && daysLeft > 58 && !!afterR.refreshed_at && !afterR.last_error, JSON.stringify({ tokens: runR.tokens, daysLeft: Math.round(daysLeft) }));
  const runR2 = await cron();
  check("a fresh token is left alone", (runR2.tokens ?? []).length === 0, JSON.stringify(runR2.tokens));

  // The daily probe of each connection (2026-10-30, after all four real tokens were found
  // dead): a connection probed within the day is skipped; a healthy one is noted; a
  // rejected token is forgotten, the loss written on the team, the leads (admins here,
  // the team has none) told once, and Connect clears the loss.
  check("a connection probed within the day is left alone", (runR2.connections ?? []).length === 0, JSON.stringify(runR2.connections));
  await db.from("instagram_accounts").update({ checked_at: new Date(Date.now() - 2 * 86400_000).toISOString() }).eq("area_id", created.areaId);
  const runP1 = await cron();
  check("the probe finds a healthy connection and notes the check", /^ok/.test(runP1.connections?.[0]?.result ?? "") && Date.now() - new Date((await db.from("instagram_accounts").select("checked_at").eq("area_id", created.areaId).single()).data?.checked_at ?? 0).getTime() < 60_000, JSON.stringify(runP1.connections));
  await db.from("instagram_accounts").update({ checked_at: new Date(Date.now() - 2 * 86400_000).toISOString() }).eq("area_id", created.areaId);
  await fetch(`${mock}/__config?deadtoken=1`);
  const runP2 = await cron();
  const lostArea = (await db.from("areas").select("instagram_user_id, instagram_lost_at, instagram_lost_reason, instagram_lost_notified_at").eq("id", created.areaId).single()).data;
  check("the probe forgets a rejected token and records why on the team", /rejected/.test(runP2.connections?.[0]?.result ?? "") && !(await db.from("instagram_accounts").select("area_id").eq("area_id", created.areaId).maybeSingle()).data && lostArea?.instagram_user_id === null && !!lostArea.instagram_lost_at && /no longer accepts our connection to @atl_mock_team/.test(lostArea.instagram_lost_reason ?? "") && !lostArea.instagram_lost_notified_at, JSON.stringify({ run: runP2.connections, lostArea }));
  const planL = await (await fetch(`${base}/api/cron/notify?dry=1`, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } })).json();
  // Marked told at once: production's own sweep must not email the real admins about the mock team.
  await db.from("areas").update({ instagram_lost_notified_at: new Date().toISOString() }).eq("id", created.areaId);
  check("the notify sweep plans to tell the team to connect again", planL.plan?.some((p) => p.kind === "instagram_lost" && p.to === email && /Instagram disconnected the Instagram Mock Team/.test(p.subject)), JSON.stringify((planL.plan ?? []).filter((p) => p.kind === "instagram_lost" && p.to === email)));
  await page.goto(`${base}/review`);
  const lostRow = page.locator("#instagram li", { hasText: "Instagram Mock Team" });
  check("the Review page shows why the connection ended", /Instagram ended the connection on/.test(await lostRow.textContent()));
  await lostRow.getByRole("link", { name: "Connect Instagram" }).click();
  await page.waitForURL(/instagram_connected=/, { timeout: 20_000 });
  const relinked = (await db.from("areas").select("instagram_lost_at, instagram_lost_reason, instagram_lost_notified_at").eq("id", created.areaId).single()).data;
  check("connecting again clears the loss", !!(await db.from("instagram_accounts").select("area_id").eq("area_id", created.areaId).maybeSingle()).data && relinked?.instagram_lost_at === null && relinked.instagram_lost_reason === null && relinked.instagram_lost_notified_at === null, JSON.stringify(relinked));

  // A signed-in member who leads nothing cannot read the publish status.
  const email2 = `ig-check-member-${ts}@example.com`;
  const { data: u2 } = await db.auth.admin.createUser({ email: email2, email_confirm: true });
  created.userId2 = u2.user.id;
  await until(async () => (await db.from("profiles").select("id").eq("id", created.userId2).maybeSingle()).data, 10_000);
  const { data: link2 } = await db.auth.admin.generateLink({ type: "magiclink", email: email2 });
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  await page2.goto(`${base}/auth/confirm?token_hash=${link2.properties.hashed_token}&type=magiclink&next=/my`);
  await page2.waitForURL(/\/my/);
  const status2 = (await page2.request.get(`${base}/api/videos/${A}/publish-status`)).status();
  check("publish-status for a lead of no team is 403", status2 === 403, `got ${status2}`);
  await ctx2.close();

  // Files Instagram would refuse are stopped before any request: too large, already purged.
  await page.goto(`${base}/review/${E}`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(shots, "pending-phone.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  const containersBefore = (await (await fetch(`${mock}/__state`)).json()).containers.length;
  await page.getByRole("button", { name: /Approve and post to @atl_mock_team/ }).click();
  await page.getByText("Not posted:").waitFor({ timeout: 20_000 });
  const vE = await video(E, "status, publish_state, publish_error");
  check("oversize file is refused before asking Instagram", vE?.status === "approved" && vE.publish_state === "failed" && /400 MB/.test(vE.publish_error ?? "") && (await (await fetch(`${mock}/__state`)).json()).containers.length === containersBefore, vE?.publish_error ?? "");
  await page.goto(`${base}/review/${F}`);
  await page.getByRole("button", { name: /Approve and post to @atl_mock_team/ }).click();
  await page.getByText("Not posted:").waitFor({ timeout: 20_000 });
  const vF = await video(F, "publish_state, publish_error");
  check("purged file is refused with a plain reason", vF?.publish_state === "failed" && /already been deleted/.test(vF.publish_error ?? ""), vF?.publish_error ?? "");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(shots, "failed-phone.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  // A recording whose picture froze (the iPhone files of 2026-09-19): the page offers no
  // one-tap button and says why; the server refuses it before any request even when queued by hand.
  await page.goto(`${base}/review/${H}`);
  const bodyH = await page.textContent("body");
  check("frozen recording has no one-tap button and says why", (await page.getByRole("button", { name: /Approve and post/ }).count()) === 0 && /picture freezes 0:11 in and stays frozen for 73 s/.test(bodyH) && /record again/.test(bodyH) && /check of the stored file on 2026-10-21/.test(bodyH));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(shots, "frozen-phone.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await db.from("videos").update({ status: "approved", reviewed_by: created.userId, reviewed_at: new Date().toISOString(), publish_state: "queued", publish_requested_at: new Date().toISOString(), publish_requested_by: created.userId }).eq("id", H);
  const containersBeforeH = (await (await fetch(`${mock}/__state`)).json()).containers.length;
  await cron();
  const vH = await video(H, "publish_state, publish_error");
  check("frozen recording is refused before asking Instagram", vH?.publish_state === "failed" && /freezes 0:11 in/.test(vH.publish_error ?? "") && (await (await fetch(`${mock}/__state`)).json()).containers.length === containersBeforeH, vH?.publish_error ?? "");

  // A post that was queued but never started (the action died mid-way): the cron starts and finishes it.
  await db.from("videos").update({ status: "approved", reviewed_by: created.userId, reviewed_at: new Date().toISOString(), publish_state: "queued", publish_requested_at: new Date().toISOString(), publish_requested_by: created.userId }).eq("id", D);
  const q1 = await cron();
  check("cron queues the render for a queued post", q1.posts?.some((p) => p.id === D && p.before === "queued" && p.after?.rendering === true) && (await video(D, "render_state")).render_state === "queued", JSON.stringify(q1.posts));
  const q2 = await cron();
  check("the next run renders it and starts the post", q2.renders?.some((r) => r.id === D && /^rendered \(0 cues/.test(r.result) && /post processing/.test(r.result)), JSON.stringify(q2.renders));
  await cron(); // IN_PROGRESS
  await cron(); // FINISHED -> published
  const vD = await video(D, "status, publish_state, post_url, posted_by");
  check("cron finishes the queued post", vD?.status === "posted" && vD.publish_state === "published" && /MOCK/.test(vD.post_url ?? "") && vD.posted_by === created.userId, JSON.stringify(vD));

  // The team's account is disconnected while a post is in flight: the post fails with a reason.
  await page.goto(`${base}/review/${G}`);
  await page.getByRole("button", { name: /Approve and post to @atl_mock_team/ }).click();
  await page.getByText("Sending to Instagram").waitFor({ timeout: 15_000 });
  await page.goto(`${base}/review`);
  await db.from("instagram_accounts").delete().eq("area_id", created.areaId);
  await db.from("areas").update({ instagram_user_id: null, instagram_connected_at: null }).eq("id", created.areaId);
  await cron();
  const vG = await video(G, "status, publish_state, publish_error");
  check("disconnect mid-post fails the post with a reason", vG?.status === "approved" && vG.publish_state === "failed" && /disconnected/.test(vG.publish_error ?? ""), JSON.stringify(vG));
  await page.goto(`${base}/review/${G}`);
  check("a failed post on a team with no account shows the manual flow and a connect link", (await page.textContent("body")).includes("connect this team") && (await page.getByRole("button", { name: "I posted it myself" }).isVisible()));
  // Posting by hand gets the rendered file too (2026-11-01): G was rendered before its post, so
  // the download is the captioned copy; once the render is stale the page offers to prepare it.
  check("the by-hand flow says the download has the sound evened out", (await page.textContent("body")).includes("The download has the sound evened out"));
  const [dlG] = await Promise.all([page.waitForEvent("download", { timeout: 20_000 }), page.getByRole("button", { name: "Download video" }).click()]);
  check("the by-hand download is the rendered file", /-captioned\.mp4$/.test(dlG.suggestedFilename()), dlG.suggestedFilename());
  await db.from("videos").update({ render_state: null, render_path: null, render_key: null }).eq("id", G);
  await page.goto(`${base}/review/${G}`);
  check("without a current render the by-hand flow offers to prepare the captioned video", await page.getByRole("button", { name: "prepare the captioned video" }).isVisible());
  await page.getByRole("button", { name: "prepare the captioned video" }).click();
  const preparedG = await until(async () => (await video(G, "render_state")).render_state === "done" ? true : null, 60_000);
  await page.getByText("The download has the sound evened out").waitFor({ timeout: 20_000 });
  check("preparing renders it and the page offers the captioned download", preparedG === true && (await page.textContent("body")).includes("The download has the sound evened out"));

  // Marking a video posted by hand asks first (on 2026-10-29 a lead took "Mark as posted"
  // for the post button while the connection was dead), and a video marked by mistake
  // can be moved back to Ready to post while its file is still there.
  await page.getByRole("button", { name: "I posted it myself" }).click();
  check("marking posted by hand asks whether it is really on Instagram", (await page.textContent("body")).includes("Is it live on Instagram already"));
  await page.getByRole("button", { name: "Not yet" }).click();
  check("Not yet leaves the video approved", (await video(G, "status")).status === "approved" && await page.getByRole("button", { name: "I posted it myself" }).isVisible());
  await page.getByRole("button", { name: "I posted it myself" }).click();
  await page.getByRole("button", { name: /^Yes, it/ }).click();
  await page.getByText(/^Marked as posted by hand/).waitFor({ timeout: 15_000 });
  const vG2 = await video(G, "status, post_media_id, post_url, posted_by");
  check("marked posted by hand, with no post id and no link", vG2?.status === "posted" && !vG2.post_media_id && !vG2.post_url && vG2.posted_by === created.userId, JSON.stringify(vG2));
  await db.from("videos").update({ uploader_notified_status: "posted" }).eq("id", G); // as if the sweep had told the uploader
  await page.getByRole("button", { name: /Not actually posted/ }).click();
  await page.getByRole("button", { name: "Move it back" }).click();
  await page.getByText("Post it", { exact: true }).waitFor({ timeout: 15_000 });
  const vG3 = await video(G, "status, posted_at, posted_by, post_url, publish_state, publish_error, uploader_notified_status, reviewed_by");
  check("moved back to Ready to post with the posting bookkeeping cleared", vG3?.status === "approved" && !vG3.posted_at && !vG3.posted_by && !vG3.publish_state && !vG3.publish_error && !vG3.uploader_notified_status && vG3.reviewed_by === created.userId, JSON.stringify(vG3));
  await db.from("videos").update({ file_purged_at: new Date().toISOString() }).eq("id", A);
  await page.goto(`${base}/review/${A}`);
  check("a posted video whose file is purged offers no way back", (await page.textContent("body")).includes("Posted ") && (await page.getByRole("button", { name: /Not actually posted/ }).count()) === 0);
  await db.from("videos").update({ file_purged_at: null }).eq("id", A);

  // Instagram answers the callback with a code it then rejects: the lead sees Instagram's message.
  await page.goto(`${base}/review`);
  await fetch(`${mock}/__config?badcode=1`);
  await page.locator("#instagram li", { hasText: "Instagram Mock Team" }).getByRole("link", { name: "Connect Instagram" }).click();
  await page.waitForURL(/instagram_error=/, { timeout: 20_000 });
  check("a rejected code shows Instagram's message", /Invalid authorization code/.test(new URL(page.url()).searchParams.get("instagram_error") ?? ""), new URL(page.url()).searchParams.get("instagram_error") ?? "");
  await page.locator("#instagram li", { hasText: "Instagram Mock Team" }).getByRole("link", { name: "Connect Instagram" }).click();
  await page.waitForURL(/instagram_connected=/, { timeout: 20_000 });
  check("reconnected after the failure", !!(await db.from("instagram_accounts").select("area_id").eq("area_id", created.areaId).maybeSingle()).data);

  // Instagram rejects the stored token at post time (code 190: the account's password changed
  // or Instagram ended the session; the English team, 2026-10-27): the post fails with
  // "connect again", the dead connection is forgotten, and the page offers Connect.
  await fetch(`${mock}/__config?deadtoken=1`);
  await page.goto(`${base}/review/${I}`);
  await page.getByRole("button", { name: /Approve and post to @atl_mock_team/ }).click();
  await page.getByText("Not posted:").waitFor({ timeout: 20_000 });
  const vI = await video(I, "status, publish_state, publish_error");
  await page.goto(`${base}/review/${I}`);
  const bodyI = await page.textContent("body");
  check("a rejected token fails the post, says to connect again, and forgets the connection", vI?.status === "approved" && vI.publish_state === "failed" && /no longer accepts our connection to @atl_mock_team/.test(vI.publish_error ?? "") && /Connect the account again/.test(vI.publish_error ?? "") && !(await db.from("instagram_accounts").select("area_id").eq("area_id", created.areaId).maybeSingle()).data && (await db.from("areas").select("instagram_user_id").eq("id", created.areaId).single()).data?.instagram_user_id === null && bodyI.includes("connect this team"), vI?.publish_error ?? "");
  await page.goto(`${base}/review`);
  await page.locator("#instagram li", { hasText: "Instagram Mock Team" }).getByRole("link", { name: "Connect Instagram" }).click();
  await page.waitForURL(/instagram_connected=/, { timeout: 20_000 });
  check("reconnected after the rejected token", !!(await db.from("instagram_accounts").select("area_id").eq("area_id", created.areaId).maybeSingle()).data);

  // Callback hygiene.
  await page.goto(`${base}/api/instagram/callback?code=x&state=bad`);
  const notice = () => new URL(page.url()).searchParams.get("instagram_error") ?? "";
  check("stale callback is refused with a notice", /stale/i.test(notice()), notice());
  await page.goto(`${base}/api/instagram/callback?error=access_denied&error_description=The+user+denied+your+request.`);
  check("denied login shows Instagram's reason", /denied your request/.test(notice()), notice());

  // Deauthorize and data deletion callbacks from Meta.
  const bad = await postForm("/api/instagram/deauthorize", { signed_request: signedRequest({ user_id: IG_USER_ID }, "wrong-secret") });
  check("deauthorize with a bad signature is 400", bad.status === 400);
  const deauth = await postForm("/api/instagram/deauthorize", { signed_request: signedRequest({ user_id: IG_USER_ID }) });
  const afterDeauth = (await db.from("instagram_accounts").select("area_id").eq("area_id", created.areaId).maybeSingle()).data;
  const areaAfter = (await db.from("areas").select("instagram_user_id, instagram_handle").eq("id", created.areaId).single()).data;
  check("deauthorize removes the token and clears the team", deauth.status === 200 && !afterDeauth && areaAfter?.instagram_user_id === null && areaAfter.instagram_handle === "atl_mock_team", JSON.stringify({ status: deauth.status, areaAfter }));
  await page.goto(`${base}/review`);
  await page.locator("#instagram li", { hasText: "Instagram Mock Team" }).getByRole("link", { name: "Connect Instagram" }).click();
  await page.waitForURL(/instagram_connected=/, { timeout: 20_000 });
  const del = await postForm("/api/instagram/data-deletion", { signed_request: signedRequest({ user_id: IG_USER_ID }) });
  const delJson = await del.json();
  const afterDel = (await db.from("instagram_accounts").select("area_id").eq("area_id", created.areaId).maybeSingle()).data;
  check("data deletion removes the token and answers Meta's format", del.status === 200 && /^atl-/.test(delJson.confirmation_code ?? "") && /\/privacy$/.test(delJson.url ?? "") && !afterDel, JSON.stringify(delJson));

  // Disconnect from the page (reconnect first).
  await page.goto(`${base}/review`);
  await page.locator("#instagram li", { hasText: "Instagram Mock Team" }).getByRole("link", { name: "Connect Instagram" }).click();
  await page.waitForURL(/instagram_connected=/, { timeout: 20_000 });
  const li = page.locator("#instagram li", { hasText: "Instagram Mock Team" });
  await li.getByRole("button", { name: "Disconnect" }).click();
  await li.getByRole("button", { name: "Disconnect" }).click();
  await until(async () => (await li.textContent()).includes("not connected"), 15_000);
  check("disconnect from the page", (await li.textContent()).includes("not connected") && !(await db.from("instagram_accounts").select("area_id").eq("area_id", created.areaId).maybeSingle()).data);
} catch (e) {
  failed++;
  console.log(`FAIL  threw: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  try { const pages = browser?.contexts().flatMap((c) => c.pages()) ?? []; for (const [i, pg] of pages.entries()) { await pg.screenshot({ path: join(process.argv[4] ?? tmp, `shots/threw-${i}.png`), fullPage: true }); console.log(`      page ${i}: ${pg.url()}`); } } catch { /* no screenshot */ }
} finally {
  await browser?.close().catch(() => {});
  if (created.videoIds.length) await db.from("videos").delete().in("id", created.videoIds);
  if (created.paths.length) await db.storage.from("videos").remove(created.paths);
  if (created.userId) { const { data: left } = await db.storage.from("videos").list(created.userId, { limit: 100 }); const names = (left ?? []).map((f) => `${created.userId}/${f.name}`); if (names.length) await db.storage.from("videos").remove(names); }
  if (created.areaId) await db.from("areas").delete().eq("id", created.areaId);
  if (created.userId) await db.auth.admin.deleteUser(created.userId);
  if (created.userId2) await db.auth.admin.deleteUser(created.userId2);
  if (created.userId3) await db.auth.admin.deleteUser(created.userId3);
  await db.from("notifications").delete().eq("kind", "goal_nudge").eq("recipient", email3);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
