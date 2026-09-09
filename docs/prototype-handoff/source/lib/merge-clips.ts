// In-browser video clip merger (ffmpeg.wasm).
//
// Records-as-separate-clips lets the recorder delete any single clip; when the user
// is done we stitch the kept clips back into ONE file here. Everything runs on the
// device — no upload/backend. The ~32MB core is self-hosted under /public/ffmpeg
// (single-thread build → no COOP/COEP headers needed) and is only fetched the first
// time a merge actually runs, then cached by the browser.

import type { FFmpeg } from "@ffmpeg/ffmpeg";

let ffmpegPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { toBlobURL } = await import("@ffmpeg/util");
      const ff = new FFmpeg();
      const base = "/ffmpeg";
      await ff.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
      });
      return ff;
    })().catch((e) => { ffmpegPromise = null; throw e; });
  }
  return ffmpegPromise;
}

function extFor(type: string): string {
  if (type.includes("mp4")) return "mp4";
  if (type.includes("quicktime")) return "mov";
  return "webm";
}

/**
 * Concatenate video clips into a single File. Clips come from the same MediaRecorder
 * (identical codec/params), so a lossless stream copy works and is near-instant.
 */
export async function mergeClips(blobs: Blob[]): Promise<File> {
  const ff = await getFFmpeg();
  const type = blobs[0]?.type || "video/webm";
  const ext = extFor(type);

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

  for (const n of [...names, "list.txt", out]) { try { await ff.deleteFile(n); } catch { /* ignore */ } }

  if (!data || data.byteLength === 0) throw new Error("Merge produced an empty file");
  const blob = new Blob([data as unknown as BlobPart], { type });
  return new File([blob], `recording-${Date.now()}.${ext}`, { type });
}
