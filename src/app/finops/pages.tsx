/* Financial Operations add-on: Control Tower, PF & ESI manager, contribution rules and the add-on switch. */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useApp, sb, memberName, clientName, isReviewerRole, isPartnerRole } from '../store';
import { useUI, Pill, Who, DueCell, Empty, Note, Opts, Tabs, Modal, Field, Confirm, Stack, RiskTag, C } from '../ui';
import { useRun } from '../parts';
import { Ph, Kpi } from '../pages1';
import { fmtD, fmtDT, inr } from '../util';
import type { Client } from '../types';
import {
  PERIOD_LABEL, PERIOD_CLS, APPL_LABEL, isDone, foRisk, foRiskReason, monthLabel, prevMonth, thisMonth, rpc,
} from './store';
import type { FoPeriod, FoProfile, FoRule, PeriodStatus, Applicability } from './store';
import { EMPTY_PARAMS, validateParams } from './engine';
import type { RuleParams, Scheme, RuleComponent, WageBasis } from './engine';

export const FoPill = ({ s }: { s: PeriodStatus }) => <Pill label={PERIOD_LABEL[s]} cls={PERIOD_CLS[s]} />;
const BASIS_LABEL: Record<WageBasis, string> = { gross_wages: 'Gross wages', pf_wages: 'PF wages column', esi_wages: 'ESI wages column' };

/* ================= Add-on introduction (shown while the add-on is off) ================= */
export function FoIntro() {
  const a = useApp(); const run = useRun();
  const partner = a.role === 'partner';
  return (
    <>
      <Ph title="Financial Operations add-on" sub="Monthly PF and ESI work for your payroll clients, with review and a full audit trail." />
      {!a.d.fo.installed && <Note kind="warn">The add-on's database tables are not installed yet. Run <span className="mono">supabase/migrations/0008_financial_operations.sql</span> in the Supabase SQL Editor, then reload this page.</Note>}
      <div className="grid g3">
        {([
          ['Control Tower', 'Every client\'s PF and ESI obligation for the month in one view, with risk, owner and what is blocking it.'],
          ['PF & ESI manager', 'Upload the client\'s payroll as CSV, check it for problems, and calculate contributions under a rule version your firm has approved.'],
          ['Review and audit', 'The preparer cannot review their own calculation. Every upload, calculation and decision is kept as a permanent record.'],
        ] as [string, string][]).map(([t, x]) => <div className="card card-b" key={t}><div className="strong" style={{ marginBottom: 4 }}>{t}</div><div className="small muted">{x}</div></div>)}
      </div>
      <div className="card card-b" style={{ marginTop: 14 }}>
        <div className="strong" style={{ marginBottom: 6 }}>What this add-on does not do</div>
        <div className="small muted">It does not log in to the EPFO or ESIC portals, generate challans or make payments. It records and checks the work your team does. Contribution rates and ceilings are not built in: a partner enters them from the official notification and approves each version.</div>
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        {partner ? <button type="button" className="btn pri" disabled={!a.d.fo.installed} onClick={() => void run(() => rpc('fo_set_addon', { p_firm: a.firm.id, p_enabled: true }), 'Financial Operations is on for your firm.')}>Turn on for {a.firm.name}</button>
          : <span className="small muted">Ask a partner to turn this add-on on.</span>}
      </div>
    </>
  );
}

/** Settings → Add-ons tab. */
export function AddonsTab() {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const fo = a.d.fo;
  return (
    <div className="card"><div className="list">
      <div className="li"><div className="main-t"><div className="ttl">Financial Operations</div><div className="tiny muted">PF and ESI calculations, review and audit trail. {fo.installed ? '' : 'Database tables not installed: run migration 0008.'}</div></div>
        <label className="switch"><input type="checkbox" aria-label="Financial Operations" checked={fo.enabled} disabled={a.role !== 'partner' || !fo.installed} onChange={(e) => {
          const on = e.target.checked;
          if (on) void run(() => rpc('fo_set_addon', { p_firm: a.firm.id, p_enabled: true }), 'Financial Operations turned on.');
          else ui.openModal(<Confirm title="Turn off Financial Operations?" text="The menu section is hidden and its records become unreadable until it is turned on again. Nothing is deleted." ok="Turn off" danger onOk={() => void run(() => rpc('fo_set_addon', { p_firm: a.firm.id, p_enabled: false }), 'Financial Operations turned off.')} />);
        }} /><span /></label></div>
    </div>{a.role !== 'partner' && <div className="card-b tiny muted">Add-ons are switched on by a partner.</div>}</div>
  );
}

/* ================= Control Tower ================= */
export function FoOverview() {
  const a = useApp(); const ui = useUI();
  const fo = a.d.fo;
  const months = useMemo(() => [...new Set([thisMonth(), prevMonth(), ...fo.periods.map((p) => p.period)])].sort().reverse(), [fo.periods]);
  const f = ui.f('fo-overview', { month: prevMonth(), scheme: '', status: '', person: '', risk: '', client: '' });
  const ps = fo.periods.filter((p) => p.period === f.month && (!f.scheme || p.scheme === f.scheme) && (!f.status || p.status === f.status)
    && (!f.client || p.client_id === f.client) && (!f.person || p.preparer_id === f.person || p.reviewer_id === f.person) && (!f.risk || foRisk(p) === f.risk));
  const open = ps.filter((p) => !isDone(p));
  const overdue = open.filter((p) => p.due_date && p.due_date < new Date().toISOString().slice(0, 10));
  const payable = ps.filter((p) => p.status !== 'not_applicable').reduce((x, p) => x + p.total_payable, 0);
  const unverified = fo.profiles.filter((p) => !p.verified_at).length;
  const noSetup = a.d.clients.filter((c) => c.status !== 'inactive' && !fo.profiles.some((p) => p.client_id === c.id)).length;
  const approvedRules = fo.rules.filter((r) => r.status === 'approved');
  const priority = [...open].sort((x, y) => ({ High: 0, Medium: 1, Low: 2 })[foRisk(x)] - ({ High: 0, Medium: 1, Low: 2 })[foRisk(y)] || (x.due_date || '9').localeCompare(y.due_date || '9'));
  const byStatus = (Object.keys(PERIOD_LABEL) as PeriodStatus[]).map((s) => ({ s, n: ps.filter((p) => p.status === s).length })).filter((x) => x.n);
  const colour = (s: PeriodStatus) => ({ ok: C.ok, warn: C.warn, bad: C.bad, info: C.a, vio: C.vio, '': C.mute } as Record<string, string>)[PERIOD_CLS[s]];
  const set = (k: string, v: string) => ui.setF('fo-overview', k, v);
  return (
    <>
      <Ph title="Financial Ops Control Tower" sub={`PF and ESI obligations for ${monthLabel(f.month)} wages.`}>
        <button type="button" className="btn" onClick={() => ui.go('fo-pfesi', { tab: 'setup' })}>Client setup</button>
        <button type="button" className="btn pri" onClick={() => ui.openModal(<GenerateModal month={f.month} />)}>Create obligations</button>
      </Ph>
      {!approvedRules.length && <Note kind="warn">No contribution rule version is approved yet, so nothing can be calculated. {a.role === 'partner' || (a.me && isReviewerRole(a.me)) ? <button type="button" className="linkbtn" onClick={() => ui.go('fo-rules')}>Set up contribution rules</button> : 'Ask a manager or partner to set them up.'}</Note>}
      {(unverified > 0 || noSetup > 0) && <Note>{noSetup > 0 && <>{noSetup} active client(s) have no PF / ESI setup. </>}{unverified > 0 && <>{unverified} setup(s) await a reviewer's verification. </>}Obligations are created only for verified clients. <button type="button" className="linkbtn" onClick={() => ui.go('fo-pfesi', { tab: 'setup' })}>Open client setup</button></Note>}
      <div className="filters">
        <select className="inp" value={f.month} onChange={(e) => set('month', e.target.value)} aria-label="Wage month">{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
        <select className="inp" value={f.scheme} onChange={(e) => set('scheme', e.target.value)} aria-label="Scheme"><Opts list={['PF', 'ESI']} all="PF and ESI" /></select>
        <select className="inp" value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="Status"><Opts list={Object.entries(PERIOD_LABEL)} all="Any status" /></select>
        <select className="inp" value={f.client} onChange={(e) => set('client', e.target.value)} aria-label="Client"><Opts list={a.d.clients.filter((c) => fo.profiles.some((p) => p.client_id === c.id)).map((c) => [c.id, c.name])} all="All clients" /></select>
        <select className="inp" value={f.person} onChange={(e) => set('person', e.target.value)} aria-label="Person"><Opts list={a.d.team.filter((m) => m.active).map((m) => [m.id, m.name])} all="Anyone" /></select>
        <select className="inp" value={f.risk} onChange={(e) => set('risk', e.target.value)} aria-label="Risk"><Opts list={['High', 'Medium', 'Low']} all="Any risk" /></select>
      </div>
      <div className="kpis">
        <Kpi label="Obligations" value={ps.length} sub={`${open.length} still open`} onClick={() => set('status', '')} />
        <Kpi label="Awaiting payroll data" value={ps.filter((p) => p.status === 'awaiting_data').length} sub="Chase the client's payroll contact" cls={ps.some((p) => p.status === 'awaiting_data') ? 'warn' : ''} onClick={() => set('status', 'awaiting_data')} />
        <Kpi label="Waiting for review" value={ps.filter((p) => p.status === 'in_review').length} sub="Manager or partner to check" onClick={() => set('status', 'in_review')} />
        <Kpi label="Past due date" value={overdue.length} sub={`Total payable ${inr(payable)}`} cls={overdue.length ? 'bad' : ''} onClick={() => set('risk', 'High')} />
      </div>
      <div className="grid g-dash">
        <div className="card">
          <div className="card-h"><h3>Needs attention first</h3><span className="tiny muted">Highest risk, then nearest due date</span></div>
          {priority.length ? <div className="tw"><table className="t"><thead><tr><th>Client</th><th>Scheme</th><th>Status</th><th>Due</th><th>Why</th><th>Preparer</th><th>Risk</th></tr></thead><tbody>
            {priority.slice(0, 12).map((p) => (
              <tr key={p.id} className="click" onClick={() => ui.go('fo-period', { id: p.id })}>
                <td className="strong">{clientName(a.d, p.client_id)}</td><td><span className="tag">{p.scheme}</span></td><td><FoPill s={p.status} /></td>
                <td><DueCell date={p.due_date} /></td><td className="small">{foRiskReason(p)}</td><td><Who name={memberName(a.d, p.preparer_id)} /></td><td><RiskTag r={foRisk(p)} /></td>
              </tr>))}
          </tbody></table></div> : <Empty title={ps.length ? 'Nothing open' : 'No obligations for this month'} text={ps.length ? 'Every obligation in this view is reviewed or closed.' : 'Verify client setups, then create obligations for the month.'} />}
        </div>
        <div className="card">
          <div className="card-h"><h3>Where the month stands</h3></div>
          <div className="card-b">
            {byStatus.length ? <><Stack parts={byStatus.map((x) => ({ n: x.n, color: colour(x.s), title: PERIOD_LABEL[x.s] }))} height={12} />
              <div className="list" style={{ marginTop: 10 }}>{byStatus.map((x) => <div key={x.s} className="row" style={{ padding: '4px 0' }}><FoPill s={x.s} /><span className="grow" /><span className="num">{x.n}</span></div>)}</div></>
              : <div className="small muted">No obligations yet.</div>}
            <div className="sec" style={{ marginTop: 14, marginBottom: 0 }}><h4>Recent activity</h4>
              {fo.events.slice(0, 6).map((e) => <div key={e.id} className="small" style={{ padding: '3px 0' }}><b>{e.actor_name || 'System'}</b> {e.action.replace(/_/g, ' ')}{e.client_id ? ` · ${clientName(a.d, e.client_id)}` : ''}<div className="tiny faint">{e.detail ? e.detail + ' · ' : ''}{fmtDT(e.created_at)}</div></div>)}
              {!fo.events.length && <div className="small muted">Nothing yet.</div>}</div>
          </div>
        </div>
      </div>
      {a.role === 'partner' && <div className="tiny faint" style={{ marginTop: 10 }}>Turn the add-on off in Settings → Add-ons.</div>}
    </>
  );
}

function GenerateModal({ month: m0 }: { month: string }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const [month, setMonth] = useState(m0.slice(0, 7)); const [scheme, setScheme] = useState('');
  const eligible = a.d.fo.profiles.filter((p) => p.verified_at && ((scheme !== 'ESI' && p.pf_status === 'applicable') || (scheme !== 'PF' && p.esi_status === 'applicable')));
  return (
    <Modal title="Create obligations for a wage month" footer={<>
      <button type="button" className="btn" onClick={ui.closeModal}>Cancel</button>
      <button type="button" className="btn pri" disabled={!/^\d{4}-\d{2}$/.test(month)} onClick={async () => {
        let n = 0;
        const ok = await run(async () => { n = Number(await rpc('fo_generate_periods', { p_firm: a.firm.id, p_month: month + '-01', p_scheme: scheme || null })); });
        if (ok) { ui.closeModal(); ui.setF('fo-overview', 'month', month + '-01'); ui.toast(n ? `${n} obligation(s) created.` : 'Nothing new: obligations for this month already exist.', n ? 'ok' : 'info'); }
      }}>Create</button></>}>
      <div className="fg">
        <Field label="Wage month" req><input className="inp" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <Field label="Scheme"><select className="inp" value={scheme} onChange={(e) => setScheme(e.target.value)}><Opts list={['PF', 'ESI']} all="PF and ESI" /></select></Field>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>{eligible.length} verified client(s) qualify. Due dates come from the due day set on each client's setup; clients without one get no due date until you set it. Existing obligations are left as they are.</p>
    </Modal>
  );
}

/* ================= PF & ESI manager ================= */
export function FoPfEsi() {
  const a = useApp(); const ui = useUI();
  const fo = a.d.fo;
  const f = ui.f('fo-pfesi', { tab: ui.params.tab || 'obl', q: '', scheme: '', status: '' });
  const tabs: [string, string, number][] = [['obl', 'Obligations', fo.periods.length], ['setup', 'Client setup', fo.profiles.length], ['log', 'Audit trail', fo.events.length]];
  let body: ReactNode;
  if (f.tab === 'setup') body = <SetupTab />;
  else if (f.tab === 'log') body = (
    <div className="card">{fo.events.length ? <div className="tw"><table className="t"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Client</th><th>Detail</th></tr></thead><tbody>
      {fo.events.map((e) => <tr key={e.id}><td className="num small">{fmtDT(e.created_at)}</td><td>{e.actor_name || 'System'}</td><td><span className="tag">{e.entity}</span> {e.action.replace(/_/g, ' ')}</td><td>{e.client_id ? clientName(a.d, e.client_id) : '—'}</td><td className="small">{e.detail}</td></tr>)}
    </tbody></table></div> : <Empty title="No activity yet" text="Every upload, calculation and decision is recorded here and cannot be edited." />}
      <div className="card-b tiny muted">The audit trail is append-only: the database refuses edits and deletions. Showing the latest 300 entries.</div></div>);
  else {
    const q = f.q.toLowerCase();
    const ps = fo.periods.filter((p) => (!f.scheme || p.scheme === f.scheme) && (!f.status || p.status === f.status) && (!q || clientName(a.d, p.client_id).toLowerCase().includes(q)));
    body = (<>
      <div className="filters">
        <input className="inp q" placeholder="Search client" value={f.q} onChange={(e) => ui.setF('fo-pfesi', 'q', e.target.value)} aria-label="Search client" />
        <select className="inp" value={f.scheme} onChange={(e) => ui.setF('fo-pfesi', 'scheme', e.target.value)} aria-label="Scheme"><Opts list={['PF', 'ESI']} all="PF and ESI" /></select>
        <select className="inp" value={f.status} onChange={(e) => ui.setF('fo-pfesi', 'status', e.target.value)} aria-label="Status"><Opts list={Object.entries(PERIOD_LABEL)} all="Any status" /></select>
      </div>
      <div className="card"><PeriodTable ps={ps} /></div></>);
  }
  return (
    <>
      <Ph title="PF & ESI" sub="Monthly provident fund and employees' state insurance work for each client.">
        <button type="button" className="btn" onClick={() => ui.openModal(<GenerateModal month={prevMonth()} />)}>Create obligations</button>
        <button type="button" className="btn pri" onClick={() => ui.openModal(<ProfileModal />)}>Set up a client</button>
      </Ph>
      <Tabs tabs={tabs} value={f.tab} onChange={(k) => ui.setF('fo-pfesi', 'tab', k)} />
      {body}
    </>
  );
}

export function PeriodTable({ ps, noClient }: { ps: FoPeriod[]; noClient?: boolean }) {
  const a = useApp(); const ui = useUI();
  if (!ps.length) return <Empty title="No obligations" text="Create obligations for a wage month once client setups are verified." />;
  return (
    <div className="tw"><table className="t"><thead><tr>
      {!noClient && <th>Client</th>}<th>Scheme</th><th>Wage month</th><th>Status</th><th>Due</th><th>Employees</th><th style={{ textAlign: 'right' }}>Payable</th><th>Exceptions</th><th>Preparer</th><th className="hide-sm">Reviewer</th><th>Risk</th>
    </tr></thead><tbody>
      {ps.map((p) => (
        <tr key={p.id} className="click" onClick={() => ui.go('fo-period', { id: p.id })}>
          {!noClient && <td className="strong">{clientName(a.d, p.client_id)}</td>}<td><span className="tag">{p.scheme}</span></td><td className="num">{monthLabel(p.period)}</td>
          <td><FoPill s={p.status} /></td><td><DueCell date={p.due_date} closed={isDone(p)} /></td><td className="num">{p.employee_count || '—'}</td>
          <td className="num" style={{ textAlign: 'right' }}>{p.current_calc_id ? inr(p.total_payable) : '—'}</td>
          <td>{p.exceptions_count ? <Pill label={String(p.exceptions_count)} cls="warn" nodot /> : <span className="faint">—</span>}</td>
          <td><Who name={memberName(a.d, p.preparer_id)} /></td><td className="hide-sm"><Who name={memberName(a.d, p.reviewer_id)} /></td><td><RiskTag r={foRisk(p)} /></td>
        </tr>))}
    </tbody></table></div>
  );
}

const ApplPill = ({ s }: { s: Applicability }) => <Pill label={APPL_LABEL[s]} cls={s === 'applicable' ? 'ok' : s === 'unknown' ? 'warn' : ''} nodot />;

function SetupTab() {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const fo = a.d.fo;
  const reviewer = a.role === 'partner' || (!!a.me && isReviewerRole(a.me));
  const missing = a.d.clients.filter((c) => c.status !== 'inactive' && !fo.profiles.some((p) => p.client_id === c.id));
  return (
    <>
      <Note>Confirm each client's PF and ESI applicability from their registration and headcount. A manager or partner then verifies it; changing applicability later clears the verification.</Note>
      <div className="card">{fo.profiles.length ? <div className="tw"><table className="t"><thead><tr><th>Client</th><th>PF</th><th>ESI</th><th>Due days</th><th>Payroll contact</th><th>Preparer</th><th>Reviewer</th><th>Verified</th><th /></tr></thead><tbody>
        {fo.profiles.map((p) => { const c = a.d.clients.find((x) => x.id === p.client_id); return (
          <tr key={p.id}>
            <td className="strong">{c?.name || '—'}</td><td><ApplPill s={p.pf_status} />{p.pf_code && <div className="tiny mono faint">{maskCode(p.pf_code)}</div>}</td>
            <td><ApplPill s={p.esi_status} />{p.esi_code && <div className="tiny mono faint">{maskCode(p.esi_code)}</div>}</td>
            <td className="small">{p.pf_status === 'applicable' ? `PF: ${p.pf_due_day ?? 'not set'}` : ''}{p.pf_status === 'applicable' && p.esi_status === 'applicable' ? ' · ' : ''}{p.esi_status === 'applicable' ? `ESI: ${p.esi_due_day ?? 'not set'}` : ''}</td>
            <td className="small">{p.payroll_contact || '—'}</td><td><Who name={memberName(a.d, p.preparer_id)} /></td><td><Who name={memberName(a.d, p.reviewer_id)} /></td>
            <td className="small">{p.verified_at ? <>{p.verified_by}<div className="tiny faint">{fmtD(p.verified_at.slice(0, 10))}</div></> : <span style={{ color: 'var(--warn)' }}>Not verified</span>}</td>
            <td><div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
              <button type="button" className="btn sm" onClick={() => ui.openModal(<ProfileModal p={p} />)}>Edit</button>
              {!p.verified_at && reviewer && <button type="button" className="btn sm pri" onClick={() => void run(() => rpc('fo_verify_profile', { p_profile: p.id }), `${c?.name || 'Client'} verified.`)}>Verify</button>}
            </div></td>
          </tr>); })}
      </tbody></table></div> : <Empty title="No clients set up" text="Set up the clients whose payroll your firm handles." action={<button type="button" className="btn pri" onClick={() => ui.openModal(<ProfileModal />)}>Set up a client</button>} />}</div>
      {missing.length > 0 && <div className="tiny muted" style={{ marginTop: 8 }}>{missing.length} active client(s) not set up: {missing.slice(0, 6).map((c) => c.name).join(', ')}{missing.length > 6 ? '…' : ''}</div>}
    </>
  );
}
const maskCode = (v: string) => (v.length <= 4 ? v : '••••' + v.slice(-4));

function ProfileModal({ p }: { p?: FoProfile }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const avail: Client[] = a.d.clients.filter((c) => c.id === p?.client_id || !a.d.fo.profiles.some((x) => x.client_id === c.id));
  const [v, setV] = useState({
    client_id: p?.client_id || '', pf_status: p?.pf_status || 'unknown', esi_status: p?.esi_status || 'unknown', pf_code: p?.pf_code || '', esi_code: p?.esi_code || '',
    payroll_contact: p?.payroll_contact || '', payroll_email: p?.payroll_email || '', preparer_id: p?.preparer_id || '', reviewer_id: p?.reviewer_id || '',
    pf_due_day: p?.pf_due_day != null ? String(p.pf_due_day) : '', esi_due_day: p?.esi_due_day != null ? String(p.esi_due_day) : '', notes: p?.notes || '',
  });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof v, x: string) => setV({ ...v, [k]: x });
  const team = a.d.team.filter((m) => m.active);
  const day = (x: string) => (x.trim() === '' ? null : Math.round(Number(x)));
  const save = () => {
    if (!v.client_id) { setErr('Choose a client.'); return; }
    for (const [k, l] of [['pf_due_day', 'PF due day'], ['esi_due_day', 'ESI due day']] as const) { const d = day(v[k]); if (d !== null && !(d >= 1 && d <= 31)) { setErr(`${l} must be between 1 and 31.`); return; } }
    if (v.preparer_id && v.preparer_id === v.reviewer_id) { setErr('The preparer and reviewer must be different people.'); return; }
    if (v.reviewer_id && !team.some((m) => m.id === v.reviewer_id && isReviewerRole(m))) { setErr('The reviewer must be a manager or partner.'); return; }
    const row = { firm_id: a.firm.id, client_id: v.client_id, pf_status: v.pf_status, esi_status: v.esi_status, pf_code: v.pf_code.trim(), esi_code: v.esi_code.trim(),
      payroll_contact: v.payroll_contact.trim(), payroll_email: v.payroll_email.trim(), preparer_id: v.preparer_id || null, reviewer_id: v.reviewer_id || null,
      pf_due_day: day(v.pf_due_day), esi_due_day: day(v.esi_due_day), notes: v.notes.trim() };
    void run(async () => {
      const r = p ? await sb().from('fo_profiles').update(row).eq('id', p.id) : await sb().from('fo_profiles').insert(row);
      if (r.error) throw r.error;
      const changed = p && (p.pf_status !== v.pf_status || p.esi_status !== v.esi_status);
      const ev = await sb().from('fo_events').insert({ firm_id: a.firm.id, client_id: v.client_id, entity: 'profile', entity_id: p?.id ?? null, action: p ? (changed ? 'applicability_changed' : 'updated') : 'created',
        detail: `PF ${APPL_LABEL[v.pf_status as Applicability].toLowerCase()}, ESI ${APPL_LABEL[v.esi_status as Applicability].toLowerCase()}`, actor_name: a.me?.name || a.email, actor_id: a.uid });
      if (ev.error) throw ev.error;
    }, p ? 'Client setup saved.' : 'Client set up. A manager or partner needs to verify it.').then((ok) => ok && ui.closeModal());
  };
  return (
    <Modal title={p ? `PF / ESI setup · ${clientName(a.d, p.client_id)}` : 'Set up a client for PF / ESI'} wide footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" onClick={save}>Save</button></>}>
      {err && <Note kind="bad">{err}</Note>}
      {p?.verified_at && <Note kind="warn">Changing PF or ESI applicability clears the verification by {p.verified_by}.</Note>}
      <div className="fg">
        <Field label="Client" req full><select className="inp" value={v.client_id} disabled={!!p} onChange={(e) => set('client_id', e.target.value)}><Opts list={avail.map((c) => [c.id, c.name])} all="Choose a client" /></select></Field>
        <Field label="PF applicability" req><select className="inp" value={v.pf_status} onChange={(e) => set('pf_status', e.target.value)}><Opts list={Object.entries(APPL_LABEL)} /></select></Field>
        <Field label="PF establishment code"><input className="inp mono" value={v.pf_code} onChange={(e) => set('pf_code', e.target.value.toUpperCase())} placeholder="As registered with EPFO" /></Field>
        <Field label="ESI applicability" req><select className="inp" value={v.esi_status} onChange={(e) => set('esi_status', e.target.value)}><Opts list={Object.entries(APPL_LABEL)} /></select></Field>
        <Field label="ESI employer code"><input className="inp mono" value={v.esi_code} onChange={(e) => set('esi_code', e.target.value.toUpperCase())} placeholder="As registered with ESIC" /></Field>
        <Field label="PF due day of the following month"><input className="inp" type="number" min={1} max={31} value={v.pf_due_day} onChange={(e) => set('pf_due_day', e.target.value)} placeholder="From the official notification" /></Field>
        <Field label="ESI due day of the following month"><input className="inp" type="number" min={1} max={31} value={v.esi_due_day} onChange={(e) => set('esi_due_day', e.target.value)} placeholder="From the official notification" /></Field>
        <Field label="Client payroll contact"><input className="inp" value={v.payroll_contact} onChange={(e) => set('payroll_contact', e.target.value)} /></Field>
        <Field label="Payroll contact email"><input className="inp" type="email" value={v.payroll_email} onChange={(e) => set('payroll_email', e.target.value)} /></Field>
        <Field label="Preparer"><select className="inp" value={v.preparer_id} onChange={(e) => set('preparer_id', e.target.value)}><Opts list={team.map((m) => [m.id, `${m.name} · ${m.role}`])} all="Not assigned" /></select></Field>
        <Field label="Reviewer (manager or partner)"><select className="inp" value={v.reviewer_id} onChange={(e) => set('reviewer_id', e.target.value)}><Opts list={team.filter(isReviewerRole).map((m) => [m.id, `${m.name} · ${m.role}`])} all="Not assigned" /></select></Field>
        <Field label="Notes" full><textarea className="inp" rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </div>
      <p className="tiny muted" style={{ marginBottom: 0 }}>Due days are not filled in for you. Enter them from the current official notification; the obligation's due date is that day of the month after the wage month.</p>
    </Modal>
  );
}

/* ================= Contribution rules ================= */
export function FoRules() {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const rules = a.d.fo.rules;
  const partner = a.role === 'partner';
  const canDraft = partner || (!!a.me && isReviewerRole(a.me));
  const f = ui.f('fo-rules', { scheme: '' });
  const list = rules.filter((r) => !f.scheme || r.scheme === f.scheme);
  return (
    <>
      <Ph title="Contribution rules" sub="Rates, wage ceilings and eligibility limits used for PF and ESI calculations, kept as numbered versions.">
        {canDraft && <button type="button" className="btn pri" onClick={() => ui.openModal(<RuleModal />)}>New rule version</button>}
      </Ph>
      <Note kind="bad"><b>Nothing is pre-filled.</b> Enter each value from the current EPFO or ESIC notification and cite it. A partner approves a version before it can be used; approved versions cannot be edited, only replaced by a new version.</Note>
      <div className="filters"><select className="inp" value={f.scheme} onChange={(e) => ui.setF('fo-rules', 'scheme', e.target.value)} aria-label="Scheme"><Opts list={['PF', 'ESI']} all="PF and ESI" /></select></div>
      <div className="card">{list.length ? <div className="tw"><table className="t"><thead><tr><th>Scheme</th><th>Version</th><th>Effective from</th><th>Components</th><th>Wage ceiling</th><th>Eligibility limit</th><th>Source</th><th>Status</th><th /></tr></thead><tbody>
        {list.map((r) => (
          <tr key={r.id}>
            <td><span className="tag">{r.scheme}</span></td><td><span className="mono">v{r.version}</span>{r.label && <div className="tiny muted">{r.label}</div>}</td><td className="num">{fmtD(r.effective_from)}</td>
            <td className="small">{r.params.components.map((c) => `${c.label} ${c.rate}%${c.capped ? ' (capped)' : ''} · ${c.payer}`).join('; ') || '—'}</td>
            <td className="num">{r.params.wage_ceiling != null ? inr(r.params.wage_ceiling) : '—'}</td><td className="num">{r.params.eligibility.max_wage != null ? inr(r.params.eligibility.max_wage) : '—'}</td>
            <td className="small" style={{ maxWidth: 200 }}>{r.source_ref || <span style={{ color: 'var(--warn)' }}>Missing</span>}</td>
            <td><Pill label={r.status === 'approved' ? 'Approved' : r.status === 'retired' ? 'Retired' : 'Draft'} cls={r.status === 'approved' ? 'ok' : r.status === 'draft' ? 'warn' : ''} />{r.approved_by && <div className="tiny faint">{r.approved_by}</div>}</td>
            <td><div className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
              {r.status === 'draft' && canDraft && <button type="button" className="btn sm" onClick={() => ui.openModal(<RuleModal r={r} />)}>Edit</button>}
              {r.status === 'draft' && partner && <button type="button" className="btn sm pri" onClick={() => ui.openModal(<Confirm title={`Approve ${r.scheme} v${r.version}?`} text={`Confirm you have checked every value against ${r.source_ref || 'the official source'}. Once approved, this version cannot be changed.`} ok="Approve" onOk={() => void run(() => rpc('fo_approve_rule', { p_rule: r.id }), 'Rule version approved.')} />)}>Approve</button>}
              {r.status === 'draft' && canDraft && <button type="button" className="btn sm ghost" onClick={() => ui.openModal(<Confirm title="Delete draft?" text="This draft has not been approved and will be removed." ok="Delete" danger onOk={() => void run(async () => { const { error } = await sb().from('fo_rule_versions').delete().eq('id', r.id); if (error) throw error; }, 'Draft deleted.')} />)}>Delete</button>}
              {r.status === 'approved' && partner && <button type="button" className="btn sm ghost" onClick={() => ui.openModal(<Confirm title={`Retire ${r.scheme} v${r.version}?`} text="It stays on record for past calculations but cannot be chosen for new ones." ok="Retire" onOk={() => void run(() => rpc('fo_retire_rule', { p_rule: r.id }), 'Rule version retired.')} />)}>Retire</button>}
              {canDraft && r.status !== 'draft' && <button type="button" className="btn sm ghost" onClick={() => ui.openModal(<RuleModal copy={r} />)}>Copy as new</button>}
            </div></td>
          </tr>))}
      </tbody></table></div> : <Empty title="No rule versions" text={canDraft ? 'Create the first PF and ESI versions from the official notifications.' : 'A manager or partner sets these up.'} />}</div>
    </>
  );
}

const blankComp = (): RuleComponent => ({ code: '', label: '', payer: 'employee', rate: 0, capped: false });

function RuleModal({ r, copy }: { r?: FoRule; copy?: FoRule }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const src = r || copy;
  const [scheme, setScheme] = useState<Scheme>(src?.scheme || 'PF');
  const [meta, setMeta] = useState({ label: r?.label || '', effective_from: r?.effective_from || '', source_ref: r?.source_ref || '' });
  const [p, setP] = useState<RuleParams>(src ? JSON.parse(JSON.stringify(src.params)) : EMPTY_PARAMS('PF'));
  const [rates, setRates] = useState<string[]>(src ? src.params.components.map((c) => String(c.rate)) : []);
  const [ceil, setCeil] = useState(src?.params.wage_ceiling != null ? String(src.params.wage_ceiling) : '');
  const [elig, setElig] = useState(src?.params.eligibility.max_wage != null ? String(src.params.eligibility.max_wage) : '');
  const [errs, setErrs] = useState<string[]>([]);
  const numOrNull = (x: string) => (x.trim() === '' ? null : Number(x.replace(/,/g, '')));
  const build = (): RuleParams => ({ ...p, wage_ceiling: numOrNull(ceil), eligibility: { ...p.eligibility, max_wage: numOrNull(elig) }, components: p.components.map((c, i) => ({ ...c, code: c.code.trim().toUpperCase(), label: c.label.trim(), rate: Number(rates[i]) || 0 })) });
  const setComp = (i: number, patch: Partial<RuleComponent>) => setP({ ...p, components: p.components.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const save = () => {
    const params = build();
    const e = validateParams(params);
    if (!meta.effective_from) e.unshift('Enter the date this version takes effect.');
    if (!meta.source_ref.trim()) e.push('Cite the official source (notification or circular number and date).');
    setErrs(e); if (e.length) return;
    void run(async () => {
      if (r) { const { error } = await sb().from('fo_rule_versions').update({ label: meta.label.trim(), effective_from: meta.effective_from, source_ref: meta.source_ref.trim(), params }).eq('id', r.id); if (error) throw error; return; }
      const next = Math.max(0, ...a.d.fo.rules.filter((x) => x.scheme === scheme).map((x) => x.version)) + 1;
      const { data, error } = await sb().from('fo_rule_versions').insert({ firm_id: a.firm.id, scheme, version: next, label: meta.label.trim(), effective_from: meta.effective_from, source_ref: meta.source_ref.trim(), params, created_by: a.me?.name || a.email, created_by_member: a.me?.id ?? null }).select('id').single();
      if (error) throw error;
      await sb().from('fo_events').insert({ firm_id: a.firm.id, entity: 'rule', entity_id: (data as { id: string }).id, action: 'drafted', detail: `${scheme} rule v${next}`, actor_name: a.me?.name || a.email, actor_id: a.uid });
    }, r ? 'Draft saved.' : 'Draft created. A partner needs to approve it.').then((ok) => ok && ui.closeModal());
  };
  return (
    <Modal title={r ? `Edit ${r.scheme} v${r.version} (draft)` : 'New contribution rule version'} wide footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" onClick={save}>Save draft</button></>}>
      {errs.length > 0 && <Note kind="bad">{errs.map((x) => <div key={x}>{x}</div>)}</Note>}
      <div className="fg">
        <Field label="Scheme" req><select className="inp" value={scheme} disabled={!!r} onChange={(e) => { const s = e.target.value as Scheme; setScheme(s); if (!src) setP(EMPTY_PARAMS(s)); }}><Opts list={['PF', 'ESI']} /></select></Field>
        <Field label="Effective from" req><input className="inp" type="date" value={meta.effective_from} onChange={(e) => setMeta({ ...meta, effective_from: e.target.value })} /></Field>
        <Field label="Official source" req full><input className="inp" value={meta.source_ref} onChange={(e) => setMeta({ ...meta, source_ref: e.target.value })} placeholder="Notification / circular number and date" /></Field>
        <Field label="Label" full><input className="inp" value={meta.label} onChange={(e) => setMeta({ ...meta, label: e.target.value })} placeholder="Optional, e.g. the year or what changed" /></Field>
        <Field label="Contributions are worked out on"><select className="inp" value={p.wage_basis} onChange={(e) => setP({ ...p, wage_basis: e.target.value as WageBasis })}><Opts list={Object.entries(BASIS_LABEL)} /></select></Field>
        <Field label="Wage ceiling for capped components (₹)"><input className="inp num" inputMode="decimal" value={ceil} onChange={(e) => setCeil(e.target.value)} placeholder="Leave blank if none" /></Field>
        <Field label="Eligibility is judged on"><select className="inp" value={p.eligibility.basis} onChange={(e) => setP({ ...p, eligibility: { ...p.eligibility, basis: e.target.value as WageBasis } })}><Opts list={Object.entries(BASIS_LABEL)} /></select></Field>
        <Field label="Employees above this wage are not covered (₹)"><input className="inp num" inputMode="decimal" value={elig} onChange={(e) => setElig(e.target.value)} placeholder="Leave blank if everyone is covered" /></Field>
        <Field label="Rounding"><select className="inp" value={p.rounding.mode} onChange={(e) => setP({ ...p, rounding: { ...p.rounding, mode: e.target.value as RuleParams['rounding']['mode'] } })}><Opts list={[['nearest', 'Nearest rupee'], ['up', 'Up to the next rupee'], ['down', 'Down to the rupee']]} /></select></Field>
        <Field label="Round"><select className="inp" value={p.rounding.level} onChange={(e) => setP({ ...p, rounding: { ...p.rounding, level: e.target.value as 'line' | 'total' } })}><Opts list={[['line', 'Each employee\'s amount'], ['total', 'Only the totals']]} /></select></Field>
      </div>
      <div className="sec" style={{ marginTop: 16 }}><h4>Contribution components</h4>
        {p.components.length ? <div className="tw"><table className="t"><thead><tr><th>Code</th><th>Description</th><th>Paid by</th><th>Rate %</th><th>Capped</th><th /></tr></thead><tbody>
          {p.components.map((c, i) => (
            <tr key={i}>
              <td><input className="inp mono" style={{ width: 80 }} value={c.code} onChange={(e) => setComp(i, { code: e.target.value.toUpperCase() })} aria-label="Code" /></td>
              <td><input className="inp" value={c.label} onChange={(e) => setComp(i, { label: e.target.value })} aria-label="Description" /></td>
              <td><select className="inp" value={c.payer} onChange={(e) => setComp(i, { payer: e.target.value as 'employee' | 'employer' })} aria-label="Paid by"><Opts list={[['employee', 'Employee'], ['employer', 'Employer']]} /></select></td>
              <td><input className="inp num" style={{ width: 80 }} inputMode="decimal" value={rates[i] ?? ''} onChange={(e) => setRates(rates.map((x, j) => (j === i ? e.target.value : x)))} aria-label="Rate" /></td>
              <td><label className="chk"><input type="checkbox" checked={c.capped} onChange={(e) => setComp(i, { capped: e.target.checked })} />At ceiling</label></td>
              <td><button type="button" className="btn sm ghost" onClick={() => { setP({ ...p, components: p.components.filter((_, j) => j !== i) }); setRates(rates.filter((_, j) => j !== i)); }}>Remove</button></td>
            </tr>))}
        </tbody></table></div> : <div className="small muted">No components yet. Add one line per contribution head in the notification.</div>}
        <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => { setP({ ...p, components: [...p.components, blankComp()] }); setRates([...rates, '']); }}>Add component</button>
      </div>
    </Modal>
  );
}

export const canReview = (a: ReturnType<typeof useApp>) => a.role === 'partner' || (!!a.me && isReviewerRole(a.me));
export const isPartnerMember = (a: ReturnType<typeof useApp>) => a.role === 'partner' || (!!a.me && isPartnerRole(a.me));
