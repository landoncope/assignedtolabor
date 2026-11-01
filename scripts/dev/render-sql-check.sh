#!/bin/bash
# Checks that the caption and render columns of a video (2026-11-01) are the lead's: an
# uploader editing their own pending video cannot change them (the guard_video_update
# trigger keeps the old values), while a lead of the team can. Throwaway users inside ONE
# transaction that is rolled back at the end; safe against the live project.
#   scripts/dev/render-sql-check.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DBURL=$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)

psql "$DBURL" -X -q -v ON_ERROR_STOP=1 -P pager=off <<SQL
begin;
set local client_min_messages = notice;

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, is_anonymous, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'render-sqlcheck-up@example.com',   now(), false, '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-4555-8555-555555555555', 'authenticated', 'authenticated', 'render-sqlcheck-lead@example.com', now(), false, '{}', '{}', now(), now());
insert into public.areas (id, name, language, is_active, sort_order) values ('77777777-7777-4777-8777-777777777777', 'Render SQL Check', 'Klingon', true, 999);
insert into public.area_managers (area_id, user_id) values ('77777777-7777-4777-8777-777777777777', '55555555-5555-4555-8555-555555555555');
insert into public.videos (id, user_id, area_id, language, storage_path, status, captions_on, headline, caption_cues)
  values ('88888888-8888-4888-8888-888888888888', '44444444-4444-4444-8444-444444444444', '77777777-7777-4777-8777-777777777777', 'Klingon', '44444444-4444-4444-8444-444444444444/x.mp4', 'pending', true, 'The lead''s headline', '[{"s":0,"e":1,"text":"hello"}]');

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

do \$\$
declare
  up uuid := '44444444-4444-4444-8444-444444444444'; lead uuid := '55555555-5555-4555-8555-555555555555';
  vid uuid := '88888888-8888-4888-8888-888888888888';
  rec public.videos%rowtype;
begin
  set local role authenticated;
  perform pg_temp.act_as(up);
  update public.videos set uploader_note = 'from the uploader', captions_on = false, headline = 'my own headline', caption_cues = '[]'::jsonb,
    render_state = 'done', render_path = 'somebody-else/file.mp4', render_key = 'x', render_meta = '{"cues": 9}'::jsonb where id = vid;
  select * into rec from public.videos where id = vid;
  perform pg_temp.ok('the uploader can still add a note to their pending video', rec.uploader_note = 'from the uploader');
  perform pg_temp.ok('the uploader cannot switch the captions off or change the headline or the cues', rec.captions_on = true and rec.headline = 'The lead''s headline' and rec.caption_cues::text like '%hello%');
  perform pg_temp.ok('the uploader cannot point the post at another file or fake a render', rec.render_state is null and rec.render_path is null and rec.render_key is null and rec.render_meta is null);

  perform pg_temp.act_as(lead);
  update public.videos set captions_on = false, headline = 'Lead''s choice', caption_cues = '[{"s":0,"e":1,"text":"fixed"}]'::jsonb, render_state = 'skipped' where id = vid;
  select * into rec from public.videos where id = vid;
  perform pg_temp.ok('a lead of the team can change the captions, the headline and the render state', rec.captions_on = false and rec.headline = 'Lead''s choice' and rec.caption_cues::text like '%fixed%' and rec.render_state = 'skipped');
end \$\$;

rollback;
SQL
echo "render-sql-check: all passed (rolled back)"
