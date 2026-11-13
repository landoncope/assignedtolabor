#!/bin/bash
# Checks the rules for team pages and "what the channel has led to" (2026-11-12): the
# page address format and uniqueness, who may read and write a team's figures and
# stories, and that the page-open counter can only be bumped by the server. Throwaway
# users inside ONE transaction that is rolled back at the end: nothing is left behind,
# safe against the live project, no captcha changes.
#   scripts/dev/impact-sql-check.sh                     # against the applied schema
#   scripts/dev/impact-sql-check.sh --with-migration    # apply the migration inside the transaction first
set -euo pipefail
cd "$(dirname "$0")/../.."
DBURL=$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)
MIG=""
if [ "${1:-}" = "--with-migration" ]; then MIG="\\i supabase/migrations/20261112120000_team_pages_impact.sql"; fi

psql "$DBURL" -X -q -v ON_ERROR_STOP=1 -P pager=off <<SQL
begin;
$MIG
set local client_min_messages = notice;

-- Throwaway people: a member, a lead, an outsider, an admin.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'impact-sqlcheck-m@example.com',   now(), false, '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'impact-sqlcheck-l@example.com',   now(), false, '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', 'impact-sqlcheck-o@example.com',   now(), false, '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-4666-8666-666666666666', 'authenticated', 'authenticated', 'impact-sqlcheck-adm@example.com', now(), false, '{}', '{}', now(), now());
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
  team uuid; other uuid; story uuid; n int; rep public.team_impact_reports%rowtype;
begin
  insert into public.areas (name, language, sort_order) values ('Qo''noS Impact', 'Klingon', 999) returning id into team;
  insert into public.areas (name, language, sort_order) values ('Qo''noS Other', 'Klingon', 999) returning id into other;
  insert into public.area_members (area_id, user_id) values (team, m);
  insert into public.area_managers (area_id, user_id) values (team, l);

  -- The page address
  update public.areas set slug = 'qonos-impact' where id = team;
  perform pg_temp.ok('a team takes a page address', (select slug from public.areas where id = team) = 'qonos-impact');
  perform pg_temp.fails('two teams cannot share an address', format(\$q\$ update public.areas set slug = 'qonos-impact' where id = '%s' \$q\$, other), 'areas_slug_key');
  perform pg_temp.fails('capitals and spaces are refused', format(\$q\$ update public.areas set slug = 'Qonos Impact' where id = '%s' \$q\$, other), 'areas_slug_format');
  perform pg_temp.fails('so is a two-letter address', format(\$q\$ update public.areas set slug = 'qo' where id = '%s' \$q\$, other), 'areas_slug_format');
  update public.areas set slug = null where id = other;
  perform pg_temp.ok('teams without an address do not collide', (select count(*) from public.areas where slug is null and id in (other)) = 1);

  -- Opens are counted by the server only
  perform public.bump_team_page(team);
  perform public.bump_team_page(team);
  perform pg_temp.ok('two opens on one day make one row of 2', (select opens from public.team_page_days where area_id = team) = 2 and (select count(*) from public.team_page_days where area_id = team) = 1);
  set local role authenticated;
  perform pg_temp.act_as(m);
  perform pg_temp.fails('a signed-in member cannot bump the counter', format(\$q\$ select public.bump_team_page('%s') \$q\$, team), 'permission denied');
  perform pg_temp.fails('nor write the count directly', format(\$q\$ insert into public.team_page_days (area_id, day, opens) values ('%s', current_date - 1, 999) \$q\$, team), 'row-level security');
  select coalesce(sum(opens), 0) into n from public.team_page_days where area_id = team;
  perform pg_temp.ok('a member reads their team''s opens', n = 2);
  perform pg_temp.act_as(o);
  select coalesce(sum(opens), 0) into n from public.team_page_days where area_id = team;
  perform pg_temp.ok('an outsider reads none', n = 0);
  reset role;
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform pg_temp.fails('a visitor with no session cannot bump it either', format(\$q\$ select public.bump_team_page('%s') \$q\$, team), 'permission denied');
  reset role;

  -- The figures
  set local role authenticated;
  perform pg_temp.act_as(m);
  perform pg_temp.fails('a member cannot enter figures', format(\$q\$ insert into public.team_impact_reports (area_id, requests) values ('%s', 5) \$q\$, team), 'row-level security');
  perform pg_temp.act_as(l);
  insert into public.team_impact_reports (area_id, as_of, requests, referrals, baptisms, created_by) values (team, current_date - 7, 10, 4, 0, l);
  insert into public.team_impact_reports (area_id, as_of, requests, referrals, baptisms, created_by) values (team, current_date, 14, 6, 1, l);
  perform pg_temp.ok('the lead enters figures for two days', (select count(*) from public.team_impact_reports where area_id = team) = 2);
  perform pg_temp.fails('one row per team per day', format(\$q\$ insert into public.team_impact_reports (area_id, as_of, requests) values ('%s', current_date, 15) \$q\$, team), 'duplicate');
  insert into public.team_impact_reports (area_id, as_of, requests, referrals, baptisms) values (team, current_date, 15, 6, 1)
    on conflict (area_id, as_of) do update set requests = excluded.requests, referrals = excluded.referrals, baptisms = excluded.baptisms;
  select * into rep from public.team_impact_reports where area_id = team order by as_of desc limit 1;
  perform pg_temp.ok('saving again the same day corrects it', rep.requests = 15 and rep.baptisms = 1);
  perform pg_temp.fails('a negative figure is refused', format(\$q\$ insert into public.team_impact_reports (area_id, as_of, baptisms) values ('%s', current_date - 1, -1) \$q\$, team), 'check');
  perform pg_temp.fails('so is a report with no figure at all', format(\$q\$ insert into public.team_impact_reports (area_id, as_of) values ('%s', current_date - 2) \$q\$, team), 'check');
  perform pg_temp.fails('the lead cannot enter figures for another team', format(\$q\$ insert into public.team_impact_reports (area_id, requests) values ('%s', 5) \$q\$, other), 'row-level security');
  perform pg_temp.act_as(m);
  select count(*) into n from public.team_impact_reports where area_id = team;
  perform pg_temp.ok('a member reads the team''s figures', n = 2);
  update public.team_impact_reports set baptisms = 99 where area_id = team;
  perform pg_temp.ok('but cannot change them', (select max(baptisms) from public.team_impact_reports where area_id = team) = 1);
  perform pg_temp.act_as(o);
  select count(*) into n from public.team_impact_reports where area_id = team;
  perform pg_temp.ok('an outsider reads no figures', n = 0);
  perform pg_temp.act_as(adm);
  insert into public.team_impact_reports (area_id, as_of, requests) values (other, current_date, 3);
  select count(*) into n from public.team_impact_reports;
  perform pg_temp.ok('an admin reads and writes any team''s figures', n >= 3);

  -- Stories
  perform pg_temp.act_as(m);
  perform pg_temp.fails('a member cannot add a story', format(\$q\$ insert into public.team_stories (area_id, title, body) values ('%s', 't', 'b') \$q\$, team), 'row-level security');
  perform pg_temp.act_as(l);
  insert into public.team_stories (area_id, title, body, happened_on, created_by) values (team, 'Worf was baptized', 'He found the channel in March.', current_date - 3, l) returning id into story;
  perform pg_temp.fails('a story needs a title', format(\$q\$ insert into public.team_stories (area_id, title, body) values ('%s', '', 'b') \$q\$, team), 'check');
  perform pg_temp.act_as(m);
  select count(*) into n from public.team_stories where area_id = team;
  perform pg_temp.ok('a member reads the team''s stories', n = 1);
  delete from public.team_stories where id = story;
  perform pg_temp.ok('but cannot delete one', (select count(*) from public.team_stories where id = story) = 1);
  perform pg_temp.act_as(o);
  select count(*) into n from public.team_stories where area_id = team;
  perform pg_temp.ok('an outsider reads no stories', n = 0);
  perform pg_temp.act_as(l);
  update public.team_stories set title = 'Worf was baptized in May' where id = story;
  delete from public.team_stories where id = story;
  perform pg_temp.ok('the lead corrects and removes a story', (select count(*) from public.team_stories where id = story) = 0);
  reset role;
end \$\$;

rollback;
SQL
echo "rolled back; nothing was kept"
