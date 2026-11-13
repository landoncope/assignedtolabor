import type { SupabaseClient } from "@supabase/supabase-js";
import { pageAddress } from "@/lib/team-page";
import type { ImpactReport, TeamStory } from "@/lib/types";

/**
 * What a channel has led to (2026-11-12, Travis): running totals a team's leads type in
 * (the figures live with Gathering Israel, who follow up each form), shown to everyone
 * on the team. Shared by the dashboard and the reminder emails.
 */
export const IMPACT_FIELDS = [
  { key: "requests", label: "Asked to meet the missionaries", hint: "people who filled in the channel's form" },
  { key: "referrals", label: "Sent to the missionaries", hint: "confirmed and passed on to local missionaries" },
  { key: "baptisms", label: "Baptized", hint: "" },
] as const;
export type ImpactKey = (typeof IMPACT_FIELDS)[number]["key"];

export const IMPACT_COLS = "id, area_id, as_of, requests, referrals, baptisms, source, created_at";

/** "Nov 12, 2026" for a date column (no time zone games: the day is the day). */
export function formatDate(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** How much a figure grew since the report before, when both are known and it did. */
export function growth(latest: ImpactReport, previous: ImpactReport | null, key: ImpactKey): number | null {
  const now = latest[key], then = previous?.[key];
  return typeof now === "number" && typeof then === "number" && now > then ? now - then : null;
}

/** One sentence for an email: what the channel has led to so far. Null when there is nothing to say yet. */
export function impactSentence(team: string, r: ImpactReport): string | null {
  const people = (n: number) => `${new Intl.NumberFormat("en-US").format(n)} ${n === 1 ? "person" : "people"}`;
  const parts = [
    r.requests ? `${people(r.requests)} asked to meet the missionaries` : null,
    r.referrals ? `${people(r.referrals)} ${r.referrals === 1 ? "was" : "were"} sent on to them` : null,
    r.baptisms ? `${people(r.baptisms)} ${r.baptisms === 1 ? "was" : "were"} baptized` : null,
  ].filter((p): p is string => !!p);
  if (!parts.length) return null;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Through the ${team} channel so far, ${list}.`;
}

/** What a team card or the admins' overview shows for one team. */
export type ImpactView = {
  latest: ImpactReport | null;
  previous: ImpactReport | null;
  stories: TeamStory[];
  /** The team's form page: its address without the scheme, and how often it was opened in 30 days. Null when it has none. */
  page: { address: string; href: string; opens30: number } | null;
};

/**
 * The figures (the newest and the one before), the stories and the form page's opens
 * for these teams, read through the viewer's session: RLS shows a team's rows to its
 * people and to admins, so a team the viewer is not on comes back empty.
 */
export async function loadImpact(supabase: SupabaseClient, teams: { id: string; slug: string | null; referral_form_url: string | null }[], siteUrl: string, now = new Date()): Promise<Map<string, ImpactView>> {
  const out = new Map<string, ImpactView>();
  const ids = teams.map((t) => t.id);
  if (!ids.length) return out;
  const since = new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10);
  const [{ data: reportRows }, { data: storyRows }, { data: dayRows }] = await Promise.all([
    supabase.from("team_impact_reports").select(IMPACT_COLS).in("area_id", ids).order("as_of", { ascending: false }).limit(500),
    supabase.from("team_stories").select("id, area_id, title, body, happened_on, created_at").in("area_id", ids).order("created_at", { ascending: false }).limit(300),
    supabase.from("team_page_days").select("area_id, opens").in("area_id", ids).gte("day", since),
  ]);
  for (const t of teams) {
    const reports = ((reportRows ?? []) as ImpactReport[]).filter((r) => r.area_id === t.id);
    const stories = ((storyRows ?? []) as TeamStory[]).filter((r) => r.area_id === t.id)
      .sort((x, y) => (y.happened_on ?? y.created_at.slice(0, 10)).localeCompare(x.happened_on ?? x.created_at.slice(0, 10)));
    const opens30 = ((dayRows ?? []) as { area_id: string; opens: number }[]).filter((d) => d.area_id === t.id).reduce((sum, d) => sum + d.opens, 0);
    out.set(t.id, {
      latest: reports[0] ?? null, previous: reports[1] ?? null, stories,
      page: t.slug && t.referral_form_url ? { address: pageAddress(siteUrl, t.slug), href: `/${t.slug}`, opens30 } : null,
    });
  }
  return out;
}
