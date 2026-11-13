// End-to-end check of team pages (assignedtolabor.org/<slug>), "what the channel has led
// to" on the dashboard, and the admins' overview of every channel, through the real
// pages in this Mac's Chrome.
//   1. NEXT_PUBLIC_TURNSTILE_SITE_KEY= NEXT_PUBLIC_SITE_URL=http://localhost:3001 npx next build
//      && (same env) npx next start -p 3001
//   2. node scripts/dev/team-page-check.mjs http://localhost:3001 [screenshot-dir]
// Uses the Supabase project in .env.local (the live one): a throwaway admin, member and
// outsider and a "Klingon" test team; everything is deleted at the end. It runs no cron
// sweep. The test page shows a real, public Google Form (the English team's) but never
// submits it; reaching Google is needed for the link checks.
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:3001";
const shots = join(process.argv[3] ?? mkdtempSync(join(tmpdir(), "team-page-")), "shots");
mkdirSync(shots, { recursive: true });
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ts = Date.now();
const SHORT_LINK = "https://forms.gle/fNAi2ubkzujWtALRA"; // the English team's form, as its Instagram bio links it
const LONG_LINK = "https://docs.google.com/forms/d/e/1FAIpQLSccIPUwnn5SBaiMciuEyVql8fEAKqU_LL3tETwTGQ3r2S7d9A/viewform";
const PERSON_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const slug = `tlh-check-${ts}`;
let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` · ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 20_000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(500); } };
const team = async () => (await db.from("areas").select("slug, referral_form_url, referral_form_title").eq("id", created.areaId).single()).data;
const opens = async () => ((await db.from("team_page_days").select("opens").eq("area_id", created.areaId)).data ?? []).reduce((a, d) => a + d.opens, 0);
// A day as the page's date box sees it: local, not UTC (in the evening the two differ, and the box refuses a day after today).
const day = (offset = 0) => { const d = new Date(Date.now() - offset * 86400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

const created = { users: [], areaId: null };
async function person(label, patch = {}) {
  const email = `team-page-${label}-${ts}@example.com`;
  const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(error.message);
  created.users.push(data.user.id);
  await until(async () => (await db.from("profiles").select("id").eq("id", data.user.id).maybeSingle()).data, 10_000);
  if (Object.keys(patch).length) await db.from("profiles").update(patch).eq("id", data.user.id);
  return { id: data.user.id, email };
}
async function signIn(browser, email, next, options = {}) {
  const { data: link, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(error.message);
  const page = await (await browser.newContext({ userAgent: PERSON_UA, ...options })).newPage();
  page.on("pageerror", (err) => console.log(`      page error: ${err.message}`));
  await page.goto(`${base}/auth/confirm?token_hash=${link.properties.hashed_token}&type=magiclink&next=${next}`);
  await page.waitForURL(new RegExp(next.replace("/", "\\/")));
  return page;
}

let browser;
try {
  check("app is up", (await fetch(`${base}/`)).ok);
  const admin = await person("admin", { role: "admin", display_name: "Page Check Admin" });
  const member = await person("member", { display_name: "Page Check Member" });
  const outsider = await person("outsider", { display_name: "Page Check Outsider" });
  const { data: area, error: aErr } = await db.from("areas").insert({ name: "Team Page Check", language: "Klingon", is_active: true, sort_order: 999, instagram_handle: "atl_page_check" }).select("id").single();
  if (aErr) throw new Error(aErr.message);
  created.areaId = area.id;
  await db.from("area_members").insert([{ area_id: area.id, user_id: admin.id }, { area_id: area.id, user_id: member.id }]);

  check("an address no team has is a 404", (await fetch(`${base}/${slug}`)).status === 404);
  check("so is a path that could never be one", (await fetch(`${base}/Not%20A%20Page!`)).status === 404);

  // The admin gives the team its page: an address (typed loosely) and the form's short link.
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await signIn(browser, admin.email, "/admin");
  const card = page.locator(`[data-team="${created.areaId}"]`); // by id: while editing, the name is in a box, not in the text
  check("the team has no form page yet", (await card.textContent()).includes("No form page yet"));
  const edit = async (address, link) => {
    await card.getByRole("button", { name: "Edit" }).click();
    await card.locator('input[name="slug"]').fill(address);
    await card.locator('input[name="referral_form_url"]').fill(link);
    await card.getByRole("button", { name: "Save" }).click();
    await card.getByRole("button", { name: "Edit" }).waitFor({ timeout: 20_000 });
  };
  await edit(`  TLH Check ${ts} `, SHORT_LINK);
  const saved = await until(async () => { const t = await team(); return t.slug ? t : null; });
  check("the address is tidied into letters, digits and hyphens", saved?.slug === slug, saved?.slug);
  check("the short link is stored as the form's long address", saved?.referral_form_url === LONG_LINK, saved?.referral_form_url);
  check("with the form's own title", saved?.referral_form_title === "Meet with Missionaries", saved?.referral_form_title);
  await card.getByText(`/${slug}`).waitFor({ timeout: 15_000 });
  check("the admin row links the page", (await card.locator("[data-team-page] a").getAttribute("href")) === `/${slug}` && (await card.textContent()).includes("(Meet with Missionaries)"));

  const refused = async (label, address, link, expect) => {
    await edit(address, link);
    const shown = await until(async () => { const t = (await page.locator("p.text-danger").last().textContent().catch(() => "")) ?? ""; return t.includes(expect) ? t : null; }, 20_000);
    const now = await team();
    check(label, !!shown && now.slug === slug && now.referral_form_url === LONG_LINK, shown ?? `no "${expect}" message`);
  };
  await refused("an address the site uses itself is refused", "admin", LONG_LINK, "the site uses itself");
  await refused("another team's address is refused", "philippines", LONG_LINK, "already has the page address");
  await refused("a form link that does not open is refused", slug, "https://docs.google.com/forms/d/e/1FAIpQLSc-not-a-real-form-000000000000000000000000000000000/viewform", "did not open");
  await refused("a form link needs an address", "", LONG_LINK, "Give the team a page address");

  // The public page: the form in a frame, for anyone, counted once per visit.
  const res = await fetch(`${base}/${slug}`, { headers: { "user-agent": PERSON_UA } });
  const html = await res.text();
  check("the page answers for a visitor with no session", res.status === 200);
  check("it is titled as the form, without the site's name", /<title>Meet with Missionaries<\/title>/.test(html), (html.match(/<title>[^<]*<\/title>/) ?? [""])[0]);
  check("and kept out of search results", /<meta name="robots" content="noindex"/.test(html));
  const visitor = await browser.newContext({ userAgent: PHONE_UA, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const vp = await visitor.newPage();
  await vp.goto(`${base}/${slug}`);
  const frameSrc = await vp.locator("iframe").getAttribute("src");
  check("the form is shown in the page", frameSrc === `${LONG_LINK}?embedded=true`, frameSrc);
  check("the bar names the channel and offers the form on its own", (await vp.locator("header a").first().textContent()) === "@atl_page_check" && (await vp.locator("header a").last().getAttribute("href")) === LONG_LINK);
  const inner = await until(async () => { const f = vp.frames().find((x) => x.url().includes("docs.google.com")); return f ? ((await f.evaluate(() => document.body?.innerText ?? "").catch(() => "")).includes("Meet with Missionaries") ? f : null) : null; }, 30_000);
  check("Google's form really loads inside it", !!inner);
  const box = await vp.locator("iframe").boundingBox();
  check("the frame fills the screen under the bar", !!box && box.width === 390 && box.y < 60 && Math.round(box.y + box.height) === 844, JSON.stringify(box));
  await vp.screenshot({ path: join(shots, "team-page.png") });
  check("the open is counted", (await until(async () => (await opens()) === 1)) === true, `opens ${await opens()}`);
  await vp.reload();
  await vp.locator("iframe").waitFor();
  await sleep(2500);
  check("a reload in the same visit is not counted again", (await opens()) === 1, `opens ${await opens()}`);
  const second = await (await browser.newContext({ userAgent: PHONE_UA })).newPage();
  await second.goto(`${base}/${slug}`);
  check("a second visitor is", (await until(async () => (await opens()) === 2)) === true, `opens ${await opens()}`);
  const preview = await (await browser.newContext()).newPage(); // headless Chrome's own user agent: a link preview, not a person
  await preview.goto(`${base}/${slug}`);
  await preview.locator("iframe").waitFor();
  await fetch(`${base}/api/team-page/open`, { method: "POST", headers: { "content-type": "application/json", "user-agent": PERSON_UA }, body: JSON.stringify({ slug }) }); // no Origin: not our page
  await fetch(`${base}/api/team-page/open`, { method: "POST", headers: { "content-type": "application/json", "user-agent": PERSON_UA, origin: "https://example.com" }, body: JSON.stringify({ slug }) });
  await sleep(2500);
  check("link previews and reports from elsewhere are not", (await opens()) === 2, `opens ${await opens()}`);

  // Any other kind of link is forwarded to, and counted on the way.
  await db.from("areas").update({ referral_form_url: "https://example.com/meet", referral_form_title: null }).eq("id", created.areaId);
  const fwd = await fetch(`${base}/${slug}`, { redirect: "manual", headers: { "user-agent": PERSON_UA } });
  check("a link that is not a Google Form is forwarded to", [307, 308].includes(fwd.status) && fwd.headers.get("location") === "https://example.com/meet", `${fwd.status} ${fwd.headers.get("location")}`);
  await fetch(`${base}/${slug}`, { redirect: "manual", headers: { "user-agent": "facebookexternalhit/1.1" } });
  check("counting the person, not the preview", (await until(async () => (await opens()) === 3)) === true && (await sleep(1000), await opens()) === 3, `opens ${await opens()}`);
  await db.from("areas").update({ referral_form_url: null }).eq("id", created.areaId);
  check("a team with an address but no form has no page", (await fetch(`${base}/${slug}`)).status === 404);
  await db.from("areas").update({ referral_form_url: LONG_LINK, referral_form_title: "Meet with Missionaries" }).eq("id", created.areaId);

  // The dashboard: the lead (here the admin) enters the figures and a story.
  await page.goto(`${base}/my`);
  const mine = page.locator('section[aria-label="Team Page Check · Klingon team"]');
  const impact = mine.locator("[data-impact]");
  check("the team card invites the lead to add figures", (await impact.textContent()).includes("No figures yet. Add them below"));
  check("and shows the form page with its opens", (await impact.textContent()).includes(`localhost:3001/${slug}`) && (await impact.textContent()).includes("opened 3 times in the last 30 days"), (await impact.textContent()).slice(0, 200));
  const figures = async (button, values, asOf) => {
    await impact.getByRole("button", { name: button }).click();
    for (const [label, v] of Object.entries(values)) await impact.getByLabel(label, { exact: true }).fill(v);
    await impact.locator('input[name="as_of"]').fill(asOf);
    await impact.getByRole("button", { name: "Save the figures" }).click();
    await impact.getByRole("button", { name: "Update the figures" }).waitFor({ timeout: 20_000 });
  };
  await figures("Add the figures", { "Asked to meet the missionaries": "10", "Sent to the missionaries": "4", "Baptized": "" }, day(7));
  let text = await impact.textContent();
  check("the first figures show, an empty box left out", (await impact.locator('[data-figure="requests"] dd').first().textContent()) === "10" && (await impact.locator('[data-figure="referrals"] dd').first().textContent()) === "4" && (await impact.locator('[data-figure="baptisms"]').count()) === 0, text.slice(0, 160));
  await figures("Update the figures", { "Asked to meet the missionaries": "1,014", "Sent to the missionaries": "6", "Baptized": "1" }, day(0));
  await impact.locator('[data-figure="baptisms"]').waitFor({ timeout: 15_000 });
  text = await impact.textContent();
  check("newer figures replace them, with the growth since", (await impact.locator('[data-figure="requests"] dd').first().textContent()) === "1,014" && (await impact.locator('[data-figure="requests"]').textContent()).includes("+1,004 since") && (await impact.locator('[data-figure="referrals"]').textContent()).includes("+2 since") && (await impact.locator('[data-figure="baptisms"] dd').first().textContent()) === "1", text.slice(0, 260));
  await figures("Update the figures", { "Asked to meet the missionaries": "14", "Sent to the missionaries": "6", "Baptized": "1" }, day(0));
  const rows = (await db.from("team_impact_reports").select("as_of, requests, referrals, baptisms, source, created_by").eq("area_id", created.areaId).order("as_of")).data;
  check("a correction the same day replaces that day's row", rows.length === 2 && rows[1].requests === 14 && rows[1].baptisms === 1 && rows[0].baptisms === null && rows[1].created_by === admin.id && rows[1].source === "manual", JSON.stringify(rows));
  await impact.getByRole("button", { name: "Add a story" }).click();
  await impact.getByLabel("Title").fill("Worf was baptised");
  await impact.getByLabel("When (optional)").fill(day(3));
  await impact.getByLabel("The story").fill("He found the channel in March.\nThe missionaries met him the same week.");
  await impact.getByRole("button", { name: "Add the story" }).click();
  const story = impact.locator("[data-story]").first();
  await story.waitFor({ timeout: 20_000 });
  check("a story is added", (await story.textContent()).includes("Worf was baptised") && (await story.textContent()).includes("The missionaries met him the same week."));
  await story.getByRole("button", { name: "Edit" }).click();
  await story.getByLabel("Title").fill("Worf was baptized");
  await story.getByRole("button", { name: "Save the story" }).click();
  await impact.getByText("Worf was baptized").waitFor({ timeout: 20_000 });
  check("and corrected", ((await db.from("team_stories").select("title").eq("area_id", created.areaId)).data ?? []).map((s) => s.title).join() === "Worf was baptized");
  await page.setViewportSize({ width: 390, height: 844 });
  await mine.screenshot({ path: join(shots, "team-impact.png") });
  await page.setViewportSize({ width: 1280, height: 800 });

  // A member reads it and cannot change it; someone on no team sees none of it.
  const mp = await signIn(browser, member.email, "/my");
  const theirs = mp.locator('section[aria-label="Team Page Check · Klingon team"] [data-impact]');
  text = await theirs.textContent();
  check("a member sees the figures, the story and the form page", text.includes("Baptized") && text.includes("Worf was baptized") && text.includes(`/${slug}`) && (await theirs.locator('[data-figure="requests"] dd').first().textContent()) === "14", text.slice(0, 200));
  check("but no way to change them", (await theirs.getByRole("button", { name: /figures|Add a story|Edit|Delete/ }).count()) === 0);
  const op = await signIn(browser, outsider.email, "/my");
  text = await op.textContent("body");
  check("someone on no team sees none of it", !text.includes("Worf") && !text.includes("What the channel has led to") && text.includes("what the channel has led to"));

  // The lead removes the story, after being asked.
  await story.getByRole("button", { name: "Delete" }).click();
  await story.getByRole("button", { name: "Keep it" }).click();
  check("Delete asks first, and Keep it keeps it", ((await db.from("team_stories").select("id").eq("area_id", created.areaId)).data ?? []).length === 1);
  await story.getByRole("button", { name: "Delete" }).click();
  await story.getByRole("button", { name: "Yes, delete" }).click();
  check("the story is removed", (await until(async () => ((await db.from("team_stories").select("id").eq("area_id", created.areaId)).data ?? []).length === 0)) === true);

  // Every channel at a glance, for admins: on the Admin page and on the dashboard.
  const row = (p) => p.locator(`tbody[data-channel="${created.areaId}"]`);
  const col = async (p, name) => ((await row(p).locator(`[data-col="${name}"]`).textContent()) ?? "").trim();
  const iso = (days) => new Date(Date.now() - days * 86400_000).toISOString();
  const shortDay = (days) => new Date(Date.now() - days * 86400_000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  await page.goto(`${base}/admin`);
  check("the Admin page opens with every channel at a glance", (await page.locator("#channels").textContent()).includes("Every channel at a glance") && (await row(page).count()) === 1 && (await page.locator("#channels tbody").count()) >= 2);
  check("a new channel: its people, no followers, nothing posted", (await col(page, "members")) === "2" && (await col(page, "followers")) === "–" && (await col(page, "last")) === "None yet" && (await col(page, "posts7")) === "0*" && (await col(page, "posts30")) === "0*" && (await col(page, "pending")) === "0",
    `${await col(page, "members")} | ${await col(page, "followers")} | ${await col(page, "last")} | ${await col(page, "posts7")} | ${await col(page, "posts30")} | ${await col(page, "pending")}`);
  // Rows as the site would have them; marked as already notified so no sweep emails anyone about them.
  const vid = async (fields) => { const { error } = await db.from("videos").insert({ user_id: admin.id, area_id: created.areaId, language: "Klingon", uploader_name: "page-check", caption_state: "skipped", managers_notified_at: iso(0), ...fields }); if (error) throw new Error(error.message); };
  for (const [days, tag] of [[2, "TWO"], [20, "TWENTY"], [45, "FORTYFIVE"]]) await vid({ status: "posted", posted_at: iso(days), post_url: `https://www.instagram.com/reel/PAGECHECK${tag}/`, file_purged_at: iso(0), uploader_notified_status: "posted" });
  await vid({ status: "pending" });
  await page.reload();
  check("posts recorded on this site are counted for a channel that is not connected", (await col(page, "posts7")) === "1*" && (await col(page, "posts30")) === "2*" && (await col(page, "pending")) === "1", `${await col(page, "posts7")} | ${await col(page, "posts30")} | ${await col(page, "pending")}`);
  check("with the last post, its day and its link", (await col(page, "last")) === `${shortDay(2)}2 days ago` && (await row(page).locator('[data-col="last"] a').getAttribute("href")) === "https://www.instagram.com/reel/PAGECHECKTWO/", await col(page, "last"));
  check("and the note says which figures are from this site only", (await page.locator("#channels").textContent()).includes("only posts made or marked as posted on this site are counted"));
  // Instagram's numbers as the refresh stores them (a connection made a moment ago is never refreshed from here).
  const media = [[1, "IGONE"], [5, "IGFIVE"], [12, "IGTWELVE"]].map(([days, tag], i) => ({ id: String(i), caption: null, mediaType: "VIDEO", productType: "REELS", permalink: `https://www.instagram.com/reel/${tag}/`, thumbnailUrl: null, timestamp: iso(days), likes: 1, comments: 0 }));
  await db.from("areas").update({ instagram_user_id: `page-check-${ts}`, instagram_connected_at: iso(0) }).eq("id", created.areaId);
  await db.from("instagram_stats").upsert({ area_id: created.areaId, username: "atl_page_check", fetched_at: iso(0), succeeded_at: iso(0), profile: { username: "atl_page_check", name: null, pictureUrl: null, followers: 1234, follows: 1, mediaCount: 3 }, media, insights: null, error: null });
  await page.reload();
  check("a connected channel shows Instagram's followers and posts", (await col(page, "followers")) === "1,234" && (await col(page, "posts7")) === "2" && (await col(page, "posts30")) === "3" && (await col(page, "last")) === `${shortDay(1)}yesterday` && (await row(page).locator('[data-col="last"] a').getAttribute("href")) === "https://www.instagram.com/reel/IGONE/",
    `${await col(page, "followers")} | ${await col(page, "posts7")} | ${await col(page, "posts30")} | ${await col(page, "last")}`);
  await db.from("instagram_stats").update({ succeeded_at: iso(3) }).eq("area_id", created.areaId);
  await page.reload();
  check("numbers Instagram last gave days ago: followers with their day, posts from this site", (await col(page, "followers")) === `1,234as of ${shortDay(3)}` && (await col(page, "posts7")) === "1*" && (await col(page, "posts30")) === "2*", `${await col(page, "followers")} | ${await col(page, "posts7")} | ${await col(page, "posts30")}`);
  await db.from("instagram_stats").delete().eq("area_id", created.areaId);
  await db.from("areas").update({ instagram_user_id: null, instagram_connected_at: null }).eq("id", created.areaId);
  // An admin opens a channel's results from the row and corrects them there.
  await page.reload();
  await row(page).getByRole("button", { name: /^Results: 14 asked for missionaries · 6 sent on · 1 baptized$/ }).click();
  const inRow = row(page).locator("[data-impact]");
  await inRow.getByRole("button", { name: "Update the figures" }).click();
  await inRow.getByLabel("Baptized", { exact: true }).fill("2");
  await inRow.getByRole("button", { name: "Save the figures" }).click();
  check("an admin corrects a channel's figures from its row", (await until(async () => ((await db.from("team_impact_reports").select("baptisms").eq("area_id", created.areaId).order("as_of", { ascending: false }).limit(1)).data ?? [])[0]?.baptisms === 2)) === true);
  await row(page).getByRole("button", { name: "Hide results" }).click();
  await row(page).getByRole("button", { name: /2 baptized$/ }).waitFor({ timeout: 15_000 });
  check("and the row carries the new figure", (await inRow.count()) === 0);
  await page.goto(`${base}/my`);
  check("the dashboard shows an admin the same overview", (await row(page).count()) === 1 && (await page.locator("#channels").textContent()).includes("Every channel at a glance"));
  await mp.reload();
  check("a member sees no overview of other channels", (await mp.locator("#channels").count()) === 0 && !(await mp.textContent("body")).includes("Every channel at a glance"));
  await page.setViewportSize({ width: 390, height: 844 });
  const cardRow = page.locator(`[data-channel-card="${created.areaId}"]`);
  check("on a phone each channel is a card", (await cardRow.isVisible()) && !(await row(page).isVisible()) && (await cardRow.textContent()).includes("Posts, 7 days"));
  await page.locator("#channels").screenshot({ path: join(shots, "channels-phone.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("#channels").screenshot({ path: join(shots, "channels.png") });
} catch (e) {
  failed++;
  console.log(`FAIL  the check stopped: ${e instanceof Error ? e.stack : e}`);
} finally {
  await browser?.close();
  if (created.users.length) await db.from("videos").delete().in("user_id", created.users);
  if (created.areaId) await db.from("areas").delete().eq("id", created.areaId); // its figures, stories, opens and stored Instagram numbers go with it
  for (const id of created.users) await db.auth.admin.deleteUser(id);
  const left = created.areaId ? (await db.from("team_impact_reports").select("id", { count: "exact", head: true }).eq("area_id", created.areaId)).count : 0;
  console.log(`cleaned up (${left ?? 0} rows left behind)`);
}
console.log(`\n${passed} passed, ${failed} failed · screenshots in ${shots}`);
process.exit(failed ? 1 : 0);
