import type { SupabaseClient } from "@supabase/supabase-js";
import { baseMimeType } from "@/lib/merge-clips";
import type { CaptureMeta } from "@/lib/capture-meta";
import type { Script } from "@/lib/types";

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const UPLOAD_ATTEMPTS = 3;
const STALL_MS = 45_000;
/** 0 = network error, abort or stall. */
const RETRYABLE = new Set([0, 408, 425, 429, 500, 502, 503, 504]);
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function putFile(url: string, file: File, contentType: string, onProgress?: (pct: number) => void): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let stall: ReturnType<typeof setTimeout> | undefined;
    const arm = () => { clearTimeout(stall); stall = setTimeout(() => xhr.abort(), STALL_MS); };
    const finish = (status: number) => { clearTimeout(stall); resolve({ status, body: status ? xhr.responseText : "" }); };
    xhr.upload.onprogress = (ev) => {
      arm();
      if (ev.lengthComputable && onProgress) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => finish(xhr.status);
    xhr.onerror = () => finish(0);
    xhr.onabort = () => finish(0);
    xhr.open("PUT", url);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("content-type", contentType);
    arm();
    xhr.send(file);
  });
}

export type UploadFields = {
  areaId: string | null;
  language?: string | null;
  script: Script | null;
  uploaderName?: string | null;
  uploaderNote?: string | null;
  thumbnail?: string | null;
  durationSeconds?: number | null;
  /** Recorder diagnostics; null for uploaded files. */
  captureMeta?: CaptureMeta | null;
};

/**
 * The single upload path: validate, PUT the file straight to the private `videos`
 * bucket via a signed upload URL (browser to Supabase, never through our server),
 * then insert the metadata row. If the insert fails the object is removed.
 * Returns the new video id.
 */
export async function uploadVideo(
  supabase: SupabaseClient,
  userId: string,
  file: File,
  fields: UploadFields,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const ext = (file.name.split(".").pop() || "webm").toLowerCase();
  // Recorders report types like "video/mp4;codecs=avc1,mp4a"; the bucket allow-list
  // only accepts the bare type. Fall back to the extension when the type is missing.
  const contentType = baseMimeType(file.type) || ({ mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" } as Record<string, string>)[ext] || "video/mp4";
  if (!contentType.startsWith("video/")) throw new Error("Please choose a video file.");
  if (file.size > MAX_VIDEO_BYTES) throw new Error("Videos must be under 500 MB.");

  // Venue networks drop connections (2026-09-18: 100 phones on one uplink). Try up to
  // three times, each with a fresh path and signed URL; abort an attempt that makes no
  // progress for 45 s. A lost response can orphan an object; that is accepted.
  let path = "";
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    const last = attempt === UPLOAD_ATTEMPTS;
    path = `${userId}/${Date.now()}.${ext}`;
    const { data: signed, error: signErr } = await supabase.storage.from("videos").createSignedUploadUrl(path);
    if (signErr || !signed) {
      if (last) throw new Error(signErr?.message ?? "Could not start the upload.");
      await wait(1500 * attempt);
      continue;
    }
    const { status, body } = await putFile(signed.signedUrl, file, contentType, onProgress);
    if (status >= 200 && status < 300) break;
    if (/EntityTooLarge|exceeded the maximum allowed size/i.test(body)) throw new Error("This video is too large to upload. Try a shorter one.");
    if (!RETRYABLE.has(status) || last) {
      throw new Error(status === 0 ? "The connection dropped during the upload. Check your signal and tap Send again." : `Upload failed (${status})`);
    }
    onProgress?.(0);
    await wait(1500 * attempt);
  }

  try {
    const { data, error } = await supabase
      .from("videos")
      .insert({
        user_id: userId,
        area_id: fields.areaId,
        language: fields.language ?? null,
        storage_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: contentType,
        duration_seconds: fields.durationSeconds ?? null,
        thumbnail: fields.thumbnail ?? null,
        script: fields.script,
        uploader_name: fields.uploaderName ?? null,
        uploader_note: fields.uploaderNote ?? null,
        capture_meta: fields.captureMeta ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data.id as string;
  } catch (e) {
    await supabase.storage.from("videos").remove([path]).catch(() => {});
    throw e;
  }
}
