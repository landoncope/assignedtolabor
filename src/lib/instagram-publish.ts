import type { SupabaseClient } from "@supabase/supabase-js";
import { pictureWarning, type CaptureMeta } from "@/lib/capture-meta";
import * as ig from "@/lib/instagram";
import type { PublishState, Script } from "@/lib/types";

/**
 * One-tap publishing to Instagram, server side with the service role. The callers
 * (server actions, the status route, the cron) have already checked who is asking.
 *
 * A video's `publish_state` moves queued -> processing -> published, or -> failed with
 * `publish_error`; `status` becomes 'posted' only when Instagram confirms. Instagram
 * fetches the file from a signed Storage URL while it processes the container, so
 * nothing large passes through our server.
 */
export const SIGNED_URL_SECONDS = 6 * 3600;
export const MAX_BYTES = 300 * 1024 * 1024; // Instagram's Reels API limit
export const MIN_SECONDS = 3;
export const MAX_SECONDS = 15 * 60;
export const MAX_CAPTION = 2200;
/** Refresh a token this long before it expires (tokens last 60 days). */
export const REFRESH_BEFORE_DAYS = 10;

type Db = SupabaseClient;
export type PublishOutcome = { state: PublishState | null; error: string | null; postUrl: string | null; detail?: string | null };

type VideoRow = {
  id: string; area_id: string | null; status: string; storage_path: string | null; file_purged_at: string | null;
  duration_seconds: number | null; file_size: number | null; script: Script | null;
  publish_state: PublishState | null; publish_container_id: string | null; publish_requested_by: string | null;
  publish_attempts: number; post_caption: string | null; ai_caption: string | null; post_url: string | null; publish_error: string | null;
  capture_meta: CaptureMeta | null;
};
const VIDEO_COLS = "id, area_id, status, storage_path, file_purged_at, duration_seconds, file_size, script, publish_state, publish_container_id, publish_requested_by, publish_attempts, post_caption, ai_caption, post_url, publish_error, capture_meta";

type AccountRow = { area_id: string; ig_user_id: string; username: string | null; access_token: string; token_expires_at: string | null };

export function captionFor(script: Script | null): string {
  return [script?.hook, script?.body, script?.cta].filter(Boolean).join("\n\n");
}

/** Why Instagram would refuse this file, before we ask it. Null when it looks fine. */
export function fileProblem(v: Pick<VideoRow, "storage_path" | "file_purged_at" | "duration_seconds" | "file_size" | "capture_meta">): string | null {
  if (v.file_purged_at || !v.storage_path) return "The video file has already been deleted from our storage.";
  if (v.file_size && v.file_size > MAX_BYTES) return `The file is ${(v.file_size / 1048576).toFixed(0)} MB; Instagram takes Reels up to 300 MB.`;
  if (v.duration_seconds && v.duration_seconds < MIN_SECONDS) return "Instagram needs a Reel of at least 3 seconds.";
  if (v.duration_seconds && v.duration_seconds > MAX_SECONDS) return "Instagram takes Reels up to 15 minutes.";
  // A frozen picture (the iPhone recordings of 2026-09-19): Instagram's processing ends in a
  // bare "ERROR" (seen 2026-10-21 on the first Philippines post), and viewers would see a
  // still image anyway.
  const frozen = v.capture_meta ? pictureWarning(v.capture_meta) : null;
  if (frozen) return `${frozen} Instagram refuses a file whose picture freezes, and viewers would see a still image. Ask the person to record again, or mark the video not selected.`;
  return null;
}

async function loadVideo(db: Db, videoId: string): Promise<VideoRow | null> {
  const { data, error } = await db.from("videos").select(VIDEO_COLS).eq("id", videoId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as VideoRow | null) ?? null;
}

async function loadAccount(db: Db, areaId: string): Promise<AccountRow | null> {
  const { data, error } = await db.from("instagram_accounts").select("area_id, ig_user_id, username, access_token, token_expires_at").eq("area_id", areaId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AccountRow | null) ?? null;
}

async function fail(db: Db, videoId: string, message: string): Promise<PublishOutcome> {
  await db.from("videos").update({ publish_state: "failed", publish_error: message }).eq("id", videoId);
  return { state: "failed", error: message, postUrl: null };
}

function current(v: VideoRow): PublishOutcome {
  return { state: v.publish_state, error: v.publish_error, postUrl: v.post_url };
}

/**
 * Instagram no longer accepts the stored token (OAuthException code 190: "the session has
 * been invalidated because the user changed their password or Facebook has changed the
 * session for security reasons", seen 2026-10-27 on the English team after six daily
 * posts, and on 2026-10-30 on all four connected teams at once). A retry can never
 * succeed, so the connection is forgotten like a deauthorize, the loss is written on the
 * team row (the notify sweep emails the leads once) and the pages show Connect again.
 */
export function tokenRejected(e: unknown): boolean {
  return e instanceof ig.InstagramError && e.code === 190;
}
export async function forgetRejected(db: Db, areaId: string, username: string | null): Promise<string> {
  const reason = `Instagram no longer accepts our connection to @${(username ?? "").replace(/^@/, "") || "the team's account"} (it says the account's password changed or it ended the session for security reasons). Connect the account again under Instagram accounts on the Review page, logged in to it.`;
  await removeConnection(db, { areaId }, reason);
  return reason;
}

/**
 * Cron: probe each connection once a day with one /me call, so a dead token is found
 * the day it dies rather than when a lead taps Post. Connections and probes younger
 * than a day are skipped (a test build's mock connection lives for minutes, and
 * production must never send its token to the real Instagram). A rejected token is
 * forgotten; any other error is noted on the row and tried again the next day.
 */
export async function checkConnections(db: Db, dry = false, areas: string[] | null = null, max = 5): Promise<{ area_id: string; result: string }[]> {
  if (areas && areas.length === 0) return [];
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  let q = db.from("instagram_accounts").select("area_id, username, access_token, checked_at").lt("connected_at", dayAgo).or(`checked_at.is.null,checked_at.lt.${dayAgo}`);
  if (areas) q = q.in("area_id", areas);
  const { data, error } = await q.order("checked_at", { ascending: true, nullsFirst: true }).limit(max);
  if (error) throw new Error(error.message);
  const out: { area_id: string; result: string }[] = [];
  for (const a of (data ?? []) as { area_id: string; username: string | null; access_token: string }[]) {
    if (dry) { out.push({ area_id: a.area_id, result: "would probe" }); continue; }
    try {
      const me = await ig.me(a.access_token);
      await db.from("instagram_accounts").update({ checked_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("area_id", a.area_id);
      out.push({ area_id: a.area_id, result: `ok (@${me.username ?? "?"})` });
    } catch (e) {
      const msg = ig.describeError(e);
      if (tokenRejected(e)) {
        await forgetRejected(db, a.area_id, a.username);
        out.push({ area_id: a.area_id, result: `token rejected (${msg}): connection forgotten, the leads will be told` });
        continue;
      }
      await db.from("instagram_accounts").update({ checked_at: new Date().toISOString(), last_error: `probe failed: ${msg}`, updated_at: new Date().toISOString() }).eq("area_id", a.area_id);
      out.push({ area_id: a.area_id, result: `probe failed: ${msg}` });
    }
  }
  return out;
}

/** Create the Reel container for a queued video. Fast: one request to Instagram. */
export async function startPublish(db: Db, videoId: string): Promise<PublishOutcome> {
  const v = await loadVideo(db, videoId);
  if (!v) return { state: null, error: "Video not found.", postUrl: null };
  if (v.status === "posted" || v.publish_state === "published") return { state: "published", error: null, postUrl: v.post_url };
  if (v.publish_state === "processing" && v.publish_container_id) return current(v);
  if (!v.area_id) return fail(db, v.id, "This video has no team, so there is no Instagram account to post to.");
  const acct = await loadAccount(db, v.area_id);
  if (!acct) return fail(db, v.id, "This team has no Instagram account connected.");
  const problem = fileProblem(v);
  if (problem) return fail(db, v.id, problem);
  const { data: signed, error: signErr } = await db.storage.from("videos").createSignedUrl(v.storage_path!, SIGNED_URL_SECONDS);
  if (signErr || !signed) return fail(db, v.id, `Could not make a link to the file: ${signErr?.message ?? "unknown error"}`);
  const caption = (v.post_caption ?? v.ai_caption ?? captionFor(v.script)).slice(0, MAX_CAPTION);
  try {
    const containerId = await ig.createReelContainer(acct.access_token, { videoUrl: signed.signedUrl, caption });
    await db.from("videos").update({
      publish_state: "processing", publish_container_id: containerId, publish_attempts: v.publish_attempts + 1,
      publish_error: null, post_caption: caption,
    }).eq("id", v.id);
    return { state: "processing", error: null, postUrl: null };
  } catch (e) {
    if (tokenRejected(e)) return fail(db, v.id, await forgetRejected(db, v.area_id, acct.username));
    return fail(db, v.id, ig.describeError(e));
  }
}

/** Check a processing container; publish it when Instagram has finished with the file. */
export async function advancePublish(db: Db, videoId: string): Promise<PublishOutcome> {
  const v = await loadVideo(db, videoId);
  if (!v) return { state: null, error: "Video not found.", postUrl: null };
  if (v.publish_state === "queued") return startPublish(db, videoId);
  if (v.publish_state !== "processing" || !v.publish_container_id) return current(v);
  const acct = v.area_id ? await loadAccount(db, v.area_id) : null;
  if (!acct) return fail(db, v.id, "The team's Instagram account was disconnected while the post was in progress.");
  try {
    const s = await ig.containerStatus(acct.access_token, v.publish_container_id);
    if (s.code === "IN_PROGRESS") return { state: "processing", error: null, postUrl: null, detail: s.detail };
    if (s.code === "FINISHED" || s.code === "PUBLISHED") {
      const mediaId = s.code === "FINISHED" ? await ig.publishContainer(acct.access_token, v.publish_container_id) : null;
      const permalink = mediaId ? await ig.mediaPermalink(acct.access_token, mediaId).catch(() => null) : null;
      await db.from("videos").update({
        status: "posted", posted_at: new Date().toISOString(), posted_by: v.publish_requested_by, post_url: permalink,
        post_media_id: mediaId, publish_state: "published", publish_error: null,
      }).eq("id", v.id);
      return { state: "published", error: null, postUrl: permalink };
    }
    // Instagram's `status` carries a reason ("Error: Media upload has failed with error code
    // 2207026") or, as on 2026-10-21 with a frozen-picture file, just "ERROR" again.
    const reason = s.detail && s.detail !== s.code ? `Instagram could not use the file: ${s.detail}`
      : `Instagram could not process this file and gave no reason (${s.code}). Check that the picture plays to the end: a recording whose picture freezes is refused.`;
    return fail(db, v.id, reason);
  } catch (e) {
    if (tokenRejected(e) && v.area_id) return fail(db, v.id, await forgetRejected(db, v.area_id, acct.username));
    return fail(db, v.id, ig.describeError(e));
  }
}

/** Cron: move every in-flight post along, so a lead who closed the page still gets it posted. */
export async function sweepPublishing(db: Db, dry = false, only: string[] | null = null): Promise<{ id: string; before: PublishState; after: PublishOutcome | null }[]> {
  if (only && only.length === 0) return [];
  let q = db.from("videos").select("id, publish_state").in("publish_state", ["queued", "processing"]);
  if (only) q = q.in("id", only);
  const { data, error } = await q.order("publish_requested_at", { ascending: true }).limit(50);
  if (error) throw new Error(error.message);
  const out: { id: string; before: PublishState; after: PublishOutcome | null }[] = [];
  for (const row of (data ?? []) as { id: string; publish_state: PublishState }[]) {
    out.push({ id: row.id, before: row.publish_state, after: dry ? null : await advancePublish(db, row.id) });
  }
  return out;
}

/** Cron: refresh long-lived tokens before they expire. A token must be a day old to be refreshable. */
export async function refreshExpiringTokens(db: Db, dry = false, areas: string[] | null = null): Promise<{ area_id: string; result: string }[]> {
  if (areas && areas.length === 0) return [];
  const soon = new Date(Date.now() + REFRESH_BEFORE_DAYS * 86400_000).toISOString();
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  let q = db.from("instagram_accounts").select("area_id, username, access_token, token_expires_at, refreshed_at, connected_at").lt("token_expires_at", soon);
  if (areas) q = q.in("area_id", areas);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const out: { area_id: string; result: string }[] = [];
  for (const a of (data ?? []) as { area_id: string; username: string | null; access_token: string; token_expires_at: string; refreshed_at: string | null; connected_at: string }[]) {
    if ((a.refreshed_at ?? a.connected_at) > dayAgo) { out.push({ area_id: a.area_id, result: "too new to refresh" }); continue; }
    if (dry) { out.push({ area_id: a.area_id, result: "would refresh" }); continue; }
    try {
      const t = await ig.refreshToken(a.access_token);
      await db.from("instagram_accounts").update({ access_token: t.accessToken, token_expires_at: t.expiresAt.toISOString(), refreshed_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("area_id", a.area_id);
      out.push({ area_id: a.area_id, result: `refreshed until ${t.expiresAt.toISOString().slice(0, 10)}` });
    } catch (e) {
      const msg = ig.describeError(e);
      if (tokenRejected(e)) {
        await forgetRejected(db, a.area_id, a.username);
        out.push({ area_id: a.area_id, result: `token rejected (${msg}): connection forgotten, the leads will be told` });
        continue;
      }
      await db.from("instagram_accounts").update({ last_error: `refresh failed: ${msg}`, updated_at: new Date().toISOString() }).eq("area_id", a.area_id);
      out.push({ area_id: a.area_id, result: `refresh failed: ${msg}` });
    }
  }
  return out;
}

/** After a successful login: store the token for the team and show the handle on the team row. */
export async function saveConnection(db: Db, areaId: string, userId: string, profile: ig.IgProfile, token: { accessToken: string; expiresAt: Date }, scopes: string[]): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db.from("instagram_accounts").upsert({
    area_id: areaId, ig_user_id: profile.userId, app_scoped_id: profile.appScopedId, username: profile.username, account_type: profile.accountType,
    access_token: token.accessToken, token_expires_at: token.expiresAt.toISOString(), scopes, connected_by: userId, connected_at: now, refreshed_at: null, last_error: null, updated_at: now,
  }, { onConflict: "area_id" });
  if (error) throw new Error(error.message);
  const { error: aErr } = await db.from("areas").update({
    instagram_user_id: profile.userId, instagram_connected_at: now, ...(profile.username ? { instagram_handle: profile.username } : {}),
    instagram_lost_at: null, instagram_lost_reason: null, instagram_lost_notified_at: null,
  }).eq("id", areaId);
  if (aErr) throw new Error(aErr.message);
}

/**
 * Forget the token (disconnect, deauthorize, a deletion request, or `lost`: Instagram
 * rejected it, with the reason to show and to email the leads). The handle stays as plain text.
 */
export async function removeConnection(db: Db, where: { areaId: string } | { igUserId: string }, lost?: string): Promise<string[]> {
  // Meta names the account by one of its two ids depending on the callback; match either.
  if ("igUserId" in where && !/^\d{1,40}$/.test(where.igUserId)) throw new Error("Not an Instagram user id");
  const q = db.from("instagram_accounts").delete().select("area_id");
  const { data, error } = "areaId" in where ? await q.eq("area_id", where.areaId) : await q.or(`ig_user_id.eq.${where.igUserId},app_scoped_id.eq.${where.igUserId}`);
  if (error) throw new Error(error.message);
  const areaIds = ((data ?? []) as { area_id: string }[]).map((r) => r.area_id);
  if (areaIds.length) {
    await db.from("areas").update({
      instagram_user_id: null, instagram_connected_at: null,
      ...(lost ? { instagram_lost_at: new Date().toISOString(), instagram_lost_reason: lost, instagram_lost_notified_at: null } : {}),
    }).in("id", areaIds);
  }
  return areaIds;
}
