import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const TTL_SECONDS = 60 * 60;

/**
 * Signed playback URL for a video. RLS decides who may read the row and the file.
 * `?rendered=1` (2026-11-01) gives the rendered file instead (captions, headline and
 * loudness drawn in), for a lead posting by hand; it is signed with the service role
 * once RLS has shown the caller the row, since the storage policies know the original.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/videos/[id]/playback-url">) {
  const { id } = await ctx.params;
  const rendered = new URL(req.url).searchParams.get("rendered") === "1";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: video, error } = await supabase.from("videos").select("storage_path, file_purged_at, render_path, render_state").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!video) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (video.file_purged_at || !video.storage_path) return NextResponse.json({ error: "This video file has been removed." }, { status: 410 });

  if (rendered) {
    if (!video.render_path || video.render_state !== "done") return NextResponse.json({ error: "There is no captioned file for this video yet." }, { status: 404 });
    const { data: signed, error: signErr } = await createAdminClient().storage.from("videos").createSignedUrl(video.render_path, TTL_SECONDS);
    if (signErr || !signed) return NextResponse.json({ error: signErr?.message ?? "Could not sign URL" }, { status: 500 });
    return NextResponse.json({ url: signed.signedUrl, rendered: true });
  }
  const { data: signed, error: signErr } = await supabase.storage.from("videos").createSignedUrl(video.storage_path, TTL_SECONDS);
  if (signErr || !signed) return NextResponse.json({ error: signErr?.message ?? "Could not sign URL" }, { status: 500 });
  return NextResponse.json({ url: signed.signedUrl });
}
