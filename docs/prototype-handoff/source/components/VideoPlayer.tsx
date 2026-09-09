"use client";

import { useEffect, useState } from "react";

/**
 * Fetches a short-lived signed URL for a video (authorized server-side) and
 * renders an HTML5 player. Shows a friendly state while loading, if access is
 * denied, or if the file has been purged by the retention job.
 */
export default function VideoPlayer({
  videoId,
  className,
  style,
}: {
  videoId: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setMsg(null);
    (async () => {
      try {
        const res = await fetch(`/api/videos/${videoId}/playback-url`);
        const body = await res.json().catch(() => ({}));
        if (!active) return;
        if (res.ok && body.url) setUrl(body.url as string);
        else if (res.status === 410) setMsg("This video is no longer available.");
        else if (res.status === 403) setMsg("You don't have access to this video.");
        else setMsg(body.error ?? "Couldn't load this video.");
      } catch {
        if (active) setMsg("Couldn't load this video.");
      }
    })();
    return () => { active = false; };
  }, [videoId]);

  if (url) return <video controls className={className} style={style} src={url} />;

  return (
    <div
      className={className}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--bg-elev-2, #000)", color: "var(--text-3, #999)",
        fontSize: 13, textAlign: "center", padding: 16, ...style,
      }}
    >
      {msg ?? "Loading video…"}
    </div>
  );
}
