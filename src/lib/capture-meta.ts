/**
 * What the recorder saw, uploaded with each recorded video (`videos.capture_meta`).
 * Written by `VideoRecorder`, read on the review page. Uploaded files have none.
 * Added 2026-09-17 after a tester's freeze could only be diagnosed from the file.
 */
export type ZoomMode = "native" | "canvas";
/** camera = MediaRecorder took the camera track as is; canvas = frames went through the 9:16 canvas. */
export type Pipeline = "camera" | "canvas";

export type CaptureMeta = {
  ua: string;
  /** Frame size the browser delivered, e.g. "1080x1920". */
  camera: string | null;
  /** Canvas size recorded; null when the raw track was recorded. */
  recorded: string | null;
  /** How the clips were recorded (absent before 2026-09-19, when everything went through the canvas). */
  pipeline?: Pipeline | "mixed";
  /** Recorded in one piece on purpose (`?rec=unsliced`, the pre-2026-09-20 way) to reproduce the iOS 26 freeze. A freeze here is the old bug, not a failure of the fix. */
  unsliced?: true;
  /** MediaRecorder mime type. */
  codec: string | null;
  /** Frames drawn per second across the kept clips. */
  fps: number | null;
  zoom: number;
  /** native = the camera zoomed; canvas = the recorder cropped. */
  zoomMode: ZoomMode;
  clips: number;
  merged: boolean;
  /** Seconds in which the camera delivered no new frame (the canvas repeats the last one meanwhile). */
  stalledSeconds: number;
  /** "12.3s into clip 1: camera frames stopped (preview paused)" and the like. */
  events: string[];
  /**
   * Read back from the finished file on the device (src/lib/mp4-tracks.ts, since
   * 2026-09-19): how long the picture and the sound run, and the longest time one frame
   * is held. A hold of more than a second or two is a frozen picture.
   */
  picture?: { seconds: number; sound: number; longestHold: number; holdAt: number } | null;
};

/** "The picture freezes 0:10 in and stays frozen for 73 s." when the file's own check found that, else null. */
export function pictureWarning(m: CaptureMeta): string | null {
  const p = m.picture;
  if (!p || p.longestHold <= 1.5) return null;
  const at = Math.round(p.holdAt);
  return `The picture freezes ${Math.floor(at / 60)}:${String(at % 60).padStart(2, "0")} in and stays frozen for ${Math.round(p.longestHold)} s (found by the recorder's own check of the file).`;
}

export function deviceLabel(ua: string): string {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Macintosh/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "Unknown device";
  const browser = /CriOS/.test(ua) ? "Chrome" : /EdgiOS/.test(ua) ? "Edge" : /FxiOS/.test(ua) ? "Firefox"
    : /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${os} · ${browser}`;
}

/** One line for reviewers: "iPhone · Safari · camera 1080x1920 · 29 fps · zoom 1.5× by the camera · 1 clip". */
export function describeCapture(m: CaptureMeta): string {
  const parts = [deviceLabel(m.ua)];
  if (m.camera) parts.push(`camera ${m.camera}`);
  if (m.recorded && m.recorded !== m.camera) parts.push(`recorded ${m.recorded}`);
  if (m.pipeline) parts.push(m.pipeline === "camera" ? "straight from the camera" : m.pipeline === "canvas" ? "through the canvas" : "camera and canvas clips");
  if (m.unsliced) parts.push("TEST MODE: recorded in one piece on purpose, the old way");
  if (m.fps !== null) parts.push(`${m.fps} fps`);
  parts.push(`zoom ${m.zoom}× ${m.zoomMode === "native" ? "by the camera" : "by cropping"}`);
  parts.push(`${m.clips} clip${m.clips === 1 ? "" : "s"}${m.merged ? ", merged" : ""}`);
  if (m.stalledSeconds > 0) parts.push(`${m.stalledSeconds}s without new camera frames`);
  return parts.join(" · ");
}
