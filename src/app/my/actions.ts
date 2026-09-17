"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true; count: number } | { error: string };

/** Move videos an anonymous session uploaded with this account's email address into the account. */
export async function claimUploads(): Promise<Result> {
  await requireUser("/my");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_uploads");
  if (error) return { error: error.message };
  revalidatePath("/my");
  return { ok: true, count: Number(data ?? 0) };
}

export async function declineUploads(): Promise<Result> {
  await requireUser("/my");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decline_uploads");
  if (error) return { error: error.message };
  revalidatePath("/my");
  return { ok: true, count: Number(data ?? 0) };
}
