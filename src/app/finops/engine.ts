/* Financial Operations: payroll file parsing and PF / ESI contribution calculation.
   Pure functions, no network. Rates, ceilings and eligibility limits always come from an approved
   rule version that a partner entered from the official notification; nothing is hard-coded here. */

export type Scheme = 'PF' | 'ESI';
export type WageBasis = 'gross_wages' | 'pf_wages' | 'esi_wages';
export type Payer = 'employee' | 'employer';

export interface RuleComponent { code: string; label: string; payer: Payer; rate: number; capped: boolean }
export interface RuleParams {
  wage_basis: WageBasis;
  /** Employees whose wages on `eligibility.basis` exceed max_wage are left out. Null means no limit. */
  eligibility: { basis: WageBasis; max_wage: number | null };
  /** Contributions on `capped` components are worked out on min(wage, wage_ceiling). Null means no ceiling. */
  wage_ceiling: number | null;
  components: RuleComponent[];
  rounding: { mode: 'nearest' | 'up' | 'down'; level: 'line' | 'total' };
}
export const EMPTY_PARAMS = (scheme: Scheme): RuleParams => ({
  wage_basis: scheme === 'PF' ? 'pf_wages' : 'esi_wages',
  eligibility: { basis: scheme === 'PF' ? 'pf_wages' : 'esi_wages', max_wage: null },
  wage_ceiling: null,
  components: [],
  rounding: { mode: 'nearest', level: 'line' },
});

/** Reads params saved in the database, tolerating missing keys. */
export function readParams(raw: unknown, scheme: Scheme): RuleParams {
  const base = EMPTY_PARAMS(scheme);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const basis = (v: unknown, d: WageBasis): WageBasis => (v === 'gross_wages' || v === 'pf_wages' || v === 'esi_wages' ? v : d);
  const el = (r.eligibility && typeof r.eligibility === 'object' ? r.eligibility : {}) as Record<string, unknown>;
  const ro = (r.rounding && typeof r.rounding === 'object' ? r.rounding : {}) as Record<string, unknown>;
  return {
    wage_basis: basis(r.wage_basis, base.wage_basis),
    eligibility: { basis: basis(el.basis, base.eligibility.basis), max_wage: num(el.max_wage) },
    wage_ceiling: num(r.wage_ceiling),
    components: Array.isArray(r.components) ? (r.components as Record<string, unknown>[]).map((c) => ({
      code: String(c.code ?? ''), label: String(c.label ?? ''), payer: c.payer === 'employer' ? 'employer' : 'employee',
      rate: Number(c.rate) || 0, capped: !!c.capped,
    })) : [],
    rounding: { mode: ro.mode === 'up' || ro.mode === 'down' ? ro.mode : 'nearest', level: ro.level === 'total' ? 'total' : 'line' },
  };
}

/** Problems that stop a rule version from being approved or used. */
export function validateParams(p: RuleParams): string[] {
  const e: string[] = [];
  if (!p.components.length) e.push('Add at least one contribution component.');
  const codes = new Set<string>();
  p.components.forEach((c, i) => {
    const n = `Component ${i + 1}`;
    if (!c.code.trim()) e.push(`${n}: enter a short code.`);
    else if (codes.has(c.code.trim().toUpperCase())) e.push(`${n}: code ${c.code} is used twice.`);
    codes.add(c.code.trim().toUpperCase());
    if (!c.label.trim()) e.push(`${n}: enter a description.`);
    if (!(c.rate > 0 && c.rate < 100)) e.push(`${n}: the rate must be a percentage above 0 and below 100.`);
  });
  if (p.components.some((c) => c.capped) && !(p.wage_ceiling && p.wage_ceiling > 0)) e.push('A component is capped, so enter the wage ceiling.');
  if (p.wage_ceiling !== null && !(p.wage_ceiling > 0)) e.push('The wage ceiling must be above zero, or left blank.');
  if (p.eligibility.max_wage !== null && !(p.eligibility.max_wage > 0)) e.push('The eligibility limit must be above zero, or left blank.');
  return e;
}

/* ---------------------------------------------------------------- CSV */
/** RFC 4180-style CSV parser: quoted fields, escaped quotes, CRLF. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let f = ''; let q = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(f); f = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else f += ch;
  }
  row.push(f);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export type FieldKey = 'emp_ref' | 'emp_name' | 'days' | 'gross_wages' | 'pf_wages' | 'esi_wages' | 'imp_employee' | 'imp_employer';
export const FIELDS: { key: FieldKey; label: string; req?: boolean; hint: RegExp }[] = [
  { key: 'emp_ref', label: 'Employee reference (code, UAN or IP number)', req: true, hint: /(emp(loyee)?\s*(id|code|no|ref)|uan|ip\s*(no|number)|staff\s*id|^code$|^id$)/i },
  { key: 'emp_name', label: 'Employee name', hint: /(name)/i },
  { key: 'days', label: 'Days paid', hint: /(days|attendance|paid\s*days)/i },
  { key: 'gross_wages', label: 'Gross wages', req: true, hint: /(gross)/i },
  { key: 'pf_wages', label: 'PF wages', hint: /(pf|epf|basic\s*\+?\s*da)\s*(wage|salary)?/i },
  { key: 'esi_wages', label: 'ESI wages', hint: /(esi|esic)\s*(wage|salary)?/i },
  { key: 'imp_employee', label: 'Employee contribution in file (optional)', hint: /(employee|ee)\s*(share|contrib|deduction)/i },
  { key: 'imp_employer', label: 'Employer contribution in file (optional)', hint: /(employer|er)\s*(share|contrib)/i },
];
export type Mapping = Partial<Record<FieldKey, number>>;

/** Suggests which column holds each field, using header names. Each column is used once. */
export function autoMap(headers: string[]): Mapping {
  const m: Mapping = {}; const used = new Set<number>();
  const order: FieldKey[] = ['imp_employee', 'imp_employer', 'pf_wages', 'esi_wages', 'gross_wages', 'days', 'emp_ref', 'emp_name'];
  for (const k of order) {
    const def = FIELDS.find((x) => x.key === k)!;
    const i = headers.findIndex((h, j) => !used.has(j) && def.hint.test(h.trim()));
    if (i >= 0) { m[k] = i; used.add(i); }
  }
  return m;
}

export type Flag = 'missing_ref' | 'duplicate_ref' | 'invalid_number' | 'negative_value' | 'wage_exceeds_gross' | 'no_wages';
export const FLAG_LABEL: Record<string, string> = {
  missing_ref: 'No employee reference', duplicate_ref: 'Employee appears twice', invalid_number: 'Value is not a number',
  negative_value: 'Negative amount', wage_exceeds_gross: 'Scheme wages above gross', no_wages: 'No wages',
  not_eligible: 'Above eligibility limit (left out)', imported_mismatch: 'Differs from the file\'s own figure',
};
export const BLOCKING: string[] = ['missing_ref', 'invalid_number', 'negative_value'];

export interface PayrollRow {
  row_no: number; emp_ref: string; emp_name: string; days: number | null; gross_wages: number | null;
  pf_wages: number | null; esi_wages: number | null; imp_employee: number | null; imp_employer: number | null; flags: Flag[];
}

/** Keeps only the last four characters of an identifier. */
export const maskRef = (v: string) => { const t = v.trim(); return t.length <= 4 ? t : '••' + t.slice(-4); };

const toNum = (v: string | undefined): number | null | 'bad' => {
  if (v === undefined) return null;
  const t = v.replace(/[₹,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 'bad';
};

/** Turns CSV data rows into payroll rows with validation flags. References are masked after checking duplicates. */
export function toRows(data: string[][], m: Mapping): PayrollRow[] {
  const seen = new Map<string, number>();
  data.forEach((r) => { const ref = m.emp_ref !== undefined ? (r[m.emp_ref] || '').trim().toUpperCase() : ''; if (ref) seen.set(ref, (seen.get(ref) || 0) + 1); });
  return data.map((r, i) => {
    const flags = new Set<Flag>();
    const get = (k: FieldKey) => (m[k] !== undefined ? r[m[k] as number] : undefined);
    const n = (k: FieldKey) => { const v = toNum(get(k)); if (v === 'bad') { flags.add('invalid_number'); return null; } if (v !== null && v < 0) flags.add('negative_value'); return v; };
    const refRaw = (get('emp_ref') || '').trim();
    if (!refRaw) flags.add('missing_ref');
    else if ((seen.get(refRaw.toUpperCase()) || 0) > 1) flags.add('duplicate_ref');
    const row: PayrollRow = {
      row_no: i + 1, emp_ref: refRaw ? maskRef(refRaw) : '', emp_name: (get('emp_name') || '').trim().slice(0, 80),
      days: n('days'), gross_wages: n('gross_wages'), pf_wages: n('pf_wages'), esi_wages: n('esi_wages'),
      imp_employee: n('imp_employee'), imp_employer: n('imp_employer'), flags: [],
    };
    const g = row.gross_wages;
    if (g !== null && ((row.pf_wages !== null && row.pf_wages > g) || (row.esi_wages !== null && row.esi_wages > g))) flags.add('wage_exceeds_gross');
    if (!g && !row.pf_wages && !row.esi_wages) flags.add('no_wages');
    row.flags = [...flags];
    return row;
  });
}

/* ---------------------------------------------------------------- calculation */
const r2 = (n: number) => Math.round(n * 100) / 100;
export function roundAmt(n: number, mode: RuleParams['rounding']['mode']) {
  const x = r2(n);
  // A small tolerance stops 12.000000001 being rounded up to 13.
  return mode === 'up' ? Math.ceil(x - 1e-9) : mode === 'down' ? Math.floor(x + 1e-9) : Math.round(x);
}
const wageOf = (r: PayrollRow, b: WageBasis): number | null => {
  const v = r[b];
  // If the scheme column is missing, fall back to gross wages and say so in the exception list.
  return v === null && b !== 'gross_wages' ? r.gross_wages : v;
};

export interface CalcLine { row_no: number; emp_ref: string; emp_name: string; wage: number; amounts: Record<string, number>; employee: number; employer: number; flags: string[] }
export interface CalcException { row_no: number; emp_ref: string; code: string; message: string; blocking: boolean }
export interface CalcResult {
  lines: CalcLine[]; excluded: CalcLine[]; exceptions: CalcException[];
  components: { code: string; label: string; payer: Payer; rate: number; amount: number }[];
  employee_count: number; total_wages: number; total_employee: number; total_employer: number; total_payable: number;
  blocking: number;
}

/** Works out each employee's contribution under an approved rule version. */
export function calculate(rows: PayrollRow[], p: RuleParams): CalcResult {
  const exceptions: CalcException[] = [];
  const lines: CalcLine[] = []; const excluded: CalcLine[] = [];
  const raw: Record<string, number> = {};
  p.components.forEach((c) => { raw[c.code] = 0; });
  let fellBack = 0;
  for (const r of rows) {
    for (const f of r.flags) exceptions.push({ row_no: r.row_no, emp_ref: r.emp_ref, code: f, message: FLAG_LABEL[f] || f, blocking: BLOCKING.includes(f) });
    if (r.flags.some((f) => BLOCKING.includes(f))) continue;
    if (r[p.wage_basis] === null && p.wage_basis !== 'gross_wages') fellBack++;
    const wage = Math.max(0, wageOf(r, p.wage_basis) ?? 0);
    const eligWage = Math.max(0, wageOf(r, p.eligibility.basis) ?? 0);
    const line: CalcLine = { row_no: r.row_no, emp_ref: r.emp_ref, emp_name: r.emp_name, wage, amounts: {}, employee: 0, employer: 0, flags: [...r.flags] };
    if (p.eligibility.max_wage !== null && eligWage > p.eligibility.max_wage) {
      line.flags.push('not_eligible'); excluded.push(line);
      exceptions.push({ row_no: r.row_no, emp_ref: r.emp_ref, code: 'not_eligible', message: FLAG_LABEL.not_eligible, blocking: false });
      continue;
    }
    for (const c of p.components) {
      const base = c.capped && p.wage_ceiling !== null ? Math.min(wage, p.wage_ceiling) : wage;
      const exact = (base * c.rate) / 100;
      raw[c.code] += exact;
      const amt = p.rounding.level === 'line' ? roundAmt(exact, p.rounding.mode) : r2(exact);
      line.amounts[c.code] = amt;
      if (c.payer === 'employee') line.employee += amt; else line.employer += amt;
    }
    line.employee = r2(line.employee); line.employer = r2(line.employer);
    const tol = 1;
    if ((r.imp_employee !== null && Math.abs(r.imp_employee - line.employee) > tol) || (r.imp_employer !== null && Math.abs(r.imp_employer - line.employer) > tol)) {
      line.flags.push('imported_mismatch');
      exceptions.push({ row_no: r.row_no, emp_ref: r.emp_ref, code: 'imported_mismatch', blocking: false,
        message: `${FLAG_LABEL.imported_mismatch}: file ${r.imp_employee ?? '—'} / ${r.imp_employer ?? '—'}, calculated ${line.employee} / ${line.employer}` });
    }
    lines.push(line);
  }
  if (fellBack) exceptions.unshift({ row_no: 0, emp_ref: '', code: 'basis_fallback', blocking: false, message: `${fellBack} row(s) had no ${p.wage_basis.replace('_', ' ')}; gross wages were used.` });
  const components = p.components.map((c) => {
    const amount = p.rounding.level === 'total' ? roundAmt(raw[c.code], p.rounding.mode) : r2(lines.reduce((a, l) => a + (l.amounts[c.code] || 0), 0));
    return { code: c.code, label: c.label, payer: c.payer, rate: c.rate, amount };
  });
  const total_employee = r2(components.filter((c) => c.payer === 'employee').reduce((a, c) => a + c.amount, 0));
  const total_employer = r2(components.filter((c) => c.payer === 'employer').reduce((a, c) => a + c.amount, 0));
  return {
    lines, excluded, exceptions, components, employee_count: lines.length,
    total_wages: r2(lines.reduce((a, l) => a + l.wage, 0)), total_employee, total_employer,
    total_payable: r2(total_employee + total_employer), blocking: exceptions.filter((e) => e.blocking).length,
  };
}

/** Totals taken from the file's own contribution columns, for firms whose payroll software already calculates them. */
export function importedTotals(rows: PayrollRow[], basis: WageBasis) {
  const ok = rows.filter((r) => !r.flags.some((f) => BLOCKING.includes(f)));
  const exceptions: CalcException[] = rows.flatMap((r) => r.flags.map((f) => ({ row_no: r.row_no, emp_ref: r.emp_ref, code: f, message: FLAG_LABEL[f] || f, blocking: BLOCKING.includes(f) })));
  const missing = ok.filter((r) => r.imp_employee === null && r.imp_employer === null).length;
  if (missing) exceptions.unshift({ row_no: 0, emp_ref: '', code: 'no_imported_figures', blocking: true, message: `${missing} row(s) have no contribution figures in the file.` });
  const te = r2(ok.reduce((a, r) => a + (r.imp_employee || 0), 0)); const tr = r2(ok.reduce((a, r) => a + (r.imp_employer || 0), 0));
  return {
    employee_count: ok.length, total_wages: r2(ok.reduce((a, r) => a + (wageOf(r, basis) || 0), 0)), total_employee: te, total_employer: tr,
    total_payable: r2(te + tr), exceptions, blocking: exceptions.filter((e) => e.blocking).length,
    lines: ok.map((r) => ({ row_no: r.row_no, emp_ref: r.emp_ref, emp_name: r.emp_name, wage: wageOf(r, basis) || 0, amounts: {}, employee: r.imp_employee || 0, employer: r.imp_employer || 0, flags: [...r.flags] })),
  };
}

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
