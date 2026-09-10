import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const TTL_SECONDS = 60 * 60;

/** Signed playback URL for a video. RLS decides who may read the row and the file. */
export async function GET(_req: Request, ctx: RouteContext<"/api/videos/[id]/playback-url">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: video, error } = await supabase.from("videos").select("storage_path, file_purged_at").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (video.file_purged_at || !video.storage_path) return NextResponse.json({ error: "This video file has been removed." }, { status: 410 });

  const { data: signed, error: signErr } = await supabase.storage.from("videos").createSignedUrl(video.storage_path, TTL_SECONDS);
  if (signErr || !signed) return NextResponse.json({ error: signErr?.message ?? "Could not sign URL" }, { status: 500 });
  return NextResponse.json({ url: signed.signedUrl });
}
