import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing for links in our auth emails. The templates embed a token hash instead of
 * the default PKCE code so the link works on any device, not only the one that asked
 * for it (people read email on a laptop after uploading from a phone).
 *   /auth/confirm?token_hash=...&type=magiclink|email|email_change|recovery&next=/my
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextParam = searchParams.get("next") ?? "/my";
  const next = nextParam.startsWith("/") ? nextParam : "/my";

  if (!token_hash || !type) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("This link is missing its code. Please request a new one.")}`);
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash, type });
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("This link has expired or was already used. Please request a new one.")}`);
  }
  return NextResponse.redirect(`${origin}${next}`);
}
