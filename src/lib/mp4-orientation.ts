// Fixes a phone recorder quirk: iOS Safari's MediaRecorder writes portrait pixels
// (e.g. 1080x1920) AND a 90-degree rotation matrix in the MP4 track header, so every
// player shows the video sideways. When the coded frame is already portrait, a
// quarter-turn rotation can only be wrong, so we replace the matrix with identity and
// set the track's display size to the coded size. Pure byte patching, no re-encode.
// Anything we do not recognise is returned unchanged.

const IDENTITY = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

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

export type Orientation = { codedWidth: number; codedHeight: number; rotation: number; patched: boolean };

/** Reads the video track's coded size and rotation, and patches a bogus rotation in place. */
export function normalizeMp4Orientation(buf: ArrayBuffer): Orientation | null {
  const view = new DataView(buf);
  const moov = find(view, 0, buf.byteLength, "moov");
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

    let patched = false;
    if (codedHeight > codedWidth && (rotation === 90 || rotation === -90)) {
      IDENTITY.forEach((v, i) => view.setInt32(matrixAt + i * 4, v));
      view.setUint32(matrixAt + 36, codedWidth << 16);
      view.setUint32(matrixAt + 40, codedHeight << 16);
      patched = true;
      rotation = 0;
    }
    return { codedWidth, codedHeight, rotation, patched };
  }
  return null;
}

/** Returns the same File, or a patched copy when a bogus rotation was found. */
export async function normalizeOrientation(file: File): Promise<{ file: File; info: Orientation | null }> {
  const t = (file.type || "").split(";")[0];
  if (t !== "video/mp4" && t !== "video/quicktime") return { file, info: null };
  try {
    const buf = await file.arrayBuffer();
    const info = normalizeMp4Orientation(buf);
    if (!info?.patched) return { file, info };
    return { file: new File([buf], file.name, { type: file.type }), info };
  } catch {
    return { file, info: null };
  }
}
