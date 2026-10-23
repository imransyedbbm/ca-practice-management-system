import { useState } from 'react';
import type { ReactNode } from 'react';
import { useApp, sb, memberName, clientName, isPartnerRole, isReviewerRole, logMessage, myName, inviteMember } from './store';
import { useUI, Pill, Who, DueCell, Empty, Note, Icon, Opts, Tabs, BarChart, HBars, Bar, C } from './ui';
import { useRun, useView, can, MsgTable, InvoiceTable } from './parts';
import { Ph, Kpi, monthlyCompletion } from './pages1';
import {
  LogNoticeModal, ComposeModal, ViewMsgModal, EditTemplateModal, NewInvoiceModal, RecordPaymentModal, TeamMemberModal, ReassignModal,
} from './modals';
import { CATS, NOTICE_LABEL, RULE_STATUS_LABEL, INTEGRATIONS, PERMISSIONS, CHANNEL_LABEL, MSG_STATUS_LABEL, CLIENT_STATUS_LABEL, DOC_LABEL } from './constants';
import {
  isOpen, isOverdue, riskOf, dDiff, fmtD, fmtDs, fmtDT, inr, inrK, maskPan, taskNo, filingStage, downloadCsv, invoiceState, STATUS_LABEL, errMsg,
} from './util';
import type { Message, TeamMember, NoticeStatus, Settings } from './types';

/* ================= Notices ================= */
export function Notices() {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const f = ui.f('notices', { status: '', auth: '' });
  const ns = a.d.notices.filter((n) => (!f.status || n.status === f.status) && (!f.auth || n.authority === f.auth)).sort((x, y) => ((x.response_due || '') < (y.response_due || '') ? -1 : 1));
  const ed = can(a, 'notice.edit');
  const openN = a.d.notices.filter((n) => n.status !== 'closed' && n.status !== 'response_filed');
  return (
    <>
      <Ph title="Notices & assessments" sub={`${openN.length} open · demand under dispute ${inrK(a.d.notices.filter((n) => n.status !== 'closed').reduce((s, n) => s + n.demand, 0))}`}>
        {ed && <button type="button" className="btn pri" onClick={() => ui.openModal(<LogNoticeModal />)}><Icon n="plus" />Log notice</button>}
      </Ph>
      <Note>Log each notice received from the GST, Income Tax or TRACES portals, with its response due date. Pulling notices automatically needs an authorised portal integration.</Note>
      <div className="filters">
        <select className="inp" value={f.status} onChange={(e) => ui.setF('notices', 'status', e.target.value)} aria-label="Status"><Opts list={Object.entries(NOTICE_LABEL)} all="All statuses" /></select>
        <select className="inp" value={f.auth} onChange={(e) => ui.setF('notices', 'auth', e.target.value)} aria-label="Authority"><Opts list={CATS} all="All authorities" /></select>
      </div>
      <div className="card">{ns.length ? <div className="tw"><table className="t"><thead><tr><th>Client</th><th>Authority</th><th>Notice</th><th className="r">Demand</th><th>Received</th><th>Response due</th><th>Owner</th><th>Status</th></tr></thead><tbody>
        {ns.map((n) => (
          <tr key={n.id}>
            <td>{clientName(a.d, n.client_id)}</td><td>{n.authority}</td>
            <td><span className="tag">{n.ref}</span> <span className="small">{n.subject}</span>{n.doc_ref && <div className="sub mono">{n.doc_ref}</div>}</td>
            <td className="r num">{n.demand ? inr(n.demand) : '—'}</td><td className="num">{fmtDs(n.received_on)}</td>
            <td>{n.status === 'closed' || n.status === 'response_filed' ? <span className="num">{fmtDs(n.response_due)}</span> : <DueCell date={n.response_due} />}</td>
            <td>{n.owner_id ? <Who name={memberName(a.d, n.owner_id)} /> : <span className="faint">—</span>}</td>
            <td>{ed ? <select className="inp" style={{ fontSize: 12, padding: '3px 6px' }} value={n.status} aria-label="Notice status" onChange={(e) => run(async () => { const { error } = await sb().from('notices').update({ status: e.target.value as NoticeStatus }).eq('id', n.id); if (error) throw error; }, `${n.ref} marked ${NOTICE_LABEL[e.target.value]}.`)}><Opts list={Object.entries(NOTICE_LABEL)} /></select> : <Pill label={NOTICE_LABEL[n.status]} />}</td>
          </tr>))}
      </tbody></table></div> : <Empty title={a.d.notices.length ? 'No notices match' : 'No notices logged'} text={a.d.notices.length ? 'Nothing matches these filters.' : 'Log a notice when one arrives so its response date is tracked.'} />}</div>
    </>
  );
}

/* ================= Notifications ================= */
export function Notifications() {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const f = ui.f('notifications', { ch: '', purpose: '', status: '' });
  let ms = a.d.msgs; if (a.role === 'client') ms = ms.filter((m) => m.client_id === a.portalClientId && m.channel !== 'in_app');
  const shown = ms.filter((m) => (!f.ch || m.channel === f.ch) && (!f.purpose || m.purpose === f.purpose) && (!f.status || m.status === f.status));
  const purposes = [...new Set(ms.map((m) => m.purpose))].filter(Boolean);
  const view = (m: Message) => {
    if (m.channel === 'in_app' && !m.read) void sb().from('messages').update({ read: true }).eq('id', m.id).then(() => a.reload());
    ui.openModal(['draft', 'scheduled', 'queued'].includes(m.status) && can(a, 'msg.send') && m.channel !== 'in_app' ? <ComposeModal edit={m} /> : <ViewMsgModal m={m} />);
  };
  const toggle = (m: Message) => run(async () => { const { error } = await sb().from('messages').update({ read: !m.read }).eq('id', m.id); if (error) throw error; });
  const markAll = () => run(async () => { const { error } = await sb().from('messages').update({ read: true }).eq('firm_id', a.firm.id).eq('channel', 'in_app').eq('read', false); if (error) throw error; }, 'All in-app alerts marked as read.');
  const tabs: [string, string, number][] = [['', 'All', ms.length], ['email', 'Email', ms.filter((m) => m.channel === 'email').length], ['whatsapp', 'WhatsApp', ms.filter((m) => m.channel === 'whatsapp').length]];
  if (a.role !== 'client') tabs.push(['in_app', 'In-app', ms.filter((m) => m.channel === 'in_app').length]);
  const tpls = a.d.settings?.templates || {};
  return (
    <>
      <Ph title="Notifications centre" sub={`${ms.length} messages · ${ms.filter((m) => m.channel === 'in_app' && !m.read).length} unread in-app`}>
        {a.role !== 'client' && <button type="button" className="btn" onClick={markAll}>Mark all in-app read</button>}
        {can(a, 'msg.send') && <button type="button" className="btn pri" onClick={() => ui.openModal(<ComposeModal />)}><Icon n="send" />New message</button>}
      </Ph>
      {a.role !== 'client' && <Note kind="warn">No email or WhatsApp provider is connected. “Logged, not sent” means the message was recorded for the team; “Queued” means its channel is not configured. In-app alerts are delivered inside this app.</Note>}
      <Tabs tabs={tabs} value={f.ch} onChange={(k) => ui.setF('notifications', 'ch', k)} />
      <div className="filters">
        <select className="inp" value={f.purpose} onChange={(e) => ui.setF('notifications', 'purpose', e.target.value)} aria-label="Purpose"><Opts list={purposes} all="All purposes" /></select>
        <select className="inp" value={f.status} onChange={(e) => ui.setF('notifications', 'status', e.target.value)} aria-label="Delivery status"><Opts list={Object.entries(MSG_STATUS_LABEL)} all="Any status" /></select>
      </div>
      <div className={`grid ${a.role === 'client' ? '' : 'g-dash'}`}>
        <div className="card"><MsgTable msgs={shown} compact={a.role === 'client'} onView={view} onToggle={a.role === 'client' ? undefined : toggle} /></div>
        {a.role !== 'client' && <div className="card" style={{ alignSelf: 'start' }}><div className="card-h"><h3>Message templates</h3></div>
          <div className="list">{Object.entries(tpls).map(([k, t]) => (
            <div className="li" key={k}><div className="main-t"><div className="ttl">{t.name}</div><div className="tiny muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.body.split('\n').find(Boolean)}</div></div><span className="tag">{t.channel}</span>
              {a.role === 'partner' && <button type="button" className="btn sm ghost" onClick={() => ui.openModal(<EditTemplateModal k={k} />)}>Edit</button>}</div>
          ))}{!Object.keys(tpls).length && <Empty title="No templates" text="Run migration 0005 to add the default templates." />}</div>
          <div className="card-b tiny muted">Merge fields: {'{{contact}} {{client}} {{task}} {{due}} {{ack}} {{firm}}'}</div></div>}
      </div>
    </>
  );
}

/* ================= Team & workload ================= */
export function staffLoad(d: ReturnType<typeof useApp>['d'], s: TeamMember) {
  const T = d.tasks; const prep = T.filter((t) => t.preparer_id === s.id && isOpen(t)); const rev = T.filter((t) => t.reviewer_id === s.id && (t.status === 'under_review' || t.status === 'prepared'));
  const od = T.filter((t) => t.preparer_id === s.id && isOverdue(t));
  const clients = new Set([...T.filter((t) => t.preparer_id === s.id || t.reviewer_id === s.id).map((t) => t.client_id), ...d.clients.filter((c) => c.partner_id === s.id).map((c) => c.id)]);
  return { prep, rev, od, clients: clients.size, util: (prep.length + rev.length) / s.capacity };
}
function LoginCell({ s, ed }: { s: TeamMember; ed: boolean }) {
  const a = useApp(); const ui = useUI(); const [busy, setBusy] = useState(false);
  if (s.user_id) return <Pill label="Signed in" cls="ok" nodot />;
  const send = async () => {
    setBusy(true);
    try {
      const res = await inviteMember(s.id);
      ui.toast(res === 'linked' ? `${s.name} already had an account and can now sign in to this firm.` : `Invitation emailed to ${s.email}.`);
    } catch (e) { ui.toast(errMsg(e), 'warn'); }
    await a.reload().catch(() => undefined);
    setBusy(false);
  };
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      {s.invited_at ? <span title={`Invited ${fmtDT(s.invited_at)}`}><Pill label="Invited" cls="warn" nodot /></span> : <span className="faint small">No login</span>}
      {ed && s.active && <button type="button" className="btn sm ghost" disabled={busy || !s.email} title={s.email ? undefined : 'Add an email first'} onClick={() => void send()}>{busy ? 'Sending…' : s.invited_at ? 'Resend invite' : 'Send invite'}</button>}
    </div>
  );
}
export function Team() {
  const a = useApp(); const ui = useUI();
  const f = ui.f('team', { role: '', util: '', show: 'active' });
  const ed = a.role === 'partner';
  const rows = a.d.team.filter((s) => (f.show === 'all' || s.active) && (!f.role || s.role === f.role)).map((s) => ({ s, l: staffLoad(a.d, s) }))
    .filter(({ l }) => !f.util || (f.util === 'over' ? l.util > 0.9 : f.util === 'mid' ? l.util >= 0.5 && l.util <= 0.9 : l.util < 0.5));
  const roles = [...new Set(a.d.team.map((s) => s.role))];
  return (
    <>
      <Ph title="Team & workload" sub={`${a.d.team.filter((m) => m.active).length} people · utilisation = open tasks as preparer plus review queue ÷ weekly capacity`}>
        {ed && <button type="button" className="btn" onClick={() => ui.openModal(<ReassignModal />)}>Reassign tasks</button>}
        {ed && <button type="button" className="btn pri" onClick={() => ui.openModal(<TeamMemberModal />)}><Icon n="plus" />Add team member</button>}
      </Ph>
      {!a.d.team.some((m) => /Accountant|Article|Manager/.test(m.role)) && <Note>Add the people who prepare and review work. Tick "Email a login invitation" to let them sign in; people without a login can still be assigned tasks.</Note>}
      <div className="filters">
        <select className="inp" value={f.role} onChange={(e) => ui.setF('team', 'role', e.target.value)} aria-label="Role"><Opts list={roles} all="All roles" /></select>
        <select className="inp" value={f.util} onChange={(e) => ui.setF('team', 'util', e.target.value)} aria-label="Utilisation"><Opts list={[['over', 'Over 90% (overloaded)'], ['mid', '50–90%'], ['under', 'Under 50% (has capacity)']]} all="Any utilisation" /></select>
        <select className="inp" value={f.show} onChange={(e) => ui.setF('team', 'show', e.target.value)} aria-label="Show"><Opts list={[['active', 'Active people'], ['all', 'Include inactive']]} /></select>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>{rows.length ? <div className="tw"><table className="t"><thead><tr><th>Person</th><th>Role</th><th>Login</th><th className="r">Assigned clients</th><th className="r">Open tasks</th><th className="r">Overdue</th><th className="r">Awaiting review</th><th style={{ width: 200 }}>Utilisation</th>{ed && <th></th>}</tr></thead><tbody>
        {rows.map(({ s, l }) => { const pct = Math.round(l.util * 100); return (
          <tr key={s.id}>
            <td><Who name={s.name} />{s.email && <div className="sub" style={{ marginLeft: 30 }}>{s.email}</div>}{!s.active && <div className="tiny faint" style={{ marginLeft: 30 }}>Inactive</div>}</td><td>{s.role}</td>
            <td><LoginCell s={s} ed={ed} /></td>
            <td className="r num">{l.clients}</td><td className="r num">{l.prep.length}</td><td className="r num" style={l.od.length ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{l.od.length}</td><td className="r num">{l.rev.length}</td>
            <td><div className="row" style={{ flexWrap: 'nowrap' }}><div className="grow"><Bar pct={pct} cls={pct > 90 ? 'bad' : pct > 70 ? 'warn' : 'ok'} /></div><span className="num tiny" style={{ width: 38, textAlign: 'right' }}>{pct}%</span></div></td>
            {ed && <td><div className="row" style={{ flexWrap: 'nowrap' }}><button type="button" className="btn sm ghost" onClick={() => ui.openModal(<TeamMemberModal m={s} />)}>Edit</button><button type="button" className="btn sm ghost" disabled={!l.prep.length} onClick={() => ui.openModal(<ReassignModal from={s.id} />)}>Reassign</button></div></td>}
          </tr>); })}
      </tbody></table></div> : <Empty title="Nobody matches" text="Change the role or utilisation filter." />}</div>
      <div className="card"><div className="card-h"><h3>How access works</h3></div><div className="card-b grid g3">
        {[['Partners', 'Managing partners and partners see everything, including billing, client portal access and settings. They reassign work, apply rules and verify filing evidence.'],
          ['Staff', 'Other firm logins work on tasks, filings, documents, notices and messages. They cannot see billing or change settings and rules.'],
          ['Client users', 'Clients sign in to a portal limited to their own company: deadlines, requested documents, filing status and invoices.']].map(([l, x]) => <div key={l}><b>{l}</b><p className="small muted" style={{ margin: '4px 0 0' }}>{x}</p></div>)}
      </div><div className="card-b" style={{ paddingTop: 0 }}><Note kind="warn">These rules are enforced by the database for every request, not just hidden in the screen.</Note></div></div>
    </>
  );
}

/* ================= Reports ================= */
export function Reports() {
  const a = useApp(); const ui = useUI(); const v = useView();
  const f = ui.f('reports', { cat: '', partner: '' });
  const inScope = (clientId: string, cat: string) => (!f.cat || cat === f.cat) && (!f.partner || a.d.clients.find((c) => c.id === clientId)?.partner_id === f.partner);
  const T = v.tasks.filter((t) => inScope(t.client_id, t.category));
  const hist = monthlyCompletion(T);
  const odBy = a.d.team.filter((s) => s.active && s.role !== 'Managing Partner').map((s) => ({ label: s.name, value: T.filter((t) => t.preparer_id === s.id && isOverdue(t)).length, cls: 'bad' }));
  const groups: [string, number[], string][] = [['Not started', [0], C.vio], ['Preparing', [1], C.a], ['Review / approval', [2, 3], C.warn], ['Submission', [4], C.fg2], ['Filed, evidence open', [5, 6], C.vio], ['Completed', [7], C.ok]];
  const docs = v.docs.filter((x) => { const t = a.d.tasks.find((k) => k.id === x.task_id); return !t || inScope(t.client_id, t.category); });
  const recv = docs.filter((x) => x.status === 'received').length;
  const docBy = (['received', 'awaiting_review', 'requested', 'missing', 'rejected'] as const).map((s) => ({ label: DOC_LABEL[s], value: docs.filter((x) => x.status === s).length, cls: s === 'received' ? 'ok' : s === 'missing' || s === 'rejected' ? 'bad' : 'warn' }));
  const health = v.clients.filter((c) => !f.partner || c.partner_id === f.partner).map((c) => {
    const ts = a.d.tasks.filter((t) => t.client_id === c.id && (!f.cat || t.category === f.cat)); const done = ts.filter((t) => !isOpen(t)).length; const od = ts.filter(isOverdue).length;
    const cd = a.d.docs.filter((x) => x.client_id === c.id); const dp = cd.length ? Math.round((100 * cd.filter((x) => x.status === 'received').length) / cd.length) : 100;
    const score = Math.max(0, Math.round(100 - od * 18 - ts.filter((t) => isOpen(t) && riskOf(t) === 'High').length * 10 - (100 - dp) * 0.3));
    return { c, n: ts.length, done, od, dp, score };
  }).sort((x, y) => x.score - y.score);
  const fees = v.clients.map((c) => { const inv = a.d.invoices.filter((i) => i.client_id === c.id && ['Unpaid', 'Overdue'].includes(invoiceState(i))); return { c, amt: inv.reduce((s, i) => s + i.amount, 0), od: inv.filter((i) => invoiceState(i) === 'Overdue').length }; }).filter((x) => x.amt).sort((x, y) => y.amt - x.amt);
  const wl = a.d.team.filter((s) => s.active).map((s) => { const l = staffLoad(a.d, s); return { label: s.name, value: Math.round(l.util * 100), max: 100, text: Math.round(l.util * 100) + '%', cls: l.util > 0.9 ? 'bad' : l.util > 0.7 ? 'warn' : 'ok' }; });
  const card = (t: string, body: ReactNode, csv?: () => void, note?: string) => <div className="card"><div className="card-h"><h3>{t}</h3>{csv && <button type="button" className="btn sm" onClick={csv}><Icon n="down" />CSV</button>}</div><div className="card-b">{body}{note && <div className="tiny muted" style={{ marginTop: 6 }}>{note}</div>}</div></div>;
  return (
    <>
      <Ph title="Reports & analytics" sub={`${a.firm.name} · ${ui.fy === 'all' ? 'all financial years' : 'FY ' + ui.fy}`} />
      <div className="filters">
        <select className="inp" value={f.cat} onChange={(e) => ui.setF('reports', 'cat', e.target.value)} aria-label="Category"><Opts list={CATS} all="All categories" /></select>
        <select className="inp" value={f.partner} onChange={(e) => ui.setF('reports', 'partner', e.target.value)} aria-label="Partner"><Opts list={a.d.team.filter(isPartnerRole).map((p) => [p.id, p.name] as [string, string])} all="All partners" /></select>
        {(f.cat || f.partner) && <button type="button" className="btn sm ghost" onClick={() => ui.setFAll('reports', {})}>Clear filters</button>}
      </div>
      <div className="grid g2" style={{ marginBottom: 14 }}>
        {card('Compliance completion by month', <BarChart label="Compliance completion by month" labels={hist.map((x) => x.label)} series={[{ name: 'Obligations due', color: C.mute, values: hist.map((x) => x.due) }, { name: 'Filed', color: C.ok, values: hist.map((x) => x.onTime + x.late) }]} />,
          () => downloadCsv('compliance by month', [['Month', 'Obligations due', 'Filed on time', 'Filed late', 'Open'], ...hist.map((x) => [x.key, x.due, x.onTime, x.late, x.open])]), 'By statutory due month, from your tasks.')}
        {card('Filing status by compliance category', <BarChart label="Filing status by category" stacked labels={CATS} series={groups.map((g) => ({ name: g[0], color: g[2], values: CATS.map((c) => T.filter((t) => t.category === c && g[1].includes(filingStage(t))).length) }))} />,
          () => downloadCsv('filing status by category', [['Category', ...groups.map((g) => g[0])], ...CATS.map((c) => [c, ...groups.map((g) => T.filter((t) => t.category === c && g[1].includes(filingStage(t))).length)])]))}
      </div>
      <div className="grid g3" style={{ marginBottom: 14 }}>
        {card('Overdue tasks by team member', <HBars items={odBy} />, () => downloadCsv('overdue by member', [['Person', 'Overdue tasks'], ...odBy.map((x) => [x.label, x.value])]))}
        {card('Document collection', <><div className="row" style={{ marginBottom: 8 }}><span className="mono" style={{ fontSize: 22 }}>{docs.length ? Math.round((100 * recv) / docs.length) : 0}%</span><span className="small muted">{recv} of {docs.length} received</span></div><HBars items={docBy} /></>,
          () => downloadCsv('documents', [['Document', 'Client', 'Task', 'Status', 'Requested', 'Uploaded'], ...docs.map((x) => [x.name, clientName(a.d, x.client_id), (() => { const t = a.d.tasks.find((k) => k.id === x.task_id); return t ? taskNo(t) : ''; })(), DOC_LABEL[x.status], x.requested_on, x.uploaded_on])]))}
        {card('Staff workload', <HBars items={wl} />, () => downloadCsv('workload', [['Person', 'Role', 'Open tasks', 'Review queue', 'Capacity', 'Utilisation %'], ...a.d.team.map((s) => { const l = staffLoad(a.d, s); return [s.name, s.role, l.prep.length, l.rev.length, s.capacity, Math.round(l.util * 100)]; })]))}
      </div>
      <div className="grid g-dash">
        {card('Client-wise compliance health', health.length ? <div className="tw"><table className="t"><thead><tr><th>Client</th><th className="r">Obligations</th><th className="r">Done</th><th className="r">Overdue</th><th className="r">Docs in</th><th>Health</th></tr></thead><tbody>
          {health.map((x) => <tr key={x.c.id} className="click" onClick={() => ui.go('client', { id: x.c.id })}><td>{x.c.name}</td><td className="r num">{x.n}</td><td className="r num">{x.done}</td><td className="r num" style={x.od ? { color: 'var(--bad)' } : undefined}>{x.od}</td><td className="r num">{x.dp}%</td><td><div className="row" style={{ flexWrap: 'nowrap' }}><Bar pct={x.score} cls={x.score < 60 ? 'bad' : x.score < 80 ? 'warn' : 'ok'} width={80} /><span className="num tiny">{x.score}</span></div></td></tr>)}
        </tbody></table></div> : <Empty title="No clients" text="Add clients to see their health." />,
          () => downloadCsv('client health', [['Client', 'Obligations', 'Done', 'Overdue', 'Docs received %', 'Health'], ...health.map((x) => [x.c.name, x.n, x.done, x.od, x.dp, x.score])]), 'Health score: 100 minus penalties for overdue work, high-risk items and missing documents.')}
        {a.role === 'partner' ? card('Outstanding fees', fees.length ? <HBars items={fees.slice(0, 10).map((x) => ({ label: x.c.name, value: x.amt, text: inrK(x.amt), cls: x.od ? 'bad' : 'warn' }))} /> : <Empty title="Nothing outstanding" text="All invoices are paid." />,
          () => downloadCsv('outstanding fees', [['Invoice', 'Client', 'Period', 'Amount incl. GST', 'Due', 'Status'], ...a.d.invoices.filter((i) => i.status !== 'paid').map((i) => [i.invoice_no, clientName(a.d, i.client_id), i.period, i.amount, i.due_on, invoiceState(i)])]),
          `Total ${inr(fees.reduce((s, x) => s + x.amt, 0))} incl. GST · red bars include overdue invoices.`) : card('Outstanding fees', <div className="small muted">Visible to partners only.</div>)}
      </div>
    </>
  );
}

/* ================= Billing ================= */
export function Billing() {
  const a = useApp(); const ui = useUI(); const run = useRun(); const v = useView();
  const f = ui.f('billing', { status: '', q: '' });
  const all = v.invoices;
  const inv = all.filter((i) => { const st = invoiceState(i); return (!f.status || (f.status === 'outstanding' ? st === 'Unpaid' || st === 'Overdue' : st.toLowerCase() === f.status)) && (!f.q || clientName(a.d, i.client_id).toLowerCase().includes(f.q.toLowerCase())); });
  const sum = (sts: string[]) => all.filter((i) => sts.includes(invoiceState(i))).reduce((s, i) => s + i.amount, 0);
  const remind = (i: typeof all[number]) => { const c = a.d.clients.find((x) => x.id === i.client_id); if (!c) return; void run(async () => { await logMessage(a, { channel: 'email', client_id: c.id, recipient: c.contact_person || c.name, to_addr: c.email, purpose: 'Fee reminder', template: 'custom', body: `Dear ${c.contact_person || c.name},\n\nInvoice ${i.invoice_no} for ${inr(i.amount)} was due on ${fmtD(i.due_on)}.\n\nRegards,\n${a.firm.name}` }); }, 'Fee reminder logged (not sent: no email provider connected).', 'info'); };
  return (
    <>
      <Ph title="Billing" sub="Fee invoices · amounts in ₹ including 18% GST">
        {a.role === 'partner' && <button type="button" className="btn pri" onClick={() => ui.openModal(<NewInvoiceModal />)}><Icon n="plus" />New invoice</button>}
      </Ph>
      <div className="kpis">
        <Kpi label="Billed" value={inrK(sum(['Paid', 'Unpaid', 'Overdue']))} sub={`${all.filter((i) => i.status !== 'draft').length} invoices`} />
        <Kpi label="Collected" value={inrK(sum(['Paid']))} sub={`${all.filter((i) => i.status === 'paid').length} paid`} />
        <Kpi label="Outstanding" value={inrK(sum(['Unpaid', 'Overdue']))} sub="unpaid and overdue" cls="warn" onClick={() => ui.setF('billing', 'status', 'outstanding')} />
        <Kpi label="Overdue" value={inrK(sum(['Overdue']))} sub={`${all.filter((i) => invoiceState(i) === 'Overdue').length} invoices past due`} cls="bad" onClick={() => ui.setF('billing', 'status', 'overdue')} />
      </div>
      <div className="filters">
        {a.role !== 'client' && <input className="inp q" placeholder="Search client" value={f.q} onChange={(e) => ui.setF('billing', 'q', e.target.value)} aria-label="Search client" />}
        <select className="inp" value={f.status} onChange={(e) => ui.setF('billing', 'status', e.target.value)} aria-label="Status"><Opts list={[['outstanding', 'Outstanding'], ['unpaid', 'Unpaid'], ['overdue', 'Overdue'], ['paid', 'Paid'], ...(a.role === 'partner' ? [['draft', 'Draft'] as [string, string]] : [])]} all="All statuses" /></select>
        <span className="tiny muted">{inv.length} shown</span>
      </div>
      <div className="card"><InvoiceTable invoices={inv} compact={a.role === 'client'} actions={a.role === 'partner' ? (i) => i.status !== 'paid' ? <>
        {i.status === 'draft' && <button type="button" className="btn sm" onClick={() => run(async () => { const { error } = await sb().from('invoices').update({ status: 'unpaid', issued_on: new Date().toISOString().slice(0, 10) }).eq('id', i.id); if (error) throw error; }, 'Invoice issued; the client can now see it.')}>Issue</button>}
        <button type="button" className="btn sm" onClick={() => ui.openModal(<RecordPaymentModal inv={i} />)}>Record payment</button>
        <button type="button" className="btn sm ghost" onClick={() => remind(i)}>Remind</button></> : null : undefined} /></div>
    </>
  );
}

/* ================= Compliance rules catalogue ================= */
export function Rules() {
  const a = useApp(); const ui = useUI();
  const f = ui.f('rules', { auth: '', status: '' });
  const rs = a.d.crules.filter((r) => (!f.auth || r.authority === f.auth) && (!f.status || r.status === f.status));
  return (
    <>
      <Ph title="Compliance rules catalogue" sub={`Rules document how due dates are worked out. ${a.d.crules.filter((r) => r.status !== 'approved').length} awaiting a partner's check.`} />
      <Note kind="bad"><b>Check before relying on these.</b> Entries are starting points. They are not legally complete and do not include current notifications, circulars or extensions. A partner should check each against its official source and approve it.</Note>
      <div className="filters">
        <select className="inp" value={f.auth} onChange={(e) => ui.setF('rules', 'auth', e.target.value)} aria-label="Authority"><Opts list={[...new Set(a.d.crules.map((r) => r.authority))]} all="All authorities" /></select>
        <select className="inp" value={f.status} onChange={(e) => ui.setF('rules', 'status', e.target.value)} aria-label="Approval status"><Opts list={Object.entries(RULE_STATUS_LABEL)} all="Any approval status" /></select>
      </div>
      <div className="card">{rs.length ? <div className="tw"><table className="t"><thead><tr><th>Authority</th><th>Form</th><th>Applicability</th><th>Frequency</th><th>Effective</th><th>Official source</th><th>Last verified</th><th>Version</th><th>Approval</th></tr></thead><tbody>
        {rs.map((r) => (
          <tr key={r.id} className="click" onClick={() => ui.openDrawer('rule', r.id)}>
            <td>{r.authority}</td><td><span className="tag">{r.form}</span></td><td className="small" style={{ maxWidth: 260 }}>{r.applicability}</td><td className="small">{r.frequency}</td><td className="num">{fmtDs(r.effective)}</td>
            <td className="small">{r.source ? <a href={r.source} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{(() => { try { return new URL(r.source).hostname; } catch { return r.source; } })()}</a> : '—'}</td>
            <td className="small">{r.verified_on ? fmtD(r.verified_on) : <span style={{ color: 'var(--warn)' }}>Not verified</span>}</td><td className="mono">{r.version}</td><td><Pill label={RULE_STATUS_LABEL[r.status]} /></td>
          </tr>))}
      </tbody></table></div> : <Empty title="No rules" text="Run migration 0005 in Supabase to add the catalogue." />}</div>
    </>
  );
}

/* ================= Integrations ================= */
export function Integrations() {
  const ui = useUI();
  return (
    <>
      <Ph title="Integrations" sub="What is connected today, and what each connection would need." />
      <div className="grid g3">{INTEGRATIONS.map((x) => (
        <div className="card" key={x.id}><div className="card-h"><h3>{x.name}</h3><Pill label={x.state} /></div><div className="card-b">
          <div className="small muted" style={{ marginBottom: 8 }}>{x.vendor}</div>
          <div className="row" style={{ gap: 4, marginBottom: 8 }}>{x.caps.length ? x.caps.map((c) => <span className="tag" key={c}>{c}</span>) : <span className="tiny faint">No supported capabilities</span>}</div>
          {x.note && <p className="tiny muted" style={{ margin: '0 0 10px' }}>{x.note}</p>}
          <button type="button" className="btn sm ghost" onClick={() => ui.openModal(
            <ReqModal title={`${x.name} requirements`} state={x.state} reqs={x.reqs} />)}>Requirements</button>
        </div></div>
      ))}</div>
    </>
  );
}
function ReqModal({ title, state, reqs }: { title: string; state: string; reqs: string[] }) {
  const ui = useUI();
  return (
    <div className="scrim center" onMouseDown={(e) => { if (e.target === e.currentTarget) ui.closeModal(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dh2"><h2>{title}</h2><button type="button" className="iconbtn" onClick={ui.closeModal} aria-label="Close"><Icon n="x" /></button></div>
        <div className="db"><p className="small" style={{ marginTop: 0 }}>Status: <Pill label={state} /></p><ul className="small">{reqs.map((r) => <li key={r}>{r}</li>)}</ul><p className="tiny muted">A connection is only shown as Connected once it actually works.</p></div>
        <div className="df"><button type="button" className="btn pri" onClick={ui.closeModal}>Close</button></div>
      </div>
    </div>
  );
}

/* ================= Settings ================= */
export function SettingsPage() {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const ed = a.role === 'partner';
  const f = ui.f('settings', { tab: ed ? 'firm' : 'notif' });
  const st: Settings | null = a.d.settings;
  const [firm, setFirm] = useState({ name: a.firm.name, city: a.firm.city, short: st?.short_code || '' });
  const [esc, setEsc] = useState({ remind: String(st?.escalation.remind ?? 3), escalate: String(st?.escalation.escalate ?? 1), partner: String(st?.escalation.partner ?? 3), critical: st?.escalation.critical ?? true });
  const tabs: [string, string][] = ed ? [['firm', 'Firm profile'], ['perm', 'Permissions'], ['notif', 'Notification preferences'], ['esc', 'Escalation policies']] : [['notif', 'Notification preferences'], ['perm', 'Permissions']];
  let body: ReactNode = null;
  if (f.tab === 'firm') body = (
    <div className="fg card card-b" style={{ padding: 16 }}>
      <div className="fld full"><label>Firm name <span className="req">*</span></label><input className="inp" value={firm.name} onChange={(e) => setFirm({ ...firm, name: e.target.value })} /></div>
      <div className="fld"><label>City <span className="req">*</span></label><input className="inp" value={firm.city} onChange={(e) => setFirm({ ...firm, city: e.target.value })} /></div>
      <div className="fld"><label>Short code (used in invoice numbers) <span className="req">*</span></label><input className="inp mono" maxLength={4} value={firm.short} onChange={(e) => setFirm({ ...firm, short: e.target.value.toUpperCase() })} /></div>
      <div className="full row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn pri" onClick={() => {
        if (!firm.name.trim() || !firm.city.trim() || !/^[A-Z]{2,4}$/.test(firm.short)) { ui.toast('Firm name, city and a 2–4 letter short code are required.', 'warn'); return; }
        void run(async () => {
          const r1 = await sb().from('firms').update({ name: firm.name.trim(), city: firm.city.trim() }).eq('id', a.firm.id); if (r1.error) throw r1.error;
          const r2 = await sb().from('firm_settings').update({ short_code: firm.short, updated_at: new Date().toISOString() }).eq('firm_id', a.firm.id); if (r2.error) throw r2.error;
        }, 'Firm profile saved.');
      }}>Save profile</button></div>
    </div>);
  if (f.tab === 'perm') body = (
    <><Note kind="warn">These rules are enforced by the database for each request and each firm.</Note>
      <div className="card"><div className="tw"><table className="t"><thead><tr><th>Permission</th><th>Partner</th><th>Staff</th><th>Client user</th></tr></thead><tbody>
        {PERMISSIONS.map((p) => <tr key={p[0]}><td>{p[0]}</td>{p.slice(1).map((v, i) => <td key={i}>{v === '✓' ? <Pill label="Allowed" cls="ok" nodot /> : v ? <Pill label={v} cls="info" nodot /> : <span className="faint">—</span>}</td>)}</tr>)}
      </tbody></table></div></div></>);
  if (f.tab === 'notif') body = (
    <div className="card"><div className="list">{([['email', 'Email notifications', 'Deadline reminders and review requests by email (needs an email provider)'], ['wa', 'WhatsApp alerts', 'Urgent escalations on WhatsApp (needs WhatsApp integration)'], ['inapp', 'In-app alerts', 'Bell notifications inside the app'], ['digest', 'Daily digest', '08:00 summary of due, overdue and review items (needs an email provider)'], ['clientCopy', 'Copy partner on client requests', 'Partner receives a copy of document requests']] as [string, string, string][]).map(([k, l, x]) => (
      <div className="li" key={k}><div className="main-t"><div className="ttl">{l}</div><div className="tiny muted">{x}</div></div>
        <label className="switch"><input type="checkbox" checked={!!st?.notif[k]} disabled={!ed || !st} aria-label={l} onChange={(e) => st && run(async () => { const { error } = await sb().from('firm_settings').update({ notif: { ...st.notif, [k]: e.target.checked }, updated_at: new Date().toISOString() }).eq('firm_id', a.firm.id); if (error) throw error; }, 'Preference saved.')} /><span /></label></div>
    ))}</div>{!ed && <div className="card-b tiny muted">Firm-wide preferences are set by a partner.</div>}</div>);
  if (f.tab === 'esc') body = (
    <div className="fg card card-b" style={{ padding: 16 }}>
      <div className="fld"><label>Remind preparer (days before internal due)</label><input className="inp" type="number" min={1} max={30} value={esc.remind} onChange={(e) => setEsc({ ...esc, remind: e.target.value })} /></div>
      <div className="fld"><label>Escalate to reviewer (days after internal due)</label><input className="inp" type="number" min={0} max={30} value={esc.escalate} onChange={(e) => setEsc({ ...esc, escalate: e.target.value })} /></div>
      <div className="fld"><label>Escalate to partner (days before statutory date)</label><input className="inp" type="number" min={0} max={30} value={esc.partner} onChange={(e) => setEsc({ ...esc, partner: e.target.value })} /></div>
      <label className="chk"><input type="checkbox" checked={esc.critical} onChange={(e) => setEsc({ ...esc, critical: e.target.checked })} />Set priority to Critical on escalation</label>
      <div className="full tiny muted">The reminder setting also updates the “Preparer reminder” automation rule.</div>
      <div className="full row" style={{ justifyContent: 'flex-end' }}><button type="button" className="btn pri" onClick={() => {
        const n = { remind: Math.round(Number(esc.remind)), escalate: Math.round(Number(esc.escalate)), partner: Math.round(Number(esc.partner)), critical: esc.critical };
        if (!(n.remind >= 1 && n.remind <= 30) || !(n.escalate >= 0 && n.escalate <= 30) || !(n.partner >= 0 && n.partner <= 30)) { ui.toast('Days must be between 0 and 30 (reminder at least 1).', 'warn'); return; }
        void run(async () => {
          const r1 = await sb().from('firm_settings').update({ escalation: n, updated_at: new Date().toISOString() }).eq('firm_id', a.firm.id); if (r1.error) throw r1.error;
          const r3 = a.d.rules.find((r) => r.kind === 'remind'); if (r3) { const r2 = await sb().from('automation_rules').update({ days: n.remind }).eq('id', r3.id); if (r2.error) throw r2.error; }
        }, `Escalation policies saved. Preparer reminder rule now uses ${n.remind} days.`);
      }}>Save policies</button></div>
    </div>);
  return (
    <>
      <Ph title="Settings" sub={a.firm.name} />
      <Tabs tabs={tabs} value={f.tab} onChange={(k) => ui.setF('settings', 'tab', k)} />
      {!st && <Note kind="warn">Firm settings are missing. Run migration 0005 in Supabase.</Note>}
      {body}
    </>
  );
}

/* ================= Global search ================= */
export function SearchResults() {
  const a = useApp(); const ui = useUI(); const v = useView();
  const q = ui.search.toLowerCase();
  const cl = a.role === 'client' ? [] : v.clients.filter((c) => `${c.name} ${c.pan} ${c.gstin} ${c.contact_person}`.toLowerCase().includes(q));
  const ts = v.tasks.filter((t) => `${t.title} ${taskNo(t)} ${clientName(a.d, t.client_id)} ${t.filing.ack} ${t.category}`.toLowerCase().includes(q));
  const ds = v.docs.filter((x) => `${x.name} ${x.file_name}`.toLowerCase().includes(q));
  return (
    <>
      <Ph title="Search results" sub={`“${ui.search}” across clients, tasks, filings and documents`}><button type="button" className="btn" onClick={() => ui.setSearch('')}>Clear search</button></Ph>
      {!cl.length && !ts.length && !ds.length && <div className="card"><Empty title="No matches" text="Try a client name, a form such as GSTR-3B, a task number like T-1004, or an acknowledgement reference." /></div>}
      {cl.length > 0 && <div className="card" style={{ marginBottom: 14 }}><div className="card-h"><h3>Clients <span className="faint">{cl.length}</span></h3></div><div className="list">{cl.slice(0, 8).map((c) => <div className="li click" key={c.id} onClick={() => { ui.setSearch(''); ui.go('client', { id: c.id }); }}><div className="main-t"><div className="ttl">{c.name}</div><div className="tiny muted">{c.entity_type} · {maskPan(c.pan)}</div></div><Pill label={CLIENT_STATUS_LABEL[c.status]} /></div>)}</div></div>}
      {ts.length > 0 && <div className="card" style={{ marginBottom: 14 }}><div className="card-h"><h3>Tasks &amp; filings <span className="faint">{ts.length}</span></h3></div><div className="list">{ts.slice(0, 12).map((t) => <div className="li click" key={t.id} onClick={() => ui.openDrawer(a.role === 'client' ? 'filing' : 'task', t.id)}><span className="tag">{taskNo(t)}</span><div className="main-t"><div className="ttl">{t.title}</div><div className="tiny muted">{clientName(a.d, t.client_id)}</div></div><Pill label={STATUS_LABEL[t.status]} /></div>)}</div></div>}
      {ds.length > 0 && <div className="card"><div className="card-h"><h3>Documents <span className="faint">{ds.length}</span></h3></div><div className="list">{ds.slice(0, 8).map((x) => <div className="li" key={x.id}><div className="main-t"><div className="ttl">{x.name}</div><div className="tiny muted">{clientName(a.d, x.client_id)}</div></div><Pill label={DOC_LABEL[x.status]} /></div>)}</div></div>}
    </>
  );
}

export { isReviewerRole, myName, CHANNEL_LABEL, dDiff };
