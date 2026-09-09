"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { uploadVideo } from "@/lib/upload-video";
import VideoRecorder from "@/components/VideoRecorder";

/* ── Brand tokens (matched to the app) ─────────────────────────── */
const GOLD = "#caa869";
const BLUE = "#8fbef2";

/* ── Script builder: hook → body → call to action ──────────────── */
type TKey = "testimony" | "hope" | "faith";
type Part = { t: string } | { b: number; ph: string };

// Step 1 — opening hooks (pick one).
const HOOKS: string[] = [
  "This changed everything for me.",
  "Something happened this week that I can't stop thinking about.",
  "If you're carrying something heavy right now, this is for you.",
  "I didn't see this coming.",
];

// Step 2 — the body (pick one, fill in the blanks).
const TEMPLATES: { key: TKey; label: string; parts: Part[] }[] = [
  {
    key: "testimony", label: "Testimony", parts: [
      { t: "This week, I experienced " }, { b: 0, ph: "a moment or answered prayer" },
      { t: ". It helped me gain a deeper testimony that " }, { b: 1, ph: "what you now believe" }, { t: "." },
    ],
  },
  {
    key: "hope", label: "Hope", parts: [
      { t: "I have hope in " }, { b: 0, ph: "what gives you hope" },
      { t: " because " }, { b: 1, ph: "the reason" }, { t: "." },
    ],
  },
  {
    key: "faith", label: "Faith", parts: [
      { t: "I have faith in " }, { b: 0, ph: "what you have faith in" },
      { t: " because " }, { b: 1, ph: "the reason" }, { t: "." },
    ],
  },
];

// Step 3 — call to action (pick one).
const CTAS: string[] = [
  "If you want to learn more, come and see.",
  "If you want to experience this for yourself, come and learn with us.",
  "If you're wondering what faith like this could mean for you, come and study with us.",
  "Follow along, and come and see where this leads.",
];
const goldEmph = { color: GOLD, fontWeight: 700 };
const CONSENT: React.ReactNode[] = [
  <>Strangers around the world will see this video and connect you with <span style={goldEmph}>Jesus Christ and his church.</span></>,
  <>You&apos;ll share a <span style={goldEmph}>sincere expression of hope or faith</span> that represents <span style={goldEmph}>you, your family, and the church</span> well.</>,
];

type Step = "landing" | "consent" | "hook" | "body" | "cta" | "record" | "account";

export default function QuickUpload() {
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("landing");
  const [consentIdx, setConsentIdx] = useState(0);
  const [template, setTemplate] = useState<TKey | "custom" | null>(null);
  const [blanks, setBlanks] = useState<Record<number, string>>({});
  const [bodyCustom, setBodyCustom] = useState("");
  const [hook, setHook] = useState<number | "custom" | null>(null);
  const [hookCustom, setHookCustom] = useState("");
  const [cta, setCta] = useState<number | "custom" | null>(null);
  const [ctaCustom, setCtaCustom] = useState("");
  const [tipsSeen, setTipsSeen] = useState(false);

  // capture / upload
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState(false);

  // account
  const [accountMode, setAccountMode] = useState<"choose" | "form" | "sent">("choose");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountError, setAccountError] = useState("");
  const [errorEmail, setErrorEmail] = useState("");
  const [showPw, setShowPw] = useState(false);

  // review-before-send (re-record / re-choose); recording itself lives in <VideoRecorder>
  const [reviewing, setReviewing] = useState(false);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);

  const tpl = TEMPLATES.find((t) => t.key === template) ?? null;
  const hookText = hook === "custom" ? hookCustom.trim() : (typeof hook === "number" ? HOOKS[hook] : "");
  const bodyText = template === "custom" ? bodyCustom.trim() : (tpl ? tpl.parts.map((p) => ("t" in p ? p.t : (blanks[p.b]?.trim() || "________"))).join("") : "");
  const ctaText = cta === "custom" ? ctaCustom.trim() : (typeof cta === "number" ? CTAS[cta] : "");
  const assembledScript = [hookText, bodyText, ctaText].filter(Boolean).join(" ");

  // Show the just-captured clip so the user can review and re-record/re-choose before sending.
  function enterReview(f: File) {
    setTipsSeen(true);
    setUploaded(false);
    setFile(f);
    setReviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(f); });
    setReviewing(true);
  }
  function retake() {
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    setReviewUrl(null); setReviewing(false); setFile(null); setError("");
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (f && !f.type.startsWith("video/")) { setError("Please choose a video file."); return; }
    if (f) { setError(""); enterReview(f); }
  }

  function goAccount() { setAccountMode("choose"); setStep("account"); }
  function restart() {
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    setReviewing(false); setReviewUrl(null);
    setStep("landing"); setConsentIdx(0); setTemplate(null); setBlanks({}); setBodyCustom(""); setHook(null); setHookCustom(""); setCta(null); setCtaCustom(""); setTipsSeen(false);
    setFile(null); setProgress(0); setUploading(false); setError(""); setUploaded(false);
    setAccountMode("choose"); setEmail(""); setPassword(""); setAccountError(""); setErrorEmail("");
  }

  /* ── Upload + account ───────────────────────────────────────── */
  async function ensureUploaded(): Promise<boolean> {
    if (!file) return false;
    if (uploaded) return true; // never upload the same capture twice
    setError(""); setUploading(true); setProgress(0);
    try {
      let { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        const { data, error: anonErr } = await supabase.auth.signInAnonymously();
        if (anonErr) throw new Error(anonErr.message);
        session = data.session;
      }
      if (!session) throw new Error("Could not start a session. Please try again.");
      await uploadVideo(supabase, session.user.id, file, { videoStyle: null, demographic: "General Audience" }, undefined, setProgress);
      setUploaded(true);
      setUploading(false);
      return true;
    } catch (e) {
      setUploading(false);
      setError(e instanceof Error ? e.message : "Upload failed. Please try again.");
      return false;
    }
  }
  async function sendAnon() {
    if (uploading) return;
    if (await ensureUploaded()) setAccountMode("sent");
  }
  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setAccountError(""); setError("");
    // errorEmail ties the message to the current email so the render guard shows it.
    if (!email) { setAccountError("Please enter your email."); setErrorEmail(email); return; }
    if (password.length < 8) { setAccountError("Password must be at least 8 characters."); setErrorEmail(email); return; }
    // upload first (under the anonymous session), then upgrade that session to permanent
    if (!(await ensureUploaded())) return;
    let { error: upErr } = await supabase.auth.updateUser({ email, password });
    // On a retry the password may already be set from a prior attempt — Supabase then
    // rejects "same password". In that case just (re)apply the email.
    if (upErr && /different from the old|same/i.test(upErr.message)) {
      ({ error: upErr } = await supabase.auth.updateUser({ email }));
    }
    if (upErr) { setAccountError(friendlyAuthError(upErr.message)); setErrorEmail(email); return; }
    window.location.assign("/wagepeace/dashboard");
  }

  return (
    <div style={wrap}>
      <input ref={fileRef} type="file" accept="video/*" onChange={onPickFile} style={{ display: "none" }} />

      {/* ── 1. LANDING ─────────────────────────────────────────── */}
      {step === "landing" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", position: "relative" }}>
          <div style={{ ...eyebrow, color: GOLD }}>Assigned to Labor</div>
          <h1 style={{ ...h1, whiteSpace: "nowrap", marginTop: 6 }}>Share your witness</h1>
          <p style={{ ...muted, maxWidth: 300, margin: "8px 0 0" }}>Record a short video and send it in.</p>
          <button onClick={() => { setConsentIdx(0); setStep("consent"); }} style={{ ...primaryBtn, marginTop: 36 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            Quick Upload
          </button>
          <p style={{ fontSize: 12, color: "#56565e", marginTop: 18 }}>We&apos;ll walk you through it.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Assigned to Labor" style={{ position: "absolute", bottom: 4, left: "50%", transform: "translateX(-50%)", width: 40, height: 40, objectFit: "contain", opacity: 0.85 }} />
        </div>
      )}

      {/* ── 2. CONSENT ─────────────────────────────────────────── */}
      {step === "consent" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button onClick={() => (consentIdx === 0 ? setStep("landing") : setConsentIdx((i) => i - 1))} style={backBtn} aria-label="Back">‹</button>
            <div style={{ display: "flex", gap: 7, flex: 1, justifyContent: "center", paddingRight: 36 }}>
              {CONSENT.map((_, i) => (
                <span key={i} style={{ width: 28, height: 5, borderRadius: 3, background: consentIdx >= i ? GOLD : "rgba(255,255,255,.12)" }} />
              ))}
            </div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ ...eyebrow, color: GOLD, marginBottom: 18 }}>{consentIdx + 1} of {CONSENT.length}</div>
            <div style={{ fontSize: 27, fontWeight: 700, lineHeight: 1.4, letterSpacing: "-0.4px", color: "#f4f4f6" }}>
              {CONSENT[consentIdx]}
            </div>
            <p style={{ fontSize: 14, color: "#7a7a82", marginTop: 22 }}>Tap below if you understand and agree.</p>
          </div>
          <button onClick={() => (consentIdx < CONSENT.length - 1 ? setConsentIdx((i) => i + 1) : setStep("hook"))} style={primaryBtn}>
            Yes, I understand →
          </button>
        </div>
      )}

      {/* ── 3a. HOOK ────────────────────────────────────────────── */}
      {step === "hook" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <button onClick={() => setStep("consent")} style={backBtn} aria-label="Back">‹</button>
            <span style={{ ...eyebrow, color: "#8b8b95" }}>Step 1 of 3 · Hook</span>
          </div>
          <h2 style={{ fontFamily: '"Archivo", sans-serif', fontSize: 25, fontWeight: 800, letterSpacing: "-0.3px", color: "#f4f4f6", margin: 0 }}>Start with a hook</h2>
          <p style={{ ...muted, margin: "6px 0 18px" }}>Pick an opening line that grabs attention in the first few seconds.</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {HOOKS.map((h, i) => {
              const sel = hook === i;
              return (
                <button key={i} onClick={() => setHook(i)} style={{
                  textAlign: "left", padding: "15px 16px", borderRadius: 14, fontSize: 16, fontWeight: 600, lineHeight: 1.4, cursor: "pointer", fontFamily: "inherit",
                  border: sel ? "none" : "1px solid rgba(255,255,255,.1)",
                  background: sel ? "linear-gradient(180deg,#8fbef2,#5a96de)" : "rgba(255,255,255,.05)",
                  color: sel ? "#fff" : "#cfcfd6", transition: "all .18s ease",
                }}>{h}</button>
              );
            })}
            <button onClick={() => setHook("custom")} style={{
              textAlign: "left", padding: "15px 16px", borderRadius: 14, fontSize: 16, fontWeight: 600, lineHeight: 1.4, cursor: "pointer", fontFamily: "inherit",
              border: hook === "custom" ? "none" : "1px solid rgba(255,255,255,.1)",
              background: hook === "custom" ? "linear-gradient(180deg,#8fbef2,#5a96de)" : "rgba(255,255,255,.05)",
              color: hook === "custom" ? "#fff" : "#cfcfd6", transition: "all .18s ease",
            }}>Write your own</button>
            {hook === "custom" && (
              <input value={hookCustom} onChange={(e) => setHookCustom(e.target.value)} placeholder="Type your own opening line" style={customField} />
            )}
          </div>

          <div style={{ marginTop: "auto", paddingTop: 18 }}>
            <button onClick={() => setStep("body")} disabled={hook === null} style={{ ...primaryBtn, opacity: hook === null ? 0.5 : 1 }}>Next →</button>
            <button onClick={() => { setReviewing(false); setStep("record"); }} style={{ ...linkBtn, display: "block", margin: "12px auto 0", padding: 10 }}>Skip, I&apos;ll improvise</button>
          </div>
        </div>
      )}

      {/* ── 3b. BODY (fill-in-the-blank starter) ─────────────────── */}
      {step === "body" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <button onClick={() => setStep("hook")} style={backBtn} aria-label="Back">‹</button>
            <span style={{ ...eyebrow, color: "#8b8b95" }}>Step 2 of 3 · Your message</span>
          </div>
          <h2 style={{ fontFamily: '"Archivo", sans-serif', fontSize: 25, fontWeight: 800, letterSpacing: "-0.3px", color: "#f4f4f6", margin: 0 }}>Choose a starter</h2>
          <p style={{ ...muted, margin: "6px 0 18px" }}>Then write into it.</p>

          <div style={{ display: "flex", gap: 9, marginBottom: 18 }}>
            {TEMPLATES.map((t) => {
              const sel = template === t.key;
              return (
                <button key={t.key} onClick={() => { setTemplate(t.key); setBlanks({}); }} style={{
                  flex: 1, padding: "11px 0", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  border: sel ? "none" : "1px solid rgba(255,255,255,.1)",
                  background: sel ? "linear-gradient(180deg,#8fbef2,#5a96de)" : "rgba(255,255,255,.05)",
                  color: sel ? "#fff" : "#b9b9c1", transition: "all .2s ease",
                }}>{t.label}</button>
              );
            })}
          </div>

          <button onClick={() => setTemplate("custom")} style={{
            width: "100%", padding: "11px 0", borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", marginBottom: 18,
            border: template === "custom" ? "none" : "1px solid rgba(255,255,255,.1)",
            background: template === "custom" ? "linear-gradient(180deg,#8fbef2,#5a96de)" : "rgba(255,255,255,.05)",
            color: template === "custom" ? "#fff" : "#b9b9c1", transition: "all .2s ease",
          }}>Write your own</button>

          {template === "custom" ? (
            <textarea value={bodyCustom} onChange={(e) => setBodyCustom(e.target.value)} placeholder="Write your message in your own words…" rows={6} style={{ ...customField, minHeight: 150 }} />
          ) : !tpl ? (
            <div style={{ padding: "40px 20px", borderRadius: 18, background: "rgba(255,255,255,.03)", border: "1px dashed rgba(255,255,255,.12)", textAlign: "center", color: "#7a7a82", fontSize: 14 }}>
              Pick a starter above to begin writing.
            </div>
          ) : (
            <div style={{ padding: "24px 22px", borderRadius: 18, background: "#101016", border: "1px solid rgba(255,255,255,.08)" }}>
              <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 2.2, color: "#f4f4f6" }}>
                {tpl.parts.map((p, i) =>
                  "t" in p ? (
                    <span key={i}>{p.t}</span>
                  ) : (
                    <textarea
                      key={i}
                      value={blanks[p.b] ?? ""}
                      onChange={(e) => setBlanks((b) => ({ ...b, [p.b]: e.target.value }))}
                      ref={(el) => { if (el) autoGrow(el); }}
                      placeholder={p.ph}
                      rows={1}
                      style={{ ...blankInput, width: `${Math.max(9, Math.min(34, (blanks[p.b] || p.ph).length + 1))}ch` }}
                    />
                  )
                )}
              </div>
            </div>
          )}

          <div style={{ marginTop: "auto", paddingTop: 18 }}>
            <button onClick={() => setStep("cta")} disabled={!template} style={{ ...primaryBtn, opacity: template ? 1 : 0.5 }}>Next →</button>
            <button onClick={() => setStep("cta")} style={{ ...linkBtn, display: "block", margin: "12px auto 0", padding: 10 }}>I&apos;ll improvise this step</button>
          </div>
        </div>
      )}

      {/* ── 3c. CALL TO ACTION ──────────────────────────────────── */}
      {step === "cta" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <button onClick={() => setStep("body")} style={backBtn} aria-label="Back">‹</button>
            <span style={{ ...eyebrow, color: "#8b8b95" }}>Step 3 of 3 · Invitation</span>
          </div>
          <h2 style={{ fontFamily: '"Archivo", sans-serif', fontSize: 25, fontWeight: 800, letterSpacing: "-0.3px", color: "#f4f4f6", margin: 0 }}>End with an invitation</h2>
          <p style={{ ...muted, margin: "6px 0 18px" }}>Close by inviting them to take a next step.</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {CTAS.map((c, i) => {
              const sel = cta === i;
              return (
                <button key={i} onClick={() => setCta(i)} style={{
                  textAlign: "left", padding: "15px 16px", borderRadius: 14, fontSize: 16, fontWeight: 600, lineHeight: 1.4, cursor: "pointer", fontFamily: "inherit",
                  border: sel ? "none" : "1px solid rgba(255,255,255,.1)",
                  background: sel ? "linear-gradient(180deg,#8fbef2,#5a96de)" : "rgba(255,255,255,.05)",
                  color: sel ? "#fff" : "#cfcfd6", transition: "all .18s ease",
                }}>{c}</button>
              );
            })}
            <button onClick={() => setCta("custom")} style={{
              textAlign: "left", padding: "15px 16px", borderRadius: 14, fontSize: 16, fontWeight: 600, lineHeight: 1.4, cursor: "pointer", fontFamily: "inherit",
              border: cta === "custom" ? "none" : "1px solid rgba(255,255,255,.1)",
              background: cta === "custom" ? "linear-gradient(180deg,#8fbef2,#5a96de)" : "rgba(255,255,255,.05)",
              color: cta === "custom" ? "#fff" : "#cfcfd6", transition: "all .18s ease",
            }}>Write your own</button>
            {cta === "custom" && (
              <input value={ctaCustom} onChange={(e) => setCtaCustom(e.target.value)} placeholder="Type your own invitation" style={customField} />
            )}
          </div>

          <p style={{ fontSize: 13, color: "#7a7a82", textAlign: "center", margin: "18px 0 0" }}>Keep it under a minute. There&apos;s no wrong way — speak from the heart.</p>

          <div style={{ marginTop: "auto", paddingTop: 18 }}>
            <button onClick={() => { setReviewing(false); setStep("record"); }} disabled={cta === null} style={{ ...primaryBtn, opacity: cta === null ? 0.5 : 1 }}>I&apos;m ready to record →</button>
            <button onClick={() => { setReviewing(false); setStep("record"); }} style={{ ...linkBtn, display: "block", margin: "12px auto 0", padding: 10 }}>I&apos;ll improvise this step</button>
          </div>
        </div>
      )}

      {/* ── 4. RECORD / UPLOAD ─────────────────────────────────── */}
      {step === "record" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <button onClick={() => setStep("cta")} style={backBtn} aria-label="Back">‹</button>
            <span style={{ ...eyebrow, color: "#8b8b95" }}>Record</span>
          </div>

          {assembledScript && !reviewing && (
            <div style={{ padding: 22, borderRadius: 18, background: "#101016", border: "1px solid rgba(143,190,242,.2)", marginBottom: 16, maxHeight: "34vh", overflowY: "auto", flexShrink: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: BLUE, marginBottom: 8 }}>Read this while you record</div>
              <div style={{ fontSize: 21, fontWeight: 600, lineHeight: 1.7, color: "#f4f4f6" }}>{assembledScript}</div>
            </div>
          )}

          {reviewing ? (
            <>
              {/* Review the captured clip before sending */}
              <div style={{ flex: 1, minHeight: 200, borderRadius: 18, overflow: "hidden", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {reviewUrl && <video src={reviewUrl} controls playsInline style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }} />}
              </div>
              <p style={{ fontSize: 13, color: "#7a7a82", textAlign: "center", margin: "12px 0 0" }}>Happy with it? Play it back, then send — or record again.</p>
              {error && <p style={{ color: "#ff6b6b", fontSize: 13.5, textAlign: "center", margin: "8px 0 0" }}>{error}</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
                <button onClick={goAccount} style={primaryBtn}>Use this video</button>
                <button onClick={retake} style={secondaryBtn}>Record again / choose another</button>
              </div>
            </>
          ) : (
            <>
              <VideoRecorder onCapture={enterReview} showTips={!tipsSeen} />
              <button onClick={() => fileRef.current?.click()} style={{ ...secondaryBtn, marginTop: 10 }}>Upload a file instead</button>
            </>
          )}
        </div>
      )}

      {/* ── 5. ACCOUNT PROMPT ──────────────────────────────────── */}
      {step === "account" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
          {accountMode === "sent" ? (
            <>
              <div style={successMark}>✓</div>
              <h2 style={{ ...h2, marginTop: 24 }}>Sent for review</h2>
              <p style={{ ...muted, maxWidth: 320, margin: "10px 0 28px" }}>Thank you for sharing your witness. A team will review it shortly.</p>
              <button onClick={restart} style={primaryBtn}>Upload another</button>
            </>
          ) : accountMode === "form" ? (
            <form onSubmit={createAccount} style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, textAlign: "left" }}>
              <h2 style={{ ...h2, textAlign: "center", marginBottom: 4 }}>Create your account</h2>
              <p style={{ ...muted, textAlign: "center", margin: "0 0 14px" }}>Keep track of your witness and share more later.</p>
              <input type="email" inputMode="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => { setEmail(e.target.value); if (accountError) setAccountError(""); }} style={input} />
              <div style={{ position: "relative" }}>
                <input type={showPw ? "text" : "password"} autoComplete="new-password" placeholder="Create a password (8+ characters)" value={password} onChange={(e) => { setPassword(e.target.value); if (accountError) setAccountError(""); }} style={{ ...input, paddingRight: 62 }} />
                <button type="button" onClick={() => setShowPw((v) => !v)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: BLUE, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{showPw ? "Hide" : "Show"}</button>
              </div>
              {accountError && email === errorEmail && <p style={{ color: "#ff6b6b", fontSize: 13, margin: 0 }}>{accountError}</p>}
              {error && <p style={{ color: "#ff6b6b", fontSize: 13, margin: 0 }}>{error}</p>}
              <button type="submit" disabled={uploading} style={{ ...primaryBtn, opacity: uploading ? 0.6 : 1 }}>{uploading ? `Sending… ${progress}%` : "Create a free account"}</button>
              <button type="button" onClick={() => setAccountMode("choose")} style={{ ...linkBtn, alignSelf: "center", marginTop: 6 }}>Back</button>
            </form>
          ) : (
            <>
              <div style={successMark}>✓</div>
              <h2 style={{ ...h2, marginTop: 24 }}>Your video is ready to send</h2>
              <p style={{ ...muted, maxWidth: 330, margin: "10px 0 28px", lineHeight: 1.55 }}>Create an account to keep track of your witness and share more later — or send it in on its own.</p>
              {error && <p style={{ color: "#ff6b6b", fontSize: 13.5, margin: "0 0 12px" }}>{error}</p>}
              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
                <button onClick={() => setAccountMode("form")} disabled={uploading} style={primaryBtn}>Create an account</button>
                <button onClick={sendAnon} disabled={uploading} style={secondaryBtn}>{uploading ? `Sending… ${progress}%` : "Send without an account"}</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── styles ─────────────────────────────────────────────────── */
const wrap: React.CSSProperties = {
  flex: 1, display: "flex", flexDirection: "column", width: "100%", maxWidth: 480, margin: "0 auto",
  padding: "max(env(safe-area-inset-top), 16px) 22px max(env(safe-area-inset-bottom), 22px)",
};
const eyebrow: React.CSSProperties = { fontSize: 12, letterSpacing: "2.5px", textTransform: "uppercase", fontWeight: 700 };
const h1: React.CSSProperties = { fontFamily: '"Archivo", sans-serif', fontWeight: 800, fontSize: 30, lineHeight: 1.1, letterSpacing: "-0.5px", margin: 0, color: "#f4f4f6" };
const h2: React.CSSProperties = { fontFamily: '"Archivo", sans-serif', fontWeight: 800, fontSize: 24, letterSpacing: "-0.3px", margin: 0, color: "#f4f4f6" };
const muted: React.CSSProperties = { fontSize: 15, color: "#8b8b95", lineHeight: 1.45 };
const bigBtn: React.CSSProperties = { width: "100%", padding: "16px 18px", borderRadius: 15, border: "none", fontSize: 16.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", justifyContent: "center" };
const primaryBtn: React.CSSProperties = { ...bigBtn, background: "linear-gradient(160deg, #6cb2e8 0%, #4a93d6 100%)", color: "#fff", boxShadow: "0 10px 26px -10px rgba(74,147,214,0.6)" };
const secondaryBtn: React.CSSProperties = { ...bigBtn, background: "transparent", color: "#cfcfd6", border: "1px solid rgba(255,255,255,.16)", boxShadow: "none" };
const linkBtn: React.CSSProperties = { background: "none", border: "none", color: BLUE, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const backBtn: React.CSSProperties = { width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,.06)", color: "#cfcfd6", border: "none", cursor: "pointer", fontSize: 18, flexShrink: 0, lineHeight: 1 };
const input: React.CSSProperties = { width: "100%", padding: "13px 14px", borderRadius: 11, border: "1px solid #34343f", background: "#0f0f14", color: "#f5f5f7", fontSize: 16, fontFamily: "inherit", outline: "none" };
const blankInput: React.CSSProperties = { display: "inline-block", verticalAlign: "bottom", resize: "none", overflow: "hidden", background: "rgba(143,190,242,.1)", border: "none", borderBottom: "2px solid #5a96de", borderRadius: "6px 6px 0 0", color: "#fff", fontSize: 22, fontWeight: 700, lineHeight: 1.35, padding: "2px 7px", margin: "0 2px", maxWidth: "100%", fontFamily: "inherit", outline: "none" };
// Auto-grow a textarea blank so the user can always see everything they've typed.
function autoGrow(el: HTMLTextAreaElement) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }
const customField: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "13px 15px", borderRadius: 12, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.16)", color: "#fff", fontSize: 16, fontFamily: "inherit", outline: "none", resize: "none", lineHeight: 1.5 };
// Turn raw Supabase auth errors into guidance that makes sense in this flow.
function friendlyAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered") || m.includes("already in use") || m.includes("already exists"))
    return "That email already has an account. Tap Back and use “Send without an account,” or try a different email.";
  if (m.includes("different from the old") || m.includes("same password"))
    return "Please choose a different password.";
  return msg;
}
const successMark: React.CSSProperties = { width: 78, height: 78, borderRadius: "50%", background: "linear-gradient(180deg,#8fbef2,#5a96de)", color: "#fff", fontSize: 34, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 14px 40px rgba(90,150,222,.4)" };
