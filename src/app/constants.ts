export const STATE_NAMES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '27': 'Maharashtra', '29': 'Karnataka',
  '30': 'Goa', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '36': 'Telangana', '37': 'Andhra Pradesh',
};
export const ENTITY_TYPES = ['Private Limited', 'Public Limited', 'LLP', 'Partnership', 'Proprietorship', 'Individual', 'HUF', 'Trust'];
export const PACKAGES = ['Essential', 'Growth', 'Enterprise', 'Custom'];
export const SERVICES = ['GST', 'Income Tax', 'TDS/TCS', 'MCA/ROC', 'Tax Audit', 'Bookkeeping'];
export const CATS = ['GST', 'Income Tax', 'TDS/TCS', 'MCA/ROC', 'Tax Audit'];
export const TEAM_ROLES = ['Managing Partner', 'Partner', 'Manager', 'Senior Accountant', 'Accountant', 'Article Assistant'];
export const PORTALS: Record<string, string> = {
  'GST': 'https://www.gst.gov.in', 'Income Tax': 'https://www.incometax.gov.in', 'TDS/TCS': 'https://www.incometax.gov.in',
  'Tax Audit': 'https://www.incometax.gov.in', 'MCA/ROC': 'https://www.mca.gov.in',
};

/** Pill colour by displayed label. */
export const STATUS_CLS: Record<string, string> = {
  'Scheduled': '', 'Documents Requested': 'vio', 'In Progress': 'info', 'Prepared': 'info', 'Under Review': 'warn',
  'Changes Requested': 'bad', 'Approved': 'ok', 'Ready to File': 'ok', 'Filed': 'ok', 'Evidence Pending': 'warn', 'Completed': 'ok',
  'Active': 'ok', 'Onboarding': 'info', 'Inactive': '',
  'Received': 'ok', 'Requested': 'vio', 'Missing': 'bad', 'Rejected': 'bad', 'Awaiting Review': 'warn',
  'Paid': 'ok', 'Unpaid': 'warn', 'Overdue': 'bad', 'Draft': '',
  'Logged, not sent': 'info', 'Queued': 'vio',
  'New': 'bad', 'Drafting response': 'warn', 'Response filed': 'info', 'Closed': 'ok',
  'Proposed change': 'warn', 'Not verified': 'warn',
  'Connected': 'ok', 'Partially Supported': 'warn', 'Unavailable': 'bad', 'Not Configured': '',
  'Verified': 'ok', 'Under verification': 'warn', 'Awaiting upload': 'bad', 'Not yet due': '', 'Uploaded, not submitted': 'vio',
  'Not submitted': '', 'Ready to submit': 'info', 'Submitted (recorded)': 'ok', 'Pending': '', 'Not started': '',
  'In review': 'warn', 'Accepted': 'ok', 'Invited': 'vio',
};

export const DOC_LABEL: Record<string, string> = { requested: 'Requested', missing: 'Missing', awaiting_review: 'Awaiting Review', rejected: 'Rejected', received: 'Received' };
export const CLIENT_STATUS_LABEL: Record<string, string> = { active: 'Active', onboarding: 'Onboarding', inactive: 'Inactive' };
export const NOTICE_LABEL: Record<string, string> = { new: 'New', drafting: 'Drafting response', response_filed: 'Response filed', closed: 'Closed' };
export const MSG_STATUS_LABEL: Record<string, string> = { logged: 'Logged, not sent', scheduled: 'Scheduled', queued: 'Queued', draft: 'Draft' };
export const CHANNEL_LABEL: Record<string, string> = { email: 'Email', whatsapp: 'WhatsApp', in_app: 'In-app' };
export const RULE_STATUS_LABEL: Record<string, string> = { approved: 'Approved', proposed: 'Proposed change', draft: 'Draft' };

export interface IntegrationInfo { id: string; name: string; vendor: string; state: string; caps: string[]; note: string; reqs: string[] }
/** Nothing is connected yet; this page explains what a real connection needs. */
export const INTEGRATIONS: IntegrationInfo[] = [
  { id: 'email', name: 'Email provider', vendor: 'Transactional email (SMTP / API)', state: 'Not Configured', caps: ['Document requests', 'Reminders', 'Filing confirmations'],
    note: 'Until connected, messages are logged in the Notifications centre but not sent.', reqs: ['Verified sending domain (SPF, DKIM, DMARC)', 'API key stored as a server-side secret', 'Bounce and complaint webhooks'] },
  { id: 'wa', name: 'WhatsApp Business Platform', vendor: 'Meta Cloud API via a BSP', state: 'Not Configured', caps: ['Template messages', 'Document links'],
    note: 'Requires a verified business number and approved message templates.', reqs: ['Meta Business verification', 'Registered WhatsApp number via a BSP', 'Pre-approved message templates', 'Client opt-in records'] },
  { id: 'gsp', name: 'GST provider (GSP)', vendor: 'GST Suvidha Provider', state: 'Not Configured', caps: ['Return data upload', 'Validation', 'GSTR-2B fetch'],
    note: 'Live filing needs a licensed GSP and taxpayer OTP / EVC consent.', reqs: ['Contract with a licensed GSP', 'Taxpayer consent and OTP/EVC flow per filing', 'Sandbox certification before production'] },
  { id: 'itd', name: 'Income-tax filing provider', vendor: 'ERI (e-Return Intermediary)', state: 'Not Configured', caps: ['Prefill fetch', 'JSON validation'],
    note: 'Submission requires taxpayer e-verification.', reqs: ['ERI registration with the Income Tax Department', 'Taxpayer authorisation and e-verification', 'Production API keys'] },
  { id: 'mca', name: 'MCA / ROC provider', vendor: 'MCA V3 filing', state: 'Unavailable', caps: [],
    note: 'No authorised API for form submission. Use assisted filing on the MCA portal.', reqs: ['No public submission API; filings remain assisted on the MCA V3 portal', 'DSC of director or professional'] },
  { id: 'cal', name: 'Calendar integration', vendor: 'Google / Microsoft 365', state: 'Not Configured', caps: ['Deadline sync'],
    note: '', reqs: ['OAuth consent for Google Workspace or Microsoft 365', 'Per-user calendar selection'] },
  { id: 'store', name: 'Document storage', vendor: 'Supabase Storage (private bucket)', state: 'Connected', caps: ['Document storage', 'Evidence archive'],
    note: 'Files are stored privately per firm and client; links expire after a few minutes.', reqs: ['Private bucket "firm-documents" (created by migration 0005)', 'Access rules per firm and client (created by migration 0005)'] },
];

/** What each role can do, as enforced by the database and the app. */
export const PERMISSIONS: [string, string, string, string][] = [
  ['View all clients and tasks', '✓', '✓', 'Own company only'],
  ['Create and edit tasks', '✓', '✓', ''],
  ['Add clients', '✓', '', ''],
  ['Reassign work', '✓', '', ''],
  ['Record filing submissions', '✓', '✓', ''],
  ['Verify filing evidence', '✓', '', ''],
  ['Upload documents', '✓', '✓', 'Requested documents'],
  ['Log client messages', '✓', '✓', ''],
  ['Billing and fees', '✓', '', 'Own invoices'],
  ['Approve compliance rules', '✓', '', ''],
  ['Team, client portal access and settings', '✓', '', ''],
];
