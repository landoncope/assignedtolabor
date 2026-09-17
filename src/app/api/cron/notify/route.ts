import { NextResponse, type NextRequest } from "next/server";
import { sendEmail, siteUrl, type Outgoing } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { areaLabel } from "@/lib/types";

/**
 * Notification sweep (Vercel cron, every 5 minutes, bearer CRON_SECRET).
 *  1. Managers of an area get one email listing new pending videos (admins if the
 *     area has no managers or the video has no area).
 *  2. Uploaders with a confirmed email hear when a video is posted or not selected.
 *  3. People made a manager, or invited by email, are told.
 *  4. Team requests: the people who decide (leads for join requests, admins for
 *     new-team proposals) get one email per sweep; applicants hear the outcome.
 * Each item is marked as notified only after its email is accepted by Resend, so a
 * failed send is retried on the next run. `?dry=1` returns the plan without sending.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  const db = createAdminClient();
  const plan: { kind: string; to: string; subject: string }[] = [];
  const failures: string[] = [];

  async function deliver(kind: string, m: Outgoing, refs: { video_id?: string; area_id?: string | null }, mark: () => Promise<void>) {
    plan.push({ kind, to: m.to, subject: m.subject });
    if (dry) return;
    try {
      const id = await sendEmail(m);
      await db.from("notifications").insert({ kind, recipient: m.to, video_id: refs.video_id ?? null, area_id: refs.area_id ?? null, provider_id: id });
      await mark();
    } catch (e) {
      failures.push(`${kind} -> ${m.to}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  type Person = { id: string; email: string | null };
  const { data: adminRows } = await db.from("profiles").select("id, email").eq("role", "admin").not("email", "is", null);
  const admins = (adminRows ?? []) as Person[];

  // 1. New videos, grouped per recipient.
  const { data: fresh } = await db
    .from("videos")
    .select("id, area_id, uploader_name, created_at, area:areas(id, name, language)")
    .is("managers_notified_at", null)
    .eq("status", "pending")
    .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString())
    .order("created_at");
  type Fresh = { id: string; area_id: string | null; uploader_name: string | null; created_at: string; area: { id: string; name: string; language: string } | null };
  const byRecipient = new Map<string, Fresh[]>();
  for (const v of (fresh ?? []) as unknown as Fresh[]) {
    let recipients: Person[] = [];
    if (v.area_id) {
      const { data: mgrs } = await db.from("area_managers").select("profile:profiles(id, email)").eq("area_id", v.area_id);
      recipients = ((mgrs ?? []) as unknown as { profile: Person | null }[]).map((m) => m.profile).filter((p): p is Person => !!p?.email);
    }
    if (recipients.length === 0) recipients = admins;
    for (const p of recipients) byRecipient.set(p.email!, [...(byRecipient.get(p.email!) ?? []), v]);
  }
  for (const [to, vids] of byRecipient) {
    const lines = vids.map((v) => `<b>${areaLabel(v.area)}</b> from ${v.uploader_name ?? "Anonymous"}`);
    await deliver(
      "new_videos",
      {
        to,
        subject: vids.length === 1 ? "A new video is waiting for review" : `${vids.length} new videos are waiting for review`,
        heading: vids.length === 1 ? "A new video is waiting" : `${vids.length} new videos are waiting`,
        paragraphs: [`Sent to your team${vids.length === 1 ? "" : "s"}:`, lines.join("<br>")],
        cta: { label: "Open the review queue", href: `${siteUrl}/review` },
      },
      { video_id: vids.length === 1 ? vids[0].id : undefined, area_id: vids.length === 1 ? vids[0].area_id : undefined },
      async () => { await db.from("videos").update({ managers_notified_at: new Date().toISOString() }).in("id", vids.map((v) => v.id)); },
    );
  }
  // Videos whose email went out earlier this run for another recipient, or with nobody to tell: mark so they never loop.
  if (!dry && fresh?.length) {
    const told = new Set([...byRecipient.values()].flat().map((v) => v.id));
    const untold = (fresh as unknown as Fresh[]).filter((v) => !told.has(v.id)).map((v) => v.id);
    if (untold.length) await db.from("videos").update({ managers_notified_at: new Date().toISOString() }).in("id", untold);
  }

  // 2. Outcomes for uploaders with a confirmed email.
  const { data: outcomes } = await db
    .from("videos")
    .select("id, status, post_url, rejection_note, uploader_notified_status, area:areas(name, language), profile:profiles!videos_user_id_fkey(email, is_anonymous)")
    .in("status", ["posted", "rejected"])
    .limit(200);
  type Outcome = { id: string; status: "posted" | "rejected"; post_url: string | null; rejection_note: string | null; uploader_notified_status: string | null; area: { name: string; language: string } | null; profile: { email: string | null; is_anonymous: boolean } | null };
  for (const v of (outcomes ?? []) as unknown as Outcome[]) {
    if (v.uploader_notified_status === v.status) continue;
    const email = v.profile?.email;
    if (!email || v.profile?.is_anonymous) {
      if (!dry) await db.from("videos").update({ uploader_notified_status: v.status }).eq("id", v.id);
      continue;
    }
    const m: Outgoing = v.status === "posted"
      ? { to: email, subject: "Your video has been shared", heading: "Your video is out in the world",
          paragraphs: [`The ${areaLabel(v.area)} team posted your video.`, ...(v.post_url ? [`<a href="${v.post_url}">See the post</a>`] : [])],
          cta: { label: "See my videos", href: `${siteUrl}/my` } }
      : { to: email, subject: "About the video you shared", heading: "Thank you for sharing your video",
          paragraphs: [`The ${areaLabel(v.area)} team decided not to post this one.`, ...(v.rejection_note ? [`Their note: ${v.rejection_note}`] : []), "You are always welcome to record another."],
          cta: { label: "Record another", href: `${siteUrl}/upload` } };
    await deliver("outcome", m, { video_id: v.id }, async () => { await db.from("videos").update({ uploader_notified_status: v.status }).eq("id", v.id); });
  }

  // 3. New managers and invites.
  const { data: added } = await db.from("area_managers").select("area_id, user_id, area:areas(name, language), profile:profiles(email)").is("notified_at", null);
  type Added = { area_id: string; user_id: string; area: { name: string; language: string } | null; profile: { email: string | null } | null };
  for (const a of (added ?? []) as unknown as Added[]) {
    const mark = async () => { await db.from("area_managers").update({ notified_at: new Date().toISOString() }).eq("area_id", a.area_id).eq("user_id", a.user_id); };
    if (!a.profile?.email) { if (!dry) await mark(); continue; }
    await deliver("manager_added", {
      to: a.profile.email, subject: `You are now a lead for ${areaLabel(a.area)}`, heading: `You are now a lead for ${areaLabel(a.area)}`,
      paragraphs: ["Videos sent to this team will show up in your review queue, and you will get an email when new ones arrive. People who ask to join the team wait for you under Requests."],
      cta: { label: "Open the review queue", href: `${siteUrl}/review` },
    }, { area_id: a.area_id }, mark);
  }
  const { data: invites } = await db.from("manager_invites").select("email, area_id, area:areas(name, language)").is("notified_at", null);
  type Invite = { email: string; area_id: string; area: { name: string; language: string } | null };
  for (const i of (invites ?? []) as unknown as Invite[]) {
    await deliver("manager_invited", {
      to: i.email, subject: `You have been invited to lead ${areaLabel(i.area)}`, heading: "You have been invited to be a team lead",
      paragraphs: [`Sign in with this email address (${i.email}) and the ${areaLabel(i.area)} review queue will be waiting for you.`],
      cta: { label: "Sign in", href: `${siteUrl}/login` },
    }, { area_id: i.area_id }, async () => { await db.from("manager_invites").update({ notified_at: new Date().toISOString() }).eq("email", i.email).eq("area_id", i.area_id); });
  }

  // 4. Team requests, grouped per decider.
  const { data: newApps } = await db
    .from("team_applications")
    .select("id, kind, area_id, team_name, language, region, note, wants_lead, area:areas(name, language), profile:profiles!team_applications_user_id_fkey(email, display_name)")
    .eq("status", "pending")
    .is("notified_at", null)
    .order("created_at");
  type NewApp = { id: string; kind: "start" | "join"; area_id: string | null; team_name: string | null; language: string | null; region: string | null; note: string | null; wants_lead: boolean; area: { name: string; language: string } | null; profile: { email: string | null; display_name: string | null } | null };
  const who = (p: NewApp["profile"]) => (p?.display_name ? `${p.display_name} (${p.email ?? "no email"})` : p?.email ?? "Someone");
  const appsByRecipient = new Map<string, NewApp[]>();
  for (const a of (newApps ?? []) as unknown as NewApp[]) {
    let recipients: Person[] = [];
    if (a.kind === "join" && a.area_id) {
      const { data: mgrs } = await db.from("area_managers").select("profile:profiles(id, email)").eq("area_id", a.area_id);
      recipients = ((mgrs ?? []) as unknown as { profile: Person | null }[]).map((m) => m.profile).filter((p): p is Person => !!p?.email);
    }
    if (recipients.length === 0) recipients = admins;
    for (const p of recipients) appsByRecipient.set(p.email!, [...(appsByRecipient.get(p.email!) ?? []), a]);
  }
  for (const [to, list] of appsByRecipient) {
    const lines = list.map((a) => a.kind === "join"
      ? `<b>${who(a.profile)}</b> wants to join ${areaLabel(a.area)}${a.wants_lead ? " <b>and lead it</b> (an admin decides that)" : ""}${a.note ? `: “${a.note}”` : ""}`
      : `<b>${who(a.profile)}</b> wants to start a team: ${a.team_name} · ${a.language}${a.region ? ` · ${a.region}` : ""}${a.note ? `: “${a.note}”` : ""}`);
    await deliver(
      "team_application",
      {
        to,
        subject: list.length === 1 ? (list[0].kind === "join" ? "Someone wants to join your team" : "Someone wants to start a team") : `${list.length} team requests are waiting`,
        heading: list.length === 1 ? "A team request is waiting" : `${list.length} team requests are waiting`,
        paragraphs: [lines.join("<br>")],
        cta: { label: "Review the requests", href: `${siteUrl}/review/requests` },
      },
      { area_id: list.length === 1 ? list[0].area_id : undefined },
      async () => { await db.from("team_applications").update({ notified_at: new Date().toISOString() }).in("id", list.map((a) => a.id)); },
    );
  }
  if (!dry && newApps?.length) {
    const told = new Set([...appsByRecipient.values()].flat().map((a) => a.id));
    const untold = (newApps as unknown as NewApp[]).filter((a) => !told.has(a.id)).map((a) => a.id);
    if (untold.length) await db.from("team_applications").update({ notified_at: new Date().toISOString() }).in("id", untold);
  }

  // 5. Outcomes for applicants.
  const { data: decided } = await db
    .from("team_applications")
    .select("id, kind, status, area_id, user_id, team_name, decision_note, area:areas(name, language), profile:profiles!team_applications_user_id_fkey(email)")
    .in("status", ["approved", "declined"])
    .is("outcome_notified_at", null)
    .limit(200);
  type Decided = { id: string; kind: "start" | "join"; status: "approved" | "declined"; area_id: string | null; user_id: string; team_name: string | null; decision_note: string | null; area: { name: string; language: string } | null; profile: { email: string | null } | null };
  for (const a of (decided ?? []) as unknown as Decided[]) {
    const mark = async () => { await db.from("team_applications").update({ outcome_notified_at: new Date().toISOString() }).eq("id", a.id); };
    const email = a.profile?.email;
    if (!email) { if (!dry) await mark(); continue; }
    const team = a.area ? areaLabel(a.area) : a.team_name ?? "the team";
    const note = a.decision_note ? [`Their note: ${a.decision_note}`] : [];
    let m: Outgoing;
    if (a.kind === "join" && a.status === "approved") {
      const { data: leadRow } = a.area_id ? await db.from("area_managers").select("user_id").eq("area_id", a.area_id).eq("user_id", a.user_id).maybeSingle() : { data: null };
      m = leadRow
        ? { to: email, subject: `You are now a lead for ${team}`, heading: `You are now a lead for ${team}`,
            paragraphs: ["An admin made you a team lead.", "Videos sent to the team land in your review queue, and people asking to join it wait for you under Team requests.", ...note],
            cta: { label: "Open the review queue", href: `${siteUrl}/review` } }
        : { to: email, subject: `You are on the ${team} team`, heading: `Welcome to ${team}`,
            paragraphs: ["The team lead added you.", "When you record a video, pick the team on the language step and it goes straight to the lead.", ...note],
            cta: { label: "Record a video", href: `${siteUrl}/upload` } };
    } else if (a.kind === "join") {
      m = { to: email, subject: `About your request to join ${team}`, heading: `About your request to join ${team}`,
        paragraphs: ["The team lead did not add you this time.", ...note, "You are welcome to record videos on your own, and to ask again later."],
        cta: { label: "Record a video", href: `${siteUrl}/upload` } };
    } else if (a.status === "approved") {
      m = { to: email, subject: `Your team ${team} is ready`, heading: `${team} is ready, and you lead it`,
        paragraphs: ["Videos sent to your team land in your review queue. People who ask to join wait for you under Team requests, and you decide.", ...note],
        cta: { label: "Open the review queue", href: `${siteUrl}/review` } };
    } else {
      m = { to: email, subject: `About your proposal for ${team}`, heading: `About your proposal for ${team}`,
        paragraphs: ["The admins did not create this team for now.", ...note, "You can still record videos and join an existing team."],
        cta: { label: "See the teams", href: `${siteUrl}/my/teams` } };
    }
    await deliver("application_outcome", m, { area_id: a.area_id }, mark);
  }

  return NextResponse.json({ ok: failures.length === 0, dry, planned: plan.length, plan, failures });
}
