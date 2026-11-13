import { createAdminClient } from "@/lib/supabase/admin";
import { looksLikeBot, SLUG_PATTERN } from "@/lib/team-page";

const done = () => new Response(null, { status: 204 });

/**
 * A team's page reports that someone opened it (src/app/[team]/TeamForm.tsx). Counted per
 * team per day and nothing else: no address, no visitor. Only the page itself may report
 * (same origin), and link previews and crawlers are left out.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  let sameOrigin = false;
  try { sameOrigin = !!origin && !!host && new URL(origin).host === host; } catch { /* not ours */ }
  if (!sameOrigin || looksLikeBot(request.headers.get("user-agent"))) return done();
  const body = (await request.json().catch(() => null)) as { slug?: unknown } | null;
  const slug = typeof body?.slug === "string" ? body.slug.toLowerCase() : "";
  if (!SLUG_PATTERN.test(slug)) return done();
  const db = createAdminClient();
  const { data } = await db.from("areas").select("id").eq("slug", slug).eq("is_active", true).not("referral_form_url", "is", null).maybeSingle();
  if (data) await db.rpc("bump_team_page", { aid: (data as { id: string }).id });
  return done();
}
