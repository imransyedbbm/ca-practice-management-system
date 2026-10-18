import type { Client } from './types';
import { iso, pd, addD, MON } from './util';

/*
 * Compliance obligation templates. Due-date logic is ILLUSTRATIVE: it follows the usual
 * pattern for each form but ignores extensions, QRMP, notifications and special cases.
 * Every due date must be checked against the official source before relying on it.
 */
export interface ObTemplate {
  key: string; form: string; cat: string; freq: 'monthly' | 'quarterly' | 'annual' | 'advance';
  lead: number; docs: string[]; cl: string[]; applies: (c: Client) => boolean;
}
export interface Occurrence {
  key: string; form: string; cat: string; title: string; period: string; fy: string;
  due: string; internal: string; docs: string[]; cl: string[];
}

const company = (c: Client) => c.entity_type === 'Private Limited' || c.entity_type === 'Public Limited';
const has = (c: Client, s: string) => (c.services || []).includes(s);
const fyLabel = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;

export const TEMPLATES: ObTemplate[] = [
  { key: 'GSTR1', form: 'GSTR-1', cat: 'GST', freq: 'monthly', lead: 4, docs: ['Sales register', 'E-invoice report'],
    cl: ['Sales register reconciled', 'E-invoice / IRN data matched', 'Credit & debit notes captured', 'HSN summary validated', 'Reviewer sign-off'],
    applies: (c) => !!c.gstin && has(c, 'GST') },
  { key: 'GSTR3B', form: 'GSTR-3B', cat: 'GST', freq: 'monthly', lead: 4, docs: ['Purchase register', 'GSTR-2B statement'],
    cl: ['GSTR-2B downloaded', 'ITC reconciled with purchase register', 'Ineligible ITC reversed', 'Tax liability computed', 'Challan prepared', 'Reviewer sign-off'],
    applies: (c) => !!c.gstin && has(c, 'GST') },
  { key: 'TDS26Q', form: 'TDS 26Q', cat: 'TDS/TCS', freq: 'quarterly', lead: 6, docs: ['TDS challans', 'Vendor payment ledger'],
    cl: ['Deductee master updated', 'Challans matched', 'PAN validity check', 'Lower deduction certificates applied', 'FVU file generated', 'Reviewer sign-off'],
    applies: (c) => has(c, 'TDS/TCS') },
  { key: 'TDS24Q', form: 'TDS 24Q', cat: 'TDS/TCS', freq: 'quarterly', lead: 6, docs: ['Payroll register', 'TDS challans'],
    cl: ['Salary data validated', 'Challans matched', 'PAN validity check', 'FVU file generated', 'Reviewer sign-off'],
    applies: (c) => has(c, 'TDS/TCS') && (company(c) || c.entity_type === 'LLP' || c.entity_type === 'Trust') },
  { key: 'AUDIT', form: 'Form 3CD', cat: 'Tax Audit', freq: 'annual', lead: 10, docs: ['Trial balance', 'Fixed asset register', 'Bank statements'],
    cl: ['Trial balance received', 'Clause-wise 3CD working', 'Depreciation schedule', 'Partner review', 'UDIN generated'],
    applies: (c) => has(c, 'Tax Audit') },
  { key: 'ITR6', form: 'ITR-6', cat: 'Income Tax', freq: 'annual', lead: 7, docs: ['Audited financials', 'Form 26AS / AIS'],
    cl: ['Form 26AS / AIS reviewed', 'Income heads computed', 'Deductions verified', 'Tax computation', 'Draft shared with client', 'Reviewer sign-off'],
    applies: (c) => company(c) && has(c, 'Income Tax') },
  { key: 'ITR5', form: 'ITR-5', cat: 'Income Tax', freq: 'annual', lead: 7, docs: ['Financial statements', 'Form 26AS / AIS', 'Partner capital accounts'],
    cl: ['Form 26AS / AIS reviewed', 'Income heads computed', 'Partner remuneration checked', 'Tax computation', 'Reviewer sign-off'],
    applies: (c) => (c.entity_type === 'LLP' || c.entity_type === 'Partnership') && has(c, 'Income Tax') },
  { key: 'ITR3', form: 'ITR-3', cat: 'Income Tax', freq: 'annual', lead: 7, docs: ['Form 26AS / AIS', 'Bank statements', 'Investment proofs'],
    cl: ['Form 26AS / AIS reviewed', 'Income heads computed', 'Deductions verified', 'Tax computation', 'Draft shared with client', 'Reviewer sign-off'],
    applies: (c) => ['Proprietorship', 'Individual', 'HUF'].includes(c.entity_type) && has(c, 'Income Tax') },
  { key: 'ITR7', form: 'ITR-7', cat: 'Income Tax', freq: 'annual', lead: 7, docs: ['Audited accounts', 'Form 10B report', 'Donation register'],
    cl: ['Application of income verified', 'Form 10B reviewed', 'Tax computation', 'Reviewer sign-off'],
    applies: (c) => c.entity_type === 'Trust' && has(c, 'Income Tax') },
  { key: 'AOC4', form: 'AOC-4', cat: 'MCA/ROC', freq: 'annual', lead: 6, docs: ['Signed financial statements', 'Board report', 'Auditor report'],
    cl: ['Financial statements approved', 'Board report drafted', 'Form data prepared', 'Director DSC available', 'Partner review'],
    applies: (c) => company(c) && has(c, 'MCA/ROC') },
  { key: 'MGT7', form: 'MGT-7', cat: 'MCA/ROC', freq: 'annual', lead: 8, docs: ['Shareholding pattern', 'AGM minutes'],
    cl: ['Shareholding verified', 'AGM details captured', 'Form data prepared', 'Director DSC available', 'Partner review'],
    applies: (c) => company(c) && has(c, 'MCA/ROC') },
  { key: 'LLP8', form: 'LLP Form 8', cat: 'MCA/ROC', freq: 'annual', lead: 6, docs: ['Statement of accounts & solvency', 'Partner DSC'],
    cl: ['Statement of solvency prepared', 'Accounts signed', 'Form data prepared', 'Partner review'],
    applies: (c) => c.entity_type === 'LLP' && has(c, 'MCA/ROC') },
  { key: 'ADV', form: 'Advance Tax', cat: 'Income Tax', freq: 'advance', lead: 7, docs: ['Estimated income working'],
    cl: ['Income estimate updated', 'Tax computed', 'Challan prepared', 'Reviewer sign-off'],
    applies: (c) => ['Individual', 'HUF', 'Proprietorship'].includes(c.entity_type) && has(c, 'Income Tax') },
];
export const templateByKey = (k: string) => TEMPLATES.find((t) => t.key === k);

const ymd = (y: number, m0: number, d: number) => iso(new Date(y, m0, d));
const lastDay = (y: number, m0: number) => iso(new Date(y, m0 + 1, 0));

/** All occurrences of a template for a client whose statutory due date falls between from and to (inclusive). */
export function occurrences(t: ObTemplate, c: Client, from: string, to: string): Occurrence[] {
  const out: Occurrence[] = [];
  const add = (period: string, fy: string, due: string) => {
    if (due < from || due > to) return;
    out.push({ key: t.key, form: t.form, cat: t.cat, title: `${t.form} — ${period}`, period, fy, due,
      internal: addD(due, -t.lead), docs: t.docs.map((d) => `${d} (${period})`), cl: [...t.cl] });
  };
  const start = pd(from); const end = pd(to);
  const y0 = start.getFullYear() - 1; const y1 = end.getFullYear() + 1;
  if (t.freq === 'monthly') {
    for (let y = y0; y <= y1; y++) for (let m = 0; m < 12; m++) {
      const due = ymd(y, m + 1, t.key === 'GSTR1' ? 11 : 20);
      const fyStart = m >= 3 ? y : y - 1;
      add(`${MON[m]} ${y}`, fyLabel(fyStart), due);
    }
  } else if (t.freq === 'quarterly') {
    for (let y = y0; y <= y1; y++) {
      const fy = fyLabel(y);
      add(`Q1 FY ${fy}`, fy, ymd(y, 6, 31));
      add(`Q2 FY ${fy}`, fy, ymd(y, 9, 31));
      add(`Q3 FY ${fy}`, fy, ymd(y + 1, 0, 31));
      add(`Q4 FY ${fy}`, fy, ymd(y + 1, 4, 31));
    }
  } else if (t.freq === 'advance') {
    for (let y = y0; y <= y1; y++) {
      const fy = fyLabel(y);
      add(`Instalment 1 FY ${fy}`, fy, ymd(y, 5, 15));
      add(`Instalment 2 FY ${fy}`, fy, ymd(y, 8, 15));
      add(`Instalment 3 FY ${fy}`, fy, ymd(y, 11, 15));
      add(`Instalment 4 FY ${fy}`, fy, ymd(y + 1, 2, 15));
    }
  } else {
    for (let y = y0; y <= y1; y++) {
      const fy = fyLabel(y); const ay = fyLabel(y + 1);
      const audited = company(c) || has(c, 'Tax Audit') || c.entity_type === 'Trust';
      if (t.key === 'AUDIT') add(`FY ${fy}`, fy, ymd(y + 1, 8, 30));
      else if (t.key.startsWith('ITR')) add(`AY ${ay}`, fy, audited ? ymd(y + 1, 9, 31) : ymd(y + 1, 6, 31));
      else if (t.key === 'AOC4' || t.key === 'LLP8') add(`FY ${fy}`, fy, ymd(y + 1, 9, 30));
      else if (t.key === 'MGT7') add(`FY ${fy}`, fy, ymd(y + 1, 10, 29));
    }
  }
  return out.sort((a, b) => (a.due < b.due ? -1 : 1));
}

/** Upcoming obligations for a client within the next `days` days (from today, or from `from`). */
export function upcomingFor(c: Client, from: string, days: number, keys?: string[]): Occurrence[] {
  const to = addD(from, days);
  return TEMPLATES.filter((t) => t.applies(c) && (!keys || keys.includes(t.key)))
    .flatMap((t) => occurrences(t, c, from, to));
}

/** Next occurrence of a template (any client applicability ignored), for the New task form. */
export function nextOccurrence(t: ObTemplate, c: Client, from: string): Occurrence | null {
  const list = occurrences(t, c, from, addD(from, 400));
  return list[0] || null;
}
export { lastDay };
