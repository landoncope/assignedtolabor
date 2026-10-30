"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { GOALS, type GoalState, type UploadGoal } from "@/lib/goals";
import { setUploadGoal } from "./actions";

/** The countdown, computed on the server (src/lib/goals.ts) so the page and the emails agree. */
export type GoalView = { label: string; every: string; state: GoalState; fraction: number; due: string; dueDay: string; since: string; remind: string };

/**
 * The upload goal (2026-10-30, Travis): four choices, a reminder email as the next video
 * comes due, and a countdown once a goal is set. Choosing a goal is the agreement to
 * the reminders; the goal can be changed or removed here at any time.
 */
export default function GoalCard({ current, email, view, uploads30 }: { current: UploadGoal | null; email: string | null; view: GoalView | null; uploads30: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);
  function choose(goal: UploadGoal | null) {
    setError("");
    start(async () => {
      const r = await setUploadGoal(goal);
      if ("error" in r) setError(r.error);
      else setChanging(false);
    });
  }
  const picking = !current || !view || changing;
  const tone = view?.state === "overdue" ? "text-danger" : view?.state === "soon" ? "text-gold" : "text-accent";
  const bar = view?.state === "overdue" ? "bg-danger" : view?.state === "soon" ? "bg-gold" : "bg-accent";

  return (
    <section className="card" aria-labelledby="goal-heading">
      <div className="flex items-start justify-between gap-3">
        <h2 id="goal-heading" className="label !mb-0">Upload goal</h2>
        {current && view && !changing && <button onClick={() => setChanging(true)} className="text-xs text-muted hover:text-foreground">Change</button>}
      </div>
      {!picking && view && (
        <>
          <div className="mt-1 text-lg font-semibold">{view.label} <span className="text-sm font-normal text-muted">({view.every})</span></div>
          <div className={`mt-3 text-xl font-bold ${tone}`}>{view.due}</div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(view.fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
            <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.max(2, Math.round(view.fraction * 100))}%` }} />
          </div>
          <div className="mt-1 flex flex-wrap justify-between gap-x-4 text-xs text-muted">
            <span>{view.since}</span>
            <span>Next one due {view.dueDay}</span>
          </div>
          <p className="mt-2 text-xs text-muted">{uploads30} video{uploads30 === 1 ? "" : "s"} in the last 30 days. {view.remind}</p>
          <Link href="/upload" className="btn-primary mt-3">Record the next one</Link>
        </>
      )}
      {picking && (
        <>
          <p className="mt-1 text-sm">How often will you send a video? Pick one and we&rsquo;ll email you a reminder when the next one is nearly due.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {GOALS.map((g) => (
              <button key={g.key} onClick={() => choose(g.key)} disabled={pending} className={`rounded-lg border px-3 py-3 text-left transition disabled:opacity-50 ${g.key === current ? "border-accent bg-accent/5" : "border-line hover:border-accent"}`}>
                <div className="font-semibold">{g.label}</div>
                <div className="text-xs text-muted">{g.every}</div>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">By choosing a goal you agree to reminder emails{email ? ` at ${email}` : ""}. Your team lead can see your goal and when you last sent a video. Change or remove it here any time.</p>
          {(changing || current) && (
            <div className="mt-2 flex gap-4 text-xs">
              {changing && <button onClick={() => setChanging(false)} disabled={pending} className="text-muted hover:text-foreground">Keep my goal</button>}
              {current && <button onClick={() => choose(null)} disabled={pending} className="text-muted hover:text-danger">Remove my goal</button>}
            </div>
          )}
        </>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}
