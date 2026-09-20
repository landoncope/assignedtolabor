// Checks src/lib/picture-watch.ts against the shapes it must tell apart.
//   node scripts/dev/picture-watch-check.mjs
import { pictureLostAt } from "../../src/lib/picture-watch.ts";

const sec = (n, bytesAt) => Array.from({ length: n }, (_, i) => ({ at: (i + 1) * 1000, bytes: bytesAt(i + 1) }));
const cases = [
  ["healthy 8 Mbps for 3 minutes", sec(180, () => 1_020_000), null],
  ["iPhone on iOS 26: picture dies at 13 s, sound continues", sec(40, (t) => (t <= 13 ? 1_050_000 : 24_500)), 13000],
  ["same clip, checked 4 s after the freeze (too early to say)", sec(17, (t) => (t <= 13 ? 1_050_000 : 24_500)), null],
  ["same clip, checked 6 s after the freeze", sec(19, (t) => (t <= 13 ? 1_050_000 : 24_500)), 13000],
  ["camera stalls and the canvas repeats one frame", sec(40, (t) => (t <= 20 ? 700_000 : 31_000)), 20000],
  ["browser flushes picture in 5 s bursts, healthy", sec(120, (t) => (t % 5 === 0 ? 5_000_000 : 24_000)), null],
  ["5 s bursts, picture dies at 30 s", sec(60, (t) => (t <= 30 && t % 5 === 0 ? 5_000_000 : 24_000)), 30000],
  ["low bitrate but alive (static scene, 600 kbps)", sec(120, () => 99_000), null],
  ["scene goes quiet but picture continues (8 Mbps then 1.2 Mbps)", sec(120, (t) => (t <= 30 ? 1_000_000 : 175_000)), null],
  ["short clip", sec(5, () => 1_000_000), null],
  ["no slices at all", [], null],
];
let failed = 0;
for (const [name, slices, want] of cases) {
  const got = pictureLostAt(slices);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${got === null ? "picture fine" : `lost at ${got / 1000}s`}${ok ? "" : ` (wanted ${want})`}`);
}
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
