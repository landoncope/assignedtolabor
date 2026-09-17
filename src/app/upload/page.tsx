import type { Metadata } from "next";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Area, AreaSummary } from "@/lib/types";
import UploadFlow from "./UploadFlow";

export const metadata: Metadata = { title: "Record a video" };

export default async function UploadPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("areas")
    .select("id, name, language, instagram_handle, is_active, sort_order, created_at")
    .eq("is_active", true)
    .order("sort_order")
    .order("name");
  const areas = (data ?? []) as Area[];
  // Signed-in members (and leads) can send a video straight to one of their teams.
  const viewer = await getViewer();
  const myTeams: AreaSummary[] = [];
  if (viewer && !viewer.isAnonymous) {
    const { data: mem } = await supabase.from("area_members").select("area:areas(id, name, language, instagram_handle)").eq("user_id", viewer.userId);
    const seen = new Set<string>();
    for (const m of (mem ?? []) as unknown as { area: AreaSummary | null }[]) {
      if (m.area && !seen.has(m.area.id)) { seen.add(m.area.id); myTeams.push(m.area); }
    }
    for (const a of areas) if (viewer.managedAreaIds.includes(a.id) && !seen.has(a.id)) { seen.add(a.id); myTeams.push(a); }
  }
  return <UploadFlow areas={areas} myTeams={myTeams} signedIn={!!viewer && !viewer.isAnonymous} />;
}
