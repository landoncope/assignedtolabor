"use client";

import { useState, useTransition } from "react";
import { APPLICATION_STATUS_LABEL, areaLabel, type Area, type AreaSummary, type TeamApplication } from "@/lib/types";
import { applyToJoin, applyToStart, leaveTeam, withdrawApplication } from "./actions";

export type Membership = { area_id: string; created_at: string; area: AreaSummary | null };
export type ApplicationWithArea = TeamApplication & { area: AreaSummary | null };
type Result = { ok: true } | { error: string };

export default function TeamsClient({ areas, memberships, leadAreaIds, applications }: { areas: Area[]; memberships: Membership[]; leadAreaIds: string[]; applications: ApplicationWithArea[] }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [joinOpen, setJoinOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  function run(fn: () => Promise<Result>, after?: () => void) {
    setError("");
    start(async () => { const r = await fn(); if ("error" in r) setError(r.error); else after?.(); });
  }
  const memberIds = new Set(memberships.map((m) => m.area_id));
  const pendingJoinIds = new Set(applications.filter((a) => a.kind === "join" && a.status === "pending").map((a) => a.area_id));
  const joinable = areas.filter((a) => !memberIds.has(a.id) && !leadAreaIds.includes(a.id) && !pendingJoinIds.has(a.id));
  const leadAreas = areas.filter((a) => leadAreaIds.includes(a.id));
  const hasOpenStart = applications.some((a) => a.kind === "start" && a.status === "pending");
  const label = (a: ApplicationWithArea) =>
    a.kind === "join" ? `Join ${areaLabel(a.area)}${a.wants_lead ? " as a lead" : ""}` : `Start ${a.team_name}${a.language ? ` · ${a.language}` : ""}${a.region ? ` · ${a.region}` : ""}`;

  return (
    <div className="mt-6 flex flex-col gap-8">
      <section>
        <h2 className="text-lg font-semibold">Your teams</h2>
        {memberships.length + leadAreas.length === 0 ? (
          <p className="mt-2 text-sm text-muted">You are not on a team yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {leadAreas.map((a) => (
              <li key={`lead-${a.id}`} className="card">
                <div className="font-semibold">{areaLabel(a)}</div>
                <div className="text-sm text-muted">You lead this team. Videos sent to it wait for you under Review.</div>
              </li>
            ))}
            {memberships.filter((m) => !leadAreaIds.includes(m.area_id)).map((m) => (
              <li key={m.area_id} className="card flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold">{areaLabel(m.area)}</div>
                  <div className="text-sm text-muted">Member since {new Date(m.created_at).toLocaleDateString()}. Pick this team when you record and the video goes straight to its lead.</div>
                </div>
                <button onClick={() => run(() => leaveTeam(m.area_id))} disabled={pending} className="text-sm text-muted hover:text-danger">Leave</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold">Your requests</h2>
        {applications.length === 0 ? (
          <p className="mt-2 text-sm text-muted">None yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {applications.map((a) => (
              <li key={a.id} className="card flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">{label(a)}</div>
                  <div className="text-sm text-muted">{APPLICATION_STATUS_LABEL[a.status]} · sent {new Date(a.created_at).toLocaleDateString()}</div>
                  {a.decision_note && <p className="mt-1 text-sm">Note from the {a.kind === "join" ? "team lead" : "admins"}: {a.decision_note}</p>}
                </div>
                {a.status === "pending" && <button onClick={() => run(() => withdrawApplication(a.id))} disabled={pending} className="text-sm text-muted hover:text-danger">Withdraw</button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="card">
          <h2 className="font-semibold">Join a team</h2>
          <p className="mt-1 text-sm text-muted">The team&apos;s lead sees your request and decides.</p>
          {joinOpen ? (
            <form action={(fd) => run(() => applyToJoin(fd), () => setJoinOpen(false))} className="mt-3 flex flex-col gap-2">
              <label>
                <span className="label">Team</span>
                <select name="area_id" className="input" required defaultValue="">
                  <option value="" disabled>Choose a team</option>
                  {joinable.map((a) => <option key={a.id} value={a.id}>{areaLabel(a)}</option>)}
                </select>
              </label>
              <label><span className="label">A few words about you (optional)</span><textarea name="note" className="input min-h-20" placeholder="Where you are and how you'd like to help" /></label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="wants_lead" /> I&apos;d like to lead this team (an admin decides)</label>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={pending || joinable.length === 0}>Send request</button>
                <button type="button" onClick={() => setJoinOpen(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          ) : (
            <button onClick={() => setJoinOpen(true)} disabled={joinable.length === 0} className="btn-primary mt-3">{joinable.length === 0 ? "No other teams to join right now" : "Ask to join"}</button>
          )}
        </div>
        <div className="card">
          <h2 className="font-semibold">Start a team</h2>
          <p className="mt-1 text-sm text-muted">Propose a team for a language that has none yet. An admin decides, and you would be its lead. To lead an existing team, ask to join it instead.</p>
          {startOpen ? (
            <form action={(fd) => run(() => applyToStart(fd), () => setStartOpen(false))} className="mt-3 flex flex-col gap-2">
              <label><span className="label">Team name</span><input name="team_name" className="input" placeholder="Philippines" required /></label>
              <label>
                <span className="label">Language</span>
                <input name="language" className="input" placeholder="Tagalog, Swahili, Spanish…" required autoComplete="off" autoCapitalize="words" />
              </label>
              <label><span className="label">Where in the world</span><input name="region" className="input" placeholder="Manila, Philippines" /></label>
              <label><span className="label">Instagram account, if the team has one</span><input name="instagram_handle" className="input" placeholder="@handle" /></label>
              <label><span className="label">Why this team (optional)</span><textarea name="note" className="input min-h-20" /></label>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={pending}>Send request</button>
                <button type="button" onClick={() => setStartOpen(false)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          ) : (
            <button onClick={() => setStartOpen(true)} disabled={hasOpenStart} className="btn-primary mt-3">{hasOpenStart ? "Request sent, waiting on an admin" : "Propose a team"}</button>
          )}
        </div>
      </section>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
