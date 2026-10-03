#!/bin/bash
# Checks the team lead application rules in the database (lead_start, lead_claim,
# lead_attach_video, decide_lead_application and the row-level security around them)
# by acting as throwaway users inside ONE transaction that is rolled back at the end.
# Nothing is left behind, so it is safe against the live project, and it needs no
# captcha changes (it never signs in; it sets the JWT claims Postgres would see).
#   scripts/dev/lead-sql-check.sh                     # against the applied schema
#   scripts/dev/lead-sql-check.sh --with-migration    # apply the migration inside the transaction first
set -euo pipefail
cd "$(dirname "$0")/../.."
DBURL=$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)
MIG=""
if [ "${1:-}" = "--with-migration" ]; then MIG="\\i supabase/migrations/20261003120000_lead_applications.sql"; fi

psql "$DBURL" -X -q -v ON_ERROR_STOP=1 -P pager=off <<SQL
begin;
$MIG
set local client_min_messages = notice;

-- Throwaway people: two sessions without an account, an applicant, a second applicant, an outsider, an admin.
insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', null, null, true,  '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', null, null, true,  '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'lead-sqlcheck-r@example.com',  now(), false, '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'lead-sqlcheck-r2@example.com', now(), false, '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', 'lead-sqlcheck-out@example.com', now(), false, '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '66666666-6666-4666-8666-666666666666', 'authenticated', 'authenticated', 'lead-sqlcheck-adm@example.com', now(), false, '{}', '{}', now(), now());
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
  a uuid := '11111111-1111-4111-8111-111111111111'; b uuid := '22222222-2222-4222-8222-222222222222';
  r uuid := '33333333-3333-4333-8333-333333333333'; r2 uuid := '44444444-4444-4444-8444-444444444444';
  outsider uuid := '55555555-5555-4555-8555-555555555555'; adm uuid := '66666666-6666-4666-8666-666666666666';
  app uuid; appb uuid; app2 uuid; app3 uuid; got uuid; team uuid; english uuid; n int; rec public.lead_applications%rowtype;
begin
  -- Part 1 from a session with no account
  perform pg_temp.act_as(a);
  app := public.lead_start('Lead-SqlCheck-TYPO@example.com', '  Ana   Applicant ', '+1 (801) 555-0100', 'Klingon', 'Young adults on Qo''noS', 'Because I care.');
  select * into rec from public.lead_applications where id = app;
  perform pg_temp.ok('a session without an account can start an application', rec.status = 'started' and rec.user_id is null and rec.started_by = a);
  perform pg_temp.ok('the address is stored lower-cased and the name tidied', rec.email = 'lead-sqlcheck-typo@example.com' and rec.full_name = 'Ana Applicant');
  got := public.lead_start('lead-sqlcheck-r@example.com', 'Ana Applicant', '+1 801 555 0100', 'Klingon', 'Young adults on Qo''noS', 'Because I care, a lot.');
  select * into rec from public.lead_applications where id = app;
  perform pg_temp.ok('the same session can correct its address and answers (same application)', got = app and rec.email = 'lead-sqlcheck-r@example.com' and rec.why = 'Because I care, a lot.');
  perform pg_temp.fails('a phone number with letters is refused', \$q\$ select public.lead_start('x@example.com', 'Ana', 'call me', 'Klingon', 'Somewhere', 'Why') \$q\$, 'phone');
  perform pg_temp.fails('a malformed email is refused', \$q\$ select public.lead_start('not-an-email', 'Ana', '8015550100', 'Klingon', 'Somewhere', 'Why') \$q\$, 'email');
  perform pg_temp.fails('an empty reason is refused', \$q\$ select public.lead_start('x@example.com', 'Ana', '8015550100', 'Klingon', 'Somewhere', ' ') \$q\$, 'why');

  -- A different session types the same address
  perform pg_temp.act_as(b);
  appb := public.lead_start('lead-sqlcheck-b@example.com', 'Mallory', '8015550199', 'Elvish', 'Nobody', 'Mischief');
  perform pg_temp.ok('a second session starts its own application under its own address', appb <> app);
  got := public.lead_start('LEAD-sqlcheck-r@example.com', 'Mallory', '8015550199', 'Elvish', 'Nobody', 'Mischief');
  select * into rec from public.lead_applications where id = app;
  perform pg_temp.ok('naming an address that already has an application returns that application', got = app);
  perform pg_temp.ok('without overwriting it', rec.full_name = 'Ana Applicant' and rec.language = 'Klingon' and rec.started_by = a);
  select count(*) into n from public.lead_applications where started_by = b and email = 'lead-sqlcheck-b@example.com';
  perform pg_temp.ok('and the second session''s own draft is left as it was', n = 1);

  -- Row-level security before anyone has confirmed the address
  set local role authenticated;
  perform pg_temp.act_as(a);
  select count(*) into n from public.lead_applications;
  perform pg_temp.ok('the starting session can read its own draft', n = 1);
  perform pg_temp.act_as(b);
  select count(*) into n from public.lead_applications where id = app;
  perform pg_temp.ok('the other session cannot read it', n = 0);
  select count(*) into n from public.lead_applications;
  perform pg_temp.ok('the other session reads only its own draft', n = 1);
  perform pg_temp.fails('nobody can insert an application directly', \$q\$ insert into public.lead_applications (email, full_name, phone, language, audience, why) values ('z@example.com', 'Z', '8015550100', 'L', 'A', 'W') \$q\$);
  perform pg_temp.act_as(a);
  update public.lead_applications set status = 'approved';
  get diagnostics n = row_count;
  perform pg_temp.ok('nobody can update an application directly', n = 0);
  reset role;

  -- The address owner arrives (email link, Google, or an account they already had)
  perform pg_temp.act_as(outsider);
  perform pg_temp.ok('an account with a different address has nothing to claim', public.lead_claim() is null);
  perform pg_temp.act_as(a);
  perform pg_temp.ok('a session without an account cannot claim', public.lead_claim() is null);
  perform pg_temp.act_as(r);
  got := public.lead_claim();
  select * into rec from public.lead_applications where id = app;
  perform pg_temp.ok('the account that owns the address claims the application', got = app and rec.user_id = r);
  perform pg_temp.ok('and takes the applicant''s name when it had none', (select display_name from public.profiles where id = r) = 'Ana Applicant');
  perform pg_temp.ok('claiming again returns the same application', public.lead_claim() = app);
  set local role authenticated;
  perform pg_temp.act_as(a);
  select count(*) into n from public.lead_applications;
  perform pg_temp.ok('once claimed, the starting session no longer reads it', n = 0);
  perform pg_temp.act_as(r);
  select count(*) into n from public.lead_applications;
  perform pg_temp.ok('the owner reads it', n = 1);
  reset role;
  perform pg_temp.act_as(r);
  got := public.lead_start('someone-else@example.com', 'Ana A. Applicant', '+1 801 555 0100', 'Klingon', 'Families on Qo''noS', 'Edited answer.');
  select * into rec from public.lead_applications where id = app;
  perform pg_temp.ok('the owner can edit their answers; the typed address is ignored for an account', got = app and rec.email = 'lead-sqlcheck-r@example.com' and rec.audience = 'Families on Qo''noS');

  -- Part 2
  perform pg_temp.fails('a video path outside the caller''s folder is refused', format(\$q\$ select public.lead_attach_video('%s/lead-1.mp4', 'video/mp4', 1000, 30, null, null) \$q\$, outsider), 'not allowed');
  perform pg_temp.fails('a video that was never uploaded is refused', format(\$q\$ select public.lead_attach_video('%s/lead-missing.mp4', 'video/mp4', 1000, 30, null, null) \$q\$, r), 'did not finish');
  insert into storage.objects (bucket_id, name, owner) values ('videos', r::text || '/lead-1.mp4', r);
  got := public.lead_attach_video(r::text || '/lead-1.mp4', 'video/mp4', 123456, 42, 'data:image/jpeg;base64,AAAA', '{"ua":"sql-check"}'::jsonb);
  select * into rec from public.lead_applications where id = app;
  perform pg_temp.ok('the uploaded video is attached and the application is submitted', got = app and rec.status = 'submitted' and rec.video_path = r::text || '/lead-1.mp4' and rec.submitted_at is not null and rec.video_seconds = 42);
  perform pg_temp.fails('a second video cannot be attached to a submitted application', format(\$q\$ select public.lead_attach_video('%s/lead-1.mp4', 'video/mp4', 1, 1, null, null) \$q\$, r), 'no application');
  got := public.lead_start(null, 'Changed Name', '+1 801 555 0100', 'Klingon', 'x y', 'zz');
  select * into rec from public.lead_applications where id = app;
  perform pg_temp.ok('a submitted application is no longer editable', got = app and rec.full_name = 'Ana A. Applicant');

  -- Storage: who may read the application video
  set local role authenticated;
  perform pg_temp.act_as(outsider);
  select count(*) into n from storage.objects where bucket_id = 'videos' and name = r::text || '/lead-1.mp4';
  perform pg_temp.ok('another account cannot read the application video', n = 0);
  perform pg_temp.act_as(adm);
  select count(*) into n from storage.objects where bucket_id = 'videos' and name = r::text || '/lead-1.mp4';
  perform pg_temp.ok('an admin can read the application video', n = 1);
  select count(*) into n from public.lead_applications;
  perform pg_temp.ok('an admin reads every application', n >= 1);
  reset role;

  -- The decision
  perform pg_temp.act_as(r);
  perform pg_temp.fails('the applicant cannot decide their own application', format(\$q\$ select public.decide_lead_application('%s', true, null, null, 'Klingon', null) \$q\$, app), 'not allowed');
  perform pg_temp.act_as(adm);
  perform pg_temp.fails('approving without a team or a team name is refused', format(\$q\$ select public.decide_lead_application('%s', true, null, null, null, null) \$q\$, app), 'pick a team');
  select id into english from public.areas where is_active and lower(language) = 'english' limit 1;
  perform pg_temp.fails('a new team for a language that already has one is refused', format(\$q\$ select public.decide_lead_application('%s', true, null, null, 'English Two', 'english') \$q\$, app), 'already');
  team := public.decide_lead_application(app, true, 'Welcome aboard', null, 'Qo''noS', null);
  select * into rec from public.lead_applications where id = app;
  perform pg_temp.ok('an admin approves and a team is created for the applicant''s language', rec.status = 'approved' and rec.area_id = team and rec.decided_by = adm and rec.decision_note = 'Welcome aboard'
    and exists (select 1 from public.areas where id = team and name = 'Qo''noS' and language = 'Klingon'));
  perform pg_temp.ok('the applicant is now that team''s lead and a member', exists (select 1 from public.area_managers where area_id = team and user_id = r and notified_at is not null)
    and exists (select 1 from public.area_members where area_id = team and user_id = r));
  perform pg_temp.fails('a decided application cannot be decided again', format(\$q\$ select public.decide_lead_application('%s', false, null, null, null, null) \$q\$, app), 'already decided');

  -- A second applicant, who has an account already, approved onto an existing team
  perform pg_temp.act_as(r2);
  app2 := public.lead_start(null, 'Rae Second', '801-555-0142', 'English', 'Utah Valley', 'I post every day already.');
  select * into rec from public.lead_applications where id = app2;
  perform pg_temp.ok('an account applies under its own address and owns the application at once', rec.user_id = r2 and rec.email = 'lead-sqlcheck-r2@example.com' and rec.status = 'started');
  perform pg_temp.ok('lead_claim finds it', public.lead_claim() = app2);
  perform pg_temp.act_as(adm);
  perform pg_temp.fails('an application without a video cannot be approved', format(\$q\$ select public.decide_lead_application('%s', true, null, '%s', null, null) \$q\$, app2, english), 'no video');
  perform pg_temp.act_as(r2);
  insert into storage.objects (bucket_id, name, owner) values ('videos', r2::text || '/lead-2.mp4', r2);
  perform public.lead_attach_video(r2::text || '/lead-2.mp4', 'video/mp4', 5000, 20, null, null);
  perform pg_temp.act_as(adm);
  got := public.decide_lead_application(app2, true, null, english, null, null);
  perform pg_temp.ok('an admin approves onto an existing team', got = english and exists (select 1 from public.area_managers where area_id = english and user_id = r2));

  -- Declining, and applying again
  perform pg_temp.act_as(outsider);
  app3 := public.lead_start(null, 'Otto Outsider', '8015550177', 'Elvish', 'Rivendell', 'Curious.');
  perform pg_temp.act_as(adm);
  perform public.decide_lead_application(app3, false, 'Not this time', null, null, null);
  select * into rec from public.lead_applications where id = app3;
  perform pg_temp.ok('an unfinished application can be declined', rec.status = 'declined' and rec.decision_note = 'Not this time');
  perform pg_temp.act_as(outsider);
  perform pg_temp.ok('lead_claim returns the decided application when nothing is open', public.lead_claim() = app3);
  got := public.lead_start(null, 'Otto Outsider', '8015550177', 'Elvish', 'Rivendell', 'Trying again.');
  perform pg_temp.ok('after a decline the person can apply again (a new application)', got <> app3 and public.lead_claim() = got);
end \$\$;

rollback;
SQL
echo "rolled back; nothing was kept"
