import { NextResponse, type NextRequest } from "next/server";
import { refreshExpiringTokens, sweepPublishing } from "@/lib/instagram-publish";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Publishing sweep (Vercel cron, every 2 minutes, bearer CRON_SECRET): finishes posts
 * whose lead left the page, and refreshes Instagram tokens before they expire.
 * `?dry=1` reports what it would do.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  const db = createAdminClient();
  const failures: string[] = [];
  let posts: Awaited<ReturnType<typeof sweepPublishing>> = [];
  let tokens: Awaited<ReturnType<typeof refreshExpiringTokens>> = [];
  try { posts = await sweepPublishing(db, dry); } catch (e) { failures.push(`sweep: ${e instanceof Error ? e.message : String(e)}`); }
  try { tokens = await refreshExpiringTokens(db, dry); } catch (e) { failures.push(`tokens: ${e instanceof Error ? e.message : String(e)}`); }
  return NextResponse.json({ dry, posts, tokens, failures });
}
