import { NextResponse, type NextRequest } from "next/server";
import { refreshExpiringTokens, sweepPublishing } from "@/lib/instagram-publish";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Publishing sweep (Vercel cron, every 2 minutes, bearer CRON_SECRET): finishes posts
 * whose lead left the page, and refreshes Instagram tokens before they expire.
 * `?dry=1` reports what it would do. A scoped run, `?only=<video id>,<id>&area=<team id>`,
 * touches only those posts and that team's token: for tests on a local build, which reads
 * the LIVE database, where real posts may be in flight (any `only` or `area` makes the
 * run scoped; a missing half of it then means "none").
 */
const UUID = /^[0-9a-f-]{36}$/;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = request.nextUrl.searchParams;
  const dry = q.get("dry") === "1";
  const scoped = q.has("only") || q.has("area");
  const only = (q.get("only") ?? "").split(",").map((s) => s.trim()).filter((s) => UUID.test(s));
  const area = (q.get("area") ?? "").trim();
  const db = createAdminClient();
  const failures: string[] = [];
  let posts: Awaited<ReturnType<typeof sweepPublishing>> = [];
  let tokens: Awaited<ReturnType<typeof refreshExpiringTokens>> = [];
  try { posts = await sweepPublishing(db, dry, scoped ? only : null); } catch (e) { failures.push(`sweep: ${e instanceof Error ? e.message : String(e)}`); }
  try { tokens = await refreshExpiringTokens(db, dry, scoped ? (UUID.test(area) ? [area] : []) : null); } catch (e) { failures.push(`tokens: ${e instanceof Error ? e.message : String(e)}`); }
  return NextResponse.json({ dry, posts, tokens, failures });
}
