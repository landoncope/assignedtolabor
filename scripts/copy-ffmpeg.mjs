// Copies the ffmpeg.wasm runtime into public/ffmpeg so the browser can load it from
// our own origin (no CDN, no cross-origin isolation headers needed). Runs on postinstall.
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const nm = join(process.cwd(), "node_modules");
const out = join(process.cwd(), "public", "ffmpeg");
mkdirSync(out, { recursive: true });

const files = [
  ["@ffmpeg/core/dist/umd/ffmpeg-core.js", "ffmpeg-core.js"],
  ["@ffmpeg/core/dist/umd/ffmpeg-core.wasm", "ffmpeg-core.wasm"],
  ["@ffmpeg/ffmpeg/dist/umd/814.ffmpeg.js", "814.ffmpeg.js"],
];
for (const [src, name] of files) copyFileSync(join(nm, src), join(out, name));
console.log(`copied ffmpeg runtime (${files.length} files) to public/ffmpeg`);
