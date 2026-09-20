// Says whether the picture in MP4 files freezes, using the same reader the recorder uses
// on the device (src/lib/mp4-tracks.ts).
//   node scripts/dev/mp4-tracks-check.mjs a.mp4 [b.mp4 ...]
import { openAsBlob } from "node:fs";
const { readPicture, FROZEN_PICTURE_SECONDS } = await import(process.cwd() + "/src/lib/mp4-tracks.ts");
for (const f of process.argv.slice(2)) {
  const blob = await openAsBlob(f);
  const t0 = performance.now();
  const r = await readPicture(blob);
  const verdict = !r ? "not readable" : r.longestHold.seconds > FROZEN_PICTURE_SECONDS ? `FROZEN: one frame held ${r.longestHold.seconds.toFixed(1)}s from ${r.longestHold.at.toFixed(1)}s` : `ok (longest frame ${r.longestHold.seconds.toFixed(2)}s)`;
  console.log(`${f.split("/").pop()}: ${r ? `picture ${r.picture.toFixed(1)}s, sound ${r.sound.toFixed(1)}s, ` : ""}${verdict}  [${Math.round(performance.now() - t0)} ms, ${(blob.size / 1048576).toFixed(1)} MB]`);
}
