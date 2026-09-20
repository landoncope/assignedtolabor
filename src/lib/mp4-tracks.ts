/**
 * Finds a frozen picture in a recorded MP4 on the device, before the upload. Written
 * 2026-09-19: on iOS 26 WebKit's MP4 writer can drop the picture from some point on
 * while keeping the sound (WebKit bugs 299164, 320943, 315091), and the file looks fine
 * until someone watches it. Eleven videos from that day's event have 10 to 24 s of
 * picture under 17 to 184 s of sound.
 *
 * In those files the picture track is not shorter than the sound track: its last frame
 * is simply given a duration of a minute or more. So the test is not "which track ends
 * first" but "what is the longest time one frame is held", counting a track that ends
 * early as holding its last frame to the end of the sound.
 *
 * MediaRecorder writes fragmented MP4, so the frame times come from the fragment tables
 * (moof/traf/tfdt/trun); plain MP4s (our merged files) use the sample table (stts). Only
 * box headers and the small moov/moof boxes are read, never the media, so a 200 MB clip
 * costs a few hundred tiny reads. Returns null for anything that is not an MP4 it can read.
 */
export type PictureReport = {
  /** Where the picture track ends, in seconds. */
  picture: number;
  /** Where the sound track ends, in seconds (0 when there is no sound). */
  sound: number;
  /** The longest time a single frame stays on screen, and when that starts. */
  longestHold: { at: number; seconds: number };
};

type Track = { id: number; type: string; timescale: number; trexDuration: number; cursor: number; holdAt: number; hold: number };

const u32 = (v: DataView, at: number) => v.getUint32(at);
const u64 = (v: DataView, at: number) => v.getUint32(at) * 2 ** 32 + v.getUint32(at + 4);
const fourcc = (v: DataView, at: number) => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));

function* children(v: DataView, start: number, end: number): Generator<{ type: string; payload: number; end: number }> {
  let p = start;
  while (p + 8 <= end) {
    let size = u32(v, p), payload = p + 8;
    if (size === 1) { size = u64(v, p + 8); payload = p + 16; } else if (size === 0) size = end - p;
    if (size < 8 || p + size > end) return;
    yield { type: fourcc(v, p + 4), payload, end: p + size };
    p += size;
  }
}
function child(v: DataView, start: number, end: number, type: string) {
  for (const b of children(v, start, end)) if (b.type === type) return b;
  return null;
}
function addSample(t: Track, duration: number) {
  if (duration > t.hold) { t.hold = duration; t.holdAt = t.cursor; }
  t.cursor += duration;
}

function readMoov(v: DataView, tracks: Map<number, Track>) {
  for (const box of children(v, 0, v.byteLength)) {
    if (box.type === "trak") {
      const tkhd = child(v, box.payload, box.end, "tkhd");
      const mdia = child(v, box.payload, box.end, "mdia");
      const mdhd = mdia && child(v, mdia.payload, mdia.end, "mdhd");
      const hdlr = mdia && child(v, mdia.payload, mdia.end, "hdlr");
      if (!tkhd || !mdia || !mdhd || !hdlr) continue;
      const id = u32(v, tkhd.payload + (v.getUint8(tkhd.payload) === 1 ? 20 : 12));
      const timescale = u32(v, mdhd.payload + (v.getUint8(mdhd.payload) === 1 ? 20 : 12));
      const t: Track = { id, type: fourcc(v, hdlr.payload + 8), timescale, trexDuration: 0, cursor: 0, holdAt: 0, hold: 0 };
      tracks.set(id, t);
      // Plain MP4: the sample table lists every frame's duration. Empty in fragmented files.
      const minf = child(v, mdia.payload, mdia.end, "minf");
      const stbl = minf && child(v, minf.payload, minf.end, "stbl");
      const stts = stbl && child(v, stbl.payload, stbl.end, "stts");
      if (stts) {
        const entries = u32(v, stts.payload + 4);
        for (let i = 0, p = stts.payload + 8; i < entries && p + 8 <= stts.end; i++, p += 8) {
          const count = u32(v, p), delta = u32(v, p + 4);
          if (count > 0) { addSample(t, delta); t.cursor += (count - 1) * delta; }
        }
      }
    } else if (box.type === "mvex") {
      for (const trex of children(v, box.payload, box.end)) {
        if (trex.type !== "trex") continue;
        const t = tracks.get(u32(v, trex.payload + 4));
        if (t) t.trexDuration = u32(v, trex.payload + 12);
      }
    }
  }
}

function readMoof(v: DataView, tracks: Map<number, Track>) {
  for (const traf of children(v, 0, v.byteLength)) {
    if (traf.type !== "traf") continue;
    const tfhd = child(v, traf.payload, traf.end, "tfhd");
    if (!tfhd) continue;
    const tfFlags = u32(v, tfhd.payload) & 0xffffff;
    const t = tracks.get(u32(v, tfhd.payload + 4));
    if (!t) continue;
    let at = tfhd.payload + 8;
    if (tfFlags & 0x1) at += 8;  // base_data_offset
    if (tfFlags & 0x2) at += 4;  // sample_description_index
    const defaultDuration = tfFlags & 0x8 ? u32(v, at) : t.trexDuration;
    const tfdt = child(v, traf.payload, traf.end, "tfdt");
    if (tfdt) {
      // A fragment that starts later than the last one ended: the last frame was held across the gap.
      const base = v.getUint8(tfdt.payload) === 1 ? u64(v, tfdt.payload + 4) : u32(v, tfdt.payload + 4);
      if (base > t.cursor && t.cursor > 0) addSample(t, base - t.cursor); else t.cursor = Math.max(t.cursor, base);
    }
    for (const trun of children(v, traf.payload, traf.end)) {
      if (trun.type !== "trun") continue;
      const flags = u32(v, trun.payload) & 0xffffff;
      const count = u32(v, trun.payload + 4);
      if (!(flags & 0x100)) { if (count > 0) { addSample(t, defaultDuration); t.cursor += (count - 1) * defaultDuration; } continue; }
      let p = trun.payload + 8 + (flags & 0x1 ? 4 : 0) + (flags & 0x4 ? 4 : 0);
      const stride = 4 + (flags & 0x200 ? 4 : 0) + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0);
      for (let i = 0; i < count && p + 4 <= trun.end; i++, p += stride) addSample(t, u32(v, p));
    }
  }
}

export async function readPicture(blob: Blob): Promise<PictureReport | null> {
  try {
    const tracks = new Map<number, Track>();
    let at = 0;
    while (at + 8 <= blob.size) {
      const head = new DataView(await blob.slice(at, at + 16).arrayBuffer());
      let size = u32(head, 0), headerSize = 8;
      if (size === 1) { if (head.byteLength < 16) break; size = u64(head, 8); headerSize = 16; } else if (size === 0) size = blob.size - at;
      if (size < 8) break;
      const type = fourcc(head, 4);
      if (type === "moov" || type === "moof") {
        const body = new DataView(await blob.slice(at + headerSize, Math.min(at + size, blob.size)).arrayBuffer());
        if (type === "moov") readMoov(body, tracks); else readMoof(body, tracks);
      }
      at += size;
    }
    const all = [...tracks.values()];
    const video = all.find((t) => t.type === "vide" && t.timescale > 0 && t.cursor > 0);
    if (!video) return null;
    const audio = all.find((t) => t.type === "soun" && t.timescale > 0);
    const picture = video.cursor / video.timescale, sound = audio ? audio.cursor / audio.timescale : 0;
    let longestHold = { at: video.holdAt / video.timescale, seconds: video.hold / video.timescale };
    // A picture track that simply ends early holds its last frame until the sound ends.
    if (sound - picture > longestHold.seconds) longestHold = { at: picture, seconds: sound - picture };
    return { picture, sound, longestHold };
  } catch {
    return null;
  }
}

/** A frame held longer than this is a frozen picture, not a slow camera (8 fps is 0.125 s a frame). */
export const FROZEN_PICTURE_SECONDS = 1.5;

/**
 * The handler types of an MP4's tracks in file order, e.g. ["vide", "soun"]. Chrome
 * writes them in whichever order their first data arrived, so two clips from one
 * session can disagree; the merger needs to know (src/lib/merge-clips.ts).
 */
export async function readTrackOrder(blob: Blob): Promise<string[] | null> {
  try {
    let at = 0;
    while (at + 8 <= blob.size) {
      const head = new DataView(await blob.slice(at, at + 16).arrayBuffer());
      let size = u32(head, 0), headerSize = 8;
      if (size === 1) { if (head.byteLength < 16) break; size = u64(head, 8); headerSize = 16; } else if (size === 0) size = blob.size - at;
      if (size < 8) break;
      if (fourcc(head, 4) === "moov") {
        const tracks = new Map<number, Track>();
        readMoov(new DataView(await blob.slice(at + headerSize, Math.min(at + size, blob.size)).arrayBuffer()), tracks);
        return tracks.size ? [...tracks.values()].map((t) => t.type) : null;
      }
      at += size;
    }
    return null;
  } catch {
    return null;
  }
}
