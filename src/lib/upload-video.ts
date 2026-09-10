import type { SupabaseClient } from "@supabase/supabase-js";
import type { Script } from "@/lib/types";

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export type UploadFields = {
  areaId: string | null;
  script: Script | null;
  uploaderName?: string | null;
  uploaderNote?: string | null;
  thumbnail?: string | null;
  durationSeconds?: number | null;
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
  if (!file.type.startsWith("video/")) throw new Error("Please choose a video file.");
  if (file.size > MAX_VIDEO_BYTES) throw new Error("Videos must be under 500 MB.");

  const ext = (file.name.split(".").pop() || "webm").toLowerCase();
  const path = `${userId}/${Date.now()}.${ext}`;

  const { data: signed, error: signErr } = await supabase.storage.from("videos").createSignedUploadUrl(path);
  if (signErr || !signed) throw new Error(signErr?.message ?? "Could not start the upload.");

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && onProgress) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.open("PUT", signed.signedUrl);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.setRequestHeader("content-type", file.type);
    xhr.send(file);
  });

  try {
    const { data, error } = await supabase
      .from("videos")
      .insert({
        user_id: userId,
        area_id: fields.areaId,
        storage_path: path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        duration_seconds: fields.durationSeconds ?? null,
        thumbnail: fields.thumbnail ?? null,
        script: fields.script,
        uploader_name: fields.uploaderName ?? null,
        uploader_note: fields.uploaderNote ?? null,
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
