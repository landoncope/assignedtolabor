"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { MAX_HEADLINE, type Cue } from "@/lib/caption-cues";
import type { RenderState } from "@/lib/types";
import { prepareCaptions, saveCaptions } from "../actions";

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * What the render step draws into the posted video (2026-11-01): the spoken words as
 * captions (on by default), and a headline at the top. The lead reads the words, fixes
 * any the transcription got wrong, and saves; the player on the left then previews them.
 */
export default function CaptionsCard({ videoId, cues, captionsOn, headline, aiHeadline, hasWords, canPrepare, renderState, renderError, disabled, onDirty }: {
  videoId: string; cues: Cue[] | null; captionsOn: boolean; headline: string | null; aiHeadline: string | null; hasWords: boolean; canPrepare: boolean;
  renderState: RenderState | null; renderError: string | null; disabled: boolean; onDirty: (dirty: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(captionsOn);
  const [head, setHead] = useState(headline ?? aiHeadline ?? "");
  const [texts, setTexts] = useState((cues ?? []).map((c) => c.text));
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty = on !== captionsOn || head !== (headline ?? aiHeadline ?? "") || texts.some((t, i) => t !== (cues ?? [])[i]?.text);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);

  function save() {
    setError(""); setSaved(false);
    start(async () => {
      const r = await saveCaptions(videoId, { captionsOn: on, headline: head, texts });
      if ("error" in r) { setError(r.error ?? "Could not save."); return; }
      setSaved(true); router.refresh();
    });
  }
  function prepare() {
    setError("");
    start(async () => {
      const r = await prepareCaptions(videoId);
      if ("error" in r) { setError(r.error ?? "Could not prepare the captions."); return; }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="font-semibold">On the video</div>
      <p className="mt-1 text-xs text-muted">Before the post, the words are drawn into the video as captions and the sound level is evened out. Save, then play the video to see where the words fall; the real captions are drawn into the file.</p>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} disabled={disabled || pending} />
        Draw the spoken words on the video
      </label>
      {on && (
        cues && cues.length > 0 ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-muted">Check the words ({cues.length} {cues.length === 1 ? "line" : "lines"}, automatic, may contain mistakes)</summary>
            <ul className="mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
              {cues.map((c, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-10 shrink-0 text-right tabular-nums text-muted">{fmt(c.s)}</span>
                  <input className="input py-1 text-xs" value={texts[i] ?? ""} maxLength={140} onChange={(e) => setTexts((ts) => ts.map((t, j) => (j === i ? e.target.value : t)))} disabled={disabled || pending} aria-label={`Caption line ${i + 1}`} />
                </li>
              ))}
            </ul>
          </details>
        ) : hasWords ? (
          <p className="mt-2 text-xs text-muted">No speech was found in the audio, so there is nothing to draw.</p>
        ) : canPrepare ? (
          <p className="mt-2 text-xs text-muted">The words have not been timed yet. <button type="button" onClick={prepare} disabled={disabled || pending} className="underline">Prepare the captions</button> (a few seconds), or post and they are prepared on the way.</p>
        ) : (
          <p className="mt-2 text-xs text-muted">The words have not been timed yet; they are prepared when the video is posted.</p>
        )
      )}
      <label className="mt-3 block">
        <span className="label">Headline</span>
        <input className="input" value={head} maxLength={MAX_HEADLINE} placeholder="A few words at the top, or nothing" onChange={(e) => setHead(e.target.value)} disabled={disabled || pending} />
        <span className="mt-1 block text-xs text-muted">
          Drawn at the top for the whole video. Leave it empty for none.
          {aiHeadline && head !== aiHeadline && <> <button type="button" onClick={() => setHead(aiHeadline)} disabled={disabled || pending} className="underline">Use the suggestion: &ldquo;{aiHeadline}&rdquo;</button></>}
        </span>
      </label>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={save} disabled={disabled || pending || !dirty} className="btn-secondary text-sm">{pending ? "Saving…" : "Save"}</button>
        {dirty && <span className="text-xs text-gold">Unsaved changes</span>}
        {!dirty && saved && <span className="text-xs text-accent">Saved</span>}
      </div>
      {renderState === "failed" && renderError && <p className="mt-2 text-xs text-danger">The last render failed: {renderError}</p>}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
