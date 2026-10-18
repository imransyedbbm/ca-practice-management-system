import { createContext, useContext } from 'react';
import { supabase } from '../lib';
import type {
  FirmData, Firm, Membership, Role, TeamMember, Client, Task, Doc, Message, Notice, Invoice, AutoRule, CRule,
  Settings, Activity, Comment, ClientUser, StatusKey, Filing, Channel, MsgStatus,
} from './types';
import { si, todayISO, dDiff, fmtD, STATUS_LABEL } from './util';
import type { Occurrence } from './obligations';

export const sb = () => {
  if (!supabase) throw new Error('Supabase is not configured.');
  return supabase;
};

export const EMPTY: FirmData = {
  team: [], clients: [], tasks: [], docs: [], msgs: [], notices: [], invoices: [], rules: [], crules: [],
  settings: null, activity: [], comments: [], clientUsers: [],
};

const DEFAULT_FILING: Filing = { method: 'Assisted', ack: '', submitted_on: '', evidence: 'not_due', evidence_path: '', evidence_name: '', ev_rejected: '' };

/* ---------- row normalisers (the database may return nulls for older rows) ---------- */
type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? '' : String(v));
const sn = (v: unknown) => (v == null || v === '' ? null : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export const normClient = (r: Row): Client => ({
  id: s(r.id), firm_id: s(r.firm_id), name: s(r.name), entity_type: s(r.entity_type) || 'Individual', email: s(r.email),
  phone: s(r.phone), pan: s(r.pan), gstin: s(r.gstin), tan: s(r.tan), state_code: s(r.state_code), contact_person: s(r.contact_person),
  partner_id: sn(r.partner_id), package: s(r.package) || 'Growth', status: (s(r.status) || 'active') as Client['status'],
  services: arr(r.services), client_since: s(r.client_since), created_at: s(r.created_at),
});
export const normTask = (r: Row): Task => {
  const f = (r.filing && typeof r.filing === 'object' ? r.filing : {}) as Partial<Filing>;
  const cl = Array.isArray(r.checklist) ? (r.checklist as { t?: unknown; done?: unknown }[]).map((x) => ({ t: s(x.t), done: !!x.done })) : [];
  return {
    id: s(r.id), task_no: Number(r.task_no || 0), firm_id: s(r.firm_id), client_id: s(r.client_id), title: s(r.title),
    form: s(r.form) || s(r.title).split(' ')[0], category: s(r.category) || 'Other', period: s(r.period), fy: s(r.fy),
    template_key: sn(r.template_key), due_date: sn(r.due_date), internal_due_date: sn(r.internal_due_date),
    status: (s(r.status) || 'scheduled') as StatusKey, priority: (s(r.priority) || 'medium') as Task['priority'],
    preparer_id: sn(r.preparer_id), reviewer_id: sn(r.reviewer_id), blocked: s(r.blocked), checklist: cl,
    required_docs: arr(r.required_docs), filing: { ...DEFAULT_FILING, ...f }, created_at: s(r.created_at),
  };
};
const normTeam = (r: Row): TeamMember => ({ id: s(r.id), firm_id: s(r.firm_id), user_id: sn(r.user_id), name: s(r.name), role: s(r.role), email: s(r.email), capacity: Number(r.capacity || 16), active: r.active !== false });
const normDoc = (r: Row): Doc => ({ id: s(r.id), firm_id: s(r.firm_id), client_id: s(r.client_id), task_id: sn(r.task_id), name: s(r.name), fy: s(r.fy), status: (s(r.status) || 'requested') as Doc['status'], requested_on: sn(r.requested_on), uploaded_on: sn(r.uploaded_on), comment: s(r.comment), file_path: s(r.file_path), file_name: s(r.file_name), reviewed_by: s(r.reviewed_by), created_at: s(r.created_at) });
const normMsg = (r: Row): Message => ({ id: s(r.id), firm_id: s(r.firm_id), client_id: sn(r.client_id), task_id: sn(r.task_id), channel: s(r.channel) as Channel, recipient: s(r.recipient), to_addr: s(r.to_addr), purpose: s(r.purpose), template: s(r.template), scheduled_at: sn(r.scheduled_at), status: s(r.status) as MsgStatus, read: !!r.read, body: s(r.body), recipient_member_id: sn(r.recipient_member_id), created_at: s(r.created_at) });
const normNotice = (r: Row): Notice => ({ id: s(r.id), firm_id: s(r.firm_id), client_id: s(r.client_id), authority: s(r.authority), ref: s(r.ref), subject: s(r.subject), demand: Number(r.demand || 0), received_on: sn(r.received_on), response_due: sn(r.response_due), status: (s(r.status) || 'new') as Notice['status'], owner_id: sn(r.owner_id), doc_ref: s(r.doc_ref), created_at: s(r.created_at) });
const normInvoice = (r: Row): Invoice => ({ id: s(r.id), firm_id: s(r.firm_id), client_id: s(r.client_id), invoice_no: s(r.invoice_no), period: s(r.period), amount: Number(r.amount || 0), issued_on: sn(r.issued_on), due_on: sn(r.due_on), status: (s(r.status) || 'unpaid') as Invoice['status'], paid_note: s(r.paid_note), created_at: s(r.created_at) });
const normRule = (r: Row): AutoRule => ({ id: s(r.id), firm_id: s(r.firm_id), rule_key: s(r.rule_key), name: s(r.name), trig: s(r.trig), action: s(r.action), scope: s(r.scope), enabled: !!r.enabled, days: Number(r.days || 0), kind: s(r.kind) as AutoRule['kind'], last_run: s(r.last_run) });
const normCRule = (r: Row): CRule => ({ id: s(r.id), firm_id: s(r.firm_id), rule_key: s(r.rule_key), authority: s(r.authority), form: s(r.form), applicability: s(r.applicability), frequency: s(r.frequency), due_rule: s(r.due_rule), effective: sn(r.effective), source: s(r.source), verified_on: sn(r.verified_on), verified_by: s(r.verified_by), version: s(r.version) || 'v1', status: (s(r.status) || 'draft') as CRule['status'], history: Array.isArray(r.history) ? (r.history as CRule['history']) : [], proposal: (r.proposal as CRule['proposal']) || null });
const normSettings = (r: Row): Settings => ({ firm_id: s(r.firm_id), short_code: s(r.short_code), templates: (r.templates as Settings['templates']) || {}, notif: (r.notif as Settings['notif']) || {}, escalation: { remind: 3, escalate: 1, partner: 3, critical: true, ...((r.escalation as object) || {}) } });

async function q<T>(p: PromiseLike<{ data: unknown; error: unknown }>, norm: (r: Row) => T): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw error;
  return ((data as Row[] | null) || []).map(norm);
}

/** Everything a firm member sees for one firm. */
export async function loadFirmData(firmId: string, partner: boolean): Promise<FirmData> {
  const c = sb();
  const [team, clients, tasks, docs, msgs, notices, invoices, rules, crules, settingsRows, activity, comments, clientUsers] = await Promise.all([
    q(c.from('team_members').select('*').eq('firm_id', firmId).order('name'), normTeam),
    q(c.from('clients').select('*').eq('firm_id', firmId).order('name'), normClient),
    q(c.from('compliance_tasks').select('*').eq('firm_id', firmId).order('due_date', { ascending: true }), normTask),
    q(c.from('documents').select('*').eq('firm_id', firmId).order('created_at', { ascending: false }), normDoc),
    q(c.from('messages').select('*').eq('firm_id', firmId).order('created_at', { ascending: false }).limit(500), normMsg),
    q(c.from('notices').select('*').eq('firm_id', firmId).order('response_due', { ascending: true }), normNotice),
    partner ? q(c.from('invoices').select('*').eq('firm_id', firmId).order('created_at', { ascending: false }), normInvoice) : Promise.resolve([] as Invoice[]),
    q(c.from('automation_rules').select('*').eq('firm_id', firmId).order('rule_key'), normRule),
    q(c.from('compliance_rules').select('*').eq('firm_id', firmId).order('rule_key'), normCRule),
    q(c.from('firm_settings').select('*').eq('firm_id', firmId), normSettings),
    q(c.from('task_activity').select('*').eq('firm_id', firmId).order('created_at', { ascending: false }).limit(1500), (r: Row): Activity => ({ id: s(r.id), firm_id: s(r.firm_id), task_id: s(r.task_id), actor_name: s(r.actor_name), text: s(r.text), created_at: s(r.created_at) })),
    q(c.from('task_comments').select('*').eq('firm_id', firmId).order('created_at', { ascending: true }), (r: Row): Comment => ({ id: s(r.id), firm_id: s(r.firm_id), task_id: s(r.task_id), author_name: s(r.author_name), body: s(r.body), created_at: s(r.created_at) })),
    partner ? q(c.from('client_users').select('*').eq('firm_id', firmId).order('created_at'), (r: Row): ClientUser => ({ id: s(r.id), firm_id: s(r.firm_id), client_id: s(r.client_id), email: s(r.email), user_id: sn(r.user_id), invited_by: s(r.invited_by), accepted_at: sn(r.accepted_at), created_at: s(r.created_at) })) : Promise.resolve([] as ClientUser[]),
  ]);
  return { team, clients, tasks, docs, msgs, notices, invoices, rules, crules, settings: settingsRows[0] || null, activity, comments, clientUsers };
}

/** Everything a client portal user may see (row-level security limits it to their own company). */
export async function loadPortalData(): Promise<{ firm: Firm | null; data: FirmData }> {
  const c = sb();
  const [firms, clients, tasks, docs, msgs, invoices] = await Promise.all([
    q(c.from('firms').select('id, name, city'), (r: Row): Firm => ({ id: s(r.id), name: s(r.name), city: s(r.city) })),
    q(c.from('clients').select('*').order('name'), normClient),
    q(c.from('compliance_tasks').select('*').order('due_date', { ascending: true }), normTask),
    q(c.from('documents').select('*').order('created_at', { ascending: false }), normDoc),
    q(c.from('messages').select('*').order('created_at', { ascending: false }).limit(300), normMsg),
    q(c.from('invoices').select('*').order('created_at', { ascending: false }), normInvoice),
  ]);
  return { firm: firms[0] || null, data: { ...EMPTY, clients, tasks, docs, msgs, invoices } };
}

export async function loadMemberships(userId: string): Promise<Membership[]> {
  const c = sb();
  const { data, error } = await c.from('firm_members').select('firm_id, role, active').eq('user_id', userId);
  if (error) throw error;
  const rows = ((data as Row[] | null) || []).filter((r) => r.active !== false);
  if (!rows.length) return [];
  const { data: firms, error: fe } = await c.from('firms').select('id, name, city').in('id', rows.map((r) => s(r.firm_id)));
  if (fe) throw fe;
  const byId = new Map(((firms as Row[] | null) || []).map((f) => [s(f.id), { id: s(f.id), name: s(f.name), city: s(f.city) }]));
  return rows.filter((r) => byId.has(s(r.firm_id))).map((r) => ({ firm_id: s(r.firm_id), role: s(r.role), firm: byId.get(s(r.firm_id)) as Firm }));
}

export const roleOf = (m: Membership | null): Role => (m && (m.role === 'managing_partner' || m.role === 'partner') ? 'partner' : 'accountant');

/* ---------- app context ---------- */
export interface AppCtx {
  uid: string; email: string; role: Role; firm: Firm; memberships: Membership[]; me: TeamMember | null;
  d: FirmData; reload: () => Promise<void>; switchFirm: (id: string) => void; signOut: () => void;
  portalClientId: string; setPortalClientId: (id: string) => void;
}
export const Ctx = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('App context missing');
  return v;
}

/* ---------- lookups ---------- */
export const memberName = (d: FirmData, id: string | null | undefined) => (id ? d.team.find((m) => m.id === id)?.name : '') || '—';
export const clientName = (d: FirmData, id: string | null | undefined) => (id ? d.clients.find((c) => c.id === id)?.name : '') || '—';
export const myName = (a: AppCtx) => a.me?.name || a.email.split('@')[0] || 'You';
export const isPartnerRole = (m: TeamMember) => m.role === 'Managing Partner' || m.role === 'Partner';
export const isReviewerRole = (m: TeamMember) => isPartnerRole(m) || m.role === 'Manager';

/* ---------- shared write operations (callers reload afterwards) ---------- */
export async function addActivity(a: AppCtx, t: Task, text: string, actor?: string) {
  const { error } = await sb().from('task_activity').insert({ firm_id: t.firm_id, task_id: t.id, actor_name: actor ?? myName(a), text });
  if (error) throw error;
}

export async function logMessage(a: AppCtx, m: { channel: Channel; client_id?: string | null; task_id?: string | null; recipient: string; to_addr?: string; purpose: string; template?: string; body: string; status?: MsgStatus; scheduled_at?: string | null; recipient_member_id?: string | null }) {
  const { error } = await sb().from('messages').insert({
    firm_id: a.firm.id, channel: m.channel, client_id: m.client_id ?? null, task_id: m.task_id ?? null, recipient: m.recipient,
    to_addr: m.to_addr ?? '', purpose: m.purpose, template: m.template ?? '', body: m.body, status: m.status ?? 'logged',
    scheduled_at: m.scheduled_at ?? new Date().toISOString(), read: m.channel !== 'in_app', recipient_member_id: m.recipient_member_id ?? null,
  });
  if (error) throw error;
}

export async function pushInApp(a: AppCtx, memberId: string | null, t: Task | null, purpose: string, body: string) {
  if (!memberId) return;
  await logMessage(a, { channel: 'in_app', client_id: t?.client_id ?? null, task_id: t?.id ?? null, recipient: memberName(a.d, memberId), purpose, body, recipient_member_id: memberId });
}

export async function patchTask(t: Task, patch: Record<string, unknown>) {
  const { error } = await sb().from('compliance_tasks').update(patch).eq('id', t.id).eq('firm_id', t.firm_id);
  if (error) throw error;
}

/** Status change with the prototype's guards and the "Reviewer handoff" rule. Returns a message or throws. */
export async function changeStatus(a: AppCtx, t: Task, to: StatusKey, note?: string): Promise<{ ok: boolean; msg: string; openFiling?: boolean }> {
  if (to === t.status) return { ok: false, msg: '' };
  if (si(to) >= 8 && !t.filing.ack) return { ok: false, msg: 'Record the submission and acknowledgement in the filing panel before marking this filed.', openFiling: true };
  if (to === 'completed' && t.filing.evidence !== 'verified') return { ok: false, msg: 'Verify the acknowledgement evidence before completing.', openFiling: true };
  let final: StatusKey = to;
  const handoff = a.d.rules.find((r) => r.kind === 'review' && r.enabled);
  const patch: Record<string, unknown> = { status: to };
  if (si(to) >= 2 && t.blocked) patch.blocked = '';
  await patchTask(t, patch);
  await addActivity(a, t, `Status changed from ${STATUS_LABEL[t.status]} to ${STATUS_LABEL[to]}${note ? ': ' + note : ''}`);
  let msg = `${STATUS_LABEL[to]}.`;
  if (to === 'prepared' && handoff) {
    final = 'under_review';
    await patchTask(t, { status: final });
    await addActivity(a, t, `Moved to Under Review by rule "${handoff.name}"`, 'CAFlow automation');
    await pushInApp(a, t.reviewer_id, t, 'Review request', `${memberName(a.d, t.preparer_id)} submitted ${t.title} (${clientName(a.d, t.client_id)}) for review.`);
    msg = `Rule "${handoff.name}" moved it to Under Review and alerted ${memberName(a.d, t.reviewer_id)}.`;
  }
  if (to === 'changes_requested') await pushInApp(a, t.preparer_id, t, 'Changes requested', `${memberName(a.d, t.reviewer_id)} requested changes on ${t.title}.`);
  if (to === 'approved') await pushInApp(a, t.preparer_id, t, 'Approved', `${t.title} approved for filing.`);
  return { ok: true, msg };
}

/** Insert tasks for obligation occurrences, skipping ones that already exist. Returns the number created. */
export async function createFromOccurrences(a: AppCtx, client: Client, occ: Occurrence[], over: Partial<{ preparer_id: string | null; reviewer_id: string | null; priority: string; due: string; internal: string; docs: string[] }> = {}, manual = false) {
  const exists = new Set(a.d.tasks.filter((t) => t.client_id === client.id).map((t) => `${t.template_key}|${t.period}`));
  const todo = occ.filter((o) => !exists.has(`${o.key}|${o.period}`));
  if (!todo.length) return 0;
  const preps = a.d.team.filter((m) => m.active && /Accountant|Article/.test(m.role));
  const reviewers = a.d.team.filter((m) => m.active && isReviewerRole(m));
  const rows = todo.map((o, i) => {
    const due = over.due || o.due; const internal = over.internal || o.internal;
    const days = dDiff(due);
    return {
      firm_id: client.firm_id, client_id: client.id, created_by: a.uid, title: o.title, form: o.form, category: o.cat,
      period: o.period, fy: o.fy, template_key: o.key, due_date: due, internal_due_date: internal, status: 'scheduled',
      priority: over.priority || (days < 7 ? 'high' : 'medium'),
      preparer_id: over.preparer_id !== undefined ? over.preparer_id : (preps.length ? preps[i % preps.length].id : a.me?.id ?? null),
      reviewer_id: over.reviewer_id !== undefined ? over.reviewer_id : (reviewers.length ? reviewers[0].id : null),
      checklist: o.cl.map((t) => ({ t, done: false })), required_docs: over.docs || o.docs,
    };
  });
  const { data, error } = await sb().from('compliance_tasks').upsert(rows, { onConflict: 'client_id,template_key,period', ignoreDuplicates: true }).select('*');
  if (error) throw error;
  const created = ((data as Row[] | null) || []).map(normTask);
  if (created.length) {
    const { error: ae } = await sb().from('task_activity').insert(created.map((t) => ({
      firm_id: t.firm_id, task_id: t.id, actor_name: manual ? myName(a) : 'CAFlow automation',
      text: manual ? 'Task created manually' : 'Task generated from client services',
    })));
    if (ae) throw ae;
  }
  return created.length;
}

/** Signed link to a private file (valid for 5 minutes). */
export async function fileUrl(path: string): Promise<string | null> {
  const { data, error } = await sb().storage.from('firm-documents').createSignedUrl(path, 300);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function uploadFile(firmId: string, clientId: string, file: File): Promise<string> {
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  const path = `${firmId}/${clientId}/${Date.now()}_${safe}`;
  const { error } = await sb().storage.from('firm-documents').upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  return path;
}

export function mergeTemplate(body: string, a: AppCtx, c: Client | undefined, t: Task | undefined) {
  return body
    .replace(/{{contact}}/g, c ? (c.contact_person || c.name) : '')
    .replace(/{{client}}/g, c ? c.name : '')
    .replace(/{{task}}/g, t ? t.title : 'your filing')
    .replace(/{{due}}/g, t && t.due_date ? fmtD(t.due_date) : '')
    .replace(/{{ack}}/g, t && t.filing.ack ? t.filing.ack : '(pending)')
    .replace(/{{firm}}/g, a.firm.name);
}
