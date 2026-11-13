"use client";

import { useState } from "react";
import TeamImpact from "@/app/my/TeamImpact";
import type { ChannelRow } from "@/lib/channel-overview";
import { IMPACT_FIELDS } from "@/lib/impact";

const n = (v: number | null) => (v === null ? "–" : new Intl.NumberFormat("en-US").format(v));

/**
 * Every channel at a glance, for admins (2026-11-12, Travis): a table on a wide screen,
 * a card per channel on a phone. "Results" opens the channel's figures and stories,
 * which an admin can edit for any team.
 */
export default function ChannelOverview({ rows }: { rows: ChannelRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const anySite = rows.some((r) => r.source === "site");
  const toggle = (id: string) => setOpen(open === id ? null : id);
  return (
    <section className="card" aria-labelledby="channels-heading" id="channels">
      <h2 id="channels-heading" className="font-semibold">Every channel at a glance</h2>

      {/* Wide screens: one row per channel. */}
      <table className="mt-3 hidden w-full text-sm sm:table">
        <thead>
          <tr className="border-b border-line text-left text-xs text-muted">
            <th className="py-1 pr-3 font-medium">Channel</th>
            <th className="px-2 py-1 text-right font-medium">Members</th>
            <th className="px-2 py-1 text-right font-medium">Followers</th>
            <th className="px-2 py-1 font-medium">Last post</th>
            <th className="px-2 py-1 text-right font-medium">Posts, 7 days</th>
            <th className="px-2 py-1 text-right font-medium">Posts, 30 days</th>
            <th className="py-1 pl-2 text-right font-medium">Waiting</th>
          </tr>
        </thead>
        {rows.map((r) => (
          <tbody key={r.id} className="border-b border-line last:border-0" data-channel={r.id}>
            <tr className="align-top">
              <td className="py-2 pr-3"><Name r={r} /><ResultsToggle r={r} open={open === r.id} onClick={() => toggle(r.id)} /></td>
              <td className="px-2 py-2 text-right tabular-nums" data-col="members">{n(r.members)}</td>
              <td className="px-2 py-2 text-right tabular-nums" data-col="followers">{n(r.followers)}{r.followersAsOf && <div className="text-xs text-muted">as of {r.followersAsOf}</div>}</td>
              <td className="px-2 py-2" data-col="last"><LastPost r={r} /></td>
              <td className="px-2 py-2 text-right tabular-nums" data-col="posts7">{r.posts7}{r.source === "site" && <Mark />}</td>
              <td className="px-2 py-2 text-right tabular-nums" data-col="posts30">{r.posts30}{r.source === "site" && <Mark />}</td>
              <td className="py-2 pl-2 text-right tabular-nums" data-col="pending">{n(r.pending)}</td>
            </tr>
            {open === r.id && r.impact && (
              <tr><td colSpan={7} className="pb-3"><TeamImpact areaId={r.id} canEdit impact={r.impact} /></td></tr>
            )}
          </tbody>
        ))}
      </table>

      {/* Phones: a card per channel. */}
      <ul className="mt-3 flex flex-col gap-3 sm:hidden">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border border-line p-3" data-channel-card={r.id}>
            <Name r={r} />
            <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
              <Cell label="Members">{n(r.members)}</Cell>
              <Cell label="Followers">{n(r.followers)}{r.followersAsOf && <span className="block text-xs font-normal text-muted">as of {r.followersAsOf}</span>}</Cell>
              <Cell label="Waiting">{n(r.pending)}</Cell>
              <Cell label="Last post"><LastPost r={r} /></Cell>
              <Cell label="Posts, 7 days">{r.posts7}{r.source === "site" && <Mark />}</Cell>
              <Cell label="Posts, 30 days">{r.posts30}{r.source === "site" && <Mark />}</Cell>
            </dl>
            <ResultsToggle r={r} open={open === r.id} onClick={() => toggle(r.id)} />
            {open === r.id && r.impact && <TeamImpact areaId={r.id} canEdit impact={r.impact} />}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-muted">
        Members counts everyone on the team, leads included. Followers and posts come from Instagram once a channel&rsquo;s account is connected, refreshed every few hours; Waiting is videos to review.
        {anySite && <> <Mark /> Not connected (or Instagram has not answered in the last day): only posts made or marked as posted on this site are counted.</>}
      </p>
    </section>
  );
}

const Mark = () => <span className="text-muted" title="Counted from this site only">*</span>;

function Name({ r }: { r: ChannelRow }) {
  return (
    <div className="min-w-0">
      <div className="font-semibold">{r.label}</div>
      <div className="text-xs text-muted">
        {r.handle ? <a href={`https://www.instagram.com/${r.handle}/`} target="_blank" rel="noreferrer" className="text-accent">@{r.handle}</a> : "No Instagram account on file"}
        {!r.connected && <span className={r.lost ? "text-danger" : ""}> · {r.lost ? "connection lost" : "not connected"}</span>}
      </div>
    </div>
  );
}

function LastPost({ r }: { r: ChannelRow }) {
  if (!r.lastPost) return <span className="text-muted">None yet</span>;
  return (
    <>
      {r.lastPost.url ? <a href={r.lastPost.url} target="_blank" rel="noreferrer" className="text-accent underline">{r.lastPost.day}</a> : r.lastPost.day}
      <span className="block text-xs font-normal text-muted">{r.lastPost.ago}</span>
    </>
  );
}

/** Opens the channel's figures and stories; shows the headline figures when there are some. */
function ResultsToggle({ r, open, onClick }: { r: ChannelRow; open: boolean; onClick: () => void }) {
  const latest = r.impact?.latest ?? null;
  const short: Record<string, string> = { requests: "asked for missionaries", referrals: "sent on", baptisms: "baptized" };
  const figures = latest ? IMPACT_FIELDS.filter((f) => typeof latest[f.key] === "number").map((f) => `${n(latest[f.key])} ${short[f.key]}`).join(" · ") : "";
  return (
    <button type="button" onClick={onClick} aria-expanded={open} className="mt-1 text-left text-xs text-accent underline">
      {open ? "Hide results" : figures ? `Results: ${figures}` : "Results and stories"}
    </button>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{children}</dd>
    </div>
  );
}
