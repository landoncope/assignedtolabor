"use client";

import { useEffect, useRef, useState } from "react";
import { baseMimeType, extensionFor, pickRecorderMimeType } from "@/lib/merge-clips";
import { RECORDING_TIPS } from "@/lib/script";

type Clip = { id: number; blob: Blob; thumb: string; secs: number };

// Portrait, selfie camera. Phones deliver portrait frames when held upright; the
// aspect hint nudges browsers that would otherwise pick a landscape mode.
const CAMERA: MediaStreamConstraints = {
  video: { facingMode: "user", width: { ideal: 1080 }, height: { ideal: 1920 }, aspectRatio: { ideal: 9 / 16 } },
  audio: true,
};

export type Capture = { file: File; thumbnail: string; durationSeconds: number };

/**
 * Multi-clip camera recorder. Tap the red button to start a clip, tap again to end
 * it. Clips can be deleted individually. "Done" returns one file: a single clip as-is,
 * or several clips merged in the browser (ffmpeg.wasm, lazy-loaded). A short tips
 * card and a 3-2-1 countdown run before the first clip only. Ported from the prototype.
 */
export default function VideoRecorder({
  onCapture,
  onCancel,
  teleprompter,
}: {
  onCapture: (c: Capture) => void;
  onCancel?: () => void;
  teleprompter?: string | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef("");
  const clipThumbRef = useRef("");
  const clipStartRef = useRef(0);
  const clipIdRef = useRef(0);
  const firstClipRef = useRef(true);
  const introTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipsRef = useRef<Clip[]>([]);

  const [cam, setCam] = useState<"idle" | "live" | "recording" | "error">("idle");
  const [clips, setClips] = useState<Clip[]>([]);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [tips, setTips] = useState<"off" | "show" | "fade">("off");
  const [merging, setMerging] = useState(false);
  const [showScript, setShowScript] = useState(true);
  clipsRef.current = clips;

  function teardown() {
    if (introTimerRef.current) { clearTimeout(introTimerRef.current); introTimerRef.current = null; }
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") { rec.onstop = null; try { rec.stop(); } catch { /* ignore */ } }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }
  function attach(stream: MediaStream) {
    streamRef.current = stream;
    const v = videoRef.current;
    if (v) { v.srcObject = stream; v.muted = true; v.play().catch(() => {}); }
    setCam("live");
  }
  async function startCamera() {
    teardown();
    setCam("idle");
    try {
      attach(await navigator.mediaDevices.getUserMedia(CAMERA));
    } catch { setCam("error"); }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(CAMERA);
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        attach(stream);
      } catch { if (!cancelled) setCam("error"); }
    })();
    return () => { cancelled = true; teardown(); };
  }, []);

  useEffect(() => {
    if (cam !== "recording") return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [cam]);

  // Intro before the first clip: tips card (2.2s), then 3-2-1, then record.
  function runCountdown(n: number) {
    if (n <= 0) { setCountdown(null); setTips("off"); beginClip(); return; }
    setCountdown(n);
    introTimerRef.current = setTimeout(() => runCountdown(n - 1), 1000);
  }
  function startIntro() {
    setTips("show");
    introTimerRef.current = setTimeout(() => { setTips("fade"); runCountdown(3); }, 2200);
  }

  function captureThumb(width = 240): string {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return "";
    const c = document.createElement("canvas");
    c.width = width; c.height = Math.round((width * v.videoHeight) / v.videoWidth);
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    ctx.translate(c.width, 0); ctx.scale(-1, 1); // match the mirrored preview
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.6);
  }
  function beginClip() {
    if (!streamRef.current) return;
    setError(""); chunksRef.current = []; setSecs(0);
    clipThumbRef.current = captureThumb();
    clipStartRef.current = Date.now();
    const mime = pickRecorderMimeType();
    mimeRef.current = mime;
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined); }
    catch { setError("Recording isn't supported in this browser. Try uploading a file instead."); return; }
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: baseMimeType(rec.mimeType || mimeRef.current) || "video/webm" });
      const dur = Math.max(1, Math.round((Date.now() - clipStartRef.current) / 1000));
      if (blob.size > 0) setClips((cs) => [...cs, { id: ++clipIdRef.current, blob, thumb: clipThumbRef.current, secs: dur }]);
      setCam("live");
    };
    recorderRef.current = rec;
    rec.start();
    setCam("recording");
  }
  function tapRecord() {
    if (merging || countdown !== null || tips !== "off") return;
    if (cam === "error") { startCamera(); return; }
    if (cam === "recording") { recorderRef.current?.stop(); return; }
    if (cam === "live") {
      if (firstClipRef.current) { firstClipRef.current = false; startIntro(); }
      else beginClip();
    }
  }
  function deleteClip(id: number) { setClips((cs) => cs.filter((x) => x.id !== id)); }
  function startOver() {
    teardown();
    setClips([]); setCountdown(null); setTips("off"); setSecs(0); setError(""); setMerging(false);
    firstClipRef.current = true;
    startCamera();
  }
  async function done() {
    if (merging || clips.length === 0 || cam === "recording") return;
    const total = clips.reduce((a, c) => a + c.secs, 0);
    const thumbnail = clips[0].thumb;
    if (clips.length === 1) {
      const type = clips[0].blob.type || "video/webm";
      teardown();
      onCapture({ file: new File([clips[0].blob], `recording-${Date.now()}.${extensionFor(type)}`, { type }), thumbnail, durationSeconds: total });
      return;
    }
    setMerging(true); setError("");
    try {
      const { mergeClips } = await import("@/lib/merge-clips");
      const file = await mergeClips(clips.map((c) => c.blob));
      teardown();
      onCapture({ file, thumbnail, durationSeconds: total });
    } catch {
      setMerging(false);
      setError("Couldn't combine your clips. Try again, or delete a clip.");
    }
  }

  const recording = cam === "recording";
  const doneDisabled = clips.length === 0 || recording || merging;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative mx-auto flex aspect-[9/16] h-[min(66dvh,170vw)] max-w-full items-center justify-center overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${cam === "error" ? "hidden" : ""}`} style={{ transform: "scaleX(-1)" }} />
        {cam === "error" && (
          <div className="p-4 text-center text-sm leading-relaxed text-neutral-400">
            Camera unavailable.<br />Allow camera access, or upload a file instead.
          </div>
        )}
        {teleprompter && showScript && cam !== "error" && (
          <div className="pointer-events-none absolute inset-x-3 top-3 rounded-xl bg-black/55 p-3 text-center text-[15px] font-semibold leading-relaxed text-white backdrop-blur-sm">
            {teleprompter}
          </div>
        )}
        {recording && (
          <div className="absolute left-3 bottom-24 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
          </div>
        )}
        {clips.length > 0 && (
          <div className="absolute bottom-3 left-3 flex max-w-[62%] gap-2 overflow-x-auto pt-1 pr-1">
            {clips.map((c, i) => (
              <div key={c.id} className="relative h-14 w-10 shrink-0 overflow-hidden rounded-md border border-white/75 bg-neutral-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.thumb && <img src={c.thumb} alt={`Clip ${i + 1}`} className="h-full w-full object-cover" />}
                <button onClick={() => deleteClip(c.id)} aria-label={`Delete clip ${i + 1}`} className="absolute -top-0 -right-0 flex h-5 w-5 items-center justify-center rounded-full bg-black text-xs text-white">×</button>
              </div>
            ))}
          </div>
        )}
        {cam !== "error" && !merging && (
          <button onClick={tapRecord} aria-label={recording ? "Stop clip" : "Record clip"} className="absolute bottom-4 left-1/2 flex h-[70px] w-[70px] -translate-x-1/2 items-center justify-center rounded-full border-4 border-white/90">
            <span className="bg-red-500 transition-all" style={{ borderRadius: recording ? 7 : "50%", width: recording ? 26 : 54, height: recording ? 26 : 54 }} />
          </button>
        )}
        {teleprompter && cam !== "error" && (
          <button onClick={() => setShowScript((s) => !s)} className="absolute right-3 bottom-4 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold text-white">
            {showScript ? "Hide script" : "Show script"}
          </button>
        )}
        {(countdown !== null || tips !== "off") && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/65 p-6 text-center">
            {countdown !== null && <div className="text-7xl font-extrabold text-white tabular-nums">{countdown}</div>}
            {tips !== "off" && (
              <div className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 transition-opacity duration-500 ${tips === "show" ? "opacity-100" : "opacity-0"}`}>
                <div className="text-[11px] font-bold uppercase tracking-[0.15em] text-amber-300">3 tips</div>
                <div className="max-w-xs text-lg font-bold leading-relaxed text-white">
                  {RECORDING_TIPS.map((t) => <div key={t}>{t}</div>)}
                </div>
              </div>
            )}
          </div>
        )}
        {merging && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 p-6 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
            <div className="text-sm font-semibold text-white">Putting your clips together…</div>
          </div>
        )}
      </div>

      {error && <p className="text-center text-sm text-red-400">{error}</p>}
      {clips.length > 0 && !recording && !merging && (
        <p className="text-center text-xs text-neutral-400">
          {clips.length} clip{clips.length > 1 ? "s" : ""} · tap × on a clip to delete it, or the red button to add another
        </p>
      )}
      <div className="flex gap-2">
        {clips.length > 0 && <button onClick={startOver} disabled={merging} className="btn border border-neutral-600 text-neutral-300">Start over</button>}
        <button onClick={done} disabled={doneDisabled} className="btn-primary flex-1 py-3">{merging ? "Combining…" : "Done"}</button>
      </div>
      {onCancel && <button onClick={() => { teardown(); onCancel(); }} disabled={merging} className="self-center text-sm font-semibold text-sky-400">Cancel</button>}
    </div>
  );
}
