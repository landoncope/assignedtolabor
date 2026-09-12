"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
    __atlTurnstileReady?: Promise<void>;
  }
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

function loadScript(): Promise<void> {
  if (typeof window === "undefined" || window.turnstile) return Promise.resolve();
  if (!window.__atlTurnstileReady) {
    window.__atlTurnstileReady = new Promise<void>((resolve) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = () => resolve();
      document.head.appendChild(s);
    });
  }
  return window.__atlTurnstileReady;
}

/**
 * Cloudflare Turnstile challenge. Supabase Auth verifies the token server-side
 * (Attack Protection -> Captcha), so anonymous sign-ins and magic links from bots are
 * refused. Calls onToken with a token, or null when it expires or fails. Renders
 * nothing when no site key is configured, which keeps local runs and tests simple.
 */
export default function Turnstile({ onToken, theme = "auto", className = "" }: { onToken: (token: string | null) => void; theme?: "light" | "dark" | "auto"; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let id: string | undefined;
    let cancelled = false;
    loadScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return;
      id = window.turnstile.render(ref.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme,
        callback: (t: string) => onTokenRef.current(t),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
      });
    });
    return () => {
      cancelled = true;
      if (id && window.turnstile) { try { window.turnstile.remove(id); } catch { /* ignore */ } }
    };
  }, [theme]);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={ref} className={className} />;
}
