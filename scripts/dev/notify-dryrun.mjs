// Seeds a throwaway manager (via invite), an anonymous upload, and an outcome, then calls
// /api/cron/notify?dry=1 and prints the plan. Nothing is emailed. Cleans up after itself.
// Usage: node scripts/dev/notify-dryrun.mjs http://127.0.0.1:3001
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i), l.slice(i+1).replace(/^'|'$/g,"")]}));
const base = process.argv[2] || "http://127.0.0.1:3001";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const created = []; let inviteEmail = "";
try {
  const { data: area } = await admin.from("areas").select("id, name").eq("name", "Philippines").single();
  inviteEmail = `notify-mgr-${Date.now()}@example.com`;
  await admin.from("manager_invites").insert({ email: inviteEmail, area_id: area.id });          // -> manager_invited
  const { data: m } = await admin.auth.admin.createUser({ email: inviteEmail, email_confirm: true }); // invite converts -> manager_added
  created.push(m.user.id);
  const { data: up } = await admin.auth.admin.createUser({ email: `notify-up-${Date.now()}@example.com`, email_confirm: true });
  created.push(up.user.id);
  const { data: v1 } = await admin.from("videos").insert({ user_id: up.user.id, area_id: area.id, uploader_name: "Dry Run", status: "pending" }).select("id").single();      // -> new_videos to the manager
  const { data: v2 } = await admin.from("videos").insert({ user_id: up.user.id, area_id: null, uploader_name: "Dry Run", status: "pending" }).select("id").single();         // -> new_videos to admins (no area)
  const { data: v3 } = await admin.from("videos").insert({ user_id: up.user.id, area_id: area.id, uploader_name: "Dry Run", status: "posted", post_url: "https://instagram.com/p/x", managers_notified_at: new Date().toISOString() }).select("id").single(); // -> outcome to uploader
  const r = await fetch(`${base}/api/cron/notify?dry=1`, { headers: { Authorization: `Bearer ${env.CRON_SECRET}` } });
  const j = await r.json();
  console.log("status", r.status, "planned", j.planned, "failures", j.failures);
  for (const p of j.plan) console.log(`  ${p.kind.padEnd(16)} -> ${p.to.padEnd(40)} ${p.subject}`);
  const kinds = new Set(j.plan.map(p => p.kind));
  const ok = ["new_videos","outcome","manager_added"].every(k => kinds.has(k)) && !kinds.has("manager_invited");
  console.log(ok ? "RESULT: PASS (invite converted to manager, no stale invite email)" : "RESULT: CHECK kinds " + [...kinds].join(","));
  for (const v of [v1, v2, v3]) await admin.from("videos").delete().eq("id", v.id);
} finally {
  for (const id of created) await admin.auth.admin.deleteUser(id).catch(() => {});
  if (inviteEmail) await admin.from("manager_invites").delete().eq("email", inviteEmail);
  console.log("cleanup done");
}
