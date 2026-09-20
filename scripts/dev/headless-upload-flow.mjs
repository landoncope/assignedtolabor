// Drives the real /upload flow in this machine's Chrome with a fake camera: two clips,
// merge, upload. Prints the review-screen dimensions line and the "Thank you" state.
// Usage: node scripts/dev/headless-upload-flow.mjs <base url> <fake-cam.y4m> [name] [--query rec=camera] [--save out.mp4] [--no-upload] [--clip-seconds 2.5] [--clips 2]
//   --query       appended to /upload, e.g. rec=camera to record the camera track directly (needs a 9:16 portrait y4m)
//   --save        writes the recorded (merged) file to disk from the review step, for ffprobe
//   --no-upload   stops at the review step (captcha is enforced on the live project)
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
const argv = process.argv.slice(2);
const opt = (flag, fallback = null) => { const i = argv.indexOf(flag); if (i < 0) return fallback; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return false; argv.splice(i, 1); return true; };
const query = opt("--query"), savePath = opt("--save"), clipMs = Number(opt("--clip-seconds", "2.5")) * 1000, clipCount = Number(opt("--clips", "2")), noUpload = flag("--no-upload");
const [base = "http://127.0.0.1:3001", camFile, name = "headless-flow"] = argv;
const browser = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${camFile}`, "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 200));
  else if (/\[recorder\]|\[merge-clips\]/.test(m.text())) console.log(m.text().slice(0, 240));
});
const t = (ms) => page.waitForTimeout(ms);
await page.goto(`${base}/upload${query ? `?${query}` : ""}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Get started" }).click();
await page.getByRole("button", { name: "I understand" }).click();
await page.getByRole("button", { name: "I understand" }).click();
await page.getByRole("button", { name: "This changed everything for me." }).click();
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: /^Testimony/ }).click();
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: /come and see\.$/ }).first().click();
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("radio", { name: "Tagalog", exact: true }).click();   // a team language; English and "Another language" are the other options
await page.locator('label:has-text("first name") input').fill(name);
await page.getByRole("button", { name: "Record now" }).click();
await page.waitForFunction(() => { const v = document.querySelector("video"); return v && v.videoWidth > 0; }, null, { timeout: 20000 });
const src = await page.evaluate(() => { const v = document.querySelector("video"); return `${v.videoWidth}x${v.videoHeight}`; });
console.log("camera stream:", src);
await page.getByRole("button", { name: "Record clip" }).click();   // tips + countdown, then records
await page.getByRole("button", { name: "Stop clip" }).waitFor({ timeout: 15000 });
await t(clipMs);
await page.getByRole("button", { name: "Stop clip" }).click();
await t(1000);
for (let i = 1; i < clipCount; i++) {
  await page.getByRole("button", { name: "Record clip" }).click();   // later clips start immediately
  await page.getByRole("button", { name: "Stop clip" }).waitFor({ timeout: 5000 });
  await t(clipMs);
  await page.getByRole("button", { name: "Stop clip" }).click();
  await t(1000);
}
console.log("clips:", await page.locator("text=/\\d clips?/").textContent());
await page.getByRole("button", { name: "Done" }).click();
await page.getByText("Looks good?").waitFor({ timeout: 120000 });
await page.locator("p.text-neutral-500:has-text('×')").waitFor({ timeout: 20000 });
console.log("review line:", (await page.locator("p.text-neutral-500:has-text('×')").textContent()).trim());
if (savePath) {
  const b64 = await page.evaluate(async () => {
    const src = document.querySelector("video[controls]").src;
    const bytes = new Uint8Array(await (await fetch(src)).arrayBuffer());
    let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  writeFileSync(savePath, Buffer.from(b64, "base64"));
  console.log("saved:", savePath);
}
if (noUpload) { console.log("RESULT: PASS (recorded and merged; upload skipped)"); await browser.close(); process.exit(0); }
await page.getByRole("button", { name: "Send it in" }).click();
// The heading, exactly: a loose text match once passed on helper copy that contained the phrase (2026-09-18).
await page.getByRole("heading", { name: "Thank you", exact: true }).waitFor({ timeout: 120000 });
console.log("RESULT: PASS (uploaded)");
await browser.close();
