-- 0005: practice modules from the CAFlow prototype (everything except payroll).
-- Run in the Supabase SQL Editor after 0004. Safe to run more than once.
--
-- Adds: team members, task workflow fields, comments, activity, documents (+ private
-- file storage), messages, notices, invoices, automation rules, compliance rule
-- catalogue, firm settings, and client portal logins (client_users) with their own
-- row-level security. Statuses become plain text with check constraints.

-- ---------------------------------------------------------------- 1. statuses as text
do $$
begin
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'clients' and column_name = 'status') <> 'text' then
    alter table public.clients alter column status drop default;
    alter table public.clients alter column status type text using status::text;
  end if;
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'compliance_tasks' and column_name = 'status') <> 'text' then
    alter table public.compliance_tasks alter column status drop default;
    alter table public.compliance_tasks alter column status type text using status::text;
  end if;
  if (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'compliance_tasks' and column_name = 'priority') <> 'text' then
    alter table public.compliance_tasks alter column priority drop default;
    alter table public.compliance_tasks alter column priority type text using priority::text;
  end if;
end $$;

update public.clients
   set status = case lower(status) when 'prospect' then 'onboarding' else lower(status) end
 where status is distinct from case lower(status) when 'prospect' then 'onboarding' else lower(status) end;

update public.compliance_tasks
   set status = case lower(replace(status, ' ', '_'))
                  when 'pending' then 'scheduled'
                  when 'overdue' then 'in_progress'
                  else lower(replace(status, ' ', '_')) end;

update public.compliance_tasks
   set priority = case lower(priority) when 'urgent' then 'critical' else lower(priority) end;

alter table public.clients alter column status set default 'onboarding';
alter table public.clients drop constraint if exists clients_status_allowed;
alter table public.clients add constraint clients_status_allowed
  check (status in ('active', 'onboarding', 'inactive'));

alter table public.compliance_tasks alter column status set default 'scheduled';
alter table public.compliance_tasks drop constraint if exists tasks_status_allowed;
alter table public.compliance_tasks add constraint tasks_status_allowed
  check (status in ('scheduled', 'documents_requested', 'in_progress', 'prepared', 'under_review',
                    'changes_requested', 'approved', 'ready_to_file', 'filed', 'evidence_pending', 'completed'));

alter table public.compliance_tasks alter column priority set default 'medium';
alter table public.compliance_tasks drop constraint if exists tasks_priority_allowed;
alter table public.compliance_tasks add constraint tasks_priority_allowed
  check (priority in ('low', 'medium', 'high', 'critical'));

-- ---------------------------------------------------------------- 2. helper: is partner
create or replace function private.is_firm_partner(p_firm uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.firm_members fm
    where fm.firm_id = p_firm
      and fm.user_id = (select auth.uid())
      and fm.active = true
      and fm.role::text in ('managing_partner', 'partner')
  );
$$;
grant execute on function private.is_firm_partner(uuid) to authenticated;

-- ---------------------------------------------------------------- 3. team members
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  role text not null default 'Accountant'
    check (role in ('Managing Partner', 'Partner', 'Manager', 'Senior Accountant', 'Accountant', 'Article Assistant')),
  email text not null default '',
  capacity integer not null default 16 check (capacity between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists team_members_firm_user_uniq
  on public.team_members (firm_id, user_id) where user_id is not null;
create index if not exists team_members_firm_idx on public.team_members (firm_id);

-- Every firm login gets a team-member row automatically.
create or replace function private.team_member_for_login()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.team_members (firm_id, user_id, name, role, email)
  select new.firm_id, new.user_id,
         coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), split_part(coalesce(new.email, u.email, ''), '@', 1), 'Team member'),
         case new.role::text when 'managing_partner' then 'Managing Partner'
                             when 'partner' then 'Partner' else 'Accountant' end,
         coalesce(new.email, u.email, '')
  from auth.users u
  where u.id = new.user_id
    and not exists (select 1 from public.team_members tm
                    where tm.firm_id = new.firm_id and tm.user_id = new.user_id);
  return new;
end;
$$;
drop trigger if exists firm_members_team_member on public.firm_members;
create trigger firm_members_team_member after insert on public.firm_members
  for each row execute function private.team_member_for_login();

insert into public.team_members (firm_id, user_id, name, role, email)
select fm.firm_id, fm.user_id,
       coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), split_part(coalesce(fm.email, u.email, ''), '@', 1), 'Team member'),
       case fm.role::text when 'managing_partner' then 'Managing Partner'
                          when 'partner' then 'Partner' else 'Accountant' end,
       coalesce(fm.email, u.email, '')
from public.firm_members fm
join auth.users u on u.id = fm.user_id
where not exists (select 1 from public.team_members tm
                  where tm.firm_id = fm.firm_id and tm.user_id = fm.user_id);

-- ---------------------------------------------------------------- 4. client fields
alter table public.clients add column if not exists contact_person text not null default '';
alter table public.clients add column if not exists state_code text not null default '';
alter table public.clients add column if not exists tan text not null default '';
alter table public.clients add column if not exists partner_id uuid references public.team_members(id) on delete set null;
alter table public.clients add column if not exists package text not null default 'Growth';
alter table public.clients add column if not exists client_since text not null default '';

-- ---------------------------------------------------------------- 5. task workflow fields
alter table public.compliance_tasks add column if not exists task_no bigint generated by default as identity;
alter table public.compliance_tasks add column if not exists form text not null default '';
alter table public.compliance_tasks add column if not exists fy text not null default '';
alter table public.compliance_tasks add column if not exists template_key text;
alter table public.compliance_tasks add column if not exists preparer_id uuid references public.team_members(id) on delete set null;
alter table public.compliance_tasks add column if not exists reviewer_id uuid references public.team_members(id) on delete set null;
alter table public.compliance_tasks add column if not exists blocked text not null default '';
alter table public.compliance_tasks add column if not exists checklist jsonb not null default '[]'::jsonb;
alter table public.compliance_tasks add column if not exists required_docs text[] not null default '{}';
alter table public.compliance_tasks add column if not exists filing jsonb not null default
  '{"method":"Assisted","ack":"","submitted_on":"","evidence":"not_due","evidence_path":"","evidence_name":"","ev_rejected":""}'::jsonb;
-- One generated task per client, template and period (manual tasks have no template_key).
create unique index if not exists tasks_client_template_period_uniq
  on public.compliance_tasks (client_id, template_key, period);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  task_id uuid not null references public.compliance_tasks(id) on delete cascade,
  author_name text not null default '',
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index if not exists task_comments_task_idx on public.task_comments (task_id);

create table if not exists public.task_activity (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  task_id uuid not null references public.compliance_tasks(id) on delete cascade,
  actor_name text not null default '',
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists task_activity_firm_idx on public.task_activity (firm_id, created_at desc);

-- ---------------------------------------------------------------- 6. documents, messages, notices, invoices
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  task_id uuid references public.compliance_tasks(id) on delete set null,
  name text not null,
  fy text not null default '',
  status text not null default 'requested'
    check (status in ('requested', 'missing', 'awaiting_review', 'rejected', 'received')),
  requested_on date,
  uploaded_on date,
  comment text not null default '',
  file_path text not null default '',
  file_name text not null default '',
  reviewed_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists documents_firm_idx on public.documents (firm_id);
create index if not exists documents_client_idx on public.documents (client_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  task_id uuid references public.compliance_tasks(id) on delete set null,
  channel text not null check (channel in ('email', 'whatsapp', 'in_app')),
  recipient text not null default '',
  to_addr text not null default '',
  purpose text not null default '',
  template text not null default '',
  scheduled_at timestamptz,
  status text not null default 'logged' check (status in ('logged', 'scheduled', 'queued', 'draft')),
  read boolean not null default false,
  body text not null default '',
  recipient_member_id uuid references public.team_members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists messages_firm_idx on public.messages (firm_id, created_at desc);

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  authority text not null default '',
  ref text not null,
  subject text not null,
  demand numeric(14, 2) not null default 0 check (demand >= 0),
  received_on date,
  response_due date,
  status text not null default 'new' check (status in ('new', 'drafting', 'response_filed', 'closed')),
  owner_id uuid references public.team_members(id) on delete set null,
  doc_ref text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists notices_firm_idx on public.notices (firm_id);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  invoice_no text not null,
  period text not null default '',
  amount numeric(14, 2) not null check (amount > 0),
  issued_on date,
  due_on date,
  status text not null default 'unpaid' check (status in ('draft', 'unpaid', 'paid')),
  paid_note text not null default '',
  created_at timestamptz not null default now(),
  unique (firm_id, invoice_no)
);
create index if not exists invoices_client_idx on public.invoices (client_id);

-- ---------------------------------------------------------------- 7. rules, catalogue, settings
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  rule_key text not null,
  name text not null,
  trig text not null default '',
  action text not null default '',
  scope text not null default '',
  enabled boolean not null default true,
  days integer not null default 0 check (days between 0 and 60),
  kind text not null check (kind in ('generate', 'docs', 'remind', 'escalate', 'review', 'evidence')),
  last_run text not null default '',
  unique (firm_id, rule_key)
);

create table if not exists public.compliance_rules (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  rule_key text not null,
  authority text not null,
  form text not null,
  applicability text not null default '',
  frequency text not null default '',
  due_rule text not null default '',
  effective date,
  source text not null default '',
  verified_on date,
  verified_by text not null default '',
  version text not null default 'v1',
  status text not null default 'draft' check (status in ('approved', 'proposed', 'draft')),
  history jsonb not null default '[]'::jsonb,
  proposal jsonb,
  unique (firm_id, rule_key)
);

create table if not exists public.firm_settings (
  firm_id uuid primary key references public.firms(id) on delete cascade,
  short_code text not null default '',
  templates jsonb not null default '{}'::jsonb,
  notif jsonb not null default '{}'::jsonb,
  escalation jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- 8. client portal logins
create table if not exists public.client_users (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  user_id uuid references auth.users(id) on delete cascade,
  invited_by text not null default '',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, email)
);
create index if not exists client_users_user_idx on public.client_users (user_id);

create or replace function private.current_user_client_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select cu.client_id from public.client_users cu where cu.user_id = (select auth.uid());
$$;
grant execute on function private.current_user_client_ids() to authenticated;

create or replace function private.current_user_client_firm_ids()
returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select distinct cu.firm_id from public.client_users cu where cu.user_id = (select auth.uid());
$$;
grant execute on function private.current_user_client_firm_ids() to authenticated;

-- Links invitations to the signed-in user. Only works for a confirmed email address.
create or replace function public.claim_client_access()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  n integer;
begin
  if v_uid is null then return 0; end if;
  select u.email, u.email_confirmed_at into v_email, v_confirmed from auth.users u where u.id = v_uid;
  if v_email is null or v_confirmed is null then return 0; end if;
  update public.client_users
     set user_id = v_uid, accepted_at = now()
   where user_id is null and lower(email) = lower(v_email);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.claim_client_access() from public, anon;
grant execute on function public.claim_client_access() to authenticated;

-- A client user marks a requested document as uploaded (the file itself goes to storage).
create or replace function public.client_upload_document(p_doc uuid, p_path text, p_name text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  d public.documents%rowtype;
  v_client_name text;
begin
  select * into d from public.documents where id = p_doc;
  if d.id is null or not (d.client_id in (select private.current_user_client_ids())) then
    raise exception 'You cannot upload to this document request' using errcode = '42501';
  end if;
  if d.status not in ('requested', 'missing', 'rejected') then
    raise exception 'This document is not waiting for an upload' using errcode = '22023';
  end if;
  if p_path not like d.firm_id::text || '/' || d.client_id::text || '/%' then
    raise exception 'Invalid file location' using errcode = '22023';
  end if;
  update public.documents
     set status = 'awaiting_review', file_path = p_path, file_name = left(coalesce(p_name, ''), 200),
         uploaded_on = current_date, comment = ''
   where id = p_doc;
  select c.name into v_client_name from public.clients c where c.id = d.client_id;
  if d.task_id is not null then
    insert into public.task_activity (firm_id, task_id, actor_name, text)
    values (d.firm_id, d.task_id, 'Client', 'Client uploaded ' || d.name);
    update public.compliance_tasks set blocked = '' where id = d.task_id and blocked <> '';
    insert into public.messages (firm_id, client_id, task_id, channel, recipient, purpose, status, body, recipient_member_id)
    select d.firm_id, d.client_id, d.task_id, 'in_app', coalesce(tm.name, ''), 'Document received', 'logged',
           coalesce(v_client_name, 'Client') || ' uploaded ' || d.name || '.', t.preparer_id
    from public.compliance_tasks t
    left join public.team_members tm on tm.id = t.preparer_id
    where t.id = d.task_id;
  end if;
end;
$$;
revoke all on function public.client_upload_document(uuid, text, text) from public, anon;
grant execute on function public.client_upload_document(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- 9. defaults for each firm
create or replace function private.seed_firm_defaults(p_firm uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.firm_settings (firm_id, short_code, templates, notif, escalation)
  select f.id,
         upper(left(regexp_replace(f.name, '[^A-Za-z]', '', 'g'), 3)),
         '{
           "doc_request": {"name": "Document request", "channel": "Email", "body": "Dear {{contact}},\n\nTo complete {{task}}, please share the pending documents through the client portal.\n\nRegards,\n{{firm}}"},
           "deadline":    {"name": "Deadline reminder", "channel": "WhatsApp", "body": "{{firm}}: {{task}} for {{client}} is due on {{due}}. Please share any pending inputs today."},
           "approval":    {"name": "Approval request", "channel": "Email", "body": "Dear {{contact}},\n\nThe draft of {{task}} is ready. Please review and approve so we can file before {{due}}.\n\nRegards,\n{{firm}}"},
           "filing_conf": {"name": "Filing confirmation", "channel": "Email", "body": "Dear {{contact}},\n\n{{task}} has been submitted. Acknowledgement: {{ack}}.\n\nRegards,\n{{firm}}"}
         }'::jsonb,
         '{"email": true, "wa": false, "inapp": true, "digest": true, "clientCopy": true}'::jsonb,
         '{"remind": 3, "escalate": 1, "partner": 3, "critical": true}'::jsonb
  from public.firms f
  where f.id = p_firm
  on conflict (firm_id) do nothing;

  insert into public.automation_rules (firm_id, rule_key, name, trig, action, scope, enabled, days, kind)
  values
    (p_firm, 'r1', 'Monthly GST task generation', '1st of every month', 'Create GSTR-1 and GSTR-3B tasks for clients with a GSTIN and the GST service', 'Clients with GST service', true, 0, 'generate'),
    (p_firm, 'r2', 'Advance document request', 'Internal due date minus N days', 'Log an email document request to the client contact for each pending document', 'All open tasks', true, 15, 'docs'),
    (p_firm, 'r3', 'Preparer reminder', 'Internal due date minus N days', 'In-app reminder to the preparer', 'Tasks not yet Prepared', true, 3, 'remind'),
    (p_firm, 'r4', 'Overdue escalation', 'Internal due date passed', 'Notify the reviewer and raise priority to Critical', 'Tasks before Filed', true, 0, 'escalate'),
    (p_firm, 'r5', 'Reviewer handoff', 'Status changes to Prepared', 'Notify the assigned reviewer and move the task to Under Review', 'All tasks', true, 0, 'review'),
    (p_firm, 'r6', 'Evidence chase', 'Filed without verified evidence', 'Remind the preparer to upload the acknowledgement', 'Filed / Evidence Pending', false, 2, 'evidence')
  on conflict (firm_id, rule_key) do nothing;

  insert into public.compliance_rules (firm_id, rule_key, authority, form, applicability, frequency, due_rule, effective, source, version, status, history)
  values
    (p_firm, 'cr1', 'GSTN', 'GSTR-1', 'Registered taxpayers filing monthly (non-QRMP)', 'Monthly', 'Day 11 of following month', '2026-04-01', 'https://www.gst.gov.in', 'v1', 'draft', '[]'),
    (p_firm, 'cr2', 'GSTN', 'GSTR-3B', 'Registered regular taxpayers', 'Monthly / Quarterly (QRMP)', 'Day 20 of following month (monthly)', '2026-04-01', 'https://www.gst.gov.in', 'v1', 'draft', '[]'),
    (p_firm, 'cr3', 'Income Tax Dept', 'TDS 24Q / 26Q', 'Deductors holding a TAN', 'Quarterly', 'Last day of month after quarter end (Q1-Q3); 31 May for Q4', '2026-04-01', 'https://www.incometax.gov.in', 'v1', 'draft', '[]'),
    (p_firm, 'cr4', 'Income Tax Dept', 'ITR-6', 'Companies other than those claiming Sec 11 exemption', 'Annual', 'Audit cases: as notified for the assessment year', '2026-04-01', 'https://www.incometax.gov.in', 'v1', 'draft', '[]'),
    (p_firm, 'cr5', 'Income Tax Dept', 'Form 3CD', 'Assessees crossing tax audit thresholds', 'Annual', 'One month before ITR due date (audit cases)', '2026-04-01', 'https://www.incometax.gov.in', 'v1', 'draft', '[]'),
    (p_firm, 'cr6', 'MCA', 'AOC-4', 'Companies registered under the Companies Act, 2013', 'Annual', 'Within 30 days of AGM', '2026-04-01', 'https://www.mca.gov.in', 'v1', 'draft', '[]'),
    (p_firm, 'cr7', 'MCA', 'MGT-7 / 7A', 'All companies', 'Annual', 'Within 60 days of AGM', '2026-04-01', 'https://www.mca.gov.in', 'v1', 'draft', '[]'),
    (p_firm, 'cr8', 'MCA', 'LLP Form 8', 'All LLPs', 'Annual', 'Within 30 days from end of six months of FY', '2026-04-01', 'https://www.mca.gov.in', 'v1', 'draft', '[]'),
    (p_firm, 'cr9', 'Income Tax Dept', 'Advance tax', 'Assessees with tax liability above threshold', 'Quarterly instalments', '15 Jun / 15 Sep / 15 Dec / 15 Mar', '2026-04-01', 'https://www.incometax.gov.in', 'v1', 'draft', '[]')
  on conflict (firm_id, rule_key) do nothing;
end;
$$;

create or replace function private.seed_new_firm()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.seed_firm_defaults(new.id);
  return new;
end;
$$;
drop trigger if exists firms_seed_defaults on public.firms;
create trigger firms_seed_defaults after insert on public.firms
  for each row execute function private.seed_new_firm();

select private.seed_firm_defaults(f.id) from public.firms f;

-- ---------------------------------------------------------------- 10. row-level security
alter table public.team_members enable row level security;
alter table public.task_comments enable row level security;
alter table public.task_activity enable row level security;
alter table public.documents enable row level security;
alter table public.messages enable row level security;
alter table public.notices enable row level security;
alter table public.invoices enable row level security;
alter table public.automation_rules enable row level security;
alter table public.compliance_rules enable row level security;
alter table public.firm_settings enable row level security;
alter table public.client_users enable row level security;

-- Firms: partners may edit their firm profile; client users may see their firm's name.
drop policy if exists "Partners can update their firm" on public.firms;
create policy "Partners can update their firm" on public.firms for update to authenticated
  using (private.is_firm_partner(id)) with check (private.is_firm_partner(id));
drop policy if exists "Client users can view their firm" on public.firms;
create policy "Client users can view their firm" on public.firms for select to authenticated
  using (id in (select private.current_user_client_firm_ids()));

-- Team: everyone in the firm reads; partners manage.
drop policy if exists "Members read team" on public.team_members;
create policy "Members read team" on public.team_members for select to authenticated
  using (firm_id in (select private.current_user_firm_ids()));
drop policy if exists "Partners add team" on public.team_members;
create policy "Partners add team" on public.team_members for insert to authenticated
  with check (private.is_firm_partner(firm_id));
drop policy if exists "Partners edit team" on public.team_members;
create policy "Partners edit team" on public.team_members for update to authenticated
  using (private.is_firm_partner(firm_id)) with check (private.is_firm_partner(firm_id));

-- Comments and activity: firm members only (client users never see internal notes).
drop policy if exists "Members read comments" on public.task_comments;
create policy "Members read comments" on public.task_comments for select to authenticated
  using (firm_id in (select private.current_user_firm_ids()));
drop policy if exists "Members add comments" on public.task_comments;
create policy "Members add comments" on public.task_comments for insert to authenticated
  with check (firm_id in (select private.current_user_firm_ids())
              and exists (select 1 from public.compliance_tasks t where t.id = task_id and t.firm_id = task_comments.firm_id));
drop policy if exists "Members read activity" on public.task_activity;
create policy "Members read activity" on public.task_activity for select to authenticated
  using (firm_id in (select private.current_user_firm_ids()));
drop policy if exists "Members add activity" on public.task_activity;
create policy "Members add activity" on public.task_activity for insert to authenticated
  with check (firm_id in (select private.current_user_firm_ids())
              and exists (select 1 from public.compliance_tasks t where t.id = task_id and t.firm_id = task_activity.firm_id));

-- Documents: members manage; client users read their own (uploads go through client_upload_document).
drop policy if exists "Members read documents" on public.documents;
create policy "Members read documents" on public.documents for select to authenticated
  using (firm_id in (select private.current_user_firm_ids()));
drop policy if exists "Members add documents" on public.documents;
create policy "Members add documents" on public.documents for insert to authenticated
  with check (firm_id in (select private.current_user_firm_ids())
              and exists (select 1 from public.clients c where c.id = client_id and c.firm_id = documents.firm_id));
drop policy if exists "Members edit documents" on public.documents;
create policy "Members edit documents" on public.documents for update to authenticated
  using (firm_id in (select private.current_user_firm_ids()))
  with check (firm_id in (select private.current_user_firm_ids()));
drop policy if exists "Client users read own documents" on public.documents;
create policy "Client users read own documents" on public.documents for select to authenticated
  using (client_id in (select private.current_user_client_ids()));

-- Messages: members manage; client users read their own email/WhatsApp messages.
drop policy if exists "Members read messages" on public.messages;
create policy "Members read messages" on public.messages for select to authenticated
  using (firm_id in (select private.current_user_firm_ids()));
drop policy if exists "Members add messages" on public.messages;
create policy "Members add messages" on public.messages for insert to authenticated
  with check (firm_id in (select private.current_user_firm_ids()));
drop policy if exists "Members edit messages" on public.messages;
create policy "Members edit messages" on public.messages for update to authenticated
  using (firm_id in (select private.current_user_firm_ids()))
  with check (firm_id in (select private.current_user_firm_ids()));
drop policy if exists "Client users read own messages" on public.messages;
create policy "Client users read own messages" on public.messages for select to authenticated
  using (channel <> 'in_app' and status <> 'draft' and client_id in (select private.current_user_client_ids()));

-- Notices: firm members.
drop policy if exists "Members read notices" on public.notices;
create policy "Members read notices" on public.notices for select to authenticated
  using (firm_id in (select private.current_user_firm_ids()));
drop policy if exists "Members add notices" on public.notices;
create policy "Members add notices" on public.notices for insert to authenticated
  with check (firm_id in (select private.current_user_firm_ids())
              and exists (select 1 from public.clients c where c.id = client_id and c.firm_id = notices.firm_id));
drop policy if exists "Members edit notices" on public.notices;
create policy "Members edit notices" on public.notices for update to authenticated
  using (firm_id in (select private.current_user_firm_ids()))
  with check (firm_id in (select private.current_user_firm_ids()));

-- Invoices: partners only; client users read their own.
drop policy if exists "Partners read invoices" on public.invoices;
create policy "Partners read invoices" on public.invoices for select to authenticated
  using (private.is_firm_partner(firm_id));
drop policy if exists "Partners add invoices" on public.invoices;
create policy "Partners add invoices" on public.invoices for insert to authenticated
  with check (private.is_firm_partner(firm_id)
              and exists (select 1 from public.clients c where c.id = client_id and c.firm_id = invoices.firm_id));
drop policy if exists "Partners edit invoices" on public.invoices;
create policy "Partners edit invoices" on public.invoices for update to authenticated
  using (private.is_firm_partner(firm_id)) with check (private.is_firm_partner(firm_id));
drop policy if exists "Client users read own invoices" on public.invoices;
create policy "Client users read own invoices" on public.invoices for select to authenticated
  using (status <> 'draft' and client_id in (select private.current_user_client_ids()));

-- Automation rules: members read; partners change.
drop policy if exists "Members read automation" on public.automation_rules;
create policy "Members read automation" on public.automation_rules for select to authenticated
  using (firm_id in (select private.current_user_firm_ids()));
drop policy if exists "Partners edit automation" on public.automation_rules;
create policy "Partners edit automation" on public.automation_rules for update to authenticated
  using (private.is_firm_partner(firm_id)) with check (private.is_firm_partner(firm_id));

-- Compliance catalogue: members read and propose changes; approval is a partner action in the app.
drop policy if exists "Members read catalogue" on public.compliance_rules;
create policy "Members read catalogue" on public.compliance_rules for select to authenticated
  using (firm_id in (select private.current_user_firm_ids()));
drop policy if exists "Members edit catalogue" on public.compliance_rules;
create policy "Members edit catalogue" on public.compliance_rules for update to authenticated
  using (firm_id in (select private.current_user_firm_ids()))
  with check (firm_id in (select private.current_user_firm_ids()));

-- Settings: members read; partners change.
drop policy if exists "Members read settings" on public.firm_settings;
create policy "Members read settings" on public.firm_settings for select to authenticated
  using (firm_id in (select private.current_user_firm_ids()));
drop policy if exists "Partners edit settings" on public.firm_settings;
create policy "Partners edit settings" on public.firm_settings for update to authenticated
  using (private.is_firm_partner(firm_id)) with check (private.is_firm_partner(firm_id));

-- Client portal access: partners manage invitations; a client user sees their own link.
drop policy if exists "Partners read client access" on public.client_users;
create policy "Partners read client access" on public.client_users for select to authenticated
  using (private.is_firm_partner(firm_id));
drop policy if exists "Partners invite client users" on public.client_users;
create policy "Partners invite client users" on public.client_users for insert to authenticated
  with check (private.is_firm_partner(firm_id)
              and exists (select 1 from public.clients c where c.id = client_id and c.firm_id = client_users.firm_id));
drop policy if exists "Partners revoke client users" on public.client_users;
create policy "Partners revoke client users" on public.client_users for delete to authenticated
  using (private.is_firm_partner(firm_id));
drop policy if exists "Client users read own access" on public.client_users;
create policy "Client users read own access" on public.client_users for select to authenticated
  using (user_id = (select auth.uid()));

-- Existing tables: client users may read their own client record and its tasks.
drop policy if exists "Client users read own client" on public.clients;
create policy "Client users read own client" on public.clients for select to authenticated
  using (id in (select private.current_user_client_ids()));
drop policy if exists "Client users read own tasks" on public.compliance_tasks;
create policy "Client users read own tasks" on public.compliance_tasks for select to authenticated
  using (client_id in (select private.current_user_client_ids()));

-- ---------------------------------------------------------------- 11. private file storage
insert into storage.buckets (id, name, public, file_size_limit)
values ('firm-documents', 'firm-documents', false, 10485760)
on conflict (id) do nothing;

-- Files live at <firm_id>/<client_id>/<file>.
drop policy if exists "Firm members read firm files" on storage.objects;
create policy "Firm members read firm files" on storage.objects for select to authenticated
  using (bucket_id = 'firm-documents'
         and (storage.foldername(name))[1] in (select f::text from private.current_user_firm_ids() f));
drop policy if exists "Firm members upload firm files" on storage.objects;
create policy "Firm members upload firm files" on storage.objects for insert to authenticated
  with check (bucket_id = 'firm-documents'
              and (storage.foldername(name))[1] in (select f::text from private.current_user_firm_ids() f));
drop policy if exists "Client users read own files" on storage.objects;
create policy "Client users read own files" on storage.objects for select to authenticated
  using (bucket_id = 'firm-documents'
         and exists (select 1 from public.client_users cu
                     where cu.user_id = (select auth.uid())
                       and cu.firm_id::text = (storage.foldername(name))[1]
                       and cu.client_id::text = (storage.foldername(name))[2]));
drop policy if exists "Client users upload own files" on storage.objects;
create policy "Client users upload own files" on storage.objects for insert to authenticated
  with check (bucket_id = 'firm-documents'
              and exists (select 1 from public.client_users cu
                          where cu.user_id = (select auth.uid())
                            and cu.firm_id::text = (storage.foldername(name))[1]
                            and cu.client_id::text = (storage.foldername(name))[2]));

-- ---------------------------------------------------------------- 12. refresh the API
notify pgrst, 'reload schema';
