/**
 * A small form draft kept in localStorage, so a reload does not throw away what
 * someone typed (phones reload background tabs; see src/lib/upload-draft.ts for the
 * upload flow's own, older copy of this idea). Nothing is sent anywhere. Drafts older
 * than a day are ignored, for shared phones.
 *
 * `readLocalDraft` caches by the raw stored string, so it returns a stable object and
 * can be the snapshot function of useSyncExternalStore (with a null server snapshot,
 * which keeps hydration clean: the server never knows the draft).
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { raw: string | null; value: unknown }>();

export function readLocalDraft<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(key); } catch { raw = null; }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T | null;
  let value: T | null = null;
  try {
    const parsed = raw ? (JSON.parse(raw) as { savedAt?: number; value?: T }) : null;
    if (parsed && typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt < MAX_AGE_MS && parsed.value) value = parsed.value;
  } catch { value = null; }
  cache.set(key, { raw, value });
  return value;
}

export function saveLocalDraft<T>(key: string, value: T) {
  try { window.localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value })); } catch { /* private mode or full: the draft is a courtesy */ }
}

export function clearLocalDraft(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* ignore */ }
}
