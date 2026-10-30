#!/bin/bash
# Checks the dashboard's rules in the database (2026-10-30): the upload goal columns
# and their trigger, team_goal_report (the lead's view), team_overview (a member's
# view of the team), who may read a member's phone number, and that instagram_stats
# is unreadable through the public API. Throwaway users inside ONE transaction that is
# rolled back at the end: nothing is left behind, safe against the live project, no
# captcha changes.
#   scripts/dev/dashboard-sql-check.sh                     # against the applied schema
#   scripts/dev/dashboard-sql-check.sh --with-migration    # apply the migration inside the transaction first
set -euo pipefail
cd "$(dirname "$0")/../.."
DBURL=$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)
MIG=""
if [ "${1:-}" = "--with-migration" ]; then MIG="\\i supabase/migrations/20261030120000_dashboard_goals.sql"; fi

psql "$DBURL" -X -q -v ON_ERROR_STOP=1 -P pager=off <<SQL
begin;
$MIG
set local client_min_messages = notice;

-- Throwaway people: a member, a lead, an outsider, an admin.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'dash-sqlcheck-m@example.com',   now(), false, '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'dash-sqlcheck-l@example.com',   now(), false, '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', 'dash-sqlcheck-o@example.com',   now(), false, '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-4666-8666-666666666666', 'authenticated', 'authenticated', 'dash-sqlcheck-adm@example.com', now(), false, '{}', '{}', now(), now());
update public.profiles set role = 'admin' where id = '66666666-6666-4666-8666-666666666666';

create function pg_temp.act_as(uid uuid) returns void language plpgsql as \$\$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
end \$\$;
create function pg_temp.ok(label text, cond boolean) returns void language plpgsql as \$\$
begin
  if cond is distinct from true then raise exception 'FAIL  %', label; end if;
  raise notice 'PASS  %', label;
end \$\$;
create function pg_temp.fails(label text, stmt text, expect text default null) returns void language plpgsql as \$\$
begin
  begin
    execute stmt;
  exception when others then
    if expect is not null and position(lower(expect) in lower(sqlerrm)) = 0 then raise exception 'FAIL  % (wrong error: %)', label, sqlerrm; end if;
    raise notice 'PASS  % -> %', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL  % (no error raised)', label;
end \$\$;

do \$\$
declare
  m uuid := '33333333-3333-4333-8333-333333333333'; l uuid := '44444444-4444-4444-8444-444444444444';
  o uuid := '55555555-5555-4555-8555-555555555555'; adm uuid := '66666666-6666-4666-8666-666666666666';
  team uuid; vid uuid; n int; t1 timestamptz; rec record; prof public.profiles%rowtype;
begin
  insert into public.areas (name, language, sort_order) values ('Qo''noS Dashboard', 'Klingon', 999) returning id into team;
  insert into public.area_members (area_id, user_id) values (team, m);
  insert into public.area_managers (area_id, user_id) values (team, l);

  -- The goal and its clock
  set local role authenticated;
  perform pg_temp.act_as(m);
  update public.profiles set upload_goal = 'weekly' where id = m;
  select * into prof from public.profiles where id = m;
  perform pg_temp.ok('choosing a goal starts its clock', prof.upload_goal = 'weekly' and prof.upload_goal_set_at is not null and prof.goal_reminded_for is null);
  t1 := prof.upload_goal_set_at;
  update public.profiles set goal_reminded_for = now() where id = m;
  update public.profiles set upload_goal = 'monthly' where id = m;
  select * into prof from public.profiles where id = m;
  perform pg_temp.ok('changing the goal restarts the clock and forgets the reminder', prof.upload_goal = 'monthly' and prof.upload_goal_set_at >= t1 and prof.goal_reminded_for is null);
  perform pg_temp.fails('a goal outside the four is refused', format(\$q\$ update public.profiles set upload_goal = 'daily' where id = '%s' \$q\$, m), 'check');
  perform pg_temp.fails('a member still cannot make themselves admin', format(\$q\$ update public.profiles set role = 'admin' where id = '%s' \$q\$, m), 'not allowed');
  update public.profiles set display_name = 'Mia Member', phone = '+1 801 555 0100' where id = m;
  select * into prof from public.profiles where id = m;
  perform pg_temp.ok('a member sets their name and phone number', prof.display_name = 'Mia Member' and prof.phone = '+1 801 555 0100');

  -- Who sees the phone number
  perform pg_temp.act_as(l);
  select phone into rec from public.profiles where id = m;
  perform pg_temp.ok('the team''s lead can read a member''s phone number', rec.phone = '+1 801 555 0100');
  perform pg_temp.act_as(o);
  select count(*) into n from public.profiles where id = m;
  perform pg_temp.ok('an outsider cannot read the member''s profile at all', n = 0);

  -- The lead's view
  perform pg_temp.act_as(l);
  select count(*) into n from public.team_goal_report(team);
  perform pg_temp.ok('the lead''s view lists everyone on the team (member and lead)', n = 2);
  select * into rec from public.team_goal_report(team) r where r.user_id = m;
  perform pg_temp.ok('with the member''s goal, phone and no uploads yet', rec.upload_goal = 'monthly' and rec.phone = '+1 801 555 0100' and rec.is_lead = false and rec.last_upload_at is null and rec.uploads_30d = 0 and rec.videos_total = 0);
  select * into rec from public.team_goal_report(team) r where r.user_id = l;
  perform pg_temp.ok('and the lead marked as a lead', rec.is_lead = true);
  perform pg_temp.act_as(m);
  select count(*) into n from public.team_goal_report(team);
  perform pg_temp.ok('a member gets no rows from the lead''s view', n = 0);
  perform pg_temp.act_as(o);
  select count(*) into n from public.team_goal_report(team);
  perform pg_temp.ok('an outsider gets no rows from the lead''s view', n = 0);
  perform pg_temp.act_as(adm);
  select count(*) into n from public.team_goal_report(team);
  perform pg_temp.ok('an admin gets the lead''s view of any team', n = 2);

  -- An upload shows up in both views
  reset role;
  insert into public.videos (user_id, area_id, status, language) values (m, team, 'pending', 'Klingon') returning id into vid;
  set local role authenticated;
  perform pg_temp.act_as(l);
  select * into rec from public.team_goal_report(team) r where r.user_id = m;
  perform pg_temp.ok('the member''s upload becomes their last video in the lead''s view', rec.last_upload_at is not null and rec.uploads_30d = 1 and rec.videos_total = 1);
  perform pg_temp.act_as(m);
  select * into rec from public.team_overview(team);
  perform pg_temp.ok('a member sees the team overview', rec.people = 2 and rec.uploads_30d = 1 and rec.pending = 1 and rec.posted_30d = 0 and rec.last_upload_at is not null);
  perform pg_temp.ok('is_team_member: member yes', public.is_team_member(team));
  perform pg_temp.act_as(l);
  perform pg_temp.ok('is_team_member: lead yes', public.is_team_member(team));
  perform pg_temp.act_as(o);
  perform pg_temp.ok('is_team_member: outsider no', not public.is_team_member(team));
  select count(*) into n from public.team_overview(team);
  perform pg_temp.ok('an outsider gets no team overview', n = 0);
  perform pg_temp.act_as(adm);
  select count(*) into n from public.team_overview(team);
  perform pg_temp.ok('an admin gets any team''s overview', n = 1);

  -- The cached Instagram numbers are for the server only
  reset role;
  insert into public.instagram_stats (area_id, username, profile) values (team, 'mock', '{"followers": 5}'::jsonb);
  set local role authenticated;
  perform pg_temp.act_as(m);
  select count(*) into n from public.instagram_stats;
  perform pg_temp.ok('a member cannot read instagram_stats through the API', n = 0);
  perform pg_temp.act_as(adm);
  select count(*) into n from public.instagram_stats;
  perform pg_temp.ok('nor can an admin (no policies; pages use the service role)', n = 0);

  -- Removing the goal
  perform pg_temp.act_as(m);
  update public.profiles set upload_goal = null where id = m;
  select * into prof from public.profiles where id = m;
  perform pg_temp.ok('removing the goal clears its clock', prof.upload_goal is null and prof.upload_goal_set_at is null and prof.goal_reminded_for is null);
  reset role;
end \$\$;

rollback;
SQL
echo "rolled back; nothing was kept"
