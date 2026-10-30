import Link from "next/link";
import type { StatsRow } from "@/lib/instagram-stats";
import { areaLabel, type AreaSummary } from "@/lib/types";

/** A row of team_overview (supabase/migrations/20261030120000_dashboard_goals.sql). */
export type TeamOverview = { people: number; uploads_30d: number; posted_30d: number; pending: number; posted_total: number; last_upload_at: string | null; last_posted_at: string | null };

const n = (v: number | null | undefined) => (v === null || v === undefined ? "–" : new Intl.NumberFormat("en-US").format(v));
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";

/**
 * The team's numbers for its members (2026-10-30, Travis): what Instagram says about the
 * team's account (cached by src/lib/instagram-stats.ts) and what this site knows about
 * the team's videos. `compact` is the one-line form admins see for teams they are not on.
 */
export default function TeamStats({ team, overview, stats, isLead, compact = false }: { team: AreaSummary; overview: TeamOverview | null; stats: StatsRow | null; isLead: boolean; compact?: boolean }) {
  const handle = (team.instagram_handle ?? stats?.username ?? "").replace(/^@/, "");
  const connected = !!team.instagram_user_id;
  const p = stats?.profile ?? null;
  const posts = stats?.media ?? [];
  const likes = posts.reduce((a, m) => a + (m.likes ?? 0), 0);
  const comments = posts.reduce((a, m) => a + (m.comments ?? 0), 0);
  const views = posts.some((m) => typeof m.views === "number") ? posts.reduce((a, m) => a + (m.views ?? 0), 0) : null;
  const ins = stats?.insights ?? null;

  if (compact) {
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span><b>{areaLabel(team)}</b>{handle ? <> · <a href={`https://www.instagram.com/${handle}/`} target="_blank" rel="noreferrer" className="text-accent">@{handle}</a></> : " · no Instagram account on file"}{!connected && " · not connected"}</span>
        <span className="text-muted">{p ? `${n(p.followers)} followers · ` : ""}{overview ? `${overview.posted_30d} posted and ${overview.uploads_30d} sent in 30 days · ${overview.pending} waiting` : ""}</span>
      </div>
    );
  }

  return (
    <section className="card" aria-label={`${areaLabel(team)} team`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          {p?.pictureUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.pictureUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
          )}
          <div>
            <div className="font-semibold">{areaLabel(team)}</div>
            {handle ? <a href={`https://www.instagram.com/${handle}/`} target="_blank" rel="noreferrer" className="text-sm text-accent">@{handle}</a> : <span className="text-sm text-muted">No Instagram account on file</span>}
          </div>
        </div>
        {!connected && (
          <span className="text-xs text-muted">{isLead ? <>Not connected. <Link href="/review#instagram" className="text-accent underline">Connect it on the Review page</Link>.</> : "Not connected yet (its lead connects it from the Review page)."}</span>
        )}
      </div>
      {!connected && team.instagram_lost_at && (
        <p className="mt-2 text-xs text-danger">Instagram ended the connection on {new Date(team.instagram_lost_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}: {team.instagram_lost_reason}</p>
      )}

      {p ? (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Followers" value={n(p.followers)} />
            <Stat label="Posts" value={n(p.mediaCount)} />
            <Stat label={`Likes, last ${posts.length}`} value={n(likes)} />
            <Stat label={`Comments, last ${posts.length}`} value={n(comments)} />
          </dl>
          {ins && (ins.reach !== null || ins.views !== null) && (
            <p className="mt-3 text-sm"><b>Last 30 days on Instagram:</b> {n(ins.reach)} accounts reached · {n(ins.views)} views · {n(ins.interactions)} interactions{views !== null ? ` · ${n(views)} views on the last ${Math.min(posts.length, 12)} posts` : ""}</p>
          )}
        </>
      ) : connected ? (
        <p className="mt-3 text-sm text-muted">{stats?.error ? `Instagram did not answer the last time we asked: ${stats.error}` : "Instagram's numbers are being fetched; check back in a minute."}</p>
      ) : null}

      {overview && (
        <p className="mt-3 text-sm"><b>From this site:</b> {overview.uploads_30d} video{overview.uploads_30d === 1 ? "" : "s"} sent to the team in the last 30 days · {overview.posted_30d} posted · {overview.pending} waiting for review · {overview.people} {overview.people === 1 ? "person" : "people"} on the team</p>
      )}

      {posts.length > 0 && (
        <div className="mt-3">
          <div className="label">Recent posts</div>
          <ul className="flex gap-3 overflow-x-auto pb-1">
            {posts.slice(0, 8).map((m) => (
              <li key={m.id} className="w-24 shrink-0 text-xs text-muted">
                <a href={m.permalink ?? "#"} target="_blank" rel="noreferrer" className="block">
                  {m.thumbnailUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={m.thumbnailUrl} alt="" className="aspect-[9/16] w-24 rounded-md bg-line object-cover" />
                    : <div className="aspect-[9/16] w-24 rounded-md bg-line" />}
                  <div className="mt-1 truncate">{m.timestamp ? new Date(m.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : ""}</div>
                  <div>{n(m.likes)} likes · {n(m.comments)} comments{typeof m.views === "number" ? ` · ${n(m.views)} views` : ""}</div>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats && (stats.succeeded_at || stats.error) && (
        <p className="mt-3 text-xs text-muted">
          {stats.succeeded_at ? `Instagram's numbers as of ${when(stats.succeeded_at)}, refreshed every few hours.` : ""}
          {stats.error && stats.succeeded_at ? ` The last refresh failed: ${stats.error}` : ""}
        </p>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-background px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-xl font-bold">{value}</dd>
    </div>
  );
}
