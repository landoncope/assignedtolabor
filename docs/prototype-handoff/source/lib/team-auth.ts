import { createClient } from "@/lib/supabase/server";

/**
 * Verifies the current user may manage `channelId` (admin, assigned leader, or
 * active manager — enforced by the `can_manage_channel` SQL function) and
 * returns the authenticated client for the privileged writes. The writes are
 * additionally gated by manager RLS policies, so no service-role key is needed.
 *
 * Returns `{ ok: false, error, status }` on failure, or `{ ok: true, supabase, userId }`.
 */
export async function authorizeChannelManager(channelId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Unauthorized", status: 401 };

  const { data: canManage, error: rpcErr } = await supabase.rpc("can_manage_channel", { cid: channelId });
  if (rpcErr) return { ok: false as const, error: rpcErr.message, status: 500 };
  if (!canManage) return { ok: false as const, error: "Forbidden", status: 403 };

  return { ok: true as const, supabase, userId: user.id };
}
