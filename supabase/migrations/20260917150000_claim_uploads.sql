-- Stranded uploads (2026-09-17). An anonymous uploader who types their email on the
-- thank-you screen is sent a confirmation link; two of two testers instead tapped
-- "Sign in", which makes a new, empty account, and their video stayed with the
-- anonymous session. When someone signs in with an address an anonymous upload is
-- waiting on, My videos now asks "is this yours?"; these functions do the move.
alter table public.videos
  add column claimed_from      uuid,        -- the anonymous user the video came from
  add column claim_declined_at timestamptz; -- the address owner said it is not theirs

-- guard_video_update: also let the claim function through (it moves rows between users).
create or replace function public.guard_video_update()
returns trigger language plpgsql as $$
begin
  if auth.uid() is null or current_setting('app.claiming', true) = 'on' then
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

-- Videos uploaded by anonymous sessions that named the caller's email address (still
-- unconfirmed) and were not declined.
create or replace function public.claimable_uploads()
returns table (id uuid, uploader_name text, language text, thumbnail text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select v.id, v.uploader_name, v.language, v.thumbnail, v.created_at
    from public.videos v
    join auth.users a  on a.id = v.user_id
    join auth.users me on me.id = auth.uid()
   where a.is_anonymous
     and me.email is not null
     and lower(a.email_change) = lower(me.email)
     and v.claim_declined_at is null
   order by v.created_at desc;
$$;

create or replace function public.claim_uploads()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  perform set_config('app.claiming', 'on', true);
  update public.videos v
     set user_id = auth.uid(), claimed_from = v.user_id
   where v.id in (select c.id from public.claimable_uploads() c);
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.decline_uploads()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  perform set_config('app.claiming', 'on', true);
  update public.videos v set claim_declined_at = now()
   where v.id in (select c.id from public.claimable_uploads() c);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.claimable_uploads() from public;
revoke all on function public.claim_uploads() from public;
revoke all on function public.decline_uploads() from public;
grant execute on function public.claimable_uploads() to authenticated;
grant execute on function public.claim_uploads() to authenticated;
grant execute on function public.decline_uploads() to authenticated;
