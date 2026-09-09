import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const SIGNED_URL_TTL = 60 * 60; // 1 hour

// GET /api/videos/:id/playback-url
// Returns a short-lived signed URL for the video file, if the caller is the
// uploader, an admin, or a manager/leader of a channel the video is linked to.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: video, error } = await supabase
    .from("videos")
    .select("user_id, storage_path, file_purged_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (video.file_purged_at || !video.storage_path) {
    return NextResponse.json({ error: "Video no longer available" }, { status: 410 });
  }

  // Authorize: owner, admin, or manager of any linked channel.
  let allowed = video.user_id === user.id;
  if (!allowed) {
    const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
    if (profile?.role === "admin") allowed = true;
  }
  if (!allowed) {
    const { data: links } = await supabase.from("video_channels").select("channel_id").eq("video_id", id);
    for (const link of links ?? []) {
      const { data: canManage } = await supabase.rpc("can_manage_channel", { cid: link.channel_id });
      if (canManage) { allowed = true; break; }
    }
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Sign with the caller's own session — RLS (owner / admin / channel manager)
  // governs read access, so no service-role key is needed.
  const { data: signed, error: signErr } = await supabase.storage
    .from("videos")
    .createSignedUrl(video.storage_path, SIGNED_URL_TTL);
  if (signErr || !signed) {
    return NextResponse.json({ error: signErr?.message ?? "Could not sign URL" }, { status: 500 });
  }

  return NextResponse.json({ url: signed.signedUrl });
}
