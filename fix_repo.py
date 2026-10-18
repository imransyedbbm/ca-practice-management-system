#!/usr/bin/env python3
"""
Fixes for imransyedbbm/ca-practice-management-system.
Run from the repository root:   python3 fix_repo.py
Safe to run more than once: each step checks whether it is already applied.
"""
from pathlib import Path
import re
import sys

ROOT = Path.cwd()
if not (ROOT / "package.json").exists() or not (ROOT / "src" / "lib.ts").exists():
    sys.exit("Run this from the repository root (the folder containing package.json).")


def say(ok, msg):
    print(("  [done] " if ok else "  [skip] ") + msg)


# ---------------------------------------------------------------- 1. lib.ts
lib = ROOT / "src" / "lib.ts"
src = lib.read_text(encoding="utf-8")

# 1a. Restore the backticks lost in the web editor (the build-breaking error).
fixed, n = re.subn(r"new Date\(\$\{s\}T00:00:00\)", "new Date(`${s}T00:00:00`)", src)
src = fixed
say(n > 0, "lib.ts: restored template-literal backticks in shortDate")

# 1b. Error message should name both accepted env var names.
old_msg = "Check VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in your .env file."
new_msg = "Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY) in your .env file."
if old_msg in src:
    src = src.replace(old_msg, new_msg)
    say(True, "lib.ts: clarified missing-config error message")

# 1c. Helper that returns the signed-in user's firm id (needed for inserts).
if "export async function currentFirmId" not in src:
    src += '''
let cachedFirmId: string | null = null;

/**
 * Returns the firm id of the signed-in user, or null if not signed in
 * or not yet a member of any firm. Cached after the first lookup.
 */
export async function currentFirmId(): Promise<string | null> {
  if (cachedFirmId) return cachedFirmId;
  if (!supabase) return null;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data, error } = await supabase
    .from('firm_members')
    .select('firm_id')
    .eq('user_id', auth.user.id)
    .eq('active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  cachedFirmId = data.firm_id as string;
  return cachedFirmId;
}

/** Clears the cached firm id (call on sign-out or after creating a firm). */
export function resetFirmCache() {
  cachedFirmId = null;
}
'''
    say(True, "lib.ts: added currentFirmId() / resetFirmCache()")
else:
    say(False, "lib.ts: currentFirmId() already present")

lib.write_text(src, encoding="utf-8")

# ---------------------------------------------------------------- 2. App.tsx
app = ROOT / "src" / "App.tsx"
a = app.read_text(encoding="utf-8")

old_import = "import { supabase, money, shortDate, type Client, type Task } from './lib';"
new_import = "import { supabase, currentFirmId, money, shortDate, type Client, type Task } from './lib';"
if old_import in a:
    a = a.replace(old_import, new_import)
    say(True, "App.tsx: imported currentFirmId")

guard = "const firm_id=await currentFirmId();if(!firm_id){setNotice('Sign in and set up your firm before saving to the database.');return}"

old_client = "if(supabase){const {data,error}=await supabase.from('clients').insert({...item,id:undefined})"
new_client = "if(supabase){" + guard + "const {data,error}=await supabase.from('clients').insert({...item,id:undefined,firm_id})"
if old_client in a:
    a = a.replace(old_client, new_client)
    say(True, "App.tsx: client insert now sends firm_id")
else:
    say(False, "App.tsx: client insert already patched (or code changed)")

old_task = "if(supabase){const {data,error}=await supabase.from('compliance_tasks').insert({title:item.title,"
new_task = "if(supabase){" + guard + "const {data,error}=await supabase.from('compliance_tasks').insert({firm_id,title:item.title,"
if old_task in a:
    a = a.replace(old_task, new_task)
    say(True, "App.tsx: task insert now sends firm_id")
else:
    say(False, "App.tsx: task insert already patched (or code changed)")

app.write_text(a, encoding="utf-8")

# ---------------------------------------------------------------- 2b. Vite type declarations
# Without this, `import.meta.env` and `import './styles.css'` fail typecheck.
vite_env = ROOT / "src" / "vite-env.d.ts"
if not vite_env.exists():
    vite_env.write_text(
        '/// <reference types="vite/client" />\n\n'
        "interface ImportMetaEnv {\n"
        "  readonly VITE_SUPABASE_URL?: string;\n"
        "  readonly VITE_SUPABASE_ANON_KEY?: string;\n"
        "  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;\n"
        "}\n\n"
        "interface ImportMeta {\n"
        "  readonly env: ImportMetaEnv;\n"
        "}\n",
        encoding="utf-8",
    )
    say(True, "added src/vite-env.d.ts")
else:
    say(False, "src/vite-env.d.ts already exists")

# ---------------------------------------------------------------- 3. .gitignore
gi = ROOT / ".gitignore"
wanted = ["node_modules/", "dist/", ".env", ".env.local", ".env.*.local", "*.log", ".DS_Store", ".vscode/*", "!.vscode/extensions.json", "supabase/.temp/", "supabase/.branches/"]
existing = gi.read_text(encoding="utf-8").splitlines() if gi.exists() else []
missing = [w for w in wanted if w not in existing]
if missing:
    gi.write_text("\n".join(existing + missing).strip() + "\n", encoding="utf-8")
say(bool(missing), ".gitignore written")

# ---------------------------------------------------------------- 4. .env.example
env = ROOT / ".env.example"
if not env.exists():
    env.write_text(
        "# Copy to .env and fill in from Supabase -> Project Settings -> API.\n"
        "# Leave blank to run in demo mode (in-memory data).\n"
        "VITE_SUPABASE_URL=\n"
        "# Either name works; use the anon / publishable key, NEVER the service-role key.\n"
        "VITE_SUPABASE_ANON_KEY=\n"
        "# VITE_SUPABASE_PUBLISHABLE_KEY=\n",
        encoding="utf-8",
    )
say(True, ".env.example present")

# ---------------------------------------------------------------- 5. README
readme = ROOT / "README.md"
r = readme.read_text(encoding="utf-8")
old_r = "VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY\n```"
new_r = old_r + "\n\n(`VITE_SUPABASE_PUBLISHABLE_KEY` is also accepted instead of `VITE_SUPABASE_ANON_KEY`.)\n\nAfter `0001_initial_schema.sql`, also run `supabase/migrations/0002_onboarding_and_integrity.sql`."
if old_r in r and "0002_onboarding" not in r:
    readme.write_text(r.replace(old_r, new_r), encoding="utf-8")
    say(True, "README: documented key names and migration 0002")

# ---------------------------------------------------------------- 6. migration 0002
mig = ROOT / "supabase" / "migrations" / "0002_onboarding_and_integrity.sql"
if not mig.exists():
    mig.write_text(r'''-- 0002: firm onboarding RPC, updated_at triggers, PAN/GSTIN checks, automatic audit log.
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
''', encoding="utf-8")
    say(True, "added supabase/migrations/0002_onboarding_and_integrity.sql")
else:
    say(False, "migration 0002 already exists")

print("\nNext:  npm install   (creates package-lock.json - commit it)")
print("       npm run typecheck && npm run build")
