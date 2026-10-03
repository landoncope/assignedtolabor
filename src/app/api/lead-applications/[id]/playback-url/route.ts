import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const TTL_SECONDS = 60 * 60;

/**
 * Signed playback URL for a team lead application's video. RLS decides who may read
 * the application (its owner and admins) and the file (the owner's folder; admins).
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/lead-applications/[id]/playback-url">) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: app, error } = await supabase.from("lead_applications").select("video_path, video_purged_at").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (app.video_purged_at) return NextResponse.json({ error: "This video file has been removed." }, { status: 410 });
  if (!app.video_path) return NextResponse.json({ error: "No video has been uploaded yet." }, { status: 404 });

  const { data: signed, error: signErr } = await supabase.storage.from("videos").createSignedUrl(app.video_path, TTL_SECONDS);
  if (signErr || !signed) return NextResponse.json({ error: signErr?.message ?? "Could not sign URL" }, { status: 500 });
  return NextResponse.json({ url: signed.signedUrl });
}
