"use client";

import { useState, useTransition } from "react";
import { areaLabel, type Area } from "@/lib/types";
import { addManager, createArea, removeInvite, removeManager, removeMember, updateArea } from "./actions";

const SITE_HOST = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://assignedtolabor.org").replace(/^https?:\/\//, "").replace(/\/$/, "");

export type AreaWithManagers = Area & {
  managers: { id: string; email: string | null; display_name: string | null }[];
  invites: string[];
  members: { id: string; email: string | null; display_name: string | null }[];
};

export default function AreasAdmin({ areas }: { areas: AreaWithManagers[] }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  function run(fn: () => Promise<{ ok: true } | { error: string }>) {
    setError("");
    start(async () => { const r = await fn(); if ("error" in r) setError(r.error); });
  }
  return (
    <div className="mt-4 flex flex-col gap-3">
      {areas.map((a) => <AreaCard key={a.id} area={a} run={run} pending={pending} />)}
      <form action={(fd) => run(() => createArea(fd))} className="card flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex-1"><span className="label">New team</span><input name="name" className="input" placeholder="Philippines" required /></label>
        <label className="flex-1"><span className="label">Language</span><input name="language" className="input" placeholder="Tagalog" required /></label>
        <label className="flex-1"><span className="label">Instagram</span><input name="instagram_handle" className="input" placeholder="@handle" /></label>
        <button className="btn-primary" disabled={pending}>Add team</button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}

function AreaCard({ area, run, pending }: { area: AreaWithManagers; run: (fn: () => Promise<{ ok: true } | { error: string }>) => void; pending: boolean }) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  return (
    <div className={`card ${area.is_active ? "" : "opacity-60"}`} data-team={area.id}>
      {editing ? (
        <form action={(fd) => { run(() => updateArea(area.id, fd)); setEditing(false); }} className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex-1"><span className="label">Name</span><input name="name" className="input" defaultValue={area.name} required /></label>
            <label className="flex-1"><span className="label">Language</span><input name="language" className="input" defaultValue={area.language} required /></label>
            <label className="flex-1"><span className="label">Instagram</span><input name="instagram_handle" className="input" defaultValue={area.instagram_handle ?? ""} /></label>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="sm:w-1/3"><span className="label">Page address: {SITE_HOST}/</span><input name="slug" className="input" defaultValue={area.slug ?? ""} placeholder="philippines" autoCapitalize="none" /></label>
            <label className="flex-1"><span className="label">Missionary form link (shown on that page)</span><input name="referral_form_url" className="input" defaultValue={area.referral_form_url ?? ""} placeholder="https://forms.gle/…" autoCapitalize="none" /></label>
          </div>
          <div className="flex items-center gap-2">
            <label className="mr-auto flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={area.is_active} /> Active</label>
            <button className="btn-primary" disabled={pending}>Save</button>
            <button type="button" onClick={() => setEditing(false)} className="btn-secondary">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold">{areaLabel(area)}{!area.is_active && <span className="ml-2 text-xs text-muted">(inactive)</span>}</div>
            <div className="text-sm text-muted">{area.instagram_handle ? `@${area.instagram_handle}` : "No Instagram handle yet"}</div>
            <div className="text-sm text-muted" data-team-page={area.slug ?? ""}>
              {area.slug && area.referral_form_url
                ? <>Form page: <a href={`/${area.slug}`} target="_blank" rel="noreferrer" className="text-accent underline">{SITE_HOST}/{area.slug}</a>{area.referral_form_title ? ` (${area.referral_form_title})` : ""}</>
                : "No form page yet (Edit to give it an address and the form link)"}
            </div>
          </div>
          <button onClick={() => setEditing(true)} className="text-sm text-muted hover:text-foreground">Edit</button>
        </div>
      )}
      <div className="mt-3 border-t border-line pt-3">
        <div className="label">Leads</div>
        <ul className="flex flex-col gap-1 text-sm">
          {area.managers.map((m) => (
            <li key={m.id} className="flex items-center justify-between">
              <span>{m.display_name ? `${m.display_name} · ` : ""}{m.email}</span>
              <button onClick={() => run(() => removeManager(area.id, m.id))} disabled={pending} className="text-xs text-muted hover:text-danger">Remove</button>
            </li>
          ))}
          {area.invites.map((e) => (
            <li key={e} className="flex items-center justify-between text-muted">
              <span>{e} <span className="text-xs">(invited, not signed in yet)</span></span>
              <button onClick={() => run(() => removeInvite(area.id, e))} disabled={pending} className="text-xs hover:text-danger">Remove</button>
            </li>
          ))}
          {area.managers.length + area.invites.length === 0 && <li className="text-muted">No leads yet. Admins cover it.</li>}
        </ul>
        <form onSubmit={(e) => { e.preventDefault(); run(() => addManager(area.id, email)); setEmail(""); }} className="mt-2 flex gap-2">
          <input className="input" type="email" placeholder="lead@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn-secondary whitespace-nowrap" disabled={pending || !email}>Add lead</button>
        </form>
      </div>
      <div className="mt-3 border-t border-line pt-3">
        <div className="label">Members</div>
        {area.members.length === 0 ? (
          <p className="text-sm text-muted">Nobody has joined yet. People ask to join from their Teams page; the leads approve them.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {area.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between">
                <span>{m.display_name ? `${m.display_name} · ` : ""}{m.email}</span>
                <button onClick={() => run(() => removeMember(area.id, m.id))} disabled={pending} className="text-xs text-muted hover:text-danger">Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
