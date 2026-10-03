import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Area } from "@/lib/types";
import TeamsClient, { type ApplicationWithArea, type Membership } from "./TeamsClient";

export const metadata: Metadata = { title: "Teams" };

/** The member's own team space: teams they are on, requests they sent, and the two application forms. */
export default async function TeamsPage() {
  const viewer = await requireUser("/my/teams");
  const supabase = await createClient();
  const [{ data: areas }, { data: memberships }, { data: apps }] = await Promise.all([
    supabase.from("areas").select("*").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("area_members").select("area_id, created_at, area:areas(id, name, language, instagram_handle)").eq("user_id", viewer.userId),
    supabase.from("team_applications").select("*, area:areas(id, name, language, instagram_handle)").eq("user_id", viewer.userId).order("created_at", { ascending: false }),
  ]);
  return (
    <>
      <Nav current="teams" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="text-2xl font-bold">Teams</h1>
        <p className="mt-1 text-sm text-muted">A team shares videos with people who speak one language in one part of the world. Join one so your videos go straight to its lead, or start one and lead it yourself.</p>
        <Link href="/lead" className="card mt-4 flex items-center justify-between gap-3 hover:border-accent">
          <span className="text-sm"><b>Want to lead a team?</b> The team lead application is a few questions and a short video.</span>
          <span className="shrink-0 text-sm text-accent">Apply ›</span>
        </Link>
        <TeamsClient
          areas={(areas ?? []) as Area[]}
          memberships={(memberships ?? []) as unknown as Membership[]}
          leadAreaIds={viewer.managedAreaIds}
          applications={(apps ?? []) as unknown as ApplicationWithArea[]}
        />
      </main>
    </>
  );
}
