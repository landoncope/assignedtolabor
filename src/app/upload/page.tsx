import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import type { Area } from "@/lib/types";
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
  return <UploadFlow areas={(data ?? []) as Area[]} />;
}
