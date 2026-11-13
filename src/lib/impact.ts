import type { ImpactReport } from "@/lib/types";

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
