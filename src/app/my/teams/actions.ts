"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { error: string };
const done = (): Result => { for (const p of ["/my/teams", "/review/requests", "/review", "/admin"]) revalidatePath(p); return { ok: true }; };
const friendly = (code: string | undefined, message: string) => (code === "23505" ? "You already have a request waiting for this." : message);

/** Ask to join an existing team; the team's leads decide. */
export async function applyToJoin(form: FormData): Promise<Result> {
  const v = await requireUser("/my/teams");
  const areaId = String(form.get("area_id") ?? "");
  const note = String(form.get("note") ?? "").trim() || null;
  if (!areaId) return { error: "Pick a team." };
  const supabase = await createClient();
  const { error } = await supabase.from("team_applications").insert({ user_id: v.userId, kind: "join", area_id: areaId, note });
  return error ? { error: friendly(error.code, error.message) } : done();
}

/** Ask to start a new team and lead it; admins decide. */
export async function applyToStart(form: FormData): Promise<Result> {
  const v = await requireUser("/my/teams");
  const team_name = String(form.get("team_name") ?? "").trim();
  const language = String(form.get("language") ?? "").trim();
  const region = String(form.get("region") ?? "").trim() || null;
  const instagram_handle = String(form.get("instagram_handle") ?? "").trim().replace(/^@/, "") || null;
  const note = String(form.get("note") ?? "").trim() || null;
  if (!team_name || !language) return { error: "A team name and a language are required." };
  const supabase = await createClient();
  const { error } = await supabase.from("team_applications").insert({ user_id: v.userId, kind: "start", team_name, language, region, instagram_handle, note });
  return error ? { error: friendly(error.code, error.message) } : done();
}

export async function withdrawApplication(id: string): Promise<Result> {
  const v = await requireUser("/my/teams");
  const supabase = await createClient();
  const { error } = await supabase.from("team_applications").delete().eq("id", id).eq("user_id", v.userId);
  return error ? { error: error.message } : done();
}

export async function leaveTeam(areaId: string): Promise<Result> {
  const v = await requireUser("/my/teams");
  const supabase = await createClient();
  const { error } = await supabase.from("area_members").delete().eq("area_id", areaId).eq("user_id", v.userId);
  return error ? { error: error.message } : done();
}
