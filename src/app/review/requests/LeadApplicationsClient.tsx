"use client";

import { useState, useTransition } from "react";
import VideoPlayer from "@/components/VideoPlayer";
import type { LeadApplication } from "@/lib/lead";
import { areaLabel, type AreaSummary } from "@/lib/types";
import { decideLeadApplication } from "../actions";

export type LeadRequest = LeadApplication & { area: AreaSummary | null };

const NEW_TEAM = "new";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

/**
 * Team lead applications, for admins (Travis, 2026-10-03). Finished ones (answers plus
 * video) wait for a decision; ones still missing their video are listed so an admin
 * can follow up by phone or email; recent decisions are kept for reference.
 */
export default function LeadApplications({ applications, areas }: { applications: LeadRequest[]; areas: AreaSummary[] }) {
  const waiting = applications.filter((a) => a.status === "submitted").sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""));
  const started = applications.filter((a) => a.status === "started");
  const decided = applications.filter((a) => a.status === "approved" || a.status === "declined").slice(0, 20);
  return (
    <section>
      <h2 className="text-lg font-semibold">Team lead applications</h2>
      <p className="mt-1 text-sm text-muted">
        From the application at <span className="font-medium text-foreground">/lead</span>: their answers, then a short video on why they would like to lead. Approving makes them a lead of the team you choose.
      </p>
      {waiting.length === 0 ? <p className="mt-2 text-sm text-muted">None waiting for a decision.</p> : <ul className="mt-3 flex flex-col gap-3">{waiting.map((a) => <LeadCard key={a.id} a={a} areas={areas} />)}</ul>}

      {started.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-muted hover:text-foreground">Started, video not sent yet ({started.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {started.map((a) => (
              <li key={a.id} className="card text-sm">
                <div className="font-semibold">{a.full_name} <span className="font-normal text-muted">· {a.language} · {a.audience}</span></div>
                <Contact a={a} />
                <p className="mt-2 whitespace-pre-line">{a.why}</p>
                <div className="mt-1 text-xs text-muted">
                  Started {when(a.created_at)} · {a.user_id ? "email confirmed" : "email not confirmed yet"} · part 2 email sent {a.part2_emails === 1 ? "once" : `${a.part2_emails} times`}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {decided.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-muted hover:text-foreground">Recent decisions ({decided.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {decided.map((a) => (
              <li key={a.id} className="card text-sm">
                <div className="font-semibold">
                  {a.full_name} <span className="font-normal text-muted">· {a.status === "approved" ? `approved as a lead of ${areaLabel(a.area)}` : "declined"} · {when(a.decided_at)}</span>
                </div>
                <Contact a={a} />
                {a.decision_note && <p className="mt-1 text-muted">Note: {a.decision_note}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Contact({ a }: { a: LeadRequest }) {
  return (
    <div className="mt-0.5 text-sm text-muted">
      <a href={`mailto:${a.email}`} className="underline">{a.email}</a> · <a href={`tel:${a.phone.replace(/[^+\d]/g, "")}`} className="underline">{a.phone}</a>
    </div>
  );
}

/** One finished application. A module-level component: its note and team choice are its own state. */
function LeadCard({ a, areas }: { a: LeadRequest; areas: AreaSummary[] }) {
  const sameLanguage = areas.find((t) => t.language.trim().toLowerCase() === a.language.trim().toLowerCase());
  const [team, setTeam] = useState<string>(sameLanguage?.id ?? NEW_TEAM);
  const [teamName, setTeamName] = useState(a.language);
  const [teamLanguage, setTeamLanguage] = useState(a.language);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  function decide(approve: boolean) {
    setError("");
    start(async () => {
      const r = await decideLeadApplication(a.id, approve, note, approve && team !== NEW_TEAM ? team : null, approve && team === NEW_TEAM ? teamName : null, approve && team === NEW_TEAM ? teamLanguage : null);
      if ("error" in r && r.error) setError(r.error);
    });
  }
  return (
    <li className="card">
      <div className="grid gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[220px]">
          <VideoPlayer videoId={a.id} poster={a.video_thumbnail} endpoint={`/api/lead-applications/${a.id}/playback-url`} />
          <div className="mt-1 text-center text-xs text-muted">{a.video_seconds ? `${a.video_seconds}s` : ""}{a.video_size ? ` · ${(a.video_size / 1048576).toFixed(a.video_size < 10 * 1048576 ? 1 : 0)} MB` : ""}</div>
        </div>
        <div className="min-w-0">
          <div className="font-semibold">{a.full_name}</div>
          <Contact a={a} />
          <dl className="mt-3 text-sm">
            <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted">Language</dt><dd className="min-w-0 break-words">{a.language}</dd></div>
            <div className="mt-1 flex gap-2"><dt className="w-28 shrink-0 text-muted">Wants to reach</dt><dd className="min-w-0 break-words">{a.audience}</dd></div>
          </dl>
          <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Why they want to lead</div>
          <p className="mt-1 whitespace-pre-line break-words text-sm">{a.why}</p>
          <div className="mt-2 text-xs text-muted">Sent {when(a.submitted_at)}</div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="label">Make them a lead of</span>
          <select className="input" value={team} onChange={(e) => setTeam(e.target.value)} disabled={pending}>
            {areas.map((t) => <option key={t.id} value={t.id}>{areaLabel(t)}</option>)}
            <option value={NEW_TEAM}>A new team…</option>
          </select>
        </label>
        <label className="block">
          <span className="label">Note back to them (optional)</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} disabled={pending} />
        </label>
        {team === NEW_TEAM && (
          <>
            <label className="block"><span className="label">New team&apos;s name</span><input className="input" value={teamName} onChange={(e) => setTeamName(e.target.value)} disabled={pending} placeholder="Mexico" /></label>
            <label className="block"><span className="label">Its language</span><input className="input" value={teamLanguage} onChange={(e) => setTeamLanguage(e.target.value)} disabled={pending} autoCapitalize="words" /></label>
            <p className="text-xs text-muted sm:col-span-2">One team per language: uploads in that language go to it. If a team already covers the language, choose it above instead.</p>
          </>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => decide(true)} disabled={pending} className="btn-primary flex-1">Approve as a team lead</button>
        <button onClick={() => decide(false)} disabled={pending} className="btn-danger flex-1">Decline</button>
      </div>
    </li>
  );
}
