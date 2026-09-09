"use client";

import { useState, useTransition } from "react";
import { areaLabel, type Area, type VideoWithArea } from "@/lib/types";
import { approveVideo, assignArea, markPosted, rejectVideo, reopenVideo } from "../actions";

export default function ReviewActions({ video, areas, caption, isAdmin }: { video: VideoWithArea; areas: Area[]; caption: string; isAdmin: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  function run(fn: () => Promise<{ error?: string } | { ok: true }>) {
    setError("");
    start(async () => {
      const r = await fn();
      if ("error" in r && r.error) setError(r.error);
    });
  }

  async function download() {
    setDownloading(true); setError("");
    try {
      const r = await fetch(`/api/videos/${video.id}/playback-url`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not get the file");
      const blob = await (await fetch(j.url)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = video.file_name ?? `video-${video.id}.mp4`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) { setError(e instanceof Error ? e.message : "Download failed"); }
    finally { setDownloading(false); }
  }

  async function copyCaption() {
    await navigator.clipboard.writeText(caption);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  const handle = video.area?.instagram_handle;

  return (
    <div className="flex flex-col gap-4">
      {(isAdmin || !video.area) && (
        <label className="block">
          <span className="label">Area</span>
          <select className="input" value={video.area_id ?? ""} disabled={pending} onChange={(e) => run(() => assignArea(video.id, e.target.value || null))}>
            <option value="">Unassigned</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{areaLabel(a)}</option>)}
          </select>
        </label>
      )}

      {video.status === "pending" && (
        <div className="card flex flex-col gap-3">
          <button onClick={() => run(() => approveVideo(video.id))} disabled={pending} className="btn-primary py-3">Approve</button>
          <details>
            <summary className="cursor-pointer text-sm text-muted">Not selecting this one</summary>
            <textarea className="input mt-2 min-h-20" placeholder="Optional note for the uploader" value={note} onChange={(e) => setNote(e.target.value)} />
            <button onClick={() => run(() => rejectVideo(video.id, note))} disabled={pending} className="btn-danger mt-2 w-full">Mark as not selected</button>
          </details>
        </div>
      )}

      {video.status === "approved" && (
        <div className="card flex flex-col gap-3">
          <div>
            <div className="font-semibold">Post it</div>
            <p className="mt-1 text-sm text-muted">
              Download the file, post it from {handle ? <>the <b>@{handle.replace(/^@/, "")}</b> Instagram account</> : "the area's Instagram account"}, then paste the link here.
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={download} disabled={downloading} className="btn-secondary flex-1">{downloading ? "Preparing…" : "Download video"}</button>
            <button onClick={copyCaption} disabled={!caption} className="btn-secondary flex-1">{copied ? "Copied" : "Copy caption"}</button>
          </div>
          <input className="input" placeholder="https://www.instagram.com/reel/…" value={postUrl} onChange={(e) => setPostUrl(e.target.value)} />
          <button onClick={() => run(() => markPosted(video.id, postUrl))} disabled={pending} className="btn-primary py-3">Mark as posted</button>
          <button onClick={() => run(() => rejectVideo(video.id, note))} disabled={pending} className="text-sm text-muted hover:text-danger">Changed my mind, don&apos;t post</button>
        </div>
      )}

      {video.status === "rejected" && (
        <button onClick={() => run(() => reopenVideo(video.id))} disabled={pending} className="btn-secondary">Move back to review</button>
      )}

      {video.status === "posted" && (
        <div className="card text-sm">
          Posted {video.posted_at ? new Date(video.posted_at).toLocaleString() : ""}.
          {video.post_url && <> <a href={video.post_url} target="_blank" rel="noreferrer" className="text-accent underline">Open post</a></>}
          <p className="mt-1 text-muted">The source file is deleted automatically seven days after posting.</p>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
