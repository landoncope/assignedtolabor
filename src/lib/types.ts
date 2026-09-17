export type Role = "member" | "admin";
export type VideoStatus = "pending" | "approved" | "rejected" | "posted";

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: Role;
  is_anonymous: boolean;
  created_at: string;
};

export type Area = {
  id: string;
  name: string;
  language: string;
  instagram_handle: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
};

import type { CaptureMeta } from "@/lib/capture-meta";

export type Script = { hook: string | null; body: string | null; cta: string | null };

export type Video = {
  id: string;
  user_id: string;
  area_id: string | null;
  language: string | null;
  storage_path: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  duration_seconds: number | null;
  thumbnail: string | null;
  script: Script | null;
  uploader_name: string | null;
  uploader_note: string | null;
  status: VideoStatus;
  rejection_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  posted_by: string | null;
  posted_at: string | null;
  post_url: string | null;
  file_purged_at: string | null;
  capture_meta: CaptureMeta | null;
  created_at: string;
};

export type AreaSummary = Pick<Area, "id" | "name" | "language" | "instagram_handle">;
export type VideoWithArea = Video & { area: AreaSummary | null };

export type ApplicationKind = "start" | "join";
export type ApplicationStatus = "pending" | "approved" | "declined";
/** A request to join a team (kind join) or to start one and lead it (kind start). */
export type TeamApplication = {
  id: string;
  user_id: string;
  kind: ApplicationKind;
  area_id: string | null;
  team_name: string | null;
  language: string | null;
  region: string | null;
  instagram_handle: string | null;
  note: string | null;
  /** Join requests only: the applicant would like to lead the team (an admin decides). */
  wants_lead: boolean;
  status: ApplicationStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  notified_at: string | null;
  outcome_notified_at: string | null;
  created_at: string;
};
export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = { pending: "Waiting for a decision", approved: "Approved", declined: "Declined" };

export function areaLabel(a: Pick<Area, "name" | "language"> | null | undefined): string {
  if (!a) return "No team";
  return a.name === a.language ? a.name : `${a.name} · ${a.language}`;
}

export const STATUS_LABEL: Record<VideoStatus, string> = {
  pending: "Awaiting review",
  approved: "Approved, ready to post",
  rejected: "Not selected",
  posted: "Posted",
};
