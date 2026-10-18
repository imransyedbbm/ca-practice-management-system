# CA Practice Management System

A Windows-friendly application foundation based on the uploaded CAFlow India HTML prototype. It converts the visual concept into a React + TypeScript application and introduces a Supabase data layer and initial multi-tenant schema.

## Included in this starter

- Responsive firm dashboard
- Client directory and Add Client form
- Compliance task register, create-task form and status updates
- Review queue and deadline list
- Demo mode when Supabase credentials are absent
- Supabase client integration when `.env` is configured
- Initial PostgreSQL schema for firms, members, clients, compliance tasks and audit events, with RLS policies
- Original prototype preserved as `reference-caflow-prototype.html`

## Important status

This is a **development foundation, not a production-ready accounting/compliance system**. Demo mode keeps edits in memory and loses them on refresh. Supabase mode requires the schema migration and a properly provisioned firm membership. The current UI has no completed sign-in/onboarding flow, document upload/storage, client portal, notification delivery, statutory portal filing, fee invoicing, or fully enforced role-specific permissions. Do not use real PAN/GSTIN, client documents or confidential financial data until authentication, tenant isolation, access policies, storage and security have been reviewed and tested.

The sample statutory dates and records are illustrative only; verify all compliance deadlines with authoritative sources before using them operationally.

## Build on Windows 10/11 using PowerShell

### 1. Install prerequisites

Install Node.js 20 LTS or newer and Git for Windows. Open a new PowerShell terminal and verify:

```powershell
node --version
npm --version
git --version
```

### 2. Unzip and enter the project

Extract `ca-practice-management-system.zip`, then run PowerShell in the extracted folder:

```powershell
cd path\to\ca-practice-management-system
npm install
Copy-Item .env.example .env
npm run dev
```

Open the local URL Vite prints, usually `http://localhost:5173`.

### 3. Run a production build check

Stop the dev server with `Ctrl+C`, then run:

```powershell
npm run typecheck
npm run build
npm run preview
```

### 4. Configure Supabase persistence

1. Create a new Supabase project for this application (do not reuse a project containing unrelated or sensitive data without a migration plan).
2. In Supabase SQL Editor, review and run `supabase/migrations/0001_initial_schema.sql`.
3. Copy the Project URL and anon/publishable key from Supabase Project Settings → API into `.env`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
```

(`VITE_SUPABASE_PUBLISHABLE_KEY` is also accepted instead of `VITE_SUPABASE_ANON_KEY`.)

After `0001_initial_schema.sql`, also run `supabase/migrations/0002_onboarding_and_integrity.sql`.

4. Restart Vite after editing `.env`.

**Current limitation:** the schema is multi-tenant, but this starter does not yet implement account creation, firm creation, or adding the signed-in user to `firm_members`. Consequently, authenticated Supabase queries will return no rows until a secure onboarding/bootstrap process creates a firm and membership. Do not bypass RLS or place a Supabase service-role key in the browser. The next implementation step is authentication + secure first-firm setup, then tests proving one firm's users cannot access another firm's records.

## Suggested implementation sequence

1. Authentication, firm onboarding, invitations, role-specific authorization and tenant-isolation tests.
2. Clients: edit/detail screens, contacts, service engagements, PAN/GSTIN validation, duplicate checks.
3. Compliance engine: versioned task templates, financial-year/period generation, calendar, internal dates, reviewer workflow and verified statutory deadline sources.
4. Documents: private object storage, signed links, versioning, virus scanning, retention and evidence logs.
5. Client portal: secure upload, document request/response, queries and approval.
6. Notices and filing evidence: manual filing records first; portal integrations only with authorised providers and consent.
7. Billing, fee schedules, invoices, payment tracking and reports.
8. Notifications, audit trail, backups, observability, deployment, security review and disaster-recovery testing.

## Windows Terminal / Git workflow

```powershell
git init
git add .
git commit -m "Initial CA practice management foundation"
```

Keep `.env` out of Git. Never commit credentials, client identifiers or uploaded documents.
