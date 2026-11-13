-- Team pages and what a channel has led to (2026-11-12, Travis's request).
--
-- 1. Each team's "meet with missionaries" form (today a Google Form run by Gathering
--    Israel, one per channel) gets an address on this site, assignedtolabor.org/<slug>,
--    and the page's opens are counted per day. Nothing a visitor types reaches us.
-- 2. The numbers that keep volunteers going: how many people asked to meet the
--    missionaries through the channel, how many were sent on, how many were baptized,
--    plus short stories. Typed in by the team's leads or an admin for now (the figures
--    live with Gathering Israel); a sync can write the same rows later.

alter table public.areas
  add column slug                text,  -- assignedtolabor.org/<slug>
  add column referral_form_url   text,  -- the team's form; a Google Form is shown on the page, anything else is forwarded to
  add column referral_form_title text;  -- the form's own title, read when the link is saved (the page's title)
alter table public.areas
  add constraint areas_slug_format check (slug is null or slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$');
create unique index areas_slug_key on public.areas (slug) where slug is not null;

-- Existing teams get their name as the address (philippines, english, ...), where that is unambiguous.
update public.areas a
   set slug = s.slug
  from (select id, lower(regexp_replace(btrim(name), '[^a-zA-Z0-9]+', '-', 'g')) as slug from public.areas) s
 where s.id = a.id
   and a.slug is null
   and s.slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'
   and (select count(*) from public.areas b where lower(regexp_replace(btrim(b.name), '[^a-zA-Z0-9]+', '-', 'g')) = s.slug) = 1;

-- How often a team's page was opened, per UTC day. No visitor data, only the count.
create table public.team_page_days (
  area_id uuid not null references public.areas(id) on delete cascade,
  day     date not null,
  opens   integer not null default 0,
  primary key (area_id, day)
);
alter table public.team_page_days enable row level security;
create policy team_page_days_select on public.team_page_days for select using (public.is_team_member(area_id));

-- Counted by the server (service role) when the page reports it was opened.
create or replace function public.bump_team_page(aid uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.team_page_days (area_id, day, opens)
  values (aid, (now() at time zone 'utc')::date, 1)
  on conflict (area_id, day) do update set opens = public.team_page_days.opens + 1;
$$;
revoke all on function public.bump_team_page(uuid) from public, anon, authenticated;
grant execute on function public.bump_team_page(uuid) to service_role;

-- Running totals for a team as of a day. The newest row is what the dashboard shows;
-- the one before it gives "+N since ...". One row per team per day (a correction the
-- same day replaces it).
create table public.team_impact_reports (
  id         uuid primary key default gen_random_uuid(),
  area_id    uuid not null references public.areas(id) on delete cascade,
  as_of      date not null default (now() at time zone 'utc')::date,
  requests   integer check (requests >= 0),   -- people who filled in the form
  referrals  integer check (referrals >= 0),  -- people sent on to the missionaries
  baptisms   integer check (baptisms >= 0),
  source     text not null default 'manual',  -- 'manual' today; a sync names itself here
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (area_id, as_of),
  check (requests is not null or referrals is not null or baptisms is not null)
);
alter table public.team_impact_reports enable row level security;
create policy team_impact_reports_select on public.team_impact_reports for select using (public.is_team_member(area_id));
create policy team_impact_reports_write on public.team_impact_reports for all using (public.can_manage_area(area_id)) with check (public.can_manage_area(area_id));

-- Short stories for the team: someone the channel reached, told by a lead or an admin.
create table public.team_stories (
  id          uuid primary key default gen_random_uuid(),
  area_id     uuid not null references public.areas(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 120),
  body        text not null check (char_length(body) between 1 and 4000),
  happened_on date,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index team_stories_area on public.team_stories (area_id, created_at desc);
alter table public.team_stories enable row level security;
create policy team_stories_select on public.team_stories for select using (public.is_team_member(area_id));
create policy team_stories_write on public.team_stories for all using (public.can_manage_area(area_id)) with check (public.can_manage_area(area_id));
