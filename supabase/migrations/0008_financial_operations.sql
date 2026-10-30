-- 0008: Financial Operations add-on, phase 1 (foundation) and phase 2 (PF & ESI).
-- Run in the Supabase SQL Editor after 0007. Safe to run more than once.
--
-- What it adds
--   * firm_addons: which paid add-ons a firm has switched on. Every Financial Operations table is
--     readable and writable only when the firm has the 'finops' add-on enabled.
--   * fo_profiles: per-client PF / ESI applicability, registration codes, owners and configured due days.
--   * fo_rule_versions: versioned contribution rules. No rates are seeded: a partner enters them from
--     the official notification and approves the version before it can be used.
--   * fo_periods: one PF or ESI obligation per client per month, with its workflow status.
--   * fo_payroll_batches / fo_payroll_records: uploaded payroll data (masked identifiers only).
--   * fo_calculations: every calculation kept as a numbered, unchangeable version.
--   * fo_events: append-only audit trail for the add-on.
-- Status changes go through server functions that check the allowed transitions and that the
-- reviewer is not the preparer. Money is numeric(14,2). Nothing here moves or holds client money.

create schema if not exists private;

-- ---------------------------------------------------------------- 1. add-on switch
create table if not exists public.firm_addons (
  firm_id uuid not null references public.firms(id) on delete cascade,
  addon text not null check (addon in ('finops')),
  enabled boolean not null default true,
  changed_at timestamptz not null default now(),
  changed_by text not null default '',
  primary key (firm_id, addon)
);

create or replace function private.firm_has_addon(p_firm uuid, p_addon text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.firm_addons a where a.firm_id = p_firm and a.addon = p_addon and a.enabled);
$$;
grant execute on function private.firm_has_addon(uuid, text) to authenticated;

-- The caller's team role in a firm ('Managing Partner', 'Partner', 'Manager', ...), or null.
create or replace function private.fo_my_member(p_firm uuid)
returns table (member_id uuid, member_role text, member_name text)
language sql stable security definer set search_path = '' as $$
  select tm.id, tm.role, tm.name from public.team_members tm
  where tm.firm_id = p_firm and tm.user_id = (select auth.uid()) and tm.active
  limit 1;
$$;
grant execute on function private.fo_my_member(uuid) to authenticated;

-- Firm member with the add-on switched on.
create or replace function private.fo_access(p_firm uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_firm in (select private.current_user_firm_ids()) and private.firm_has_addon(p_firm, 'finops');
$$;
grant execute on function private.fo_access(uuid) to authenticated;

create or replace function private.fo_is_reviewer(p_firm uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.fo_my_member(p_firm) m where m.member_role in ('Managing Partner', 'Partner', 'Manager'));
$$;
grant execute on function private.fo_is_reviewer(uuid) to authenticated;

-- ---------------------------------------------------------------- 2. tables
create table if not exists public.fo_profiles (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  pf_status text not null default 'unknown' check (pf_status in ('unknown', 'applicable', 'not_applicable')),
  esi_status text not null default 'unknown' check (esi_status in ('unknown', 'applicable', 'not_applicable')),
  pf_code text not null default '',
  esi_code text not null default '',
  verified_by text not null default '',
  verified_at timestamptz,
  payroll_contact text not null default '',
  payroll_email text not null default '',
  preparer_id uuid references public.team_members(id) on delete set null,
  reviewer_id uuid references public.team_members(id) on delete set null,
  pf_due_day integer check (pf_due_day between 1 and 31),
  esi_due_day integer check (esi_due_day between 1 and 31),
  notes text not null default '',
  updated_at timestamptz not null default now(),
  unique (client_id)
);
create index if not exists fo_profiles_firm_idx on public.fo_profiles (firm_id);

create table if not exists public.fo_rule_versions (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  scheme text not null check (scheme in ('PF', 'ESI')),
  version integer not null,
  label text not null default '',
  effective_from date not null,
  params jsonb not null default '{}',
  source_ref text not null default '',
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  created_by text not null default '',
  created_by_member uuid references public.team_members(id) on delete set null,
  approved_by text not null default '',
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (firm_id, scheme, version)
);

create table if not exists public.fo_periods (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  scheme text not null check (scheme in ('PF', 'ESI')),
  period date not null check (extract(day from period) = 1),
  due_date date,
  status text not null default 'awaiting_data' check (status in (
    'awaiting_data', 'data_received', 'calculated', 'in_review', 'changes_requested', 'reviewed',
    'payment_pending', 'paid', 'evidence_pending', 'closed', 'not_applicable')),
  preparer_id uuid references public.team_members(id) on delete set null,
  reviewer_id uuid references public.team_members(id) on delete set null,
  employee_count integer not null default 0,
  total_wages numeric(14,2) not null default 0,
  total_employee numeric(14,2) not null default 0,
  total_employer numeric(14,2) not null default 0,
  total_payable numeric(14,2) not null default 0,
  exceptions_count integer not null default 0,
  current_calc_id uuid,
  prepared_by_member uuid references public.team_members(id) on delete set null,
  review_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, scheme, period)
);
create index if not exists fo_periods_firm_idx on public.fo_periods (firm_id, period);

create table if not exists public.fo_payroll_batches (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  period_id uuid not null references public.fo_periods(id) on delete cascade,
  file_name text not null default '',
  file_path text not null default '',
  file_hash text not null,
  row_count integer not null default 0,
  mapping jsonb not null default '{}',
  uploaded_by text not null default '',
  created_at timestamptz not null default now(),
  unique (period_id, file_hash)
);

create table if not exists public.fo_payroll_records (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  batch_id uuid not null references public.fo_payroll_batches(id) on delete cascade,
  period_id uuid not null references public.fo_periods(id) on delete cascade,
  row_no integer not null,
  emp_ref text not null default '',
  emp_name text not null default '',
  days numeric(5,1),
  gross_wages numeric(14,2),
  pf_wages numeric(14,2),
  esi_wages numeric(14,2),
  imp_employee numeric(14,2),
  imp_employer numeric(14,2),
  flags text[] not null default '{}'
);
create index if not exists fo_payroll_records_batch_idx on public.fo_payroll_records (batch_id);

create table if not exists public.fo_calculations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  period_id uuid not null references public.fo_periods(id) on delete cascade,
  version integer not null,
  method text not null check (method in ('calculated', 'imported')),
  rule_version_id uuid references public.fo_rule_versions(id),
  batch_id uuid references public.fo_payroll_batches(id) on delete set null,
  employee_count integer not null default 0,
  total_wages numeric(14,2) not null default 0,
  total_employee numeric(14,2) not null default 0,
  total_employer numeric(14,2) not null default 0,
  total_payable numeric(14,2) not null default 0,
  components jsonb not null default '[]',
  lines jsonb not null default '[]',
  exceptions jsonb not null default '[]',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  unique (period_id, version)
);

create table if not exists public.fo_events (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  entity text not null,
  entity_id uuid,
  action text not null,
  detail text not null default '',
  actor_name text not null default '',
  actor_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists fo_events_entity_idx on public.fo_events (entity_id, created_at desc);
create index if not exists fo_events_firm_idx on public.fo_events (firm_id, created_at desc);

-- ---------------------------------------------------------------- 3. guards
-- Audit trail is append-only.
create or replace function private.fo_events_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'The Financial Operations audit trail cannot be changed or deleted.';
end;
$$;
drop trigger if exists fo_events_no_change on public.fo_events;
create trigger fo_events_no_change before update or delete on public.fo_events
  for each row execute function private.fo_events_immutable();

-- Calculations are versions: never edited.
drop trigger if exists fo_calculations_no_change on public.fo_calculations;
create trigger fo_calculations_no_change before update on public.fo_calculations
  for each row execute function private.fo_events_immutable();

-- Status, totals and the verification stamp change only through the functions below.
create or replace function private.fo_period_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('fo.rpc', true), '') = 'on' then
    new.updated_at := now();
    return new;
  end if;
  if new.status is distinct from old.status or new.total_payable is distinct from old.total_payable
     or new.total_employee is distinct from old.total_employee or new.total_employer is distinct from old.total_employer
     or new.current_calc_id is distinct from old.current_calc_id or new.employee_count is distinct from old.employee_count
     or new.exceptions_count is distinct from old.exceptions_count or new.prepared_by_member is distinct from old.prepared_by_member
     or new.review_note is distinct from old.review_note or new.total_wages is distinct from old.total_wages
     or new.firm_id is distinct from old.firm_id or new.client_id is distinct from old.client_id
     or new.scheme is distinct from old.scheme or new.period is distinct from old.period then
    raise exception 'Use the workflow actions to change an obligation''s status or figures.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists fo_periods_guard on public.fo_periods;
create trigger fo_periods_guard before update on public.fo_periods
  for each row execute function private.fo_period_guard();

create or replace function private.fo_profile_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('fo.rpc', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.verified_by := ''; new.verified_at := null;
    elsif new.pf_status is distinct from old.pf_status or new.esi_status is distinct from old.esi_status then
      -- Changing applicability clears the verification; a reviewer verifies again.
      new.verified_by := ''; new.verified_at := null;
    else
      new.verified_by := old.verified_by; new.verified_at := old.verified_at;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists fo_profiles_guard on public.fo_profiles;
create trigger fo_profiles_guard before insert or update on public.fo_profiles
  for each row execute function private.fo_profile_guard();

-- An approved rule version is frozen; it can only be retired.
create or replace function private.fo_rule_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Only draft rule versions can be deleted.'; end if;
    return old;
  end if;
  if coalesce(current_setting('fo.rpc', true), '') = 'on' then return new; end if;
  if old.status <> 'draft' then
    raise exception 'An approved rule version cannot be edited. Create a new version instead.';
  end if;
  if new.status is distinct from old.status or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
    raise exception 'Approve a rule version with the Approve action.';
  end if;
  return new;
end;
$$;
drop trigger if exists fo_rules_guard on public.fo_rule_versions;
create trigger fo_rules_guard before update or delete on public.fo_rule_versions
  for each row execute function private.fo_rule_guard();

-- ---------------------------------------------------------------- 4. row-level security
alter table public.firm_addons enable row level security;
alter table public.fo_profiles enable row level security;
alter table public.fo_rule_versions enable row level security;
alter table public.fo_periods enable row level security;
alter table public.fo_payroll_batches enable row level security;
alter table public.fo_payroll_records enable row level security;
alter table public.fo_calculations enable row level security;
alter table public.fo_events enable row level security;

drop policy if exists "Members read add-ons" on public.firm_addons;
create policy "Members read add-ons" on public.firm_addons for select to authenticated
  using (firm_id in (select private.current_user_firm_ids()));
drop policy if exists "Partners add add-ons" on public.firm_addons;
create policy "Partners add add-ons" on public.firm_addons for insert to authenticated
  with check (private.is_firm_partner(firm_id));
drop policy if exists "Partners change add-ons" on public.firm_addons;
create policy "Partners change add-ons" on public.firm_addons for update to authenticated
  using (private.is_firm_partner(firm_id)) with check (private.is_firm_partner(firm_id));

-- Profiles: any member reads and edits (verification is stamped only by fo_verify_profile).
drop policy if exists "FO members read profiles" on public.fo_profiles;
create policy "FO members read profiles" on public.fo_profiles for select to authenticated using (private.fo_access(firm_id));
drop policy if exists "FO members add profiles" on public.fo_profiles;
create policy "FO members add profiles" on public.fo_profiles for insert to authenticated
  with check (private.fo_access(firm_id) and exists (select 1 from public.clients c where c.id = client_id and c.firm_id = fo_profiles.firm_id));
drop policy if exists "FO members edit profiles" on public.fo_profiles;
create policy "FO members edit profiles" on public.fo_profiles for update to authenticated
  using (private.fo_access(firm_id)) with check (private.fo_access(firm_id));

-- Rules: everyone reads; managers and partners draft; approval only via fo_approve_rule.
drop policy if exists "FO members read rules" on public.fo_rule_versions;
create policy "FO members read rules" on public.fo_rule_versions for select to authenticated using (private.fo_access(firm_id));
drop policy if exists "FO reviewers draft rules" on public.fo_rule_versions;
create policy "FO reviewers draft rules" on public.fo_rule_versions for insert to authenticated
  with check (private.fo_access(firm_id) and private.fo_is_reviewer(firm_id) and status = 'draft' and approved_at is null);
drop policy if exists "FO reviewers edit draft rules" on public.fo_rule_versions;
create policy "FO reviewers edit draft rules" on public.fo_rule_versions for update to authenticated
  using (private.fo_access(firm_id) and private.fo_is_reviewer(firm_id)) with check (private.fo_access(firm_id));
drop policy if exists "FO reviewers delete draft rules" on public.fo_rule_versions;
create policy "FO reviewers delete draft rules" on public.fo_rule_versions for delete to authenticated
  using (private.fo_access(firm_id) and private.fo_is_reviewer(firm_id));

-- Periods: read and assign people; created and moved only by the functions.
drop policy if exists "FO members read periods" on public.fo_periods;
create policy "FO members read periods" on public.fo_periods for select to authenticated using (private.fo_access(firm_id));
drop policy if exists "FO members assign periods" on public.fo_periods;
create policy "FO members assign periods" on public.fo_periods for update to authenticated
  using (private.fo_access(firm_id)) with check (private.fo_access(firm_id));

-- Payroll uploads: members add and read; nobody edits a stored record.
drop policy if exists "FO members read batches" on public.fo_payroll_batches;
create policy "FO members read batches" on public.fo_payroll_batches for select to authenticated using (private.fo_access(firm_id));
drop policy if exists "FO members add batches" on public.fo_payroll_batches;
create policy "FO members add batches" on public.fo_payroll_batches for insert to authenticated
  with check (private.fo_access(firm_id) and exists (
    select 1 from public.fo_periods p where p.id = period_id and p.firm_id = fo_payroll_batches.firm_id
      and p.status in ('awaiting_data', 'data_received', 'calculated', 'changes_requested')));
drop policy if exists "FO members read records" on public.fo_payroll_records;
create policy "FO members read records" on public.fo_payroll_records for select to authenticated using (private.fo_access(firm_id));
drop policy if exists "FO members add records" on public.fo_payroll_records;
create policy "FO members add records" on public.fo_payroll_records for insert to authenticated
  with check (private.fo_access(firm_id) and exists (
    select 1 from public.fo_payroll_batches b where b.id = batch_id and b.firm_id = fo_payroll_records.firm_id and b.period_id = fo_payroll_records.period_id));

drop policy if exists "FO members read calculations" on public.fo_calculations;
create policy "FO members read calculations" on public.fo_calculations for select to authenticated using (private.fo_access(firm_id));

drop policy if exists "FO members read events" on public.fo_events;
create policy "FO members read events" on public.fo_events for select to authenticated using (private.fo_access(firm_id));
drop policy if exists "FO members add events" on public.fo_events;
create policy "FO members add events" on public.fo_events for insert to authenticated
  with check (private.fo_access(firm_id) and actor_id = (select auth.uid()));

-- ---------------------------------------------------------------- 5. workflow functions
create or replace function private.fo_log(p_firm uuid, p_client uuid, p_entity text, p_id uuid, p_action text, p_detail text)
returns void language sql security definer set search_path = '' as $$
  insert into public.fo_events (firm_id, client_id, entity, entity_id, action, detail, actor_name, actor_id)
  values (p_firm, p_client, p_entity, p_id, p_action, coalesce(p_detail, ''),
          coalesce((select m.member_name from private.fo_my_member(p_firm) m), 'System'), (select auth.uid()));
$$;

-- Switch the add-on on or off (partners only).
create or replace function public.fo_set_addon(p_firm uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_firm_partner(p_firm) then raise exception 'Only partners can change add-ons.'; end if;
  insert into public.firm_addons (firm_id, addon, enabled, changed_at, changed_by)
  values (p_firm, 'finops', p_enabled, now(), coalesce((select m.member_name from private.fo_my_member(p_firm) m), ''))
  on conflict (firm_id, addon) do update set enabled = excluded.enabled, changed_at = now(), changed_by = excluded.changed_by;
  insert into public.fo_events (firm_id, entity, entity_id, action, detail, actor_name, actor_id)
  values (p_firm, 'addon', null, case when p_enabled then 'enabled' else 'disabled' end, 'Financial Operations add-on',
          coalesce((select m.member_name from private.fo_my_member(p_firm) m), ''), (select auth.uid()));
end;
$$;
revoke all on function public.fo_set_addon(uuid, boolean) from public, anon;
grant execute on function public.fo_set_addon(uuid, boolean) to authenticated;

-- A reviewer confirms the client's PF / ESI applicability.
create or replace function public.fo_verify_profile(p_profile uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.fo_profiles;
begin
  select * into v from public.fo_profiles where id = p_profile;
  if v.id is null or not private.fo_access(v.firm_id) then raise exception 'Profile not found.'; end if;
  if not private.fo_is_reviewer(v.firm_id) then raise exception 'Only a manager or partner can verify applicability.'; end if;
  if v.pf_status = 'unknown' and v.esi_status = 'unknown' then raise exception 'Set PF and ESI applicability before verifying.'; end if;
  perform set_config('fo.rpc', 'on', true);
  update public.fo_profiles set verified_by = (select m.member_name from private.fo_my_member(v.firm_id) m), verified_at = now() where id = p_profile;
  perform set_config('fo.rpc', '', true);
  perform private.fo_log(v.firm_id, v.client_id, 'profile', v.id, 'verified',
    format('PF %s, ESI %s', replace(v.pf_status, '_', ' '), replace(v.esi_status, '_', ' ')));
end;
$$;
revoke all on function public.fo_verify_profile(uuid) from public, anon;
grant execute on function public.fo_verify_profile(uuid) to authenticated;

-- Create the month's obligations for every client whose verified profile makes the scheme applicable.
create or replace function public.fo_generate_periods(p_firm uuid, p_month date, p_scheme text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_next date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_last int := extract(day from (v_next + interval '1 month' - interval '1 day'))::int;
  r record; n int := 0; v_id uuid;
begin
  if not private.fo_access(p_firm) then raise exception 'Financial Operations is not enabled for this firm.'; end if;
  if p_scheme is not null and p_scheme not in ('PF', 'ESI') then raise exception 'Unknown scheme %.', p_scheme; end if;
  for r in
    select pr.*, s.scheme from public.fo_profiles pr
    cross join (values ('PF'), ('ESI')) as s(scheme)
    join public.clients c on c.id = pr.client_id
    where pr.firm_id = p_firm and pr.verified_at is not null
      and (p_scheme is null or s.scheme = p_scheme)
      and ((s.scheme = 'PF' and pr.pf_status = 'applicable') or (s.scheme = 'ESI' and pr.esi_status = 'applicable'))
  loop
    insert into public.fo_periods (firm_id, client_id, scheme, period, due_date, preparer_id, reviewer_id)
    values (p_firm, r.client_id, r.scheme, v_month,
            case when r.scheme = 'PF' and r.pf_due_day is not null then v_next + (least(r.pf_due_day, v_last) - 1)
                 when r.scheme = 'ESI' and r.esi_due_day is not null then v_next + (least(r.esi_due_day, v_last) - 1) end,
            r.preparer_id, r.reviewer_id)
    on conflict (client_id, scheme, period) do nothing
    returning id into v_id;
    if v_id is not null then
      n := n + 1;
      perform private.fo_log(p_firm, r.client_id, 'period', v_id, 'created', format('%s obligation for %s', r.scheme, to_char(v_month, 'Mon YYYY')));
      v_id := null;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.fo_generate_periods(uuid, date, text) from public, anon;
grant execute on function public.fo_generate_periods(uuid, date, text) to authenticated;

-- Save a calculation (or imported figures) as the next version and move the obligation to Calculated.
create or replace function public.fo_save_calculation(
  p_period uuid, p_method text, p_rule uuid, p_batch uuid,
  p_employee_count int, p_total_wages numeric, p_total_employee numeric, p_total_employer numeric,
  p_components jsonb, p_lines jsonb, p_exceptions jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.fo_periods; v_rule public.fo_rule_versions; v_ver int; v_id uuid; v_me uuid; v_payable numeric(14,2);
begin
  select * into v from public.fo_periods where id = p_period for update;
  if v.id is null or not private.fo_access(v.firm_id) then raise exception 'Obligation not found.'; end if;
  if v.status not in ('data_received', 'calculated', 'changes_requested') then
    raise exception 'This obligation is %; it can be calculated only after payroll data is received and before review.', replace(v.status, '_', ' ');
  end if;
  if p_method not in ('calculated', 'imported') then raise exception 'Unknown calculation method.'; end if;
  if p_batch is null or not exists (select 1 from public.fo_payroll_batches b where b.id = p_batch and b.period_id = p_period) then
    raise exception 'Choose the payroll upload this calculation uses.';
  end if;
  if p_method = 'calculated' then
    select * into v_rule from public.fo_rule_versions where id = p_rule and firm_id = v.firm_id;
    if v_rule.id is null then raise exception 'Choose an approved rule version.'; end if;
    if v_rule.status <> 'approved' then raise exception 'Rule version % is not approved.', v_rule.version; end if;
    if v_rule.scheme <> v.scheme then raise exception 'That rule version is for %, not %.', v_rule.scheme, v.scheme; end if;
    if v_rule.effective_from > v.period then raise exception 'That rule version takes effect after this period.'; end if;
  elsif p_rule is not null then
    raise exception 'Imported figures do not use a rule version.';
  end if;
  if coalesce(p_total_employee, 0) < 0 or coalesce(p_total_employer, 0) < 0 or coalesce(p_total_wages, 0) < 0 then
    raise exception 'Totals cannot be negative.';
  end if;
  v_payable := round(coalesce(p_total_employee, 0) + coalesce(p_total_employer, 0), 2);
  select coalesce(max(version), 0) + 1 into v_ver from public.fo_calculations where period_id = p_period;
  select m.member_id into v_me from private.fo_my_member(v.firm_id) m;
  insert into public.fo_calculations (firm_id, period_id, version, method, rule_version_id, batch_id, employee_count,
    total_wages, total_employee, total_employer, total_payable, components, lines, exceptions, created_by)
  values (v.firm_id, p_period, v_ver, p_method, p_rule, p_batch, coalesce(p_employee_count, 0),
    round(coalesce(p_total_wages, 0), 2), round(coalesce(p_total_employee, 0), 2), round(coalesce(p_total_employer, 0), 2), v_payable,
    coalesce(p_components, '[]'), coalesce(p_lines, '[]'), coalesce(p_exceptions, '[]'),
    coalesce((select m.member_name from private.fo_my_member(v.firm_id) m), ''))
  returning id into v_id;
  perform set_config('fo.rpc', 'on', true);
  update public.fo_periods set status = 'calculated', current_calc_id = v_id, employee_count = coalesce(p_employee_count, 0),
    total_wages = round(coalesce(p_total_wages, 0), 2), total_employee = round(coalesce(p_total_employee, 0), 2),
    total_employer = round(coalesce(p_total_employer, 0), 2), total_payable = v_payable,
    exceptions_count = coalesce(jsonb_array_length(p_exceptions), 0), prepared_by_member = v_me
  where id = p_period;
  perform set_config('fo.rpc', '', true);
  perform private.fo_log(v.firm_id, v.client_id, 'period', p_period, 'calculated',
    format('Version %s (%s%s): payable %s', v_ver, p_method,
      case when v_rule.id is not null then format(', rule v%s', v_rule.version) else '' end, v_payable));
  return v_id;
end;
$$;
revoke all on function public.fo_save_calculation(uuid, text, uuid, uuid, int, numeric, numeric, numeric, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.fo_save_calculation(uuid, text, uuid, uuid, int, numeric, numeric, numeric, jsonb, jsonb, jsonb) to authenticated;

-- Move an obligation along its workflow. Allowed steps and who may take them are checked here.
create or replace function public.fo_transition(p_period uuid, p_to text, p_note text default '')
returns void language plpgsql security definer set search_path = '' as $$
declare v public.fo_periods; v_me record; v_ok boolean := false;
begin
  select * into v from public.fo_periods where id = p_period for update;
  if v.id is null or not private.fo_access(v.firm_id) then raise exception 'Obligation not found.'; end if;
  select * into v_me from private.fo_my_member(v.firm_id);
  if v_me.member_id is null then raise exception 'You are not an active team member of this firm.'; end if;

  if v.status = 'awaiting_data' and p_to = 'data_received' then
    v_ok := exists (select 1 from public.fo_payroll_batches b where b.period_id = v.id);
    if not v_ok then raise exception 'Upload payroll data first.'; end if;
  elsif v.status = 'calculated' and p_to = 'in_review' then
    v_ok := v.current_calc_id is not null;
    if v.reviewer_id is null then raise exception 'Assign a reviewer before sending for review.'; end if;
  elsif v.status = 'in_review' and p_to in ('reviewed', 'changes_requested') then
    if v_me.member_role not in ('Managing Partner', 'Partner', 'Manager') then
      raise exception 'Only a manager or partner can review.';
    end if;
    if v.prepared_by_member is not null and v.prepared_by_member = v_me.member_id then
      raise exception 'The person who prepared the calculation cannot also review it.';
    end if;
    if p_to = 'changes_requested' and coalesce(btrim(p_note), '') = '' then
      raise exception 'Say what needs to change.';
    end if;
    v_ok := true;
  elsif v.status = 'changes_requested' and p_to = 'data_received' then
    v_ok := true;
  elsif p_to = 'not_applicable' and v.status in ('awaiting_data', 'data_received', 'calculated', 'changes_requested') then
    if v_me.member_role not in ('Managing Partner', 'Partner') then raise exception 'Only a partner can mark an obligation not applicable.'; end if;
    if coalesce(btrim(p_note), '') = '' then raise exception 'Give the reason it does not apply.'; end if;
    v_ok := true;
  elsif v.status = 'not_applicable' and p_to = 'awaiting_data' then
    if v_me.member_role not in ('Managing Partner', 'Partner') then raise exception 'Only a partner can reopen an obligation.'; end if;
    v_ok := true;
  end if;

  if not v_ok then
    raise exception 'An obligation cannot move from % to %.', replace(v.status, '_', ' '), replace(p_to, '_', ' ');
  end if;
  perform set_config('fo.rpc', 'on', true);
  update public.fo_periods set status = p_to,
    review_note = case when p_to in ('reviewed', 'changes_requested') then coalesce(p_note, '') else review_note end
  where id = p_period;
  perform set_config('fo.rpc', '', true);
  perform private.fo_log(v.firm_id, v.client_id, 'period', v.id, p_to, coalesce(p_note, ''));
end;
$$;
revoke all on function public.fo_transition(uuid, text, text) from public, anon;
grant execute on function public.fo_transition(uuid, text, text) to authenticated;

-- A partner approves a draft rule version after checking it against the official source.
create or replace function public.fo_approve_rule(p_rule uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.fo_rule_versions;
begin
  select * into v from public.fo_rule_versions where id = p_rule for update;
  if v.id is null or not private.fo_access(v.firm_id) then raise exception 'Rule version not found.'; end if;
  if not private.is_firm_partner(v.firm_id) then raise exception 'Only a partner can approve contribution rules.'; end if;
  if v.status <> 'draft' then raise exception 'Only a draft can be approved.'; end if;
  if coalesce(btrim(v.source_ref), '') = '' then raise exception 'Add the official source (notification or circular) before approving.'; end if;
  if jsonb_typeof(v.params -> 'components') <> 'array' or jsonb_array_length(v.params -> 'components') = 0 then
    raise exception 'Add at least one contribution component before approving.';
  end if;
  perform set_config('fo.rpc', 'on', true);
  update public.fo_rule_versions set status = 'approved', approved_at = now(),
    approved_by = coalesce((select m.member_name from private.fo_my_member(v.firm_id) m), '')
  where id = p_rule;
  perform set_config('fo.rpc', '', true);
  perform private.fo_log(v.firm_id, null, 'rule', v.id, 'approved', format('%s rule v%s from %s · %s', v.scheme, v.version, v.effective_from, v.source_ref));
end;
$$;
revoke all on function public.fo_approve_rule(uuid) from public, anon;
grant execute on function public.fo_approve_rule(uuid) to authenticated;

create or replace function public.fo_retire_rule(p_rule uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.fo_rule_versions;
begin
  select * into v from public.fo_rule_versions where id = p_rule for update;
  if v.id is null or not private.fo_access(v.firm_id) then raise exception 'Rule version not found.'; end if;
  if not private.is_firm_partner(v.firm_id) then raise exception 'Only a partner can retire contribution rules.'; end if;
  if v.status <> 'approved' then raise exception 'Only an approved version can be retired.'; end if;
  perform set_config('fo.rpc', 'on', true);
  update public.fo_rule_versions set status = 'retired' where id = p_rule;
  perform set_config('fo.rpc', '', true);
  perform private.fo_log(v.firm_id, null, 'rule', v.id, 'retired', format('%s rule v%s', v.scheme, v.version));
end;
$$;
revoke all on function public.fo_retire_rule(uuid) from public, anon;
grant execute on function public.fo_retire_rule(uuid) to authenticated;

-- ---------------------------------------------------------------- 6. refresh the API
notify pgrst, 'reload schema';
