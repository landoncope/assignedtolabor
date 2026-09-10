-- Initial areas and manager invites (data, not schema). Applied 2026-09-10 with psql.
-- Re-runnable: skips rows that already exist.
insert into public.areas (name, language, instagram_handle, sort_order)
select 'Philippines', 'Tagalog', 'Liwinag.ni.kristo', 10
where not exists (select 1 from public.areas where name = 'Philippines' and language = 'Tagalog');

insert into public.manager_invites (email, area_id)
select 'holyrebellionph@gmail.com', a.id from public.areas a
where a.name = 'Philippines' and a.language = 'Tagalog'
on conflict do nothing;
