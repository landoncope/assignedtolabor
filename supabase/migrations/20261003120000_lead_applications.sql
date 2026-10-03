-- Team lead applications (2026-10-03, Travis): someone with no account applies to lead
-- a team. Part 1 is a form (name, email, phone, the language the channel will speak,
-- the audience or place they want to reach, why they want to lead). An email then
-- carries part 2: a short video on why they would like to lead. The email link is
-- also what creates and confirms their account. Admins review the answers and the
-- video and decide.
--
-- The application is keyed by the EMAIL typed in part 1, not by a user: it exists
-- before any account does. Whichever real account later proves that address (the
-- email link, Google, an account they already had) owns it; `lead_claim()` attaches
-- it. Part 1 can be filled by an anonymous session (the captcha-checked kind the
-- upload flow uses), which is how the server knows a person, not a script, is asking.
--
-- All writes go through the functions below (or the service role, for email
-- bookkeeping). There are no insert/update/delete policies.

create table public.lead_applications (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null,   -- lower-cased; the address that owns this application
  user_id             uuid references public.profiles(id) on delete set null, -- the account that proved the address
  started_by          uuid references public.profiles(id) on delete set null, -- the session that filled part 1
  full_name           text not null,
  phone               text not null,
  language            text not null,   -- the language the channel will speak
  audience            text not null,   -- the audience or location they want to reach
  why                 text not null,
  status              text not null default 'started'
                      check (status in ('started', 'submitted', 'approved', 'declined')),
  -- part 2: the video (same private bucket as testimonies, never in the review queue)
  video_path          text,            -- null until part 2, and again once purged
  video_mime          text,
  video_size          bigint,
  video_seconds       integer,
  video_thumbnail     text,
  capture_meta        jsonb,
  submitted_at        timestamptz,
  video_purged_at     timestamptz,
  -- decision
  area_id             uuid references public.areas(id) on delete set null,    -- the team they were made a lead of
  decided_by          uuid references public.profiles(id) on delete set null,
  decided_at          timestamptz,
  decision_note       text,
  -- email bookkeeping
  part2_emails        integer not null default 0,  -- how many "part 2" emails went to the address
  part2_emailed_at    timestamptz,
  admins_notified_at  timestamptz,                 -- admins were told a finished application is waiting
  outcome_notified_at timestamptz,                 -- the applicant was told the decision
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index lead_applications_one_open_per_email on public.lead_applications (lower(email)) where status in ('started', 'submitted');
create index lead_applications_status_idx on public.lead_applications (status, created_at);
create index lead_applications_user_idx   on public.lead_applications (user_id, created_at desc);
create index lead_applications_starter_idx on public.lead_applications (started_by);

alter table public.lead_applications enable row level security;
create policy lead_applications_select_own on public.lead_applications for select
  using (user_id = auth.uid() or (user_id is null and started_by = auth.uid()));
create policy lead_applications_select_admin on public.lead_applications for select
  using (public.is_admin());

-- Part 1. Callable by any session, anonymous included. Returns the application the
-- "part 2" email should be about. Rules:
--  * A real account applies under its own address, whatever was typed, and may take
--    over an open application waiting on that address.
--  * A session without an account keeps one unclaimed draft and may correct it,
--    address included, until someone confirms the address.
--  * An address that already has an open application from someone else is left
--    untouched: the email goes to the address and its owner carries on with theirs.
create or replace function public.lead_start(p_email text, p_name text, p_phone text, p_language text, p_audience text, p_why text)
returns uuid language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
  me       uuid := auth.uid();
  my_email text;
  addr     text;
  a        public.lead_applications%rowtype;
  other    uuid;
  app      uuid;
begin
  if me is null then raise exception 'not allowed'; end if;
  p_name     := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  p_phone    := regexp_replace(btrim(coalesce(p_phone, '')), '\s+', ' ', 'g');
  p_language := regexp_replace(btrim(coalesce(p_language, '')), '\s+', ' ', 'g');
  p_audience := btrim(coalesce(p_audience, ''));
  p_why      := btrim(coalesce(p_why, ''));
  if length(p_name) < 2 or length(p_name) > 120 then raise exception 'Please enter your name.'; end if;
  if p_phone !~ '^[+0-9 ().-]{7,32}$' or length(regexp_replace(p_phone, '\D', '', 'g')) < 7 then raise exception 'Please enter a phone number we can reach you at.'; end if;
  if length(p_language) < 2 or length(p_language) > 60 then raise exception 'Please enter the language your channel will speak.'; end if;
  if length(p_audience) < 2 or length(p_audience) > 300 then raise exception 'Please tell us the audience or location you want to reach.'; end if;
  if length(p_why) < 2 or length(p_why) > 3000 then raise exception 'Please tell us why you would like to lead a team.'; end if;

  select lower(u.email) into my_email from auth.users u
   where u.id = me and not coalesce(u.is_anonymous, false) and u.email_confirmed_at is not null;
  addr := coalesce(my_email, lower(btrim(coalesce(p_email, ''))));
  if addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(addr) > 254 then raise exception 'Please enter a valid email address.'; end if;

  if my_email is not null then
    -- Their own open application, else an unclaimed one waiting on their address.
    select * into a from public.lead_applications
     where status in ('started', 'submitted') and (user_id = me or (user_id is null and lower(email) = addr))
     order by (user_id is not distinct from me) desc, created_at desc limit 1 for update;
    if found then
      if a.status = 'started' then
        update public.lead_applications
           set user_id = me, full_name = p_name, phone = p_phone, language = p_language, audience = p_audience, why = p_why, updated_at = now()
         where id = a.id;
      elsif a.user_id is null then
        update public.lead_applications set user_id = me, updated_at = now() where id = a.id;
      end if;
      return a.id;
    end if;
    begin
      insert into public.lead_applications (email, user_id, started_by, full_name, phone, language, audience, why)
        values (addr, me, me, p_name, p_phone, p_language, p_audience, p_why) returning id into app;
    exception when unique_violation then
      -- An open application under this address belongs to a different account (the address changed hands).
      raise exception 'An application for this email address is already in progress.';
    end;
    return app;
  end if;

  select id into other from public.lead_applications where status in ('started', 'submitted') and lower(email) = addr limit 1;
  select * into a from public.lead_applications
   where status = 'started' and started_by = me and user_id is null
   order by created_at desc limit 1 for update;
  if found then
    if other is not null and other <> a.id then return other; end if;
    update public.lead_applications
       set email = addr, full_name = p_name, phone = p_phone, language = p_language, audience = p_audience, why = p_why, updated_at = now()
     where id = a.id;
    return a.id;
  end if;
  if other is not null then return other; end if;
  insert into public.lead_applications (email, started_by, full_name, phone, language, audience, why)
    values (addr, me, p_name, p_phone, p_language, p_audience, p_why) returning id into app;
  return app;
end;
$$;

-- The caller's application, attaching one that is waiting on their confirmed address.
-- Returns the open one if there is one, else their most recent decided one, else null.
create or replace function public.lead_claim()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me   uuid := auth.uid();
  addr text;
  app  uuid;
  nm   text;
begin
  if me is null then return null; end if;
  select lower(u.email) into addr from auth.users u
   where u.id = me and not coalesce(u.is_anonymous, false) and u.email_confirmed_at is not null;
  if addr is null then return null; end if;
  select id into app from public.lead_applications
   where status in ('started', 'submitted') and user_id = me order by created_at desc limit 1;
  if app is null then
    update public.lead_applications set user_id = me, updated_at = now()
     where id = (select id from public.lead_applications
                  where status in ('started', 'submitted') and user_id is null and lower(email) = addr
                  order by created_at desc limit 1 for update)
     returning id, full_name into app, nm;
    if app is not null then
      update public.profiles set display_name = nm where id = me and display_name is null;
    end if;
  end if;
  if app is null then
    select id into app from public.lead_applications where user_id = me order by created_at desc limit 1;
  end if;
  return app;
end;
$$;

-- Part 2. The caller uploaded a file into their own folder; this ties it to their
-- open application and sends the application on to the admins.
create or replace function public.lead_attach_video(p_path text, p_mime text, p_size bigint, p_seconds integer, p_thumbnail text, p_meta jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
  me  uuid := auth.uid();
  app uuid;
begin
  if me is null then raise exception 'not allowed'; end if;
  if p_path is null or position(me::text || '/' in p_path) <> 1 then raise exception 'not allowed'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'videos' and o.name = p_path) then
    raise exception 'The video did not finish uploading. Please try again.';
  end if;
  update public.lead_applications
     set video_path = p_path, video_mime = p_mime, video_size = p_size, video_seconds = p_seconds,
         video_thumbnail = left(p_thumbnail, 200000), capture_meta = p_meta,
         status = 'submitted', submitted_at = now(), updated_at = now(), admins_notified_at = null
   where id = (select id from public.lead_applications
                where user_id = me and status = 'started' order by created_at desc limit 1 for update)
   returning id into app;
  if app is null then raise exception 'There is no application waiting for a video.'; end if;
  return app;
end;
$$;

-- The decision. Admins only. Approving makes the applicant a lead (and member) of an
-- existing team, or creates a team for their language and makes them its lead. A new
-- team is refused when an active team already covers the language: one team per
-- language keeps language routing unambiguous (see 20260917170000_join_as_lead.sql).
-- Approval needs the video (status submitted); an unfinished application can only be
-- declined. Returns the team.
create or replace function public.decide_lead_application(app_id uuid, approve boolean, note text default null, target_area uuid default null, new_team_name text default null, new_team_language text default null)
returns uuid language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
  a    public.lead_applications%rowtype;
  team uuid;
  lang text;
  held text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into a from public.lead_applications where id = app_id for update;
  if not found then raise exception 'Application not found'; end if;
  if a.status not in ('started', 'submitted') then raise exception 'This application was already decided'; end if;
  if approve then
    if a.status <> 'submitted' or a.user_id is null then raise exception 'This application has no video yet. It can be approved once part 2 is in.'; end if;
    if target_area is not null then
      select id into team from public.areas where id = target_area;
      if team is null then raise exception 'Team not found'; end if;
    else
      if nullif(btrim(coalesce(new_team_name, '')), '') is null then raise exception 'Pick a team, or give the new team a name.'; end if;
      lang := coalesce(nullif(btrim(coalesce(new_team_language, '')), ''), a.language);
      select name into held from public.areas where is_active and lower(btrim(language)) = lower(lang) limit 1;
      if held is not null then
        raise exception 'The % team already covers %. Add this person as a lead of that team instead.', held, lang;
      end if;
      insert into public.areas (name, language) values (btrim(new_team_name), lang) returning id into team;
    end if;
    -- notified_at is set: the outcome email already says "you are now a lead".
    insert into public.area_managers (area_id, user_id, notified_at) values (team, a.user_id, now()) on conflict do nothing;
    insert into public.area_members (area_id, user_id) values (team, a.user_id) on conflict do nothing;
  end if;
  update public.lead_applications
     set status = case when approve then 'approved' else 'declined' end,
         area_id = team, decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(btrim(coalesce(note, '')), ''), updated_at = now()
   where id = app_id;
  return team;
end;
$$;

revoke all on function public.lead_start(text, text, text, text, text, text) from public;
revoke all on function public.lead_claim() from public;
revoke all on function public.lead_attach_video(text, text, bigint, integer, text, jsonb) from public;
revoke all on function public.decide_lead_application(uuid, boolean, text, uuid, text, text) from public;
grant execute on function public.lead_start(text, text, text, text, text, text) to authenticated;
grant execute on function public.lead_claim() to authenticated;
grant execute on function public.lead_attach_video(text, text, bigint, integer, text, jsonb) to authenticated;
grant execute on function public.decide_lead_application(uuid, boolean, text, uuid, text, text) to authenticated;
