import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const RETENTION_DAYS = 7;
/** Team lead application videos go this long after the decision (they are never posted, so nothing else removes them). */
const LEAD_VIDEO_RETENTION_DAYS = 30;

/**
 * Daily retention job (Vercel cron, see vercel.json). Deletes the source file for
 * videos that were posted or rejected more than RETENTION_DAYS ago, and for team
 * lead applications decided more than LEAD_VIDEO_RETENTION_DAYS ago. The metadata
 * rows stay so history and counts survive.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = createAdminClient();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();

  const { data: rows, error } = await supabase
    .from("videos")
    .select("id, storage_path, status, posted_at, reviewed_at")
    .is("file_purged_at", null)
    .not("storage_path", "is", null)
    .or(`and(status.eq.posted,posted_at.lt.${cutoff}),and(status.eq.rejected,reviewed_at.lt.${cutoff})`)
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let purged = 0;
  const failures: string[] = [];
  for (const v of rows ?? []) {
    const { error: rmErr } = await supabase.storage.from("videos").remove([v.storage_path as string]);
    if (rmErr) { failures.push(`${v.id}: ${rmErr.message}`); continue; }
    const { error: upErr } = await supabase.from("videos").update({ file_purged_at: new Date().toISOString(), storage_path: null }).eq("id", v.id);
    if (upErr) failures.push(`${v.id}: ${upErr.message}`); else purged++;
  }

  const leadCutoff = new Date(Date.now() - LEAD_VIDEO_RETENTION_DAYS * 86400_000).toISOString();
  const { data: apps, error: appErr } = await supabase
    .from("lead_applications")
    .select("id, video_path")
    .in("status", ["approved", "declined"])
    .lt("decided_at", leadCutoff)
    .not("video_path", "is", null)
    .limit(200);
  if (appErr) failures.push(`lead applications: ${appErr.message}`);
  let leadPurged = 0;
  for (const a of apps ?? []) {
    const { error: rmErr } = await supabase.storage.from("videos").remove([a.video_path as string]);
    if (rmErr) { failures.push(`lead ${a.id}: ${rmErr.message}`); continue; }
    const { error: upErr } = await supabase.from("lead_applications").update({ video_purged_at: new Date().toISOString(), video_path: null }).eq("id", a.id);
    if (upErr) failures.push(`lead ${a.id}: ${upErr.message}`); else leadPurged++;
  }
  return NextResponse.json({ ok: failures.length === 0, purged, leadPurged, failures });
}
