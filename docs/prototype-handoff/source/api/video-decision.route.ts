import { NextRequest, NextResponse } from "next/server";
import { authorizeChannelManager } from "@/lib/team-auth";

export async function POST(req: NextRequest) {
  const { channelId, videoId, decision, note } = (await req.json()) as {
    channelId: string; videoId: string; decision: "approve" | "reject"; note?: string;
  };

  if (!channelId || !videoId || !["approve", "reject"].includes(decision)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const auth = await authorizeChannelManager(channelId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (decision === "approve") {
    const { error: vcErr } = await auth.supabase
      .from("video_channels")
      .update({ status: "approved", approved_at: new Date().toISOString(), approved_by: auth.userId })
      .eq("channel_id", channelId)
      .eq("video_id", videoId);
    if (vcErr) return NextResponse.json({ error: vcErr.message }, { status: 500 });

    const { error: vErr } = await auth.supabase
      .from("videos")
      .update({ status: "approved" })
      .eq("id", videoId);
    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, status: "approved" });
  }

  // Reject — mark the video rejected FIRST (the videos RLS policy requires the
  // link to still exist), then drop the team link.
  const { error: vErr } = await auth.supabase
    .from("videos")
    .update({ status: "rejected", rejection_note: note ?? null, rejected_at: new Date().toISOString() })
    .eq("id", videoId);
  if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });

  const { error: delErr } = await auth.supabase
    .from("video_channels")
    .delete()
    .eq("channel_id", channelId)
    .eq("video_id", videoId);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, status: "rejected" });
}
