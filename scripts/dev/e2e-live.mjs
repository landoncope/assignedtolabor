import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i), l.slice(i+1).replace(/^'|'$/g,"")]}));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SRV, { auth: { persistSession: false } });
const ok = (label, cond, extra="") => { console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  -> " + extra : ""}`); if (!cond) process.exitCode = 1; };
const created = [];
try {
  // 1. anonymous uploader
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: a, error: aErr } = await anon.auth.signInAnonymously();
  ok("anonymous sign-in", !aErr && a.session, aErr?.message);
  created.push(a.user.id);
  const { data: areas } = await anon.from("areas").select("id,name").eq("is_active", true);
  ok("anonymous can list areas", areas?.length >= 1, JSON.stringify(areas?.map(x=>x.name)));
  const path = `${a.user.id}/${Date.now()}.mp4`;
  const { data: signed, error: sErr } = await anon.storage.from("videos").createSignedUploadUrl(path);
  ok("signed upload url", !sErr, sErr?.message);
  const put = await fetch(signed.signedUrl, { method: "PUT", headers: { "content-type": "video/mp4", "x-upsert": "false" }, body: new Uint8Array(1024) });
  ok("PUT to bucket", put.ok, String(put.status));
  const { data: vid, error: vErr } = await anon.from("videos").insert({ user_id: a.user.id, area_id: areas[0].id, storage_path: path, file_name: "t.mp4", file_size: 1024, mime_type: "video/mp4", script: { hook: "h", body: "b", cta: "c" }, uploader_name: "Test" }).select("id,status").single();
  ok("insert video row", !vErr && vid.status === "pending", vErr?.message);
  const { error: upErr, data: upd } = await anon.from("videos").update({ status: "approved" }).eq("id", vid.id).select("status").single();
  ok("uploader cannot self-approve (trigger keeps pending)", !upErr && upd?.status === "pending", upErr?.message ?? upd?.status);
  const { data: mine } = await anon.from("videos").select("id");
  ok("uploader sees own video", mine?.length === 1);
  const { data: url } = await anon.storage.from("videos").createSignedUrl(path, 60);
  ok("uploader can sign playback url", !!url?.signedUrl);

  // 2. a second anonymous user cannot see it
  const anon2 = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: a2 } = await anon2.auth.signInAnonymously(); created.push(a2.user.id);
  const { data: others } = await anon2.from("videos").select("id");
  ok("other user sees nothing", others?.length === 0);
  const { data: url2, error: u2 } = await anon2.storage.from("videos").createSignedUrl(path, 60);
  ok("other user cannot sign playback url", !url2?.signedUrl, u2?.message);

  // 3. manager via invite: create user with the invited email pattern -> we use a throwaway invite
  const mgrEmail = `mgr-${Date.now()}@example.com`;
  await admin.from("manager_invites").insert({ email: mgrEmail, area_id: areas[0].id });
  const { data: m, error: mErr } = await admin.auth.admin.createUser({ email: mgrEmail, password: "Testpass-123", email_confirm: true });
  ok("create manager user", !mErr, mErr?.message); created.push(m.user.id);
  const { data: am } = await admin.from("area_managers").select("area_id").eq("user_id", m.user.id);
  ok("invite converted to area_managers on sign-up", am?.length === 1);
  const mgr = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: liErr } = await mgr.auth.signInWithPassword({ email: mgrEmail, password: "Testpass-123" });
  ok("manager password sign-in", !liErr, liErr?.message);
  const { data: queue } = await mgr.from("videos").select("id,status").eq("status", "pending");
  ok("manager sees pending video for area", queue?.some(q => q.id === vid.id));
  const { data: appr, error: apErr } = await mgr.from("videos").update({ status: "approved", reviewed_by: m.user.id, reviewed_at: new Date().toISOString() }).eq("id", vid.id).select("status").single();
  ok("manager approves", !apErr && appr.status === "approved", apErr?.message);
  const { data: murl } = await mgr.storage.from("videos").createSignedUrl(path, 60);
  ok("manager can sign playback url", !!murl?.signedUrl);
  const { data: posted, error: poErr } = await mgr.from("videos").update({ status: "posted", posted_by: m.user.id, posted_at: new Date().toISOString(), post_url: "https://instagram.com/p/x" }).eq("id", vid.id).select("status").single();
  ok("manager marks posted", !poErr && posted.status === "posted", poErr?.message);
  const { data: adminTry, error: adErr } = await mgr.from("areas").insert({ name: "X", language: "Y" }).select();
  ok("manager cannot create areas", !!adErr || !adminTry?.length, adErr?.message);

  // 3b. delete: only reviewers of the video's area (or admins) may delete
  const { data: delByOther } = await anon2.from("videos").delete().eq("id", vid.id).select("id");
  ok("other user cannot delete the video", !delByOther?.length);
  const { data: delBySelf } = await anon.from("videos").delete().eq("id", vid.id).select("id");
  ok("uploader cannot delete the video", !delBySelf?.length);
  const { data: delByMgr, error: delErr } = await mgr.from("videos").delete().eq("id", vid.id).select("id,storage_path");
  ok("manager can delete a video in their area", !delErr && delByMgr?.length === 1, delErr?.message);

  // 4. teams: join requests decided by the team lead, new teams decided by an admin
  const memEmail = `member-${Date.now()}@example.com`;
  const { data: mu } = await admin.auth.admin.createUser({ email: memEmail, password: "Testpass-123", email_confirm: true }); created.push(mu.user.id);
  const mem = createClient(URL, ANON, { auth: { persistSession: false } });
  await mem.auth.signInWithPassword({ email: memEmail, password: "Testpass-123" });
  const { data: app, error: appErr } = await mem.from("team_applications").insert({ user_id: mu.user.id, kind: "join", area_id: areas[0].id, note: "e2e" }).select("id").single();
  ok("member can ask to join a team", !appErr && !!app?.id, appErr?.message);
  const { data: dup, error: dupErr } = await mem.from("team_applications").insert({ user_id: mu.user.id, kind: "join", area_id: areas[0].id }).select("id");
  ok("a second open request for the same team is refused", !!dupErr || !dup?.length, dupErr?.code);
  const { data: anonSees } = await anon.from("team_applications").select("id").eq("id", app.id);
  ok("other users cannot see the request", anonSees?.length === 0);
  const { data: mgrSees } = await mgr.from("team_applications").select("id, profile:profiles!team_applications_user_id_fkey(email)").eq("id", app.id);
  ok("team lead sees the request and the applicant's email", mgrSees?.length === 1 && mgrSees[0].profile?.email === memEmail, JSON.stringify(mgrSees));
  const { error: selfDecide } = await mem.rpc("decide_team_application", { app_id: app.id, approve: true, note: null });
  ok("applicant cannot decide their own request", !!selfDecide, selfDecide?.message);
  const { error: decErr } = await mgr.rpc("decide_team_application", { app_id: app.id, approve: true, note: "welcome" });
  ok("team lead approves the request", !decErr, decErr?.message);
  const { data: membership } = await mem.from("area_members").select("area_id").eq("user_id", mu.user.id);
  ok("approval made them a member", membership?.length === 1);
  const { data: startApp, error: startErr } = await mem.from("team_applications").insert({ user_id: mu.user.id, kind: "start", team_name: `E2E Team ${Date.now()}`, language: "Klingon", region: "Nowhere", note: "e2e" }).select("id").single();
  ok("member can propose a new team", !startErr && !!startApp?.id, startErr?.message);
  const { error: mgrStart } = await mgr.rpc("decide_team_application", { app_id: startApp.id, approve: true, note: null });
  ok("a team lead cannot approve a new team", !!mgrStart, mgrStart?.message);
  const admEmail = `admin-${Date.now()}@example.com`;
  const { data: au } = await admin.auth.admin.createUser({ email: admEmail, password: "Testpass-123", email_confirm: true }); created.push(au.user.id);
  await admin.from("profiles").update({ role: "admin" }).eq("id", au.user.id);
  const admClient = createClient(URL, ANON, { auth: { persistSession: false } });
  await admClient.auth.signInWithPassword({ email: admEmail, password: "Testpass-123" });
  const { error: admDec } = await admClient.rpc("decide_team_application", { app_id: startApp.id, approve: true, note: null });
  ok("admin approves the new team", !admDec, admDec?.message);
  const { data: newArea } = await admin.from("areas").select("id").eq("language", "Klingon");
  const { data: newLead } = newArea?.length ? await admin.from("area_managers").select("user_id, notified_at").eq("area_id", newArea[0].id).eq("user_id", mu.user.id) : { data: [] };
  ok("approval created the team with the applicant as its lead", newArea?.length === 1 && newLead?.length === 1 && !!newLead[0].notified_at);
  const { error: againErr } = await admClient.rpc("decide_team_application", { app_id: startApp.id, approve: false, note: null });
  ok("a decided request cannot be decided again", !!againErr, againErr?.message);

  // 5. stranded uploads: an anonymous upload whose pending (unconfirmed) email matches a signed-in account
  const { data: anonVid, error: anonVidErr } = await anon.from("videos").insert({ user_id: a.user.id, uploader_name: "Stranded", language: "English" }).select("id").single();
  ok("anonymous session uploads again", !anonVidErr && !!anonVid?.id, anonVidErr?.message);
  execFileSync("psql", [env.SUPABASE_DB_URL, "-v", "ON_ERROR_STOP=1", "-qc", `update auth.users set email_change = '${memEmail}' where id = '${a.user.id}'`], { stdio: "pipe" });
  const { data: mineToClaim } = await mem.rpc("claimable_uploads");
  ok("the account with that email sees the stranded upload", mineToClaim?.length === 1 && mineToClaim[0].id === anonVid.id, JSON.stringify(mineToClaim));
  const { data: notMine } = await mgr.rpc("claimable_uploads");
  ok("other accounts see nothing to claim", (notMine ?? []).length === 0);
  const { data: claimed, error: claimErr } = await mem.rpc("claim_uploads");
  ok("claiming moves the video", !claimErr && claimed === 1, claimErr?.message ?? String(claimed));
  const { data: nowMine } = await mem.from("videos").select("id, claimed_from").eq("id", anonVid.id);
  ok("the video now belongs to the account and remembers where it came from", nowMine?.length === 1 && nowMine[0].claimed_from === a.user.id);
  const { data: anonStill } = await anon.from("videos").select("id").eq("id", anonVid.id);
  ok("the anonymous session no longer sees it", anonStill?.length === 0);

  // 6. admin seeding trigger
  const { data: adm, error: admErr } = await admin.auth.admin.createUser({ email: "travis.lish@gmail.com", password: "Temp-" + Date.now(), email_confirm: true });
  if (admErr) console.log("skip admin-seed check:", admErr.message); else {
    created.push(adm.user.id);
    const { data: prof } = await admin.from("profiles").select("role").eq("id", adm.user.id).single();
    ok("seed email becomes admin automatically", prof?.role === "admin", prof?.role);
  }
} catch (e) { console.log("ERROR", e); process.exitCode = 1; }
finally {
  for (const id of created) { await admin.storage.from("videos").list(id).then(async ({ data }) => { if (data?.length) await admin.storage.from("videos").remove(data.map(f => `${id}/${f.name}`)); }); await admin.auth.admin.deleteUser(id); }
  await admin.from("manager_invites").delete().like("email", "mgr-%@example.com");
  await admin.from("areas").delete().eq("language", "Klingon");
  console.log("cleanup done", created.length, "users removed");
}
