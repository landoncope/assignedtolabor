-- ─────────────────────────────────────────────────────────────────
-- Migration: public avatars bucket (profile photos)
-- Run this in the Supabase SQL Editor (Settings → SQL Editor)
--
-- Profile photos live at  avatars/<userId>/avatar  and are world-readable via
-- the public URL, so any member can see another member's photo. Users can only
-- write to their own folder.
-- ─────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects for select using (bucket_id = 'avatars');

drop policy if exists "avatars own insert" on storage.objects;
create policy "avatars own insert" on storage.objects for insert
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars own update" on storage.objects;
create policy "avatars own update" on storage.objects for update
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars own delete" on storage.objects;
create policy "avatars own delete" on storage.objects for delete
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
