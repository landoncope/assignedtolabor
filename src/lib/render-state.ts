import { createHash } from "node:crypto";
import { isCueList } from "./caption-cues";

/**
 * What the publish flow needs to know about the render step without loading ffmpeg
 * (src/lib/render.ts does the work). Server only.
 */
export const RENDER_VERSION = 1;
/** Longer videos are posted as they are: a render would not fit in the function's time. */
export const RENDER_MAX_SECONDS = 12 * 60;
/** A render left in "rendering" this long is taken over by the next sweep (the function died). */
export const STALE_MINUTES = 15;

export function renderDisabled(): boolean {
  return process.env.RENDER_DISABLED === "1";
}

type RenderInputs = { caption_cues: unknown; captions_on: boolean; headline: string | null };

/** What a rendered file was made from; a different key means the file is stale. */
export function renderKey(v: RenderInputs): string {
  const cues = v.captions_on && isCueList(v.caption_cues) ? v.caption_cues : [];
  const headline = (v.headline ?? "").trim() || null;
  return createHash("sha1").update(JSON.stringify({ v: RENDER_VERSION, cues, headline })).digest("hex").slice(0, 20);
}

/** The rendered file is current for this video's cues and headline. */
export function renderCurrent(v: RenderInputs & { render_state: string | null; render_path: string | null; render_key: string | null }): boolean {
  return v.render_state === "done" && !!v.render_path && v.render_key === renderKey(v);
}

/** Why this video is posted as it is instead of rendered, or null. */
export function renderSkipReason(v: { duration_seconds: number | null }): string | null {
  if (renderDisabled()) return "Rendering is switched off (RENDER_DISABLED).";
  if (v.duration_seconds && v.duration_seconds > RENDER_MAX_SECONDS) return `Videos over ${RENDER_MAX_SECONDS / 60} minutes are posted as they are.`;
  return null;
}
