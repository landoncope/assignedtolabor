import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

export type Viewer = {
  userId: string;
  email: string | null;
  isAnonymous: boolean;
  profile: Profile;
  managedAreaIds: string[];
  isAdmin: boolean;
  isManager: boolean;
};

/** The signed-in viewer (including anonymous quick-upload sessions), or null. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data: profile }, { data: managed }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("area_managers").select("area_id").eq("user_id", user.id),
  ]);
  if (!profile) return null;
  const p = profile as Profile;
  const managedAreaIds = (managed ?? []).map((m: { area_id: string }) => m.area_id);
  return {
    userId: user.id,
    email: user.email ?? null,
    isAnonymous: Boolean(user.is_anonymous),
    profile: p,
    managedAreaIds,
    isAdmin: p.role === "admin",
    isManager: p.role === "admin" || managedAreaIds.length > 0,
  };
});

/** A real (non-anonymous) signed-in viewer, or redirect to login. */
export async function requireUser(next: string): Promise<Viewer> {
  const v = await getViewer();
  if (!v || v.isAnonymous) redirect(`/login?next=${encodeURIComponent(next)}`);
  return v;
}

export async function requireManager(next: string): Promise<Viewer> {
  const v = await requireUser(next);
  if (!v.isManager) redirect("/my?denied=review");
  return v;
}

export async function requireAdmin(next: string): Promise<Viewer> {
  const v = await requireUser(next);
  if (!v.isAdmin) redirect("/my?denied=admin");
  return v;
}
