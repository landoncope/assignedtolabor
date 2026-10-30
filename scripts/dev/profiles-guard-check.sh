#!/bin/bash
# Checks who may change what on a profile (the guard_profile_update trigger and the RLS
# policies around it) by acting as throwaway users inside ONE transaction that is
# rolled back at the end. Nothing is left behind; safe against the live project.
#   scripts/dev/profiles-guard-check.sh                     # against the applied schema
#   scripts/dev/profiles-guard-check.sh --with-migration    # apply the migration inside the transaction first
set -euo pipefail
cd "$(dirname "$0")/../.."
DBURL=$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)
MIG=""
if [ "${1:-}" = "--with-migration" ]; then MIG="\\i supabase/migrations/20261030100000_guard_profiles.sql"; fi

psql "$DBURL" -X -q -v ON_ERROR_STOP=1 -P pager=off <<SQL
begin;
$MIG
set local client_min_messages = notice;

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'guard-sqlcheck-m@example.com',   now(), false, '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-4666-8666-666666666666', 'authenticated', 'authenticated', 'guard-sqlcheck-adm@example.com', now(), false, '{}', '{}', now(), now());
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
  m uuid := '33333333-3333-4333-8333-333333333333'; adm uuid := '66666666-6666-4666-8666-666666666666';
  rec public.profiles%rowtype; n int;
begin
  set local role authenticated;
  perform pg_temp.act_as(m);
  perform pg_temp.fails('a member cannot make themselves admin', format(\$q\$ update public.profiles set role = 'admin' where id = '%s' \$q\$, m), 'not allowed');
  perform pg_temp.fails('a member cannot change their mirrored email', format(\$q\$ update public.profiles set email = 'other@example.com' where id = '%s' \$q\$, m), 'not allowed');
  perform pg_temp.fails('a member cannot change their anonymous flag', format(\$q\$ update public.profiles set is_anonymous = true where id = '%s' \$q\$, m), 'not allowed');
  update public.profiles set display_name = 'Mia Member' where id = m;
  select * into rec from public.profiles where id = m;
  perform pg_temp.ok('a member can change their own name', rec.display_name = 'Mia Member' and rec.role = 'member');
  update public.profiles set display_name = 'Nope' where id = adm;
  get diagnostics n = row_count;
  perform pg_temp.ok('a member cannot touch another profile at all', n = 0);
  perform pg_temp.act_as(adm);
  update public.profiles set role = 'admin' where id = m;
  select * into rec from public.profiles where id = m;
  perform pg_temp.ok('an admin can promote someone', rec.role = 'admin');
  update public.profiles set role = 'member' where id = m;
  select * into rec from public.profiles where id = m;
  perform pg_temp.ok('and demote them again', rec.role = 'member');
  reset role;
  update public.profiles set role = 'admin', email = 'renamed@example.com' where id = m;
  select * into rec from public.profiles where id = m;
  perform pg_temp.ok('a caller with no user id (service role, auth triggers) is not restricted', rec.role = 'admin' and rec.email = 'renamed@example.com');
end \$\$;

rollback;
SQL
echo "rolled back; nothing was kept"
