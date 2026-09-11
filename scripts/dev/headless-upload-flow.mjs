// Drives the real /upload flow in this machine's Chrome with a fake camera: two clips,
// merge, upload. Prints the review-screen dimensions line and the "Thank you" state.
// Usage: node scripts/dev/headless-upload-flow.mjs <base url> <fake-cam.y4m> [name]
import { chromium } from "playwright-core";
const [base = "http://127.0.0.1:3001", camFile, name = "headless-flow"] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${camFile}`, "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 200)); });
const t = (ms) => page.waitForTimeout(ms);
await page.goto(`${base}/upload`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Get started" }).click();
await page.getByRole("button", { name: "I understand" }).click();
await page.getByRole("button", { name: "I understand" }).click();
await page.getByRole("button", { name: "This changed everything for me." }).click();
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: /^Testimony/ }).click();
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: /come and see\.$/ }).first().click();
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: /Philippines/ }).click();
await page.locator('label:has-text("first name") input').fill(name);
await page.getByRole("button", { name: "Record now" }).click();
await page.waitForFunction(() => { const v = document.querySelector("video"); return v && v.videoWidth > 0; }, null, { timeout: 20000 });
const src = await page.evaluate(() => { const v = document.querySelector("video"); return `${v.videoWidth}x${v.videoHeight}`; });
console.log("camera stream:", src);
await page.getByRole("button", { name: "Record clip" }).click();   // tips + countdown, then records
await page.getByRole("button", { name: "Stop clip" }).waitFor({ timeout: 15000 });
await t(2500);
await page.getByRole("button", { name: "Stop clip" }).click();
await t(1000);
await page.getByRole("button", { name: "Record clip" }).click();   // second clip starts immediately
await page.getByRole("button", { name: "Stop clip" }).waitFor({ timeout: 5000 });
await t(2500);
await page.getByRole("button", { name: "Stop clip" }).click();
await t(1000);
console.log("clips:", await page.locator("text=/\\d clips?/").textContent());
await page.getByRole("button", { name: "Done" }).click();
await page.getByText("Looks good?").waitFor({ timeout: 120000 });
await page.locator("p.text-neutral-500:has-text('×')").waitFor({ timeout: 20000 });
console.log("review line:", (await page.locator("p.text-neutral-500:has-text('×')").textContent()).trim());
await page.getByRole("button", { name: "Send it in" }).click();
await page.getByText("Thank you").waitFor({ timeout: 120000 });
console.log("RESULT: PASS (uploaded)");
await browser.close();
