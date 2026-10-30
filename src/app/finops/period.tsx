/* Financial Operations: one client's PF or ESI obligation for a wage month. */
import { useCallback, useEffect, useState } from 'react';
import { useApp, sb, memberName, clientName, isReviewerRole } from '../store';
import { useUI, Pill, Who, Empty, Note, Opts, Tabs, Modal, Field, Steps, Timeline, RiskTag } from '../ui';
import { useRun } from '../parts';
import { Ph, Kpi } from '../pages1';
import { fmtD, fmtDT, inr, errMsg } from '../util';
import { PERIOD_LABEL, PERIOD_FLOW, isDone, foRisk, foRiskReason, monthLabel, loadPeriodDetail, loadBatchRows, rpc } from './store';
import type { FoPeriod, FoBatch, FoCalc, FoEvent } from './store';
import { FoPill, canReview, isPartnerMember } from './pages';
import { parseCSV, autoMap, toRows, calculate, importedTotals, sha256, FIELDS, FLAG_LABEL, BLOCKING } from './engine';
import type { Mapping, PayrollRow, FieldKey, CalcException, CalcLine } from './engine';

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
type Detail = { batches: FoBatch[]; calcs: FoCalc[]; events: FoEvent[] };

export function FoPeriodPage() {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const p = a.d.fo.periods.find((x) => x.id === ui.params.id);
  const [det, setDet] = useState<Detail | null>(null); const [err, setErr] = useState('');
  const [tab, setTab] = useState('calc'); const [calcId, setCalcId] = useState('');
  const refresh = useCallback(async () => { if (!p) return; try { setDet(await loadPeriodDetail(p.id)); setErr(''); } catch (e) { setErr(errMsg(e)); } }, [p]);
  useEffect(() => { void refresh(); }, [refresh, p?.updated_at]);
  if (!p) return <div className="card"><Empty title="Obligation not found" text="It may belong to another firm or the add-on is switched off." action={<button type="button" className="btn" onClick={() => ui.go('fo-pfesi')}>Back to PF & ESI</button>} /></div>;
  const client = clientName(a.d, p.client_id);
  const reviewer = canReview(a); const partner = isPartnerMember(a);
  const prepByMe = !!a.me && p.prepared_by_member === a.me.id;
  const stage = p.status === 'changes_requested' ? 2 : Math.max(0, PERIOD_FLOW.indexOf(p.status));
  const calc = det?.calcs.find((c) => c.id === (calcId || p.current_calc_id)) || det?.calcs[0] || null;
  const act = (to: string, ok: string, note = '') => run(() => rpc('fo_transition', { p_period: p.id, p_to: to, p_note: note }), ok);
  const canEditData = ['awaiting_data', 'data_received', 'calculated', 'changes_requested'].includes(p.status);
  const team = a.d.team.filter((m) => m.active);
  const assign = (k: 'preparer_id' | 'reviewer_id', v: string) => void run(async () => {
    if (k === 'reviewer_id' && v && v === p.preparer_id) throw new Error('The reviewer must be a different person from the preparer.');
    const { error } = await sb().from('fo_periods').update({ [k]: v || null }).eq('id', p.id); if (error) throw error;
    await sb().from('fo_events').insert({ firm_id: a.firm.id, client_id: p.client_id, entity: 'period', entity_id: p.id, action: k === 'preparer_id' ? 'preparer_assigned' : 'reviewer_assigned', detail: memberName(a.d, v), actor_name: a.me?.name || a.email, actor_id: a.uid });
  }, 'Assignment saved.');

  return (
    <>
      <div className="crumb"><button type="button" className="linkbtn" onClick={() => ui.go('fo-pfesi')}>PF & ESI</button> / {client}</div>
      <Ph title={`${p.scheme} · ${monthLabel(p.period)} wages`} sub={<>{client} · <FoPill s={p.status} /> · <RiskTag r={foRisk(p)} /> <span className="tiny muted">{foRiskReason(p)}</span></>}>
        {canEditData && <button type="button" className="btn" onClick={() => ui.openModal(<UploadModal p={p} onDone={refresh} />)}>Upload payroll</button>}
        {['data_received', 'calculated', 'changes_requested'].includes(p.status) && det && det.batches.length > 0 && <button type="button" className={`btn ${p.status === 'calculated' ? '' : 'pri'}`} onClick={() => ui.openModal(<CalcModal p={p} batches={det.batches} />)}>{p.status === 'calculated' ? 'Recalculate' : 'Calculate'}</button>}
        {p.status === 'changes_requested' && <button type="button" className="btn" onClick={() => void act('data_received', 'Reopened for corrections.')}>Reopen for corrections</button>}
        {p.status === 'calculated' && <button type="button" className="btn pri" onClick={() => void act('in_review', `Sent to ${memberName(a.d, p.reviewer_id)} for review.`)} disabled={!p.reviewer_id} title={p.reviewer_id ? '' : 'Assign a reviewer first'}>Send for review</button>}
        {p.status === 'in_review' && reviewer && !prepByMe && <>
          <button type="button" className="btn" onClick={() => ui.openModal(<NoteModal title="Request changes" label="What needs to change?" ok="Request changes" req onOk={(n) => act('changes_requested', 'Changes requested.', n)} />)}>Request changes</button>
          <button type="button" className="btn pri" onClick={() => ui.openModal(<NoteModal title="Mark reviewed" label="Review note (optional)" ok="Mark reviewed" onOk={(n) => act('reviewed', 'Marked reviewed.', n)} />)}>Mark reviewed</button></>}
        {partner && ['awaiting_data', 'data_received', 'calculated', 'changes_requested'].includes(p.status) && <button type="button" className="btn ghost" onClick={() => ui.openModal(<NoteModal title="Mark not applicable" label="Why does this obligation not apply?" ok="Mark not applicable" req onOk={(n) => act('not_applicable', 'Marked not applicable.', n)} />)}>Not applicable</button>}
        {partner && p.status === 'not_applicable' && <button type="button" className="btn" onClick={() => void act('awaiting_data', 'Reopened.')}>Reopen</button>}
      </Ph>
      {p.status === 'in_review' && prepByMe && <Note>You prepared this calculation, so another manager or partner must review it.</Note>}
      {p.status === 'in_review' && !reviewer && <Note>Waiting for {memberName(a.d, p.reviewer_id)} to review.</Note>}
      {p.review_note && ['changes_requested', 'reviewed'].includes(p.status) && <Note kind={p.status === 'changes_requested' ? 'warn' : undefined}><b>Reviewer's note:</b> {p.review_note}</Note>}
      {p.status !== 'not_applicable' && <div className="card card-b" style={{ marginBottom: 14 }}><Steps labels={['Awaiting data', 'Data received', 'Calculated', 'In review', 'Reviewed']} stage={p.status === 'reviewed' || isDone(p) ? 5 : stage} /></div>}
      <div className="kpis">
        <Kpi label="Employees covered" value={p.employee_count || '—'} sub={calc ? `Version ${calc.version}, ${calc.method}` : 'Not calculated yet'} />
        <Kpi label="Employee share" value={p.current_calc_id ? inr(p.total_employee) : '—'} sub="Deducted from wages" />
        <Kpi label="Employer share" value={p.current_calc_id ? inr(p.total_employer) : '—'} sub="Paid by the client" />
        <Kpi label="Total payable" value={p.current_calc_id ? inr(p.total_payable) : '—'} sub={p.due_date ? `Due ${fmtD(p.due_date)}` : 'No due date set'} cls={p.exceptions_count ? 'warn' : ''} />
      </div>
      {err && <Note kind="bad">{err}</Note>}
      <div className="grid g-dash">
        <div className="card">
          <div className="card-h" style={{ paddingBottom: 0, borderBottom: 0 }}><Tabs value={tab} onChange={setTab} tabs={[['calc', 'Calculation'], ['exc', 'Exceptions', calc?.exceptions.length ?? 0], ['data', 'Payroll uploads', det?.batches.length ?? 0], ['ver', 'Versions', det?.calcs.length ?? 0]]} /></div>
          {!det ? <div className="card-b"><div className="skel" /><div className="skel" style={{ marginTop: 8 }} /></div>
            : tab === 'calc' ? (calc ? <CalcView c={calc} rule={a.d.fo.rules.find((r) => r.id === calc.rule_version_id)?.version} /> : <Empty title="Not calculated yet" text={det.batches.length ? 'Payroll data is in. Calculate under an approved rule version.' : 'Upload the client\'s payroll for the month first.'} />)
            : tab === 'exc' ? <ExceptionList list={calc?.exceptions || []} />
            : tab === 'data' ? <BatchList batches={det.batches} />
            : <div className="tw">{det.calcs.length ? <table className="t"><thead><tr><th>Version</th><th>Method</th><th>Employees</th><th style={{ textAlign: 'right' }}>Payable</th><th>Exceptions</th><th>By</th><th>When</th><th /></tr></thead><tbody>
              {det.calcs.map((c) => <tr key={c.id} className="click" onClick={() => { setCalcId(c.id); setTab('calc'); }}><td className="mono">v{c.version}{c.id === p.current_calc_id && <> <Pill label="Current" cls="ok" nodot /></>}</td><td>{c.method === 'calculated' ? 'Calculated' : 'Imported from file'}</td><td className="num">{c.employee_count}</td><td className="num" style={{ textAlign: 'right' }}>{inr(c.total_payable)}</td><td className="num">{c.exceptions.length}</td><td>{c.created_by}</td><td className="small">{fmtDT(c.created_at)}</td><td /></tr>)}
            </tbody></table> : <Empty title="No versions" text="Each calculation is kept as a version that cannot be edited." />}</div>}
        </div>
        <div className="card"><div className="card-b">
          <div className="sec"><h4>People</h4>
            <dl className="kv">
              <dt>Preparer</dt><dd><select className="inp" value={p.preparer_id || ''} disabled={isDone(p)} onChange={(e) => assign('preparer_id', e.target.value)} aria-label="Preparer"><Opts list={team.map((m) => [m.id, m.name])} all="Not assigned" /></select></dd>
              <dt>Reviewer</dt><dd><select className="inp" value={p.reviewer_id || ''} disabled={isDone(p) || p.status === 'in_review'} onChange={(e) => assign('reviewer_id', e.target.value)} aria-label="Reviewer"><Opts list={team.filter(isReviewerRole).map((m) => [m.id, m.name])} all="Not assigned" /></select></dd>
              <dt>Prepared by</dt><dd>{p.prepared_by_member ? <Who name={memberName(a.d, p.prepared_by_member)} /> : '—'}</dd>
              <dt>Due date</dt><dd>{p.due_date ? fmtD(p.due_date) : <span className="muted">Set the due day in client setup</span>}</dd>
            </dl></div>
          <div className="sec" style={{ marginBottom: 0 }}><h4>History</h4><Timeline items={(det?.events || []).map((e) => ({ text: `${PERIOD_LABEL[e.action as keyof typeof PERIOD_LABEL] || cap(e.action.replace(/_/g, ' '))}${e.detail ? ': ' + e.detail : ''}`, who: e.actor_name || 'System', when: fmtDT(e.created_at) }))} /></div>
        </div></div>
      </div>
      <p className="tiny faint" style={{ marginTop: 10 }}>Payment, challan and evidence steps come in a later phase. This page records the calculation and its review; it does not submit anything to EPFO or ESIC.</p>
    </>
  );
}

function NoteModal({ title, label, ok, req, onOk }: { title: string; label: string; ok: string; req?: boolean; onOk: (note: string) => Promise<boolean> }) {
  const ui = useUI(); const [n, setN] = useState('');
  return (
    <Modal title={title} footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" disabled={req && !n.trim()} onClick={async () => { if (await onOk(n.trim())) ui.closeModal(); }}>{ok}</button></>}>
      <Field label={label} req={req} full><textarea className="inp" rows={3} value={n} onChange={(e) => setN(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}

const money = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function CalcView({ c, rule }: { c: FoCalc; rule?: number }) {
  return (
    <div className="card-b">
      <div className="small muted" style={{ marginBottom: 8 }}>Version {c.version} · {c.method === 'calculated' ? `calculated under rule v${rule ?? '?'}` : 'figures imported from the payroll file'} · {c.created_by} · {fmtDT(c.created_at)}</div>
      {c.components.length > 0 && <div className="tw" style={{ marginBottom: 12 }}><table className="t"><thead><tr><th>Component</th><th>Paid by</th><th>Rate</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead><tbody>
        {c.components.map((x) => <tr key={x.code}><td>{x.label} <span className="tiny mono faint">{x.code}</span></td><td>{x.payer === 'employer' ? 'Employer' : 'Employee'}</td><td className="num">{x.rate}%</td><td className="num" style={{ textAlign: 'right' }}>{inr(x.amount)}</td></tr>)}
        <tr><td className="strong" colSpan={3}>Total payable</td><td className="num strong" style={{ textAlign: 'right' }}>{inr(c.total_payable)}</td></tr>
      </tbody></table></div>}
      <LineTable lines={c.lines} />
    </div>
  );
}

function LineTable({ lines }: { lines: CalcLine[] }) {
  const [all, setAll] = useState(false);
  if (!lines.length) return <div className="small muted">No employee lines.</div>;
  const show = all ? lines : lines.slice(0, 25);
  return (
    <>
      <div className="tw"><table className="t"><thead><tr><th>Row</th><th>Employee</th><th style={{ textAlign: 'right' }}>Wage used</th><th style={{ textAlign: 'right' }}>Employee</th><th style={{ textAlign: 'right' }}>Employer</th><th>Flags</th></tr></thead><tbody>
        {show.map((l) => <tr key={l.row_no}><td className="num">{l.row_no}</td><td><span className="mono">{l.emp_ref}</span> {l.emp_name}</td><td className="num" style={{ textAlign: 'right' }}>{money(l.wage)}</td><td className="num" style={{ textAlign: 'right' }}>{money(l.employee)}</td><td className="num" style={{ textAlign: 'right' }}>{money(l.employer)}</td><td className="tiny">{l.flags.map((f) => FLAG_LABEL[f] || f).join(', ')}</td></tr>)}
      </tbody></table></div>
      {lines.length > 25 && <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${lines.length}`}</button>}
    </>
  );
}

function ExceptionList({ list }: { list: CalcException[] }) {
  if (!list.length) return <Empty title="No exceptions" text="Every payroll row passed the checks." />;
  return (
    <div className="tw"><table className="t"><thead><tr><th>Row</th><th>Employee</th><th>Problem</th><th>Effect</th></tr></thead><tbody>
      {list.map((e, i) => <tr key={i}><td className="num">{e.row_no || '—'}</td><td className="mono">{e.emp_ref || '—'}</td><td className="small">{e.message}</td><td>{e.blocking ? <Pill label="Row left out" cls="bad" nodot /> : <Pill label="Check" cls="warn" nodot />}</td></tr>)}
    </tbody></table></div>
  );
}

function BatchList({ batches }: { batches: FoBatch[] }) {
  if (!batches.length) return <Empty title="No payroll uploaded" text="Upload the client's payroll register for the month as a CSV file." />;
  return (
    <div className="tw"><table className="t"><thead><tr><th>File</th><th>Rows</th><th>Uploaded by</th><th>When</th><th>Fingerprint</th></tr></thead><tbody>
      {batches.map((b) => <tr key={b.id}><td>{b.file_name}</td><td className="num">{b.row_count}</td><td>{b.uploaded_by}</td><td className="small">{fmtDT(b.created_at)}</td><td className="mono tiny" title={b.file_hash}>{b.file_hash.slice(0, 12)}…</td></tr>)}
    </tbody></table><div className="card-b tiny muted">Only the checked figures are stored, with employee references cut to their last four characters. The original file is not kept.</div></div>
  );
}

/* ---------------------------------------------------------------- upload */
function UploadModal({ p, onDone }: { p: FoPeriod; onDone: () => Promise<void> }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const [file, setFile] = useState<{ name: string; hash: string; head: string[]; data: string[][] } | null>(null);
  const [map, setMap] = useState<Mapping>({}); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const pick = async (f: File | undefined) => {
    setErr(''); setFile(null);
    if (!f) return;
    if (!/\.csv$/i.test(f.name)) { setErr('Upload a .csv file. In Excel, use File → Save As → CSV (comma delimited).'); return; }
    if (f.size > 5 * 1024 * 1024) { setErr('The file is larger than 5 MB.'); return; }
    const buf = await f.arrayBuffer();
    const rows = parseCSV(new TextDecoder().decode(buf));
    if (rows.length < 2) { setErr('The file needs a header row and at least one employee row.'); return; }
    if (rows.length > 5001) { setErr('A single upload can hold up to 5,000 employees.'); return; }
    setFile({ name: f.name, hash: await sha256(buf), head: rows[0], data: rows.slice(1) }); setMap(autoMap(rows[0]));
  };
  const rows: PayrollRow[] = file ? toRows(file.data, map) : [];
  const missingReq = FIELDS.filter((x) => x.req && map[x.key] === undefined);
  const flagged = rows.filter((r) => r.flags.length); const blocking = rows.filter((r) => r.flags.some((f) => BLOCKING.includes(f)));
  const save = async () => {
    if (!file) return;
    setBusy(true);
    const ok = await run(async () => {
      const { data, error } = await sb().from('fo_payroll_batches').insert({ firm_id: a.firm.id, period_id: p.id, file_name: file.name.slice(0, 120), file_hash: file.hash, row_count: rows.length, mapping: Object.fromEntries(Object.entries(map).map(([k, v]) => [k, file.head[v as number]])), uploaded_by: a.me?.name || a.email }).select('id').single();
      if (error) { if ((error as { code?: string }).code === '23505') throw new Error('This exact file has already been uploaded for this obligation.'); throw error; }
      const id = (data as { id: string }).id;
      for (let i = 0; i < rows.length; i += 500) {
        const { error: e2 } = await sb().from('fo_payroll_records').insert(rows.slice(i, i + 500).map((r) => ({ firm_id: a.firm.id, batch_id: id, period_id: p.id, ...r })));
        if (e2) throw e2;
      }
      await sb().from('fo_events').insert({ firm_id: a.firm.id, client_id: p.client_id, entity: 'period', entity_id: p.id, action: 'payroll_uploaded', detail: `${file.name}: ${rows.length} rows, ${flagged.length} flagged`, actor_name: a.me?.name || a.email, actor_id: a.uid });
      if (p.status === 'awaiting_data') await rpc('fo_transition', { p_period: p.id, p_to: 'data_received', p_note: '' });
    }, `Payroll uploaded: ${rows.length} rows.`);
    setBusy(false);
    if (ok) { ui.closeModal(); await onDone(); }
  };
  return (
    <Modal title={`Upload payroll · ${clientName(a.d, p.client_id)} · ${monthLabel(p.period)}`} wide footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" disabled={!file || missingReq.length > 0 || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save upload'}</button></>}>
      <Note>Use a CSV with one row per employee. <a href="/samples/sample-payroll.csv" download>Download a sample file</a> (fictional data). Only the columns you map are read; employee references are cut to the last four characters before saving.</Note>
      {err && <Note kind="bad">{err}</Note>}
      <Field label="Payroll file (.csv)" req full><input className="inp" type="file" accept=".csv,text/csv" onChange={(e) => void pick(e.target.files?.[0])} /></Field>
      {file && <>
        <div className="sec" style={{ marginTop: 14 }}><h4>Match the columns</h4>
          <div className="fg">{FIELDS.map((x) => (
            <Field key={x.key} label={x.label} req={x.req}><select className="inp" value={map[x.key] ?? ''} onChange={(e) => setMap({ ...map, [x.key as FieldKey]: e.target.value === '' ? undefined : Number(e.target.value) })}><Opts list={file.head.map((h, i) => [String(i), h || `Column ${i + 1}`])} all="Not in file" /></select></Field>
          ))}</div></div>
        {missingReq.length > 0 ? <Note kind="warn">Match {missingReq.map((x) => x.label.toLowerCase()).join(' and ')} to continue.</Note> : <>
          <div className="row" style={{ gap: 8, margin: '8px 0' }}><Pill label={`${rows.length} rows`} cls="info" nodot />{flagged.length > 0 && <Pill label={`${flagged.length} flagged`} cls="warn" nodot />}{blocking.length > 0 && <Pill label={`${blocking.length} will be left out of the calculation`} cls="bad" nodot />}</div>
          <div className="tw" style={{ maxHeight: 260, overflow: 'auto' }}><table className="t"><thead><tr><th>Row</th><th>Ref</th><th>Name</th><th style={{ textAlign: 'right' }}>Gross</th><th style={{ textAlign: 'right' }}>PF wages</th><th style={{ textAlign: 'right' }}>ESI wages</th><th>Checks</th></tr></thead><tbody>
            {[...flagged, ...rows.filter((r) => !r.flags.length)].slice(0, 60).map((r) => <tr key={r.row_no}><td className="num">{r.row_no}</td><td className="mono">{r.emp_ref || '—'}</td><td>{r.emp_name}</td><td className="num" style={{ textAlign: 'right' }}>{r.gross_wages ?? '—'}</td><td className="num" style={{ textAlign: 'right' }}>{r.pf_wages ?? '—'}</td><td className="num" style={{ textAlign: 'right' }}>{r.esi_wages ?? '—'}</td><td className="tiny">{r.flags.length ? r.flags.map((f) => FLAG_LABEL[f]).join(', ') : <span style={{ color: 'var(--ok)' }}>OK</span>}</td></tr>)}
          </tbody></table></div></>}
      </>}
    </Modal>
  );
}

/* ---------------------------------------------------------------- calculation */
function CalcModal({ p, batches }: { p: FoPeriod; batches: FoBatch[] }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const rules = a.d.fo.rules.filter((r) => r.scheme === p.scheme && r.status === 'approved' && r.effective_from <= p.period).sort((x, y) => y.effective_from.localeCompare(x.effective_from) || y.version - x.version);
  const [method, setMethod] = useState<'calculated' | 'imported'>('calculated');
  const [ruleId, setRuleId] = useState(rules[0]?.id || ''); const [batchId, setBatchId] = useState(batches[0]?.id || '');
  const [rows, setRows] = useState<PayrollRow[] | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { setRows(null); if (batchId) loadBatchRows(batchId).then((r) => setRows(r as PayrollRow[]), (e) => setErr(errMsg(e))); }, [batchId]);
  const rule = rules.find((r) => r.id === ruleId);
  const basis = rule?.params.wage_basis || (p.scheme === 'PF' ? 'pf_wages' : 'esi_wages');
  const res = rows ? (method === 'calculated' ? (rule ? calculate(rows, rule.params) : null) : importedTotals(rows, basis)) : null;
  const blockedImport = method === 'imported' && !!res && res.exceptions.some((e) => e.code === 'no_imported_figures');
  const save = async () => {
    if (!res) return;
    setBusy(true);
    const ok = await run(() => rpc('fo_save_calculation', {
      p_period: p.id, p_method: method, p_rule: method === 'calculated' ? ruleId : null, p_batch: batchId, p_employee_count: res.employee_count,
      p_total_wages: res.total_wages, p_total_employee: res.total_employee, p_total_employer: res.total_employer,
      p_components: 'components' in res ? res.components : [], p_lines: res.lines, p_exceptions: res.exceptions,
    }), 'Calculation saved as a new version.');
    setBusy(false);
    if (ok) ui.closeModal();
  };
  return (
    <Modal title={`Calculate ${p.scheme} · ${clientName(a.d, p.client_id)} · ${monthLabel(p.period)}`} wide footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" disabled={!res || !rows?.length || busy || blockedImport} onClick={() => void save()}>{busy ? 'Saving…' : 'Save as new version'}</button></>}>
      {err && <Note kind="bad">{err}</Note>}
      <div className="fg">
        <Field label="Method" req><select className="inp" value={method} onChange={(e) => setMethod(e.target.value as 'calculated' | 'imported')}><Opts list={[['calculated', 'Calculate under a rule version'], ['imported', 'Use the figures in the payroll file']]} /></select></Field>
        <Field label="Payroll upload" req><select className="inp" value={batchId} onChange={(e) => setBatchId(e.target.value)}><Opts list={batches.map((b) => [b.id, `${b.file_name} · ${fmtDT(b.created_at)}`])} /></select></Field>
        {method === 'calculated' && <Field label="Approved rule version" req full>{rules.length ? <select className="inp" value={ruleId} onChange={(e) => setRuleId(e.target.value)}><Opts list={rules.map((r) => [r.id, `v${r.version} from ${fmtD(r.effective_from)}${r.label ? ' · ' + r.label : ''} · ${r.source_ref}`])} /></select>
          : <Note kind="warn">No approved {p.scheme} rule version is in force for {monthLabel(p.period)}. {canReview(a) ? <button type="button" className="linkbtn" onClick={() => { ui.closeModal(); ui.go('fo-rules'); }}>Set up contribution rules</button> : 'Ask a manager or partner.'}</Note>}</Field>}
      </div>
      {rows && !rows.length && <Note kind="warn">This upload has no employee rows to calculate.</Note>}
      {!rows ? <div className="skel" style={{ marginTop: 12 }} /> : rows.length > 0 && res && <>
        <div className="kpis" style={{ marginTop: 12 }}>
          <Kpi label="Employees" value={res.employee_count} sub={'excluded' in res && res.excluded.length ? `${res.excluded.length} above the limit` : 'Covered'} />
          <Kpi label="Employee share" value={inr(res.total_employee)} sub="" />
          <Kpi label="Employer share" value={inr(res.total_employer)} sub="" />
          <Kpi label="Total payable" value={inr(res.total_payable)} sub={`${res.exceptions.length} exception(s)`} cls={res.blocking ? 'warn' : ''} />
        </div>
        {res.blocking > 0 && <Note kind="warn">{res.blocking} problem(s) leave rows out of this calculation. Fix the payroll file and upload it again if those employees should be included.</Note>}
        {blockedImport && <Note kind="bad">Some rows have no contribution figures, so the file's own totals cannot be used. Calculate under a rule version instead.</Note>}
        {res.exceptions.length > 0 && <ExceptionList list={res.exceptions.slice(0, 50)} />}
      </>}
      <p className="tiny muted" style={{ marginBottom: 0 }}>Saving creates a new version; earlier versions stay on record. The obligation then needs review by someone other than you.</p>
    </Modal>
  );
}
