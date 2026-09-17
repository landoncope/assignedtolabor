/**
 * What the recorder saw, uploaded with each recorded video (`videos.capture_meta`).
 * Written by `VideoRecorder`, read on the review page. Uploaded files have none.
 * Added 2026-09-17 after a tester's freeze could only be diagnosed from the file.
 */
export type ZoomMode = "native" | "canvas";

export type CaptureMeta = {
  ua: string;
  /** Frame size the browser delivered, e.g. "1080x1920". */
  camera: string | null;
  /** Canvas size recorded; null when the raw track was recorded. */
  recorded: string | null;
  /** MediaRecorder mime type. */
  codec: string | null;
  /** Frames drawn per second across the kept clips. */
  fps: number | null;
  zoom: number;
  /** native = the camera zoomed; canvas = the recorder cropped. */
  zoomMode: ZoomMode;
  clips: number;
  merged: boolean;
  /** Seconds the watchdog had to repaint the last frame because no new ones came. */
  stalledSeconds: number;
  /** "12.3s into clip 1: camera frames stopped (preview paused)" and the like. */
  events: string[];
};

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
  if (m.fps !== null) parts.push(`${m.fps} fps`);
  parts.push(`zoom ${m.zoom}× ${m.zoomMode === "native" ? "by the camera" : "by cropping"}`);
  parts.push(`${m.clips} clip${m.clips === 1 ? "" : "s"}${m.merged ? ", merged" : ""}`);
  if (m.stalledSeconds > 0) parts.push(`${m.stalledSeconds}s of repeated frames`);
  return parts.join(" · ");
}
