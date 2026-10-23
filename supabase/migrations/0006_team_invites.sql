-- 0006: team member logins. Run in the Supabase SQL Editor after 0005. Safe to run more than once.
--
-- A partner adds a team member and (optionally) emails them an invitation through the
-- invite-team-member Edge Function, which sets team_members.invited_at. When a user with a
-- confirmed email matching an invited team member signs in, claim_team_invites() links the
-- login to that team member and gives them a firm login (firm_members) with the matching role.
-- Changing a linked team member's role or active flag updates their firm login immediately.

-- ---------------------------------------------------------------- 1. invitation timestamp
alter table public.team_members add column if not exists invited_at timestamptz;

-- firm_members.role may be the firm_role enum (from 0001) or text; make sure staff roles exist.
do $$
begin
  if exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
             where n.nspname = 'public' and t.typname = 'firm_role' and t.typtype = 'e') then
    alter type public.firm_role add value if not exists 'manager';
    alter type public.firm_role add value if not exists 'staff';
  end if;
end $$;

-- ---------------------------------------------------------------- 2. role mapping
create or replace function private.firm_role_for(p_team_role text)
returns text
language sql immutable
set search_path = ''
as $$
  select case p_team_role when 'Managing Partner' then 'managing_partner'
                          when 'Partner' then 'partner'
                          when 'Manager' then 'manager'
                          else 'staff' end;
$$;

-- Creates or updates the firm login for a user. Works whether firm_members.role is an enum or text.
create or replace function private.set_firm_login(p_firm uuid, p_user uuid, p_email text, p_role text, p_active boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_type text;
  n integer;
begin
  select format_type(a.atttypid, a.atttypmod) into v_type
  from pg_attribute a
  where a.attrelid = 'public.firm_members'::regclass and a.attname = 'role';

  execute format('update public.firm_members set role = $1::%s, active = $2 where firm_id = $3 and user_id = $4', v_type)
    using p_role, p_active, p_firm, p_user;
  get diagnostics n = row_count;  -- EXECUTE does not set FOUND
  if n = 0 then
    execute format('insert into public.firm_members (firm_id, user_id, email, role, active) values ($1, $2, $3, $4::%s, $5)', v_type)
      using p_firm, p_user, p_email, p_role, p_active;
  end if;
end;
$$;
revoke all on function private.set_firm_login(uuid, uuid, text, text, boolean) from public, anon, authenticated;

-- Links one team member to a login and gives that login access to the firm.
create or replace function private.link_team_login(p_member uuid, p_user uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  tm public.team_members%rowtype;
  v_email text;
begin
  select * into tm from public.team_members where id = p_member;
  if tm.id is null then
    raise exception 'Team member not found' using errcode = '22023';
  end if;
  -- The same login may already be linked to another team row in this firm.
  if exists (select 1 from public.team_members x where x.firm_id = tm.firm_id and x.user_id = p_user and x.id <> tm.id) then
    return;
  end if;
  select u.email into v_email from auth.users u where u.id = p_user;
  update public.team_members set user_id = p_user where id = tm.id;
  perform private.set_firm_login(tm.firm_id, p_user, coalesce(v_email, tm.email), private.firm_role_for(tm.role), tm.active);
end;
$$;
revoke all on function private.link_team_login(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. claim on sign-in
-- Called by the app after sign-in. Only works for a confirmed email address.
create or replace function public.claim_team_invites()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  r record;
  n integer := 0;
begin
  if v_uid is null then return 0; end if;
  select u.email, u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_uid;
  if v_email is null or v_confirmed is null then return 0; end if;
  -- One team row per firm (the oldest), and only firms this login is not already part of.
  for r in
    select distinct on (tm.firm_id) tm.id
    from public.team_members tm
    where tm.user_id is null
      and tm.active
      and tm.invited_at is not null
      and lower(tm.email) = lower(v_email)
      and not exists (select 1 from public.team_members x where x.firm_id = tm.firm_id and x.user_id = v_uid)
    order by tm.firm_id, tm.created_at
  loop
    perform private.link_team_login(r.id, v_uid);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.claim_team_invites() from public, anon;
grant execute on function public.claim_team_invites() to authenticated;

-- Used by the invite-team-member Edge Function (service role only) when the invitee already
-- has a confirmed account: link it straight away. Returns the linked user id, or null.
create or replace function public.link_team_member_by_email(p_member uuid)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select u.id into v_user
  from public.team_members tm
  join auth.users u on lower(u.email) = lower(tm.email)
  where tm.id = p_member and tm.email <> '' and u.email_confirmed_at is not null
  limit 1;
  if v_user is null then return null; end if;
  perform private.link_team_login(p_member, v_user);
  return v_user;
end;
$$;
revoke all on function public.link_team_member_by_email(uuid) from public, anon, authenticated;
grant execute on function public.link_team_member_by_email(uuid) to service_role;

-- ---------------------------------------------------------------- 4. keep logins in step
create or replace function private.team_member_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.user_id is not null and old.user_id = (select auth.uid())
     and (not new.active or new.role not in ('Managing Partner', 'Partner')) then
    raise exception 'You cannot remove your own partner access. Ask another partner to change it.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists team_members_guard on public.team_members;
create trigger team_members_guard before update of role, active on public.team_members
  for each row execute function private.team_member_guard();

create or replace function private.team_member_sync_login()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.user_id is not null
     and (new.role is distinct from old.role or new.active is distinct from old.active) then
    perform private.set_firm_login(new.firm_id, new.user_id, new.email, private.firm_role_for(new.role), new.active);
  end if;
  return new;
end;
$$;
drop trigger if exists team_members_sync_login on public.team_members;
create trigger team_members_sync_login after update of role, active on public.team_members
  for each row execute function private.team_member_sync_login();

-- ---------------------------------------------------------------- 5. refresh the API
notify pgrst, 'reload schema';
