"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import Turnstile, { TURNSTILE_SITE_KEY } from "@/components/Turnstile";
import { EMPTY_LEAD_FIELDS, validateLeadFields, type LeadFields } from "@/lib/lead";
import { clearLocalDraft, readLocalDraft, saveLocalDraft } from "@/lib/local-draft";
import { createClient } from "@/lib/supabase/client";
import { areaLabel } from "@/lib/types";
import { useInitialSnapshot } from "@/lib/use-initial-snapshot";
import { startLeadApplication } from "./actions";
import type { LeadApplicationWithArea } from "./page";

export const LEAD_DRAFT_KEY = "atl-lead-draft";
const readDraft = () => readLocalDraft<LeadFields>(LEAD_DRAFT_KEY);

type Props = {
  /** The signed-in account's address, or null for a visitor with no account. */
  accountEmail: string | null;
  accountName: string | null;
  /** The account's application, when it has one. A "started" one only arrives here for editing. */
  application: LeadApplicationWithArea | null;
  editing: boolean;
};

/**
 * Part 1 of the team lead application: who you are and why. What is typed is kept on
 * the device until it is sent (phones reload background tabs). The draft that was
 * there when the page loaded is read after hydration and the form is mounted with it
 * (useInitialSnapshot): the same pattern as the upload flow.
 */
export default function LeadApply(props: Props) {
  const stored = useInitialSnapshot(readDraft);
  return <Apply key={stored ? "draft" : "new"} {...props} draft={stored} />;
}

function Apply({ accountEmail, accountName, application, editing, draft }: Props & { draft: LeadFields | null }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const signedIn = !!accountEmail;
  const [f, setF] = useState<LeadFields>(() => {
    if (application && (editing || application.status === "declined")) {
      return { email: application.email, fullName: application.full_name, phone: application.phone, language: application.language, audience: application.audience, why: application.why };
    }
    return draft ?? { ...EMPTY_LEAD_FIELDS, fullName: accountName ?? "" };
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; note?: string } | null>(null);
  const [again, setAgain] = useState(false);
  const set = (k: keyof LeadFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((v) => ({ ...v, [k]: e.target.value }));

  // Keep what is typed on the device until the application is on its way.
  useEffect(() => {
    if (Object.values(f).some((v) => v.trim())) saveLocalDraft(LEAD_DRAFT_KEY, f);
  }, [f]);

  async function send() {
    const problem = validateLeadFields(f, !signedIn);
    if (problem) { setError(problem); return; }
    setBusy(true); setError("");
    try {
      // No account yet: the answers are saved under a captcha-checked anonymous session.
      const anonymousSession = async () => {
        const { error: anonErr } = await supabase.auth.signInAnonymously({ options: { captchaToken: captcha ?? undefined } });
        if (anonErr) { window.turnstile?.reset(); setCaptcha(null); throw new Error(anonErr.message); }
      };
      let hadSession = true;
      if (!signedIn) {
        const { data: { session } } = await supabase.auth.getSession();
        hadSession = !!session;
        if (!session) await anonymousSession();
      }
      let r = await startLeadApplication(f);
      if ("error" in r && r.code === "no_session" && !signedIn && hadSession) {
        // The browser remembered a session the server no longer accepts (an old upload session, say). Start a new one.
        await supabase.auth.signOut({ scope: "local" });
        await anonymousSession();
        r = await startLeadApplication(f);
      }
      if ("error" in r) throw new Error(r.error);
      if (r.next === "video") { clearLocalDraft(LEAD_DRAFT_KEY); router.push("/lead/video"); return; }
      setSent({ email: r.email, note: r.note });
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-400/15 text-3xl" aria-hidden>✉</div>
          <h1 className="mt-5 text-2xl font-bold">Check your email</h1>
          <p className="mt-2 max-w-xs text-neutral-300">Part 1 is saved. We sent part 2 to <b className="break-all">{sent.email}</b>.</p>
          <p className="mt-3 max-w-xs text-sm text-neutral-400">Part 2 is a short video about why you would like to lead a team. The link in the email also sets up your account, and it works on any device.</p>
          {sent.note && <p className="mt-4 max-w-xs rounded-lg bg-white/5 px-3 py-2 text-sm text-amber-300">{sent.note}</p>}
          {error && <p className="mt-4 max-w-xs text-sm text-red-400">{error}</p>}
          <button onClick={send} disabled={busy} className="btn mt-8 border border-white/20 px-6 py-3 text-white">{busy ? "Sending…" : "Send it again"}</button>
          <button onClick={() => { setSent(null); setError(""); }} disabled={busy} className="mt-4 text-sm text-neutral-400 underline underline-offset-2">Use a different email address</button>
        </div>
      </Shell>
    );
  }

  if (application && application.status !== "started" && !(application.status === "declined" && again)) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col justify-center">
          {application.status === "submitted" && (
            <>
              <h1 className="text-3xl font-bold">Your application is in</h1>
              <p className="mt-2 text-neutral-300">Both parts are with the admins. We will email <b className="break-all">{application.email}</b> when there is a decision.</p>
            </>
          )}
          {application.status === "approved" && (
            <>
              <h1 className="text-3xl font-bold">You are a team lead</h1>
              <p className="mt-2 text-neutral-300">{application.area ? <>You lead <b>{areaLabel(application.area)}</b>. </> : null}Videos sent to your team wait for you in the review queue.</p>
              <Link href="/review" className="btn-primary mt-6 self-start px-6 py-3 text-base">Open the review queue</Link>
            </>
          )}
          {application.status === "declined" && (
            <>
              <h1 className="text-3xl font-bold">Thank you for applying</h1>
              <p className="mt-2 text-neutral-300">The admins did not approve this application.</p>
              {application.decision_note && <p className="mt-3 rounded-lg bg-white/5 p-3 text-sm">Their note: {application.decision_note}</p>}
              <button onClick={() => setAgain(true)} className="btn mt-6 self-start border border-white/20 px-6 py-3 text-white">Apply again</button>
            </>
          )}
          <Answers application={application} />
          <p className="mt-8 text-sm text-neutral-400">
            You can always <Link href="/upload" className="text-amber-400 underline underline-offset-2">record a video</Link> of your own.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="mt-2 text-3xl font-bold">{editing ? "Your answers" : "Lead a team"}</h1>
      {!editing && <p className="mt-2 text-neutral-400">Team leads watch the videos people send to their team and post the ones worth sharing on the team&apos;s social accounts.</p>}
      <p className="mt-5 text-xs font-bold uppercase tracking-[0.15em] text-amber-400">Part 1 of 2 · About you</p>
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="mt-4 flex flex-col gap-4" noValidate>
        <Field label="Your name">
          <input className="input border-white/15 bg-white/5 text-white" value={f.fullName} onChange={set("fullName")} autoComplete="name" autoCapitalize="words" maxLength={120} />
        </Field>
        {signedIn ? (
          <p className="rounded-lg bg-white/5 px-3 py-2 text-sm text-neutral-300">Applying as <b className="break-all">{accountEmail}</b>, the account you are signed in to.</p>
        ) : (
          <Field label="Email" hint="Part 2 comes to this address, and it becomes your account.">
            <input className="input border-white/15 bg-white/5 text-white" type="email" inputMode="email" value={f.email} onChange={set("email")} autoComplete="email" autoCapitalize="none" spellCheck={false} placeholder="you@example.com" maxLength={254} />
          </Field>
        )}
        <Field label="Phone number">
          <input className="input border-white/15 bg-white/5 text-white" type="tel" inputMode="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" maxLength={32} />
        </Field>
        <Field label="Language your channel will speak">
          <input className="input border-white/15 bg-white/5 text-white" value={f.language} onChange={set("language")} autoComplete="off" autoCapitalize="words" placeholder="Spanish, Tagalog, English…" maxLength={60} />
        </Field>
        <Field label="Audience or location you want to reach">
          <input className="input border-white/15 bg-white/5 text-white" value={f.audience} onChange={set("audience")} autoComplete="off" placeholder="Young adults in Mexico City" maxLength={300} />
        </Field>
        <Field label="Why would you like to lead a team?">
          <textarea className="input min-h-32 border-white/15 bg-white/5 text-white" value={f.why} onChange={set("why")} maxLength={3000} />
        </Field>
        {!signedIn && <Turnstile theme="dark" onToken={setCaptcha} className="flex justify-center" />}
        {error && <p className="text-center text-sm text-red-400">{error}</p>}
        <button className="btn-primary py-3.5 text-base" disabled={busy || (!signedIn && !!TURNSTILE_SITE_KEY && !captcha)}>
          {busy ? "Saving…" : signedIn ? (editing ? "Save and go to part 2" : "Continue to part 2") : "Save and email me part 2"}
        </button>
        <p className="text-center text-xs text-neutral-500">
          Part 2 is a short video about why you would like to lead a team. Only the site&apos;s administrators see your answers. <Link href="/privacy" className="underline">Privacy</Link>
        </p>
        {!signedIn && (
          <p className="text-center text-xs text-neutral-500">
            Already started? <Link href="/login?next=%2Flead%2Fvideo" className="text-amber-400 underline underline-offset-2">Sign in to continue</Link>
          </p>
        )}
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-8" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}>
      <Link href="/" className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">Assigned To Labor</Link>
      {children}
    </main>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

/** The applicant's own answers, read back to them. */
export function Answers({ application }: { application: { full_name: string; phone: string; language: string; audience: string; why: string } }) {
  const rows: [string, string][] = [["Name", application.full_name], ["Phone", application.phone], ["Language", application.language], ["Audience or location", application.audience]];
  return (
    <dl className="mt-6 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-3 py-1">
          <dt className="w-32 shrink-0 text-neutral-400">{k}</dt>
          <dd className="min-w-0 flex-1 break-words">{v}</dd>
        </div>
      ))}
      <div className="py-1">
        <dt className="text-neutral-400">Why you would like to lead</dt>
        <dd className="mt-1 whitespace-pre-line break-words">{application.why}</dd>
      </div>
    </dl>
  );
}
