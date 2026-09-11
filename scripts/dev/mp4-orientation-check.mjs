// Prints the video track's coded size and rotation for an MP4 (no changes written).
// Usage: node scripts/dev/mp4-orientation-check.mjs file.mp4
import { readFileSync } from "node:fs";
const { normalizeMp4Orientation } = await import(process.cwd() + "/src/lib/mp4-orientation.ts");
const b = readFileSync(process.argv[2]);
console.log(JSON.stringify(normalizeMp4Orientation(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))));
