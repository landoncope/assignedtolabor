// Checks that the upload flow keeps a half-written script across a reload and that
// "Start fresh" clears it (src/lib/upload-draft.ts). Also screenshots a long script in
// the recorder to show the scrolling script box.
//   node scripts/dev/draft-check.mjs http://127.0.0.1:3001 fake-cam.y4m out-dir
import { chromium } from "playwright-core";
const [base = "http://127.0.0.1:3001", camFile, outDir = "."] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${camFile}`, "--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["camera", "microphone"] });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 200)); });
let failed = 0;
const check = (name, ok) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}`); if (!ok) failed++; };

const LONG = "I want to tell you about the week everything changed for me. ".repeat(9).trim(); // ~560 chars
await page.goto(`${base}/upload`, { waitUntil: "networkidle" });
check("fresh visit starts at the welcome screen", await page.getByRole("button", { name: "Get started" }).isVisible());
check("nothing is saved before anything is typed", (await page.evaluate(() => localStorage.getItem("atl-upload-draft"))) === null);
await page.getByRole("button", { name: "Get started" }).click();
await page.getByRole("button", { name: "I understand" }).click();
await page.getByRole("button", { name: "I understand" }).click();
await page.getByRole("button", { name: "This changed everything for me." }).click();
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Write my own" }).click();
await page.locator("textarea").fill(LONG);
await page.waitForTimeout(300);

await page.reload({ waitUntil: "networkidle" });
check("after a reload the body step is back", await page.getByRole("heading", { name: "What do you want to share?" }).isVisible());
check("the typed script survived", (await page.locator("textarea").inputValue()) === LONG);
check("the restore note shows", await page.getByText("Picked up where you left off.").isVisible());
await page.getByRole("button", { name: "Next" }).click();
check("the note goes away on the next step", !(await page.getByText("Picked up where you left off.").isVisible()));
check("the hook chosen earlier is still chosen", (await page.evaluate(() => JSON.parse(localStorage.getItem("atl-upload-draft")).hook)) === "This changed everything for me.");

// Long script in the recorder: the box is capped and scrolls.
await page.getByRole("button", { name: /come and see\.$/ }).first().click();
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("radio", { name: "English", exact: true }).click();
await page.getByRole("button", { name: "Record now" }).click();
await page.waitForFunction(() => { const v = document.querySelector("video"); return v && v.videoWidth > 0; }, null, { timeout: 20000 });
await page.waitForTimeout(500);
const box = await page.evaluate(() => {
  const hint = [...document.querySelectorAll("span")].find((s) => s.textContent.includes("scroll for more"));
  const el = hint?.parentElement?.firstElementChild;
  const frame = document.querySelector("video")?.parentElement;
  return el && frame ? { scrollable: el.scrollHeight > el.clientHeight + 6, boxPct: Math.round((el.parentElement.getBoundingClientRect().height / frame.getBoundingClientRect().height) * 100), hint: !!hint } : null;
});
check(`the long script box is capped (${box?.boxPct}% of the frame) and scrolls`, !!box && box.scrollable && box.boxPct <= 55);
check("the scroll hint shows", !!box?.hint);
await page.screenshot({ path: `${outDir}/long-script.png` });
await page.evaluate(() => { const hint = [...document.querySelectorAll("span")].find((s) => s.textContent.includes("scroll for more")); const el = hint.parentElement.firstElementChild; el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll")); });
await page.waitForTimeout(200);
check("the hint disappears at the end", !(await page.getByText("scroll for more").isVisible()));

// A reload on the record step lands on the language step with the script kept.
await page.reload({ waitUntil: "networkidle" });
check("a reload while recording lands on the language step", await page.getByRole("button", { name: "Record now" }).isVisible());
await page.getByRole("button", { name: "Start fresh" }).click();
check("Start fresh returns to the welcome screen", await page.getByRole("button", { name: "Get started" }).isVisible());
check("and clears the draft", (await page.evaluate(() => localStorage.getItem("atl-upload-draft"))) === null);

// A stale draft is ignored.
await page.evaluate(() => localStorage.setItem("atl-upload-draft", JSON.stringify({ v: 1, savedAt: Date.now() - 25 * 3600 * 1000, step: "cta", consentIdx: 0, hook: "x", hookCustom: "", tplKey: null, blanks: ["", ""], bodyCustom: "", cta: null, ctaCustom: "", dest: "lang:English", otherLanguage: "", name: "Old" })));
await page.reload({ waitUntil: "networkidle" });
check("a draft older than a day is ignored", await page.getByRole("button", { name: "Get started" }).isVisible());
await page.evaluate(() => localStorage.removeItem("atl-upload-draft"));
await browser.close();
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
