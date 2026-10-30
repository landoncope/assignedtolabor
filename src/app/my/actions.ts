"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { escapeHtml as esc, sendEmail, siteUrl } from "@/lib/email";
import { daysAgo, formatDay, goalDef, isUploadGoal, type UploadGoal } from "@/lib/goals";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { areaLabel } from "@/lib/types";

type Result = { ok: true; count: number } | { error: string };
type Done = { ok: true } | { error: string };

/** Move videos an anonymous session uploaded with this account's email address into the account. */
export async function claimUploads(): Promise<Result> {
  await requireUser("/my");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_uploads");
  if (error) return { error: error.message };
  revalidatePath("/my");
  return { ok: true, count: Number(data ?? 0) };
}

export async function declineUploads(): Promise<Result> {
  await requireUser("/my");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decline_uploads");
  if (error) return { error: error.message };
  revalidatePath("/my");
  return { ok: true, count: Number(data ?? 0) };
}

/**
 * Choose, change or remove (null) the upload goal. The profiles trigger restarts the
 * clock and clears the reminder bookkeeping whenever the goal changes.
 */
export async function setUploadGoal(goal: UploadGoal | null): Promise<Done> {
  const v = await requireUser("/my");
  if (goal !== null && !isUploadGoal(goal)) return { error: "Pick one of the goals." };
  if (goal && !v.email) return { error: "Add an email address to your account first, so the reminders have somewhere to go." };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ upload_goal: goal }).eq("id", v.userId);
  if (error) return { error: error.message };
  revalidatePath("/my");
  return { ok: true };
}

/** Name and optional phone number (what a team lead sees, and how they can text). */
export async function saveProfile(form: FormData): Promise<Done> {
  const v = await requireUser("/my");
  const display_name = String(form.get("display_name") ?? "").trim().slice(0, 80) || null;
  const phone = String(form.get("phone") ?? "").trim().slice(0, 24) || null;
  if (phone && !/^\+?[\d\s().-]{6,24}$/.test(phone)) return { error: "That doesn't look like a phone number. Digits, spaces and a leading + are fine." };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ display_name, phone }).eq("id", v.userId);
  if (error) return { error: error.message };
  revalidatePath("/my");
  return { ok: true };
}

/**
 * A lead (or an admin) sends a member a reminder email from the site: who it is from,
 * an optional line from them, when the member's last video was, and the recorder link.
 * At most one per member per team per day. Logged in `notifications` as goal_nudge.
 */
export async function nudgeMember(areaId: string, userId: string, noteRaw: string): Promise<Done> {
  const v = await requireUser("/my");
  if (!(v.isAdmin || v.managedAreaIds.includes(areaId))) return { error: "You don't lead that team." };
  if (userId === v.userId) return { error: "That's you." };
  const note = (noteRaw ?? "").trim().slice(0, 600);
  const db = createAdminClient();
  const [{ data: mem }, { data: leadRow }, { data: area }] = await Promise.all([
    db.from("area_members").select("user_id").eq("area_id", areaId).eq("user_id", userId).maybeSingle(),
    db.from("area_managers").select("user_id").eq("area_id", areaId).eq("user_id", userId).maybeSingle(),
    db.from("areas").select("name, language").eq("id", areaId).maybeSingle(),
  ]);
  if (!area) return { error: "Team not found." };
  if (!mem && !leadRow) return { error: "They are not on this team." };
  const { data: person } = await db.from("profiles").select("email, display_name, upload_goal").eq("id", userId).maybeSingle();
  const to = (person as { email: string | null } | null)?.email;
  if (!to) return { error: "They have no email address on file." };
  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  const { count } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("kind", "goal_nudge").eq("recipient", to).eq("area_id", areaId).gte("sent_at", dayAgo);
  if (count) return { error: "A reminder already went to them from this team in the last day." };
  const { data: last } = await db.from("videos").select("created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const team = areaLabel(area as { name: string; language: string });
  const from = v.profile.display_name ?? v.email ?? "Your team lead";
  const goal = goalDef((person as { upload_goal: string | null }).upload_goal);
  const lastAt = (last as { created_at: string } | null)?.created_at;
  const site = `<a href="${siteUrl}" style="color:#6b6b70">${siteUrl.replace(/^https?:\/\//, "")}</a>`;
  const paragraphs = [
    `${esc(from)}, who leads the ${esc(team)} team, sent you this reminder.`,
    ...(note ? [`&ldquo;${esc(note)}&rdquo;`] : []),
    lastAt ? `Your last video was ${daysAgo(new Date(lastAt))} (${formatDay(new Date(lastAt))}).` : "You have not sent a video yet.",
    ...(goal ? [`Your goal is ${goal.label.toLowerCase()}, ${goal.every}.`] : []),
    "Recording one takes about two minutes.",
  ];
  try {
    const id = await sendEmail({
      to, subject: `A reminder from the ${team} team`, heading: `${from} would love another video from you`, paragraphs,
      cta: { label: "Record a video", href: `${siteUrl}/upload` },
      footer: `You are receiving this because you are on the ${esc(team)} team at ${site}.`,
    });
    await db.from("notifications").insert({ kind: "goal_nudge", recipient: to, area_id: areaId, provider_id: id });
  } catch (e) {
    return { error: `Could not send: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { ok: true };
}
