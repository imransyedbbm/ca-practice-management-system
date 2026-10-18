import { useState } from 'react';
import type { ReactNode } from 'react';
import { useApp, memberName, clientName, fileUrl } from './store';
import type { AppCtx } from './store';
import { useUI, Pill, PrioPill, RiskTag, Who, DueCell, Empty, Bar, Icon } from './ui';
import type { Task, Doc, Message, Invoice } from './types';
import {
  STATUS_LABEL, isOpen, isOverdue, riskOf, checklistPct, taskNo, fmtDs, fmtDT, inr, prepStatus, reviewStatus, apprStatus,
  subStatus, EVIDENCE_LABEL, invoiceState, errMsg,
} from './util';
import { DOC_LABEL, MSG_STATUS_LABEL, CHANNEL_LABEL } from './constants';

/** Wraps a write: shows errors as a toast, reloads data, shows a success message. */
export function useRun() {
  const a = useApp(); const ui = useUI();
  return async (fn: () => Promise<unknown>, ok?: string, kind: 'ok' | 'info' = 'ok'): Promise<boolean> => {
    try {
      await fn();
      await a.reload();
      if (ok) ui.toast(ok, kind);
      return true;
    } catch (e) {
      ui.toast(errMsg(e), 'warn');
      await a.reload().catch(() => undefined);
      return false;
    }
  };
}

/** Records visible in the current role / financial-year scope. */
export function useView() {
  const a = useApp(); const ui = useUI();
  const fy = ui.fy;
  const tasks = a.d.tasks.filter((t) => (fy === 'all' || t.fy === fy) && (a.role !== 'client' || t.client_id === a.portalClientId));
  const docs = a.d.docs.filter((x) => (fy === 'all' || !x.fy || x.fy === fy) && (a.role !== 'client' || x.client_id === a.portalClientId));
  const clients = a.role === 'client' ? a.d.clients.filter((c) => c.id === a.portalClientId) : a.d.clients;
  const invoices = a.role === 'client' ? a.d.invoices.filter((i) => i.client_id === a.portalClientId) : a.d.invoices;
  const mine = (ts: Task[]) => (a.role === 'accountant' && a.me ? ts.filter((t) => t.preparer_id === a.me?.id || t.reviewer_id === a.me?.id) : ts);
  return { tasks, docs, clients, invoices, mine };
}

export const can = (a: AppCtx, p: string) => {
  if (a.role === 'partner') return true;
  if (a.role === 'accountant') return ['task.edit', 'task.create', 'doc.request', 'doc.upload', 'doc.review', 'msg.send', 'filing.edit', 'notice.edit'].includes(p);
  return p === 'doc.upload';
};

export function TaskTable({ tasks, noClient, emptyT, emptyX }: { tasks: Task[]; noClient?: boolean; emptyT?: string; emptyX?: string }) {
  const a = useApp(); const ui = useUI();
  if (!tasks.length) return <Empty title={emptyT || 'No tasks match'} text={emptyX || 'Adjust the filters or create a task.'} />;
  return (
    <div className="tw"><table className="t"><thead><tr>
      <th>Task</th>{!noClient && <th>Client</th>}<th>Category</th><th>Period</th><th>Preparer</th><th className="hide-sm">Reviewer</th>
      <th>Internal due</th><th>Statutory due</th><th>Priority</th><th>Status</th><th>Checklist</th><th>Risk</th>
    </tr></thead><tbody>
      {tasks.map((t) => {
        const pct = checklistPct(t); const closed = !isOpen(t);
        return (
          <tr key={t.id} className="click" onClick={() => ui.openDrawer(a.role === 'client' ? 'filing' : 'task', t.id)}>
            <td><div className="strong">{t.form || t.title}</div><div className="sub"><span className="mono">{taskNo(t)}</span>{t.blocked && <> · <span style={{ color: 'var(--bad)' }}>Blocked</span></>}</div></td>
            {!noClient && <td><div style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clientName(a.d, t.client_id)}</div></td>}
            <td>{t.category}</td><td className="num">{t.period || '—'}</td>
            <td><Who name={memberName(a.d, t.preparer_id)} /></td><td className="hide-sm"><Who name={memberName(a.d, t.reviewer_id)} /></td>
            <td><DueCell date={t.internal_due_date} closed={closed} /></td><td><DueCell date={t.due_date} closed={closed} /></td>
            <td><PrioPill p={t.priority} /></td><td><Pill label={STATUS_LABEL[t.status]} /></td>
            <td><div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}><Bar pct={pct} cls={pct === 100 ? 'ok' : ''} width={56} /><span className="num tiny">{pct}%</span></div></td>
            <td><RiskTag r={riskOf(t)} /></td>
          </tr>
        );
      })}
    </tbody></table></div>
  );
}

export function FilingTable({ tasks, compact }: { tasks: Task[]; compact?: boolean }) {
  const a = useApp(); const ui = useUI();
  if (!tasks.length) return <Empty title="No filings here" text="Filings appear as tasks move through preparation and approval." />;
  return (
    <div className="tw"><table className="t"><thead><tr>
      {!compact && <th>Client</th>}<th>Form / return</th><th>Period</th><th>Preparation</th><th>Review</th><th>Approval</th><th>Method</th><th>Submission</th><th>Acknowledgement</th><th>Evidence</th>
    </tr></thead><tbody>
      {tasks.map((t) => {
        const rs = reviewStatus(t);
        return (
          <tr key={t.id} className="click" onClick={() => ui.openDrawer('filing', t.id)}>
            {!compact && <td><div style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clientName(a.d, t.client_id)}</div></td>}
            <td><span className="tag">{t.form || t.title}</span></td><td className="num">{t.period || '—'}</td>
            <td><Pill label={prepStatus(t)} cls={prepStatus(t) === 'Prepared' ? 'info' : prepStatus(t) === 'In progress' ? 'info' : ''} /></td>
            <td><Pill label={rs} cls={rs === 'Approved' ? 'ok' : rs === 'Changes requested' ? 'bad' : rs === 'In review' ? 'warn' : ''} /></td>
            <td><Pill label={apprStatus(t)} cls={apprStatus(t) === 'Approved' ? 'ok' : ''} /></td>
            <td className="small">{t.filing.method}</td><td><Pill label={subStatus(t)} /></td>
            <td className="mono tiny">{t.filing.ack || '—'}</td><td><Pill label={EVIDENCE_LABEL[t.filing.evidence] || t.filing.evidence} /></td>
          </tr>
        );
      })}
    </tbody></table></div>
  );
}

export function FileLink({ path, name }: { path: string; name: string }) {
  const ui = useUI(); const [busy, setBusy] = useState(false);
  if (!path) return <span className="sub mono">{name}</span>;
  return (
    <button type="button" className="btn sm ghost mono" disabled={busy} onClick={async (e) => {
      e.stopPropagation(); setBusy(true);
      const url = await fileUrl(path); setBusy(false);
      if (url) window.open(url, '_blank', 'noopener,noreferrer'); else ui.toast('Could not open the file. You may not have access to it.', 'warn');
    }}><Icon n="file" />{name || 'Open file'}</button>
  );
}

export function DocTable({ docs, compact, actions }: { docs: Doc[]; compact?: boolean; actions?: (x: Doc) => ReactNode }) {
  const a = useApp(); const ui = useUI();
  if (!docs.length) return <Empty title="No documents here" text="Requests you create appear in this list." />;
  return (
    <div className="tw"><table className="t"><thead><tr>
      <th>Document</th>{!compact && <th>Client</th>}<th>FY</th><th>Related task</th><th>Status</th><th>Requested</th><th>Uploaded</th><th>Reviewer comments</th><th></th>
    </tr></thead><tbody>
      {docs.map((x) => {
        const t = a.d.tasks.find((k) => k.id === x.task_id);
        return (
          <tr key={x.id}>
            <td><div className="strong">{x.name}</div>{x.file_name && <FileLink path={x.file_path} name={x.file_name} />}</td>
            {!compact && <td>{clientName(a.d, x.client_id)}</td>}
            <td className="num">{x.fy || '—'}</td>
            <td>{t ? (a.role === 'client' ? <span className="small">{t.title}</span> : <button type="button" className="btn sm ghost" onClick={() => ui.openDrawer('task', t.id)}><span className="mono">{taskNo(t)}</span> {t.form}</button>) : '—'}</td>
            <td><Pill label={DOC_LABEL[x.status]} /></td><td className="num">{fmtDs(x.requested_on)}</td><td className="num">{x.uploaded_on ? fmtDs(x.uploaded_on) : '—'}</td>
            <td className="small" style={{ maxWidth: 220 }}>{x.comment}</td>
            <td><div className="row" style={{ flexWrap: 'nowrap' }}>{actions && actions(x)}</div></td>
          </tr>
        );
      })}
    </tbody></table></div>
  );
}

export function MsgTable({ msgs, compact, onView, onToggle }: { msgs: Message[]; compact?: boolean; onView: (m: Message) => void; onToggle?: (m: Message) => void }) {
  const a = useApp();
  if (!msgs.length) return <Empty title="No messages" text="Messages you log or schedule appear here." />;
  return (
    <div className="tw"><table className="t"><thead><tr>
      <th></th><th>Channel</th><th>Recipient</th>{!compact && <th>Client</th>}<th>Purpose</th><th>Time</th><th>Delivery status</th><th></th>
    </tr></thead><tbody>
      {msgs.map((m) => (
        <tr key={m.id} className={m.read ? '' : 'strong'}>
          <td>{m.channel === 'in_app' && <span className={`risk ${m.read ? 'Low' : 'High'}`} title={m.read ? 'Read' : 'Unread'}><i /></span>}</td>
          <td><span className="tag">{CHANNEL_LABEL[m.channel]}</span></td>
          <td><div>{m.recipient}</div>{m.to_addr && <div className="sub mono">{m.to_addr}</div>}</td>
          {!compact && <td className="small">{m.client_id ? clientName(a.d, m.client_id) : '—'}</td>}
          <td className="small">{m.purpose}</td><td className="num tiny">{fmtDT(m.scheduled_at || m.created_at)}</td>
          <td><Pill label={MSG_STATUS_LABEL[m.status] || m.status} /></td>
          <td><div className="row" style={{ flexWrap: 'nowrap' }}>
            <button type="button" className="btn sm ghost" onClick={() => onView(m)}>{['draft', 'scheduled', 'queued'].includes(m.status) && can(a, 'msg.send') && m.channel !== 'in_app' ? 'Edit' : 'View'}</button>
            {m.channel === 'in_app' && onToggle && <button type="button" className="btn sm ghost" onClick={() => onToggle(m)}>{m.read ? 'Mark unread' : 'Mark read'}</button>}
          </div></td>
        </tr>
      ))}
    </tbody></table></div>
  );
}

export function InvoiceTable({ invoices, compact, actions }: { invoices: Invoice[]; compact?: boolean; actions?: (i: Invoice) => ReactNode }) {
  const a = useApp();
  if (!invoices.length) return <Empty title="No invoices" text="Invoices for this view appear here." />;
  return (
    <div className="tw"><table className="t"><thead><tr>
      <th>Invoice</th>{!compact && <th>Client</th>}<th>Period</th><th className="r">Amount (incl. GST)</th><th>Issued</th><th>Due</th><th>Status</th>{actions && <th></th>}
    </tr></thead><tbody>
      {invoices.map((i) => {
        const st = invoiceState(i);
        return (
          <tr key={i.id}>
            <td className="mono small">{i.invoice_no}</td>{!compact && <td>{clientName(a.d, i.client_id)}</td>}<td>{i.period}</td>
            <td className="r num">{inr(i.amount)}</td><td className="num">{fmtDs(i.issued_on)}</td>
            <td>{st === 'Paid' ? <span className="num">{fmtDs(i.due_on)}</span> : <DueCell date={i.due_on} />}</td>
            <td><Pill label={st} />{i.paid_note && <div className="tiny muted">{i.paid_note}</div>}</td>
            {actions && <td><div className="row" style={{ flexWrap: 'nowrap' }}>{actions(i)}</div></td>}
          </tr>
        );
      })}
    </tbody></table></div>
  );
}

export { isOverdue };
