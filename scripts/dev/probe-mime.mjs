// Probe: does the private `videos` bucket accept content types with codec parameters,
// the way MediaRecorder reports them? Uses a throwaway anonymous user and cleans up.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i), l.slice(i+1).replace(/^'|'$/g,"")]}));
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: a } = await anon.auth.signInAnonymously();
const uid = a.user.id;
const types = ["video/mp4", "video/mp4;codecs=avc1,mp4a", "video/webm;codecs=vp9,opus", "video/quicktime", "application/octet-stream", ""];
for (const t of types) {
  const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`;
  const { data: signed } = await anon.storage.from("videos").createSignedUploadUrl(path);
  const headers = { "x-upsert": "false" }; if (t) headers["content-type"] = t;
  const r = await fetch(signed.signedUrl, { method: "PUT", headers, body: new Uint8Array(2048) });
  const body = await r.text().catch(() => "");
  console.log(`${String(r.status).padEnd(4)} ${JSON.stringify(t).padEnd(34)} ${body.slice(0, 120)}`);
}
const { data: files } = await admin.storage.from("videos").list(uid);
if (files?.length) await admin.storage.from("videos").remove(files.map(f => `${uid}/${f.name}`));
await admin.auth.admin.deleteUser(uid);
console.log("cleanup done");
