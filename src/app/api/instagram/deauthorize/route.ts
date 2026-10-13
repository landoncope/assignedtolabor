import { NextResponse, type NextRequest } from "next/server";
import { parseSignedRequest } from "@/lib/instagram";
import { removeConnection } from "@/lib/instagram-publish";
import { createAdminClient } from "@/lib/supabase/admin";

/** Meta calls this when an account removes the app: forget its token. */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const signed = form?.get("signed_request");
  if (typeof signed !== "string") return NextResponse.json({ error: "signed_request missing" }, { status: 400 });
  try {
    const { user_id } = parseSignedRequest(signed);
    if (!user_id) return NextResponse.json({ error: "no user_id" }, { status: 400 });
    const areas = await removeConnection(createAdminClient(), { igUserId: user_id });
    console.log(`[instagram] deauthorized ${user_id}: ${areas.length} team(s) disconnected`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "bad request" }, { status: 400 });
  }
}
