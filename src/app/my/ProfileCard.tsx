"use client";

import { useState, useTransition } from "react";
import { saveProfile } from "./actions";

/** Name and, optionally, a phone number: what a team lead sees, and how they can text. */
export default function ProfileCard({ name, phone, email }: { name: string; phone: string; email: string | null }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <section className="card" aria-labelledby="profile-heading">
      <h2 id="profile-heading" className="label">About you</h2>
      <p className="text-sm text-muted">Your name is what your team lead sees next to your videos and your goal. A phone number is optional and lets your lead text you; only the leads of your teams and the admins can see it.{email ? ` You sign in as ${email}.` : ""}</p>
      <form
        action={(fd) => { setResult(null); start(async () => { const r = await saveProfile(fd); setResult("error" in r ? { ok: false, text: r.error } : { ok: true, text: "Saved." }); }); }}
        className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        <label><span className="label">Your name</span><input name="display_name" defaultValue={name} maxLength={80} autoComplete="name" className="input" placeholder="First and last name" /></label>
        <label><span className="label">Phone (optional)</span><input name="phone" defaultValue={phone} maxLength={24} type="tel" autoComplete="tel" className="input" placeholder="+1 801 555 0100" /></label>
        <button className="btn-secondary" disabled={pending}>Save</button>
      </form>
      {result && <p className={`mt-2 text-sm ${result.ok ? "text-accent" : "text-danger"}`}>{result.text}</p>}
    </section>
  );
}
