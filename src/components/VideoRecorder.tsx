"use client";

import { useEffect, useRef, useState } from "react";
import type { CaptureMeta, Pipeline, ZoomMode } from "@/lib/capture-meta";
import { baseMimeType, extensionFor, pickRecorderMimeType } from "@/lib/merge-clips";
import { FROZEN_PICTURE_SECONDS, readPicture } from "@/lib/mp4-tracks";
import { pictureLostAt, type Slice } from "@/lib/picture-watch";
import { RECORDING_TIPS } from "@/lib/script";

type Clip = { id: number; blob: Blob; thumb: string; secs: number; ms: number; frames: number; pipeline: Pipeline; pictureLostMs: number | null };

// Selfie camera. Ask for LANDSCAPE numbers on purpose: iOS Safari fits width/height in
// sensor coordinates, so 1920x1080 matches a real preset and, with the phone upright,
// the element reports the full tall frame as 1080x1920. Asking for 1080x1920 instead
// makes WebKit pick the 4K mode and crop a thin slice out of the sideways frame, which
// arrives as a wide band with a third of the vertical view (researched 2026-09-11).
// 1080p, not 4K (2026-09-17): a 4K frame through drawImage + canvas capture + H.264
// ran at ~15 fps on a tester's iPhone. (That clip also lost its last 8 s of picture,
// blamed on the load at the time; it was almost certainly the iOS 26 writer bug
// described at SLICE_MS below.) Zoom is done by the camera itself where the browser
// exposes it (iOS 17+, Android Chrome), so 1080p loses nothing there; elsewhere the
// canvas crops.
// The mic is asked for raw audio. The defaults (echo cancellation and friends) put iOS
// into its phone-call voice-processing unit, which is the "worse than the Camera app"
// sound a tester noticed. Nothing plays back while recording, so there is no echo.
// Laptops and desktops ask for the camera's largest mode instead (2026-09-18): their
// frame is landscape, so the 9:16 slice is only as tall as the frame (608x1080 from a
// 1080p webcam, full 1080x1920 from a 4K one), and they have the horsepower the phone lacked.
function isHandheld(): boolean {
  if (typeof navigator === "undefined") return true;
  const ua = navigator.userAgent;
  // iPadOS reports a Mac user agent; touch points tell them apart.
  return /iPhone|iPad|iPod|Android/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
/**
 * Two ways to record a clip.
 *  canvas: every frame is drawn into a 9:16 canvas and the canvas is recorded. The
 *          default everywhere: it crops landscape webcams, zooms where the camera
 *          cannot, and always yields upright portrait pixels with no orientation
 *          metadata. Proven in the field on iPhones and Androids.
 *  camera: MediaRecorder takes the camera track as it is; nothing on the page sits
 *          between the camera and the encoder, so it is much lighter (through the canvas
 *          the event's iPhones wrote 21 to 27 frames a second instead of 30, and some
 *          cheap Androids only 8 to 10). Possible when the frame is already a 9:16 portrait
 *          and any zoom is the camera's own. An iPhone file then holds the sensor's
 *          landscape pixels plus a rotation matrix, exactly like the Camera app's
 *          files; players, ffmpeg and Instagram honour it, and the merge keeps it.
 *          Opt-in with `?rec=camera` on the page address until it has been tried on
 *          real phones (written 2026-09-19, tested only with Chrome's fake camera).
 */
function preferredPipeline(): Pipeline {
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("rec") === "camera") return "camera";
  return "canvas";
}
/**
 * `?rec=unsliced` records the way the recorder did until 2026-09-20: in one piece,
 * written at stop. It exists to bring the iOS 26 freeze back on purpose on a phone in
 * hand, so that the slices (the fix) and the frozen-picture check (the safety net) can
 * be proven on real hardware: the same phone should freeze with it and not without it.
 * The frame shows a red "Test" chip and the upload says so. Never link to it.
 */
function recordUnsliced(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("rec") === "unsliced";
}
/** True when the frame can be recorded as it is: upright and 9:16 (1080x1920, 720x1280). */
function isPortrait916(v: HTMLVideoElement): boolean {
  const w = v.videoWidth, h = v.videoHeight;
  return w > 0 && h > w && Math.abs(w / h - 9 / 16) < 0.02;
}
/** The centre 9:16 region of a frame, tightened by `zoom`. The canvas and the thumbnails share it. */
function portraitCrop(sw: number, sh: number, zoom: number) {
  const aspect = 9 / 16;
  let fullW = sw, fullH = sh;
  if (sw / sh > aspect) fullW = Math.round(sh * aspect); else fullH = Math.round(sw / aspect);
  const w = fullW / zoom, h = fullH / zoom;
  // Whole pixels when unzoomed, so the canvas copies the frame one to one instead of resampling it.
  const x = zoom === 1 ? Math.round((sw - w) / 2) : (sw - w) / 2, y = zoom === 1 ? Math.round((sh - h) / 2) : (sh - h) / 2;
  return { x, y, w, h, fullW, fullH };
}
const round1 = (n: number) => Math.round(n * 10) / 10;
function cameraConstraints(): MediaStreamConstraints {
  const size = isHandheld() ? { width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 3840 }, height: { ideal: 2160 } };
  return {
    video: { facingMode: "user", ...size, frameRate: { ideal: 30 } },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  };
}
// 5 Mbps, down from 8 (2026-09-18, before a 100-person event on one venue network): a
// 60 s clip is ~37 MB instead of ~60 MB, and Instagram re-encodes to less than this anyway.
// Android honours the figure; iPhones treat it as a hint and wrote 8 to 9 Mbps at the
// event. Going back to 8 waits until the iOS 26 fix below is confirmed on real phones:
// that bug bites sooner the more data there is.
const VIDEO_BITRATE = 5_000_000;
const AUDIO_BITRATE = 192_000;
/**
 * Every clip is recorded in one-second slices: `rec.start(SLICE_MS)`, never `rec.start()`.
 *
 * This is the fix for the frozen videos of the 2026-09-19 event, where 11 of the 12
 * iPhones on iOS 26 (Safari and Chrome alike) produced files whose picture stops 10 to
 * 24 s in while the sound runs on to the end; the twelfth clip was only 17 s long. The
 * one iPhone still on iOS 18 recorded 147 s intact and no Android was affected.
 * Without a timeslice WebKit keeps every encoded frame in memory and writes the whole
 * recording in one burst at stop(). On iOS 26 the MP4 writer chokes on that burst after
 * the first 10 to 30 s of video and then drops the rest of the picture while keeping the
 * sound (WebKit bugs 299164 and 320943; 315091 reproduces it with a plain camera and no
 * canvas, open as of 2026-09). With a timeslice the frames are written every second
 * through the path that works, and at most the last second is exposed at stop. This is
 * the workaround WebKit's own bug reports point to; as of 2026-09-19 it has not yet
 * been confirmed on a real iPhone, which is what the file check below is for.
 * Nothing on the page can see the loss happen: the camera, the preview and the draw
 * loop were healthy in every case. So the finished file is checked instead
 * (src/lib/mp4-tracks.ts), and the slices are watched while recording
 * (src/lib/picture-watch.ts). Safari sends empty slices in between; they are skipped.
 */
const SLICE_MS = 1000;
// The browser gets the front camera's full wide field of view, which reads as "0.5x"
// next to the Camera app's cropped selfie framing. Phones and tablets therefore start
// at 1.5x; laptop and desktop webcams have a normal field of view and start at 1x
// (Landon on a MacBook, 2026-09-18: 1.5x was far too tight). The user can change it.
// Applied by the camera where possible, else identically to the preview (CSS scale)
// and to the recorded canvas (crop).
const ZOOM_LEVELS = [1, 1.5, 2] as const;
function defaultZoom(): number {
  return isHandheld() ? 1.5 : 1;
}
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
  const pictureLostRef = useRef<number | null>(null);
  // File checks still running (one per clip); Done waits for them.
  const checksRef = useRef<Promise<void>[]>([]);
  const clipsRef = useRef<Clip[]>([]);
  // Field diagnostics, uploaded with the video (CaptureMeta): reviewers see them.
  const diagRef = useRef({ camera: "", recorded: "", events: [] as string[], frames: 0, repaints: 0 });
  // The zoom level the camera itself is applying, or null when the canvas crops.
  const nativeZoomRef = useRef<number | null>(null);
  // Keeps the phone from dimming or locking mid-take (iOS 16.4+, Android Chrome).
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const [cam, setCam] = useState<"idle" | "live" | "recording" | "error">("idle");
  const [clips, setClips] = useState<Clip[]>([]);
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [tips, setTips] = useState<"off" | "show" | "fade">("off");
  const [merging, setMerging] = useState(false);
  const [showScript, setShowScript] = useState(true);
  const [zoom, setZoom] = useState<number>(defaultZoom);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("canvas");
  const [pipelinePref] = useState<Pipeline>(preferredPipeline);
  const [unsliced] = useState<boolean>(recordUnsliced);
  const zoomRef = useRef<number>(zoom);
  zoomRef.current = zoom;
  // With the camera zooming, the preview and the canvas use the frame as is. The camera
  // pipeline cannot crop at all, so there the zoom is the camera's or none.
  const cropZoom = zoomMode === "native" || pipelinePref === "camera" ? 1 : zoom;
  const zoomControl = zoomMode === "native" || pipelinePref === "canvas";
  const cropZoomRef = useRef(cropZoom);
  cropZoomRef.current = cropZoom;
  clipsRef.current = clips;

  /** Adds a line to the diagnostics that travel with the upload. */
  function note(line: string) {
    const d = diagRef.current;
    if (d.events.length >= MAX_EVENTS) return;
    d.events.push(line);
    console.debug(`[recorder] ${line}`);
  }
  function logEvent(what: string) {
    const rec = recorderRef.current?.state === "recording";
    note(`${rec ? `${((Date.now() - clipStartRef.current) / 1000).toFixed(1)}s into clip ${clipIdRef.current + 1}` : "between clips"}: ${what}`);
  }
  function pictureLostMessage(atMs: number, clipEnded: boolean): string {
    const at = Math.round(atMs / 1000);
    const when = `${Math.floor(at / 60)}:${String(at % 60).padStart(2, "0")}`;
    return `${clipEnded ? `The picture stopped recording at ${when}, so that clip was ended.` : `The picture in that clip freezes at ${when} while the sound carries on.`} This is a fault in some phones' browsers, not something you did. Delete the clip and try again, or tap Cancel, record with your phone's camera app, and choose “Upload a video I already have”.`;
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
    wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
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
    // No camera zoom and no cropping on the camera pipeline: it records at 1x (iOS 16 and older).
    if (pipelinePref === "camera") setZoom(1);
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
    navigator.wakeLock?.request("screen").then((l) => { wakeLockRef.current = l; }).catch(() => { /* unsupported or refused */ });
  }
  async function startCamera() {
    teardown();
    setCam("idle");
    try {
      attach(await navigator.mediaDevices.getUserMedia(cameraConstraints()));
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
        const stream = await navigator.mediaDevices.getUserMedia(cameraConstraints());
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

  /**
   * The thumbnail shows what the file shows: the same 9:16 crop and the true image. The
   * preview is a mirror (CSS) but the recording never was, and until 2026-09-19 the
   * thumbnails copied the mirror, so posters in the review queue flipped when played.
   */
  function captureThumb(width = 240): string {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !v.videoHeight) return "";
    const crop = portraitCrop(v.videoWidth, v.videoHeight, cropZoomRef.current);
    const c = document.createElement("canvas");
    c.width = width; c.height = Math.round((width * 16) / 9);
    const ctx = c.getContext("2d");
    if (!ctx) return "";
    try { ctx.drawImage(v, crop.x, crop.y, crop.w, crop.h, 0, 0, c.width, c.height); } catch { return ""; }
    return c.toDataURL("image/jpeg", 0.6);
  }
  /**
   * Follows the camera's frames while a clip records: counts them for the diagnostics,
   * paints them on the canvas pipeline, and notes when they stop arriving. Driven by
   * each new camera frame where supported, else by animation frames. The next callback
   * is armed before painting so nothing drawImage does can break the chain.
   */
  function startFrameLoop(v: HTMLVideoElement, paint: (() => void) | null) {
    const rvfc = "requestVideoFrameCallback" in v ? (v as HTMLVideoElement & { requestVideoFrameCallback: (cb: () => void) => number }) : null;
    if (!rvfc && !paint) return; // animation frames would count the screen, not the camera
    let lastFrameAt = performance.now();
    let stalled = false;
    const tick = () => {
      drawRafRef.current = rvfc ? rvfc.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
      lastFrameAt = performance.now();
      if (stalled) { stalled = false; logEvent("camera frames resumed"); }
      paint?.();
      diagRef.current.frames++;
    };
    tick();
    // Watchdog (2026-09-17): when camera frames stop (an iPhone did this 147 s into a
    // clip at the 2026-09-19 event), the canvas keeps painting the last one so the
    // recorded track stays in step with the audio, a paused preview is nudged back to
    // playing, and the reviewers get a note.
    watchdogRef.current = window.setInterval(() => {
      if (performance.now() - lastFrameAt < STALL_MS) return;
      if (!stalled) {
        stalled = true;
        logEvent(`camera frames stopped (${v.paused ? "preview paused" : v.srcObject ? "no new frames" : "no stream"})`);
      }
      if (v.paused && v.srcObject) v.play().catch(() => {});
      paint?.();
      diagRef.current.repaints++;
    }, 100);
  }
  /** Camera pipeline: the recorder takes the camera's own stream; the page only watches. */
  function startCameraWatch() {
    const v = videoRef.current;
    if (!v) return;
    diagRef.current.camera = `${v.videoWidth}x${v.videoHeight}`;
    diagRef.current.recorded = "";
    console.debug(`[recorder] camera ${v.videoWidth}×${v.videoHeight} · recording the camera track · zoom ${zoomRef.current}× by ${nativeZoomRef.current !== null ? "the camera" : "nothing (1×)"}`);
    startFrameLoop(v, null);
  }
  /**
   * Canvas pipeline: a 9:16 portrait canvas showing exactly the centre crop the preview
   * shows (object-fit: cover), so the output is portrait pixels with no orientation
   * metadata whatever shape the camera's frame has. Returns null where canvas capture
   * is unavailable; the caller then records the raw stream. The canvas is never
   * attached to the page; WebKit has captured detached canvases properly since 2022
   * (bug 240380), and the 2026-09-19 freeze was not the canvas (see SLICE_MS).
   */
  function startCanvasCapture(): MediaStream | null {
    const v = videoRef.current, cam = streamRef.current;
    if (!v || !cam || !v.videoWidth || !v.videoHeight) return null;
    const canvas = canvasRef.current ?? document.createElement("canvas");
    if (typeof canvas.captureStream !== "function") return null;
    canvasRef.current = canvas;
    const sw = v.videoWidth, sh = v.videoHeight;
    const full = portraitCrop(sw, sh, 1);
    // Native crop size up to 1080 wide, even dimensions for the H.264 encoder.
    const cw = Math.min(1080, full.fullW) & ~1;
    const ch = Math.round(cw * 16 / 9) & ~1;
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    diagRef.current.camera = `${sw}x${sh}`;
    diagRef.current.recorded = `${cw}x${ch}`;
    console.debug(`[recorder] camera ${sw}×${sh} · recording ${cw}×${ch} through the canvas · zoom ${zoomRef.current}× by ${nativeZoomRef.current !== null ? "the camera" : "cropping"}`);
    // The zoom is read per frame so the control works mid-clip.
    const paint = () => {
      const c = portraitCrop(sw, sh, cropZoomRef.current);
      try { ctx.drawImage(v, c.x, c.y, c.w, c.h, 0, 0, cw, ch); } catch { /* no frame to draw yet */ }
    };
    startFrameLoop(v, paint);
    const canvasStream = canvas.captureStream(30);
    canvasStreamRef.current = canvasStream;
    return new MediaStream([...canvasStream.getVideoTracks(), ...cam.getAudioTracks()]);
  }
  function beginClip() {
    const cam = streamRef.current, v = videoRef.current;
    if (!cam) return;
    setError(""); chunksRef.current = []; setSecs(0);
    clipThumbRef.current = captureThumb();
    clipStartRef.current = Date.now();
    diagRef.current.frames = 0;
    pictureLostRef.current = null;
    const mime = pickRecorderMimeType();
    mimeRef.current = mime;
    // The camera's own stream when the frame needs nothing done to it, else the canvas.
    const direct = pipelinePref === "camera" && !!v && cropZoomRef.current === 1 && isPortrait916(v);
    const canvasStream = direct ? null : startCanvasCapture();
    const pipeline: Pipeline = canvasStream ? "canvas" : "camera";
    if (!canvasStream) startCameraWatch();
    const source = canvasStream ?? cam;
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(source, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: AUDIO_BITRATE }); }
    catch { stopDrawing(); setError("Recording isn't supported in this browser. Try uploading a file instead."); return; }
    const startedAt = performance.now();
    const slices: Slice[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
      if (rec.state !== "recording" || pictureLostRef.current !== null) return;
      slices.push({ at: performance.now() - startedAt, bytes: e.data.size });
      const lostAt = pictureLostAt(slices);
      if (lostAt === null) return;
      // The file is growing by sound alone. End the clip now rather than let someone
      // talk for two more minutes into a frozen picture.
      pictureLostRef.current = lostAt;
      logEvent(`picture stopped reaching the file ${(lostAt / 1000).toFixed(1)}s into the clip (${pipeline} pipeline); clip ended`);
      rec.stop();
    };
    rec.onstop = () => {
      stopDrawing();
      const blob = new Blob(chunksRef.current, { type: baseMimeType(rec.mimeType || mimeRef.current) || "video/webm" });
      const ms = Date.now() - clipStartRef.current;
      const dur = Math.max(1, Math.round(ms / 1000));
      const frames = diagRef.current.frames;
      const pictureLostMs = pictureLostRef.current;
      if (blob.size > 0) {
        const id = ++clipIdRef.current;
        setClips((cs) => [...cs, { id, blob, thumb: clipThumbRef.current, secs: dur, ms, frames, pipeline, pictureLostMs }]);
        // Ask the file itself whether its picture runs to the end (see SLICE_MS).
        checksRef.current.push(readPicture(blob).then((r) => {
          if (!r || r.longestHold.seconds <= FROZEN_PICTURE_SECONDS) return;
          note(`clip ${id}: the file's picture freezes ${r.longestHold.at.toFixed(1)}s in, for ${r.longestHold.seconds.toFixed(1)}s (${pipeline} pipeline)`);
          const lostMs = Math.round(r.longestHold.at * 1000);
          setClips((cs) => cs.map((c) => (c.id === id && c.pictureLostMs === null ? { ...c, pictureLostMs: lostMs } : c)));
          setError(pictureLostMessage(lostMs, false));
        }).catch(() => {}));
      }
      if (pictureLostMs !== null) setError(pictureLostMessage(pictureLostMs, true));
      setCam("live");
    };
    recorderRef.current = rec;
    if (unsliced) rec.start(); else rec.start(SLICE_MS); // one piece only in the ?rec=unsliced test mode
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
    checksRef.current = [];
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
      recorded: cs.some((c) => c.pipeline === "canvas") ? d.recorded || null : null,
      pipeline: cs.every((c) => c.pipeline === "camera") ? "camera" : cs.every((c) => c.pipeline === "canvas") ? "canvas" : "mixed",
      ...(unsliced ? { unsliced: true as const } : {}),
      codec: mimeRef.current || null,
      fps: ms > 0 && frames > 0 ? Math.round((frames / ms) * 1000) : null,
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
    setMerging(true); setError("");
    await Promise.allSettled(checksRef.current);
    const kept = clipsRef.current;
    if (kept.length === 0) { setMerging(false); return; }
    const total = kept.reduce((a, c) => a + c.secs, 0);
    const thumbnail = kept[0].thumb;
    try {
      let file: File;
      if (kept.length === 1) {
        const type = kept[0].blob.type || "video/webm";
        file = new File([kept[0].blob], `recording-${Date.now()}.${extensionFor(type)}`, { type });
      } else {
        const { mergeClips } = await import("@/lib/merge-clips");
        file = await mergeClips(kept.map((c) => c.blob));
      }
      // The finished file's own account of its picture goes to the reviewers with the upload.
      const r = await readPicture(file);
      const meta: CaptureMeta = { ...buildMeta(kept), picture: r ? { seconds: round1(r.picture), sound: round1(r.sound), longestHold: round1(r.longestHold.seconds), holdAt: round1(r.longestHold.at) } : null };
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
        {cam !== "error" && !merging && zoomControl && (
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 flex-col overflow-hidden rounded-full bg-black/60 text-[11px] font-semibold text-white" role="group" aria-label="Zoom">
            {ZOOM_LEVELS.map((z) => (
              <button key={z} onClick={() => { setZoom(z); void applyZoom(z); }} aria-pressed={zoom === z} className={`px-2 py-1.5 ${zoom === z ? "bg-white/25" : ""}`}>{z}×</button>
            ))}
          </div>
        )}
        {unsliced && cam !== "error" && (
          <div className="pointer-events-none absolute bottom-24 left-3 rounded-full bg-red-600/90 px-2.5 py-1 text-[11px] font-semibold text-white">Test: old recorder, may freeze</div>
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
            <div className="text-sm font-semibold text-white">{clips.length > 1 ? "Putting your clips together…" : "Finishing…"}</div>
          </div>
        )}
      </div>

      {clips.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto py-1">
          {clips.map((c, i) => (
            <div key={c.id} className={`relative h-16 w-11 shrink-0 overflow-hidden rounded-md border bg-neutral-800 ${c.pictureLostMs !== null ? "border-red-400" : "border-white/40"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {c.thumb && <img src={c.thumb} alt={`Clip ${i + 1}`} className="h-full w-full object-cover" />}
              <span className={`absolute bottom-0 left-0 right-0 text-center text-[10px] text-white ${c.pictureLostMs !== null ? "bg-red-600/80" : "bg-black/60"}`}>{c.pictureLostMs !== null ? "froze" : `${c.secs}s`}</span>
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
        <button onClick={done} disabled={doneDisabled} className="btn-primary flex-1 py-3">{merging ? (clips.length > 1 ? "Combining…" : "Finishing…") : "Done"}</button>
      </div>
      {onCancel && <button onClick={() => { teardown(); onCancel(); }} disabled={merging} className="self-center text-sm font-semibold text-sky-400">Cancel</button>}
    </div>
  );
}
