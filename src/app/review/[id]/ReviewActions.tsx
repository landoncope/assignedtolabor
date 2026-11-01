"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { isCueList } from "@/lib/caption-cues";
import { pictureWarning } from "@/lib/capture-meta";
import { areaLabel, type Area, type PublishState, type RenderState, type VideoWithArea } from "@/lib/types";
import { approveVideo, assignArea, deleteVideo, markPosted, postToInstagram, rejectVideo, reopenVideo, skipRender, unpostVideo } from "../actions";
import CaptionsCard from "./CaptionsCard";

const MAX_CAPTION = 2200;
type Render = { state: RenderState | null; error: string | null } | null;
type Publish = { state: PublishState | null; error: string | null; detail?: string | null; postUrl?: string | null; rendering?: boolean; render?: Render };

export default function ReviewActions({ video, areas, caption: scriptCaption, isAdmin, canConnect, canPrepare, renderCurrent }: { video: VideoWithArea; areas: Area[]; caption: string; isAdmin: boolean; canConnect: boolean; canPrepare: boolean; renderCurrent: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const suggested = video.ai_caption ?? "";
  const [caption, setCaption] = useState(video.post_caption ?? (suggested || scriptCaption));
  // Collaborators (2026-11-01): the team's usual invitees, or what this post was last sent with.
  const usual = (video.area?.instagram_collaborators ?? []).map((u) => `@${u}`).join(", ");
  const [collaborators, setCollaborators] = useState(video.post_collaborators?.length ? video.post_collaborators.map((u) => `@${u}`).join(", ") : usual);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmPosted, setConfirmPosted] = useState(false);
  const [confirmUnpost, setConfirmUnpost] = useState(false);
  const [publish, setPublish] = useState<Publish>({ state: video.publish_state, error: video.publish_error, render: { state: video.render_state, error: video.render_error } });
  const [captionsDirty, setCaptionsDirty] = useState(false);
  const onCaptionsDirty = useCallback((d: boolean) => setCaptionsDirty(d), []);
  const renderStarted = useRef(false);
  const router = useRouter();

  const connected = Boolean(video.area?.instagram_user_id);
  const handle = (video.area?.instagram_handle ?? "").replace(/^@/, "");
  const inFlight = video.status !== "posted" && (publish.state === "queued" || publish.state === "processing");
  const rendering = inFlight && publish.state === "queued" && (publish.render?.state === "queued" || publish.render?.state === "rendering" || !!publish.rendering);

  // The render step (2026-11-01): a queued post waits for its render, which this page starts
  // (the route takes a minute or more; the cron does it if the page is gone).
  const startRender = useCallback(() => {
    if (renderStarted.current) return;
    renderStarted.current = true;
    fetch(`/api/videos/${video.id}/render`, { method: "POST" }).then(async (r) => {
      const j = (await r.json().catch(() => null)) as { publish?: Publish; render?: { ok: boolean; error?: string; busy?: boolean } } | null;
      const pub = j?.publish;
      if (pub) setPublish((p) => ({ ...p, ...pub, render: j?.render?.ok ? { state: "done", error: null } : (j?.render ? { state: "failed", error: j.render.error ?? null } : p.render) }));
      else if (j?.render && !j.render.ok && !j.render.busy) setPublish({ state: "failed", error: `Could not add the captions to the video: ${j.render.error ?? "unknown error"}`, render: { state: "failed", error: j.render.error ?? null } });
      router.refresh();
    }).catch(() => { renderStarted.current = false; });
  }, [video.id, router]);
  useEffect(() => { if (rendering) startRender(); }, [rendering, startRender]);
  // A frozen picture (the iPhone recordings of 2026-09-19): Instagram refuses the file, so
  // there is no one-tap button, only the reason. The server refuses it too (fileProblem).
  const frozen = video.capture_meta ? pictureWarning(video.capture_meta) : null;
  const frozenNote = frozen && (
    <p className="text-sm text-danger"><b>This recording can&rsquo;t be posted.</b> {frozen} Instagram refuses a file whose picture freezes, and viewers would see a still image. Mark it not selected so the person can record again.</p>
  );

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
      const r = await postToInstagram(video.id, caption, collaborators);
      if ("error" in r) { setError(r.error); return; }
      renderStarted.current = false;
      setPublish({ ...r.outcome, render: r.outcome.rendering ? { state: "queued", error: null } : publish.render });
      if (r.outcome.state === "published" || r.outcome.state === "failed") router.refresh();
    });
  }

  /** The file for a post by hand: the rendered one (captions, headline, loudness) when it is current, else the original. */
  async function download(rendered: boolean) {
    setDownloading(true); setError("");
    try {
      const r = await fetch(`/api/videos/${video.id}/playback-url${rendered ? "?rendered=1" : ""}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not get the file");
      const blob = await (await fetch(j.url)).blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const base = (video.file_name ?? `video-${video.id}.mp4`).replace(/\.[a-z0-9]+$/i, "");
      a.download = rendered ? `${base}-captioned.mp4` : (video.file_name ?? `video-${video.id}.mp4`);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e) { setError(e instanceof Error ? e.message : "Download failed"); }
    finally { setDownloading(false); }
  }

  /** Render now, for a post by hand on a team that is not connected (the same step a one-tap post runs). */
  async function prepareRender() {
    setPreparing(true); setError("");
    try {
      const r = await fetch(`/api/videos/${video.id}/render`, { method: "POST" });
      const j = (await r.json().catch(() => null)) as { render?: { ok: boolean; error?: string; busy?: boolean }; error?: string } | null;
      if (!r.ok) throw new Error(j?.error ?? "Could not prepare the captioned video");
      if (j?.render && !j.render.ok && !j.render.busy) throw new Error(j.render.error ?? "The render failed");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not prepare the captioned video"); }
    finally { setPreparing(false); }
  }

  async function copyCaption() {
    await navigator.clipboard.writeText(caption);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }

  const captionBox = (
    <label className="block">
      <span className="label">Caption</span>
      <textarea className="input min-h-28 whitespace-pre-line text-sm" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={MAX_CAPTION} disabled={pending} />
      <span className="mt-1 block text-xs text-muted">
        {caption.length}/{MAX_CAPTION}.{" "}
        {suggested && caption === suggested ? "Suggested from what they say in the video; edit as you like." : scriptCaption && caption === scriptCaption ? "The uploader\u2019s script; edit as you like." : "Edit as you like."}
        {suggested && caption !== suggested && <> <button type="button" onClick={() => setCaption(suggested)} disabled={pending} className="underline">Use the suggested caption</button></>}
        {scriptCaption && caption !== scriptCaption && <> <button type="button" onClick={() => setCaption(scriptCaption)} disabled={pending} className="underline">Use the script</button></>}
      </span>
    </label>
  );

  const captionsCard = (
    <CaptionsCard
      videoId={video.id} cues={isCueList(video.caption_cues) ? video.caption_cues : null} captionsOn={video.captions_on} headline={video.headline} aiHeadline={video.ai_headline || null}
      hasWords={Array.isArray(video.transcript_words)} canPrepare={canPrepare} renderState={video.render_state} renderError={video.render_error} disabled={pending || inFlight} onDirty={onCaptionsDirty}
    />
  );
  const postDisabled = pending || captionsDirty;
  const dirtyNote = captionsDirty && <p className="text-xs text-gold">Save the captions first.</p>;

  const collaboratorBox = (
    <label className="block">
      <span className="label">Collaborators</span>
      <input className="input" placeholder="@username, up to 3" value={collaborators} onChange={(e) => setCollaborators(e.target.value)} disabled={pending} />
      <span className="mt-1 block text-xs text-muted">
        Instagram invites each account when the Reel is posted; once they accept in the app, the Reel shows on their profile too. Leave it empty for none.
        {usual && collaborators !== usual && <> <button type="button" onClick={() => setCollaborators(usual)} disabled={pending} className="underline">Use the team&rsquo;s usual</button></>}
      </span>
    </label>
  );

  // Posting by hand (no connected account, or by choice). Marking it posted asks first:
  // on 2026-10-29 a lead took "Mark as posted" for the post button while the team's
  // connection was dead, and two videos were recorded as posted that never were.
  const drawn = video.render_meta ? [video.render_meta.cues > 0 ? "the captions" : "", video.render_meta.headline ? "the headline" : ""].filter(Boolean) : [];
  const manualPost = (
    <>
      <p className="text-sm text-muted">
        Download the file, post it from {handle ? <>the <b>@{handle}</b> Instagram account</> : "the team's Instagram account"} yourself, then come back and paste the link here.
      </p>
      {renderCurrent && !captionsDirty ? (
        <p className="text-xs text-muted">The download has {drawn.length ? `${drawn.join(" and ")} drawn in and ` : ""}the sound evened out. <button type="button" onClick={() => download(false)} disabled={downloading} className="underline">Original file instead</button></p>
      ) : preparing ? (
        <p className="text-xs text-muted">Preparing the captioned video… about a minute for each minute of video.</p>
      ) : (
        <p className="text-xs text-muted">To post it with the captions drawn in and the sound evened out, <button type="button" onClick={prepareRender} disabled={pending || captionsDirty || !video.storage_path} className="underline">prepare the captioned video</button> first{captionsDirty ? " (save the captions)" : ""}.</p>
      )}
      <div className="flex gap-2">
        <button onClick={() => download(renderCurrent && !captionsDirty)} disabled={downloading || preparing} className="btn-secondary flex-1">{downloading ? "Preparing…" : "Download video"}</button>
        <button onClick={copyCaption} disabled={!caption} className="btn-secondary flex-1">{copied ? "Copied" : "Copy caption"}</button>
      </div>
      <input className="input" placeholder="https://www.instagram.com/reel/…" value={postUrl} onChange={(e) => setPostUrl(e.target.value)} />
      {confirmPosted ? (
        <div className="rounded-lg border border-line p-3">
          <p className="text-sm">Is it live on Instagram already? This only records it here; it does not post anything.</p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => { setConfirmPosted(false); run(() => markPosted(video.id, postUrl)); }} disabled={pending} className="btn-primary flex-1">Yes, it&rsquo;s on Instagram</button>
            <button onClick={() => setConfirmPosted(false)} disabled={pending} className="btn-secondary flex-1">Not yet</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirmPosted(true)} disabled={pending} className={connected ? "btn-secondary" : "btn-primary py-3"}>I posted it myself</button>
      )}
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
          <div className="font-semibold">{rendering ? "Adding the captions to the video…" : "Sending to Instagram…"}</div>
          <p className="mt-1 text-sm text-muted">
            {rendering
              ? "The words and the headline are being drawn into the video and the sound level evened out. About a minute for each minute of video; then it goes to Instagram. You can leave this page; the post finishes on its own."
              : <>Instagram is processing the video{publish.detail ? ` (${publish.detail})` : ""}. This usually takes under a minute. You can leave this page; the post finishes on its own.</>}
          </p>
        </div>
      )}

      {video.status === "pending" && !inFlight && (
        <div className="card flex flex-col gap-3">
          {frozenNote}
          {connected && !frozen && <>{captionsCard}{captionBox}{collaboratorBox}{dirtyNote}</>}
          {connected && !frozen && <button onClick={post} disabled={postDisabled} className="btn-primary py-3">Approve and post to @{handle}</button>}
          <button onClick={() => run(() => approveVideo(video.id))} disabled={pending} className={connected || frozen ? "btn-secondary" : "btn-primary py-3"}>{frozen ? "Approve anyway" : connected ? "Approve only, post later" : "Approve"}</button>
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
          {frozenNote}
          {publish.state === "failed" && publish.error && !frozen && (
            <p className="text-sm text-danger">Not posted: {publish.error}</p>
          )}
          {connected && !frozen ? (
            <>
              {captionsCard}
              {captionBox}
              {collaboratorBox}
              {dirtyNote}
              <button onClick={post} disabled={postDisabled} className="btn-primary py-3">{publish.state === "failed" ? `Try again on @${handle}` : `Post to @${handle} now`}</button>
              {publish.state === "failed" && publish.render?.state === "failed" && (
                <button onClick={() => { setError(""); start(async () => { const r = await skipRender(video.id); if ("error" in r) { setError(r.error); return; } renderStarted.current = false; setPublish({ ...r.outcome, render: { state: "skipped", error: null } }); if (r.outcome.state === "published" || r.outcome.state === "failed") router.refresh(); }); }} disabled={pending} className="btn-secondary">Post the original file instead (no captions)</button>
              )}
              <details>
                <summary className="cursor-pointer text-sm text-muted">Post it by hand instead</summary>
                <div className="mt-2 flex flex-col gap-3">{manualPost}</div>
              </details>
            </>
          ) : (
            <>
              {captionsCard}
              {captionBox}
              {dirtyNote}
              {manualPost}
              {canConnect && video.area && !connected && (
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
          {video.post_media_id
            ? <>Posted {video.posted_at ? new Date(video.posted_at).toLocaleString() : ""}{handle ? <> on <b>@{handle}</b></> : ""}.</>
            : <>Marked as posted by hand {video.posted_at ? new Date(video.posted_at).toLocaleString() : ""}.{video.post_url ? "" : " No link to the post was given."}</>}
          {video.post_url && <> <a href={video.post_url} target="_blank" rel="noreferrer" className="text-accent underline">Open post</a></>}
          {video.post_media_id && video.render_meta && (video.render_meta.cues > 0 || video.render_meta.headline) && (
            <p className="mt-1">{video.render_meta.cues > 0 ? "The captions" : "The headline"}{video.render_meta.cues > 0 && video.render_meta.headline ? " and the headline" : ""} were drawn into the posted video.</p>
          )}
          {video.post_media_id && video.post_collaborators && video.post_collaborators.length > 0 && (
            <p className="mt-1">Collaborator invite sent to {video.post_collaborators.map((u) => `@${u}`).join(", ")}; the Reel appears on their profile once they accept in Instagram.</p>
          )}
          <p className="mt-1 text-muted">The source file is deleted automatically seven days after posting.</p>
          {!video.file_purged_at && (confirmUnpost ? (
            <div className="mt-3 rounded-lg border border-line p-3">
              <p>Move it back to Ready to post? For a video marked posted by mistake. Nothing on Instagram changes{video.post_media_id ? ": the Reel stays up unless you delete it there" : ""}.</p>
              <div className="mt-2 flex gap-2">
                <button onClick={() => { setConfirmUnpost(false); setPublish({ state: null, error: null }); run(() => unpostVideo(video.id)); }} disabled={pending} className="btn-primary flex-1">Move it back</button>
                <button onClick={() => setConfirmUnpost(false)} disabled={pending} className="btn-secondary flex-1">Keep it posted</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmUnpost(true)} disabled={pending} className="mt-2 block text-muted underline hover:text-foreground">Not actually posted? Move it back</button>
          ))}
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
