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
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

const created = { userId: null, userId2: null, areaId: null, videoIds: [], paths: [] };
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
  const [A, B, C, D, E, F, G] = created.videoIds;
  await db.from("videos").update({ file_size: 400 * 1048576 }).eq("id", E);
  await db.from("videos").update({ storage_path: null, file_purged_at: new Date().toISOString() }).eq("id", F);
  const shots = join(process.argv[4] ?? tmp, "shots"); mkdirSync(shots, { recursive: true });

  // Unauthenticated callers.
  check("publish-status without a session is 401", (await fetch(`${base}/api/videos/${A}/publish-status`)).status === 401);
  check("publish cron without the secret is 401", (await fetch(`${base}/api/cron/publish`)).status === 401);

  // Sign the admin in through the same link our emails use.
  const { data: link, error: lErr } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (lErr) throw new Error(lErr.message);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (await browser.newContext()).newPage();
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
  const acct = (await db.from("instagram_accounts").select("*").eq("area_id", created.areaId).maybeSingle()).data;
  check("token stored (long-lived) with the account ids", acct?.access_token?.startsWith("long-") && acct.ig_user_id === IG_USER_ID && acct.username === "atl_mock_team", acct ? `expires ${acct.token_expires_at?.slice(0, 10)} scopes ${acct.scopes?.join(",")}` : "no row");
  const areaRow = (await db.from("areas").select("instagram_user_id, instagram_handle, instagram_connected_at").eq("id", created.areaId).single()).data;
  check("team row carries the connection (no token)", areaRow?.instagram_user_id === IG_USER_ID && areaRow.instagram_handle === "atl_mock_team" && !!areaRow.instagram_connected_at);
  const anonSelect = await createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY).from("instagram_accounts").select("access_token").limit(1);
  check("tokens are unreadable through the public API", !anonSelect.error && (anonSelect.data ?? []).length === 0, anonSelect.error?.message ?? `${(anonSelect.data ?? []).length} rows`);

  // One tap on a pending video.
  await page.goto(`${base}/review/${A}`);
  const captionBox = page.locator("textarea").first();
  check("caption box is prefilled with the script", (await captionBox.inputValue()).includes("A short word about faith."));
  await page.getByRole("button", { name: /Approve and post to @atl_mock_team/ }).click();
  await page.getByText("Sending to Instagram").waitFor({ timeout: 15_000 });
  check("post goes in flight", true);
  await page.getByText(/^Posted /).waitFor({ timeout: 40_000 });
  const openPost = await page.getByRole("link", { name: "Open post" }).getAttribute("href");
  check("page shows Posted with the permalink", /instagram\.com\/reel\/MOCK/.test(openPost ?? ""), openPost ?? "");
  const vA = await video(A, "status, publish_state, post_url, post_media_id, post_caption, posted_by, reviewed_by, publish_attempts");
  check("video A is posted in the database", vA?.status === "posted" && vA.publish_state === "published" && !!vA.post_media_id && vA.posted_by === created.userId && vA.reviewed_by === created.userId, JSON.stringify(vA));
  check("caption posted is the script", vA?.post_caption === "Hook one\n\nA short word about faith.\n\nLearn more at the link.");
  const mockState = await (await fetch(`${mock}/__state`)).json();
  check("mock fetched the signed file URL", mockState.fetched.some((f) => f.status === 200 && Number(f.length) === bytes.length), JSON.stringify(mockState.fetched[0]));

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

  // The lead leaves the page: the cron finishes the post.
  await page.goto(`${base}/review/${C}`);
  await page.getByRole("button", { name: /Approve and post to @atl_mock_team/ }).click();
  await page.getByText("Sending to Instagram").waitFor({ timeout: 15_000 });
  await page.goto(`${base}/review`);
  const cron = () => fetch(`${base}/api/cron/publish`, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }).then((r) => r.json());
  const run1 = await cron();
  check("cron run 1 sees the processing post", run1.posts?.some((p) => p.id === C && p.before === "processing"), JSON.stringify(run1).slice(0, 200));
  const run2 = await cron();
  const vC = await video(C, "status, publish_state, post_url");
  check("cron run 2 publishes it", vC?.status === "posted" && vC.publish_state === "published" && /MOCK/.test(vC.post_url ?? ""), JSON.stringify({ vC, run2: run2.posts }));
  check("cron reports no token work yet", Array.isArray(run2.tokens) && run2.tokens.length === 0, JSON.stringify(run2.tokens));

  // Token refresh: a token close to expiry and old enough is refreshed by the cron.
  const before = (await db.from("instagram_accounts").select("access_token").eq("area_id", created.areaId).single()).data?.access_token;
  await db.from("instagram_accounts").update({ token_expires_at: new Date(Date.now() + 5 * 86400_000).toISOString(), connected_at: new Date(Date.now() - 2 * 86400_000).toISOString(), refreshed_at: null }).eq("area_id", created.areaId);
  const runR = await cron();
  const afterR = (await db.from("instagram_accounts").select("access_token, token_expires_at, refreshed_at, last_error").eq("area_id", created.areaId).single()).data;
  const daysLeft = afterR ? (new Date(afterR.token_expires_at) - Date.now()) / 86400_000 : 0;
  check("cron refreshes a token near expiry", /^refreshed until/.test(runR.tokens?.[0]?.result ?? "") && afterR?.access_token !== before && daysLeft > 58 && !!afterR.refreshed_at && !afterR.last_error, JSON.stringify({ tokens: runR.tokens, daysLeft: Math.round(daysLeft) }));
  const runR2 = await cron();
  check("a fresh token is left alone", (runR2.tokens ?? []).length === 0, JSON.stringify(runR2.tokens));

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

  // A post that was queued but never started (the action died mid-way): the cron starts and finishes it.
  await db.from("videos").update({ status: "approved", reviewed_by: created.userId, reviewed_at: new Date().toISOString(), publish_state: "queued", publish_requested_at: new Date().toISOString(), publish_requested_by: created.userId }).eq("id", D);
  const q1 = await cron();
  check("cron starts a queued post", q1.posts?.some((p) => p.id === D && p.before === "queued" && p.after?.state === "processing"), JSON.stringify(q1.posts));
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
  check("a failed post on a team with no account shows the manual flow and a connect link", (await page.textContent("body")).includes("connect this team") && (await page.getByRole("button", { name: "Mark as posted" }).isVisible()));

  // Instagram answers the callback with a code it then rejects: the lead sees Instagram's message.
  await page.goto(`${base}/review`);
  await fetch(`${mock}/__config?badcode=1`);
  await page.locator("#instagram li", { hasText: "Instagram Mock Team" }).getByRole("link", { name: "Connect Instagram" }).click();
  await page.waitForURL(/instagram_error=/, { timeout: 20_000 });
  check("a rejected code shows Instagram's message", /Invalid authorization code/.test(new URL(page.url()).searchParams.get("instagram_error") ?? ""), new URL(page.url()).searchParams.get("instagram_error") ?? "");
  await page.locator("#instagram li", { hasText: "Instagram Mock Team" }).getByRole("link", { name: "Connect Instagram" }).click();
  await page.waitForURL(/instagram_connected=/, { timeout: 20_000 });
  check("reconnected after the failure", !!(await db.from("instagram_accounts").select("area_id").eq("area_id", created.areaId).maybeSingle()).data);

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
} finally {
  await browser?.close().catch(() => {});
  if (created.videoIds.length) await db.from("videos").delete().in("id", created.videoIds);
  if (created.paths.length) await db.storage.from("videos").remove(created.paths);
  if (created.areaId) await db.from("areas").delete().eq("id", created.areaId);
  if (created.userId) await db.auth.admin.deleteUser(created.userId);
  if (created.userId2) await db.auth.admin.deleteUser(created.userId2);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
