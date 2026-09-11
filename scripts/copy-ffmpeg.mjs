// Copies the ffmpeg.wasm runtime into public/ffmpeg so the browser loads it from our
// own origin. @ffmpeg/ffmpeg always starts its worker as an ES module, and a module
// worker can only import the ESM build of the core, so we ship the ESM core plus the
// library's own ESM worker (and the two small modules it imports). Runs on postinstall.
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const nm = join(process.cwd(), "node_modules");
const out = join(process.cwd(), "public", "ffmpeg");
mkdirSync(out, { recursive: true });

const files = [
  ["@ffmpeg/core/dist/esm/ffmpeg-core.js", "ffmpeg-core.js"],
  ["@ffmpeg/core/dist/esm/ffmpeg-core.wasm", "ffmpeg-core.wasm"],
  ["@ffmpeg/ffmpeg/dist/esm/worker.js", "worker.js"],
  ["@ffmpeg/ffmpeg/dist/esm/const.js", "const.js"],
  ["@ffmpeg/ffmpeg/dist/esm/errors.js", "errors.js"],
];
for (const [src, name] of files) copyFileSync(join(nm, src), join(out, name));
console.log(`copied ffmpeg runtime (${files.length} files) to public/ffmpeg`);
