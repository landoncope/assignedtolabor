// Watches team lead applications as they move, one line per change. Read-only.
// Made to observe a real person going through /lead on production (the one leg the
// automated checks cannot do: the captcha), and handy on any day applications come in.
//   node scripts/dev/lead-watch.mjs [poll-seconds]
// Lines: PART 1 SAVED, EMAIL <status at Resend>, LINK OPENED, PART 2 SENT, DECIDED,
// and WATCH ERROR if a poll fails. Runs until stopped.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const every = Number(process.argv[2] ?? 5) * 1000;
const at = () => new Date().toLocaleTimeString("en-US", { hour12: false });
const say = (line) => console.log(`${at()}  ${line}`);

const seen = new Map();      // application id -> what was last reported about it
const mail = new Map();      // Resend message id -> last reported status
let first = true;

async function poll() {
  const { data: apps, error } = await db.from("lead_applications")
    .select("id, email, full_name, language, audience, status, user_id, started_by, part2_emails, video_seconds, video_size, video_path, decision_note, area:areas(name, language), created_at")
    .order("created_at");
  if (error) throw new Error(error.message);
  for (const a of apps ?? []) {
    const was = seen.get(a.id);
    if (!was) {
      if (first) say(`ALREADY THERE  ${a.email} · ${a.status}`);
      else say(`PART 1 SAVED  ${a.email} · ${a.full_name} · ${a.language} · wants to reach "${a.audience}" · ${a.user_id ? "signed-in account" : "no account yet"}`);
    } else {
      if (!was.user_id && a.user_id) say(`LINK OPENED  ${a.email} now has a confirmed account, and it owns the application`);
      if (was.part2_emails !== a.part2_emails) say(`PART 2 EMAIL COUNT  ${a.email}: ${a.part2_emails}`);
      if (was.status !== a.status) {
        if (a.status === "submitted") say(`PART 2 SENT  ${a.email} · video ${a.video_seconds ?? "?"}s, ${a.video_size ? (a.video_size / 1048576).toFixed(1) : "?"} MB · ${a.video_path}`);
        else if (a.status === "approved") say(`DECIDED  ${a.email} approved as a lead of ${a.area ? `${a.area.name} · ${a.area.language}` : "a team"}${a.decision_note ? ` · note: ${a.decision_note}` : ""}`);
        else if (a.status === "declined") say(`DECIDED  ${a.email} declined${a.decision_note ? ` · note: ${a.decision_note}` : ""}`);
        else say(`STATUS  ${a.email}: ${was.status} -> ${a.status}`);
      }
    }
    seen.set(a.id, { status: a.status, user_id: a.user_id, part2_emails: a.part2_emails });
  }
  for (const id of [...seen.keys()]) if (!(apps ?? []).some((a) => a.id === id)) { say(`REMOVED  application ${id.slice(0, 8)}`); seen.delete(id); }

  // The "part 2" emails and what Resend says became of them.
  const { data: sent } = await db.from("notifications").select("recipient, provider_id, kind, sent_at").in("kind", ["lead_part2", "lead_application", "lead_outcome"]).order("sent_at");
  for (const n of sent ?? []) {
    if (!n.provider_id) continue;
    const last = mail.get(n.provider_id);
    if (last === "delivered" || last === "bounced" || last === "complained") continue;
    if (first) { mail.set(n.provider_id, "delivered"); continue; }
    const r = await fetch(`https://api.resend.com/emails/${n.provider_id}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    if (!r.ok) continue;
    const m = await r.json();
    if (m.last_event && m.last_event !== last) {
      say(`EMAIL ${m.last_event.toUpperCase()}  "${m.subject}" to ${n.recipient} (${n.kind})`);
      mail.set(n.provider_id, m.last_event);
    }
  }
  first = false;
}

say(`watching lead applications every ${every / 1000}s`);
for (;;) {
  try { await poll(); } catch (e) { say(`WATCH ERROR  ${e instanceof Error ? e.message : String(e)}`); }
  await new Promise((r) => setTimeout(r, every));
}
