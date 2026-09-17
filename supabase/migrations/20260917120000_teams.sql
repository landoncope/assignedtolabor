-- Teams (2026-09-17, Travis): people can apply to join a team or to start one.
-- In the schema a team is an `areas` row and a team lead is an `area_managers` row;
-- the UI says "team" and "lead". Members (contributors) are the new `area_members`
-- and can tag an upload with their team so it goes straight to that team's lead.

create table public.area_members (
  area_id    uuid not null references public.areas(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (area_id, user_id)
);
create index area_members_user_idx on public.area_members (user_id);

create table public.team_applications (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  kind                text not null check (kind in ('start', 'join')),
  area_id             uuid references public.areas(id) on delete cascade, -- join: the team; start: filled on approval
  team_name           text,   -- start
  language            text,   -- start
  region              text,   -- start: where in the world
  instagram_handle    text,   -- start, optional
  note                text,
  status              text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by          uuid references public.profiles(id) on delete set null,
  decided_at          timestamptz,
  decision_note       text,
  notified_at         timestamptz, -- the people who decide were told
  outcome_notified_at timestamptz, -- the applicant was told
  created_at          timestamptz not null default now(),
  constraint team_applications_shape check (
    (kind = 'join' and area_id is not null)
    or (kind = 'start' and team_name is not null and language is not null)
  )
);
create index team_applications_status_idx on public.team_applications (status, created_at);
create index team_applications_user_idx   on public.team_applications (user_id, created_at desc);
create unique index team_applications_one_open_join  on public.team_applications (user_id, area_id) where kind = 'join' and status = 'pending';
create unique index team_applications_one_open_start on public.team_applications (user_id) where kind = 'start' and status = 'pending';

alter table public.area_members enable row level security;
create policy area_members_select on public.area_members for select
  using (user_id = auth.uid() or public.can_manage_area(area_id));
create policy area_members_leads_write on public.area_members for all
  using (public.can_manage_area(area_id)) with check (public.can_manage_area(area_id));
create policy area_members_leave on public.area_members for delete
  using (user_id = auth.uid());

alter table public.team_applications enable row level security;
create policy team_applications_insert_own on public.team_applications for insert
  with check (
    user_id = auth.uid() and status = 'pending' and decided_by is null and decided_at is null
    and exists (select 1 from public.profiles where id = auth.uid() and not is_anonymous)
  );
create policy team_applications_select_own on public.team_applications for select
  using (user_id = auth.uid());
create policy team_applications_select_deciders on public.team_applications for select
  using (public.is_admin() or (kind = 'join' and public.can_manage_area(area_id)));
create policy team_applications_withdraw on public.team_applications for delete
  using (user_id = auth.uid() and status = 'pending');

-- Decisions go through this function so the side effects (a new team with its lead,
-- or a new member) land with the status change. Leads decide join requests for their
-- teams; admins decide start requests (and anything else).
create or replace function public.decide_team_application(app_id uuid, approve boolean, note text default null)
returns void language plpgsql security definer set search_path = public as $$
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
revoke all on function public.decide_team_application(uuid, boolean, text) from public;
grant execute on function public.decide_team_application(uuid, boolean, text) to authenticated;

-- Leads can see who is asking to join their teams and who is on them (profiles are
-- otherwise visible only to their owner and to admins).
create policy profiles_select_for_leads on public.profiles for select
  using (
    exists (select 1 from public.team_applications t where t.user_id = profiles.id and t.kind = 'join' and public.can_manage_area(t.area_id))
    or exists (select 1 from public.area_members m where m.user_id = profiles.id and public.can_manage_area(m.area_id))
  );
