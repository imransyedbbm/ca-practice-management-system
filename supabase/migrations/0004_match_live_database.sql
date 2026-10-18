-- 0004: make the live database match what the app sends.
-- Written for the schema actually in Supabase (lowercase enums, created_by NOT NULL,
-- audit_events.metadata), not for 0001/0002. Safe to run more than once.

-- 1. Missing client columns + 'prospect' status
alter table public.clients add column if not exists entity_type text not null default 'Individual';
alter table public.clients add column if not exists services text[] not null default '{}';
alter type public.client_status add value if not exists 'prospect';

-- 2. Missing task columns + 'under_review' / 'filed' statuses
alter table public.compliance_tasks add column if not exists category text not null default 'Other';
alter table public.compliance_tasks add column if not exists period text not null default '';
alter table public.compliance_tasks add column if not exists internal_due_date date;
alter table public.compliance_tasks add column if not exists reviewer text not null default '';
alter type public.task_status add value if not exists 'under_review';
alter type public.task_status add value if not exists 'filed';

-- 3. assigned_to: the app stores a person's name (text), the table expects a user id (uuid).
--    Drop any foreign key on it, then convert to text (existing ids are kept as text).
do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
    where con.conrelid = 'public.compliance_tasks'::regclass
      and con.contype = 'f' and att.attname = 'assigned_to'
  loop
    execute format('alter table public.compliance_tasks drop constraint %I', r.conname);
  end loop;

  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'compliance_tasks' and column_name = 'assigned_to') = 'uuid' then
    alter table public.compliance_tasks alter column assigned_to type text using assigned_to::text;
  end if;
end $$;
alter table public.compliance_tasks alter column assigned_to set default '';

-- 4. Keep updated_at current
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

-- 5. Audit trail using this database's column name (metadata, not details).
--    Replaces the 0002 version, which would break every insert here.
create or replace function public.write_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_events (id, firm_id, actor_id, action, entity_type, entity_id, metadata, created_at)
  values (
    gen_random_uuid(), new.firm_id, auth.uid(), lower(tg_op), tg_table_name, new.id,
    case when tg_op = 'UPDATE'
         then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
         else jsonb_build_object('after', to_jsonb(new)) end,
    now()
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

-- 6. Firm-creation function matching this schema (firms.created_by, no full_name column).
create or replace function public.create_firm_with_owner(p_name text, p_city text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_firm uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in to create a firm' using errcode = '28000';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Firm name is required' using errcode = '22023';
  end if;

  insert into firms (name, city, created_by)
    values (trim(p_name), coalesce(trim(p_city), ''), v_uid)
    returning id into v_firm;

  insert into firm_members (firm_id, user_id, email, role, active)
    values (v_firm, v_uid, (select email from auth.users where id = v_uid), 'managing_partner', true);

  return v_firm;
end;
$$;
revoke all on function public.create_firm_with_owner(text, text) from public, anon;
grant execute on function public.create_firm_with_owner(text, text) to authenticated;

-- 7. Tell Supabase's API to pick up the new columns (fixes "schema cache" errors).
notify pgrst, 'reload schema';
