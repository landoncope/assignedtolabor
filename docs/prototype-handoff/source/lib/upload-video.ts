import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB

export type UploadVideoFields = {
  countries?: string[];
  language?: string;
  videoStyle?: string | null; // "Devotional" | "Apologetics"
  demographic?: string;
};

/**
 * Single source of truth for uploading a contributor video:
 *  1. validate type + size
 *  2. PUT the file to the private `videos` bucket via a signed upload URL
 *  3. insert the `videos` metadata row (storing `storage_path`, status "pending")
 *  4. optionally link it to a team channel (`video_channels`, pending review)
 *
 * If the metadata insert fails after the file uploaded, the orphaned object is
 * removed (best-effort) so storage never accumulates stranded files.
 * Returns the new video id.
 */
export async function uploadVideo(
  supabase: SupabaseClient,
  userId: string,
  file: File,
  fields: UploadVideoFields,
  channelId?: string,
  onProgress?: (pct: number) => void,
): Promise<string> {
  if (!file.type.startsWith("video/")) throw new Error("Please select a video file.");
  if (file.size > MAX_VIDEO_BYTES) throw new Error("File must be under 500 MB.");

  const ext = file.name.split(".").pop();
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
    xhr.send(file);
  });

  try {
    const { data: inserted, error: insertErr } = await supabase
      .from("videos")
      .insert({
        user_id: userId,
        storage_path: path,
        file_name: file.name,
        file_size: file.size,
        countries: channelId ? [] : (fields.countries ?? []),
        country: channelId ? "" : (fields.countries?.[0] ?? ""),
        language: channelId ? "" : (fields.language ?? ""),
        demographic: fields.demographic ?? "General Audience",
        video_style: fields.videoStyle ?? null,
        platform: [],
        status: "pending",
      })
      .select("id")
      .single();
    if (insertErr) throw new Error(insertErr.message);

    if (channelId && inserted?.id) {
      const { error: linkErr } = await supabase
        .from("video_channels")
        .insert({ video_id: inserted.id, channel_id: channelId, status: "pending", approved_at: null });
      if (linkErr) throw new Error(linkErr.message);
    }

    return inserted!.id as string;
  } catch (e) {
    // Roll back the uploaded file so it doesn't linger as an orphan.
    await supabase.storage.from("videos").remove([path]).catch(() => {});
    throw e;
  }
}
