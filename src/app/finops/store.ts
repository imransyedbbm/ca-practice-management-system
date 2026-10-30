/* Financial Operations add-on: types, labels and data access. */
// Imports the client directly (not ../store) so the two modules do not import each other.
import { supabase } from '../../lib';
import type { RuleParams, Scheme, CalcLine, CalcException } from './engine';
import { readParams } from './engine';
import { dDiff, todayISO } from '../util';

export type Applicability = 'unknown' | 'applicable' | 'not_applicable';
export type PeriodStatus = 'awaiting_data' | 'data_received' | 'calculated' | 'in_review' | 'changes_requested' | 'reviewed'
  | 'payment_pending' | 'paid' | 'evidence_pending' | 'closed' | 'not_applicable';

export interface FoProfile {
  id: string; firm_id: string; client_id: string; pf_status: Applicability; esi_status: Applicability; pf_code: string; esi_code: string;
  verified_by: string; verified_at: string | null; payroll_contact: string; payroll_email: string;
  preparer_id: string | null; reviewer_id: string | null; pf_due_day: number | null; esi_due_day: number | null; notes: string;
}
export interface FoRule {
  id: string; firm_id: string; scheme: Scheme; version: number; label: string; effective_from: string; params: RuleParams;
  source_ref: string; status: 'draft' | 'approved' | 'retired'; created_by: string; approved_by: string; approved_at: string | null; created_at: string;
}
export interface FoPeriod {
  id: string; firm_id: string; client_id: string; scheme: Scheme; period: string; due_date: string | null; status: PeriodStatus;
  preparer_id: string | null; reviewer_id: string | null; employee_count: number; total_wages: number; total_employee: number;
  total_employer: number; total_payable: number; exceptions_count: number; current_calc_id: string | null; prepared_by_member: string | null;
  review_note: string; updated_at: string;
}
export interface FoBatch { id: string; period_id: string; file_name: string; file_path: string; file_hash: string; row_count: number; uploaded_by: string; created_at: string }
export interface FoCalc {
  id: string; period_id: string; version: number; method: 'calculated' | 'imported'; rule_version_id: string | null; batch_id: string | null;
  employee_count: number; total_wages: number; total_employee: number; total_employer: number; total_payable: number;
  components: { code: string; label: string; payer: string; rate: number; amount: number }[]; lines: CalcLine[]; exceptions: CalcException[];
  created_by: string; created_at: string;
}
export interface FoEvent { id: string; client_id: string | null; entity: string; entity_id: string | null; action: string; detail: string; actor_name: string; created_at: string }
export interface FoData { enabled: boolean; installed: boolean; profiles: FoProfile[]; rules: FoRule[]; periods: FoPeriod[]; events: FoEvent[] }
const sb = () => { if (!supabase) throw new Error('Supabase is not configured.'); return supabase; };
export const FO_EMPTY: FoData = { enabled: false, installed: false, profiles: [], rules: [], periods: [], events: [] };

export const PERIOD_LABEL: Record<PeriodStatus, string> = {
  awaiting_data: 'Awaiting data', data_received: 'Data received', calculated: 'Calculated', in_review: 'In review',
  changes_requested: 'Changes requested', reviewed: 'Reviewed', payment_pending: 'Payment pending', paid: 'Paid',
  evidence_pending: 'Evidence pending', closed: 'Closed', not_applicable: 'Not applicable',
};
export const PERIOD_CLS: Record<PeriodStatus, string> = {
  awaiting_data: '', data_received: 'vio', calculated: 'info', in_review: 'warn', changes_requested: 'bad', reviewed: 'ok',
  payment_pending: 'warn', paid: 'ok', evidence_pending: 'warn', closed: 'ok', not_applicable: '',
};
export const PERIOD_FLOW: PeriodStatus[] = ['awaiting_data', 'data_received', 'calculated', 'in_review', 'reviewed'];
export const APPL_LABEL: Record<Applicability, string> = { unknown: 'Not confirmed', applicable: 'Applicable', not_applicable: 'Not applicable' };
export const isDone = (p: FoPeriod) => ['reviewed', 'payment_pending', 'paid', 'evidence_pending', 'closed', 'not_applicable'].includes(p.status);

/** Overdue, close to the due date while early in the workflow, or blocked by exceptions. */
export function foRisk(p: FoPeriod): 'High' | 'Medium' | 'Low' {
  if (isDone(p)) return 'Low';
  const d = p.due_date ? dDiff(p.due_date) : 999;
  const stage = PERIOD_FLOW.indexOf(p.status);
  if (d < 0 || (d <= 3 && stage < 3)) return 'High';
  if (d <= 7 || p.status === 'changes_requested' || p.exceptions_count > 0) return 'Medium';
  return 'Low';
}
export function foRiskReason(p: FoPeriod) {
  const d = p.due_date ? dDiff(p.due_date) : null;
  if (d !== null && d < 0) return `${-d}d past the due date`;
  if (p.status === 'changes_requested') return 'Reviewer asked for changes';
  if (p.exceptions_count) return `${p.exceptions_count} exception(s) in the calculation`;
  if (d === null) return 'No due date set';
  return `Due in ${d}d, ${PERIOD_LABEL[p.status].toLowerCase()}`;
}
export const monthLabel = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00').toLocaleString('en-IN', { month: 'short', year: 'numeric' });
export const thisMonth = () => todayISO().slice(0, 8) + '01';
export const prevMonth = () => { const d = new Date(thisMonth() + 'T00:00:00'); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; };

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? '' : String(v));
const sn = (v: unknown) => (v == null || v === '' ? null : String(v));
const n = (v: unknown) => Number(v || 0);
const nn = (v: unknown) => (v == null ? null : Number(v));

const normProfile = (r: Row): FoProfile => ({
  id: s(r.id), firm_id: s(r.firm_id), client_id: s(r.client_id), pf_status: (s(r.pf_status) || 'unknown') as Applicability,
  esi_status: (s(r.esi_status) || 'unknown') as Applicability, pf_code: s(r.pf_code), esi_code: s(r.esi_code), verified_by: s(r.verified_by),
  verified_at: sn(r.verified_at), payroll_contact: s(r.payroll_contact), payroll_email: s(r.payroll_email), preparer_id: sn(r.preparer_id),
  reviewer_id: sn(r.reviewer_id), pf_due_day: nn(r.pf_due_day), esi_due_day: nn(r.esi_due_day), notes: s(r.notes),
});
const normRule = (r: Row): FoRule => ({
  id: s(r.id), firm_id: s(r.firm_id), scheme: s(r.scheme) as Scheme, version: n(r.version), label: s(r.label), effective_from: s(r.effective_from),
  params: readParams(r.params, s(r.scheme) as Scheme), source_ref: s(r.source_ref), status: (s(r.status) || 'draft') as FoRule['status'],
  created_by: s(r.created_by), approved_by: s(r.approved_by), approved_at: sn(r.approved_at), created_at: s(r.created_at),
});
const normPeriod = (r: Row): FoPeriod => ({
  id: s(r.id), firm_id: s(r.firm_id), client_id: s(r.client_id), scheme: s(r.scheme) as Scheme, period: s(r.period), due_date: sn(r.due_date),
  status: s(r.status) as PeriodStatus, preparer_id: sn(r.preparer_id), reviewer_id: sn(r.reviewer_id), employee_count: n(r.employee_count),
  total_wages: n(r.total_wages), total_employee: n(r.total_employee), total_employer: n(r.total_employer), total_payable: n(r.total_payable),
  exceptions_count: n(r.exceptions_count), current_calc_id: sn(r.current_calc_id), prepared_by_member: sn(r.prepared_by_member),
  review_note: s(r.review_note), updated_at: s(r.updated_at),
});
const normEvent = (r: Row): FoEvent => ({ id: s(r.id), client_id: sn(r.client_id), entity: s(r.entity), entity_id: sn(r.entity_id), action: s(r.action), detail: s(r.detail), actor_name: s(r.actor_name), created_at: s(r.created_at) });
export const normBatch = (r: Row): FoBatch => ({ id: s(r.id), period_id: s(r.period_id), file_name: s(r.file_name), file_path: s(r.file_path), file_hash: s(r.file_hash), row_count: n(r.row_count), uploaded_by: s(r.uploaded_by), created_at: s(r.created_at) });
export const normCalc = (r: Row): FoCalc => ({
  id: s(r.id), period_id: s(r.period_id), version: n(r.version), method: s(r.method) as FoCalc['method'], rule_version_id: sn(r.rule_version_id),
  batch_id: sn(r.batch_id), employee_count: n(r.employee_count), total_wages: n(r.total_wages), total_employee: n(r.total_employee),
  total_employer: n(r.total_employer), total_payable: n(r.total_payable), components: Array.isArray(r.components) ? r.components as FoCalc['components'] : [],
  lines: Array.isArray(r.lines) ? r.lines as CalcLine[] : [], exceptions: Array.isArray(r.exceptions) ? r.exceptions as CalcException[] : [],
  created_by: s(r.created_by), created_at: s(r.created_at),
});

const missingTable = (e: unknown) => { const m = String((e as { message?: string; code?: string })?.message || ''); const c = (e as { code?: string })?.code; return c === '42P01' || c === 'PGRST205' || /does not exist|schema cache/i.test(m); };

/** Loads the add-on's data. If migration 0008 has not been run, reports it as not installed. */
export async function loadFo(firmId: string): Promise<FoData> {
  const c = sb();
  const ad = await c.from('firm_addons').select('addon, enabled').eq('firm_id', firmId);
  if (ad.error) { if (missingTable(ad.error)) return FO_EMPTY; throw ad.error; }
  const enabled = ((ad.data as Row[] | null) || []).some((r) => r.addon === 'finops' && r.enabled);
  if (!enabled) return { ...FO_EMPTY, installed: true };
  const get = async <T,>(p: PromiseLike<{ data: unknown; error: unknown }>, f: (r: Row) => T) => { const { data, error } = await p; if (error) throw error; return ((data as Row[] | null) || []).map(f); };
  const [profiles, rules, periods, events] = await Promise.all([
    get(c.from('fo_profiles').select('*').eq('firm_id', firmId), normProfile),
    get(c.from('fo_rule_versions').select('*').eq('firm_id', firmId).order('scheme').order('version', { ascending: false }), normRule),
    get(c.from('fo_periods').select('*').eq('firm_id', firmId).order('period', { ascending: false }).limit(2000), normPeriod),
    get(c.from('fo_events').select('*').eq('firm_id', firmId).order('created_at', { ascending: false }).limit(300), normEvent),
  ]);
  return { enabled: true, installed: true, profiles, rules, periods, events };
}

export async function loadPeriodDetail(periodId: string) {
  const c = sb();
  const [b, k, e] = await Promise.all([
    c.from('fo_payroll_batches').select('*').eq('period_id', periodId).order('created_at', { ascending: false }),
    c.from('fo_calculations').select('*').eq('period_id', periodId).order('version', { ascending: false }),
    c.from('fo_events').select('*').eq('entity_id', periodId).order('created_at', { ascending: false }),
  ]);
  if (b.error) throw b.error; if (k.error) throw k.error; if (e.error) throw e.error;
  return { batches: ((b.data as Row[]) || []).map(normBatch), calcs: ((k.data as Row[]) || []).map(normCalc), events: ((e.data as Row[]) || []).map(normEvent) };
}

export async function loadBatchRows(batchId: string) {
  const { data, error } = await sb().from('fo_payroll_records').select('*').eq('batch_id', batchId).order('row_no');
  if (error) throw error;
  return ((data as Row[]) || []).map((r) => ({
    row_no: n(r.row_no), emp_ref: s(r.emp_ref), emp_name: s(r.emp_name), days: nn(r.days), gross_wages: nn(r.gross_wages), pf_wages: nn(r.pf_wages),
    esi_wages: nn(r.esi_wages), imp_employee: nn(r.imp_employee), imp_employer: nn(r.imp_employer), flags: (Array.isArray(r.flags) ? r.flags : []) as never[],
  }));
}

export const rpc = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw error;
  return data;
};
