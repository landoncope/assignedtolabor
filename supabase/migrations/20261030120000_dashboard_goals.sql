-- Dashboard (2026-10-30, Travis's request): an upload goal per person with email
-- reminders as the next video comes due, the lead's view of each member's goal and
-- last upload, and the team's Instagram numbers, cached for the dashboard.

alter table public.profiles
  add column upload_goal        text check (upload_goal in ('twice_weekly', 'weekly', 'twice_monthly', 'monthly')),
  add column upload_goal_set_at timestamptz,
  add column goal_reminded_for  timestamptz,  -- the due date the last reminder email was about
  add column phone              text;         -- optional, typed by the person so their team lead can text them

-- The guard from 20261030100000, plus the goal's bookkeeping: when the goal changes
-- the clock restarts and the reminder slate is wiped, whoever makes the change.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.upload_goal is distinct from old.upload_goal then
    new.upload_goal_set_at := case when new.upload_goal is null then null else now() end;
    new.goal_reminded_for := null;
  end if;
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.id <> old.id
     or new.role is distinct from old.role
     or new.email is distinct from old.email
     or new.is_anonymous is distinct from old.is_anonymous
     or new.created_at is distinct from old.created_at then
    raise exception 'not allowed';
  end if;
  return new;
end;
$$;

-- On the team: a member, a lead, or an admin.
create or replace function public.is_team_member(aid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_manage_area(aid)
      or exists (select 1 from public.area_members m where m.area_id = aid and m.user_id = auth.uid());
$$;

-- The team's own numbers for its members' dashboards. No rows for anyone else.
create or replace function public.team_overview(aid uuid)
returns table (people integer, uploads_30d integer, posted_30d integer, pending integer, posted_total integer, last_upload_at timestamptz, last_posted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from (select m.user_id from public.area_members m where m.area_id = aid
                                union select g.user_id from public.area_managers g where g.area_id = aid) p),
    (select count(*)::int from public.videos v where v.area_id = aid and v.created_at > now() - interval '30 days'),
    (select count(*)::int from public.videos v where v.area_id = aid and v.status = 'posted' and v.posted_at > now() - interval '30 days'),
    (select count(*)::int from public.videos v where v.area_id = aid and v.status = 'pending'),
    (select count(*)::int from public.videos v where v.area_id = aid and v.status = 'posted'),
    (select max(v.created_at) from public.videos v where v.area_id = aid),
    (select max(v.posted_at) from public.videos v where v.area_id = aid and v.status = 'posted')
  where public.is_team_member(aid);
$$;

-- The lead's view: everyone on the team with their goal and their uploads (all of a
-- person's uploads count, whichever team they went to: the goal is theirs, not the
-- team's). Leads of the team and admins; anyone else gets no rows.
create or replace function public.team_goal_report(aid uuid)
returns table (
  user_id uuid, display_name text, email text, phone text, is_lead boolean, member_since timestamptz,
  upload_goal text, upload_goal_set_at timestamptz,
  last_upload_at timestamptz, uploads_30d integer, videos_total integer, last_posted_at timestamptz
)
language sql stable security definer set search_path = public as $$
  with people as (
    select x.uid, min(x.since) as member_since, bool_or(x.lead) as is_lead
      from (select m.user_id as uid, m.created_at as since, false as lead from public.area_members m where m.area_id = aid
            union all
            select g.user_id, g.created_at, true from public.area_managers g where g.area_id = aid) x
     group by x.uid
  )
  select p.id, p.display_name, p.email, p.phone, pe.is_lead, pe.member_since,
         p.upload_goal, p.upload_goal_set_at,
         (select max(v.created_at) from public.videos v where v.user_id = p.id),
         (select count(*)::int from public.videos v where v.user_id = p.id and v.created_at > now() - interval '30 days'),
         (select count(*)::int from public.videos v where v.user_id = p.id),
         (select max(v.posted_at) from public.videos v where v.user_id = p.id and v.status = 'posted')
    from people pe
    join public.profiles p on p.id = pe.uid
   where public.can_manage_area(aid)
   order by pe.is_lead, lower(coalesce(p.display_name, p.email, ''));
$$;

revoke all on function public.is_team_member(uuid) from public;
grant execute on function public.is_team_member(uuid) to authenticated;
revoke all on function public.team_overview(uuid) from public;
grant execute on function public.team_overview(uuid) to authenticated;
revoke all on function public.team_goal_report(uuid) from public;
grant execute on function public.team_goal_report(uuid) to authenticated;

-- What Instagram says about a team's account, fetched by the server with the team's
-- token (src/lib/instagram-stats.ts) and shown on its members' dashboards. RLS is on
-- with NO policies: pages read it with the service role after checking the viewer is
-- on the team, so a browser session can never read another team's numbers.
create table public.instagram_stats (
  area_id      uuid primary key references public.areas(id) on delete cascade,
  username     text,
  fetched_at   timestamptz not null default now(),  -- the last attempt
  succeeded_at timestamptz,                         -- the last answer the numbers come from
  profile      jsonb,   -- followers, follows, media count, picture
  media        jsonb,   -- the recent posts, newest first, with likes and comments (views and reach with the insights permission)
  insights     jsonb,   -- the last 30 days of reach and views, when Instagram granted instagram_business_manage_insights
  error        text     -- why the last attempt failed, if it did
);
alter table public.instagram_stats enable row level security;
