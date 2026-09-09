// In-browser clip merger (ffmpeg.wasm). The recorder keeps each clip as its own file
// so any one can be deleted; when the user is done we stitch the kept clips into one
// file on the device. The runtime is served from /ffmpeg (copied on postinstall) and
// only fetched the first time a merge runs.
import type { FFmpeg } from "@ffmpeg/ffmpeg";

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { toBlobURL } = await import("@ffmpeg/util");
      const ff = new FFmpeg();
      const base = `${window.location.origin}/ffmpeg`;
      await ff.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
        classWorkerURL: await toBlobURL(`${base}/814.ffmpeg.js`, "text/javascript"),
      });
      return ff;
    })().catch((e) => {
      ffmpegPromise = null;
      throw e;
    });
  }
  return ffmpegPromise;
}

export function extensionFor(type: string): string {
  if (type.includes("mp4")) return "mp4";
  if (type.includes("quicktime")) return "mov";
  return "webm";
}

/** Concatenate clips recorded by the same MediaRecorder into one File (stream copy). */
export async function mergeClips(blobs: Blob[]): Promise<File> {
  const ff = await getFFmpeg();
  const type = blobs[0]?.type || "video/webm";
  const ext = extensionFor(type);

  const names: string[] = [];
  for (let i = 0; i < blobs.length; i++) {
    const name = `clip${i}.${ext}`;
    await ff.writeFile(name, new Uint8Array(await blobs[i].arrayBuffer()));
    names.push(name);
  }
  await ff.writeFile("list.txt", new TextEncoder().encode(names.map((n) => `file '${n}'`).join("\n")));

  const out = `out.${ext}`;
  await ff.exec(["-f", "concat", "-safe", "0", "-fflags", "+genpts", "-i", "list.txt", "-c", "copy", out]);
  const data = (await ff.readFile(out)) as Uint8Array;
  for (const n of [...names, "list.txt", out]) {
    try { await ff.deleteFile(n); } catch { /* ignore */ }
  }
  if (!data || data.byteLength === 0) throw new Error("Merge produced an empty file");
  return new File([new Blob([data as unknown as BlobPart], { type })], `recording-${Date.now()}.${ext}`, { type });
}
