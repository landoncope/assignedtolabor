"use client";

import { useState, useTransition } from "react";
import { areaLabel, type AreaSummary, type TeamApplication } from "@/lib/types";
import { decideApplication } from "../actions";

export type Request = TeamApplication & { area: AreaSummary | null; profile: { id: string; email: string | null; display_name: string | null } | null };

export default function RequestsClient({ requests, isAdmin }: { requests: Request[]; isAdmin: boolean }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState<Record<string, string>>({});
  function decide(id: string, approve: boolean) {
    setError("");
    start(async () => { const r = await decideApplication(id, approve, notes[id] ?? ""); if ("error" in r && r.error) setError(r.error); });
  }
  const joins = requests.filter((r) => r.kind === "join");
  const starts = requests.filter((r) => r.kind === "start");
  const who = (r: Request) => (r.profile?.display_name ? `${r.profile.display_name} (${r.profile.email ?? "no email"})` : r.profile?.email ?? "Someone");
  // A plain function, not a component: a component defined here would remount on each keystroke in the note field.
  const card = (r: Request) => (
    <li key={r.id} className="card">
      <div className="font-semibold">
        {r.kind === "join" ? <>{who(r)} wants to join <b>{areaLabel(r.area)}</b></> : <>{who(r)} wants to start <b>{r.team_name}</b></>}
      </div>
      {r.kind === "start" && <div className="mt-1 text-sm text-muted">{r.language}{r.region ? ` · ${r.region}` : ""}{r.instagram_handle ? ` · @${r.instagram_handle}` : ""}</div>}
      {r.note && <p className="mt-2 whitespace-pre-line text-sm">{r.note}</p>}
      <div className="mt-1 text-xs text-muted">Sent {new Date(r.created_at).toLocaleString()}</div>
      <input className="input mt-3" placeholder="Optional note back to them" value={notes[r.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
      <div className="mt-2 flex gap-2">
        <button onClick={() => decide(r.id, true)} disabled={pending} className="btn-primary flex-1">{r.kind === "join" ? "Add to the team" : "Create the team"}</button>
        <button onClick={() => decide(r.id, false)} disabled={pending} className="btn-danger flex-1">Decline</button>
      </div>
    </li>
  );
  return (
    <div className="mt-6 flex flex-col gap-8">
      <section>
        <h2 className="text-lg font-semibold">Join requests</h2>
        {joins.length === 0 ? <p className="mt-2 text-sm text-muted">Nobody is waiting.</p> : <ul className="mt-2 flex flex-col gap-3">{joins.map(card)}</ul>}
      </section>
      {isAdmin && (
        <section>
          <h2 className="text-lg font-semibold">New team proposals</h2>
          <p className="mt-1 text-sm text-muted">Approving creates the team with this person as its lead. Rename it or add an Instagram handle later in Admin.</p>
          {starts.length === 0 ? <p className="mt-2 text-sm text-muted">None waiting.</p> : <ul className="mt-2 flex flex-col gap-3">{starts.map(card)}</ul>}
        </section>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
