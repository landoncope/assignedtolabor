import type { CaptureMeta } from "@/lib/capture-meta";

/**
 * A team lead application (Travis, 2026-10-03). Part 1 is a form anyone can fill
 * without an account; an email then carries part 2, a short video, and its link is
 * what creates the account. Rules live in the database: see
 * supabase/migrations/20261003120000_lead_applications.sql.
 *   started   part 1 is in; waiting for the video
 *   submitted the video is in; waiting for an admin
 *   approved  the applicant is a lead of `area_id`
 *   declined
 */
export type LeadStatus = "started" | "submitted" | "approved" | "declined";

export type LeadApplication = {
  id: string;
  email: string;
  user_id: string | null;
  started_by: string | null;
  full_name: string;
  phone: string;
  language: string;
  audience: string;
  why: string;
  status: LeadStatus;
  video_path: string | null;
  video_mime: string | null;
  video_size: number | null;
  video_seconds: number | null;
  video_thumbnail: string | null;
  capture_meta: CaptureMeta | null;
  submitted_at: string | null;
  video_purged_at: string | null;
  area_id: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  part2_emails: number;
  part2_emailed_at: string | null;
  admins_notified_at: string | null;
  outcome_notified_at: string | null;
  created_at: string;
  updated_at: string;
};

/** What part 1 asks for. `email` is ignored when the applicant is signed in. */
export type LeadFields = { email: string; fullName: string; phone: string; language: string; audience: string; why: string };

export const EMPTY_LEAD_FIELDS: LeadFields = { email: "", fullName: "", phone: "", language: "", audience: "", why: "" };

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  started: "Waiting for your video",
  submitted: "Waiting for a decision",
  approved: "Approved",
  declined: "Not this time",
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^[+0-9 ().-]{7,32}$/;

/** The first problem with the form, in words for the applicant, or null. The database checks the same things. */
export function validateLeadFields(f: LeadFields, needEmail: boolean): string | null {
  if (f.fullName.trim().length < 2) return "Please enter your name.";
  if (needEmail && !EMAIL.test(f.email.trim())) return "Please enter a valid email address.";
  if (!PHONE.test(f.phone.trim()) || f.phone.replace(/\D/g, "").length < 7) return "Please enter a phone number we can reach you at.";
  if (f.language.trim().length < 2) return "Please enter the language your channel will speak.";
  if (f.audience.trim().length < 2) return "Please tell us the audience or location you want to reach.";
  if (f.why.trim().length < 2) return "Please tell us why you would like to lead a team.";
  if (f.fullName.length > 120 || f.language.length > 60 || f.audience.length > 300 || f.why.length > 3000) return "One of your answers is too long. Please shorten it.";
  return null;
}
