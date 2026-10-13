import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth";
import { authorizeUrl, CONNECT_STATE_COOKIE, instagramConfigured, withNotice } from "@/lib/instagram";

/**
 * Start connecting a team's Instagram account: a lead of the team (or an admin), logged
 * in to that Instagram account in this browser, is sent to Instagram to authorize the
 * app. A nonce in a short-lived cookie ties the callback to this request and this team.
 */
export async function GET(req: NextRequest) {
  const areaId = req.nextUrl.searchParams.get("area") ?? "";
  const back = safeBack(req.nextUrl.searchParams.get("back"));
  const viewer = await getViewer();
  if (!viewer || viewer.isAnonymous) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(`/api/instagram/connect?area=${areaId}&back=${encodeURIComponent(back)}`)}`, req.url));
  }
  if (!areaId || !(viewer.isAdmin || viewer.managedAreaIds.includes(areaId))) {
    return NextResponse.redirect(new URL(withNotice(back, "instagram_error", "You don't lead that team."), req.url));
  }
  if (!instagramConfigured()) {
    return NextResponse.redirect(new URL(withNotice(back, "instagram_error", "Instagram posting is not set up on this site yet."), req.url));
  }
  const nonce = randomBytes(16).toString("base64url");
  const res = NextResponse.redirect(authorizeUrl(`${nonce}.${areaId}`));
  res.cookies.set(CONNECT_STATE_COOKIE, JSON.stringify({ nonce, areaId, back }), {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/instagram", maxAge: 600,
  });
  return res;
}

/** Only our own pages, never another site. */
export function safeBack(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/review";
}
