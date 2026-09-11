// Runs the /dev/merge self-test in this machine's own Chrome, headless.
// Usage: node scripts/dev/headless-merge-test.mjs [url]   (dev server must be running)
import { chromium } from "playwright-core";
const url = process.argv[2] || "http://127.0.0.1:3000/dev/merge";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(url, { waitUntil: "networkidle" });
await page.click("#run-upload");
await page.waitForFunction(() => /RESULT:/.test(document.querySelector("#log")?.textContent || ""), null, { timeout: 180000 });
console.log(await page.textContent("#log"));
await browser.close();
