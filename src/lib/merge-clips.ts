// In-browser clip merger (ffmpeg.wasm). The recorder keeps each clip as its own file
// so any one can be deleted; when the user is done we stitch the kept clips into one
// file on the device. The runtime is served from /ffmpeg (copied on postinstall) and
// only fetched the first time a merge runs.
//
// @ffmpeg/ffmpeg always creates its worker with { type: "module" }, so the core must
// be the ESM build and every URL must be a plain same-origin URL (blob: URLs are not
// reliably importable from module workers, especially on Safari).
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import { restoreMp4Orientation } from "./mp4-orientation";
import { readTrackOrder } from "./mp4-tracks";

let ffmpegPromise: Promise<FFmpeg> | null = null;
const recentLogs: string[] = [];

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const ff = new FFmpeg();
      ff.on("log", ({ message }) => {
        recentLogs.push(message);
        if (recentLogs.length > 40) recentLogs.shift();
      });
      const base = `${window.location.origin}/ffmpeg`;
      await ff.load({
        coreURL: `${base}/ffmpeg-core.js`,
        wasmURL: `${base}/ffmpeg-core.wasm`,
        classWorkerURL: `${base}/worker.js`,
      });
      return ff;
    })().catch((e) => {
      ffmpegPromise = null;
      throw e;
    });
  }
  return ffmpegPromise;
}

/**
 * Recorder format preference. H.264 + AAC in MP4 first: it is what iPhones record,
 * it stitches with a stream copy, and Instagram accepts it as is. Plain "video/mp4"
 * on Chrome silently means VP9-in-MP4, which cannot be stitched without re-encoding,
 * so the bare type is only a late fallback.
 */
export function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const types = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4;codecs=avc1,opus",
    "video/mp4;codecs=avc1",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const t of types) if (MediaRecorder.isTypeSupported(t)) return t;
  return "";
}

/** "video/mp4;codecs=avc1,mp4a" -> "video/mp4". Storage rejects types with parameters. */
export function baseMimeType(type: string | null | undefined): string {
  return (type ?? "").split(";")[0].trim().toLowerCase();
}

export function extensionFor(type: string): string {
  const t = baseMimeType(type);
  if (t === "video/mp4") return "mp4";
  if (t === "video/quicktime") return "mov";
  return "webm";
}

/**
 * Concatenate clips recorded by the same MediaRecorder into one File. First try a
 * lossless stream copy (near instant). If the container/codec combination will not
 * stitch, fall back to a re-encode to H.264 + AAC MP4 (slower, always works).
 */
export async function mergeClips(blobs: Blob[]): Promise<File> {
  const ff = await getFFmpeg();
  const inType = baseMimeType(blobs[0]?.type) || "video/webm";
  const inExt = extensionFor(inType);

  const names: string[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const name = `clip${i}.${inExt}`;
    await ff.writeFile(name, new Uint8Array(await blobs[i].arrayBuffer()));
    names.push(name);
  }
  // Chrome writes a recording's tracks in whichever order their first data arrived, so
  // one clip can be video-then-audio and the next audio-then-video. ffmpeg's concat pairs
  // streams by position: a clip in the other order had its picture fed into the sound
  // track, and the merged file lost that clip while ffmpeg reported success (2 of 8
  // two-clip runs in desktop Chrome, found 2026-09-19). Clips that disagree with the
  // first are rewritten, by stream copy, in the first clip's order.
  if (inExt === "mp4") {
    const orders = await Promise.all(blobs.map((b) => readTrackOrder(b)));
    const want = orders[0];
    for (let i = 1; want && i < blobs.length; i++) {
      const got = orders[i];
      if (!got || got.join() === want.join()) continue;
      const maps = want.flatMap((t) => (t === "vide" ? ["-map", "0:v:0"] : t === "soun" ? ["-map", "0:a:0"] : []));
      const ordered = `clip${i}-ordered.mp4`;
      if ((await ff.exec(["-i", names[i], ...maps, "-c", "copy", "-strict", "-2", ordered])) === 0) {
        console.warn(`[merge-clips] clip ${i + 1} had its tracks as ${got.join("+")}; rewritten as ${want.join("+")}`);
        try { await ff.deleteFile(names[i]); } catch { /* ignore */ }
        names[i] = ordered;
      } else {
        console.warn(`[merge-clips] could not reorder the tracks of clip ${i + 1}\n${recentLogs.slice(-6).join("\n")}`);
      }
    }
  }
  await ff.writeFile("list.txt", new TextEncoder().encode(names.map((n) => `file '${n}'`).join("\n")));
  const concat = ["-f", "concat", "-safe", "0", "-fflags", "+genpts", "-i", "list.txt"];

  async function run(args: string[], out: string): Promise<Uint8Array | null> {
    recentLogs.length = 0;
    const code = await ff.exec([...concat, ...args, out]);
    if (code !== 0) {
      console.warn(`[merge-clips] ffmpeg exited with code ${code}\n${recentLogs.slice(-8).join("\n")}`);
      try { await ff.deleteFile(out); } catch { /* ignore */ }
      return null;
    }
    try {
      const data = (await ff.readFile(out)) as Uint8Array;
      await ff.deleteFile(out).catch(() => {});
      return data.byteLength > 0 ? data : null;
    } catch { return null; }
  }

  let type = inType;
  let ext = inExt;
  let data = await run(
    inExt === "mp4" ? ["-c", "copy", "-strict", "-2", "-movflags", "+faststart"] : ["-c", "copy"],
    `out.${inExt}`,
  );
  if (data && inExt === "mp4") {
    // iPhone clips recorded straight from the camera carry a rotation matrix. The copy
    // keeps it (checked against this ffmpeg build 2026-09-19); this repairs it if not.
    try {
      if (restoreMp4Orientation(await blobs[0].slice(0, 1 << 20).arrayBuffer(), data)) console.warn("[merge-clips] the stream copy dropped the display matrix; restored it from the first clip");
    } catch { /* a file this cannot parse is left as ffmpeg wrote it */ }
  }
  if (!data) {
    type = "video/mp4"; ext = "mp4";
    data = await run(
      ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"],
      "out.mp4",
    );
  }
  for (const n of [...names, "list.txt"]) {
    try { await ff.deleteFile(n); } catch { /* ignore */ }
  }
  if (!data) throw new Error(`Could not combine clips\n${recentLogs.slice(-8).join("\n")}`);
  return new File([new Blob([data as unknown as BlobPart], { type })], `recording-${Date.now()}.${ext}`, { type });
}
