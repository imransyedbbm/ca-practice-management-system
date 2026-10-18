-- 0002: firm onboarding RPC, updated_at triggers, PAN/GSTIN checks, automatic audit log.
-- Run after 0001_initial_schema.sql.

-- 1. Create a firm and make the caller its managing partner, atomically.
create or replace function public.create_firm_with_owner(p_name text, p_city text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_name  text;
  v_firm  uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in to create a firm' using errcode = '28000';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Firm name is required' using errcode = '22023';
  end if;
  if exists (select 1 from firm_members where user_id = v_uid and active) then
    raise exception 'You already belong to a firm' using errcode = '23505';
  end if;

  select email, coalesce(raw_user_meta_data->>'full_name', email)
    into v_email, v_name
    from auth.users where id = v_uid;

  insert into firms (name, city) values (trim(p_name), coalesce(trim(p_city), ''))
    returning id into v_firm;

  insert into firm_members (firm_id, user_id, full_name, email, role)
    values (v_firm, v_uid, coalesce(v_name, ''), coalesce(v_email, ''), 'managing_partner');

  return v_firm;
end;
$$;
revoke all on function public.create_firm_with_owner(text, text) from public, anon;
grant execute on function public.create_firm_with_owner(text, text) to authenticated;

-- 2. Keep updated_at current.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists clients_touch on public.clients;
create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();
drop trigger if exists tasks_touch on public.compliance_tasks;
create trigger tasks_touch before update on public.compliance_tasks
  for each row execute function public.touch_updated_at();

-- 3. Stop rows being moved to another firm through an update.
create or replace function public.block_firm_change()
returns trigger language plpgsql as $$
begin
  if new.firm_id <> old.firm_id then
    raise exception 'firm_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists clients_firm_lock on public.clients;
create trigger clients_firm_lock before update on public.clients
  for each row execute function public.block_firm_change();
drop trigger if exists tasks_firm_lock on public.compliance_tasks;
create trigger tasks_firm_lock before update on public.compliance_tasks
  for each row execute function public.block_firm_change();

-- 4. PAN / GSTIN format (blank allowed). NOT VALID = enforced for new/changed rows only.
alter table public.clients drop constraint if exists clients_pan_format;
alter table public.clients add constraint clients_pan_format
  check (pan = '' or pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$') not valid;
alter table public.clients drop constraint if exists clients_gstin_format;
alter table public.clients add constraint clients_gstin_format
  check (gstin = '' or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$') not valid;
-- One client per PAN within a firm.
create unique index if not exists clients_firm_pan_uniq
  on public.clients (firm_id, pan) where pan <> '';

-- 5. Automatic audit trail (clients cannot forge entries: no insert policy exists).
create or replace function public.write_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_events (firm_id, actor_id, entity_type, entity_id, action, details)
  values (
    new.firm_id,
    auth.uid(),
    tg_table_name,
    new.id,
    lower(tg_op),
    case when tg_op = 'UPDATE'
         then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
         else jsonb_build_object('after', to_jsonb(new)) end
  );
  return new;
end;
$$;
drop trigger if exists clients_audit on public.clients;
create trigger clients_audit after insert or update on public.clients
  for each row execute function public.write_audit_event();
drop trigger if exists tasks_audit on public.compliance_tasks;
create trigger tasks_audit after insert or update on public.compliance_tasks
  for each row execute function public.write_audit_event();
