-- A person may change only what is theirs to change on their profile (2026-10-30).
-- `profiles_update_own` covers every column, so until now any signed-in account could
-- promote itself with one update (`update profiles set role = 'admin'`), and is_admin()
-- would then open everything. Found while adding dashboard columns to profiles.
-- Admins keep full control (the Admin page changes roles through the same policy), and
-- callers with no user id (the service role, the auth triggers) are untouched.
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.id <> old.id
     or new.role is distinct from old.role
     or new.email is distinct from old.email
     or new.is_anonymous is distinct from old.is_anonymous
     or new.created_at is distinct from old.created_at then
    raise exception 'not allowed';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();
