# CAFlow India: CA practice management

React + TypeScript + Vite front end with a Supabase (PostgreSQL) back end. Deployed on Vercel.

## Modules

| Module | What it does |
|---|---|
| Dashboard | KPIs, monthly filing completion, critical alerts, upcoming deadlines, risk summary, status distribution, team workload, recent activity |
| Clients | Client register with PAN / TAN / GSTIN validation, services, package, partner; detail tabs for compliance, tasks, documents, filings, messages, billing and portal access |
| Compliance calendar | Month and agenda views by statutory or internal due date, with filters |
| Tasks & workflows | 11-step workflow (Scheduled → Completed), table and drag-and-drop kanban, checklist, comments, activity log, reassignment, automation rules |
| Regulatory filings | Assisted filing: record submission and acknowledgement, upload evidence, partner verification |
| Documents | Document requests per task, uploads to private storage, accept / reject with comments, reminders |
| Notices & assessments | Log notices with demand, response due date, owner and status |
| Notifications | In-app alerts; email and WhatsApp messages are logged (no provider is connected, so nothing is sent); editable templates |
| Team & workload | Team members, roles, capacity and utilisation; bulk reassignment |
| Reports | Completion, filing status, overdue by person, document collection, workload, client health, outstanding fees; CSV export |
| Billing | Invoices with 18% GST, drafts, payments, reminders (partners only) |
| Compliance rules | Catalogue of due-date rules with proposals, partner approval and version history |
| Integrations | What each external connection would need (none are connected yet except file storage) |
| Settings | Firm profile, permissions, notification preferences, escalation policies |
| Client portal | Client users see only their own company: timeline, requested documents (upload), filings, invoices, messages |

Due dates are generated from standard patterns (for example GSTR-3B on the 20th of the following month). They ignore extensions, QRMP and special notifications, so they **must be checked against official sources**.

## Database

Run these in the Supabase SQL Editor, in order (each is safe to re-run):

1. `supabase/migrations/0004_match_live_database.sql`
2. `supabase/migrations/0005_practice_modules.sql`
3. `supabase/migrations/0006_team_invites.sql`
4. `supabase/migrations/0007_team_email_unique.sql`

Then deploy the team invitation function (Supabase CLI, once per change):

```bash
supabase functions deploy invite-team-member
```

`supabase/archive/` holds early drafts that do not match the live database; do not run them.

Access is enforced by row-level security:

- **Partners** (managing partner / partner) see and manage everything in their firm.
- **Staff** work on clients, tasks, filings, documents, notices and messages, but cannot see invoices or change settings, rules, team or portal access.
- **Client users** see only the client company their email was given access to.

## Team logins

**Team & Workload → Add team member** can email the person a login invitation (ticked by default). They click the link, set a password and land in your firm with the role you chose. The Team page shows each person's login status (Signed in, Invited, No login) with a Send / Resend invite button. If an invited person signs up on their own with the same email instead, they join the firm once their email is confirmed. Changing a person's role or marking them inactive applies to their login straight away.

## Supabase auth settings (important)

- **Connect a real email service.** Supabase's built-in mailer only sends to members of your Supabase organisation and only a few emails an hour, so invitations and confirmations to anyone else never arrive. Under **Authentication → Emails → SMTP settings**, connect a provider such as Resend, Brevo, Amazon SES or ZeptoMail, sending from your own domain with SPF and DKIM set up. Then raise **Authentication → Rate limits → emails per hour**.

- Keep **Authentication → Sign In / Providers → Email → Confirm email** turned **on**. Client portal access is linked by email address, and only confirmed emails can claim it.
- Set **Authentication → URL Configuration → Site URL** to the Vercel address and add it (plus `https://*-<team>.vercel.app/**` for previews) under Redirect URLs.

## Local development (Codespaces or your machine)

```bash
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev
npm run build          # type-check + production build
```

Never put the Supabase service-role key in the front end or in Git.

## Not yet built

Payroll, a background scheduler for automation rules, sending email / WhatsApp, and direct filing with GSTN / ITD / MCA providers.
