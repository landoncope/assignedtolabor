"use client";

import { useEffect, useState } from "react";

/** Plays a private video through a short-lived signed URL fetched from our API. */
export default function VideoPlayer({ videoId, poster }: { videoId: string; poster?: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/videos/${videoId}/playback-url`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Could not load video");
        if (!cancelled) setUrl(j.url);
      })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [videoId]);
  if (error) return <div className="flex aspect-[9/16] max-h-[60vh] items-center justify-center rounded-xl bg-neutral-900 p-4 text-center text-sm text-neutral-400">{error}</div>;
  return <video src={url ?? undefined} poster={poster ?? undefined} controls playsInline className="max-h-[60vh] w-full rounded-xl bg-black" />;
}
