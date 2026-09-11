"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import VideoRecorder, { type Capture } from "@/components/VideoRecorder";
import { CONSENT, CTAS, HOOKS, TEMPLATES, fillTemplate } from "@/lib/script";
import { createClient } from "@/lib/supabase/client";
import { areaLabel, type Area, type Script } from "@/lib/types";
import { normalizeOrientation } from "@/lib/mp4-orientation";
import { uploadVideo } from "@/lib/upload-video";

type Step = "welcome" | "consent" | "hook" | "body" | "cta" | "area" | "record" | "review" | "done";
const ORDER: Step[] = ["welcome", "consent", "hook", "body", "cta", "area", "record", "review", "done"];

/**
 * The guided quick-upload flow: consent, a three-step script builder (hook, body,
 * call to action), area pick, record or choose a file, upload. Anonymous: a Supabase
 * anonymous session is created on submit; the uploader can attach an email afterward
 * to keep the video in an account.
 */
export default function UploadFlow({ areas }: { areas: Area[] }) {
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("welcome");
  const [consentIdx, setConsentIdx] = useState(0);
  const [hook, setHook] = useState<string | null>(null);
  const [hookCustom, setHookCustom] = useState("");
  const [tplKey, setTplKey] = useState<string | null>(null);
  const [blanks, setBlanks] = useState<string[]>(["", ""]);
  const [bodyCustom, setBodyCustom] = useState("");
  const [cta, setCta] = useState<string | null>(null);
  const [ctaCustom, setCtaCustom] = useState("");
  const [areaId, setAreaId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [capture, setCapture] = useState<Capture | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [emailState, setEmailState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const [emailError, setEmailError] = useState("");
  const [dims, setDims] = useState<{ w: number; h: number; d: number } | null>(null);

  const tpl = TEMPLATES.find((t) => t.key === tplKey) ?? null;
  const script: Script = {
    hook: hook === "custom" ? hookCustom.trim() || null : hook,
    body: tplKey === "custom" ? bodyCustom.trim() || null : tpl ? fillTemplate(tpl, blanks) : null,
    cta: cta === "custom" ? ctaCustom.trim() || null : cta,
  };
  const teleprompter = [script.hook, script.body, script.cta].filter(Boolean).join(" ");

  function go(next: Step) { setError(""); setStep(next); }
  function back() { const i = ORDER.indexOf(step); if (i > 0) go(ORDER[i - 1]); }

  function setCapturePreview(c: Capture | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setDims(null);
    setCapture(c);
    setPreviewUrl(c ? URL.createObjectURL(c.file) : null);
  }
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("video/")) { setError("Please choose a video file."); return; }
    const { file } = await normalizeOrientation(f);
    setCapturePreview({ file, thumbnail: "", durationSeconds: 0 });
    go("review");
  }

  async function submit() {
    if (!capture || uploading) return;
    setUploading(true); setError(""); setProgress(0);
    try {
      let { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const { data, error: anonErr } = await supabase.auth.signInAnonymously();
        if (anonErr) throw new Error(anonErr.message);
        session = data.session;
      }
      if (!session) throw new Error("Could not start a session. Please try again.");
      await uploadVideo(supabase, session.user.id, capture.file, {
        areaId,
        script: teleprompter ? script : null,
        uploaderName: name.trim() || null,
        thumbnail: capture.thumbnail || null,
        durationSeconds: capture.durationSeconds || null,
      }, setProgress);
      setUploading(false);
      go("done");
    } catch (e) {
      setUploading(false);
      setError(e instanceof Error ? e.message : "Upload failed. Please try again.");
    }
  }

  async function attachEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailState("busy"); setEmailError("");
    const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: `${window.location.origin}/auth/callback?next=/my` });
    if (error) { setEmailState("error"); setEmailError(error.message); return; }
    setEmailState("sent");
  }

  const stepIdx = ORDER.indexOf(step);
  const showProgress = stepIdx >= 1 && stepIdx <= 6;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-6 pt-4" style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}>
      <input ref={fileRef} type="file" accept="video/*" onChange={onPickFile} className="hidden" />

      {showProgress && (
        <div className="mb-5 flex items-center gap-3">
          <button onClick={step === "consent" && consentIdx > 0 ? () => setConsentIdx((i) => i - 1) : back} aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xl">‹</button>
          <div className="flex flex-1 gap-1.5">
            {ORDER.slice(1, 7).map((s, i) => <span key={s} className={`h-1 flex-1 rounded-full ${i <= stepIdx - 1 ? "bg-amber-400" : "bg-white/15"}`} />)}
          </div>
        </div>
      )}

      {step === "welcome" && (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">Assigned To Labor</p>
          <h1 className="mt-2 text-3xl font-bold">Share your witness</h1>
          <p className="mt-2 max-w-xs text-neutral-400">Record a short video and send it in. We&apos;ll walk you through it.</p>
          <button onClick={() => { setConsentIdx(0); go("consent"); }} className="btn-primary mt-9 px-7 py-3.5 text-base">Get started</button>
          <Link href="/" className="mt-6 text-xs text-neutral-500">Back to home</Link>
        </div>
      )}

      {step === "consent" && (
        <div className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">Before you start · {consentIdx + 1} of {CONSENT.length}</p>
            <p className="mt-5 text-2xl font-semibold leading-snug">{CONSENT[consentIdx]}</p>
          </div>
          <button onClick={() => (consentIdx < CONSENT.length - 1 ? setConsentIdx((i) => i + 1) : go("hook"))} className="btn-primary py-3.5 text-base">I understand</button>
        </div>
      )}

      {step === "hook" && (
        <StepShell title="Start with a hook" sub="The first line that makes someone keep watching.">
          <Choices options={HOOKS} value={hook} onChange={setHook} customValue={hookCustom} onCustom={setHookCustom} customLabel="Write my own" />
          <NextRow onSkip={() => { setHook(null); go("body"); }} onNext={() => go("body")} disabled={hook === "custom" && !hookCustom.trim()} />
        </StepShell>
      )}

      {step === "body" && (
        <StepShell title="What do you want to share?" sub="Pick a starting point and fill in the blanks.">
          <div className="flex flex-col gap-2">
            {TEMPLATES.map((t) => (
              <button key={t.key} onClick={() => { setTplKey(t.key); setBlanks(["", ""]); }} className={`rounded-xl border px-4 py-3 text-left ${tplKey === t.key ? "border-amber-400 bg-amber-400/10" : "border-white/15"}`}>
                <div className="text-sm font-bold">{t.label}</div>
                <div className="mt-0.5 text-sm text-neutral-400">{fillTemplate(t, [])}</div>
              </button>
            ))}
            <button onClick={() => setTplKey("custom")} className={`rounded-xl border px-4 py-3 text-left text-sm font-bold ${tplKey === "custom" ? "border-amber-400 bg-amber-400/10" : "border-white/15"}`}>Write my own</button>
          </div>
          {tpl && (
            <div className="mt-4 flex flex-col gap-3">
              {tpl.parts.filter((p) => "blank" in p).map((p) => "blank" in p && (
                <label key={p.blank} className="block">
                  <span className="mb-1 block text-xs text-neutral-400">{p.placeholder}</span>
                  <input className="input border-white/15 bg-white/5 text-white" value={blanks[p.blank]} onChange={(e) => setBlanks((b) => { const n = [...b]; n[p.blank] = e.target.value; return n; })} />
                </label>
              ))}
              <p className="rounded-lg bg-white/5 p-3 text-sm leading-relaxed">{fillTemplate(tpl, blanks)}</p>
            </div>
          )}
          {tplKey === "custom" && <textarea className="input mt-4 min-h-28 border-white/15 bg-white/5 text-white" placeholder="A few sentences in your own words" value={bodyCustom} onChange={(e) => setBodyCustom(e.target.value)} />}
          <NextRow onSkip={() => { setTplKey(null); go("cta"); }} onNext={() => go("cta")} disabled={!tplKey || (tplKey === "custom" && !bodyCustom.trim())} />
        </StepShell>
      )}

      {step === "cta" && (
        <StepShell title="End with an invitation" sub="What should someone do after watching?">
          <Choices options={CTAS} value={cta} onChange={setCta} customValue={ctaCustom} onCustom={setCtaCustom} customLabel="Write my own" />
          <NextRow onSkip={() => { setCta(null); go("area"); }} onNext={() => go("area")} disabled={cta === "custom" && !ctaCustom.trim()} />
        </StepShell>
      )}

      {step === "area" && (
        <StepShell title="Where should this go?" sub="Pick the team closest to you. They review and share it.">
          <div className="flex flex-col gap-2">
            {areas.map((a) => (
              <button key={a.id} onClick={() => setAreaId(a.id)} className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold ${areaId === a.id ? "border-amber-400 bg-amber-400/10" : "border-white/15"}`}>{areaLabel(a)}</button>
            ))}
            <button onClick={() => setAreaId(null)} className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold ${areaId === null ? "border-amber-400 bg-amber-400/10" : "border-white/15"}`}>Not sure</button>
          </div>
          <label className="mt-5 block">
            <span className="mb-1 block text-xs text-neutral-400">Your first name (optional)</span>
            <input className="input border-white/15 bg-white/5 text-white" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
          </label>
          <div className="mt-6 flex flex-col gap-2">
            <button onClick={() => go("record")} className="btn-primary py-3.5 text-base">Record now</button>
            <button onClick={() => fileRef.current?.click()} className="btn border border-white/20 py-3 text-white">Upload a video I already have</button>
          </div>
          {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
        </StepShell>
      )}

      {step === "record" && (
        <div className="flex flex-1 flex-col">
          <VideoRecorder teleprompter={teleprompter || null} onCapture={(c) => { setCapturePreview(c); go("review"); }} onCancel={() => go("area")} />
        </div>
      )}

      {step === "review" && capture && (
        <div className="flex flex-1 flex-col">
          <h2 className="text-2xl font-bold">Looks good?</h2>
          <p className="mt-1 text-sm text-neutral-400">Watch it back, then send it in.</p>
          {previewUrl && (
            <video
              src={previewUrl}
              controls
              playsInline
              className="mx-auto mt-4 max-h-[52vh] w-full rounded-2xl bg-black"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                const d = Number.isFinite(v.duration) ? v.duration : 0;
                setDims({ w: v.videoWidth, h: v.videoHeight, d });
                if (capture && !capture.durationSeconds && d) setCapture({ ...capture, durationSeconds: Math.round(d) });
              }}
            />
          )}
          {dims && (
            <p className="mt-2 text-center text-xs text-neutral-500">
              {dims.w}×{dims.h}{dims.d ? ` · ${Math.round(dims.d)}s` : ""} · {(capture.file.size / 1048576).toFixed(1)} MB · {capture.file.type || "unknown type"}
            </p>
          )}
          {uploading && (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-amber-400 transition-all" style={{ width: `${progress}%` }} /></div>
              <p className="mt-1 text-center text-xs text-neutral-400">Uploading… {progress}%</p>
            </div>
          )}
          {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
          <div className="mt-auto flex flex-col gap-2 pt-4">
            <button onClick={submit} disabled={uploading} className="btn-primary py-3.5 text-base">{uploading ? "Sending…" : "Send it in"}</button>
            <button onClick={() => { setCapturePreview(null); go("area"); }} disabled={uploading} className="btn border border-white/20 py-3 text-white">Re-record</button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-400/15 text-3xl">✓</div>
          <h2 className="mt-5 text-2xl font-bold">Thank you</h2>
          <p className="mt-2 max-w-xs text-neutral-400">Your video is with the review team. If they share it, it will go out on the team&apos;s social accounts.</p>
          {emailState === "sent" ? (
            <p className="mt-8 rounded-xl bg-white/5 p-4 text-sm">Check your email for a confirmation link. After that you can sign in any time to see your videos.</p>
          ) : (
            <form onSubmit={attachEmail} className="mt-8 w-full">
              <p className="mb-2 text-sm text-neutral-300">Want to follow what happens to it? Add your email.</p>
              <input className="input border-white/15 bg-white/5 text-white" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="btn-primary mt-2 w-full py-3" disabled={emailState === "busy" || !email}>Keep me posted</button>
              {emailError && <p className="mt-2 text-sm text-red-400">{emailError}</p>}
            </form>
          )}
          <Link href="/" className="mt-8 text-sm text-neutral-500">Done</Link>
        </div>
      )}
    </main>
  );
}

function StepShell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <h2 className="text-2xl font-bold">{title}</h2>
      <p className="mt-1 mb-5 text-sm text-neutral-400">{sub}</p>
      {children}
    </div>
  );
}

function Choices({ options, value, onChange, customValue, onCustom, customLabel }: {
  options: string[]; value: string | null; onChange: (v: string) => void;
  customValue: string; onCustom: (v: string) => void; customLabel: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold leading-snug ${value === o ? "border-amber-400 bg-amber-400/10" : "border-white/15"}`}>{o}</button>
      ))}
      <button onClick={() => onChange("custom")} className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold ${value === "custom" ? "border-amber-400 bg-amber-400/10" : "border-white/15"}`}>{customLabel}</button>
      {value === "custom" && <textarea className="input min-h-20 border-white/15 bg-white/5 text-white" value={customValue} onChange={(e) => onCustom(e.target.value)} placeholder="Type it here" />}
    </div>
  );
}

function NextRow({ onSkip, onNext, disabled }: { onSkip: () => void; onNext: () => void; disabled?: boolean }) {
  return (
    <div className="mt-auto flex flex-col gap-2 pt-6">
      <button onClick={onNext} disabled={disabled} className="btn-primary py-3.5 text-base">Next</button>
      <button onClick={onSkip} className="py-2 text-sm font-semibold text-neutral-400">I&apos;ll improvise this part</button>
    </div>
  );
}
