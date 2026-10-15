import { NextResponse, type NextRequest } from "next/server";
import { captionsConfigured, sweepCaptions } from "@/lib/captions";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Caption sweep (Vercel cron, every 2 minutes, bearer CRON_SECRET): transcribes a few
 * waiting videos and drafts their captions (src/lib/captions.ts). Does nothing until
 * ELEVENLABS_API_KEY and ANTHROPIC_API_KEY are set. `?dry=1` reports what it would do;
 * `?only=<id>,<id>` limits the sweep to those videos (tests; re-running one by hand).
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  if (!captionsConfigured()) return NextResponse.json({ dry, configured: false, results: [] });
  const db = createAdminClient();
  const failures: string[] = [];
  let results: Awaited<ReturnType<typeof sweepCaptions>> = [];
  const only = (request.nextUrl.searchParams.get("only") ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/.test(s));
  try { results = await sweepCaptions(db, dry, only.length ? { only } : {}); } catch (e) { failures.push(`sweep: ${e instanceof Error ? e.message : String(e)}`); }
  return NextResponse.json({ dry, configured: true, results, failures });
}
