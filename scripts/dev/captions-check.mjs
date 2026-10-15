// End-to-end check of the AI caption sweep against the mock providers
// (scripts/dev/captions-mock.mjs), through the real cron route and review pages.
//   1. node scripts/dev/captions-mock.mjs                      (port 3997)
//   2. ELEVENLABS_BASE=http://127.0.0.1:3997 ANTHROPIC_BASE=http://127.0.0.1:3997 \
//      ELEVENLABS_API_KEY=mock-el ANTHROPIC_API_KEY=mock-anthropic NEXT_PUBLIC_TURNSTILE_SITE_KEY= \
//      NEXT_PUBLIC_SITE_URL=http://localhost:3001 npx next build && (same env) npx next start -p 3001
//   3. node scripts/dev/captions-check.mjs http://localhost:3001 [http://127.0.0.1:3997] [screenshot-dir]
// Uses the Supabase project in .env.local (the live one): a throwaway admin, a Klingon
// test team and a few small videos; everything is deleted at the end.
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const base = process.argv[2] ?? "http://localhost:3001";
const mock = process.argv[3] ?? "http://127.0.0.1:3997";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ts = Date.now();
let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { if (ok) passed++; else failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` · ${detail}` : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const video = async (id, cols) => (await db.from("videos").select(cols).eq("id", id).single()).data;
const until = async (fn, ms = 30_000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(1000); } };
// Every run is limited to this script's own videos: the local build talks to the LIVE
// database, and an unrestricted sweep would caption real videos with the mock's answers.
const cron = async (ids, q = "") => { if (!ids.length) throw new Error("cron() needs the ids to limit the sweep to"); const url = `${base}/api/cron/captions?only=${ids.join(",")}${q}`; const r = await fetch(url, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }); const j = await r.json(); if (process.env.DEBUG) console.log("cron", url, r.status, JSON.stringify(j).slice(0, 300)); return { status: r.status, ...j }; };
const cfg = (q) => fetch(`${mock}/__config?${q}`);
const mockState = async () => (await fetch(`${mock}/__state`)).json();
const TRANSCRIPT_START = "Kumusta po.";

const created = { userId: null, areaId: null, areaId2: null, videoIds: [], paths: [] };
const tmp = mkdtempSync(join(tmpdir(), "captions-check-"));
let browser;
try {
  check("app is up", (await fetch(`${base}/`)).ok);
  check("mock is up", (await fetch(`${mock}/__state`)).ok);
  await fetch(`${mock}/__reset`, { method: "POST" });

  // A throwaway admin, a test team, a small clip.
  const email = `captions-check-${ts}@example.com`;
  const { data: u, error: uErr } = await db.auth.admin.createUser({ email, email_confirm: true });
  if (uErr) throw new Error(uErr.message);
  created.userId = u.user.id;
  await until(async () => (await db.from("profiles").select("id").eq("id", created.userId).maybeSingle()).data, 10_000);
  await db.from("profiles").update({ role: "admin", display_name: "Captions Check" }).eq("id", created.userId);
  const { data: area, error: aErr } = await db.from("areas").insert({ name: "Captions Mock Team", language: "Klingon", is_active: true, sort_order: 999 }).select("id").single();
  if (aErr) throw new Error(aErr.message);
  created.areaId = area.id;
  // Team A counts as connected to Instagram (the page only looks at these two fields); team B is not.
  await db.from("areas").update({ instagram_user_id: "mock-ig-user", instagram_handle: "captions_mock" }).eq("id", created.areaId);
  const { data: area2, error: a2Err } = await db.from("areas").insert({ name: "Captions Mock Team B", language: "Vulcan", is_active: true, sort_order: 999 }).select("id").single();
  if (a2Err) throw new Error(a2Err.message);
  created.areaId2 = area2.id;
  const file = join(tmp, "clip.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file]);
  const bytes = readFileSync(file);
  let n = 0;
  async function addVideo(fields) {
    const path = `${created.userId}/captions-${ts}-${n++}.mp4`;
    const { error: upErr } = await db.storage.from("videos").upload(path, bytes, { contentType: "video/mp4" });
    if (upErr) throw new Error(upErr.message);
    created.paths.push(path);
    const { data: v, error: vErr } = await db.from("videos").insert({ user_id: created.userId, area_id: created.areaId, language: "Klingon", storage_path: path, file_name: `captions-${n}.mp4`, file_size: bytes.length, mime_type: "video/mp4", duration_seconds: 4, uploader_name: "Maria", status: "pending", ...fields }).select("id").single();
    if (vErr) throw new Error(vErr.message);
    created.videoIds.push(v.id);
    await sleep(20); // distinct created_at
    return { id: v.id, path };
  }
  const script = { hook: "Hook one", body: "A short word about faith.", cta: "Learn more at the link." };
  const A = await addVideo({ script });
  const B = await addVideo({ script: null, status: "approved", reviewed_by: created.userId, reviewed_at: new Date().toISOString(), area_id: created.areaId2 });
  const C = await addVideo({ script: null, storage_path: null, file_purged_at: new Date().toISOString() });
  const shots = join(process.argv[4] ?? tmp, "shots"); mkdirSync(shots, { recursive: true });

  check("cron without the secret is 401", (await fetch(`${base}/api/cron/captions`)).status === 401);

  // Dry run: approved first, then the newest pending; the purged one is reported as skipped.
  const dry = await cron([A.id, B.id, C.id], "&dry=1");
  check("dry run is configured and reports three videos", dry.configured === true && dry.dry === true && dry.results.length === 3, JSON.stringify(dry.results));
  check("dry run: approved video comes first, then the purged one is skipped, then A", dry.results[0]?.id === B.id && dry.results[0].result === "would" && dry.results[1]?.id === C.id && dry.results[1].result === "skipped" && dry.results[2]?.id === A.id, dry.results.map((r) => r.result).join(","));
  check("dry run changed nothing", (await video(A.id, "caption_state, transcript")).caption_state === null && (await mockState()).stt.length === 0);

  // The real sweep.
  const run1 = await cron([A.id, B.id, C.id]);
  check("sweep: B done, C skipped, A done", run1.results.length === 3 && run1.results[0].result === "done" && run1.results[1].result === "skipped" && run1.results[2].result === "done", JSON.stringify(run1.results));
  const vA = await video(A.id, "transcript, transcript_language, transcript_confidence, ai_caption, ai_summary, caption_state, caption_attempts, caption_error, captioned_at");
  check("A has the transcript, language and confidence", vA?.transcript?.startsWith(TRANSCRIPT_START) && vA.transcript_language === "tgl" && Math.abs(vA.transcript_confidence - 0.98) < 0.001, JSON.stringify({ lang: vA?.transcript_language, conf: vA?.transcript_confidence }));
  check("A has the caption and the summary, state done", vA?.ai_caption?.includes("Hindi ako nag-iisa") && vA.ai_summary?.includes("prayer") && vA.caption_state === "done" && !!vA.captioned_at && vA.caption_error === null && vA.caption_attempts === 0);
  const vC = await video(C.id, "caption_state, caption_error, transcript");
  check("C (purged) is skipped without any request", vC?.caption_state === "skipped" && /no longer stored/.test(vC.caption_error ?? "") && vC.transcript === null, vC?.caption_error);
  let st = await mockState();
  check("two transcriptions, the approved video first", st.stt.length === 2 && st.stt[0].source_url?.includes(B.path) && st.stt[1].source_url?.includes(A.path), st.stt.map((c) => c.source_url?.split("/").pop()?.split("?")[0]).join(","));
  check("transcription asked for scribe_v2 without diarization or audio events", st.stt.every((c) => c.model_id === "scribe_v2" && c.diarize === "false" && c.tag_audio_events === "false"));
  check("mock fetched the signed file URL in full", st.fetched.length === 2 && st.fetched.every((f) => f.status === 200 && f.bytes === bytes.length), JSON.stringify(st.fetched[0]));
  const claudeA = st.claude[1];
  check("Claude got the transcript, the team, the name and the script", claudeA?.user.includes(TRANSCRIPT_START) && claudeA.user.includes("Captions Mock Team (Klingon)") && claudeA.user.includes("Speaker's first name: Maria") && claudeA.user.includes("A short word about faith.") && claudeA.user.includes("Language detected in the audio: tgl"), claudeA?.user.slice(0, 200));
  check("Claude got the model and a system prompt", claudeA?.model === "claude-sonnet-5-5" && claudeA.systemChars > 500, claudeA?.model);
  check("the approved video without a script says so", st.claude[0]?.user.includes("(none; they improvised)") && st.claude[0].user.includes("Captions Mock Team B (Vulcan)"));
  check("nothing left to do", (await cron([A.id, B.id, C.id])).results.length === 0);

  // The review pages, signed in through the same link our emails use.
  const { data: link, error: lErr } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (lErr) throw new Error(lErr.message);
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  await page.goto(`${base}/auth/confirm?token_hash=${link.properties.hashed_token}&type=magiclink&next=/review`);
  await page.waitForURL(/\/review/);
  const list = await page.textContent("body");
  check("review list shows the summary line", list.includes("Maria says prayer gave her peace"));
  await page.goto(`${base}/review/${A.id}`);
  const box = page.locator("textarea").first();
  check("caption box starts with the suggested caption", (await box.inputValue()) === vA.ai_caption);
  let body = await page.textContent("body");
  check("hint says it is suggested", body.includes("Suggested from what they say in the video"));
  check("page shows What they say with the summary", body.includes("What they say") && body.includes("Maria says prayer gave her peace"));
  await page.getByText(/^Transcript \(/).click();
  body = await page.textContent("body");
  check("transcript opens, labelled automatic with the language", body.includes(TRANSCRIPT_START) && /Transcript \(Tagalog, automatic/.test(body), body.match(/Transcript \([^)]*\)/)?.[0]);
  await page.screenshot({ path: join(shots, "review-suggested.png"), fullPage: true });
  await page.getByRole("button", { name: "Use the script" }).click();
  check("Use the script swaps the box to the script", (await box.inputValue()).includes("A short word about faith.") && (await page.textContent("body")).includes("script; edit as you like"));
  await page.getByRole("button", { name: "Use the suggested caption" }).click();
  check("Use the suggested caption swaps it back", (await box.inputValue()) === vA.ai_caption);
  await page.goto(`${base}/review/${B.id}`);
  body = await page.textContent("body");
  check("approved video on a team without Instagram shows the manual flow with the caption box prefilled", (await page.locator("textarea").first().inputValue()) === (await video(B.id, "ai_caption")).ai_caption && body.includes("Download video") && body.includes("Copy caption") && body.includes("Suggested from what they say"));
  check("its hint has no Use the script button (no script)", !(await page.getByRole("button", { name: "Use the script" }).count()));
  await page.screenshot({ path: join(shots, "review-manual.png"), fullPage: true });

  // Quota: the sweep stops at once, counts no attempt, and the other video is untouched.
  const D = await addVideo({ script: null });
  const D2 = await addVideo({ script: null });
  await cfg("stt=quota");
  const runQ = await cron([D.id, D2.id]);
  check("quota: one deferred result and the sweep stops", runQ.results.length === 1 && runQ.results[0].id === D2.id && runQ.results[0].result === "deferred" && /quota_exceeded/.test(runQ.results[0].detail), JSON.stringify(runQ.results));
  const vD2 = await video(D2.id, "caption_state, caption_attempts, caption_error");
  check("quota: no attempt counted, reason recorded", vD2?.caption_state === null && vD2.caption_attempts === 0 && /quota/.test(vD2.caption_error ?? ""));
  const vD = await video(D.id, "caption_state, caption_attempts, caption_error");
  check("quota: the next video was not touched", vD?.caption_state === null && vD.caption_attempts === 0 && vD.caption_error === null);
  const runQ2 = await cron([D.id, D2.id]);
  check("after the quota clears both are done", runQ2.results.length === 2 && runQ2.results.every((r) => r.result === "done"), JSON.stringify(runQ2.results));
  check("caption_error is cleared on success", (await video(D2.id, "caption_error")).caption_error === null);

  // A file the service cannot read: three counted attempts, then failed; the page says so.
  const E = await addVideo({ script });
  for (let i = 1; i <= 3; i++) { await cfg("stt=fail"); const r = await cron([E.id]); check(`unreadable file: attempt ${i} ${i < 3 ? "deferred" : "failed"}`, r.results[0]?.id === E.id && r.results[0].result === (i < 3 ? "deferred" : "failed") && r.results[0].detail.includes(`attempt ${i} of 3`), r.results[0]?.detail); }
  const vE = await video(E.id, "caption_state, caption_attempts, caption_error, transcript");
  check("unreadable file: state failed after 3 attempts, no transcript", vE?.caption_state === "failed" && vE.caption_attempts === 3 && /Could not download/.test(vE.caption_error ?? "") && vE.transcript === null);
  check("failed video is not retried", (await cron([E.id])).results.length === 0);
  await page.goto(`${base}/review/${E.id}`);
  body = await page.textContent("body");
  check("page falls back to the script and names the reason", (await page.locator("textarea").first().inputValue()).includes("A short word about faith.") && body.includes("No suggested caption: Speech to text") && body.includes("script; edit as you like"));
  await page.screenshot({ path: join(shots, "review-failed.png"), fullPage: true });

  // Claude trouble: an unusable answer counts and keeps the transcript; an outage counts nothing; the retry does not transcribe again.
  const F = await addVideo({ script: null });
  st = await mockState(); const sttBefore = st.stt.length;
  await cfg("claude=garbage");
  const rG = await cron([F.id]);
  check("garbage answer: deferred, attempt 1", rG.results[0]?.result === "deferred" && /expected JSON/.test(rG.results[0].detail) && /attempt 1 of 3/.test(rG.results[0].detail), rG.results[0]?.detail);
  const vF1 = await video(F.id, "transcript, caption_attempts, caption_state, ai_caption");
  check("garbage answer: transcript kept, no caption yet", vF1?.transcript?.startsWith(TRANSCRIPT_START) && vF1.caption_attempts === 1 && vF1.caption_state === null && vF1.ai_caption === null);
  await cfg("claude=overloaded");
  const rO = await cron([F.id]);
  check("overloaded: deferred without counting", rO.results[0]?.result === "deferred" && /overloaded/i.test(rO.results[0].detail) && !/attempt/.test(rO.results[0].detail), rO.results[0]?.detail);
  check("overloaded: attempts unchanged", (await video(F.id, "caption_attempts")).caption_attempts === 1);
  const rF = await cron([F.id]);
  check("then done", rF.results[0]?.result === "done");
  st = await mockState();
  check("the stored transcript was reused: one transcription for three tries", st.stt.length === sttBefore + 1, `${st.stt.length - sttBefore} transcriptions`);
  check("Claude was asked three times in all for that video", st.claude.length >= 3);

  // Silence.
  const G = await addVideo({ script: null });
  await cfg("stt=empty");
  const rS = await cron([G.id]);
  const vG = await video(G.id, "caption_state, caption_error, transcript");
  check("silent clip: skipped with the reason, transcript empty", rS.results[0]?.result === "skipped" && vG?.caption_state === "skipped" && /No speech/.test(vG.caption_error ?? "") && vG.transcript === "", vG?.caption_error);

  await page.close();
} catch (e) {
  failed++;
  console.log("FAIL  script error:", e?.stack ?? e);
} finally {
  if (browser) await browser.close();
  if (created.videoIds.length) await db.from("videos").delete().in("id", created.videoIds);
  if (created.paths.length) await db.storage.from("videos").remove(created.paths);
  if (created.areaId) await db.from("areas").delete().eq("id", created.areaId);
  if (created.areaId2) await db.from("areas").delete().eq("id", created.areaId2);
  if (created.userId) await db.auth.admin.deleteUser(created.userId);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
