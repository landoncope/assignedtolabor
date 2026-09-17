-- decide_team_application: the `note` parameter was ambiguous with the `note` column
-- inside the final update (found by scripts/dev/e2e-live.mjs). Resolve in favour of
-- the parameter. Same signature, so grants carry over.
create or replace function public.decide_team_application(app_id uuid, approve boolean, note text default null)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
  a public.team_applications%rowtype;
  new_area uuid;
begin
  select * into a from public.team_applications where id = app_id for update;
  if not found then raise exception 'Application not found'; end if;
  if a.status <> 'pending' then raise exception 'This application was already decided'; end if;
  if a.kind = 'start' then
    if not public.is_admin() then raise exception 'not allowed'; end if;
  elsif not public.can_manage_area(a.area_id) then
    raise exception 'not allowed';
  end if;
  if approve then
    if a.kind = 'start' then
      insert into public.areas (name, language, instagram_handle)
        values (a.team_name, a.language, a.instagram_handle)
        returning id into new_area;
      -- notified_at is set: the approval email already says "you are now the lead".
      insert into public.area_managers (area_id, user_id, notified_at) values (new_area, a.user_id, now());
      insert into public.area_members (area_id, user_id) values (new_area, a.user_id) on conflict do nothing;
      update public.team_applications set area_id = new_area where id = app_id;
    else
      insert into public.area_members (area_id, user_id) values (a.area_id, a.user_id) on conflict do nothing;
    end if;
  end if;
  update public.team_applications
     set status = case when approve then 'approved' else 'declined' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(note), '')
   where id = app_id;
end;
$$;
