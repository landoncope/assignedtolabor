-- Language-only teams Travis asked for on 2026-09-17 (English, Spanish, French,
-- Swahili). Their leads apply from the Teams page and an admin approves them as
-- leads. Philippines moves after them in lists. Re-runnable.
insert into public.areas (name, language, sort_order)
select v.name, v.language, v.sort_order
  from (values ('English', 'English', 10), ('Spanish', 'Spanish', 20), ('French', 'French', 30), ('Swahili', 'Swahili', 40))
       as v(name, language, sort_order)
 where not exists (select 1 from public.areas a where lower(a.language) = lower(v.language));
update public.areas set sort_order = 50 where name = 'Philippines' and sort_order < 50;
