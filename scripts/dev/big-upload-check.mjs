// Verifies that a phone-sized video body passes through the custom domain to Storage.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
console.log("API host:", new URL(env.NEXT_PUBLIC_SUPABASE_URL).host);
for (const mb of [60, 120]) {
  const path = `capacity-test/${Date.now()}-${mb}mb.mp4`;
  const { data: signed, error } = await sb.storage.from("videos").createSignedUploadUrl(path);
  if (error) { console.log(mb, "MB: sign error", error.message); continue; }
  const body = new Uint8Array(mb * 1024 * 1024);
  const t0 = Date.now();
  const r = await fetch(signed.signedUrl, { method: "PUT", headers: { "content-type": "video/mp4", "x-upsert": "false" }, body });
  console.log(`${mb} MB PUT via ${new URL(signed.signedUrl).host}: HTTP ${r.status} in ${((Date.now()-t0)/1000).toFixed(1)}s`, r.ok ? "" : (await r.text()).slice(0, 200));
  await sb.storage.from("videos").remove([path]);
}
