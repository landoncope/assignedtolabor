"use client";

import { useEffect, useRef, useState } from "react";
import { cueAt, type Cue } from "@/lib/caption-cues";

/** The captions and headline to preview over the picture, as the render will draw them. */
export type Overlay = { cues: Cue[]; headline: string | null };

/**
 * Plays a private video through a short-lived signed URL fetched from our API.
 * `endpoint` names a different source than a testimony, e.g. a team lead
 * application's video (`/api/lead-applications/<id>/playback-url`).
 * `overlay` (2026-11-01) previews the captions and headline the render step draws into
 * the posted file: the words at the moment they are said, placed as in the rendered video.
 */
export default function VideoPlayer({ videoId, poster, endpoint, overlay }: { videoId: string; poster?: string | null; endpoint?: string; overlay?: Overlay | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const source = endpoint ?? `/api/videos/${videoId}/playback-url`;
  useEffect(() => {
    let cancelled = false;
    fetch(source)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Could not load video");
        if (!cancelled) setUrl(j.url);
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [source]);
  if (error) return <div className="flex aspect-[9/16] max-h-[60vh] items-center justify-center rounded-xl bg-neutral-900 p-4 text-center text-sm text-neutral-400">{error}</div>;
  const video = <video src={url ?? undefined} poster={poster ?? undefined} controls playsInline className="max-h-[60vh] w-full rounded-xl bg-black" />;
  if (!overlay || (overlay.cues.length === 0 && !overlay.headline)) return video;
  return <WithOverlay overlay={overlay}>{video}</WithOverlay>;
}

/**
 * Finds where the picture sits inside the <video> box (it is letterboxed when the box and
 * the picture differ in shape) and draws the current cue and the headline over it, placed
 * and sized like the render does (src/lib/render.ts buildAss: captions 64 px white on half
 * black ending at 78% of the height; the headline 80 px white on darker black from 10%).
 */
function WithOverlay({ overlay, children }: { overlay: Overlay; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const el = box.current?.querySelector("video");
    if (!el) return;
    const onTime = () => setT(el.currentTime);
    const measure = () => {
      const vw = el.videoWidth, vh = el.videoHeight;
      if (!vw || !vh) return setRect(null);
      const scale = Math.min(el.clientWidth / vw, el.clientHeight / vh);
      const width = vw * scale, height = vh * scale;
      setRect({ left: (el.clientWidth - width) / 2 + el.offsetLeft, top: (el.clientHeight - height) / 2 + el.offsetTop, width, height });
    };
    el.addEventListener("timeupdate", onTime); el.addEventListener("seeking", onTime); el.addEventListener("loadedmetadata", measure);
    const ro = new ResizeObserver(measure); ro.observe(el);
    measure();
    return () => { el.removeEventListener("timeupdate", onTime); el.removeEventListener("seeking", onTime); el.removeEventListener("loadedmetadata", measure); ro.disconnect(); };
  }, [overlay]);
  const cue = cueAt(overlay.cues, t);
  const k = rect ? rect.width / 1080 : 0;
  const boxStyle = (size: number, title: boolean): React.CSSProperties => ({ fontSize: size * k, lineHeight: 1.22, padding: `${18 * k}px ${22 * k}px`, background: title ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.5)", color: "#fff", fontWeight: 700, textAlign: "center", maxWidth: `${(1080 - 200) * k}px`, textShadow: `${2 * k}px ${2 * k}px 0 rgba(0,0,0,0.6)` });
  return (
    <div ref={box} className="relative">
      {children}
      {rect && (
        <div className="pointer-events-none absolute" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} aria-hidden="true">
          {overlay.headline && <div className="absolute left-0 right-0 flex justify-center" style={{ top: "10%" }}><div style={boxStyle(80, true)}>{overlay.headline}</div></div>}
          {cue && <div className="absolute left-0 right-0 flex justify-center" style={{ bottom: "22%" }}><div style={boxStyle(64, false)}>{cue.text}</div></div>}
          <div className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/80">Preview</div>
        </div>
      )}
    </div>
  );
}
