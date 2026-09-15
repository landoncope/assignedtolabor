import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const anon = await sb.auth.signInAnonymously();
console.log("anonymous (no token):", anon.error ? `REJECTED: ${anon.error.status} ${anon.error.message}` : `ALLOWED user ${anon.data.user?.id}`);
const otp = await sb.auth.signInWithOtp({ email: "captcha-probe@example.com", options: { shouldCreateUser: false } });
console.log("magic link (no token):", otp.error ? `REJECTED: ${otp.error.status} ${otp.error.message}` : "ALLOWED");
