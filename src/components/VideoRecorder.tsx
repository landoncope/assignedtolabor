"use client";

import { useEffect, useRef, useState } from "react";
import { baseMimeType, extensionFor, pickRecorderMimeType } from "@/lib/merge-clips";
import { RECORDING_TIPS } from "@/lib/script";

type Clip = { id: number; blob: Blob; thumb: string; secs: number };

// Selfie camera. Ask for LANDSCAPE numbers on purpose: iOS Safari fits width/height in
// sensor coordinates, so 1920x1080 matches a real preset and, with the phone upright,
// the element reports the full tall frame as 1080x1920. Asking for 1080x1920 instead
// makes WebKit pick the 4K mode and crop a thin slice out of the sideways frame, which
// arrives as a wide band with a third of the vertical view (researched 2026-09-11).
// 3840x2160 (landscape numbers, see above) selects the 4K sensor mode where one exists,
// so the digital zoom below still has real pixels to work with; phones and webcams
// without 4K fall back to their largest mode.
const CAMERA: MediaStreamConstraints = {
  video: { facingMode: "user", width: { ideal: 3840 }, height: { ideal: 2160 }, frameRate: { ideal: 30 } },
  audio: true,
};
const VIDEO_BITRATE = 8_000_000;
// The browser gets the front camera's full wide field of view, which reads as "0.5x"
// next to the Camera app's cropped selfie framing. Default to a 1.5x crop; the user
// can change it. Applied identically to the preview and to the recorded canvas.
const ZOOM_LEVELS = [1, 1.5, 2] as const;
const DEFAULT_ZOOM = 1.5;

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawRafRef = useRef<number | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const clipsRef = useRef<Clip[]>([]);

  const [cam, setCam] = useState<"idle" | "live" | "recording" | "error">("idle");
  const [clips, setClips] = useState<Clip[]>([]);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [tips, setTips] = useState<"off" | "show" | "fade">("off");
  const [merging, setMerging] = useState(false);
  const [showScript, setShowScript] = useState(true);
  const [captureInfo, setCaptureInfo] = useState("");
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const zoomRef = useRef<number>(DEFAULT_ZOOM);
  zoomRef.current = zoom;
  clipsRef.current = clips;

  function stopDrawing() {
    if (drawRafRef.current !== null) {
      const v = videoRef.current as (HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void }) | null;
      if (v && "cancelVideoFrameCallback" in v && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(drawRafRef.current);
      cancelAnimationFrame(drawRafRef.current);
      drawRafRef.current = null;
    }
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
    ctx.drawImage(v, 0, 0, c.width, c.height);
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
    setCaptureInfo(`Camera ${sw}×${sh} · recording ${cw}×${ch}`);
    // Draw on each new camera frame where supported, else every animation frame.
    // The zoom is read per frame so the control works mid-clip.
    const rvfc = "requestVideoFrameCallback" in v ? (v as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number }) : null;
    const draw = () => {
      const z = zoomRef.current;
      const zw = cropW / z, zh = cropH / z;
      ctx.drawImage(v, sx + (cropW - zw) / 2, sy + (cropH - zh) / 2, zw, zh, 0, 0, cw, ch);
      drawRafRef.current = rvfc ? rvfc.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
    };
    draw();
    const canvasStream = canvas.captureStream(30);
    canvasStreamRef.current = canvasStream;
    return new MediaStream([...canvasStream.getVideoTracks(), ...cam.getAudioTracks()]);
  }
  function beginClip() {
    if (!streamRef.current) return;
    setError(""); chunksRef.current = []; setSecs(0);
    clipThumbRef.current = captureThumb();
    clipStartRef.current = Date.now();
    const mime = pickRecorderMimeType();
    mimeRef.current = mime;
    const source = startPortraitCapture() ?? streamRef.current;
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(source, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: VIDEO_BITRATE }); }
    catch { stopDrawing(); setError("Recording isn't supported in this browser. Try uploading a file instead."); return; }
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      stopDrawing();
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
        <video ref={videoRef} autoPlay muted playsInline className={`h-full w-full object-cover ${cam === "error" ? "hidden" : ""}`} style={{ transform: `scaleX(-1) scale(${zoom})`, transformOrigin: "center" }} />
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
              <button key={z} onClick={() => setZoom(z)} aria-pressed={zoom === z} className={`px-2 py-1.5 ${zoom === z ? "bg-white/25" : ""}`}>{z}×</button>
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
      {captureInfo && <p className="text-center text-[11px] text-neutral-500">{captureInfo}</p>}
      <div className="flex gap-2">
        {clips.length > 0 && <button onClick={startOver} disabled={merging} className="btn border border-neutral-600 text-neutral-300">Start over</button>}
        <button onClick={done} disabled={doneDisabled} className="btn-primary flex-1 py-3">{merging ? "Combining…" : "Done"}</button>
      </div>
      {onCancel && <button onClick={() => { teardown(); onCancel(); }} disabled={merging} className="self-center text-sm font-semibold text-sky-400">Cancel</button>}
    </div>
  );
}
