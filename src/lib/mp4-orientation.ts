// Reads the coded size and rotation tag of an MP4's video track (diagnostics only).
//
// History: an earlier version "fixed" files whose coded frame was portrait but tagged
// with a quarter-turn rotation, assuming the tag was bogus. It was not: iOS Safari
// stores the sensor frame rotated into a portrait buffer and tags it, and honoring the
// tag is what makes the video play upright. Never strip rotation metadata.

type Box = { type: string; start: number; end: number; payload: number };

function* boxes(view: DataView, start: number, end: number): Generator<Box> {
  let p = start;
  while (p + 8 <= end) {
    let size = view.getUint32(p);
    const type = String.fromCharCode(view.getUint8(p + 4), view.getUint8(p + 5), view.getUint8(p + 6), view.getUint8(p + 7));
    let payload = p + 8;
    if (size === 1) {
      const hi = view.getUint32(p + 8), lo = view.getUint32(p + 12);
      size = hi * 2 ** 32 + lo; payload = p + 16;
    } else if (size === 0) size = end - p;
    if (size < 8 || p + size > end) return;
    yield { type, start: p, end: p + size, payload };
    p += size;
  }
}

function find(view: DataView, start: number, end: number, type: string): Box | null {
  for (const b of boxes(view, start, end)) if (b.type === type) return b;
  return null;
}

export type Orientation = { codedWidth: number; codedHeight: number; rotation: number };

type VideoTrack = Orientation & { matrixAt: number };

function locateVideoTrack(view: DataView): VideoTrack | null {
  const moov = find(view, 0, view.byteLength, "moov");
  if (!moov) return null;
  for (const trak of boxes(view, moov.payload, moov.end)) {
    if (trak.type !== "trak") continue;
    const tkhd = find(view, trak.payload, trak.end, "tkhd");
    const mdia = find(view, trak.payload, trak.end, "mdia");
    if (!tkhd || !mdia) continue;
    const hdlr = find(view, mdia.payload, mdia.end, "hdlr");
    if (!hdlr) continue;
    const handler = String.fromCharCode(...[8, 9, 10, 11].map((i) => view.getUint8(hdlr.payload + i)));
    if (handler !== "vide") continue;

    // Coded size from the first visual sample entry (avc1 / hvc1 / ...).
    const minf = find(view, mdia.payload, mdia.end, "minf");
    const stbl = minf && find(view, minf.payload, minf.end, "stbl");
    const stsd = stbl && find(view, stbl.payload, stbl.end, "stsd");
    if (!stsd) return null;
    const entry = stsd.payload + 8; // version/flags + entry_count
    const entryPayload = entry + 8;  // box header of the sample entry
    const codedWidth = view.getUint16(entryPayload + 24);
    const codedHeight = view.getUint16(entryPayload + 26);

    const version = view.getUint8(tkhd.payload);
    const matrixAt = tkhd.payload + (version === 1 ? 52 : 40);
    const m = Array.from({ length: 9 }, (_, i) => view.getInt32(matrixAt + i * 4));
    // Rotation from the 2x2 part, in 16.16 fixed point: [a b; c d].
    const [a, b, , c, d] = m;
    let rotation = 0;
    if (a === 0 && d === 0 && b !== 0 && c !== 0) rotation = b > 0 ? 90 : -90;
    else if (a < 0 && d < 0) rotation = 180;

    return { codedWidth, codedHeight, rotation, matrixAt };
  }
  return null;
}

/** Reads the video track's coded size and rotation without modifying anything. */
export function readMp4Orientation(buf: ArrayBuffer): Orientation | null {
  const t = locateVideoTrack(new DataView(buf));
  return t ? { codedWidth: t.codedWidth, codedHeight: t.codedHeight, rotation: t.rotation } : null;
}

/**
 * A stream-copy merge must carry the clips' display matrix into the merged file: an
 * iPhone clip recorded straight from the camera is landscape pixels plus a quarter
 * turn, and without the matrix it plays sideways. ffmpeg keeps it; this is the guard
 * in case a build of it does not. If the merged file has the same coded size as the
 * first clip but a different matrix, the clip's matrix is written over it in place.
 * `clipHead` is the start of the first clip (its moov leads the file). Returns true
 * when it had to repair. Never call this on a re-encode: there ffmpeg has already
 * turned the pixels and rightly dropped the matrix (the coded size differs, so it
 * would refuse anyway).
 */
export function restoreMp4Orientation(clipHead: ArrayBuffer, merged: Uint8Array): boolean {
  const src = new DataView(clipHead);
  const dst = new DataView(merged.buffer, merged.byteOffset, merged.byteLength);
  const from = locateVideoTrack(src), to = locateVideoTrack(dst);
  if (!from || !to) return false;
  if (from.codedWidth !== to.codedWidth || from.codedHeight !== to.codedHeight) return false;
  let same = true;
  for (let i = 0; i < 36 && same; i++) same = src.getUint8(from.matrixAt + i) === dst.getUint8(to.matrixAt + i);
  if (same) return false;
  for (let i = 0; i < 36; i++) dst.setUint8(to.matrixAt + i, src.getUint8(from.matrixAt + i));
  return true;
}
