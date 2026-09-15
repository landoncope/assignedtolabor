// Drives /upload using the new skip link and confirms it reaches the language step directly.
import { chromium } from "playwright-core";
const base = process.argv[2] || "http://127.0.0.1:3001";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(`${base}/upload`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Get started" }).click();
await page.getByRole("button", { name: "I understand" }).click();
await page.getByRole("button", { name: "I understand" }).click();
console.log("hook step shows skip link:", await page.getByRole("button", { name: "Skip the script, I know what I'll say" }).isVisible());
await page.getByRole("button", { name: "Skip the script, I know what I'll say" }).click();
console.log("landed on:", await page.locator("h2").first().textContent());
await browser.close();
