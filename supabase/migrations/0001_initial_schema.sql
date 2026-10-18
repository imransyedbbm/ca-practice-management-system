-- CA Practice Management System: initial multi-tenant foundation.
-- Apply in a new Supabase project only after reviewing this schema with your developer/security reviewer.
create extension if not exists pgcrypto;
create type public.firm_role as enum ('managing_partner','partner','manager','staff','client_user');
create type public.client_status as enum ('Active','Onboarding','Inactive');
create type public.task_status as enum ('Scheduled','Documents Requested','In Progress','Prepared','Under Review','Changes Requested','Approved','Ready to File','Filed','Evidence Pending','Completed');
create type public.task_priority as enum ('Low','Medium','High','Critical');

create table public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null default '',
  created_at timestamptz not null default now()
);
create table public.firm_members (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role public.firm_role not null default 'staff',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(firm_id,user_id)
);
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  name text not null,
  entity_type text not null,
  email text not null default '',
  phone text not null default '',
  pan text not null default '',
  gstin text not null default '',
  status public.client_status not null default 'Active',
  services text[] not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_firm_name_idx on public.clients(firm_id,name);
create table public.compliance_tasks (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  title text not null,
  category text not null,
  period text not null,
  due_date date not null,
  internal_due_date date not null,
  status public.task_status not null default 'Scheduled',
  priority public.task_priority not null default 'Medium',
  assigned_to text not null default '',
  reviewer text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internal_due_not_after_due check (internal_due_date <= due_date)
);
create index tasks_firm_due_idx on public.compliance_tasks(firm_id,due_date);
create index tasks_client_idx on public.compliance_tasks(client_id);
create table public.audit_events (
  id bigint generated always as identity primary key,
  firm_id uuid not null references public.firms(id) on delete cascade,
  actor_id uuid references auth.users(id),
  entity_type text not null,
  entity_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_user_firm_ids()
returns setof uuid language sql stable security definer set search_path = public
as $$ select firm_id from public.firm_members where user_id = auth.uid() and active = true $$;
revoke all on function public.current_user_firm_ids() from public;
grant execute on function public.current_user_firm_ids() to authenticated;

alter table public.firms enable row level security;
alter table public.firm_members enable row level security;
alter table public.clients enable row level security;
alter table public.compliance_tasks enable row level security;
alter table public.audit_events enable row level security;
create policy "members can view their firms" on public.firms for select to authenticated using (id in (select public.current_user_firm_ids()));
create policy "members can view firm membership" on public.firm_members for select to authenticated using (firm_id in (select public.current_user_firm_ids()));
create policy "firm members can read clients" on public.clients for select to authenticated using (firm_id in (select public.current_user_firm_ids()));
create policy "firm members can insert clients" on public.clients for insert to authenticated with check (firm_id in (select public.current_user_firm_ids()));
create policy "firm members can update clients" on public.clients for update to authenticated using (firm_id in (select public.current_user_firm_ids())) with check (firm_id in (select public.current_user_firm_ids()));
create policy "firm members can read tasks" on public.compliance_tasks for select to authenticated using (firm_id in (select public.current_user_firm_ids()));
create policy "firm members can insert tasks" on public.compliance_tasks for insert to authenticated with check (firm_id in (select public.current_user_firm_ids()) and exists(select 1 from public.clients c where c.id=client_id and c.firm_id=compliance_tasks.firm_id));
create policy "firm members can update tasks" on public.compliance_tasks for update to authenticated using (firm_id in (select public.current_user_firm_ids())) with check (firm_id in (select public.current_user_firm_ids()));
create policy "firm members can read audit events" on public.audit_events for select to authenticated using (firm_id in (select public.current_user_firm_ids()));

-- NOTE: This is an initial schema, not a completed permission model. Before production, add role-specific write policies,
-- server-side audit-event insertion, immutable audit controls, storage policies, invitation/onboarding flows and automated tests.
