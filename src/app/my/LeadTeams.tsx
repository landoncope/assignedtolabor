"use client";

import { useState, useTransition } from "react";
import type { GoalState } from "@/lib/goals";
import { areaLabel, type AreaSummary } from "@/lib/types";
import { nudgeMember } from "./actions";

export type TeamMemberView = {
  userId: string; name: string; email: string | null; phone: string | null; isLead: boolean; isSelf: boolean;
  goalLabel: string | null; goalState: GoalState | null; dueLine: string | null;
  lastLine: string; lastDays: number | null; uploads30: number; videosTotal: number;
};
export type TeamReport = { area: AreaSummary; members: TeamMemberView[]; withGoal: number; overdue: number };

/**
 * The lead's view (2026-10-30, Travis): every member's goal, how long since they last
 * sent a video, and a way to reach them from here: an email or a text from the lead's
 * own phone (prefilled), or a reminder email sent by the site.
 */
export default function LeadTeams({ reports, isAdmin, siteUrl }: { reports: TeamReport[]; isAdmin: boolean; siteUrl: string }) {
  return (
    <section aria-labelledby="lead-heading">
      <h2 id="lead-heading" className="text-lg font-semibold">{isAdmin ? "Every team's members" : reports.length === 1 ? "Your team's members" : "Your teams' members"}</h2>
      <p className="mt-1 text-sm text-muted">Each person&rsquo;s goal and when they last sent a video, most overdue first. Email or text them from here.</p>
      {reports.map((r) => <TeamCard key={r.area.id} report={r} siteUrl={siteUrl} />)}
    </section>
  );
}

function TeamCard({ report: r, siteUrl }: { report: TeamReport; siteUrl: string }) {
  const team = areaLabel(r.area);
  return (
    <div className="card mt-3" data-team={r.area.id}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="font-semibold">{team}</div>
        <div className="text-xs text-muted">{r.members.length} {r.members.length === 1 ? "person" : "people"} · {r.withGoal} with a goal · {r.overdue} overdue</div>
      </div>
      {r.members.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Nobody on this team yet.</p>
      ) : (
        <ul className="mt-1 divide-y divide-line">
          {r.members.map((m) => <MemberRow key={m.userId} m={m} areaId={r.area.id} team={team} siteUrl={siteUrl} />)}
        </ul>
      )}
    </div>
  );
}

const PILL: Record<string, [string, string]> = {
  overdue: ["Overdue", "bg-danger/10 text-danger"],
  soon: ["Due soon", "bg-gold/15 text-gold"],
  ok: ["On track", "bg-accent/10 text-accent"],
  none: ["No goal", "bg-line text-muted"],
};

function MemberRow({ m, areaId, team, siteUrl }: { m: TeamMemberView; areaId: string; team: string; siteUrl: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pillText, pillClass] = PILL[m.goalState ?? "none"];
  const first = m.name.split(/[\s@]/)[0] || "there";
  const ago = m.lastDays === null ? "We haven't had a video from you yet." : m.lastDays === 0 ? "Thank you for today's video." : `It's been ${m.lastDays} day${m.lastDays === 1 ? "" : "s"} since your last video.`;
  const body = `Hi ${first},\n\n${ago} Could you record another one this week? It takes about two minutes: ${siteUrl}/upload\n\nThank you!`;
  const mailto = m.email ? `mailto:${m.email}?subject=${encodeURIComponent(`A nudge from the ${team} team`)}&body=${encodeURIComponent(body)}` : null;
  // "?&body=" is the form both iPhones and Androids open with the text filled in.
  const sms = m.phone ? `sms:${m.phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(body)}` : null;

  function send() {
    setResult(null);
    start(async () => {
      const r = await nudgeMember(areaId, m.userId, note);
      if ("error" in r) setResult({ ok: false, text: r.error });
      else { setResult({ ok: true, text: `Sent to ${m.email}.` }); setOpen(false); setNote(""); }
    });
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{m.name}</span>
        {m.isLead && <span className="rounded bg-line px-1.5 py-0.5 text-xs text-muted">lead</span>}
        {m.isSelf && <span className="rounded bg-line px-1.5 py-0.5 text-xs text-muted">you</span>}
        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${pillClass}`}>{pillText}</span>
      </div>
      <div className="mt-0.5 text-sm text-muted">
        {m.goalLabel ? `${m.goalLabel}${m.dueLine ? ` · ${m.dueLine}` : ""}` : "No goal set"} · {m.lastLine} · {m.uploads30} in the last 30 days, {m.videosTotal} in all
      </div>
      {!m.isSelf && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {mailto ? <a href={mailto} className="text-accent underline">Email</a> : <span className="text-muted">No email on file</span>}
          {sms ? <a href={sms} className="text-accent underline">Text</a> : <span className="text-muted" title="They can add a phone number on their dashboard">No phone on file</span>}
          {m.email && <button onClick={() => { setOpen((o) => !o); setResult(null); }} className="text-accent underline">{open ? "Never mind" : "Send a reminder from the site"}</button>}
        </div>
      )}
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={600} rows={2} className="input text-sm" placeholder="A line from you (optional). The email says who it is from, when their last video was, and links to the recorder." />
          <div><button onClick={send} disabled={pending} className="btn-primary text-sm">{pending ? "Sending…" : "Send the reminder"}</button></div>
        </div>
      )}
      {result && <p className={`mt-1 text-sm ${result.ok ? "text-accent" : "text-danger"}`}>{result.text}</p>}
    </li>
  );
}
