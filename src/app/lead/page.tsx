import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import type { LeadApplication } from "@/lib/lead";
import { createClient } from "@/lib/supabase/server";
import type { AreaSummary } from "@/lib/types";
import LeadApply from "./LeadApply";

export const metadata: Metadata = {
  title: "Lead a team",
  description: "Apply to lead an Assigned To Labor team: tell us about you, then record a short video.",
};

export type LeadApplicationWithArea = LeadApplication & { area: AreaSummary | null };

/**
 * The team lead application, part 1 (Travis, 2026-10-03). Open to anyone: no account
 * is needed to start, and finishing part 1 is what creates one (the "part 2" email).
 * Someone who is already signed in sees where their application stands instead.
 */
export default async function LeadPage({ searchParams }: PageProps<"/lead">) {
  const sp = await searchParams;
  const editing = sp.edit === "1";
  const viewer = await getViewer();
  const real = !!viewer && !viewer.isAnonymous;
  let application: LeadApplicationWithArea | null = null;
  if (real) {
    const supabase = await createClient();
    // Attaches an application that is waiting on this account's address, if there is one.
    const { data: id } = await supabase.rpc("lead_claim");
    if (id) {
      const { data } = await supabase.from("lead_applications").select("*, area:areas(id, name, language, instagram_handle)").eq("id", id as string).maybeSingle();
      application = (data as unknown as LeadApplicationWithArea | null) ?? null;
    }
  }
  if (application?.status === "started" && !editing) redirect("/lead/video");
  return <LeadApply accountEmail={real ? viewer.email : null} accountName={real ? viewer.profile.display_name : null} application={application} editing={editing && application?.status === "started"} />;
}
