"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { areaLabel, type Area, type PublishState, type VideoWithArea } from "@/lib/types";
import { approveVideo, assignArea, deleteVideo, markPosted, postToInstagram, rejectVideo, reopenVideo } from "../actions";

const MAX_CAPTION = 2200;
type Publish = { state: PublishState | null; error: string | null; detail?: string | null; postUrl?: string | null };

export default function ReviewActions({ video, areas, caption: scriptCaption, isAdmin, canConnect }: { video: VideoWithArea; areas: Area[]; caption: string; isAdmin: boolean; canConnect: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [caption, setCaption] = useState(video.post_caption ?? scriptCaption);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [publish, setPublish] = useState<Publish>({ state: video.publish_state, error: video.publish_error });
  const router = useRouter();

  const connected = Boolean(video.area?.instagram_user_id);
  const handle = (video.area?.instagram_handle ?? "").replace(/^@/, "");
  const inFlight = video.status !== "posted" && (publish.state === "queued" || publish.state === "processing");

  // While Instagram processes the file, ask the server every few seconds; it publishes
  // the post the moment Instagram is ready (the cron does the same if this page is gone).
  useEffect(() => {
    if (!inFlight) return;
    let stopped = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/videos/${video.id}/publish-status`, { cache: "no-store" });
        const j = (await r.json()) as Publish & { error?: string };
        if (stopped) return;
        if (!r.ok) { setPublish({ state: "failed", error: j.error ?? "Could not check on the post." }); return; }
        setPublish(j);
        if (j.state === "published" || j.state === "failed") router.refresh();
      } catch { /* network blip; the next tick tries again */ }
    };
    const timer = setInterval(tick, 4000);
    tick();
    return () => { stopped = true; clearInterval(timer); };
  }, [inFlight, video.id, router]);

  function run(fn: () => Promise<{ error?: string } | { ok: true }>) {
    setError("");
    start(async () => {
      const r = await fn();
      if ("error" in r && r.error) setError(r.error);
    });
  }

  function post() {
    setError("");
    start(async () => {
      const r = await postToInstagram(video.id, caption);
      if ("error" in r) { setError(r.error); return; }
      setPublish(r.outcome);
      if (r.outcome.state === "published" || r.outcome.state === "failed") router.refresh();
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

  const captionBox = (
    <label className="block">
      <span className="label">Caption</span>
      <textarea className="input min-h-28 whitespace-pre-line text-sm" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={MAX_CAPTION} disabled={pending} />
      <span className="mt-1 block text-xs text-muted">{caption.length}/{MAX_CAPTION}. The uploader&rsquo;s script, edit as you like.</span>
    </label>
  );

  const manualPost = (
    <>
      <p className="text-sm text-muted">
        Download the file, post it from {handle ? <>the <b>@{handle}</b> Instagram account</> : "the team's Instagram account"}, then paste the link here.
      </p>
      <div className="flex gap-2">
        <button onClick={download} disabled={downloading} className="btn-secondary flex-1">{downloading ? "Preparing…" : "Download video"}</button>
        <button onClick={copyCaption} disabled={!caption} className="btn-secondary flex-1">{copied ? "Copied" : "Copy caption"}</button>
      </div>
      <input className="input" placeholder="https://www.instagram.com/reel/…" value={postUrl} onChange={(e) => setPostUrl(e.target.value)} />
      <button onClick={() => run(() => markPosted(video.id, postUrl))} disabled={pending} className={connected ? "btn-secondary" : "btn-primary py-3"}>Mark as posted</button>
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      {(isAdmin || !video.area) && (
        <label className="block">
          <span className="label">Team</span>
          <select className="input" value={video.area_id ?? ""} disabled={pending || inFlight} onChange={(e) => run(() => assignArea(video.id, e.target.value || null))}>
            <option value="">Unassigned</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{areaLabel(a)}</option>)}
          </select>
        </label>
      )}

      {inFlight && (
        <div className="card">
          <div className="font-semibold">Sending to Instagram…</div>
          <p className="mt-1 text-sm text-muted">
            Instagram is processing the video{publish.detail ? ` (${publish.detail})` : ""}. This usually takes under a minute. You can leave this page; the post finishes on its own.
          </p>
        </div>
      )}

      {video.status === "pending" && !inFlight && (
        <div className="card flex flex-col gap-3">
          {connected && captionBox}
          {connected && <button onClick={post} disabled={pending} className="btn-primary py-3">Approve and post to @{handle}</button>}
          <button onClick={() => run(() => approveVideo(video.id))} disabled={pending} className={connected ? "btn-secondary" : "btn-primary py-3"}>{connected ? "Approve only, post later" : "Approve"}</button>
          <details>
            <summary className="cursor-pointer text-sm text-muted">Not selecting this one</summary>
            <textarea className="input mt-2 min-h-20" placeholder="Optional note for the uploader" value={note} onChange={(e) => setNote(e.target.value)} />
            <button onClick={() => run(() => rejectVideo(video.id, note))} disabled={pending} className="btn-danger mt-2 w-full">Mark as not selected</button>
          </details>
        </div>
      )}

      {video.status === "approved" && !inFlight && (
        <div className="card flex flex-col gap-3">
          <div className="font-semibold">Post it</div>
          {publish.state === "failed" && publish.error && (
            <p className="text-sm text-danger">Instagram did not take it: {publish.error}</p>
          )}
          {connected ? (
            <>
              {captionBox}
              <button onClick={post} disabled={pending} className="btn-primary py-3">{publish.state === "failed" ? `Try again on @${handle}` : `Post to @${handle} now`}</button>
              <details>
                <summary className="cursor-pointer text-sm text-muted">Post it by hand instead</summary>
                <div className="mt-2 flex flex-col gap-3">{manualPost}</div>
              </details>
            </>
          ) : (
            <>
              {manualPost}
              {canConnect && video.area && (
                <p className="text-xs text-muted">
                  To post with one tap next time, <a href={`/api/instagram/connect?area=${video.area.id}&back=${encodeURIComponent(`/review/${video.id}`)}`} className="text-accent underline">connect this team&rsquo;s Instagram account</a> while logged in to it in this browser.
                </p>
              )}
            </>
          )}
          <button onClick={() => run(() => rejectVideo(video.id, note))} disabled={pending} className="text-sm text-muted hover:text-danger">Changed my mind, don&apos;t post</button>
        </div>
      )}

      {video.status === "rejected" && (
        <button onClick={() => run(() => reopenVideo(video.id))} disabled={pending} className="btn-secondary">Move back to review</button>
      )}

      {video.status === "posted" && (
        <div className="card text-sm">
          Posted {video.posted_at ? new Date(video.posted_at).toLocaleString() : ""}{video.post_media_id && handle ? <> on <b>@{handle}</b></> : ""}.
          {video.post_url && <> <a href={video.post_url} target="_blank" rel="noreferrer" className="text-accent underline">Open post</a></>}
          <p className="mt-1 text-muted">The source file is deleted automatically seven days after posting.</p>
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {confirmDelete ? (
        <div className="card border-danger/40">
          <div className="font-semibold text-danger">Delete this video?</div>
          <p className="mt-1 text-sm text-muted">The file and its record are removed for good. The uploader is not notified.</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => run(async () => { const r = await deleteVideo(video.id); if ("ok" in r) router.push("/review"); return r; })} disabled={pending} className="btn-danger flex-1">{pending ? "Deleting…" : "Delete permanently"}</button>
            <button onClick={() => setConfirmDelete(false)} disabled={pending} className="btn-secondary flex-1">Keep it</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirmDelete(true)} disabled={pending || inFlight} className="self-start text-sm text-muted hover:text-danger">Delete this video</button>
      )}
    </div>
  );
}
