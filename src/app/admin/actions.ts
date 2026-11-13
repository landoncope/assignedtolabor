"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cleanSlug, resolveFormUrl, slugProblem } from "@/lib/team-page";

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
  // The team's page on this site (assignedtolabor.org/<slug>) and the form it shows.
  const slug = cleanSlug(String(form.get("slug") ?? "")) || null;
  const formRaw = String(form.get("referral_form_url") ?? "").trim();
  if (slug) { const problem = slugProblem(slug); if (problem) return { error: problem }; }
  if (formRaw && !slug) return { error: "Give the team a page address for its form." };
  const supabase = await createClient();
  const { data: before } = await supabase.from("areas").select("referral_form_url").eq("id", id).maybeSingle();
  const stored = (before as { referral_form_url: string | null } | null)?.referral_form_url ?? null;
  // Only a changed link is followed again (the stored one is already in its long form).
  let formFields: { referral_form_url: string | null; referral_form_title: string | null } | Record<string, never> = {};
  if (!formRaw) formFields = { referral_form_url: null, referral_form_title: null };
  else if (formRaw !== stored) {
    const resolved = await resolveFormUrl(formRaw);
    if ("error" in resolved) return { error: resolved.error };
    formFields = { referral_form_url: resolved.url, referral_form_title: resolved.title };
  }
  const { error } = await supabase.from("areas").update({ name, language, instagram_handle: instagram, is_active, slug, ...formFields }).eq("id", id);
  if (error) return { error: error.code === "23505" ? `Another team already has the page address "${slug}".` : error.message };
  if (slug) revalidatePath(`/${slug}`);
  return done();
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

export async function removeMember(areaId: string, userId: string): Promise<Result> {
  await requireAdmin("/admin");
  const supabase = await createClient();
  const { error } = await supabase.from("area_members").delete().eq("area_id", areaId).eq("user_id", userId);
  return error ? { error: error.message } : done();
}

export async function setRole(userId: string, role: "member" | "admin"): Promise<Result> {
  const admin = await requireAdmin("/admin");
  if (userId === admin.userId && role !== "admin") return { error: "You can't remove your own admin role." };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
  return error ? { error: error.message } : done();
}
