"use client";

import { useEffect, useRef, useState } from "react";
import type { CaptureMeta, ZoomMode } from "@/lib/capture-meta";
import { baseMimeType, extensionFor, pickRecorderMimeType } from "@/lib/merge-clips";
import { RECORDING_TIPS } from "@/lib/script";

type Clip = { id: number; blob: Blob; thumb: string; secs: number; ms: number; frames: number };

// Selfie camera. Ask for LANDSCAPE numbers on purpose: iOS Safari fits width/height in
// sensor coordinates, so 1920x1080 matches a real preset and, with the phone upright,
// the element reports the full tall frame as 1080x1920. Asking for 1080x1920 instead
// makes WebKit pick the 4K mode and crop a thin slice out of the sideways frame, which
// arrives as a wide band with a third of the vertical view (researched 2026-09-11).
// 1080p, not 4K (2026-09-17): a 4K frame through drawImage + canvas capture + H.264
// ran at ~15 fps on a tester's iPhone and the camera stopped delivering frames 8 s
// before the end of a 41 s clip. Zoom is done by the camera itself where the browser
// exposes it (iOS 17+, Android Chrome), so 1080p loses nothing there; elsewhere the
// canvas crops.
// The mic is asked for raw audio. The defaults (echo cancellation and friends) put iOS
// into its phone-call voice-processing unit, which is the "worse than the Camera app"
// sound a tester noticed. Nothing plays back while recording, so there is no echo.
const CAMERA: MediaStreamConstraints = {
  video: { facingMode: "user", width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
};
const VIDEO_BITRATE = 8_000_000;
const AUDIO_BITRATE = 192_000;
// The browser gets the front camera's full wide field of view, which reads as "0.5x"
// next to the Camera app's cropped selfie framing. Default to a 1.5x zoom; the user
// can change it. Applied by the camera where possible, else identically to the
// preview (CSS scale) and to the recorded canvas (crop).
const ZOOM_LEVELS = [1, 1.5, 2] as const;
const DEFAULT_ZOOM = 1.5;
// Camera frames normally arrive every 33 ms. Past this the draw loop counts as stalled
// and the watchdog repaints the last frame so the recording keeps its timeline.
const STALL_MS = 250;
const MAX_EVENTS = 30;

type ZoomCaps = MediaTrackCapabilities & { zoom?: { min?: number; max?: number } };
type ZoomSettings = MediaTrackSettings & { zoom?: number };

export type Capture = { file: File; thumbnail: string; durationSeconds: number; meta?: CaptureMeta };

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRafRef = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const clipsRef = useRef<Clip[]>([]);
  // Field diagnostics, uploaded with the video (CaptureMeta): reviewers see them.
  const diagRef = useRef({ camera: "", recorded: "", events: [] as string[], frames: 0, repaints: 0 });
  // The zoom level the camera itself is applying, or null when the canvas crops.
  const nativeZoomRef = useRef<number | null>(null);

  const [cam, setCam] = useState<"idle" | "live" | "recording" | "error">("idle");
  const [clips, setClips] = useState<Clip[]>([]);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [tips, setTips] = useState<"off" | "show" | "fade">("off");
  const [merging, setMerging] = useState(false);
  const [showScript, setShowScript] = useState(true);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("canvas");
  const zoomRef = useRef<number>(DEFAULT_ZOOM);
  zoomRef.current = zoom;
  // With the camera zooming, the preview and the canvas use the frame as is.
  const cropZoom = zoomMode === "native" ? 1 : zoom;
  const cropZoomRef = useRef(cropZoom);
  cropZoomRef.current = cropZoom;
  clipsRef.current = clips;

  function logEvent(what: string) {
    const d = diagRef.current;
    if (d.events.length >= MAX_EVENTS) return;
    const rec = recorderRef.current?.state === "recording";
    const at = rec ? `${((Date.now() - clipStartRef.current) / 1000).toFixed(1)}s into clip ${clipIdRef.current + 1}` : "between clips";
    d.events.push(`${at}: ${what}`);
    console.debug(`[recorder] ${at}: ${what}`);
  }

  function stopDrawing() {
    if (drawRafRef.current !== null) {
      const v = videoRef.current as (HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void }) | null;
      if (v && "cancelVideoFrameCallback" in v && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(drawRafRef.current);
      cancelAnimationFrame(drawRafRef.current);
      drawRafRef.current = null;
    }
    if (watchdogRef.current !== null) { clearInterval(watchdogRef.current); watchdogRef.current = null; }
    canvasStreamRef.current?.getTracks().forEach((t) => t.stop());
    canvasStreamRef.current = null;
  }
  function teardown() {
    if (introTimerRef.current) { clearTimeout(introTimerRef.current); introTimerRef.current = null; }
    stopDrawing();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") { rec.onstop = null; try { rec.stop(); } catch { /* ignore */ } }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }
  /**
   * Zoom with the camera itself where the browser exposes it (iOS 17+, Android
   * Chrome): the sensor does the crop at full quality and the preview follows for
   * free. Otherwise the canvas crops and the preview is scaled to match. Some webcams
   * report zoom in device units (100..400), so only plain factors are trusted.
   */
  async function applyZoom(level: number) {
    const track = streamRef.current?.getVideoTracks()[0];
    const range = track && typeof track.getCapabilities === "function" ? (track.getCapabilities() as ZoomCaps).zoom : undefined;
    if (track && range && typeof range.min === "number" && typeof range.max === "number" && range.min <= 1 && range.max >= level) {
      try {
        await track.applyConstraints({ advanced: [{ zoom: level } as unknown as MediaTrackConstraintSet] });
        const applied = (track.getSettings() as ZoomSettings).zoom;
        if (applied !== undefined && Math.abs(applied - level) < 0.05) {
          nativeZoomRef.current = level;
          setZoomMode("native");
          return;
        }
      } catch { /* fall through to the canvas crop */ }
    }
    if (nativeZoomRef.current !== null && nativeZoomRef.current !== 1) {
      try { await track?.applyConstraints({ advanced: [{ zoom: 1 } as unknown as MediaTrackConstraintSet] }); } catch { /* ignore */ }
    }
    nativeZoomRef.current = null;
    setZoomMode("canvas");
  }
  function attach(stream: MediaStream) {
    streamRef.current = stream;
    for (const t of stream.getTracks()) {
      t.addEventListener("mute", () => logEvent(`${t.kind} track muted by the system`));
      t.addEventListener("unmute", () => logEvent(`${t.kind} track unmuted`));
      t.addEventListener("ended", () => logEvent(`${t.kind} track ended`));
    }
    const v = videoRef.current;
    if (v) { v.srcObject = stream; v.muted = true; v.play().catch(() => {}); }
    setCam("live");
    void applyZoom(zoomRef.current);
  }
  async function startCamera() {
    teardown();
    setCam("idle");
    try {
      attach(await navigator.mediaDevices.getUserMedia(CAMERA));
    } catch { setCam("error"); }
  }
  // The preview has no `autoplay` attribute on purpose: iOS pauses autoplaying
  // elements it decides are off screen (an "invisible autoplay" interruption) and
  // WebKit bug 230922 froze autoplaying MediaStream elements outright. We start it
  // ourselves and restart it if the browser pauses it under us.
  function onPreviewPause() {
    const v = videoRef.current;
    if (!v || !streamRef.current || v.srcObject !== streamRef.current) return;
    logEvent("preview paused by the browser; resuming");
    v.play().catch(() => {});
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
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
    try { ctx.drawImage(v, 0, 0, c.width, c.height); } catch { return ""; }
    return c.toDataURL("image/jpeg", 0.6);
  }
  /**
   * What gets recorded is a 9:16 portrait canvas showing exactly the centre crop the
   * preview shows (object-fit: cover). Phones hand us the sensor's wide frame with a
   * rotation tag, and recording that directly gave landscape video even when the phone
   * was upright. Drawing through a canvas makes the output portrait on every device,
   * with no orientation metadata to get wrong. Falls back to the raw stream where
   * canvas capture is unavailable.
   */
  function startPortraitCapture(): MediaStream | null {
    const v = videoRef.current, cam = streamRef.current;
    if (!v || !cam || !v.videoWidth || !v.videoHeight) return null;
    const canvas = canvasRef.current ?? document.createElement("canvas");
    if (typeof canvas.captureStream !== "function") return null;
    canvasRef.current = canvas;
    const sw = v.videoWidth, sh = v.videoHeight, aspect = 9 / 16;
    let cropW = sw, cropH = sh;
    if (sw / sh > aspect) cropW = Math.round(sh * aspect); else cropH = Math.round(sw / aspect);
    const sx = Math.round((sw - cropW) / 2), sy = Math.round((sh - cropH) / 2);
    // Native crop size up to 1080 wide, even dimensions for the H.264 encoder.
    const cw = Math.min(1080, cropW) & ~1;
    const ch = Math.round(cw * 16 / 9) & ~1;
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    diagRef.current.camera = `${sw}x${sh}`;
    diagRef.current.recorded = `${cw}x${ch}`;
    console.debug(`[recorder] camera ${sw}×${sh} · recording ${cw}×${ch} · zoom ${zoomRef.current}× by ${nativeZoomRef.current !== null ? "the camera" : "cropping"}`);
    const paint = () => {
      const z = cropZoomRef.current;
      const zw = cropW / z, zh = cropH / z;
      try { ctx.drawImage(v, sx + (cropW - zw) / 2, sy + (cropH - zh) / 2, zw, zh, 0, 0, cw, ch); } catch { /* no frame to draw yet */ }
    };
    // Draw on each new camera frame where supported, else every animation frame. The
    // zoom is read per frame so the control works mid-clip. The next callback is armed
    // before painting so nothing drawImage does can break the chain.
    const rvfc = "requestVideoFrameCallback" in v ? (v as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number }) : null;
    let lastFrameAt = performance.now();
    let stalled = false;
    const draw = () => {
      drawRafRef.current = rvfc ? rvfc.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
      lastFrameAt = performance.now();
      if (stalled) { stalled = false; logEvent("camera frames resumed"); }
      paint();
      diagRef.current.frames++;
    };
    draw();
    // Watchdog (2026-09-17): a tester's iPhone stopped delivering frames 8 s before the
    // end of a 41 s clip while the mic kept going, so the file's video track ended
    // early and players showed a frozen picture. When frames stop, keep painting the
    // last one so the recorded track stays in step with the audio, nudge a paused
    // preview back to playing, and note it for the reviewers.
    watchdogRef.current = window.setInterval(() => {
      if (performance.now() - lastFrameAt < STALL_MS) return;
      if (!stalled) {
        stalled = true;
        logEvent(`camera frames stopped (${v.paused ? "preview paused" : v.srcObject ? "no new frames" : "no stream"})`);
      }
      if (v.paused && v.srcObject) v.play().catch(() => {});
      paint();
      diagRef.current.repaints++;
    }, 100);
    const canvasStream = canvas.captureStream(30);
    canvasStreamRef.current = canvasStream;
    return new MediaStream([...canvasStream.getVideoTracks(), ...cam.getAudioTracks()]);
  }
  function beginClip() {
    if (!streamRef.current) return;
    setError(""); chunksRef.current = []; setSecs(0);
    clipThumbRef.current = captureThumb();
    clipStartRef.current = Date.now();
    diagRef.current.frames = 0;
    const mime = pickRecorderMimeType();
    mimeRef.current = mime;
    const source = startPortraitCapture() ?? streamRef.current;
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(source, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: AUDIO_BITRATE }); }
    catch { stopDrawing(); setError("Recording isn't supported in this browser. Try uploading a file instead."); return; }
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      stopDrawing();
      const blob = new Blob(chunksRef.current, { type: baseMimeType(rec.mimeType || mimeRef.current) || "video/webm" });
      const ms = Date.now() - clipStartRef.current;
      const dur = Math.max(1, Math.round(ms / 1000));
      const frames = diagRef.current.frames;
      if (blob.size > 0) setClips((cs) => [...cs, { id: ++clipIdRef.current, blob, thumb: clipThumbRef.current, secs: dur, ms, frames }]);
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
  function buildMeta(cs: Clip[]): CaptureMeta {
    const d = diagRef.current;
    const ms = cs.reduce((a, c) => a + c.ms, 0);
    const frames = cs.reduce((a, c) => a + c.frames, 0);
    return {
      ua: navigator.userAgent,
      camera: d.camera || null,
      recorded: d.recorded || null,
      codec: mimeRef.current || null,
      fps: ms > 0 && d.recorded ? Math.round((frames / ms) * 1000) : null,
      zoom: zoomRef.current,
      zoomMode: nativeZoomRef.current !== null ? "native" : "canvas",
      clips: cs.length,
      merged: cs.length > 1,
      stalledSeconds: Math.round(d.repaints / 10),
      events: d.events,
    };
  }
  async function done() {
    if (merging || clips.length === 0 || cam === "recording") return;
    const total = clips.reduce((a, c) => a + c.secs, 0);
    const thumbnail = clips[0].thumb;
    const meta = buildMeta(clips);
    if (clips.length === 1) {
      const type = clips[0].blob.type || "video/webm";
      teardown();
      onCapture({ file: new File([clips[0].blob], `recording-${Date.now()}.${extensionFor(type)}`, { type }), thumbnail, durationSeconds: total, meta });
      return;
    }
    setMerging(true); setError("");
    try {
      const { mergeClips } = await import("@/lib/merge-clips");
      const file = await mergeClips(clips.map((c) => c.blob));
      teardown();
      onCapture({ file, thumbnail, durationSeconds: total, meta });
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
        <video ref={videoRef} muted playsInline onPause={onPreviewPause} className={`h-full w-full object-cover ${cam === "error" ? "hidden" : ""}`} style={{ transform: `scaleX(-1) scale(${cropZoom})`, transformOrigin: "center" }} />
        {cam === "error" && (
          <div className="p-4 text-center text-sm leading-relaxed text-neutral-400">
            Camera unavailable.<br />Allow camera access, or upload a file instead.
          </div>
        )}
        {teleprompter && showScript && cam !== "error" && (
          <div className="pointer-events-none absolute inset-x-3 top-3 rounded-xl bg-black/55 p-3 pr-16 text-center text-[15px] font-semibold leading-relaxed text-white backdrop-blur-sm">
            {teleprompter}
          </div>
        )}
        {teleprompter && cam !== "error" && (
          <button onClick={() => setShowScript((s) => !s)} className="absolute right-4 top-4 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white">
            {showScript ? "Hide" : "Show script"}
          </button>
        )}
        {cam !== "error" && !merging && (
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 flex-col overflow-hidden rounded-full bg-black/60 text-[11px] font-semibold text-white" role="group" aria-label="Zoom">
            {ZOOM_LEVELS.map((z) => (
              <button key={z} onClick={() => { setZoom(z); void applyZoom(z); }} aria-pressed={zoom === z} className={`px-2 py-1.5 ${zoom === z ? "bg-white/25" : ""}`}>{z}×</button>
            ))}
          </div>
        )}
        {recording && (
          <div className="absolute left-3 bottom-6 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
          </div>
        )}
        {cam !== "error" && !merging && (
          <button onClick={tapRecord} aria-label={recording ? "Stop clip" : "Record clip"} className="absolute bottom-4 left-1/2 flex h-[70px] w-[70px] -translate-x-1/2 items-center justify-center rounded-full border-4 border-white/90">
            <span className="bg-red-500 transition-all" style={{ borderRadius: recording ? 7 : "50%", width: recording ? 26 : 54, height: recording ? 26 : 54 }} />
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

      {clips.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto py-1">
          {clips.map((c, i) => (
            <div key={c.id} className="relative h-16 w-11 shrink-0 overflow-hidden rounded-md border border-white/40 bg-neutral-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.thumb && <img src={c.thumb} alt={`Clip ${i + 1}`} className="h-full w-full object-cover" />}
              <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-center text-[10px] text-white">{c.secs}s</span>
              <button onClick={() => deleteClip(c.id)} aria-label={`Delete clip ${i + 1}`} className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-bl-md bg-black/80 text-xs text-white">×</button>
            </div>
          ))}
          {!recording && !merging && (
            <p className="pl-1 text-xs text-neutral-400">{clips.length} clip{clips.length > 1 ? "s" : ""}. Tap × to delete one, or the red button to add another.</p>
          )}
        </div>
      )}

      {error && <p className="text-center text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        {clips.length > 0 && <button onClick={startOver} disabled={merging} className="btn border border-neutral-600 text-neutral-300">Start over</button>}
        <button onClick={done} disabled={doneDisabled} className="btn-primary flex-1 py-3">{merging ? "Combining…" : "Done"}</button>
      </div>
      {onCancel && <button onClick={() => { teardown(); onCancel(); }} disabled={merging} className="self-center text-sm font-semibold text-sky-400">Cancel</button>}
    </div>
  );
}
