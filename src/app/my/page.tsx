import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import { getViewer } from "@/lib/auth";
import { siteUrl } from "@/lib/email";
import { daysAgo, dueText, formatDay, goalDef, goalStatus, type GoalState } from "@/lib/goals";
import { loadStats, statsForDashboard, type StatsRow } from "@/lib/instagram-stats";
import { LEAD_STATUS_LABEL, type LeadApplication } from "@/lib/lead";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { AREA_SUMMARY_COLS, areaLabel, STATUS_LABEL, type AreaSummary, type VideoWithArea } from "@/lib/types";
import ClaimCard, { type Claimable } from "./ClaimCard";
import GoalCard, { type GoalView } from "./GoalCard";
import LeadTeams, { type TeamMemberView, type TeamReport } from "./LeadTeams";
import ProfileCard from "./ProfileCard";
import TeamStats, { type TeamOverview } from "./TeamStats";

export const metadata: Metadata = { title: "Dashboard" };

/** A row of team_goal_report (supabase/migrations/20261030120000_dashboard_goals.sql). */
type ReportRow = {
  user_id: string; display_name: string | null; email: string | null; phone: string | null; is_lead: boolean; member_since: string;
  upload_goal: string | null; upload_goal_set_at: string | null; last_upload_at: string | null; uploads_30d: number; videos_total: number; last_posted_at: string | null;
};

/**
 * The dashboard (2026-10-30, Travis): what people land on after signing in. The team's
 * Instagram numbers, the person's upload goal with its countdown, for leads every
 * member's goal and last upload, then the person's own videos as before.
 */
export default async function MyPage({ searchParams }: PageProps<"/my">) {
  const sp = await searchParams;
  const now = new Date();
  const viewer = await getViewer();
  const supabase = await createClient();
  const signedIn = !!viewer && !viewer.isAnonymous;
  const { data } = await supabase
    .from("videos")
    .select(`*, area:areas(${AREA_SUMMARY_COLS})`)
    .eq("user_id", viewer?.userId ?? "")
    .order("created_at", { ascending: false });
  const videos = (data ?? []) as VideoWithArea[];
  // Uploads an anonymous session made with this account's email, before the person signed in.
  const { data: claimable } = signedIn ? await supabase.rpc("claimable_uploads") : { data: null };
  const toClaim = (claimable ?? []) as Claimable[];
  // Their team lead application, if they have one (this also attaches one waiting on their address).
  let lead: Pick<LeadApplication, "status"> | null = null;
  if (signedIn) {
    const { data: leadId } = await supabase.rpc("lead_claim");
    if (leadId) lead = (await supabase.from("lead_applications").select("status").eq("id", leadId as string).maybeSingle()).data as Pick<LeadApplication, "status"> | null;
  }

  // The teams this person is on (member or lead); admins also get every other team, compactly.
  let myTeams: AreaSummary[] = [];
  let otherTeams: AreaSummary[] = [];
  const teamData = new Map<string, { overview: TeamOverview | null; stats: StatsRow | null }>();
  const reports: TeamReport[] = [];
  if (signedIn && viewer) {
    const [{ data: mem }, { data: areaRows }] = await Promise.all([
      supabase.from("area_members").select("area_id").eq("user_id", viewer.userId),
      supabase.from("areas").select(AREA_SUMMARY_COLS).eq("is_active", true).order("sort_order").order("name"),
    ]);
    const areas = (areaRows ?? []) as AreaSummary[];
    const mine = new Set<string>([...((mem ?? []) as { area_id: string }[]).map((m) => m.area_id), ...viewer.managedAreaIds]);
    myTeams = areas.filter((a) => mine.has(a.id));
    otherTeams = viewer.isAdmin ? areas.filter((a) => !mine.has(a.id)) : [];
    const admin = createAdminClient();
    // Only the viewer's own teams may be fetched from Instagram now; the admin's list of
    // other teams shows what is cached (see src/lib/instagram-stats.ts for why).
    await Promise.all([...myTeams, ...otherTeams].map(async (a) => {
      const own = mine.has(a.id);
      const [{ data: ov }, stats] = await Promise.all([
        supabase.rpc("team_overview", { aid: a.id }),
        (own ? statsForDashboard(admin, a.id, !!a.instagram_user_id) : loadStats(admin, a.id)).catch((e: unknown) => { console.error(`[dashboard] stats for ${a.id}: ${e instanceof Error ? e.message : String(e)}`); return null; }),
      ]);
      const row = (Array.isArray(ov) ? ov[0] : ov) as TeamOverview | undefined;
      teamData.set(a.id, { overview: row ?? null, stats });
    }));
    // The lead's view of each team they lead (admins: every team).
    for (const a of areas.filter((x) => viewer.isAdmin || viewer.managedAreaIds.includes(x.id))) {
      const { data: rows } = await supabase.rpc("team_goal_report", { aid: a.id });
      const members = ((rows ?? []) as ReportRow[]).map((r): TeamMemberView => {
        const s = goalStatus(r.upload_goal, r.upload_goal_set_at, r.last_upload_at, now);
        const last = r.last_upload_at ? new Date(r.last_upload_at) : null;
        return {
          userId: r.user_id, name: r.display_name ?? r.email ?? "Someone", email: r.email, phone: r.phone, isLead: r.is_lead, isSelf: r.user_id === viewer.userId,
          goalLabel: goalDef(r.upload_goal)?.label ?? null, goalState: s?.state ?? null, dueLine: s ? `${dueText(s)} (${formatDay(s.dueAt)})` : null,
          lastLine: last ? `Last video ${daysAgo(last, now)} (${formatDay(last)})` : "No videos yet",
          lastDays: last ? Math.floor((now.getTime() - last.getTime()) / 86400_000) : null,
          uploads30: r.uploads_30d, videosTotal: r.videos_total,
        };
      });
      const rank: Record<string, number> = { overdue: 0, soon: 1, ok: 2 };
      members.sort((x, y) => (rank[x.goalState ?? "none"] ?? 3) - (rank[y.goalState ?? "none"] ?? 3) || (y.lastDays ?? 1e9) - (x.lastDays ?? 1e9) || x.name.localeCompare(y.name));
      reports.push({ area: a, members, withGoal: members.filter((m) => m.goalLabel).length, overdue: members.filter((m) => m.goalState === "overdue").length });
    }
  }

  // The person's own goal and its countdown.
  const profile = viewer?.profile ?? null;
  const status = signedIn && profile ? goalStatus(profile.upload_goal, profile.upload_goal_set_at, videos[0]?.created_at ?? null, now) : null;
  const goalView: GoalView | null = status ? {
    label: status.goal.label, every: status.goal.every, state: status.state as GoalState, fraction: status.fraction,
    due: dueText(status), dueDay: formatDay(status.dueAt),
    since: status.sinceIsUpload ? `Last video ${daysAgo(status.since, now)} (${formatDay(status.since)})` : `Goal set ${daysAgo(status.since, now)} (${formatDay(status.since)}), no video since`,
    remind: `We email a reminder ${status.goal.remindHoursBefore >= 48 ? `${status.goal.remindHoursBefore / 24} days` : status.goal.remindHoursBefore === 24 ? "a day" : "12 hours"} before it is due.`,
  } : null;
  const uploads30 = videos.filter((v) => now.getTime() - new Date(v.created_at).getTime() < 30 * 86400_000).length;

  return (
    <>
      <Nav current="my" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        {sp.denied && <p className="mb-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">You don&apos;t have access to that page.</p>}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{signedIn ? "Dashboard" : "My videos"}</h1>
          <Link href="/upload" className="btn-primary">Record a video</Link>
        </div>
        {toClaim.length > 0 && <ClaimCard videos={toClaim} />}
        {viewer?.isAnonymous && (
          <p className="mt-3 text-sm text-muted">You&apos;re not signed in. These videos are tied to this browser only. <Link href="/login" className="underline">Sign in</Link> to keep them, set an upload goal and see your team.</p>
        )}

        {signedIn && viewer && (
          <div className="mt-6 flex flex-col gap-6">
            {/* The team's numbers, or the invitation to join one. */}
            <section>
              <h2 className="text-lg font-semibold">{myTeams.length === 1 ? "Your team" : "Your teams"}</h2>
              {myTeams.length === 0 ? (
                <div className="card mt-2">
                  <p className="text-sm"><b>Apply to start or join a team.</b> After joining, you will see your team&rsquo;s data here: its Instagram followers, its posts and how they are doing.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href="/my/teams" className="btn-primary">Join or start a team</Link>
                    <Link href="/lead" className="btn-secondary">Apply to lead a team</Link>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-col gap-3">
                  {myTeams.map((a) => <TeamStats key={a.id} team={a} overview={teamData.get(a.id)?.overview ?? null} stats={teamData.get(a.id)?.stats ?? null} isLead={viewer.isAdmin || viewer.managedAreaIds.includes(a.id)} />)}
                </div>
              )}
              {otherTeams.length > 0 && (
                <div className="card mt-3">
                  <div className="label">All other teams (admins see every team)</div>
                  <ul className="mt-1 divide-y divide-line">
                    {otherTeams.map((a) => <li key={a.id} className="py-2"><TeamStats team={a} overview={teamData.get(a.id)?.overview ?? null} stats={teamData.get(a.id)?.stats ?? null} isLead compact /></li>)}
                  </ul>
                </div>
              )}
            </section>

            <GoalCard current={profile?.upload_goal ?? null} email={viewer.email} view={goalView} uploads30={uploads30} />

            {reports.length > 0 && <LeadTeams reports={reports} isAdmin={viewer.isAdmin} siteUrl={siteUrl} />}

            <ProfileCard name={profile?.display_name ?? ""} phone={profile?.phone ?? ""} email={viewer.email} />

            <div className="flex flex-col gap-3">
              <Link href="/my/teams" className="card flex items-center justify-between gap-3 hover:border-accent">
                <span className="text-sm"><b>Teams.</b> Join a team or start one, and your videos go straight to its lead.</span>
                <span className="shrink-0 text-sm text-accent">Open ›</span>
              </Link>
              {lead && (lead.status === "started" || lead.status === "submitted") && (
                <Link href={lead.status === "started" ? "/lead/video" : "/lead"} className={`card flex items-center justify-between gap-3 hover:border-accent ${lead.status === "started" ? "border-gold/60 bg-gold/10" : ""}`}>
                  <span className="text-sm"><b>Team lead application.</b> {lead.status === "started" ? "Part 2 is waiting: a short video on why you would like to lead." : LEAD_STATUS_LABEL[lead.status] + "."}</span>
                  <span className="shrink-0 text-sm text-accent">{lead.status === "started" ? "Record it ›" : "Open ›"}</span>
                </Link>
              )}
            </div>
          </div>
        )}

        <section className="mt-8">
          {signedIn && <h2 className="text-lg font-semibold">My videos</h2>}
          {videos.length === 0 ? (
            <p className="mt-6 text-center text-muted">No videos yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {videos.map((v) => (
                <li key={v.id} className="card flex gap-4">
                  <Thumb src={v.thumbnail} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{STATUS_LABEL[v.status]}</div>
                    <div className="mt-0.5 text-sm text-muted">{v.language ? `${v.language} · ` : ""}{areaLabel(v.area)} · {new Date(v.created_at).toLocaleDateString()}</div>
                    {v.script?.body && <p className="mt-2 line-clamp-2 text-sm">{v.script.body}</p>}
                    {v.status === "rejected" && v.rejection_note && <p className="mt-2 text-sm text-muted">Note from the team: {v.rejection_note}</p>}
                    {v.status === "posted" && v.post_url && <a href={v.post_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm text-accent underline">See the post</a>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

function Thumb({ src }: { src: string | null }) {
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt="" className="h-20 w-14 shrink-0 rounded-md object-cover" />
    : <div className="h-20 w-14 shrink-0 rounded-md bg-line" />;
}
