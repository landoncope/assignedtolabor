import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import RequestsClient, { type Request } from "./RequestsClient";

export const metadata: Metadata = { title: "Team requests" };

/** Pending team applications the viewer may decide: join requests for the teams they lead; for admins also proposals for new teams. */
export default async function RequestsPage() {
  const viewer = await requireManager("/review/requests");
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_applications")
    .select("*, area:areas(id, name, language, instagram_handle), profile:profiles!team_applications_user_id_fkey(id, email, display_name)")
    .eq("status", "pending")
    .order("created_at");
  // RLS also returns the viewer's own requests; only show what they can decide.
  const requests = ((data ?? []) as unknown as Request[]).filter((r) =>
    viewer.isAdmin || (r.kind === "join" && !!r.area_id && viewer.managedAreaIds.includes(r.area_id)),
  );
  return (
    <>
      <Nav current="review" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <Link href="/review" className="text-sm text-muted hover:text-foreground">‹ Back to review</Link>
        <h1 className="mt-4 text-2xl font-bold">Team requests</h1>
        <p className="mt-1 text-sm text-muted">{viewer.isAdmin ? "People asking to join a team, and proposals for new teams. Only admins can add someone as a lead." : "People asking to join the teams you lead. Ask an admin to add someone as a lead."}</p>
        <RequestsClient requests={requests} isAdmin={viewer.isAdmin} />
      </main>
    </>
  );
}
