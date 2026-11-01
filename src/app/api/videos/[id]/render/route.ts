import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth";
import { renderThenPublish } from "@/lib/render";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The render step for one video (2026-11-01): draw the captions and the headline into
 * the file, normalise the loudness, then carry on with the post waiting for it. The
 * review page calls this as soon as a post is queued, so the lead does not wait for the
 * cron; the publish cron does the same for posts whose page is gone. A lead of the
 * video's team, an admin, or the cron's bearer secret. Takes a minute or more.
 */
export const maxDuration = 800;

export async function POST(req: Request, ctx: RouteContext<"/api/videos/[id]/render">) {
  const { id } = await ctx.params;
  const db = createAdminClient();
  const auth = req.headers.get("authorization") ?? "";
  const fromCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!fromCron) {
    const viewer = await getViewer();
    if (!viewer || viewer.isAnonymous) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: v, error } = await db.from("videos").select("area_id").eq("id", id).maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!v) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!(viewer.isAdmin || (v.area_id !== null && viewer.managedAreaIds.includes(v.area_id)))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await renderThenPublish(db, id));
}
