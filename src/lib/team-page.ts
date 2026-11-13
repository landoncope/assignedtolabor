/**
 * A team's page on this site, assignedtolabor.org/<slug> (2026-11-12, Travis): the
 * address rules, and how the team's "meet with missionaries" form is shown there. The
 * forms are Google Forms run by Gathering Israel today, one per channel; a Google Form
 * is shown inside the page, any other link is forwarded to.
 */

/** First path segments the app itself uses, or might; a team cannot take one as its address. */
const RESERVED = new Set([
  "admin", "api", "auth", "dev", "lead", "login", "logout", "my", "privacy", "qr", "review", "terms", "upload",
  "brand", "ffmpeg", "icon", "apple-icon", "favicon", "manifest", "opengraph-image", "twitter-image", "robots", "sitemap",
  "about", "account", "app", "assets", "contact", "dashboard", "donate", "go", "help", "home", "index", "join", "meet",
  "new", "public", "settings", "signin", "signup", "static", "team", "teams", "videos", "www",
]);

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** "Philippines Opt-In" -> "philippines-opt-in". */
export function cleanSlug(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\/[^/]+\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Why this address cannot be used, or null. */
export function slugProblem(slug: string): string | null {
  if (!SLUG_PATTERN.test(slug)) return "The page address needs 3 to 40 letters, digits or hyphens.";
  if (RESERVED.has(slug)) return `"${slug}" is an address the site uses itself. Pick another.`;
  return null;
}

const GOOGLE_FORM = /^https:\/\/docs\.google\.com\/forms\/d\/e\/([\w-]+)\/(?:viewform|formResponse)/;

/** The address to put in the frame when the link is a Google Form, else null (the page forwards instead). */
export function embedUrl(formUrl: string | null | undefined): string | null {
  const m = formUrl ? GOOGLE_FORM.exec(formUrl) : null;
  return m ? `https://docs.google.com/forms/d/e/${m[1]}/viewform?embedded=true` : null;
}

export type ResolvedForm = { url: string; title: string | null } | { error: string };

/**
 * Follows the link an admin pasted (a forms.gle short link included) to where it really
 * goes. A Google Form is stored in its long form, which is what can be shown in a frame,
 * with the form's own title; anything else is stored as typed.
 */
export async function resolveFormUrl(raw: string): Promise<ResolvedForm> {
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return { error: "That doesn't look like a link." }; }
  if (url.protocol !== "https:") return { error: "The form link has to start with https://." };
  let res: Response;
  let html = "";
  try {
    res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
    html = await res.text();
  } catch {
    return { error: "That link did not answer. Check it and try again." };
  }
  if (!res.ok) return { error: `That link did not open (it answered ${res.status}). Check it and try again.` };
  const google = GOOGLE_FORM.exec(res.url);
  if (!google) return { url: url.toString(), title: null };
  if (!html.includes("FB_PUBLIC_LOAD_DATA_")) return { error: "That Google Form is not open to the public (or the link is wrong). Open it signed out to check." };
  const title = /<meta property="og:title" content="([^"]*)"/.exec(html)?.[1] ?? /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? null;
  return { url: `https://docs.google.com/forms/d/e/${google[1]}/viewform`, title: title ? decodeEntities(title).trim().slice(0, 120) || null : null };
}

function decodeEntities(s: string): string {
  return s.replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16))).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

/** Link previews and crawlers: not people opening the page. */
export function looksLikeBot(userAgent: string | null): boolean {
  return !userAgent || /bot|crawl|spider|preview|facebookexternalhit|whatsapp|slack|telegram|discord|curl|wget|python|headless|monitor|lighthouse/i.test(userAgent);
}

/** The page's address without the scheme, for showing: assignedtolabor.org/philippines. */
export function pageAddress(siteUrl: string, slug: string): string {
  return `${siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}/${slug}`;
}
