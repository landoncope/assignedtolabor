"use server";

import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Reviewer actions. RLS enforces area membership; these just shape the write. */

export async function approveVideo(videoId: string) {
  const v = await requireManager(`/review/${videoId}`);
  const supabase = await createClient();
  const { error } = await supabase.from("videos")
    .update({ status: "approved", reviewed_by: v.userId, reviewed_at: new Date().toISOString(), rejection_note: null })
    .eq("id", videoId).eq("status", "pending");
  if (error) return { error: error.message };
  revalidatePath("/review"); revalidatePath(`/review/${videoId}`);
  return { ok: true };
}

export async function rejectVideo(videoId: string, note: string) {
  const v = await requireManager(`/review/${videoId}`);
  const supabase = await createClient();
  const { error } = await supabase.from("videos")
    .update({ status: "rejected", reviewed_by: v.userId, reviewed_at: new Date().toISOString(), rejection_note: note.trim() || null })
    .eq("id", videoId).in("status", ["pending", "approved"]);
  if (error) return { error: error.message };
  revalidatePath("/review"); revalidatePath(`/review/${videoId}`);
  return { ok: true };
}

export async function markPosted(videoId: string, postUrl: string) {
  const v = await requireManager(`/review/${videoId}`);
  const supabase = await createClient();
  const { error } = await supabase.from("videos")
    .update({ status: "posted", posted_by: v.userId, posted_at: new Date().toISOString(), post_url: postUrl.trim() || null })
    .eq("id", videoId).eq("status", "approved");
  if (error) return { error: error.message };
  revalidatePath("/review"); revalidatePath(`/review/${videoId}`);
  return { ok: true };
}

export async function reopenVideo(videoId: string) {
  await requireManager(`/review/${videoId}`);
  const supabase = await createClient();
  const { error } = await supabase.from("videos")
    .update({ status: "pending", reviewed_by: null, reviewed_at: null, rejection_note: null })
    .eq("id", videoId).in("status", ["approved", "rejected"]);
  if (error) return { error: error.message };
  revalidatePath("/review"); revalidatePath(`/review/${videoId}`);
  return { ok: true };
}

/** Admins (or the area's manager) can move a video to a different area. */
export async function assignArea(videoId: string, areaId: string | null) {
  await requireManager(`/review/${videoId}`);
  const supabase = await createClient();
  const { error } = await supabase.from("videos").update({ area_id: areaId }).eq("id", videoId);
  if (error) return { error: error.message };
  revalidatePath("/review"); revalidatePath(`/review/${videoId}`);
  return { ok: true };
}

/**
 * Permanently delete a video: the row (RLS decides who may) and then the file.
 * The uploader's account is untouched. Nothing is emailed.
 */
export async function deleteVideo(videoId: string) {
  await requireManager(`/review/${videoId}`);
  const supabase = await createClient();
  const { data, error } = await supabase.from("videos").delete().eq("id", videoId).select("storage_path");
  if (error) return { error: error.message };
  if (!data?.length) return { error: "You can't delete this video, or it is already gone." };
  const path = data[0].storage_path as string | null;
  if (path) {
    const { error: rmErr } = await createAdminClient().storage.from("videos").remove([path]);
    if (rmErr) console.error(`[review] deleted video ${videoId} but its file ${path} remains: ${rmErr.message}`);
  }
  revalidatePath("/review");
  return { ok: true };
}
