/**
 * Notices, while a clip is still recording, that the picture has stopped reaching the
 * file. Added 2026-09-19: at that day's event every iPhone on iOS 26 lost its picture 10
 * to 24 s into a clip while the sound carried on, and nothing on the page could tell.
 * The camera, the preview and the draw loop were all healthy; the frames died between
 * the canvas and the encoder, so the only witness is the file itself.
 *
 * The recorder hands over its data in one-second slices. With picture a slice is
 * hundreds of kilobytes; with sound alone it is about 24 KB. The check is deliberately
 * slow to accuse: it only arms once it has seen this clip's slices carry picture, it
 * allows for browsers that flush in bursts, and it needs the sound to keep arriving
 * (proof that the recorder is still writing) before it calls the picture lost.
 */
export type Slice = { /** ms since the clip started */ at: number; bytes: number };

/** A slice this large holds picture: a second of sound alone is ~24 KB at 192 kbps. */
const PICTURE_SLICE_BYTES = 100_000;
/** Below this many bytes a second the file is growing by sound only. */
const SOUND_ONLY_BYTES_PER_SEC = 60_000;
const MIN_QUIET_MS = 6000;

/** Where the picture stopped (ms into the clip), or null while the file grows as a video should. */
export function pictureLostAt(slices: Slice[]): number | null {
  const big = slices.filter((s) => s.bytes >= PICTURE_SLICE_BYTES);
  if (big.length < 3) return null; // not armed: this clip has not shown what picture looks like yet
  let longestGap = big[0].at;
  for (let i = 1; i < big.length; i++) longestGap = Math.max(longestGap, big[i].at - big[i - 1].at);
  const lastPicture = big[big.length - 1].at;
  const after = slices.filter((s) => s.at > lastPicture);
  const now = slices[slices.length - 1].at;
  const quiet = now - lastPicture;
  if (quiet < Math.max(MIN_QUIET_MS, 3 * longestGap)) return null;
  if (after.length < 4) return null; // nothing is arriving at all: cannot tell sound from silence
  const rate = after.reduce((a, s) => a + s.bytes, 0) / (quiet / 1000);
  return rate < SOUND_ONLY_BYTES_PER_SEC ? lastPicture : null;
}
