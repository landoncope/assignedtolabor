"use client";

import { useState, useTransition } from "react";
import { formatDate, growth, IMPACT_FIELDS } from "@/lib/impact";
import type { ImpactReport, TeamStory } from "@/lib/types";
import { deleteStory, saveImpact, saveStory } from "./actions";

export type ImpactView = {
  latest: ImpactReport | null;
  previous: ImpactReport | null;
  stories: TeamStory[];
  /** The team's form page: its address without the scheme, and how often it was opened in 30 days. Null when it has none. */
  page: { address: string; href: string; opens30: number } | null;
};

const n = (v: number) => new Intl.NumberFormat("en-US").format(v);
/** Today where the lead is (only ever called in the browser, once a form is open). */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/**
 * What the channel has led to (2026-11-12, Travis): how many people asked to meet the
 * missionaries through it, how many were sent on, how many were baptized, and stories.
 * Everyone on the team sees it; its leads and admins keep it up to date here.
 */
export default function TeamImpact({ areaId, canEdit, impact }: { areaId: string; canEdit: boolean; impact: ImpactView }) {
  const { latest, previous, stories, page } = impact;
  const [open, setOpen] = useState<"figures" | "story" | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: true } | { error: string }>, after: () => void) => {
    setError("");
    start(async () => { const r = await fn(); if ("error" in r) setError(r.error); else after(); });
  };
  const shown = IMPACT_FIELDS.filter((f) => typeof latest?.[f.key] === "number");
  if (!canEdit && !latest && stories.length === 0 && !page) return null;

  return (
    <div className="mt-4 rounded-lg border border-gold/40 bg-gold/5 p-3" data-impact={areaId}>
      <div className="label">What the channel has led to</div>
      {latest && shown.length > 0 ? (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {shown.map((f) => {
              const up = growth(latest, previous, f.key);
              return (
                <div key={f.key} className="rounded-lg bg-card px-3 py-2" data-figure={f.key}>
                  <dt className="text-xs text-muted">{f.label}</dt>
                  <dd className="text-2xl font-bold">{n(latest[f.key] as number)}</dd>
                  {up !== null && previous && <dd className="text-xs text-muted">+{n(up)} since {formatDate(previous.as_of)}</dd>}
                </div>
              );
            })}
          </dl>
          <p className="mt-2 text-xs text-muted">As of {formatDate(latest.as_of)}. The people who follow up the channel&rsquo;s form keep these figures; the team&rsquo;s lead enters them here.</p>
        </>
      ) : (
        <p className="text-sm text-muted">{canEdit ? "No figures yet. Add them below when you have them: how many people asked to meet the missionaries through the channel, and what came of it." : "No figures yet. The team's lead adds them here as they come in."}</p>
      )}
      {page && (
        <p className="mt-2 text-sm">The channel&rsquo;s form: <a href={page.href} target="_blank" rel="noreferrer" className="text-accent underline">{page.address}</a> · opened {n(page.opens30)} {page.opens30 === 1 ? "time" : "times"} in the last 30 days</p>
      )}

      {stories.length > 0 && (
        <div className="mt-3">
          <div className="label">Stories</div>
          <ul className="flex flex-col gap-2">
            {(showAll ? stories : stories.slice(0, 2)).map((s) => (
              <li key={s.id} className="rounded-lg bg-card px-3 py-2" data-story={s.id}>
                {editing === s.id ? (
                  <StoryForm story={s} pending={pending} onCancel={() => setEditing(null)} onSubmit={(fd) => run(() => saveStory(areaId, s.id, fd), () => setEditing(null))} />
                ) : (
                  <>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <div className="font-semibold">{s.title}</div>
                      <div className="text-xs text-muted">{formatDate(s.happened_on ?? s.created_at.slice(0, 10))}</div>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm">{s.body}</p>
                    {canEdit && (
                      <div className="mt-1 flex gap-3 text-xs text-muted">
                        <button type="button" onClick={() => setEditing(s.id)} className="hover:text-foreground">Edit</button>
                        {removing === s.id
                          ? <span>Delete this story? <button type="button" disabled={pending} onClick={() => run(() => deleteStory(areaId, s.id), () => setRemoving(null))} className="font-semibold text-danger">Yes, delete</button> · <button type="button" onClick={() => setRemoving(null)} className="hover:text-foreground">Keep it</button></span>
                          : <button type="button" onClick={() => setRemoving(s.id)} className="hover:text-danger">Delete</button>}
                      </div>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {stories.length > 2 && <button type="button" onClick={() => setShowAll(!showAll)} className="mt-2 text-xs text-accent underline">{showAll ? "Show fewer" : `Show all ${stories.length} stories`}</button>}
        </div>
      )}

      {canEdit && (
        <div className="mt-3 border-t border-gold/30 pt-3">
          {open === null && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setOpen("figures")} className="btn-secondary text-sm">{latest ? "Update the figures" : "Add the figures"}</button>
              <button type="button" onClick={() => setOpen("story")} className="btn-secondary text-sm">Add a story</button>
            </div>
          )}
          {open === "figures" && (
            <form action={(fd) => run(() => saveImpact(areaId, fd), () => setOpen(null))} className="flex flex-col gap-2">
              <p className="text-xs text-muted">Totals so far, not this week&rsquo;s. Leave a box empty if you don&rsquo;t know it.</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {IMPACT_FIELDS.map((f) => (
                  <label key={f.key}><span className="label">{f.label}</span><input name={f.key} className="input" inputMode="numeric" pattern="[0-9,]*" defaultValue={latest?.[f.key] ?? ""} aria-label={f.label} /></label>
                ))}
              </div>
              <label className="sm:w-1/3"><span className="label">As of</span><input name="as_of" type="date" className="input" defaultValue={today()} max={today()} required /></label>
              <div className="flex gap-2">
                <button className="btn-primary" disabled={pending}>Save the figures</button>
                <button type="button" onClick={() => setOpen(null)} className="btn-secondary">Cancel</button>
              </div>
            </form>
          )}
          {open === "story" && <StoryForm story={null} pending={pending} onCancel={() => setOpen(null)} onSubmit={(fd) => run(() => saveStory(areaId, null, fd), () => setOpen(null))} />}
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}

function StoryForm({ story, pending, onSubmit, onCancel }: { story: TeamStory | null; pending: boolean; onSubmit: (fd: FormData) => void; onCancel: () => void }) {
  return (
    <form action={onSubmit} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex-1"><span className="label">Title</span><input name="title" className="input" maxLength={120} defaultValue={story?.title ?? ""} placeholder="Maria was baptized in Cebu" required /></label>
        <label><span className="label">When (optional)</span><input name="happened_on" type="date" className="input" defaultValue={story?.happened_on ?? ""} max={today()} /></label>
      </div>
      <label><span className="label">The story</span><textarea name="body" className="input min-h-28" maxLength={4000} defaultValue={story?.body ?? ""} placeholder="How they found the channel and what happened next." required /></label>
      <p className="text-xs text-muted">Everyone on the team reads this. Use a first name only, and share only what the person is glad to have shared.</p>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={pending}>{story ? "Save the story" : "Add the story"}</button>
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
      </div>
    </form>
  );
}
