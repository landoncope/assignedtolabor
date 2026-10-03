import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing for links in our auth emails. The templates embed a token hash instead of
 * the default PKCE code so the link works on any device, not only the one that asked
 * for it (people read email on a laptop after uploading from a phone).
 *   /auth/confirm?token_hash=...&type=magiclink|signup|email|email_change|recovery&next=/my
 *
 * The links work once and for a limited time, and people tap them twice or come back
 * a day later (the team lead application's "part 2" email invites exactly that). So a
 * dead link is not a dead end: someone already signed in on this device simply
 * continues, and anyone else is sent to sign in and lands where the link was going.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextParam = searchParams.get("next") ?? "/my";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/my";
  const toLogin = (message: string) => NextResponse.redirect(`${origin}/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent(message)}`);

  if (!token_hash || !type) return toLogin("This link is missing its code. Sign in below to continue.");
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash, type });
  if (error) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && !user.is_anonymous) return NextResponse.redirect(`${origin}${next}`);
    return toLogin("This link has expired or was already used. Sign in below and you will pick up where you left off.");
  }
  return NextResponse.redirect(`${origin}${next}`);
}
