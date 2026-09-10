import { createClient } from "@supabase/supabase-js";
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

  // 4. admin seeding trigger
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
  console.log("cleanup done", created.length, "users removed");
}
