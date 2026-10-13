import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { advancePublish } from "@/lib/instagram-publish";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The review page polls this while a post is in flight. It checks the container at
 * Instagram and publishes it when ready, so the post completes even between cron runs.
 * Only a lead of the video's team (or an admin) may ask.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/videos/[id]/publish-status">) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer || viewer.isAnonymous) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const { data: v, error } = await db.from("videos").select("id, area_id, publish_state, publish_error, post_url").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const mayManage = viewer.isAdmin || (v.area_id !== null && viewer.managedAreaIds.includes(v.area_id));
  if (!mayManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (v.publish_state === "queued" || v.publish_state === "processing") {
    return NextResponse.json(await advancePublish(db, id));
  }
  return NextResponse.json({ state: v.publish_state, error: v.publish_error, postUrl: v.post_url });
}
