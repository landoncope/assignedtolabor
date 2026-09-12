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
  created_at: string;
};

export type VideoWithArea = Video & { area: Pick<Area, "id" | "name" | "language" | "instagram_handle"> | null };

export function areaLabel(a: Pick<Area, "name" | "language"> | null | undefined): string {
  if (!a) return "Unassigned";
  return a.name === a.language ? a.name : `${a.name} · ${a.language}`;
}

export const STATUS_LABEL: Record<VideoStatus, string> = {
  pending: "Awaiting review",
  approved: "Approved, ready to post",
  rejected: "Not selected",
  posted: "Posted",
};
