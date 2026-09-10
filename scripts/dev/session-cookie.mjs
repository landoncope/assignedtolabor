// Dev helper: creates a throwaway admin user and prints the @supabase/ssr cookie(s)
// needed to browse the app as that user. Usage: node scripts/dev/session-cookie.mjs
// Prints JSON: { userId, cookies: [{name, value}] }. Delete the user afterwards.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i), l.slice(i+1).replace(/^'|'$/g,"")]}));
const URL = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SRV = env.SUPABASE_SERVICE_ROLE_KEY;
const ref = new globalThis.URL(URL).hostname.split(".")[0];
const admin = createClient(URL, SRV, { auth: { persistSession: false } });
const email = `e2e-admin-${Date.now()}@example.com`, password = "Testpass-" + Math.random().toString(36).slice(2);
const { data: u, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error) throw error;
await admin.from("profiles").update({ role: "admin", display_name: "E2E Admin" }).eq("id", u.user.id);
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const { data: s, error: sErr } = await anon.auth.signInWithPassword({ email, password });
if (sErr) throw sErr;
const value = "base64-" + Buffer.from(JSON.stringify(s.session)).toString("base64url");
const MAX = 3180, name = `sb-${ref}-auth-token`;
const cookies = value.length <= MAX ? [{ name, value }] : Array.from({ length: Math.ceil(value.length / MAX) }, (_, i) => ({ name: `${name}.${i}`, value: value.slice(i * MAX, (i + 1) * MAX) }));
console.log(JSON.stringify({ userId: u.user.id, cookies }));
