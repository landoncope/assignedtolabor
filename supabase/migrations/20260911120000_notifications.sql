-- Email notifications: who has been told what. Sent by /api/cron/notify every few minutes.

-- Fix: guard_video_update raised for the service role and for migrations, because
-- auth.uid() is null there. Trusted callers with no user id (cron jobs, the CLI)
-- must pass; RLS still governs anon and authenticated users.
create or replace function public.guard_video_update()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if public.can_manage_area(old.area_id) or public.is_admin() then
    return new;
  end if;
  if old.user_id = auth.uid() and old.status = 'pending' then
    new.status := old.status;
    new.area_id := coalesce(new.area_id, old.area_id);
    new.user_id := old.user_id;
    new.storage_path := old.storage_path;
    new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at;
    new.posted_by := old.posted_by; new.posted_at := old.posted_at; new.post_url := old.post_url;
    new.file_purged_at := old.file_purged_at;
    return new;
  end if;
  raise exception 'not allowed';
end;
$$;

alter table public.videos
  add column managers_notified_at timestamptz,        -- managers told a new video is waiting
  add column uploader_notified_status text;           -- last outcome the uploader was emailed about

alter table public.area_managers add column notified_at timestamptz;   -- "you are now a reviewer"
alter table public.manager_invites add column notified_at timestamptz; -- "you have been invited"

create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,      -- new_videos | outcome | manager_added | manager_invited
  recipient   text not null,
  video_id    uuid references public.videos(id) on delete set null,
  area_id     uuid references public.areas(id) on delete set null,
  provider_id text,               -- Resend message id
  sent_at     timestamptz not null default now()
);
create index notifications_sent_idx on public.notifications (sent_at desc);
alter table public.notifications enable row level security;
create policy notifications_admin_select on public.notifications for select using (public.is_admin());

-- Backfill so nothing that already exists triggers a surprise email when this ships.
update public.videos set managers_notified_at = now() where managers_notified_at is null;
update public.videos set uploader_notified_status = status where status in ('posted', 'rejected');
update public.area_managers set notified_at = now() where notified_at is null;
update public.manager_invites set notified_at = now() where notified_at is null;
