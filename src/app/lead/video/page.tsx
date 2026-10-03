import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import type { LeadApplication } from "@/lib/lead";
import { createClient } from "@/lib/supabase/server";
import LeadVideo from "./LeadVideo";

export const metadata: Metadata = { title: "Lead a team: your video" };

/**
 * Part 2 of the team lead application: a short video on why the applicant would like
 * to lead. The "part 2" email lands here through /auth/confirm, signed in. Arriving
 * with a real account is what attaches the application to it (`lead_claim` matches
 * the account's confirmed address), whichever way the person signed in.
 */
export default async function LeadVideoPage() {
  const viewer = await requireUser("/lead/video");
  const supabase = await createClient();
  const { data: id } = await supabase.rpc("lead_claim");
  if (!id) redirect("/lead");
  const { data } = await supabase.from("lead_applications").select("*").eq("id", id as string).maybeSingle();
  const application = data as LeadApplication | null;
  // Anything but "waiting for the video" is shown on /lead (submitted, approved, declined).
  if (!application || application.status !== "started") redirect("/lead");
  return <LeadVideo application={application} userId={viewer.userId} />;
}
