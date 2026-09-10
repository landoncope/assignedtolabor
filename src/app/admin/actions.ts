"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { error: string };
const done = (): Result => { revalidatePath("/admin"); return { ok: true }; };

export async function createArea(form: FormData): Promise<Result> {
  await requireAdmin("/admin");
  const name = String(form.get("name") ?? "").trim();
  const language = String(form.get("language") ?? "").trim();
  const instagram = String(form.get("instagram_handle") ?? "").trim().replace(/^@/, "") || null;
  if (!name || !language) return { error: "Name and language are required." };
  const supabase = await createClient();
  const { error } = await supabase.from("areas").insert({ name, language, instagram_handle: instagram });
  return error ? { error: error.message } : done();
}

export async function updateArea(id: string, form: FormData): Promise<Result> {
  await requireAdmin("/admin");
  const name = String(form.get("name") ?? "").trim();
  const language = String(form.get("language") ?? "").trim();
  const instagram = String(form.get("instagram_handle") ?? "").trim().replace(/^@/, "") || null;
  const is_active = form.get("is_active") === "on";
  if (!name || !language) return { error: "Name and language are required." };
  const supabase = await createClient();
  const { error } = await supabase.from("areas").update({ name, language, instagram_handle: instagram, is_active }).eq("id", id);
  return error ? { error: error.message } : done();
}

/** Adds a manager by email. If they have never signed in, an invite is stored and applied on first sign-in. */
export async function addManager(areaId: string, emailRaw: string): Promise<Result> {
  await requireAdmin("/admin");
  const email = emailRaw.trim().toLowerCase();
  if (!email.includes("@")) return { error: "Enter an email address." };
  const supabase = await createClient();
  const { data: profile } = await supabase.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (profile) {
    const { error } = await supabase.from("area_managers").upsert({ area_id: areaId, user_id: profile.id });
    return error ? { error: error.message } : done();
  }
  const { error } = await supabase.from("manager_invites").upsert({ area_id: areaId, email });
  return error ? { error: error.message } : done();
}

export async function removeManager(areaId: string, userId: string): Promise<Result> {
  await requireAdmin("/admin");
  const supabase = await createClient();
  const { error } = await supabase.from("area_managers").delete().eq("area_id", areaId).eq("user_id", userId);
  return error ? { error: error.message } : done();
}

export async function removeInvite(areaId: string, email: string): Promise<Result> {
  await requireAdmin("/admin");
  const supabase = await createClient();
  const { error } = await supabase.from("manager_invites").delete().eq("area_id", areaId).eq("email", email);
  return error ? { error: error.message } : done();
}

export async function setRole(userId: string, role: "member" | "admin"): Promise<Result> {
  const admin = await requireAdmin("/admin");
  if (userId === admin.userId && role !== "admin") return { error: "You can't remove your own admin role." };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  return error ? { error: error.message } : done();
}
