"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ next }: { next: string }) {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const callback = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function google() {
    setBusy(true); setError("");
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback } });
    if (error) { setError(error.message); setBusy(false); }
  }

  async function magicLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: callback } });
    setBusy(false);
    if (error) setError(error.message); else setSent(true);
  }

  if (sent) {
    return (
      <div className="card mt-6">
        <p className="font-semibold">Check your email</p>
        <p className="mt-1 text-sm text-muted">We sent a sign-in link to {email}. Open it on this device.</p>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <button onClick={google} disabled={busy} className="btn-secondary py-3">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.43.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.94l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
        Continue with Google
      </button>
      <div className="flex items-center gap-3 text-xs text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
      <form onSubmit={magicLink} className="flex flex-col gap-3">
        <input className="input" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        <button className="btn-primary py-3" disabled={busy || !email}>Email me a sign-in link</button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
