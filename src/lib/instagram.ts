import { createHmac, timingSafeEqual } from "node:crypto";
import { siteUrl } from "@/lib/email";

/**
 * Instagram API with Instagram Login, for the Meta app "Assigned To Labor" (ids and
 * dashboard notes in CLAUDE.md). Server-only. Every base URL can be pointed at a mock
 * (scripts/dev/instagram-mock.mjs) through the INSTAGRAM_*_BASE variables, which is how
 * the flow is tested without a real account.
 */
const AUTHORIZE_BASE = process.env.INSTAGRAM_AUTHORIZE_BASE ?? "https://www.instagram.com";
const OAUTH_BASE = process.env.INSTAGRAM_OAUTH_BASE ?? "https://api.instagram.com";
const GRAPH_BASE = process.env.INSTAGRAM_GRAPH_BASE ?? "https://graph.instagram.com";
const VERSION = process.env.INSTAGRAM_API_VERSION ?? "v24.0";

export const INSTAGRAM_SCOPES = ["instagram_business_basic", "instagram_business_content_publish"] as const;
/**
 * Optional, for the dashboard's reach and views (2026-10-30): asked for at Connect only
 * when INSTAGRAM_INSIGHTS=1, which needs the permission added to the Meta app first
 * (Use cases -> Customize; see CLAUDE.md), or Instagram refuses the whole login. A
 * connection made before the switch keeps working without it (followers, likes and
 * comments need only instagram_business_basic) until the lead connects again.
 */
export const INSIGHTS_SCOPE = "instagram_business_manage_insights";
export function insightsRequested(): boolean {
  return process.env.INSTAGRAM_INSIGHTS === "1";
}
/** Registered in the Meta app's business login settings; must match exactly. */
export const REDIRECT_URI = `${siteUrl}/api/instagram/callback`;

export function instagramConfigured(): boolean {
  return Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET);
}
function appId(): string {
  const v = process.env.INSTAGRAM_APP_ID;
  if (!v) throw new Error("INSTAGRAM_APP_ID is not set");
  return v;
}
function appSecret(): string {
  const v = process.env.INSTAGRAM_APP_SECRET;
  if (!v) throw new Error("INSTAGRAM_APP_SECRET is not set");
  return v;
}

export class InstagramError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number, readonly subcode?: number, readonly type?: string) {
    super(message);
    this.name = "InstagramError";
  }
}

type Json = Record<string, unknown>;
const str = (v: unknown): string | null => (v === undefined || v === null ? null : String(v));
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

async function call(url: string, init?: RequestInit): Promise<Json> {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: Json | null = null;
  try { json = JSON.parse(text) as Json; } catch { /* not JSON */ }
  // Graph errors come as { error: { message, type, code, error_subcode } }; the Instagram
  // OAuth endpoints answer with a flat { error_type, code, error_message }.
  const err = json?.error as Json | undefined;
  if (!res.ok || err) {
    const message = str(err?.error_user_msg) ?? str(err?.message) ?? str(json?.error_message) ?? (text.trim().slice(0, 300) || res.statusText);
    throw new InstagramError(message, res.status, num(err?.code) ?? num(json?.code), num(err?.error_subcode), str(err?.type) ?? str(json?.error_type) ?? undefined);
  }
  return json ?? {};
}

function graphGet(path: string, token: string, params: Record<string, string>): Promise<Json> {
  const u = new URL(`/${VERSION}/${path}`, GRAPH_BASE);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  return call(u.toString());
}
function graphPost(path: string, token: string, params: Record<string, string>): Promise<Json> {
  const body = new URLSearchParams({ ...params, access_token: token });
  return call(`${GRAPH_BASE}/${VERSION}/${path}`, { method: "POST", body });
}

/** Where to send a lead to authorize the app for the Instagram account they are logged into. */
export function authorizeUrl(state: string): string {
  const u = new URL("/oauth/authorize", AUTHORIZE_BASE);
  // No force_reauth: with it Instagram demands the password again even when the browser is
  // logged in (seen 2026-10-13). The dialog itself lets the lead switch accounts.
  u.searchParams.set("client_id", appId());
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", [...INSTAGRAM_SCOPES, ...(insightsRequested() ? [INSIGHTS_SCOPE] : [])].join(","));
  u.searchParams.set("state", state);
  return u.toString();
}

/** The code from the callback becomes a short-lived (1 hour) token. */
export async function exchangeCode(code: string): Promise<{ accessToken: string; userId: string | null; permissions: string[] }> {
  const body = new URLSearchParams({
    client_id: appId(), client_secret: appSecret(), grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI, code: code.replace(/#_$/, ""), // Instagram appends "#_" to the redirect
  });
  const j = await call(`${OAUTH_BASE}/oauth/access_token`, { method: "POST", body });
  const d = (Array.isArray(j.data) ? (j.data[0] as Json) : j) ?? {};
  const accessToken = str(d.access_token);
  if (!accessToken) throw new InstagramError("No access token in Instagram's response", 502);
  return { accessToken, userId: str(d.user_id), permissions: (str(d.permissions) ?? "").split(",").map((s) => s.trim()).filter(Boolean) };
}

/** Short-lived -> long-lived (60 days). */
export async function longLivedToken(shortToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const u = new URL("/access_token", GRAPH_BASE);
  u.searchParams.set("grant_type", "ig_exchange_token");
  u.searchParams.set("client_secret", appSecret());
  u.searchParams.set("access_token", shortToken);
  return tokenResponse(await call(u.toString()));
}

/** A long-lived token at least a day old can be refreshed for another 60 days. */
export async function refreshToken(token: string): Promise<{ accessToken: string; expiresAt: Date }> {
  const u = new URL("/refresh_access_token", GRAPH_BASE);
  u.searchParams.set("grant_type", "ig_refresh_token");
  u.searchParams.set("access_token", token);
  return tokenResponse(await call(u.toString()));
}

function tokenResponse(j: Json): { accessToken: string; expiresAt: Date } {
  const accessToken = str(j.access_token);
  const expiresIn = num(j.expires_in) ?? 60 * 86400;
  if (!accessToken) throw new InstagramError("No access token in Instagram's response", 502);
  return { accessToken, expiresAt: new Date(Date.now() + expiresIn * 1000) };
}

export type IgProfile = { appScopedId: string; userId: string; username: string | null; accountType: string | null; name: string | null };

/** The account behind a token. `userId` is the professional account id used by the publishing endpoints. */
export async function me(token: string): Promise<IgProfile> {
  const j = await graphGet("me", token, { fields: "id,user_id,username,account_type,name" });
  const appScopedId = str(j.id) ?? "";
  return { appScopedId, userId: str(j.user_id) ?? appScopedId, username: str(j.username), accountType: str(j.account_type), name: str(j.name) };
}

// ── The dashboard's numbers (2026-10-30; src/lib/instagram-stats.ts caches them) ──

export type IgAccountStats = { username: string | null; name: string | null; pictureUrl: string | null; followers: number | null; follows: number | null; mediaCount: number | null };

/** Followers and friends: all on the user node with instagram_business_basic. */
export async function accountStats(token: string): Promise<IgAccountStats> {
  const j = await graphGet("me", token, { fields: "id,username,name,profile_picture_url,followers_count,follows_count,media_count" });
  return { username: str(j.username), name: str(j.name), pictureUrl: str(j.profile_picture_url), followers: num(j.followers_count) ?? null, follows: num(j.follows_count) ?? null, mediaCount: num(j.media_count) ?? null };
}

export type IgPost = {
  id: string; caption: string | null; mediaType: string | null; productType: string | null; permalink: string | null;
  thumbnailUrl: string | null; timestamp: string | null; likes: number | null; comments: number | null;
  /** Filled only with the insights permission. */
  views?: number | null; reach?: number | null;
};

/** The account's newest posts with their likes and comments (instagram_business_basic). */
export async function recentMedia(token: string, limit = 25): Promise<IgPost[]> {
  const j = await graphGet("me/media", token, { fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count", limit: String(limit) });
  return (Array.isArray(j.data) ? (j.data as Json[]) : []).map((m) => ({
    id: str(m.id) ?? "", caption: str(m.caption), mediaType: str(m.media_type), productType: str(m.media_product_type), permalink: str(m.permalink),
    thumbnailUrl: str(m.thumbnail_url) ?? (str(m.media_type) === "IMAGE" ? str(m.media_url) : null), timestamp: str(m.timestamp),
    likes: num(m.like_count) ?? null, comments: num(m.comments_count) ?? null,
  }));
}

export type IgAccountInsights = { reach: number | null; views: number | null; interactions: number | null; since: string; until: string; error?: string };

/** An insights row is `{ name, total_value: { value } }` with metric_type=total_value, or `{ name, values: [{ value }] }` without. */
function metricValue(rows: unknown, name: string): number | null {
  const row = (Array.isArray(rows) ? (rows as Json[]) : []).find((r) => r.name === name);
  if (!row) return null;
  const total = row.total_value as Json | undefined;
  if (total && typeof total.value === "number") return total.value;
  const values = row.values as Json[] | undefined;
  const last = Array.isArray(values) && values.length ? values[values.length - 1] : undefined;
  return typeof last?.value === "number" ? last.value : null;
}

/** Reach, views and interactions over a window (instagram_business_manage_insights; Instagram's figures lag up to 48 hours). */
export async function accountInsights(token: string, since: Date, until: Date): Promise<IgAccountInsights> {
  const j = await graphGet("me/insights", token, {
    metric: "reach,views,total_interactions", period: "day", metric_type: "total_value",
    since: String(Math.floor(since.getTime() / 1000)), until: String(Math.floor(until.getTime() / 1000)),
  });
  return { reach: metricValue(j.data, "reach"), views: metricValue(j.data, "views"), interactions: metricValue(j.data, "total_interactions"), since: since.toISOString(), until: until.toISOString() };
}

/** One post's lifetime views and reach (instagram_business_manage_insights). */
export async function mediaInsights(token: string, mediaId: string): Promise<{ views: number | null; reach: number | null }> {
  const j = await graphGet(`${mediaId}/insights`, token, { metric: "views,reach" });
  return { views: metricValue(j.data, "views"), reach: metricValue(j.data, "reach") };
}

/** Step 1 of a Reel: Instagram fetches the file from `videoUrl` and processes it. */
export async function createReelContainer(token: string, opts: { videoUrl: string; caption: string }): Promise<string> {
  const j = await graphPost("me/media", token, { media_type: "REELS", video_url: opts.videoUrl, caption: opts.caption, share_to_feed: "true" });
  const id = str(j.id);
  if (!id) throw new InstagramError("No container id in Instagram's response", 502);
  return id;
}

export type ContainerStatus = { code: "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED" | string; detail: string | null };

/** Step 2: poll until FINISHED (or ERROR / EXPIRED). */
export async function containerStatus(token: string, containerId: string): Promise<ContainerStatus> {
  const j = await graphGet(containerId, token, { fields: "status_code,status" });
  return { code: str(j.status_code) ?? "UNKNOWN", detail: str(j.status) };
}

/** Step 3: publish a FINISHED container; returns the media id. */
export async function publishContainer(token: string, containerId: string): Promise<string> {
  const j = await graphPost("me/media_publish", token, { creation_id: containerId });
  const id = str(j.id);
  if (!id) throw new InstagramError("No media id in Instagram's response", 502);
  return id;
}

export async function mediaPermalink(token: string, mediaId: string): Promise<string | null> {
  const j = await graphGet(mediaId, token, { fields: "id,permalink" });
  return str(j.permalink);
}

/**
 * Meta's `signed_request` (deauthorize and data deletion callbacks):
 * base64url(HMAC-SHA256 of the payload) "." base64url(JSON payload with user_id).
 */
export function parseSignedRequest(signedRequest: string, secret = appSecret()): { user_id?: string; algorithm?: string; issued_at?: number } {
  const dot = signedRequest.indexOf(".");
  if (dot <= 0) throw new Error("Malformed signed_request");
  const sig = Buffer.from(signedRequest.slice(0, dot), "base64url");
  const payload = signedRequest.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(payload).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) throw new Error("Bad signed_request signature");
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { user_id?: string | number; algorithm?: string; issued_at?: number };
  if (data.algorithm && String(data.algorithm).toUpperCase() !== "HMAC-SHA256") throw new Error("Unexpected signed_request algorithm");
  return { ...data, user_id: data.user_id === undefined ? undefined : String(data.user_id) };
}

/** A line for a page or a log: Meta's message plus its codes when it gave any. */
export function describeError(e: unknown): string {
  if (e instanceof InstagramError) return `${e.message}${e.code !== undefined || e.type ? ` (${[e.type, e.code !== undefined ? `code ${e.code}${e.subcode !== undefined ? `/${e.subcode}` : ""}` : null].filter(Boolean).join(" ")})` : ""}`;
  return e instanceof Error ? e.message : String(e);
}

/** The connect flow's state cookie (nonce + team), set by /api/instagram/connect, read by the callback. */
export const CONNECT_STATE_COOKIE = "atl-ig-connect";

/** `path` plus a query parameter the page shows as a notice (`instagram_connected` or `instagram_error`). */
export function withNotice(path: string, key: "instagram_connected" | "instagram_error", value: string): string {
  const u = new URL(path, "http://x");
  u.searchParams.set(key, value.slice(0, 300));
  return `${u.pathname}${u.search}`;
}
