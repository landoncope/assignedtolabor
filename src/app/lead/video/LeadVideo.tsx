"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import VideoRecorder, { type Capture } from "@/components/VideoRecorder";
import type { LeadApplication } from "@/lib/lead";
import { clearLocalDraft } from "@/lib/local-draft";
import { createClient } from "@/lib/supabase/client";
import { uploadFile } from "@/lib/upload-video";
import { thumbnailFromFile } from "@/lib/video-thumb";
import { Answers, LEAD_DRAFT_KEY } from "../LeadApply";

type Step = "intro" | "record" | "review" | "done";

/**
 * Part 2 of the team lead application: record (or pick) a short video on why you
 * would like to lead, watch it back, send it. Same recorder and the same
 * browser-to-storage upload as a testimony, but the file is tied to the application
 * (`lead_attach_video`) and never enters the review queue.
 */
export default function LeadVideo({ application, userId }: { application: LeadApplication; userId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("intro");
  const [capture, setCapture] = useState<Capture | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number; d: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  // Part 1 is on the server now; the copy kept on the device has done its job.
  useEffect(() => { clearLocalDraft(LEAD_DRAFT_KEY); }, []);
  // No pull-to-refresh while recording or uploading (same as the upload flow).
  useEffect(() => {
    document.documentElement.classList.add("no-pull-refresh");
    return () => document.documentElement.classList.remove("no-pull-refresh");
  }, []);

  function setCapturePreview(c: Capture | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setDims(null);
    setCapture(c);
    setPreviewUrl(c ? URL.createObjectURL(c.file) : null);
  }
  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("video/")) { setError("Please choose a video file."); return; }
    setError("");
    setCapturePreview({ file: f, thumbnail: "", durationSeconds: 0 });
    setStep("review");
    void thumbnailFromFile(f).then((t) => { if (t) setCapture((c) => (c && c.file === f && !c.thumbnail ? { ...c, thumbnail: t } : c)); });
  }

  async function submit() {
    if (!capture || uploading) return;
    setUploading(true); setError(""); setProgress(0);
    let lock: WakeLockSentinel | null = null;
    try { lock = (await navigator.wakeLock?.request("screen")) ?? null; } catch { /* unsupported or refused */ }
    let path = "";
    try {
      const put = await uploadFile(supabase, userId, capture.file, setProgress, "lead-");
      path = put.path;
      const { error: attachErr } = await supabase.rpc("lead_attach_video", {
        p_path: put.path,
        p_mime: put.contentType,
        p_size: capture.file.size,
        p_seconds: capture.durationSeconds || null,
        p_thumbnail: capture.thumbnail || null,
        p_meta: capture.meta ?? null,
      });
      if (attachErr) throw new Error(attachErr.message);
      setStep("done");
    } catch (e) {
      if (path) await supabase.storage.from("videos").remove([path]).catch(() => {});
      setError(e instanceof Error ? e.message : "Upload failed. Please try again.");
    } finally {
      setUploading(false);
      lock?.release().catch(() => {});
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-6" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}>
      <input ref={fileRef} type="file" accept="video/*" onChange={onPickFile} className="hidden" />

      {step === "intro" && (
        <div className="flex flex-1 flex-col">
          <Link href="/" className="text-xs font-bold uppercase tracking-[0.2em] text-amber-400">Assigned To Labor</Link>
          <h1 className="mt-2 text-3xl font-bold">One more step</h1>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.15em] text-amber-400">Part 2 of 2 · Your video</p>
          <p className="mt-2 text-lg leading-snug">Record a short video, about a minute, telling us why you would like to lead a team.</p>
          <p className="mt-2 text-sm text-neutral-400">Speak in the language your channel will use if you like. Only the site&apos;s administrators watch it, and it is never posted.</p>
          <div className="mt-6 flex flex-col gap-2">
            <button onClick={() => { setError(""); setStep("record"); }} className="btn-primary py-3.5 text-base">Record now</button>
            <button onClick={() => fileRef.current?.click()} className="btn border border-white/20 py-3 text-white">Upload a video I already have</button>
          </div>
          {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
          <Answers application={application} />
          <p className="mt-3 text-sm text-neutral-400">
            Part 1 is saved under <b className="break-all">{application.email}</b>. <Link href="/lead?edit=1" className="text-amber-400 underline underline-offset-2">Change my answers</Link>
          </p>
        </div>
      )}

      {step === "record" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <VideoRecorder onCapture={(c) => { setCapturePreview(c); setStep("review"); }} onCancel={() => setStep("intro")} />
        </div>
      )}

      {step === "review" && capture && (
        <div className="flex flex-1 flex-col">
          <h2 className="text-2xl font-bold">Looks good?</h2>
          <p className="mt-1 text-sm text-neutral-400">Watch it back, then send your application.</p>
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
                if (d) setCapture((c) => (c && !c.durationSeconds ? { ...c, durationSeconds: Math.round(d) } : c));
              }}
            />
          )}
          {dims && (
            <p className="mt-2 text-center text-xs text-neutral-500">
              {dims.w}×{dims.h}{dims.d ? ` · ${Math.round(dims.d)}s` : ""} · {(capture.file.size / 1048576).toFixed(1)} MB
            </p>
          )}
          {uploading && (
            <div className="mt-4">
              <div className="h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-amber-400 transition-all" style={{ width: `${progress}%` }} /></div>
              <p className="mt-1 text-center text-xs text-neutral-400">Uploading… {progress}%. Keep this page open until it finishes.</p>
            </div>
          )}
          {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
          <div className="mt-auto flex flex-col gap-2 pt-4">
            <button onClick={submit} disabled={uploading} className="btn-primary py-3.5 text-base">{uploading ? "Sending…" : "Send my application"}</button>
            <button onClick={() => { setCapturePreview(null); setError(""); setStep("intro"); }} disabled={uploading} className="btn border border-white/20 py-3 text-white">Record again</button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-400/15 text-3xl" aria-hidden>✓</div>
          <h2 className="mt-5 text-2xl font-bold">Application sent</h2>
          <p className="mt-2 max-w-xs text-neutral-300">Both parts are with the admins. We will email <b className="break-all">{application.email}</b> when there is a decision.</p>
          <p className="mt-6 max-w-xs text-sm text-neutral-400">
            While you wait, you can <Link href="/upload" className="text-amber-400 underline underline-offset-2">record a video</Link> of your own.
          </p>
          <Link href="/my" className="mt-6 text-sm text-neutral-500">Done</Link>
        </div>
      )}
    </main>
  );
}
