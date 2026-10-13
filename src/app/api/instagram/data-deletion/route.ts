import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/email";
import { parseSignedRequest } from "@/lib/instagram";
import { removeConnection } from "@/lib/instagram-publish";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Meta's data deletion request callback. The only data we hold for an Instagram
 * account is its token and ids, so deletion is immediate. Meta expects a status URL
 * and a confirmation code in the reply.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const signed = form?.get("signed_request");
  if (typeof signed !== "string") return NextResponse.json({ error: "signed_request missing" }, { status: 400 });
  try {
    const { user_id } = parseSignedRequest(signed);
    if (!user_id) return NextResponse.json({ error: "no user_id" }, { status: 400 });
    const areas = await removeConnection(createAdminClient(), { igUserId: user_id });
    const code = `atl-${randomBytes(6).toString("hex")}`;
    console.log(`[instagram] data deletion for ${user_id} (${code}): ${areas.length} team(s) disconnected`);
    return NextResponse.json({ url: `${siteUrl}/privacy`, confirmation_code: code });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "bad request" }, { status: 400 });
  }
}
