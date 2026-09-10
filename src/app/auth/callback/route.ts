import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** OAuth and magic-link landing: exchanges the code for a session cookie. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/my";
  const next = nextParam.startsWith("/") ? nextParam : "/my";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }
  const desc = searchParams.get("error_description") ?? "Sign-in link is invalid or expired.";
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(desc)}`);
}
