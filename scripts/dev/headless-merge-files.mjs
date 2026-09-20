// Merges clips from disk through the real in-browser merger (ffmpeg.wasm) and prints
// what happened to their orientation. Made to prove that iPhone-style clips (landscape
// pixels plus a rotation matrix) survive the merge upright.
//   ENABLE_DEV_PAGES=1 npx next build && ENABLE_DEV_PAGES=1 npx next start -p 3001
//   node scripts/dev/headless-merge-files.mjs http://127.0.0.1:3001/dev/merge a.mp4 b.mp4
import { chromium } from "playwright-core";
const [url, ...files] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") console.log(`[console.${m.type()}]`, m.text().slice(0, 300)); });
await page.goto(url, { waitUntil: "networkidle" });
await page.locator("#merge-files").setInputFiles(files);
await page.waitForFunction(() => /RESULT:/.test(document.querySelector("#log")?.textContent ?? ""), null, { timeout: 180000 });
console.log(await page.locator("#log").textContent());
await browser.close();
