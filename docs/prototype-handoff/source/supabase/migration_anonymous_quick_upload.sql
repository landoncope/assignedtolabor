-- ─────────────────────────────────────────────────────────────────
-- Migration: support anonymous Quick Upload (Supabase Anonymous Auth)
-- Run this in the Supabase SQL Editor.
--
-- Anonymous users (signInAnonymously) have a NULL email. Two problems:
--   1. handle_new_user() inserts new.email into public.users.email, which is
--      NOT NULL → anonymous signup fails ("Database error saving new user").
--   2. When an anon user later upgrades (sets a real email), public.users.email
--      must be kept in sync (the original trigger only fires on INSERT).
--
-- This migration gives anonymous users a stable placeholder email and adds an
-- email-sync trigger for the upgrade path. Real signups are unaffected.
-- ─────────────────────────────────────────────────────────────────

-- 1) Tolerate NULL email on signup (placeholder for anonymous users).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.users (id, email, role)
  values (
    new.id,
    coalesce(new.email, 'anon-' || new.id::text || '@assignedtolabor.app'),
    coalesce(new.raw_user_meta_data->>'role', 'user')
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

-- 2) Mirror email into public.users when an anonymous user upgrades.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.users set email = new.email where id = new.id;
  end if;
  return new;
end;
$function$;

drop trigger if exists on_auth_user_email_change on auth.users;
create trigger on_auth_user_email_change
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();
