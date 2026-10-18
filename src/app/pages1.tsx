import { useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { useApp, sb, memberName, clientName, isPartnerRole, logMessage, addActivity } from './store';
import { useUI, Pill, RiskTag, Who, DueCell, Empty, Note, Icon, Opts, Tabs, BarChart, HBars, Stack, Bar, C, PrioPill } from './ui';
import { useRun, useView, can, TaskTable, FilingTable, DocTable, MsgTable, InvoiceTable } from './parts';
import {
  AddClientModal, NewTaskModal, RequestDocsModal, UploadDocModal, RejectDocModal, ComposeModal, ViewMsgModal, InviteClientUserModal,
  RuleEditModal, RulePreviewModal, CalDayModal, RecordPaymentModal,
} from './modals';
import { useMove } from './drawers';
import { ENTITY_TYPES, PACKAGES, CATS, STATE_NAMES, CLIENT_STATUS_LABEL, DOC_LABEL } from './constants';
import {
  STATUSES, STATUS_LABEL, isOpen, isOverdue, isStatOverdue, riskOf, riskReason, dDiff, pd, iso, MON, fmtD, fmtDs, fmtDT, todayISO,
  inrK, maskPan, maskGst, taskNo, checklistPct, filingStage, reviewStatus, si, downloadCsv, invoiceState, EVIDENCE_LABEL, addD,
} from './util';
import type { Task, Client, Doc, StatusKey, AutoRule } from './types';

/* ---------- helpers ---------- */
export function Kpi({ label, value, sub, cls, onClick }: { label: string; value: string | number; sub: string; cls?: string; onClick?: () => void }) {
  return <button type="button" className={`kpi ${cls || ''}`} onClick={onClick} style={onClick ? undefined : { cursor: 'default' }}><span className="k-l">{label}</span><span className="k-v">{value}</span><span className="k-s">{sub}</span></button>;
}
export function Ph({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return <div className="ph"><div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div>{children && <div className="row">{children}</div>}</div>;
}
export function clientStats(tasks: Task[], c: Client) {
  const ts = tasks.filter((t) => t.client_id === c.id); const open = ts.filter(isOpen);
  const next = open.map((t) => t.due_date).filter(Boolean).sort()[0] || '';
  const rs = open.map(riskOf);
  return { open: open.length, next, risk: rs.includes('High') ? 'High' as const : rs.includes('Medium') ? 'Medium' as const : 'Low' as const, total: ts.length };
}
/** Six past months plus the current one, from real task data. */
export function monthlyCompletion(tasks: Task[]) {
  const now = new Date(); const out: { label: string; key: string; due: number; onTime: number; late: number; open: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1); const key = iso(d).slice(0, 7);
    const ts = tasks.filter((t) => t.due_date && t.due_date.startsWith(key));
    const filed = ts.filter((t) => !isOpen(t));
    const onTime = filed.filter((t) => !t.filing.submitted_on || (t.due_date && t.filing.submitted_on <= t.due_date)).length;
    out.push({ label: MON[d.getMonth()], key, due: ts.length, onTime, late: filed.length - onTime, open: ts.length - filed.length });
  }
  return out;
}

/* ================= Dashboard ================= */
export function Dashboard() {
  const a = useApp(); const ui = useUI(); const v = useView();
  if (a.role === 'client') return <ClientHome />;
  const T = v.mine(v.tasks); const open = T.filter(isOpen);
  const active = v.clients.filter((c) => c.status === 'active').length;
  const due7 = open.filter((t) => t.due_date && dDiff(t.due_date) >= 0 && dDiff(t.due_date) <= 7);
  const od = T.filter(isOverdue); const rev = T.filter((t) => t.status === 'under_review');
  const ev = T.filter((t) => (t.status === 'filed' || t.status === 'evidence_pending') && t.filing.evidence !== 'verified');
  const docsP = v.docs.filter((x) => ['requested', 'missing', 'awaiting_review'].includes(x.status) && (a.role !== 'accountant' || T.some((t) => t.id === x.task_id)));
  const hi = open.filter((t) => riskOf(t) === 'High');
  const outstanding = a.d.invoices.filter((i) => ['Unpaid', 'Overdue'].includes(invoiceState(i)));
  const fees = outstanding.reduce((s, i) => s + i.amount, 0); const feesOd = outstanding.filter((i) => invoiceState(i) === 'Overdue').reduce((s, i) => s + i.amount, 0);
  const gof = (page: string, f: Record<string, string>) => { ui.setFAll(page, f); ui.go(page); };
  const upcoming = open.filter((t) => t.due_date && dDiff(t.due_date) >= -3).sort((x, y) => ((x.due_date || '') < (y.due_date || '') ? -1 : 1)).slice(0, 8);
  const hist = monthlyCompletion(T);
  const groups: [string, StatusKey[], string][] = [['Not started', ['scheduled', 'documents_requested'], C.vio], ['Preparation', ['in_progress', 'prepared', 'changes_requested'], C.a], ['Review & approval', ['under_review', 'approved'], C.warn], ['Filing', ['ready_to_file', 'filed', 'evidence_pending'], C.fg2], ['Completed', ['completed'], C.ok]];
  const tot = T.length || 1;
  const wl = a.d.team.filter((s) => s.active && s.role !== 'Managing Partner').map((s) => {
    const n = a.d.tasks.filter((t) => isOpen(t) && t.preparer_id === s.id).length + a.d.tasks.filter((t) => t.status === 'under_review' && t.reviewer_id === s.id).length;
    const u = n / s.capacity; return { label: s.name, value: n, max: s.capacity, text: `${n}/${s.capacity}`, cls: u > 0.9 ? 'bad' : u > 0.7 ? 'warn' : 'ok' };
  });
  const taskIds = new Set(T.map((t) => t.id));
  const act = a.d.activity.filter((x) => taskIds.has(x.task_id)).slice(0, 8);
  const alerts = [
    ...T.filter(isStatOverdue).slice(0, 3).map((t) => ({ cls: 'bad', text: `${t.form} (${t.period}) for ${clientName(a.d, t.client_id)} is past its statutory due date.`, go: () => ui.openDrawer('task', t.id) })),
    ...T.filter((t) => t.blocked && isOpen(t)).slice(0, 2).map((t) => ({ cls: 'warn', text: `${taskNo(t)} blocked: ${t.blocked}`, go: () => ui.openDrawer('task', t.id) })),
    ...a.d.notices.filter((n) => n.status !== 'closed' && n.status !== 'response_filed' && n.response_due && dDiff(n.response_due) <= 7).map((n) => ({ cls: n.response_due && dDiff(n.response_due) < 0 ? 'bad' : 'warn', text: `${n.authority} ${n.ref} for ${clientName(a.d, n.client_id)}: response due ${fmtDs(n.response_due)}.`, go: () => ui.go('notices') })),
  ];
  return (
    <>
      <Ph title={a.role === 'accountant' ? 'My workspace' : 'Practice overview'} sub={<>{a.firm.name} · {ui.fy === 'all' ? 'All financial years' : 'FY ' + ui.fy} · as of {fmtD(todayISO())}</>}>
        {can(a, 'task.create') && <button type="button" className="btn" onClick={() => ui.openModal(<NewTaskModal />)}><Icon n="plus" />New task</button>}
        {a.role === 'partner' && <button type="button" className="btn pri" onClick={() => ui.openModal(<AddClientModal />)}><Icon n="plus" />Add client</button>}
      </Ph>
      {!a.d.clients.length && <Note>Welcome. Start by adding your team in <b>Team &amp; Workload</b>, then add a client. Compliance tasks are created from the client's services.</Note>}
      <div className="kpis">
        <Kpi label="Active clients" value={active} sub={`${v.clients.length - active} onboarding or inactive`} onClick={() => gof('clients', { status: 'active' })} />
        <Kpi label="Due in next 7 days" value={due7.length} sub="statutory dates, open work" cls={due7.length ? 'warn' : ''} onClick={() => gof('tasks', { deadline: 'week' })} />
        <Kpi label="Overdue assignments" value={od.length} sub="past internal due date" cls={od.length ? 'bad' : ''} onClick={() => gof('tasks', { deadline: 'overdue' })} />
        <Kpi label="Awaiting review" value={rev.length} sub="in reviewer queues" onClick={() => gof('tasks', { status: 'under_review' })} />
        <Kpi label="Filings awaiting evidence" value={ev.length} sub="filed, acknowledgement not verified" cls={ev.length ? 'warn' : ''} onClick={() => gof('filings', { evidence: 'pending' })} />
        <Kpi label="Client documents pending" value={docsP.length} sub="requested, missing or to review" onClick={() => gof('documents', { status: 'pending' })} />
        <Kpi label="High-risk items" value={hi.length} sub="by deadline, status and blockers" cls={hi.length ? 'bad' : ''} onClick={() => gof('tasks', { risk: 'High' })} />
        {a.role === 'partner' ? <Kpi label="Outstanding fees" value={inrK(fees)} sub={`${inrK(feesOd)} overdue`} onClick={() => gof('billing', { status: 'outstanding' })} />
          : <Kpi label="My open tasks" value={open.length} sub="as preparer or reviewer" onClick={() => gof('tasks', { user: a.me?.id || '' })} />}
      </div>
      <div className="grid g-dash" style={{ marginBottom: 14 }}>
        <div className="card"><div className="card-h"><h3>Monthly filing completion</h3><span className="tiny muted">by statutory due month</span></div><div className="card-b">
          <BarChart label="Monthly filing completion" stacked labels={hist.map((x) => x.label)} series={[{ name: 'Filed on time', color: C.ok, values: hist.map((x) => x.onTime) }, { name: 'Filed late', color: C.warn, values: hist.map((x) => x.late) }, { name: 'Open', color: C.mute, values: hist.map((x) => x.open) }]} />
        </div></div>
        <div className="card"><div className="card-h"><h3>Critical alerts</h3><Pill label={String(alerts.length)} cls={alerts.length ? 'bad' : 'ok'} /></div><div className="list">
          {alerts.length ? alerts.slice(0, 7).map((x, i) => <div className="li click" key={i} onClick={x.go}><span className={`risk ${x.cls === 'bad' ? 'High' : 'Medium'}`}><i /></span><div className="main-t small">{x.text}</div></div>) : <Empty title="No critical alerts" text="Deadlines, blockers and notices look under control." />}
        </div></div>
      </div>
      <div className="grid g-dash" style={{ marginBottom: 14 }}>
        <div className="card"><div className="card-h"><h3>Upcoming compliance deadlines</h3><button type="button" className="btn sm" onClick={() => ui.go('calendar')}>Calendar</button></div><div className="list">
          {upcoming.length ? upcoming.map((t) => { const x = dDiff(t.due_date || todayISO()); const dt = pd(t.due_date || todayISO()); return (
            <div className="li click" key={t.id} onClick={() => ui.openDrawer('task', t.id)}>
              <div className={`datebox ${x < 0 ? 'od' : ''}`}><div className="m">{MON[dt.getMonth()]}</div><div className="d">{dt.getDate()}</div></div>
              <div className="main-t"><div className="ttl">{t.form} · {t.period}</div><div className="tiny muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{clientName(a.d, t.client_id)} · {memberName(a.d, t.preparer_id)}</div></div>
              <div style={{ textAlign: 'right' }}><Pill label={STATUS_LABEL[t.status]} /><div style={{ marginTop: 3 }}><RiskTag r={riskOf(t)} /></div></div>
            </div>); }) : <Empty title="Nothing due" text="No open obligations in this view." />}
        </div></div>
        <div className="card"><div className="card-h"><h3>Compliance risk summary</h3><span className="tiny muted">{open.length} open obligations</span></div><div className="card-b">
          <div className="g3 grid" style={{ gap: 8, marginBottom: 10 }}>{(['High', 'Medium', 'Low'] as const).map((r) => <button type="button" key={r} className="kpi" style={{ padding: '8px 10px' }} onClick={() => gof('tasks', { risk: r })}><span className="k-l"><RiskTag r={r} /></span><span className="k-v" style={{ fontSize: 18 }}>{open.filter((t) => riskOf(t) === r).length}</span></button>)}</div>
          <div className="tiny muted" style={{ marginBottom: 4 }}>Top drivers</div>
          {hi.length ? hi.slice(0, 4).map((t) => <div className="row small" key={t.id} style={{ padding: '4px 0', cursor: 'pointer' }} onClick={() => ui.openDrawer('task', t.id)}><span className="tag">{t.form}</span><span className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{clientName(a.d, t.client_id)}</span><span className="tiny" style={{ color: 'var(--bad)' }}>{riskReason(t)}</span></div>) : <div className="small muted">No high-risk items.</div>}
        </div></div>
      </div>
      <div className="grid g3">
        <div className="card"><div className="card-h"><h3>Task status distribution</h3><span className="tiny muted">{T.length} tasks</span></div><div className="card-b">
          <div style={{ margin: '4px 0 10px' }}><Stack height={14} parts={groups.map((g) => ({ n: T.filter((t) => g[1].includes(t.status)).length, color: g[2], title: g[0] }))} /></div>
          <div className="tw"><table className="t"><tbody>{STATUSES.map((s) => { const n = T.filter((t) => t.status === s).length; return <tr key={s} className="click" onClick={() => gof('tasks', { status: s })}><td><Pill label={STATUS_LABEL[s]} /></td><td className="r num">{n}</td><td style={{ width: '45%' }}><Bar pct={(100 * n) / tot} /></td></tr>; })}</tbody></table></div>
        </div></div>
        <div className="card"><div className="card-h"><h3>Team workload</h3><button type="button" className="btn sm" onClick={() => ui.go('team')}>Team</button></div><div className="card-b"><HBars items={wl} /><div className="tiny muted" style={{ marginTop: 6 }}>Open tasks as preparer plus review queue, against weekly capacity.</div></div></div>
        <div className="card"><div className="card-h"><h3>Recent activity</h3></div><div className="card-b">
          {act.length ? <div className="tl">{act.map((x) => { const t = a.d.tasks.find((k) => k.id === x.task_id); return <div className="te" key={x.id}><div><b>{x.actor_name}</b> · {x.text}</div><div className="w">{t ? `${taskNo(t)} ${clientName(a.d, t.client_id)}` : ''} · {fmtDT(x.created_at)}</div></div>; })}</div> : <div className="small muted">No activity yet.</div>}
        </div></div>
      </div>
    </>
  );
}

/* ================= Client portal home ================= */
export function ClientHome() {
  const a = useApp(); const ui = useUI(); const v = useView();
  const c = a.d.clients.find((x) => x.id === a.portalClientId);
  if (!c) return <Empty title="No company linked" text="Ask your CA firm to give your email portal access." />;
  const req = v.docs.filter((x) => ['requested', 'missing', 'rejected'].includes(x.status));
  const inv = v.invoices.filter((i) => i.status !== 'paid');
  const T = [...v.tasks].sort((x, y) => ((x.due_date || '') < (y.due_date || '') ? -1 : 1));
  return (
    <>
      <Ph title={c.name} sub={<>Client portal · managed by {a.firm.name}</>}>
        {a.d.clients.length > 1 && <select className="inp" value={a.portalClientId} onChange={(e) => a.setPortalClientId(e.target.value)} aria-label="Company"><Opts list={a.d.clients.map((x) => [x.id, x.name] as [string, string])} /></select>}
      </Ph>
      <Note>Upload the documents your CA has requested and follow your filing status here. You only see your own company's information.</Note>
      <div className="kpis">
        <Kpi label="Documents we need from you" value={req.length} sub="upload in Documents" cls={req.length ? 'warn' : ''} onClick={() => ui.go('documents')} />
        <Kpi label="Open compliance items" value={T.filter(isOpen).length} sub="being prepared by your CA" onClick={() => ui.go('calendar')} />
        <Kpi label="Filed" value={T.filter((t) => !isOpen(t)).length} sub="with acknowledgement" onClick={() => ui.go('filings')} />
        <Kpi label="Fees due" value={inrK(inv.reduce((s, i) => s + i.amount, 0))} sub={`${inv.length} invoice(s)`} cls={inv.length ? 'warn' : ''} onClick={() => ui.go('billing')} />
      </div>
      <div className="grid g2">
        <div className="card"><div className="card-h"><h3>Requested documents</h3></div><div className="list">
          {req.length ? req.map((x) => { const t = a.d.tasks.find((k) => k.id === x.task_id); return <div className="li" key={x.id}><div className="main-t"><div className="ttl">{x.name}</div><div className="tiny muted">{t ? `For ${t.title}` : ''}{x.comment ? ' · ' + x.comment : ''}</div></div><Pill label={DOC_LABEL[x.status]} /><button type="button" className="btn sm pri" onClick={() => ui.openModal(<UploadDocModal doc={x} />)}><Icon n="upload" />Upload</button></div>; })
            : <Empty title="Nothing requested" text="Your CA has everything needed right now." />}
        </div></div>
        <div className="card"><div className="card-h"><h3>Your compliance timeline</h3></div><div className="list">
          {T.length ? T.map((t) => <div className="li click" key={t.id} onClick={() => ui.openDrawer('filing', t.id)}><div className="main-t"><div className="ttl">{t.title}</div><div className="tiny muted">Due {fmtD(t.due_date)}</div></div><Pill label={isOpen(t) ? 'In Progress' : STATUS_LABEL[t.status]} /></div>) : <Empty title="No items yet" text="Your CA has not scheduled any filings yet." />}
        </div></div>
      </div>
    </>
  );
}

/* ================= Clients ================= */
export function Clients() {
  const a = useApp(); const ui = useUI(); const v = useView();
  const f = ui.f('clients', { q: '', type: '', partner: '', reg: '', pkg: '', status: '' });
  const set = (k: string) => (e: { target: { value: string } }) => ui.setF('clients', k, e.target.value);
  const cs = v.clients.filter((c) => (!f.q || `${c.name} ${c.contact_person} ${c.pan} ${c.gstin}`.toLowerCase().includes(f.q.toLowerCase())) && (!f.type || c.entity_type === f.type) && (!f.partner || c.partner_id === f.partner) && (!f.pkg || c.package === f.pkg) && (!f.status || c.status === f.status) && (!f.reg || (f.reg === 'gst' ? !!c.gstin : f.reg === 'nogst' ? !c.gstin : !!c.tan)));
  const partners = a.d.team.filter(isPartnerRole);
  const anyF = Object.values(f).some(Boolean);
  const csv = () => downloadCsv('clients', [['Client', 'Entity type', 'PAN (masked)', 'GSTIN (masked)', 'Partner', 'Package', 'Open tasks', 'Next deadline', 'Risk', 'Status'], ...cs.map((c) => { const s = clientStats(a.d.tasks, c); return [c.name, c.entity_type, maskPan(c.pan), maskGst(c.gstin), memberName(a.d, c.partner_id), c.package, s.open, s.next, s.open ? s.risk : '', CLIENT_STATUS_LABEL[c.status]]; })]);
  return (
    <>
      <Ph title="Clients" sub={`${v.clients.length} clients · ${v.clients.filter((c) => c.gstin).length} GST-registered · identifiers are masked`}>
        <button type="button" className="btn" onClick={csv}><Icon n="down" />Export CSV</button>
        {a.role === 'partner' ? <button type="button" className="btn pri" onClick={() => ui.openModal(<AddClientModal />)}><Icon n="plus" />Add client</button> : <button type="button" className="btn" disabled title="Only partners can add clients"><Icon n="plus" />Add client</button>}
      </Ph>
      <div className="filters">
        <input className="inp q" placeholder="Search name, contact, PAN or GSTIN" value={f.q} onChange={set('q')} aria-label="Search clients" />
        <select className="inp" value={f.type} onChange={set('type')} aria-label="Entity type"><Opts list={ENTITY_TYPES} all="All entity types" /></select>
        <select className="inp" value={f.partner} onChange={set('partner')} aria-label="Partner"><Opts list={partners.map((p) => [p.id, p.name] as [string, string])} all="All partners" /></select>
        <select className="inp" value={f.reg} onChange={set('reg')} aria-label="Registration"><Opts list={[['gst', 'GST registered'], ['nogst', 'Not GST registered'], ['tan', 'Has TAN']]} all="Any registration" /></select>
        <select className="inp" value={f.pkg} onChange={set('pkg')} aria-label="Package"><Opts list={PACKAGES} all="All packages" /></select>
        <select className="inp" value={f.status} onChange={set('status')} aria-label="Status"><Opts list={[['active', 'Active'], ['onboarding', 'Onboarding'], ['inactive', 'Inactive']]} all="All statuses" /></select>
        {anyF && <button type="button" className="btn sm ghost" onClick={() => ui.setFAll('clients', {})}>Clear filters</button>}<span className="tiny muted">{cs.length} shown</span>
      </div>
      <div className="card">{cs.length ? <div className="tw"><table className="t"><thead><tr><th>Client</th><th>Entity type</th><th>PAN / GSTIN</th><th>Partner</th><th>Package</th><th className="r">Open tasks</th><th>Next statutory deadline</th><th>Risk</th><th>Status</th></tr></thead><tbody>
        {cs.map((c) => { const s = clientStats(a.d.tasks, c); return (
          <tr key={c.id} className="click" onClick={() => ui.go('client', { id: c.id })}>
            <td><div className="strong">{c.name}</div><div className="sub">{c.contact_person || '—'} · {STATE_NAMES[c.state_code] || c.state_code || '—'}</div></td><td>{c.entity_type}</td>
            <td><div className="mono tiny">{maskPan(c.pan)}</div>{c.gstin ? <div className="mono tiny muted">{maskGst(c.gstin)}</div> : <div className="tiny faint">No GSTIN</div>}</td>
            <td>{c.partner_id ? <Who name={memberName(a.d, c.partner_id)} /> : <span className="faint">—</span>}</td><td><span className="tag">{c.package}</span></td><td className="r num">{s.open}</td>
            <td>{s.next ? <DueCell date={s.next} /> : <span className="faint">—</span>}</td><td>{s.open ? <RiskTag r={s.risk} /> : <span className="faint">—</span>}</td><td><Pill label={CLIENT_STATUS_LABEL[c.status]} /></td>
          </tr>); })}
      </tbody></table></div> : <Empty title={v.clients.length ? 'No clients match these filters' : 'No clients yet'} text={v.clients.length ? 'Clear a filter or search for another name.' : 'Add your first client to start tracking compliance.'} action={v.clients.length ? <button type="button" className="btn sm" onClick={() => ui.setFAll('clients', {})}>Clear filters</button> : a.role === 'partner' ? <button type="button" className="btn sm pri" onClick={() => ui.openModal(<AddClientModal />)}>Add client</button> : undefined} />}</div>
    </>
  );
}

/* ================= Client detail ================= */
export function ClientDetail() {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const c = a.d.clients.find((x) => x.id === ui.params.id);
  const tab = ui.params.tab || 'overview';
  if (!c) return <Empty title="Client not found" text="It may belong to another firm." action={<button type="button" className="btn" onClick={() => ui.go('clients')}>Back to clients</button>} />;
  const ts = a.d.tasks.filter((t) => t.client_id === c.id); const docs = a.d.docs.filter((x) => x.client_id === c.id);
  const msgs = a.d.msgs.filter((m) => m.client_id === c.id); const inv = a.d.invoices.filter((i) => i.client_id === c.id);
  const access = a.d.clientUsers.filter((u) => u.client_id === c.id); const st = clientStats(a.d.tasks, c);
  const filings = ts.filter((t) => si(t.status) >= 7);
  const tabs: [string, string, number?][] = [['overview', 'Overview'], ['compliance', 'Compliance'], ['tasks', 'Tasks', ts.length], ['documents', 'Documents', docs.length], ['filings', 'Filings', filings.length], ['communication', 'Communication', msgs.length]];
  if (a.role === 'partner') tabs.push(['billing', 'Billing', inv.length], ['portal', 'Portal access', access.length]);
  const setTab = (k: string) => ui.go('client', { id: c.id, tab: k });
  let body: ReactNode = null;
  if (tab === 'overview') body = (
    <div className="grid g2">
      <div className="card"><div className="card-h"><h3>Entity profile</h3>{a.role === 'partner' && <select className="inp" style={{ fontSize: 12, padding: '3px 6px' }} value={c.status} aria-label="Client status" onChange={(e) => run(async () => { const { error } = await sb().from('clients').update({ status: e.target.value }).eq('id', c.id); if (error) throw error; }, `${c.name} marked ${CLIENT_STATUS_LABEL[e.target.value]}.`)}><Opts list={[['active', 'Active'], ['onboarding', 'Onboarding'], ['inactive', 'Inactive']]} /></select>}</div><div className="card-b"><dl className="kv">
        <dt>Legal name</dt><dd>{c.name}</dd><dt>Entity type</dt><dd>{c.entity_type}</dd><dt>PAN</dt><dd className="mono">{maskPan(c.pan)}</dd><dt>TAN</dt><dd className="mono">{c.tan ? '••••' + c.tan.slice(4) : '—'}</dd><dt>GSTIN</dt><dd className="mono">{c.gstin ? maskGst(c.gstin) : 'Not registered'}</dd>
        <dt>State</dt><dd>{STATE_NAMES[c.state_code] || c.state_code || '—'}</dd><dt>Contact</dt><dd>{c.contact_person || '—'}<div className="tiny muted">{c.email || '—'} · {c.phone || '—'}</div></dd><dt>Partner</dt><dd>{c.partner_id ? <Who name={memberName(a.d, c.partner_id)} /> : '—'}</dd><dt>Package</dt><dd>{c.package}</dd>
        <dt>Services</dt><dd>{c.services.length ? c.services.map((s) => <span className="tag" key={s} style={{ marginRight: 4 }}>{s}</span>) : '—'}</dd><dt>Client since</dt><dd>{c.client_since || '—'}</dd>
      </dl></div></div>
      <div className="card"><div className="card-h"><h3>Compliance health</h3>{st.open > 0 && <RiskTag r={st.risk} />}</div><div className="card-b">
        <div className="g3 grid" style={{ gap: 8, marginBottom: 12 }}><div><div className="tiny muted">Open</div><div className="mono" style={{ fontSize: 18 }}>{st.open}</div></div><div><div className="tiny muted">Overdue</div><div className="mono" style={{ fontSize: 18, color: 'var(--bad)' }}>{ts.filter(isOverdue).length}</div></div><div><div className="tiny muted">Docs pending</div><div className="mono" style={{ fontSize: 18 }}>{docs.filter((x) => x.status === 'requested' || x.status === 'missing').length}</div></div></div>
        <div className="tiny muted" style={{ marginBottom: 4 }}>Next deadlines</div>
        {ts.filter(isOpen).sort((x, y) => ((x.due_date || '') < (y.due_date || '') ? -1 : 1)).slice(0, 5).map((t) => <div className="row small" key={t.id} style={{ padding: '4px 0', cursor: 'pointer' }} onClick={() => ui.openDrawer('task', t.id)}><span className="tag">{t.form}</span><span className="grow">{t.period}</span><DueCell date={t.due_date} /></div>)}
        {!ts.filter(isOpen).length && <div className="small muted">No open items.</div>}
      </div></div>
    </div>);
  if (tab === 'compliance') { const byCat = CATS.map((cat) => [cat, ts.filter((t) => t.category === cat)] as [string, Task[]]).filter((x) => x[1].length);
    body = byCat.length ? <div className="grid g2">{byCat.map(([cat, list]) => <div className="card" key={cat}><div className="card-h"><h3>{cat}</h3><span className="tiny muted">{list.length} obligations</span></div><div className="list">{list.map((t) => <div className="li click" key={t.id} onClick={() => ui.openDrawer('task', t.id)}><span className="tag">{t.form}</span><div className="main-t"><div className="small">{t.period}</div><div className="tiny muted">Due {fmtD(t.due_date)}</div></div><Pill label={STATUS_LABEL[t.status]} /></div>)}</div></div>)}</div> : <div className="card"><Empty title="No obligations yet" text="Add services or create a task for this client." /></div>; }
  if (tab === 'tasks') body = <div className="card"><TaskTable tasks={ts} noClient /></div>;
  if (tab === 'documents') body = <div className="card"><DocTable docs={docs} compact actions={(x) => <DocActions x={x} />} /></div>;
  if (tab === 'filings') body = <div className="card"><FilingTable tasks={filings} compact /></div>;
  if (tab === 'communication') body = <div className="card"><div className="card-h"><h3>Messages with {c.contact_person || c.name}</h3>{can(a, 'msg.send') && <button type="button" className="btn sm pri" onClick={() => ui.openModal(<ComposeModal clientId={c.id} />)}><Icon n="send" />New message</button>}</div><MsgTable msgs={msgs} compact onView={(m) => ui.openModal(['draft', 'scheduled', 'queued'].includes(m.status) && m.channel !== 'in_app' ? <ComposeModal edit={m} /> : <ViewMsgModal m={m} />)} /></div>;
  if (tab === 'billing') body = <div className="card"><InvoiceTable invoices={inv} compact actions={(i) => i.status !== 'paid' ? <button type="button" className="btn sm" onClick={() => ui.openModal(<RecordPaymentModal inv={i} />)}>Record payment</button> : null} /></div>;
  if (tab === 'portal') body = (
    <div className="card"><div className="card-h"><h3>People who can sign in to this client's portal</h3><button type="button" className="btn sm pri" onClick={() => ui.openModal(<InviteClientUserModal client={c} />)}><Icon n="plus" />Give access</button></div>
      {access.length ? <div className="tw"><table className="t"><thead><tr><th>Email</th><th>Status</th><th>Added</th><th>By</th><th></th></tr></thead><tbody>{access.map((u) => (
        <tr key={u.id}><td className="mono small">{u.email}</td><td><Pill label={u.user_id ? 'Accepted' : 'Invited'} />{u.accepted_at && <div className="tiny muted">since {fmtDs(u.accepted_at.slice(0, 10))}</div>}</td><td className="num">{fmtDs(u.created_at.slice(0, 10))}</td><td className="small">{u.invited_by || '—'}</td>
          <td><button type="button" className="btn sm danger" onClick={() => run(async () => { const { error } = await sb().from('client_users').delete().eq('id', u.id); if (error) throw error; }, `Access removed for ${u.email}.`)}>Remove access</button></td></tr>))}</tbody></table></div>
        : <Empty title="No portal users yet" text="Give a client contact access so they can upload documents and follow their filings." />}
      <div className="card-b tiny muted" style={{ borderTop: '1px solid var(--line)' }}>Access starts once the person signs up with this email and confirms it. Removing access takes effect on their next page load.</div>
    </div>);
  return (
    <>
      <div className="crumb"><button type="button" onClick={() => ui.go('clients')}>Clients</button> / {c.name}</div>
      <Ph title={c.name} sub={<span className="row"><Pill label={CLIENT_STATUS_LABEL[c.status]} /><span>{c.entity_type}</span><span>·</span><span className="mono">{maskPan(c.pan)}</span>{c.gstin && <><span>·</span><span className="mono">{maskGst(c.gstin)}</span></>}</span>}>
        {can(a, 'doc.request') && <button type="button" className="btn" onClick={() => ui.openModal(<RequestDocsModal clientId={c.id} />)}><Icon n="folder" />Request documents</button>}
        {can(a, 'task.create') && <button type="button" className="btn pri" onClick={() => ui.openModal(<NewTaskModal clientId={c.id} />)}><Icon n="plus" />New task</button>}
      </Ph>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {body}
    </>
  );
}

/* ================= Calendar ================= */
export function Calendar() {
  const a = useApp(); const ui = useUI(); const v = useView();
  const f = ui.f('calendar', { month: todayISO().slice(0, 7), view: 'month', client: '', cat: '', status: '', basis: 'due' });
  const set = (k: string) => (e: { target: { value: string } }) => ui.setF('calendar', k, e.target.value);
  const [Y, M] = f.month.split('-').map(Number);
  const basis = (t: Task) => (f.basis === 'internal' ? t.internal_due_date : t.due_date) || '';
  const ts = v.tasks.filter((t) => (!f.client || t.client_id === f.client) && (!f.cat || t.category === f.cat) && (!f.status || (f.status === 'open' ? isOpen(t) : f.status === 'overdue' ? isOverdue(t) : f.status === 'done' ? !isOpen(t) : t.status === f.status)));
  const inMonth = ts.filter((t) => basis(t).startsWith(f.month));
  const months: [string, string][] = []; for (let i = -6; i <= 9; i++) { const d = new Date(new Date().getFullYear(), new Date().getMonth() + i, 1); months.push([iso(d).slice(0, 7), `${MON[d.getMonth()]} ${d.getFullYear()}`]); }
  if (!months.some((m) => m[0] === f.month)) months.push([f.month, `${MON[M - 1]} ${Y}`]);
  const nav = (dlt: number) => { const d = new Date(Y, M - 1 + dlt, 1); ui.setF('calendar', 'month', iso(d).slice(0, 7)); };
  const evCls = (t: Task) => (!isOpen(t) ? 'ok' : isStatOverdue(t) ? 'bad' : riskOf(t) === 'High' ? 'warn' : '');
  const open = (t: Task) => ui.openDrawer(a.role === 'client' ? 'filing' : 'task', t.id);
  let body: ReactNode;
  if (f.view === 'month') {
    const first = new Date(Y, M - 1, 1); const start = new Date(Y, M - 1, 1 - ((first.getDay() + 6) % 7)); const cells: ReactNode[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i); const s = iso(d); const out = d.getMonth() !== M - 1;
      if (i >= 35 && out && i % 7 === 0) break;
      const evs = ts.filter((t) => basis(t) === s);
      cells.push(<div key={s} className={`dc ${out ? 'out' : ''} ${s === todayISO() ? 'today' : ''}`}><span className="dn">{d.getDate()}</span>
        {evs.slice(0, 3).map((t) => <button type="button" key={t.id} className={`ev ${evCls(t)}`} onClick={() => open(t)} title={`${t.form} · ${clientName(a.d, t.client_id)}`}>{t.form} · {clientName(a.d, t.client_id).split(' ')[0]}</button>)}
        {evs.length > 3 && <button type="button" className="ev more" onClick={() => ui.openModal(<CalDayModal date={s} tasks={evs} />)}>+{evs.length - 3} more</button>}</div>);
    }
    body = <><div className="card"><div className="tw"><div className="cal" style={{ minWidth: 640 }}>{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((x) => <div className="dh" key={x}>{x}</div>)}{cells}</div></div></div>
      <div className="legend" style={{ margin: '8px 0 0' }}><span><i style={{ background: 'var(--accent)' }} />Open</span><span><i style={{ background: 'var(--warn)' }} />High risk</span><span><i style={{ background: 'var(--bad)' }} />Past statutory date</span><span><i style={{ background: 'var(--ok)' }} />Filed / completed</span></div></>;
  } else {
    const days = [...new Set(inMonth.map(basis))].sort();
    body = days.length ? <div className="card"><div className="tw"><table className="t"><thead><tr><th>Date</th><th>Client</th><th>Compliance</th><th>Period</th><th>Statutory due</th><th>Internal due</th>{a.role !== 'client' && <th>Responsible</th>}<th>Review status</th><th>Risk</th></tr></thead><tbody>
      {days.flatMap((dd) => inMonth.filter((t) => basis(t) === dd).map((t, i) => { const rs = reviewStatus(t); return (
        <tr key={t.id} className="click" onClick={() => open(t)}><td className="num">{i === 0 && <><b>{fmtDs(dd)}</b> <span className="tiny muted">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][pd(dd).getDay()]}</span></>}</td><td>{clientName(a.d, t.client_id)}</td><td><span className="tag">{t.form}</span> <span className="tiny muted">{t.category}</span></td><td className="num">{t.period}</td><td><DueCell date={t.due_date} closed={!isOpen(t)} /></td><td><DueCell date={t.internal_due_date} closed={!isOpen(t)} /></td>{a.role !== 'client' && <td><Who name={memberName(a.d, t.preparer_id)} /></td>}<td><Pill label={rs} cls={rs === 'Approved' ? 'ok' : rs === 'Changes requested' ? 'bad' : rs === 'In review' ? 'warn' : ''} /></td><td><RiskTag r={riskOf(t)} /></td></tr>); }))}
    </tbody></table></div></div> : <div className="card"><Empty title="Nothing scheduled" text={`No obligations match these filters in ${months.find((m) => m[0] === f.month)?.[1] || f.month}.`} /></div>;
  }
  return (
    <>
      <Ph title="Compliance calendar" sub={`${inMonth.length} obligations in ${months.find((m) => m[0] === f.month)?.[1] || f.month} by ${f.basis === 'due' ? 'statutory' : 'internal'} date`} />
      <Note kind="warn">Due dates follow standard patterns. Extensions, QRMP schemes and special notifications are not applied automatically; check each date against the official portal and the Compliance Rules catalogue.</Note>
      <div className="filters">
        <div className="seg" role="tablist"><button type="button" className={f.view === 'month' ? 'on' : ''} onClick={() => ui.setF('calendar', 'view', 'month')}>Month</button><button type="button" className={f.view === 'agenda' ? 'on' : ''} onClick={() => ui.setF('calendar', 'view', 'agenda')}>Agenda</button></div>
        <button type="button" className="btn sm" onClick={() => nav(-1)} aria-label="Previous month">‹</button>
        <select className="inp" value={f.month} onChange={set('month')} aria-label="Month"><Opts list={months} /></select>
        <button type="button" className="btn sm" onClick={() => nav(1)} aria-label="Next month">›</button>
        <select className="inp" value={f.basis} onChange={set('basis')} aria-label="Date basis"><Opts list={[['due', 'Statutory due dates'], ['internal', 'Internal due dates']]} /></select>
        {a.role !== 'client' && <select className="inp" value={f.client} onChange={set('client')} aria-label="Client"><Opts list={v.clients.map((c) => [c.id, c.name] as [string, string])} all="All clients" /></select>}
        <select className="inp" value={f.cat} onChange={set('cat')} aria-label="Compliance type"><Opts list={CATS} all="All compliance types" /></select>
        <select className="inp" value={f.status} onChange={set('status')} aria-label="Status"><Opts list={[['open', 'Open'], ['overdue', 'Overdue'], ['done', 'Filed or completed'], ...STATUSES.map((s) => [s, STATUS_LABEL[s]] as [string, string])]} all="All statuses" /></select>
      </div>
      {body}
    </>
  );
}

/* ================= Tasks & workflows ================= */
function filteredTasks(tasks: Task[], f: Record<string, string>, d: ReturnType<typeof useApp>['d']) {
  const q = (f.q || '').toLowerCase();
  return tasks.filter((t) => (!q || `${t.title} ${taskNo(t)} ${clientName(d, t.client_id)} ${t.category}`.toLowerCase().includes(q))
    && (!f.user || t.preparer_id === f.user || t.reviewer_id === f.user) && (!f.client || t.client_id === f.client) && (!f.cat || t.category === f.cat)
    && (!f.risk || (isOpen(t) && riskOf(t) === f.risk))
    && (!f.status || (f.status === 'open' ? isOpen(t) : f.status === 'blocked' ? !!t.blocked && isOpen(t) : t.status === f.status))
    && (!f.deadline || (f.deadline === 'overdue' ? isOverdue(t) : f.deadline === 'statod' ? isStatOverdue(t) : isOpen(t) && !!t.due_date && dDiff(t.due_date) >= 0 && dDiff(t.due_date) <= (f.deadline === 'week' ? 7 : 30))));
}
export function Tasks() {
  const a = useApp(); const ui = useUI(); const v = useView(); const move = useMove();
  const f = ui.f('tasks', { view: 'table', tab: 'tasks', q: '', user: '', client: '', deadline: '', status: '', risk: '', cat: '' });
  const set = (k: string) => (e: { target: { value: string } }) => ui.setF('tasks', k, e.target.value);
  const [over, setOver] = useState('');
  const tabs: [string, string, number?][] = [['tasks', 'Tasks'], ['auto', 'Automation rules', a.d.rules.filter((r) => r.enabled).length]];
  if (f.tab === 'auto') return <><Ph title="Tasks & workflows" sub="Rules that generate, remind and escalate work" /><Tabs tabs={tabs} value={f.tab} onChange={(k) => ui.setF('tasks', 'tab', k)} /><Automation /></>;
  const ts = filteredTasks(v.tasks, f, a.d).sort((x, y) => (Number(isOverdue(y)) - Number(isOverdue(x))) || ((x.due_date || '9') < (y.due_date || '9') ? -1 : 1));
  const anyF = ['q', 'user', 'client', 'deadline', 'status', 'risk', 'cat'].some((k) => f[k]);
  const csv = () => downloadCsv('tasks', [['Task no', 'Form', 'Client', 'Category', 'Period', 'Preparer', 'Reviewer', 'Internal due', 'Statutory due', 'Priority', 'Status', 'Checklist %', 'Risk', 'Overdue'], ...ts.map((t) => [taskNo(t), t.form, clientName(a.d, t.client_id), t.category, t.period, memberName(a.d, t.preparer_id), memberName(a.d, t.reviewer_id), t.internal_due_date, t.due_date, t.priority, STATUS_LABEL[t.status], checklistPct(t), riskOf(t), isOverdue(t) ? 'Yes' : 'No'])]);
  const drop = (e: DragEvent<HTMLElement>, s: StatusKey) => { e.preventDefault(); setOver(''); const t = a.d.tasks.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (t && t.status !== s) void move(t, s); };
  return (
    <>
      <Ph title="Tasks & workflows" sub={<>{v.tasks.length} tasks · {v.tasks.filter(isOpen).length} open · <span style={{ color: 'var(--bad)' }}>{v.tasks.filter(isOverdue).length} overdue</span></>}>
        <div className="seg"><button type="button" className={f.view === 'table' ? 'on' : ''} onClick={() => ui.setF('tasks', 'view', 'table')}>Table</button><button type="button" className={f.view === 'kanban' ? 'on' : ''} onClick={() => ui.setF('tasks', 'view', 'kanban')}>Kanban</button></div>
        <button type="button" className="btn" onClick={csv}><Icon n="down" />Export</button>
        {can(a, 'task.create') && <button type="button" className="btn pri" onClick={() => ui.openModal(<NewTaskModal />)}><Icon n="plus" />New task</button>}
      </Ph>
      <Tabs tabs={tabs} value={f.tab} onChange={(k) => ui.setF('tasks', 'tab', k)} />
      <div className="filters">
        <input className="inp q" placeholder="Search task, client, form, T-number" value={f.q} onChange={set('q')} aria-label="Search tasks" />
        <select className="inp" value={f.user} onChange={set('user')} aria-label="User"><Opts list={a.d.team.map((m) => [m.id, `${m.name} · ${m.role}`] as [string, string])} all="Anyone" /></select>
        <select className="inp" value={f.client} onChange={set('client')} aria-label="Client"><Opts list={a.d.clients.map((c) => [c.id, c.name] as [string, string])} all="All clients" /></select>
        <select className="inp" value={f.deadline} onChange={set('deadline')} aria-label="Deadline"><Opts list={[['overdue', 'Overdue (internal)'], ['statod', 'Past statutory date'], ['week', 'Statutory due in 7 days'], ['month', 'Statutory due in 30 days']]} all="Any deadline" /></select>
        {f.view === 'table' && <select className="inp" value={f.status} onChange={set('status')} aria-label="Status"><Opts list={[['open', 'All open'], ['blocked', 'Blocked'], ...STATUSES.map((s) => [s, STATUS_LABEL[s]] as [string, string])]} all="All statuses" /></select>}
        <select className="inp" value={f.cat} onChange={set('cat')} aria-label="Category"><Opts list={CATS} all="All categories" /></select>
        <select className="inp" value={f.risk} onChange={set('risk')} aria-label="Risk"><Opts list={['High', 'Medium', 'Low']} all="Any risk" /></select>
        {anyF && <button type="button" className="btn sm ghost" onClick={() => ui.setFAll('tasks', { view: f.view, tab: f.tab })}>Clear filters</button>}<span className="tiny muted">{ts.length} shown</span>
      </div>
      {f.view === 'table' ? <div className="card"><TaskTable tasks={ts} emptyT={v.tasks.length ? 'No tasks match' : 'No tasks yet'} emptyX={v.tasks.length ? 'Adjust the filters or create a task.' : 'Add a client with services, or create a task.'} /></div> : (
        <>
          <Note>Drag a card to another column to change its status. Moving to Filed or later needs a recorded acknowledgement, so those drops open the filing panel.</Note>
          <div className="kb">{STATUSES.map((s) => { const list = ts.filter((t) => t.status === s); return (
            <section key={s} className={`kcol ${over === s ? 'over' : ''}`} aria-label={STATUS_LABEL[s]} onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver('')} onDrop={(e) => drop(e, s)}>
              <div className="kcol-h"><span>{STATUS_LABEL[s]}</span><span className="mono faint">{list.length}</span></div>
              <div className="kcol-b">{list.length ? list.map((t) => { const done = t.checklist.filter((x) => x.done).length; return (
                <article key={t.id} className={`kcard ${isOverdue(t) ? 'od' : ''}`} draggable={can(a, 'task.edit')} tabIndex={0} onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; }} onClick={() => ui.openDrawer('task', t.id)} onKeyDown={(e) => { if (e.key === 'Enter') ui.openDrawer('task', t.id); }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span className="tag">{t.form}</span><PrioPill p={t.priority} /></div>
                  <div className="kt">{clientName(a.d, t.client_id)}</div><div className="tiny muted">{t.period} · {memberName(a.d, t.preparer_id)}</div>
                  <div className="row" style={{ justifyContent: 'space-between' }}><span className="tiny"><DueCell date={t.internal_due_date} closed={!isOpen(t)} /></span><span className="tiny mono muted">{done}/{t.checklist.length}</span></div>
                  {t.blocked && <div className="tiny" style={{ color: 'var(--bad)' }}>Blocked</div>}
                </article>); }) : <div className="tiny faint" style={{ textAlign: 'center', padding: 8 }}>No tasks</div>}</div>
            </section>); })}</div>
        </>
      )}
    </>
  );
}

function Automation() {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const ed = a.role === 'partner';
  const toggle = (r: AutoRule, on: boolean) => run(async () => { const { error } = await sb().from('automation_rules').update({ enabled: on }).eq('id', r.id); if (error) throw error; }, `Rule "${r.name}" ${on ? 'enabled' : 'disabled'}.`);
  return (
    <>
      <Note><b>Rules run on demand.</b> Press <b>Run now</b> to preview what a rule would do today, then apply it. The <b>Reviewer handoff</b> rule also runs automatically whenever a task is marked Prepared. There is no background scheduler yet, and email or WhatsApp messages are logged, not sent.</Note>
      <div className="card"><div className="tw"><table className="t"><thead><tr><th style={{ width: 56 }}>On</th><th>Rule</th><th>Trigger</th><th>Action</th><th>Scope</th><th>Last run</th><th></th></tr></thead><tbody>
        {a.d.rules.map((r) => (
          <tr key={r.id}>
            <td><label className="switch" title={r.enabled ? 'Disable rule' : 'Enable rule'}><input type="checkbox" checked={r.enabled} disabled={!ed} onChange={(e) => toggle(r, e.target.checked)} aria-label={`Enable ${r.name}`} /><span /></label></td>
            <td><div className="strong">{r.name}</div></td><td className="small">{r.trig.replace('N days', `${r.days} days`)}</td><td className="small" style={{ maxWidth: 320 }}>{r.action}</td><td className="small">{r.scope}</td><td className="small muted">{r.last_run || 'Never'}</td>
            <td><div className="row" style={{ flexWrap: 'nowrap' }}><button type="button" className="btn sm" disabled={!r.enabled} onClick={() => ui.openModal(<RulePreviewModal r={r} />)}>Run now</button>{ed && <button type="button" className="btn sm ghost" onClick={() => ui.openModal(<RuleEditModal r={r} />)}>Edit</button>}</div></td>
          </tr>
        ))}
      </tbody></table></div></div>
      {!a.d.rules.length && <Empty title="No rules found" text="Run migration 0005 in Supabase to add the default rules." />}
      {!ed && <div className="tiny muted" style={{ marginTop: 8 }}>Only partners can change or apply rules.</div>}
    </>
  );
}

/* ================= Filings ================= */
export function Filings() {
  const a = useApp(); const ui = useUI(); const v = useView();
  const f = ui.f('filings', { q: '', method: '', stage: '', evidence: '', cat: '' });
  const set = (k: string) => (e: { target: { value: string } }) => ui.setF('filings', k, e.target.value);
  const q = f.q.toLowerCase();
  const ts = v.tasks.filter((t) => (!q || `${t.title} ${clientName(a.d, t.client_id)} ${t.filing.ack}`.toLowerCase().includes(q)) && (!f.method || t.filing.method === f.method) && (!f.cat || t.category === f.cat)
    && (!f.stage || String(filingStage(t)) === f.stage) && (!f.evidence || (f.evidence === 'pending' ? (t.status === 'filed' || t.status === 'evidence_pending') && t.filing.evidence !== 'verified' : t.filing.evidence === f.evidence)))
    .sort((x, y) => filingStage(y) - filingStage(x) || ((x.due_date || '') < (y.due_date || '') ? -1 : 1));
  const st = ['Documents', 'Preparation', 'Review', 'Approval', 'Submission', 'Acknowledgement', 'Verification', 'Completed'];
  const colors = ['var(--info)', 'var(--accent)', 'var(--warn)', 'var(--accent-2)', 'var(--fg-2)', 'var(--warn)', 'var(--info)', 'var(--ok)'];
  const counts = st.map((_, i) => v.tasks.filter((t) => filingStage(t) === i).length);
  const csv = () => downloadCsv('filings', [['Task no', 'Client', 'Form', 'Period', 'Method', 'Acknowledgement', 'Submitted on', 'Evidence'], ...v.tasks.map((t) => [taskNo(t), clientName(a.d, t.client_id), t.form, t.period, t.filing.method, t.filing.ack, t.filing.submitted_on, EVIDENCE_LABEL[t.filing.evidence]])]);
  return (
    <>
      <Ph title="Regulatory filing centre" sub={`${v.tasks.filter((t) => t.filing.ack).length} submissions recorded · ${v.tasks.filter((t) => (t.status === 'filed' || t.status === 'evidence_pending') && t.filing.evidence !== 'verified').length} awaiting evidence verification`}>
        {a.role !== 'client' && <button type="button" className="btn" onClick={csv}><Icon n="down" />Export</button>}
      </Ph>
      <Note kind="warn">This app does not submit anything to GSTN, the Income Tax portal or MCA. Assisted filing records what your team did on the official portal; acknowledgements are user-entered until a partner verifies them against the uploaded evidence.</Note>
      <div className="card" style={{ marginBottom: 14 }}><div className="card-b">
        <div style={{ marginBottom: 8 }}><Stack height={12} parts={counts.map((n, i) => ({ n, color: colors[i], title: st[i] }))} /></div>
        <div className="legend">{st.map((s, i) => <button type="button" key={s} className={`btn sm ${f.stage === String(i) ? 'pri' : 'ghost'}`} onClick={() => ui.setF('filings', 'stage', f.stage === String(i) ? '' : String(i))}>{s} <span className="mono">{counts[i]}</span></button>)}</div>
      </div></div>
      <div className="filters">
        <input className="inp q" placeholder="Search client, form or acknowledgement" value={f.q} onChange={set('q')} aria-label="Search filings" />
        <select className="inp" value={f.method} onChange={set('method')} aria-label="Method"><Opts list={['Integrated', 'Assisted']} all="Any method" /></select>
        <select className="inp" value={f.cat} onChange={set('cat')} aria-label="Category"><Opts list={CATS} all="All categories" /></select>
        <select className="inp" value={f.evidence} onChange={set('evidence')} aria-label="Evidence"><Opts list={[['pending', 'Filed, evidence not verified'], ['awaiting_upload', 'Awaiting upload'], ['under_verification', 'Under verification'], ['verified', 'Verified']]} all="Any evidence status" /></select>
        {Object.values(f).some(Boolean) && <button type="button" className="btn sm ghost" onClick={() => ui.setFAll('filings', {})}>Clear filters</button>}<span className="tiny muted">{ts.length} shown</span>
      </div>
      <div className="card"><FilingTable tasks={ts} /></div>
    </>
  );
}

/* ================= Documents ================= */
export function DocActions({ x }: { x: Doc }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const c = a.d.clients.find((k) => k.id === x.client_id);
  return (
    <>
      {['requested', 'missing', 'rejected'].includes(x.status) && can(a, 'doc.upload') && <button type="button" className="btn sm" onClick={() => ui.openModal(<UploadDocModal doc={x} />)}><Icon n="upload" />Upload</button>}
      {['requested', 'missing'].includes(x.status) && can(a, 'doc.request') && c && <button type="button" className="btn sm ghost" onClick={() => run(async () => {
        await logMessage(a, { channel: 'email', client_id: c.id, task_id: x.task_id, recipient: c.contact_person || c.name, to_addr: c.email, purpose: 'Document reminder', template: 'doc_request', body: `Dear ${c.contact_person || c.name},\n\nReminder: we are still waiting for ${x.name}.\n\nRegards,\n${a.firm.name}` });
        if (x.status === 'requested' && x.requested_on && dDiff(x.requested_on) <= -7) { const { error } = await sb().from('documents').update({ status: 'missing' }).eq('id', x.id); if (error) throw error; }
      }, 'Reminder logged in Notifications (not sent: no email provider connected).', 'info')}>Remind</button>}
      {x.status === 'awaiting_review' && can(a, 'doc.review') && <>
        <button type="button" className="btn sm" onClick={() => run(async () => {
          const { error } = await sb().from('documents').update({ status: 'received', reviewed_by: a.me?.name || '', comment: '' }).eq('id', x.id); if (error) throw error;
          const t = a.d.tasks.find((k) => k.id === x.task_id); if (t) await addActivity(a, t, 'Accepted document ' + x.name);
        }, 'Document accepted.')}>Accept</button>
        <button type="button" className="btn sm ghost" onClick={() => ui.openModal(<RejectDocModal doc={x} />)}>Reject</button>
      </>}
    </>
  );
}
export function Documents() {
  const a = useApp(); const ui = useUI(); const v = useView();
  const f = ui.f('documents', { status: '', q: '', client: '' });
  const all = v.docs; const q = f.q.toLowerCase();
  const tabs: [string, string][] = [['', 'All'], ['pending', 'Pending'], ['requested', 'Requested'], ['missing', 'Missing'], ['awaiting_review', 'Awaiting review'], ['rejected', 'Rejected'], ['received', 'Received']];
  const match = (x: Doc, s: string) => !s || (s === 'pending' ? ['requested', 'missing', 'awaiting_review'].includes(x.status) : x.status === s);
  const ds = all.filter((x) => match(x, f.status) && (!f.client || x.client_id === f.client) && (!q || `${x.name} ${clientName(a.d, x.client_id)} ${x.file_name}`.toLowerCase().includes(q)));
  const recvd = all.filter((x) => x.status === 'received').length;
  return (
    <>
      <Ph title={a.role === 'client' ? 'Your documents' : 'Client document workspace'} sub={`${all.length} documents · collection ${all.length ? Math.round((100 * recvd) / all.length) : 0}% complete`}>
        {can(a, 'doc.request') && <button type="button" className="btn pri" onClick={() => ui.openModal(<RequestDocsModal />)}><Icon n="plus" />New document request</button>}
      </Ph>
      <Tabs tabs={tabs.map(([k, l]) => [k, l, all.filter((x) => match(x, k)).length] as [string, string, number])} value={f.status} onChange={(k) => ui.setF('documents', 'status', k)} />
      <div className="filters"><input className="inp q" placeholder="Search documents" value={f.q} onChange={(e) => ui.setF('documents', 'q', e.target.value)} aria-label="Search documents" />
        {a.role !== 'client' && <select className="inp" value={f.client} onChange={(e) => ui.setF('documents', 'client', e.target.value)} aria-label="Client"><Opts list={a.d.clients.map((c) => [c.id, c.name] as [string, string])} all="All clients" /></select>}
        <span className="tiny muted">{ds.length} shown</span></div>
      <div className="card"><DocTable docs={ds} compact={a.role === 'client'} actions={(x) => <DocActions x={x} />} /></div>
    </>
  );
}

export { addD };
