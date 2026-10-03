// End-to-end check of the team lead application in a real Chrome, against a local
// build and the project in .env.local. Throwaway accounts only; everything it creates
// is removed at the end (applications, files, users, the "Klingon" test team).
//
// It walks the whole path an applicant and an admin take:
//   part 1 without an account -> the "part 2" email (really sent, to Resend's test
//   inbox, then read back) -> the email's link -> part 2 (record with a fake camera,
//   upload) -> admin sees it, plays the video, approves onto a new team -> the
//   applicant is a lead. Plus: a signed-in applicant, a decline, the notification
//   plan (dry run, nothing sent to real people), a dead link, the saved draft.
//
// What it cannot do is pass the captcha: Supabase checks Turnstile on anonymous
// sign-in, and a script must not. So the visitor "without an account" is a throwaway
// account signed in here and then flagged anonymous in the database, which is what
// the server sees after a real visitor passes the captcha. The captcha step itself
// needs a person (see CLAUDE.md).
//
// Use ONE hostname throughout, and "localhost" at that: `next start` redirects from route
// handlers to localhost whatever the request said, and a sign-in cookie set on
// 127.0.0.1 does not follow there. The site URL is baked in at build time and is what
// the email link is built on.
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY= NEXT_PUBLIC_SITE_URL=http://localhost:3001 npx next build
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY= NEXT_PUBLIC_SITE_URL=http://localhost:3001 npx next start -p 3001
//   node scripts/dev/lead-flow-check.mjs http://localhost:3001 fake-cam.y4m [screenshot-dir]
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const [base = "http://localhost:3001", camFile, shots] = process.argv.slice(2);
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const sql = (q) => execFileSync("psql", [env.SUPABASE_DB_URL, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
let failed = 0;
const ok = (label, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  -> ${extra}` : ""}`); if (!cond) failed++; };
const stamp = Date.now();
const visitorEmail = `lead-e2e-visitor-${stamp}@example.com`;       // the session that fills part 1 "without an account"
const applicantEmail = `delivered+lead${stamp}@resend.dev`;          // the address typed into the form (Resend's test inbox)
const secondEmail = `lead-e2e-second-${stamp}@example.com`;          // applies while signed in; declined
const adminEmail = `lead-e2e-admin-${stamp}@example.com`;
const users = [];
const answers = { name: "Ana Applicant", phone: "+1 (801) 555-0100", language: "Klingon", audience: "Young adults on Qo'noS", why: "I already translate these videos for my friends.\nI would like to do it properly." };

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${camFile}`, "--autoplay-policy=no-user-gesture-required"] });
const newPage = async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) console.log("[console.error]", m.text().slice(0, 220)); });
  return page;
};
const shot = async (page, name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
/** Signs a page in the way our email links do: a one-time token landing on /auth/confirm. */
async function signIn(page, email, next) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  await page.goto(`${base}/auth/confirm?token_hash=${data.properties.hashed_token}&type=${data.properties.verification_type}&next=${encodeURIComponent(next)}`, { waitUntil: "networkidle" });
  return data.user.id;
}
async function fillForm(page, { email } = {}) {
  await page.getByLabel("Your name").fill(answers.name);
  if (email) await page.getByLabel("Email").fill(email);
  await page.getByLabel("Phone number").fill(answers.phone);
  await page.getByLabel("Language your channel will speak").fill(answers.language);
  await page.getByLabel("Audience or location you want to reach").fill(answers.audience);
  await page.getByLabel("Why would you like to lead a team?").fill(answers.why);
}
async function recordAndSend(page) {
  await page.getByRole("button", { name: "Record now" }).click();
  await page.waitForFunction(() => { const v = document.querySelector("video"); return v && v.videoWidth > 0; }, null, { timeout: 20000 });
  await page.getByRole("button", { name: "Record clip" }).click();   // tips + countdown, then records
  await page.getByRole("button", { name: "Stop clip" }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "Stop clip" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByText("Looks good?").waitFor({ timeout: 60000 });
  await page.getByRole("button", { name: "Send my application" }).click();
  await page.getByRole("heading", { name: "Application sent", exact: true }).waitFor({ timeout: 120000 });
}

try {
  // ── accounts ──
  for (const email of [visitorEmail, secondEmail, adminEmail]) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error) throw error;
    users.push(data.user.id);
  }
  const [visitorId, , adminId] = users;
  await admin.from("profiles").update({ role: "admin" }).eq("id", adminId);

  // ── a first-time visitor: the form, the draft, validation ──
  const fresh = await newPage();
  await fresh.goto(`${base}/lead`, { waitUntil: "networkidle" });
  ok("a visitor with no account sees the application form", await fresh.getByRole("heading", { name: "Lead a team" }).isVisible() && await fresh.getByLabel("Email").isVisible());
  await shot(fresh, "1-form-empty");
  await fillForm(fresh, { email: "someone@example.com" });
  await fresh.waitForTimeout(300);
  await fresh.reload({ waitUntil: "networkidle" });
  ok("what was typed survives a reload", (await fresh.getByLabel("Why would you like to lead a team?").inputValue()) === answers.why && (await fresh.getByLabel("Your name").inputValue()) === answers.name);
  await fresh.getByLabel("Phone number").fill("call me");
  await fresh.getByRole("button", { name: "Save and email me part 2" }).click();
  ok("a bad phone number is caught before anything is sent", await fresh.getByText("Please enter a phone number we can reach you at.").isVisible());
  await fresh.getByLabel("Phone number").fill(answers.phone);
  await fresh.getByRole("button", { name: "Save and email me part 2" }).click();
  await fresh.getByText(/captcha/i).waitFor({ timeout: 15000 }).catch(() => {});
  ok("without a passed captcha Supabase refuses the session, and the form says so", await fresh.getByText(/captcha/i).isVisible());
  ok("nothing was saved for that visitor", sql(`select count(*) from public.lead_applications where email = 'someone@example.com'`) === "0");
  await fresh.context().close();

  // ── part 1 without an account (see the header for how this stands in for the captcha) ──
  const phone = await newPage();
  await signIn(phone, visitorEmail, "/lead");
  sql(`update auth.users set is_anonymous = true where id = '${visitorId}'`);
  await phone.goto(`${base}/lead`, { waitUntil: "networkidle" });
  ok("the server treats the session as a visitor without an account", await phone.getByLabel("Email").isVisible());
  await fillForm(phone, { email: applicantEmail.toUpperCase() });
  await phone.getByRole("button", { name: "Save and email me part 2" }).click();
  await phone.getByRole("heading", { name: "Check your email" }).waitFor({ timeout: 30000 });
  ok("after part 1 the applicant is told an email is on its way", await phone.getByText(applicantEmail).isVisible());
  await shot(phone, "2-check-your-email");
  const { data: app1 } = await admin.from("lead_applications").select("*").eq("email", applicantEmail).maybeSingle();
  ok("part 1 is saved: started, unclaimed, address lower-cased", app1?.status === "started" && app1.user_id === null && app1.started_by === visitorId && app1.full_name === answers.name && app1.why === answers.why);
  ok("one part 2 email is on record", app1?.part2_emails === 1 && !!app1.part2_emailed_at);
  await phone.getByRole("button", { name: "Send it again" }).click();
  await phone.getByText("We sent it less than a minute ago").waitFor({ timeout: 15000 }).catch(() => {});
  ok("asking again within a minute sends nothing more", await phone.getByText("We sent it less than a minute ago").isVisible() && sql(`select part2_emails from public.lead_applications where id = '${app1.id}'`) === "1");

  // ── the email itself, read back from Resend ──
  const { data: sentRow } = await admin.from("notifications").select("provider_id").eq("kind", "lead_part2").eq("recipient", applicantEmail).maybeSingle();
  ok("the send is logged", !!sentRow?.provider_id);
  let link = null, mail = null;
  for (let i = 0; i < 10 && !mail?.html; i++) {
    const r = await fetch(`https://api.resend.com/emails/${sentRow.provider_id}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    mail = r.ok ? await r.json() : { error: `${r.status} ${await r.text()}` };
    if (!mail.html) await new Promise((res) => setTimeout(res, 1500));
  }
  if (mail?.html) {
    if (shots) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(`${shots}/part2-email.html`, mail.html);
      const view = await newPage();
      await view.setContent(mail.html);
      await view.screenshot({ path: `${shots}/part2-email.png`, fullPage: true });
      await view.context().close();
    }
    link = mail.html.match(/href="([^"]*\/auth\/confirm\?[^"]*)"/)?.[1]?.replaceAll("&amp;", "&") ?? null;
    ok("Resend accepted the part 2 email", mail.to?.[0] === applicantEmail && /Part 2 of your team lead application/.test(mail.subject), `${mail.subject} · ${mail.last_event}`);
    ok("it greets the applicant, explains part 2 and says why they got it", mail.html.includes(`Thank you, ${answers.name}`) && /short video/.test(mail.html) && /If that was not you/.test(mail.html) && !/because of your role/.test(mail.html));
    ok("its button points at this site's confirm route and on to part 2", !!link && link.startsWith(`${base}/auth/confirm?token_hash=`) && link.includes(`next=${encodeURIComponent("/lead/video")}`), link?.replace(/token_hash=[^&]+/, "token_hash=…"));
  } else {
    ok("the email could be read back from Resend", false, JSON.stringify(mail).slice(0, 200));
  }
  if (!link) throw new Error("no link to continue with");

  // ── the applicant opens the email on another device ──
  const laptop = await newPage();
  await laptop.goto(link, { waitUntil: "networkidle" });
  ok("the email link signs them in and opens part 2", new URL(laptop.url()).pathname === "/lead/video" && await laptop.getByText("Part 2 of 2").isVisible(), laptop.url());
  const { data: claimed } = await admin.from("lead_applications").select("user_id").eq("id", app1.id).single();
  const { data: applicantUser } = await admin.from("profiles").select("id, email, is_anonymous, display_name").eq("email", applicantEmail).maybeSingle();
  if (applicantUser) users.push(applicantUser.id);
  ok("an account now exists for the address and owns the application", !!applicantUser && !applicantUser.is_anonymous && claimed.user_id === applicantUser.id && applicantUser.display_name === answers.name);
  ok("their answers are read back to them", await laptop.getByText(answers.audience).isVisible() && await laptop.getByText("I already translate these videos").isVisible());
  await shot(laptop, "3-part2-intro");
  await recordAndSend(laptop);
  await shot(laptop, "4-application-sent");
  const { data: app1b } = await admin.from("lead_applications").select("*").eq("id", app1.id).single();
  ok("the video is uploaded and the application is submitted", app1b.status === "submitted" && app1b.video_path?.startsWith(`${applicantUser.id}/lead-`) && app1b.video_size > 10000 && !!app1b.video_thumbnail && !!app1b.capture_meta, `${app1b.video_path} · ${app1b.video_size} bytes · ${app1b.video_seconds}s`);
  const { data: obj } = await admin.storage.from("videos").list(applicantUser.id);
  ok("the file is in the applicant's folder of the private bucket", obj?.some((f) => app1b.video_path.endsWith(f.name)));
  ok("it did not enter the review queue", sql(`select count(*) from public.videos where user_id = '${applicantUser.id}'`) === "0");
  await laptop.goto(`${base}/lead`, { waitUntil: "networkidle" });
  ok("coming back, the applicant sees that it is in", await laptop.getByRole("heading", { name: "Your application is in" }).isVisible());
  await laptop.goto(`${base}/my`, { waitUntil: "networkidle" });
  ok("My videos shows the application's status", await laptop.getByText("Team lead application.").isVisible());

  // ── a dead link is not a dead end ──
  await laptop.goto(link, { waitUntil: "networkidle" });
  ok("the used link, on a device that is signed in, just continues", ["/lead", "/lead/video"].includes(new URL(laptop.url()).pathname), laptop.url());
  const stranger = await newPage();
  await stranger.goto(link, { waitUntil: "networkidle" });
  ok("the used link elsewhere leads to sign-in, keeping the destination", new URL(stranger.url()).pathname === "/login" && stranger.url().includes(encodeURIComponent("/lead/video")) && await stranger.getByText(/expired or was already used/).isVisible(), stranger.url().slice(0, 90));
  await stranger.goto(`${base}/lead/video`, { waitUntil: "networkidle" });
  ok("part 2 is not reachable without signing in", new URL(stranger.url()).pathname === "/login");
  await stranger.context().close();

  // ── someone who already has an account applies ──
  const second = await newPage();
  await signIn(second, secondEmail, "/lead");
  ok("a signed-in applicant is not asked for an email", await second.getByText("Applying as").isVisible() && !(await second.getByLabel("Email").isVisible().catch(() => false)));
  await fillForm(second);
  await second.getByLabel("Language your channel will speak").fill("English");
  await second.getByRole("button", { name: "Continue to part 2" }).click();
  await second.waitForURL("**/lead/video", { timeout: 30000 });
  ok("they go straight to part 2, no email", await second.getByText("Part 2 of 2").isVisible() && sql(`select part2_emails from public.lead_applications where email = '${secondEmail}'`) === "0");
  await second.getByRole("link", { name: "Change my answers" }).click();
  await second.waitForURL("**/lead?edit=1", { timeout: 15000 });
  await second.getByLabel("Audience or location you want to reach").fill("Utah Valley");
  await second.getByRole("button", { name: "Save and go to part 2" }).click();
  await second.waitForURL("**/lead/video", { timeout: 30000 });
  ok("answers can be changed before the video is sent", sql(`select audience from public.lead_applications where email = '${secondEmail}'`) === "Utah Valley");
  await recordAndSend(second);

  // ── the notification plan (dry run: nothing is sent) ──
  const plan = async () => (await (await fetch(`${base}/api/cron/notify?dry=1`, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } })).json()).plan ?? [];
  const before = await plan();
  const toAdmin = before.filter((p) => p.kind === "lead_application" && p.to === adminEmail);
  ok("admins would be told two applications are waiting", toAdmin.length === 1 && /2 team lead applications are waiting/.test(toAdmin[0].subject), toAdmin[0]?.subject);

  // ── the admin ──
  const boss = await newPage();
  boss.setViewportSize({ width: 1100, height: 900 });
  await signIn(boss, adminEmail, "/review");
  ok("the review page counts the waiting applications", await boss.getByText(/people are waiting to join a team, start one or lead one/).isVisible());
  await boss.goto(`${base}/review/requests`, { waitUntil: "networkidle" });
  // The waiting card is the one with the decision buttons (decided applications are listed too, further down).
  const waitingCard = (email) => boss.locator("li.card", { hasText: email }).filter({ has: boss.getByRole("button", { name: "Approve as a team lead" }) });
  const card = waitingCard(applicantEmail);
  ok("the admin sees the application with its answers and contact details", await card.getByText(answers.name).isVisible() && await card.getByText(answers.audience).isVisible() && await card.getByText("I already translate these videos").isVisible() && await card.getByRole("link", { name: answers.phone }).isVisible());
  await card.locator("video").evaluate((v) => new Promise((res, rej) => { if (v.readyState >= 1) return res(); v.addEventListener("loadedmetadata", () => res(), { once: true }); v.addEventListener("error", () => rej(new Error("video error")), { once: true }); setTimeout(() => rej(new Error("video did not load")), 30000); }));
  const dimsOk = await card.locator("video").evaluate((v) => v.videoWidth > 0 && v.duration > 1);
  ok("the admin can play the applicant's video", dimsOk);
  await shot(boss, "5-admin-requests");
  ok("an existing team is not preselected for a language no team covers", (await card.getByLabel("Make them a lead of").inputValue()) === "new");
  await card.getByLabel("New team's name").fill("E2E Qo'noS");
  await card.getByLabel("Note back to them (optional)").fill("Welcome aboard");
  await card.getByRole("button", { name: "Approve as a team lead" }).click();
  await boss.getByText("Recent decisions (1)").waitFor({ timeout: 30000 });
  const { data: app1c } = await admin.from("lead_applications").select("status, area_id, decided_by, decision_note, area:areas(name, language)").eq("id", app1.id).single();
  ok("approving creates the team and records the decision", app1c.status === "approved" && app1c.decided_by === adminId && app1c.area?.name === "E2E Qo'noS" && app1c.area?.language === "Klingon" && app1c.decision_note === "Welcome aboard");
  const { data: leadRow } = await admin.from("area_managers").select("notified_at").eq("area_id", app1c.area_id).eq("user_id", applicantUser.id).maybeSingle();
  ok("the applicant is the new team's lead", !!leadRow?.notified_at);
  const card2 = waitingCard(secondEmail);
  const english = sql(`select id from public.areas where is_active and lower(language) = 'english' limit 1`);
  ok("the team that shares the applicant's language is preselected", (await card2.getByLabel("Make them a lead of").inputValue()) === english);
  await card2.getByLabel("Note back to them (optional)").fill("Not this time, thank you");
  await card2.getByRole("button", { name: "Decline" }).click();
  await boss.getByText("Recent decisions (2)").waitFor({ timeout: 30000 });
  ok("declining records the note and makes nobody a lead", sql(`select status || '|' || decision_note from public.lead_applications where email = '${secondEmail}'`) === "declined|Not this time, thank you" && sql(`select count(*) from public.area_managers where user_id = '${users[1]}'`) === "0");
  ok("both decisions are listed for reference, and nothing is left waiting", await boss.getByText("Recent decisions (2)").isVisible() && await boss.getByText("None waiting for a decision.").isVisible());

  const after = await plan();
  const outcome1 = after.find((p) => p.kind === "lead_outcome" && p.to === applicantEmail);
  const outcome2 = after.find((p) => p.kind === "lead_outcome" && p.to === secondEmail);
  ok("the approved applicant would be told they are a lead", /You are now a lead for E2E Qo'noS · Klingon/.test(outcome1?.subject ?? ""), outcome1?.subject);
  ok("the declined applicant would be told, kindly", outcome2?.subject === "About your team lead application");
  ok("admins would not be told again", !after.some((p) => p.kind === "lead_application" && p.to === adminEmail));

  // ── the new lead ──
  await laptop.goto(`${base}/lead`, { waitUntil: "networkidle" });
  ok("the applicant sees they are a team lead", await laptop.getByRole("heading", { name: "You are a team lead" }).isVisible() && await laptop.getByText("E2E Qo'noS · Klingon").isVisible());
  await laptop.goto(`${base}/review`, { waitUntil: "networkidle" });
  ok("and can open the review queue", new URL(laptop.url()).pathname === "/review" && await laptop.getByRole("heading", { name: "Review", exact: true }).isVisible());
  await second.goto(`${base}/lead`, { waitUntil: "networkidle" });
  ok("the declined applicant sees the note and may apply again", await second.getByText("Not this time, thank you").isVisible() && await second.getByRole("button", { name: "Apply again" }).isVisible());
} catch (e) {
  console.log("ERROR", e);
  failed++;
} finally {
  await browser.close();
  // Everything this run made.
  const emails = [visitorEmail, applicantEmail, secondEmail, adminEmail];
  const { data: profs } = await admin.from("profiles").select("id").in("email", emails);
  const ids = [...new Set([...users, ...((profs ?? []).map((p) => p.id))])];
  await admin.from("lead_applications").delete().in("email", emails);
  await admin.from("notifications").delete().in("recipient", emails);
  await admin.from("areas").delete().eq("language", "Klingon");
  for (const id of ids) {
    const { data } = await admin.storage.from("videos").list(id);
    if (data?.length) await admin.storage.from("videos").remove(data.map((f) => `${id}/${f.name}`));
    await admin.auth.admin.deleteUser(id);
  }
  const left = sql(`select (select count(*) from public.lead_applications where email like 'lead-e2e-%' or email like 'delivered+lead%') || ' applications, ' || (select count(*) from auth.users where email like 'lead-e2e-%' or email like 'delivered+lead%') || ' users, ' || (select count(*) from public.areas where language = 'Klingon') || ' test teams left'`);
  console.log(`cleanup: ${ids.length} users removed; ${left}`);
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
}
