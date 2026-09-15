-- Reviewers may delete videos they can review (admins: everything, plus videos
-- with no area). Previously only admins could delete. The file itself is removed
-- by the server action with the service role after the row delete succeeds.
drop policy if exists videos_admin_delete on public.videos;
create policy videos_delete_manage on public.videos for delete
  using (public.can_manage_area(area_id) or (area_id is null and public.is_admin()));
