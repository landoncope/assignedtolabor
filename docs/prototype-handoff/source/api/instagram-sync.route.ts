import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const IG_API = "https://graph.facebook.com/v19.0";

function authOk(req: NextRequest): boolean {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "");
  return token === process.env.CRON_SECRET;
}

export async function POST(req: NextRequest) {
  // Allow Vercel cron (sends Authorization header) or direct calls with CRON_SECRET
  if (!authOk(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const igUserId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const token    = process.env.INSTAGRAM_ACCESS_TOKEN;

  if (!igUserId || !token) {
    return NextResponse.json({ error: "INSTAGRAM_BUSINESS_ACCOUNT_ID or INSTAGRAM_ACCESS_TOKEN not set" }, { status: 500 });
  }

  // ── 1. Follower count ─────────────────────────────────────────────
  const basicRes = await fetch(`${IG_API}/${igUserId}?fields=followers_count&access_token=${token}`);
  if (!basicRes.ok) {
    const err = await basicRes.text();
    return NextResponse.json({ error: "IG basic fetch failed", detail: err }, { status: 502 });
  }
  const { followers_count } = await basicRes.json() as { followers_count: number };

  // ── 2. Account insights (reach, impressions, profile_views) ───────
  const insightRes = await fetch(
    `${IG_API}/${igUserId}/insights?metric=reach,impressions,profile_views&period=days_28&access_token=${token}`
  );
  const insightData = insightRes.ok ? (await insightRes.json() as { data?: { name: string; values: { value: number }[] }[] }) : null;

  function sumInsight(name: string): number | null {
    const series = insightData?.data?.find((d) => d.name === name);
    if (!series) return null;
    return series.values.reduce((acc, v) => acc + (v.value ?? 0), 0);
  }
  const reach_30d         = sumInsight("reach");
  const impressions_30d   = sumInsight("impressions");
  const profile_views_30d = sumInsight("profile_views");

  // ── 3. Aggregate likes + comments from last 25 posts ──────────────
  const mediaRes = await fetch(
    `${IG_API}/${igUserId}/media?fields=like_count,comments_count&limit=25&access_token=${token}`
  );
  const mediaData = mediaRes.ok ? (await mediaRes.json() as { data?: { like_count?: number; comments_count?: number }[] }) : null;

  let likes_30d    = 0;
  let comments_30d = 0;
  for (const post of mediaData?.data ?? []) {
    likes_30d    += post.like_count    ?? 0;
    comments_30d += post.comments_count ?? 0;
  }

  // ── 4. Find the channel row by instagram_user_id ──────────────────
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: channelRow, error: chanErr } = await supabase
    .from("channels")
    .select("id")
    .eq("instagram_user_id", igUserId)
    .maybeSingle();

  if (chanErr || !channelRow) {
    return NextResponse.json({ error: "Channel not found for this IG account ID" }, { status: 404 });
  }

  // ── 5. Upsert stats ───────────────────────────────────────────────
  const { error: upsertErr } = await supabase
    .from("channel_stats")
    .upsert({
      channel_id:        channelRow.id,
      followers_count,
      reach_30d,
      impressions_30d,
      likes_30d,
      comments_30d,
      profile_views_30d,
      synced_at: new Date().toISOString(),
    }, { onConflict: "channel_id" });

  if (upsertErr) {
    return NextResponse.json({ error: "DB upsert failed", detail: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    followers_count,
    reach_30d,
    impressions_30d,
    likes_30d,
    comments_30d,
    profile_views_30d,
  });
}

// Vercel cron invokes GET; proxy to POST handler
export async function GET(req: NextRequest) {
  return POST(req);
}
