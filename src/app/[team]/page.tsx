import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { embedUrl, looksLikeBot, SLUG_PATTERN } from "@/lib/team-page";
import TeamForm from "./TeamForm";

type TeamPage = { id: string; name: string; instagram_handle: string | null; slug: string; referral_form_url: string | null; referral_form_title: string | null };

/** The active team at this address, if it has a form to show. Anything else is a 404. */
const load = cache(async (raw: string): Promise<(TeamPage & { referral_form_url: string }) | null> => {
  const slug = raw.toLowerCase();
  if (!SLUG_PATTERN.test(slug)) return null;
  const supabase = await createClient();
  const { data } = await supabase.from("areas").select("id, name, instagram_handle, slug, referral_form_url, referral_form_title").eq("slug", slug).eq("is_active", true).maybeSingle();
  const team = data as TeamPage | null;
  return team?.referral_form_url ? { ...team, referral_form_url: team.referral_form_url } : null;
});

export async function generateMetadata({ params }: PageProps<"/[team]">): Promise<Metadata> {
  const team = await load((await params).team);
  if (!team) return {};
  const title = team.referral_form_title ?? "Meet with missionaries";
  // The channel's own page, not ours: no site name in the title, and kept out of search results.
  return { title: { absolute: title }, description: null, robots: { index: false }, openGraph: { title, url: `/${team.slug}` } };
}

/**
 * A team's page, assignedtolabor.org/<slug> (2026-11-12, Travis): the channel's "meet
 * with missionaries" form at an address of ours, for the link in the channel's bio. A
 * Google Form is shown in the page; any other link is forwarded to. What a visitor types
 * goes to whoever runs the form, never to us; we only count that the page was opened.
 */
export default async function TeamPageRoute({ params }: PageProps<"/[team]">) {
  const team = await load((await params).team);
  if (!team) notFound();
  const src = embedUrl(team.referral_form_url);
  if (!src) {
    if (!looksLikeBot((await headers()).get("user-agent"))) await createAdminClient().rpc("bump_team_page", { aid: team.id });
    redirect(team.referral_form_url);
  }
  return <TeamForm slug={team.slug} src={src} formUrl={team.referral_form_url} title={team.referral_form_title ?? "Meet with missionaries"} handle={team.instagram_handle?.replace(/^@/, "") || null} />;
}
