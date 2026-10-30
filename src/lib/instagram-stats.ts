import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import * as ig from "@/lib/instagram";
import { forgetRejected, tokenRejected } from "@/lib/instagram-publish";

/**
 * The team's Instagram numbers for the dashboard (2026-10-30): followers, the recent
 * posts with their likes and comments, and, when the account granted
 * instagram_business_manage_insights, the last 30 days of reach and views and each
 * recent post's views. Fetched by the server with the team's token and cached in
 * `instagram_stats` (one row per team): a dashboard's first view fetches it inline, a
 * later view of numbers older than a few hours refreshes them after the response.
 * Pages read the cache with the service role after checking the viewer is on the team.
 *
 * Only a view by someone ON the team triggers a fetch, never a cron and never an
 * admin's list of other teams: a local test build points the Instagram client at a
 * mock, and a real token sent to the mock (or a mock token sent by production to the
 * real Instagram) comes back "invalid", which forgets the connection.
 */
export const STATS_MAX_AGE_HOURS = 6;
export const RECENT_POSTS = 24;
/** Per-post insights cost one request each; only this many of the newest posts get them. */
export const POST_INSIGHTS = 12;

type Db = SupabaseClient;
export type StatsRow = {
  area_id: string;
  username: string | null;
  fetched_at: string;
  succeeded_at: string | null;
  profile: ig.IgAccountStats | null;
  media: ig.IgPost[] | null;
  insights: ig.IgAccountInsights | null;
  error: string | null;
};
const COLS = "area_id, username, fetched_at, succeeded_at, profile, media, insights, error";

export async function loadStats(db: Db, areaId: string): Promise<StatsRow | null> {
  const { data, error } = await db.from("instagram_stats").select(COLS).eq("area_id", areaId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as StatsRow | null) ?? null;
}

export function statsStale(s: Pick<StatsRow, "fetched_at"> | null | undefined): boolean {
  return !s || Date.now() - new Date(s.fetched_at).getTime() > STATS_MAX_AGE_HOURS * 3600_000;
}

/**
 * Ask Instagram for the team's numbers and store them. A failed attempt keeps the last
 * numbers and notes why; a rejected token (code 190) forgets the connection, as a
 * failed post does. Returns the stored row (null when the team has no connection and
 * no stored numbers).
 */
export async function refreshStats(db: Db, areaId: string): Promise<StatsRow | null> {
  const { data: acct, error: aErr } = await db.from("instagram_accounts").select("area_id, username, access_token, scopes").eq("area_id", areaId).maybeSingle();
  if (aErr) throw new Error(aErr.message);
  const prev = await loadStats(db, areaId);
  if (!acct) return prev;
  const a = acct as { username: string | null; access_token: string; scopes: string[] | null };
  const now = new Date();
  try {
    const [profile, media] = await Promise.all([ig.accountStats(a.access_token), ig.recentMedia(a.access_token, RECENT_POSTS)]);
    let insights: ig.IgAccountInsights | null = null;
    if ((a.scopes ?? []).includes(ig.INSIGHTS_SCOPE)) {
      const since = new Date(now.getTime() - 30 * 86400_000);
      insights = await ig.accountInsights(a.access_token, since, now).catch((e) => ({ reach: null, views: null, interactions: null, since: since.toISOString(), until: now.toISOString(), error: ig.describeError(e) }));
      await Promise.all(media.slice(0, POST_INSIGHTS).map(async (m) => {
        const r = await ig.mediaInsights(a.access_token, m.id).catch(() => ({ views: null, reach: null }));
        m.views = r.views; m.reach = r.reach;
      }));
    }
    const row = { area_id: areaId, username: profile.username ?? a.username, fetched_at: now.toISOString(), succeeded_at: now.toISOString(), profile, media, insights, error: null };
    const { error } = await db.from("instagram_stats").upsert(row, { onConflict: "area_id" });
    if (error) throw new Error(error.message);
    return row;
  } catch (e) {
    const reason = tokenRejected(e) ? await forgetRejected(db, areaId, a.username) : ig.describeError(e);
    const row: StatsRow = { area_id: areaId, username: a.username, fetched_at: now.toISOString(), succeeded_at: prev?.succeeded_at ?? null, profile: prev?.profile ?? null, media: prev?.media ?? null, insights: prev?.insights ?? null, error: reason };
    await db.from("instagram_stats").upsert(row, { onConflict: "area_id" });
    return row;
  }
}

/**
 * For the viewer's own team: the stored numbers, fetched now when there are none yet
 * (the first view after connecting), refreshed after the response when they are stale.
 */
export async function statsForDashboard(db: Db, areaId: string, connected: boolean): Promise<StatsRow | null> {
  const s = await loadStats(db, areaId);
  if (!connected) return s;
  if (!s) return refreshStats(db, areaId);
  if (statsStale(s)) after(() => refreshStats(db, areaId).catch((e: unknown) => console.error(`[instagram-stats] refresh for ${areaId}: ${e instanceof Error ? e.message : String(e)}`)));
  return s;
}
