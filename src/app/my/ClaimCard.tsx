"use client";

import { useState, useTransition } from "react";
import { claimUploads, declineUploads } from "./actions";

export type Claimable = { id: string; uploader_name: string | null; language: string | null; thumbnail: string | null; created_at: string };

/** "A video was submitted with your email before you signed in. Is it yours?" */
export default function ClaimCard({ videos }: { videos: Claimable[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  function run(fn: () => Promise<{ ok: true; count: number } | { error: string }>) {
    setError("");
    start(async () => { const r = await fn(); if ("error" in r) setError(r.error); });
  }
  const one = videos.length === 1;
  return (
    <div className="card mt-4 border-gold/50 bg-gold/5">
      <div className="font-semibold">{one ? "A video was submitted with your email address before you signed in." : `${videos.length} videos were submitted with your email address before you signed in.`}</div>
      <ul className="mt-2 flex flex-col gap-2">
        {videos.map((v) => (
          <li key={v.id} className="flex items-center gap-3 text-sm">
            {v.thumbnail
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={v.thumbnail} alt="" className="h-14 w-10 shrink-0 rounded object-cover" />
              : <div className="h-14 w-10 shrink-0 rounded bg-line" />}
            <span>{new Date(v.created_at).toLocaleString()}{v.uploader_name ? ` · from ${v.uploader_name}` : ""}{v.language ? ` · ${v.language}` : ""}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted">{one ? "Is it yours? Adding it puts it under My videos and sends its updates to you." : "Are they yours? Adding them puts them under My videos and sends their updates to you."}</p>
      <div className="mt-3 flex gap-2">
        <button onClick={() => run(claimUploads)} disabled={pending} className="btn-primary flex-1">{one ? "Yes, add it to my account" : "Yes, add them to my account"}</button>
        <button onClick={() => run(declineUploads)} disabled={pending} className="btn-secondary">{one ? "Not mine" : "Not mine"}</button>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
