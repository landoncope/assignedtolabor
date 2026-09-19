// Opens the recorder with a fake camera as a desktop browser and as an iPhone, and
// reports which zoom button starts pressed (expected: 1× on desktop, 1.5× on a phone).
// Needs no sign-in. Usage: node scripts/dev/zoom-default-check.mjs <base url> [fake-cam.y4m]
import { chromium, devices } from "playwright-core";
const [base = "http://127.0.0.1:3001", camFile] = process.argv.slice(2);
const browser = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", ...(camFile ? [`--use-file-for-fake-video-capture=${camFile}`] : [])],
});
async function pressedZoom(options) {
  const context = await browser.newContext({ ...options, permissions: ["camera", "microphone"] });
  const page = await context.newPage();
  await page.goto(`${base}/upload`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByRole("button", { name: "I understand" }).click();
  await page.getByRole("button", { name: "Skip the script, I know what I'll say" }).click();
  await page.getByRole("button", { name: "Record now" }).click();
  await page.waitForFunction(() => { const v = document.querySelector("video"); return v && v.videoWidth > 0; }, null, { timeout: 20000 });
  const pressed = (await page.locator('[aria-label="Zoom"] button[aria-pressed="true"]').textContent())?.trim();
  await context.close();
  return pressed;
}
const iphone = { ...devices["iPhone 13"] };
delete iphone.defaultBrowserType; // a launcher hint, not a context option
const desktop = await pressedZoom({ viewport: { width: 1280, height: 800 } });
const phone = await pressedZoom(iphone);
console.log("desktop starts at", desktop, "| iPhone starts at", phone);
console.log(desktop === "1×" && phone === "1.5×" ? "RESULT: PASS" : "RESULT: FAIL");
await browser.close();
