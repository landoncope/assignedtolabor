import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth";
import { CONNECT_STATE_COOKIE, describeError, exchangeCode, INSTAGRAM_SCOPES, longLivedToken, me, withNotice } from "@/lib/instagram";
import { saveConnection } from "@/lib/instagram-publish";
import { createAdminClient } from "@/lib/supabase/admin";

type Saved = { nonce: string; areaId: string; back: string };

/**
 * Instagram sends the lead back here with a code. We check the nonce, trade the code
 * for a long-lived token, look up the account, and store the token for the team.
 * The registered redirect URL in the Meta app must be exactly this route on the site.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  let saved: Saved | null = null;
  try { saved = JSON.parse(req.cookies.get(CONNECT_STATE_COOKIE)?.value ?? "null") as Saved | null; } catch { saved = null; }
  const back = saved?.back && saved.back.startsWith("/") && !saved.back.startsWith("//") ? saved.back : "/review";
  const leave = (path: string) => {
    const res = NextResponse.redirect(new URL(path, req.url));
    res.cookies.set(CONNECT_STATE_COOKIE, "", { path: "/api/instagram", maxAge: 0 });
    return res;
  };

  if (sp.get("error")) {
    return leave(withNotice(back, "instagram_error", sp.get("error_description") ?? sp.get("error_reason") ?? "Instagram login was cancelled."));
  }
  const code = sp.get("code");
  const state = sp.get("state") ?? "";
  if (!code || !saved || state !== `${saved.nonce}.${saved.areaId}`) {
    return leave(withNotice(back, "instagram_error", "That login link is stale. Tap Connect again."));
  }
  const viewer = await getViewer();
  if (!viewer || viewer.isAnonymous || !(viewer.isAdmin || viewer.managedAreaIds.includes(saved.areaId))) {
    return leave(withNotice(back, "instagram_error", "Sign in to the site first, then tap Connect again."));
  }
  try {
    const short = await exchangeCode(code);
    const granted = short.permissions;
    const missing = granted.length ? INSTAGRAM_SCOPES.filter((s) => !granted.includes(s)) : [];
    if (missing.length) {
      return leave(withNotice(back, "instagram_error", `Instagram did not grant ${missing.join(" and ")}. Connect again and allow everything it asks for.`));
    }
    const token = await longLivedToken(short.accessToken);
    const profile = await me(token.accessToken);
    await saveConnection(createAdminClient(), saved.areaId, viewer.userId, profile, token, granted.length ? granted : [...INSTAGRAM_SCOPES]);
    return leave(withNotice(back, "instagram_connected", profile.username ?? profile.userId));
  } catch (e) {
    console.error(`[instagram] connect failed for area ${saved.areaId}: ${describeError(e)}`);
    return leave(withNotice(back, "instagram_error", describeError(e)));
  }
}
