#!/bin/sh
# Event-day view: uploads, recorder health, sign-ins, team requests, emails. Read-only.
# "Today" means the last 12 hours (the database clock is UTC).
# Usage: scripts/dev/event-watch.sh [refresh seconds, default 60; 0 = print once]
cd "$(dirname "$0")/../.." || exit 1
DBURL=$(grep '^SUPABASE_DB_URL=' .env.local | cut -d= -f2-)
[ -n "$DBURL" ] || { echo "SUPABASE_DB_URL is missing from .env.local"; exit 1; }
EVERY=${1:-60}
while :; do
  [ "$EVERY" = "0" ] || clear
  date
  psql "$DBURL" -X -q -P pager=off <<'SQL'
\echo '--- uploads'
select count(*) filter (where created_at > now() - interval '15 minutes') as last_15m,
       count(*) filter (where created_at > now() - interval '1 hour') as last_hour,
       count(*) filter (where created_at > now() - interval '12 hours') as today,
       round(avg(file_size) filter (where created_at > now() - interval '1 hour') / 1048576.0, 1) as avg_mb_last_hour
  from public.videos;
\echo '--- today by team'
select coalesce(a.name, 'no team (admin queue)') as team, count(*) as videos, count(*) filter (where v.status = 'pending') as pending
  from public.videos v left join public.areas a on a.id = v.area_id
 where v.created_at > now() - interval '12 hours' group by 1 order by 2 desc;
\echo '--- recorder health today (recorded in the app)'
select count(*) as recorded, round(avg((capture_meta->>'fps')::numeric), 0) as avg_fps,
       count(*) filter (where (capture_meta->>'fps')::numeric < 20) as under_20fps,
       count(*) filter (where (capture_meta->>'stalledSeconds')::numeric > 0) as with_stalls,
       count(*) filter (where capture_meta->>'zoomMode' = 'native') as camera_zoom
  from public.videos where created_at > now() - interval '12 hours' and capture_meta is not null;
\echo '--- devices today'
select case when capture_meta is null then 'uploaded a file' when capture_meta->>'ua' ~ 'iPhone' then 'iPhone'
            when capture_meta->>'ua' ~ 'iPad' then 'iPad' when capture_meta->>'ua' ~ 'Android' then 'Android' else 'laptop/desktop' end as device, count(*)
  from public.videos where created_at > now() - interval '12 hours' group by 1 order by 2 desc;
\echo '--- latest recorder events (stalls, pauses, muted camera)'
select to_char(v.created_at, 'HH24:MI') as utc, coalesce(v.uploader_name, '-') as who, e as event
  from public.videos v, jsonb_array_elements_text(v.capture_meta->'events') e
 where v.created_at > now() - interval '12 hours' order by v.created_at desc limit 8;
\echo '--- people'
select count(*) filter (where is_anonymous and created_at > now() - interval '1 hour') as anonymous_last_hour,
       count(*) filter (where not is_anonymous and created_at > now() - interval '12 hours') as new_accounts_today,
       count(*) filter (where is_anonymous and coalesce(email_change, '') <> '' and created_at > now() - interval '12 hours') as typed_email_not_confirmed
  from auth.users;
\echo '--- team requests waiting, and emails the app sent in the last hour'
select (select count(*) from public.team_applications where status = 'pending') as requests_waiting,
       (select count(*) from public.notifications where sent_at > now() - interval '1 hour') as app_emails_last_hour;
SQL
  [ "$EVERY" = "0" ] && break
  sleep "$EVERY"
done
