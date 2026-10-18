import type { StatusKey, Task, Risk, Priority, Invoice } from './types';

/* ---------- dates (all YYYY-MM-DD strings, local time) ---------- */
const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const pd = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const todayISO = () => iso(new Date());
export const addD = (s: string, n: number) => { const d = pd(s); d.setDate(d.getDate() + n); return iso(d); };
export const dDiff = (s: string) => Math.round((pd(s).getTime() - pd(todayISO()).getTime()) / 864e5);
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtD = (s?: string | null) => { if (!s) return '—'; const d = pd(s); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
export const fmtDs = (s?: string | null) => { if (!s) return '—'; const d = pd(s); return `${d.getDate()} ${MON[d.getMonth()]}`; };
export const fmtDT = (s?: string | null) => {
  if (!s) return '—'; const d = new Date(s);
  return `${d.getDate()} ${MON[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** Indian financial year label for a date, e.g. 2026-10-18 -> "2026-27". */
export const fyOf = (s: string) => { const d = pd(s); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-${String((y + 1) % 100).padStart(2, '0')}`; };

/* ---------- money & identifiers ---------- */
export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const inrK = (n: number) => n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? '₹' + (n / 1e5).toFixed(2) + ' L' : inr(n);
export const maskPan = (p: string) => p ? '•••••' + p.slice(5) : '—';
export const maskGst = (g: string) => g ? g.slice(0, 2) + '•••••' + g.slice(7, 11) + '•' + g.slice(12) : '';
export const initials = (n: string) => n.replace(/^(Dr\.|Mr\.|Mrs\.|Ms\.)\s*/, '').split(/\s+/).filter(Boolean).map((x) => x[0]).slice(0, 2).join('').toUpperCase() || '?';
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const PHONE_RE = /^\+?[0-9 ]{10,15}$/;

/* ---------- workflow ---------- */
export const STATUSES: StatusKey[] = ['scheduled', 'documents_requested', 'in_progress', 'prepared', 'under_review', 'changes_requested', 'approved', 'ready_to_file', 'filed', 'evidence_pending', 'completed'];
export const STATUS_LABEL: Record<StatusKey, string> = {
  scheduled: 'Scheduled', documents_requested: 'Documents Requested', in_progress: 'In Progress', prepared: 'Prepared',
  under_review: 'Under Review', changes_requested: 'Changes Requested', approved: 'Approved', ready_to_file: 'Ready to File',
  filed: 'Filed', evidence_pending: 'Evidence Pending', completed: 'Completed',
};
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
export const si = (s: StatusKey) => STATUSES.indexOf(s);
export const isOpen = (t: Task) => !['filed', 'evidence_pending', 'completed'].includes(t.status);
export const isOverdue = (t: Task) => isOpen(t) && !!t.internal_due_date && dDiff(t.internal_due_date) < 0;
export const isStatOverdue = (t: Task) => isOpen(t) && !!t.due_date && dDiff(t.due_date) < 0;
export function riskOf(t: Task): Risk {
  if (!isOpen(t)) return 'Low';
  const i = si(t.status); const d = t.due_date ? dDiff(t.due_date) : 999;
  if (d < 0 || t.blocked || (d <= 3 && i < 6) || (isOverdue(t) && i < 4)) return 'High';
  if ((d <= 10 && i < 7) || isOverdue(t) || t.status === 'changes_requested') return 'Medium';
  return 'Low';
}
export function riskReason(t: Task) {
  const x = t.due_date ? dDiff(t.due_date) : 999;
  if (x < 0) return `${-x}d past statutory date`;
  if (t.blocked) return 'Blocked on client';
  if (isOverdue(t)) return 'Internal date missed';
  return `Due in ${x}d, ${STATUS_LABEL[t.status].toLowerCase()}`;
}
export function filingStage(t: Task) {
  const s = t.status;
  if (s === 'scheduled' || s === 'documents_requested') return 0;
  if (s === 'in_progress') return 1;
  if (s === 'prepared' || s === 'under_review' || s === 'changes_requested') return 2;
  if (s === 'approved') return 3;
  if (s === 'ready_to_file') return 4;
  if (s === 'filed') return 5;
  if (s === 'evidence_pending') return t.filing.evidence === 'under_verification' ? 6 : 5;
  return 7;
}
export const reviewStatus = (t: Task) => t.status === 'under_review' ? 'In review' : t.status === 'changes_requested' ? 'Changes requested' : si(t.status) >= 6 ? 'Approved' : 'Not submitted';
export const prepStatus = (t: Task) => { const i = si(t.status); return i <= 1 ? 'Not started' : (i === 2 || t.status === 'changes_requested') ? 'In progress' : 'Prepared'; };
export const apprStatus = (t: Task) => si(t.status) >= 6 ? 'Approved' : 'Pending';
export const subStatus = (t: Task) => t.filing.ack ? 'Submitted (recorded)' : t.status === 'ready_to_file' ? 'Ready to submit' : 'Not submitted';
export const EVIDENCE_LABEL: Record<string, string> = { not_due: 'Not yet due', awaiting_upload: 'Awaiting upload', uploaded: 'Uploaded, not submitted', under_verification: 'Under verification', verified: 'Verified' };
export const checklistPct = (t: Task) => t.checklist.length ? Math.round(100 * t.checklist.filter((x) => x.done).length / t.checklist.length) : 0;
export const taskNo = (t: Task) => 'T-' + (1000 + Number(t.task_no || 0));

export const invoiceState = (i: Invoice): string => i.status === 'paid' ? 'Paid' : i.status === 'draft' ? 'Draft' : (i.due_on && dDiff(i.due_on) < 0 ? 'Overdue' : 'Unpaid');

/* ---------- CSV ---------- */
export function downloadCsv(name: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map((v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name.replace(/[^a-z0-9]+/gi, '_').toLowerCase() + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function errMsg(e: unknown): string {
  if (e && typeof e === 'object') {
    const x = e as { message?: string; details?: string; code?: string };
    if (x.code === '23505') return 'This already exists. ' + (x.message || '');
    if (x.code === '42501') return 'You do not have permission to do this. ' + (x.message || '');
    if (x.message) return [x.message, x.details].filter(Boolean).join(' | ');
  }
  return 'Something went wrong. Please try again.';
}
