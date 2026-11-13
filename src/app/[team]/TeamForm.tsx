"use client";

import { useEffect } from "react";

/**
 * The form, filling the screen under a thin bar that names the channel. The frame is as
 * tall as the screen and scrolls inside itself, so each section of a Google Form starts
 * at its top (a tall frame in a scrolling page leaves the visitor half-way down the next
 * section). Reports one open per visit to this address.
 */
export default function TeamForm({ slug, src, formUrl, title, handle }: { slug: string; src: string; formUrl: string; title: string; handle: string | null }) {
  useEffect(() => {
    const key = `team-page-open:${slug}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch { /* private mode: count it anyway */ }
    fetch("/api/team-page/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug }), keepalive: true }).catch(() => {});
  }, [slug]);

  return (
    <main className="flex h-dvh flex-col bg-white">
      <header className="flex items-center justify-between gap-3 border-b border-line bg-background px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-sm">
        {handle
          ? <a href={`https://www.instagram.com/${handle}/`} target="_blank" rel="noreferrer" className="min-w-0 truncate font-semibold">@{handle}</a>
          : <span className="min-w-0 truncate font-semibold">{title}</span>}
        <a href={formUrl} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-muted underline">Form not showing? Open it here</a>
      </header>
      <iframe src={src} title={title} className="w-full flex-1 border-0" />
    </main>
  );
}
