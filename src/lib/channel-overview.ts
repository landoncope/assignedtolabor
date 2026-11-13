import type { SupabaseClient } from "@supabase/supabase-js";
import { daysAgo } from "@/lib/goals";
import { loadImpact, type ImpactView } from "@/lib/impact";
import { freshStatsForOverview, RECENT_POSTS } from "@/lib/instagram-stats";
import { AREA_SUMMARY_COLS, areaLabel, type AreaSummary } from "@/lib/types";

/**
 * Every channel at a glance, for admins (2026-11-12, Travis): people on the team,
 * followers, the most recent post, posts in the last 7 and 30 days, and what is waiting
 * for review. Followers and posts come from Instagram when the team's account is
 * connected and its numbers are no older than a day (everything on the account counts,
 * posted from this site or by hand); otherwise only what this site recorded as posted.
 */
export type ChannelRow = {
  id: string;
  label: string;
  handle: string | null;
  connected: boolean;
  /** Why Instagram ended the connection, when it did and nobody has reconnected. */
  lost: string | null;
  members: number | null;
  followers: number | null;
  /** Set when the follower count is older than a day: the day it is from. */
  followersAsOf: string | null;
  lastPost: { day: string; ago: string; url: string | null } | null;
  posts7: string;
  posts30: string;
  /** Where the three post columns come from. */
  source: "instagram" | "site";
  pending: number | null;
  impact: ImpactView | null;
};

type Overview = { people: number; pending: number; posted_30d: number; last_posted_at: string | null };
const shortDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** `supabase` is the admin viewer's session (RLS lets an admin read every team); `service` reads the stored Instagram numbers. */
export async function loadChannelOverview(supabase: SupabaseClient, service: SupabaseClient, siteUrl: string, now = new Date()): Promise<ChannelRow[]> {
  const { data: areaRows } = await supabase.from("areas").select(AREA_SUMMARY_COLS).eq("is_active", true).order("sort_order").order("name");
  const areas = (areaRows ?? []) as AreaSummary[];
  if (!areas.length) return [];
  const t = now.getTime(), since7 = t - 7 * 86400_000, since30 = t - 30 * 86400_000;
  const [overviews, { data: postedRows }, stats, impact] = await Promise.all([
    Promise.all(areas.map(async (a) => {
      const { data } = await supabase.rpc("team_overview", { aid: a.id });
      return [a.id, ((Array.isArray(data) ? data[0] : data) as Overview | undefined) ?? null] as const;
    })),
    supabase.from("videos").select("area_id, posted_at, post_url").eq("status", "posted").gte("posted_at", new Date(since30).toISOString()).order("posted_at", { ascending: false }).limit(2000),
    freshStatsForOverview(service, areas.map((a) => ({ id: a.id, connectedAt: a.instagram_user_id ? a.instagram_connected_at : null })))
      .catch((e: unknown) => { console.error(`[channel-overview] stats: ${e instanceof Error ? e.message : String(e)}`); return new Map() as Awaited<ReturnType<typeof freshStatsForOverview>>; }),
    loadImpact(supabase, areas, siteUrl, now),
  ]);
  const overview = new Map(overviews);
  const posted = (postedRows ?? []) as { area_id: string | null; posted_at: string; post_url: string | null }[];

  return areas.map((a): ChannelRow => {
    const ov = overview.get(a.id) ?? null;
    const s = stats.get(a.id) ?? null;
    const asOf = s?.succeeded_at ? new Date(s.succeeded_at) : null;
    const fresh = !!asOf && t - asOf.getTime() < 86400_000;
    const base = {
      id: a.id, label: areaLabel(a), handle: (a.instagram_handle ?? s?.username ?? "").replace(/^@/, "") || null,
      connected: !!a.instagram_user_id, lost: !a.instagram_user_id && a.instagram_lost_at ? a.instagram_lost_reason ?? "Instagram ended the connection." : null,
      members: ov?.people ?? null, pending: ov?.pending ?? null, impact: impact.get(a.id) ?? null,
      followers: s?.profile?.followers ?? null, followersAsOf: asOf && !fresh ? shortDay(asOf) : null,
    };
    if (a.instagram_user_id && fresh && s?.media) {
      const times = s.media.map((m) => ({ at: m.timestamp ? new Date(m.timestamp).getTime() : 0, url: m.permalink })).filter((m) => m.at > 0).sort((x, y) => y.at - x.at);
      // Instagram hands us the newest few posts; when every one of them is inside the window there may be more.
      const count = (since: number) => { const k = times.filter((m) => m.at >= since).length; return k >= RECENT_POSTS && k === times.length ? `${k}+` : String(k); };
      const last = times[0] ?? null;
      return { ...base, source: "instagram", posts7: count(since7), posts30: count(since30), lastPost: last ? { day: shortDay(new Date(last.at)), ago: daysAgo(new Date(last.at), now), url: last.url } : null };
    }
    const mine = posted.filter((p) => p.area_id === a.id);
    const lastAt = ov?.last_posted_at ? new Date(ov.last_posted_at) : null;
    return {
      ...base, source: "site",
      posts7: String(mine.filter((p) => new Date(p.posted_at).getTime() >= since7).length), posts30: String(mine.length),
      lastPost: lastAt ? { day: shortDay(lastAt), ago: daysAgo(lastAt, now), url: mine[0]?.post_url ?? null } : null,
    };
  });
}
