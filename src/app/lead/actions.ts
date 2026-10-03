"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth";
import { escapeHtml, sendEmail, siteUrl } from "@/lib/email";
import { validateLeadFields, type LeadFields } from "@/lib/lead";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** At most this many "part 2" emails per application, and no closer together than the gap. */
const MAX_PART2_EMAILS = 6;
const MIN_GAP_MS = 60_000;
/** Across all applications. */
const MAX_PART2_EMAILS_PER_HOUR = 40;

export type StartResult =
  | { ok: true; next: "video" }
  | { ok: true; next: "email"; email: string; note?: string }
  | { error: string; code?: "no_session" };

/**
 * Part 1 of the team lead application.
 *
 * The caller always has a session. A visitor with no account gets an anonymous one in
 * the browser first (`signInAnonymously` with the Turnstile token, which Supabase
 * verifies), so reaching this action at all means a captcha was passed. The answers
 * are saved by `lead_start` under the caller's session, which holds the rules about
 * who may write what.
 *
 * Someone signed in to a real account goes straight to part 2. Everyone else is sent
 * the "part 2" email: its link confirms the address, creates or opens the account
 * (a magic link minted here with the service role, landing on /auth/confirm), and
 * opens the video step. The link is built on the configured site URL, never on
 * request headers, so a forged Host or Origin cannot point it elsewhere.
 */
export async function startLeadApplication(fields: LeadFields): Promise<StartResult> {
  const viewer = await getViewer();
  if (!viewer) return { error: "We could not start your session. Reload the page and try again.", code: "no_session" };
  const real = !viewer.isAnonymous;
  const problem = validateLeadFields(fields, !real);
  if (problem) return { error: problem };

  const supabase = await createClient();
  const { data: appId, error } = await supabase.rpc("lead_start", {
    p_email: real ? null : fields.email.trim(),
    p_name: fields.fullName,
    p_phone: fields.phone,
    p_language: fields.language,
    p_audience: fields.audience,
    p_why: fields.why,
  });
  if (error || !appId) return { error: error?.message ?? "We could not save your application. Please try again." };
  for (const p of ["/lead", "/lead/video", "/review/requests"]) revalidatePath(p);
  if (real) return { ok: true, next: "video" };

  // From here on the service role is needed: the application may belong to the address's
  // owner rather than to this session, and only the address's owner may learn anything
  // about it. The caller is told one thing whatever happens: where the email went.
  const admin = createAdminClient();
  const { data: app } = await admin.from("lead_applications").select("id, email, full_name, status, part2_emails, part2_emailed_at").eq("id", appId as string).maybeSingle();
  if (!app) return { error: "We could not save your application. Please try again." };
  const to = app.email as string;
  const lastSent = app.part2_emailed_at ? new Date(app.part2_emailed_at as string).getTime() : 0;
  if (Date.now() - lastSent < MIN_GAP_MS) return { ok: true, next: "email", email: to, note: "We sent it less than a minute ago. Give it a moment, and check your spam folder." };
  if ((app.part2_emails as number) >= MAX_PART2_EMAILS) return { ok: true, next: "email", email: to, note: `We have already sent it several times. Search your inbox for "Assigned To Labor", or sign in with this address to continue.` };
  // A ceiling for the whole site: these emails share a daily quota with sign-in links
  // and review digests, and nothing legitimate needs this many in an hour.
  const { count: lastHour } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("kind", "lead_part2").gte("sent_at", new Date(Date.now() - 3_600_000).toISOString());
  if ((lastHour ?? 0) >= MAX_PART2_EMAILS_PER_HOUR) {
    console.error(`[lead] part 2 emails paused: ${lastHour} in the last hour`);
    return { error: "Your answers are saved, but we are sending a lot of email right now. Please try again in an hour, or sign in with this address to continue." };
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: to });
  if (linkErr || !link?.properties?.hashed_token) {
    console.error(`[lead] could not mint a sign-in link for application ${app.id}: ${linkErr?.message}`);
    return { error: "We saved your answers but could not prepare your email. Please try again in a minute." };
  }
  const href = `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(link.properties.hashed_token)}&type=${encodeURIComponent(link.properties.verification_type)}&next=${encodeURIComponent("/lead/video")}`;
  const done = app.status === "submitted";
  try {
    const providerId = await sendEmail({
      to,
      subject: done ? "Your team lead application" : "Part 2 of your team lead application",
      heading: done ? "Your application is in" : "One more step: a short video",
      paragraphs: done
        ? [`Hello ${escapeHtml(app.full_name as string)}. Your application to lead a team is complete and waiting for a decision.`, "The button below opens your account so you can see where it stands."]
        : [
            `Thank you, ${escapeHtml(app.full_name as string)}. Part 1 of your application to lead a team is saved.`,
            "<b>Part 2 is a short video, about a minute, telling us why you would like to lead a team.</b> You can record it on your phone right in the browser, or upload one you already have.",
            "The button below confirms this email address, opens your account, and takes you straight to the video step.",
            `The button works once and for a limited time. After that, go to <a href="${siteUrl}/lead">${siteUrl.replace(/^https?:\/\//, "")}/lead</a> and sign in with this address to pick up where you left off.`,
          ],
      cta: { label: done ? "See my application" : "Record my video", href },
      footer: `You are receiving this because a team lead application was started with this address at <a href="${siteUrl}" style="color:#6b6b70">${siteUrl.replace(/^https?:\/\//, "")}</a>. If that was not you, ignore this email and nothing more will happen.`,
    });
    await admin.from("lead_applications").update({ part2_emails: (app.part2_emails as number) + 1, part2_emailed_at: new Date().toISOString() }).eq("id", app.id);
    await admin.from("notifications").insert({ kind: "lead_part2", recipient: to, provider_id: providerId });
  } catch (e) {
    console.error(`[lead] part 2 email for application ${app.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    return { error: "We saved your answers but could not send your email. Please try again in a minute." };
  }
  return { ok: true, next: "email", email: to };
}
