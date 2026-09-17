-- Leads are recruited through the join flow (Travis, 2026-09-17: the teams exist up
-- front and "the team leads go through the process on the page"). A join request can
-- say "I'd like to lead this team", and an admin can approve any join request as a
-- lead. Same decision function, one more argument; the old 3-argument overload goes
-- so PostgREST has one candidate.
alter table public.team_applications add column wants_lead boolean not null default false;

drop function if exists public.decide_team_application(uuid, boolean, text);
create or replace function public.decide_team_application(app_id uuid, approve boolean, note text default null, as_lead boolean default false)
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_variable
declare
  a public.team_applications%rowtype;
  new_area uuid;
begin
  select * into a from public.team_applications where id = app_id for update;
  if not found then raise exception 'Application not found'; end if;
  if a.status <> 'pending' then raise exception 'This application was already decided'; end if;
  if a.kind = 'start' or as_lead then
    if not public.is_admin() then raise exception 'not allowed'; end if;
  elsif not public.can_manage_area(a.area_id) then
    raise exception 'not allowed';
  end if;
  if approve then
    if a.kind = 'start' then
      insert into public.areas (name, language, instagram_handle)
        values (a.team_name, a.language, a.instagram_handle)
        returning id into new_area;
      insert into public.area_managers (area_id, user_id, notified_at) values (new_area, a.user_id, now());
      insert into public.area_members (area_id, user_id) values (new_area, a.user_id) on conflict do nothing;
      update public.team_applications set area_id = new_area where id = app_id;
    else
      insert into public.area_members (area_id, user_id) values (a.area_id, a.user_id) on conflict do nothing;
      if as_lead then
        -- notified_at is set: the approval email already says "you are now a lead".
        insert into public.area_managers (area_id, user_id, notified_at) values (a.area_id, a.user_id, now()) on conflict do nothing;
      end if;
    end if;
  end if;
  update public.team_applications
     set status = case when approve then 'approved' else 'declined' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(note), '')
   where id = app_id;
end;
$$;
revoke all on function public.decide_team_application(uuid, boolean, text, boolean) from public;
grant execute on function public.decide_team_application(uuid, boolean, text, boolean) to authenticated;
