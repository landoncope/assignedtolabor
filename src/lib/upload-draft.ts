/**
 * What someone has typed into the upload flow, kept in localStorage so a reload does
 * not throw it away. Added 2026-09-21 after Travis heard from people who lost their
 * script mid-way when "the browser refreshed". On phones that is not rare: iOS drops
 * a background tab and reloads it when you come back from another app, and Android
 * Chrome refreshes on a pull at the top of the page. Nothing is sent anywhere; the
 * draft lives on the device, is written on every change, and is removed when the
 * video is sent or the person starts fresh. Recorded clips are not kept (they are
 * tens of megabytes); after a reload the script and language come back and the
 * person records again.
 */
export type Draft = {
  v: 1;
  savedAt: number;
  step: string;
  consentIdx: number;
  hook: string | null;
  hookCustom: string;
  tplKey: string | null;
  blanks: string[];
  bodyCustom: string;
  cta: string | null;
  ctaCustom: string;
  dest: string;
  otherLanguage: string;
  name: string;
};

const KEY = "atl-upload-draft";
/** A draft older than this is left behind: a shared phone should not show yesterday's words. */
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let cached: { raw: string | null; draft: Draft | null } | null = null;

/** The draft saved on this device, or null. Cached, so it is safe to call from useSyncExternalStore. */
export function readDraft(): Draft | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(KEY); } catch { raw = null; }
  if (cached && cached.raw === raw) return cached.draft;
  let draft: Draft | null = null;
  try {
    const d = raw ? (JSON.parse(raw) as Draft) : null;
    if (d && d.v === 1 && typeof d.savedAt === "number" && Date.now() - d.savedAt < DRAFT_MAX_AGE_MS && typeof d.step === "string") draft = d;
  } catch { draft = null; }
  cached = { raw, draft };
  return draft;
}

export function saveDraft(d: Omit<Draft, "v" | "savedAt">) {
  try { window.localStorage.setItem(KEY, JSON.stringify({ v: 1, savedAt: Date.now(), ...d })); } catch { /* private mode or full: the draft is a courtesy */ }
}

export function clearDraft() {
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Whether anything worth keeping has been entered. An untouched flow saves nothing. */
export function draftHasContent(d: Omit<Draft, "v" | "savedAt">): boolean {
  return !!(d.hook || d.hookCustom.trim() || d.tplKey || d.blanks.some((b) => b.trim()) || d.bodyCustom.trim() || d.cta || d.ctaCustom.trim() || d.name.trim() || d.otherLanguage.trim())
    || !["welcome", "consent"].includes(d.step);
}
