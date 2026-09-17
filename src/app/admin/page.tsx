import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import { requireAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Area, Profile } from "@/lib/types";
import AreasAdmin, { type AreaWithManagers } from "./AreasAdmin";
import UsersAdmin from "./UsersAdmin";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const viewer = await requireAdmin("/admin");
  const supabase = await createClient();
  const [{ data: areas }, { data: managers }, { data: invites }, { data: members }, { count: requestCount }, { data: users }] = await Promise.all([
    supabase.from("areas").select("*").order("sort_order").order("name"),
    supabase.from("area_managers").select("area_id, user_id, profile:profiles(id, email, display_name)"),
    supabase.from("manager_invites").select("area_id, email"),
    supabase.from("area_members").select("area_id, user_id, profile:profiles(id, email, display_name)"),
    supabase.from("team_applications").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("profiles").select("*").eq("is_anonymous", false).order("created_at", { ascending: false }).limit(500),
  ]);

  type ManagerRow = { area_id: string; user_id: string; profile: { id: string; email: string | null; display_name: string | null } | null };
  const withManagers: AreaWithManagers[] = ((areas ?? []) as Area[]).map((a) => ({
    ...a,
    managers: ((managers ?? []) as unknown as ManagerRow[]).filter((m) => m.area_id === a.id).map((m) => ({ id: m.user_id, email: m.profile?.email ?? null, display_name: m.profile?.display_name ?? null })),
    invites: ((invites ?? []) as { area_id: string; email: string }[]).filter((i) => i.area_id === a.id).map((i) => i.email),
    members: ((members ?? []) as unknown as ManagerRow[]).filter((m) => m.area_id === a.id).map((m) => ({ id: m.user_id, email: m.profile?.email ?? null, display_name: m.profile?.display_name ?? null })),
  }));

  return (
    <>
      <Nav current="admin" />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold">Admin</h1>
        <Link href="/review/requests" className={`mt-3 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${requestCount ? "border-gold/50 bg-gold/10 font-semibold" : "border-line text-muted hover:text-foreground"}`}>
          {requestCount ? `${requestCount} team ${requestCount === 1 ? "request is" : "requests are"} waiting` : "Team requests"} ›
        </Link>
        <section className="mt-6">
          <h2 className="text-lg font-semibold">Teams and leads</h2>
          <p className="mt-1 text-sm text-muted">A team is a place plus a language. Leads review everything sent to their team and approve people who ask to join it. Add a lead by email; if they haven&apos;t signed in yet, it takes effect the first time they do.</p>
          <AreasAdmin areas={withManagers} />
        </section>
        <section className="mt-10">
          <h2 className="text-lg font-semibold">People</h2>
          <p className="mt-1 text-sm text-muted">Everyone who has signed in with an account. Admins can do everything.</p>
          <UsersAdmin users={(users ?? []) as Profile[]} selfId={viewer.userId} />
        </section>
      </main>
    </>
  );
}
