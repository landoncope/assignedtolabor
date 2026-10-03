"use client";

import { useState, useSyncExternalStore } from "react";

const noSubscribe = () => () => {};
const yes = () => true;
const no = () => false;
const nothing = () => null;

/**
 * What `read()` returned the first time this component rendered in the browser, and
 * the same value on every render after that. On the server and during hydration it is
 * null, so the server never needs to know it and hydration stays clean.
 *
 * Made for drafts kept in localStorage: a form mounts with the draft that was there
 * when the page loaded, and must NOT remount when the draft changes later. The first
 * version read the live value on every render; when a server action refreshed the
 * page, the freshly saved draft looked "new", the form's key flipped and it remounted
 * mid-flow, discarding its state (found by scripts/dev/lead-flow-check.mjs, 2026-10-03).
 *
 * `read` must return a stable reference while the stored value is unchanged.
 */
export function useInitialSnapshot<T>(read: () => T | null): T | null {
  const hydrated = useSyncExternalStore(noSubscribe, yes, no);
  const current = useSyncExternalStore(noSubscribe, read, nothing);
  const [latched, setLatched] = useState<{ value: T | null } | null>(null);
  // Adjusting state during render, once: React re-renders at once with the latched value.
  if (hydrated && latched === null) setLatched({ value: current });
  return latched ? latched.value : null;
}
