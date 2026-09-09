"use client";

import { useEffect, useState } from "react";

/**
 * Shows a still preview frame for a video by loading a short-lived signed URL
 * (same authorized endpoint as the player) into a muted <video> seeked to ~1s.
 * Reliable across browsers and works for any video — no capture step needed.
 * Renders `fallback` while loading or if it can't be shown.
 */
export default function VideoThumb({
  videoId,
  className,
  style,
  fallback = null,
}: {
  videoId: string;
  className?: string;
  style?: React.CSSProperties;
  fallback?: React.ReactNode;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setFailed(false);
    fetch(`/api/videos/${videoId}/playback-url`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (active) { if (b?.url) setUrl(b.url as string); else setFailed(true); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [videoId]);

  if (!url || failed) return <>{fallback}</>;

  return (
    <video
      src={url}
      muted
      playsInline
      preload="metadata"
      className={className}
      style={style}
      onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = 1; } catch {} }}
      onError={() => setFailed(true)}
    />
  );
}
