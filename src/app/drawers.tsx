import { useState } from 'react';
import { useApp, sb, memberName, clientName, myName, addActivity, pushInApp, patchTask, changeStatus, uploadFile, isReviewerRole } from './store';
import { useUI, DrawerFrame, Pill, PrioPill, Who, DueCell, Field, Opts, Note, Icon, Steps, Timeline, Bar, Confirm } from './ui';
import { useRun, can, FileLink } from './parts';
import { RequestDocsModal, RejectEvidenceModal } from './modals';
import { PORTALS, DOC_LABEL, RULE_STATUS_LABEL, INTEGRATIONS } from './constants';
import {
  STATUSES, STATUS_LABEL, isOpen, isOverdue, isStatOverdue, dDiff, fmtD, fmtDT, taskNo, filingStage, prepStatus, reviewStatus,
  apprStatus, subStatus, EVIDENCE_LABEL, todayISO, errMsg,
} from './util';
import type { Task, StatusKey, Priority, CRule, RuleProposal } from './types';

const STEP_LABELS = ['Documents', 'Preparation', 'Review', 'Approval', 'Submission', 'Acknowledgement', 'Verification'];

function useMove() {
  const a = useApp(); const ui = useUI(); const run = useRun();
  return async (t: Task, to: StatusKey) => {
    let result: { ok: boolean; msg: string; openFiling?: boolean } = { ok: false, msg: '' };
    const ok = await run(async () => { result = await changeStatus(a, t, to); });
    if (!ok) return;
    if (!result.ok && result.msg) { ui.toast(result.msg, 'warn'); if (result.openFiling) ui.openDrawer('filing', t.id); return; }
    if (result.ok) ui.toast(`${taskNo(t)}: ${result.msg}`, 'ok');
  };
}
export { useMove };

/* ================= Task drawer ================= */
export function TaskDrawer({ id }: { id: string }) {
  const a = useApp(); const ui = useUI(); const run = useRun(); const move = useMove();
  const [cl, setCl] = useState(''); const [cmt, setCmt] = useState('');
  const t = a.d.tasks.find((x) => x.id === id);
  if (!t) return <DrawerFrame head={<h2>Task not found</h2>}><p className="muted">It may have been removed or belong to another firm.</p></DrawerFrame>;
  const ed = can(a, 'task.edit'); const re = a.role === 'partner';
  const done = t.checklist.filter((x) => x.done).length;
  const docs = a.d.docs.filter((x) => x.task_id === t.id);
  const comments = a.d.comments.filter((x) => x.task_id === t.id);
  const activity = a.d.activity.filter((x) => x.task_id === t.id);
  const preps = a.d.team.filter((m) => m.active && m.role !== 'Managing Partner');
  const revs = a.d.team.filter((m) => m.active && isReviewerRole(m));
  const set = async (patch: Record<string, unknown>, text: string, ok?: string) => run(async () => { await patchTask(t, patch); await addActivity(a, t, text); }, ok);
  const b = (to: StatusKey, l: string, pri?: boolean) => <button type="button" key={to} className={`btn ${pri ? 'pri' : ''}`} onClick={() => move(t, to)}>{l}</button>;
  const next = () => {
    const s = t.status;
    if (s === 'scheduled') return [b('documents_requested', 'Mark documents requested'), b('in_progress', 'Start preparation', true)];
    if (s === 'documents_requested') return [b('in_progress', 'Start preparation', true)];
    if (s === 'in_progress' || s === 'changes_requested') return [b('prepared', 'Mark prepared', true)];
    if (s === 'prepared') return [b('under_review', 'Send for review', true)];
    if (s === 'under_review') return [b('changes_requested', 'Request changes'), b('approved', 'Approve', true)];
    if (s === 'approved') return [b('ready_to_file', 'Mark ready to file', true)];
    return [<button type="button" key="f" className="btn pri" onClick={() => ui.openDrawer('filing', t.id)}>Continue in filing panel</button>];
  };
  return (
    <DrawerFrame
      head={<><div className="tiny muted"><span className="mono">{taskNo(t)}</span> · {t.category} · FY {t.fy || '—'}</div><h2>{t.title}</h2><div className="small muted">{clientName(a.d, t.client_id)}</div></>}
      footer={ed && isOpen(t) ? <>{next()}</> : undefined}>
      {isOverdue(t) && t.internal_due_date && <Note kind="bad">Internal due date passed {-dDiff(t.internal_due_date)} day(s) ago.{isStatOverdue(t) ? ' The statutory due date has also passed.' : ''}</Note>}
      {t.blocked && <Note kind="warn"><b>Blocked.</b> {t.blocked} {ed && <button type="button" className="btn sm" onClick={() => set({ blocked: '' }, 'Cleared blocker: ' + t.blocked)}>Clear blocker</button>}</Note>}
      <div className="sec"><Steps labels={STEP_LABELS} stage={filingStage(t)} /></div>
      <div className="sec fg">
        <Field label="Status">{ed ? <select className="inp" value={t.status} onChange={(e) => move(t, e.target.value as StatusKey)}><Opts list={STATUSES.map((s) => [s, STATUS_LABEL[s]] as [string, string])} /></select> : <Pill label={STATUS_LABEL[t.status]} />}</Field>
        <Field label="Priority">{ed ? <select className="inp" value={t.priority} onChange={(e) => set({ priority: e.target.value as Priority }, `Priority changed from ${t.priority} to ${e.target.value}`, 'Priority updated.')}><Opts list={[['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']]} /></select> : <PrioPill p={t.priority} />}</Field>
        <Field label="Preparer">{re ? <select className="inp" value={t.preparer_id || ''} onChange={(e) => run(async () => { await patchTask(t, { preparer_id: e.target.value || null }); await addActivity(a, t, `Preparer reassigned from ${memberName(a.d, t.preparer_id)} to ${memberName(a.d, e.target.value)}`); await pushInApp(a, e.target.value || null, t, 'Assignment', `You are now preparer on ${t.title} (${clientName(a.d, t.client_id)}).`); }, 'Preparer reassigned.')}><Opts list={preps.map((m) => [m.id, `${m.name} · ${m.role}`] as [string, string])} all="Unassigned" /></select> : <Who name={memberName(a.d, t.preparer_id)} />}</Field>
        <Field label="Reviewer">{re ? <select className="inp" value={t.reviewer_id || ''} onChange={(e) => run(async () => { await patchTask(t, { reviewer_id: e.target.value || null }); await addActivity(a, t, `Reviewer reassigned to ${memberName(a.d, e.target.value)}`); await pushInApp(a, e.target.value || null, t, 'Assignment', `You are now reviewer on ${t.title} (${clientName(a.d, t.client_id)}).`); }, 'Reviewer reassigned.')}><Opts list={revs.map((m) => [m.id, `${m.name} · ${m.role}`] as [string, string])} all="Unassigned" /></select> : <Who name={memberName(a.d, t.reviewer_id)} />}</Field>
        <Field label="Internal due">{ed ? <input className="inp" type="date" value={t.internal_due_date || ''} onChange={(e) => {
          const v = e.target.value; if (!v) return;
          if (t.due_date && v > t.due_date) { ui.toast('Internal due date should be on or before the statutory date.', 'warn'); return; }
          void set({ internal_due_date: v }, `Internal due date moved from ${fmtD(t.internal_due_date)} to ${fmtD(v)}`);
        }} /> : fmtD(t.internal_due_date)}</Field>
        <Field label="Statutory due"><div style={{ paddingTop: 5 }}><DueCell date={t.due_date} closed={!isOpen(t)} /></div></Field>
      </div>
      <div className="sec"><h4>Checklist · {done}/{t.checklist.length}</h4>
        <div style={{ marginBottom: 8 }}><Bar pct={(100 * done) / (t.checklist.length || 1)} cls={done === t.checklist.length && done > 0 ? 'ok' : ''} /></div>
        <div className="cl">{t.checklist.map((x, i) => (
          <label key={i}><input type="checkbox" checked={x.done} disabled={!ed} onChange={(e) => {
            const list = t.checklist.map((y, j) => (j === i ? { ...y, done: e.target.checked } : y));
            void set({ checklist: list }, `${e.target.checked ? 'Completed' : 'Reopened'} checklist item "${x.t}"`);
          }} /><span className={x.done ? 'done' : ''}>{x.t}</span></label>
        ))}</div>
        {ed && <div className="row" style={{ marginTop: 6 }}><input className="inp grow" value={cl} onChange={(e) => setCl(e.target.value)} placeholder="Add checklist item" />
          <button type="button" className="btn sm" onClick={async () => { if (!cl.trim()) { ui.toast('Type a checklist item first.', 'warn'); return; } const v = cl.trim(); if (await set({ checklist: [...t.checklist, { t: v, done: false }] }, `Added checklist item "${v}"`)) setCl(''); }}>Add</button></div>}
      </div>
      <div className="sec"><h4>Required documents</h4>
        {t.required_docs.length ? t.required_docs.map((n) => { const d = docs.find((x) => x.name === n); return <div className="row small" key={n} style={{ padding: '4px 0' }}><span className="grow">{n}</span>{d ? <Pill label={DOC_LABEL[d.status]} /> : <span className="pill">Not requested</span>}</div>; }) : <div className="small muted">No documents listed.</div>}
        {can(a, 'doc.request') && <button type="button" className="btn sm" style={{ marginTop: 6 }} onClick={() => ui.openModal(<RequestDocsModal clientId={t.client_id} taskId={t.id} />)}><Icon n="folder" />Request documents</button>}
      </div>
      <div className="sec"><h4>Filing</h4><div className="row small"><span>{t.filing.method} filing</span>{t.filing.ack && <span className="tag">Ack {t.filing.ack}</span>}<span>Evidence: <Pill label={EVIDENCE_LABEL[t.filing.evidence]} /></span><button type="button" className="btn sm" onClick={() => ui.openDrawer('filing', t.id)}>Open filing panel</button></div></div>
      <div className="sec"><h4>Comments</h4>
        {comments.length ? comments.map((m) => <div className="cmt" key={m.id}><div className="tiny muted"><b>{m.author_name}</b> · {fmtDT(m.created_at)}</div>{m.body}</div>) : <div className="small muted" style={{ marginBottom: 6 }}>No comments yet.</div>}
        <textarea className="inp" value={cmt} onChange={(e) => setCmt(e.target.value)} placeholder="Add a comment for the team (clients never see comments)" />
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 6 }}><button type="button" className="btn sm pri" onClick={async () => {
          if (!cmt.trim()) { ui.toast('Write a comment first.', 'warn'); return; }
          const body = cmt.trim();
          const ok = await run(async () => { const { error } = await sb().from('task_comments').insert({ firm_id: t.firm_id, task_id: t.id, author_name: myName(a), body }); if (error) throw error; await addActivity(a, t, 'Added a comment'); }, 'Comment added.');
          if (ok) setCmt('');
        }}>Comment</button></div>
      </div>
      <div className="sec"><h4>Activity</h4><Timeline items={activity.map((x) => ({ text: x.text, who: x.actor_name || '—', when: fmtDT(x.created_at) }))} /></div>
    </DrawerFrame>
  );
}

/* ================= Filing drawer ================= */
export function FilingDrawer({ id }: { id: string }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const [date, setDate] = useState(todayISO()); const [ack, setAck] = useState(''); const [conf, setConf] = useState(false);
  const [busy, setBusy] = useState(false);
  const t = a.d.tasks.find((x) => x.id === id);
  if (!t) return <DrawerFrame head={<h2>Filing not found</h2>}><p className="muted">It may belong to another firm.</p></DrawerFrame>;
  const client = a.role === 'client';
  const ed = can(a, 'filing.edit'); const verifier = a.role === 'partner';
  const stage = filingStage(t); const ready = t.status === 'ready_to_file';
  const prov = INTEGRATIONS.find((i) => i.id === (t.category === 'GST' ? 'gsp' : t.category === 'MCA/ROC' ? 'mca' : 'itd'));
  const portal = PORTALS[t.category] || 'https://www.incometax.gov.in';
  const activity = a.d.activity.filter((x) => x.task_id === t.id && /ubmi|ack|vidence|ilin|pprov/i.test(x.text));
  const setFiling = (f: Partial<Task['filing']>, extra: Record<string, unknown>, text: string, ok?: string) =>
    run(async () => { await patchTask(t, { filing: { ...t.filing, ...f }, ...extra }); await addActivity(a, t, text); }, ok);
  const record = async () => {
    if (!date || date > todayISO()) { ui.toast('Submission date cannot be in the future.', 'warn'); return; }
    if (!/^[A-Za-z0-9-]{6,30}$/.test(ack.trim())) { ui.toast('Acknowledgement must be 6–30 letters, digits or hyphens.', 'warn'); return; }
    if (!conf) { ui.toast('Tick the confirmation to record this submission.', 'warn'); return; }
    const code = ack.trim().toUpperCase();
    await setFiling({ submitted_on: date, ack: code, evidence: 'awaiting_upload' }, { status: 'filed' }, `Submission recorded on ${fmtD(date)}, ack ${code} (assisted filing; user-entered, not verified with the portal)`, 'Submission recorded. Upload the acknowledgement next.');
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { ui.toast('That file is over 10 MB. Upload a smaller PDF or image.', 'warn'); return; }
    setBusy(true);
    try {
      const path = await uploadFile(t.firm_id, t.client_id, file);
      await setFiling({ evidence_path: path, evidence_name: file.name, evidence: 'uploaded', ev_rejected: '' }, { status: 'evidence_pending' }, `Uploaded acknowledgement evidence ${file.name}`, `${file.name} attached.`);
    } catch (e) { ui.toast(errMsg(e), 'warn'); }
    setBusy(false);
  };
  return (
    <DrawerFrame head={<><div className="tiny muted"><span className="mono">{taskNo(t)}</span> · {t.category} · Filing</div><h2>{t.form} · {t.period}</h2><div className="small muted">{clientName(a.d, t.client_id)} · due {fmtD(t.due_date)}</div></>}>
      <div className="sec"><Steps labels={STEP_LABELS} stage={stage} /></div>
      <div className="sec"><h4>Workflow</h4><dl className="kv">
        <dt>Task status</dt><dd><Pill label={STATUS_LABEL[t.status]} /></dd>
        <dt>Preparation</dt><dd><Pill label={prepStatus(t)} cls={prepStatus(t) === 'Not started' ? '' : 'info'} />{!client && <> by {memberName(a.d, t.preparer_id)}</>}</dd>
        <dt>Review</dt><dd>{reviewStatus(t)}{!client && <> · {memberName(a.d, t.reviewer_id)}</>}</dd>
        <dt>Approval</dt><dd><Pill label={apprStatus(t)} cls={apprStatus(t) === 'Approved' ? 'ok' : ''} /></dd>
      </dl>{!client && <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={() => ui.openDrawer('task', t.id)}>Open task details</button>}</div>
      <div className="sec">
        <div className="row" style={{ marginBottom: 8 }}><h4 style={{ margin: 0 }} className="grow">Filing method</h4>
          {!client ? <div className="seg">{(['Integrated', 'Assisted'] as const).map((m) => <button type="button" key={m} className={t.filing.method === m ? 'on' : ''} disabled={!!t.filing.ack || !ed} onClick={() => { if (t.filing.method !== m) void setFiling({ method: m }, {}, 'Filing method set to ' + m); }}>{m}</button>)}</div> : <span className="tag">{t.filing.method}</span>}
        </div>
        <div className="card"><div className="card-b">
          {client ? <dl className="kv"><dt>Submission</dt><dd><Pill label={subStatus(t)} /></dd><dt>Acknowledgement</dt><dd className="mono">{t.filing.ack || '—'}</dd><dt>Evidence</dt><dd><Pill label={EVIDENCE_LABEL[t.filing.evidence]} /></dd>{t.filing.evidence === 'verified' && t.filing.evidence_path && <><dt>Acknowledgement file</dt><dd><FileLink path={t.filing.evidence_path} name={t.filing.evidence_name} /></dd></>}</dl>
          : t.filing.method === 'Integrated' ? <>
            <dl className="kv"><dt>Provider</dt><dd>{prov?.vendor}</dd><dt>Connection</dt><dd><Pill label={prov?.state || 'Not Configured'} /></dd><dt>Capabilities</dt><dd>{prov?.caps.length ? prov.caps.map((x) => <span className="tag" key={x}>{x}</span>) : <span className="muted">None available</span>}</dd></dl>
            <div className="row" style={{ marginTop: 10 }}><button type="button" className="btn" disabled title="No filing provider is connected"><Icon n="send" />Submit via provider</button>{ed && !t.filing.ack && <button type="button" className="btn ghost" onClick={() => setFiling({ method: 'Assisted' }, {}, 'Filing method set to Assisted')}>Switch to assisted filing</button>}</div>
            <div className="tiny muted" style={{ marginTop: 6 }}>Integrated filing is unavailable: the {prov?.name} is {prov?.state.toLowerCase()}. {prov?.note}</div>
          </> : <>
            <div className="sec" style={{ marginBottom: 12 }}><div className="row"><b className="small">1. File on the official portal</b><a className="btn sm" href={portal} target="_blank" rel="noopener noreferrer"><Icon n="ext" />Open {new URL(portal).hostname}</a></div><div className="tiny muted" style={{ marginTop: 4 }}>An authorised person files and e-verifies on the portal. This app does not see that session.</div></div>
            <div className="sec" style={{ marginBottom: 12 }}><b className="small">2. Record submission</b>
              {t.filing.ack ? <dl className="kv" style={{ marginTop: 6 }}><dt>Submitted on</dt><dd>{fmtD(t.filing.submitted_on)}</dd><dt>Acknowledgement</dt><dd className="mono">{t.filing.ack}</dd><dt>Recorded as</dt><dd className="tiny muted">User-entered. Not verified with the portal.</dd></dl>
                : ready && ed ? <div className="fg" style={{ marginTop: 8 }}>
                  <Field label="Submission date" req><input className="inp" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                  <Field label="Acknowledgement / ARN / SRN" req><input className="inp mono" value={ack} onChange={(e) => setAck(e.target.value)} placeholder="As shown on the portal" /></Field>
                  <label className="chk full"><input type="checkbox" checked={conf} onChange={(e) => setConf(e.target.checked)} />I confirm this return was submitted on the official portal by an authorised person.</label>
                  <div className="full"><button type="button" className="btn pri" onClick={record}>Record submission</button></div>
                </div> : <div className="small muted" style={{ marginTop: 4 }}>{ready ? 'Your role cannot record submissions.' : `Available once the task is approved and marked Ready to File (currently ${STATUS_LABEL[t.status]}).`}</div>}
            </div>
            <div className="sec" style={{ marginBottom: 0 }}><b className="small">3. Acknowledgement evidence</b>
              {t.filing.evidence_name && <div className="row small" style={{ marginTop: 6 }}><FileLink path={t.filing.evidence_path} name={t.filing.evidence_name} /><Pill label={EVIDENCE_LABEL[t.filing.evidence]} /></div>}
              {t.filing.ev_rejected && <div className="tiny" style={{ color: 'var(--bad)', marginTop: 4 }}>Rejected: {t.filing.ev_rejected}</div>}
              <div className="row" style={{ marginTop: 8 }}>
                {t.filing.ack && ed && (t.filing.evidence === 'awaiting_upload' || t.filing.evidence === 'uploaded') && <>
                  <label className="btn" htmlFor={`ev-${t.id}`}><Icon n="upload" />{busy ? 'Uploading…' : t.filing.evidence_name ? 'Replace file' : 'Upload acknowledgement'}</label>
                  <input type="file" id={`ev-${t.id}`} accept=".pdf,.png,.jpg,.jpeg" hidden onChange={(e) => upload(e.target.files?.[0])} /></>}
                {t.filing.evidence === 'uploaded' && ed && <button type="button" className="btn pri" onClick={() => run(async () => { await patchTask(t, { filing: { ...t.filing, evidence: 'under_verification' } }); await addActivity(a, t, 'Evidence submitted for verification'); await pushInApp(a, t.reviewer_id, t, 'Evidence verification', `Verify the acknowledgement for ${t.title}.`); }, 'Sent to a partner for verification.')}>Submit for evidence verification</button>}
                {t.filing.evidence === 'under_verification' && (verifier ? <>
                  <button type="button" className="btn danger" onClick={() => ui.openModal(<RejectEvidenceModal t={t} />)}>Reject evidence</button>
                  <button type="button" className="btn pri" onClick={() => ui.openModal(<Confirm title="Verify evidence" ok="Verify and complete" text={<>Confirm that <b>{t.filing.evidence_name}</b> shows acknowledgement <b className="mono">{t.filing.ack}</b> for {t.title}. The task will be completed.</>} onOk={async () => { await setFiling({ evidence: 'verified' }, { status: 'completed' }, 'Acknowledgement evidence verified; task completed', `${taskNo(t)} completed.`); }} />)}><Icon n="check" />Verify and complete</button>
                </> : <span className="small muted">Waiting for a partner to verify.</span>)}
                {!t.filing.ack && <span className="small muted">Upload opens after the submission is recorded.</span>}
              </div>
              <div className="tiny muted" style={{ marginTop: 6 }}>Verification means a partner compared the file with the recorded acknowledgement.</div>
            </div>
          </>}
        </div></div>
      </div>
      {!client && <div className="sec"><h4>History</h4><Timeline items={activity.map((x) => ({ text: x.text, who: x.actor_name || '—', when: fmtDT(x.created_at) }))} /></div>}
    </DrawerFrame>
  );
}

/* ================= Compliance rule drawer ================= */
export function RuleDrawer({ id }: { id: string }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const [p, setP] = useState({ field: 'due_rule' as RuleProposal['field'], eff: todayISO(), to: '', reason: '', ref: '' });
  const r = a.d.crules.find((x) => x.id === id);
  if (!r) return <DrawerFrame head={<h2>Rule not found</h2>}><p className="muted">—</p></DrawerFrame>;
  const ed = a.role === 'partner';
  const save = (patch: Partial<CRule>, ok: string) => run(async () => { const { error } = await sb().from('compliance_rules').update(patch).eq('id', r.id); if (error) throw error; }, ok);
  const nextV = 'v' + (parseInt(r.version.slice(1) || '1', 10) + 1);
  const fieldLabel: Record<string, string> = { due_rule: 'Due-date logic', applicability: 'Applicability', frequency: 'Frequency' };
  return (
    <DrawerFrame head={<><div className="tiny muted">{r.authority} · rule {r.version}</div><h2>{r.form}</h2></>}>
      <Note kind="warn">Illustrative entry. Confirm the due-date logic against the official source, then approve it so the firm knows it was checked.</Note>
      <div className="sec"><dl className="kv">
        <dt>Applicability</dt><dd>{r.applicability}</dd><dt>Frequency</dt><dd>{r.frequency}</dd><dt>Due-date logic</dt><dd>{r.due_rule}</dd>
        <dt>Effective from</dt><dd>{fmtD(r.effective)}</dd><dt>Official source</dt><dd>{r.source ? <a href={r.source} target="_blank" rel="noopener noreferrer">{r.source}</a> : '—'}</dd>
        <dt>Last verified</dt><dd>{r.verified_on ? `${fmtD(r.verified_on)} by ${r.verified_by}` : 'Not verified'}</dd><dt>Approval</dt><dd><Pill label={RULE_STATUS_LABEL[r.status]} /></dd>
      </dl>
        {ed && r.status === 'draft' && !r.proposal && <div className="row" style={{ marginTop: 10 }}><button type="button" className="btn pri" onClick={() => save({ status: 'approved', verified_on: todayISO(), verified_by: myName(a), history: [{ v: r.version, at: todayISO(), by: myName(a), note: 'Checked against official source and approved' }, ...r.history] }, `${r.form} rule approved.`)}><Icon n="check" />I checked the source · approve</button></div>}
      </div>
      {r.proposal && <div className="sec"><h4>Proposed change</h4><div className="card"><div className="card-b small">
        <dl className="kv"><dt>Field</dt><dd>{fieldLabel[r.proposal.field]}</dd><dt>From</dt><dd>{r.proposal.from}</dd><dt>To</dt><dd><b>{r.proposal.to}</b></dd><dt>Reason</dt><dd>{r.proposal.reason}</dd><dt>Source checked</dt><dd>{r.proposal.ref || '—'}</dd><dt>Proposed by</dt><dd>{r.proposal.by} · {fmtD(r.proposal.at)}</dd></dl>
        {ed ? <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="btn danger" onClick={() => save({ proposal: null, status: r.verified_on ? 'approved' : 'draft', history: [{ v: r.version, at: todayISO(), by: myName(a), note: 'Proposed change rejected' }, ...r.history] }, 'Proposal rejected. Rule unchanged.')}>Reject</button>
          <button type="button" className="btn pri" onClick={() => { const pr = r.proposal as RuleProposal; void save({ [pr.field]: pr.to, version: nextV, effective: pr.eff || r.effective, verified_on: todayISO(), verified_by: myName(a), status: 'approved', proposal: null, history: [{ v: nextV, at: todayISO(), by: myName(a), note: `Approved: ${fieldLabel[pr.field]} → ${pr.to}` }, ...r.history] } as Partial<CRule>, `${r.form} rule is now ${nextV}. Existing tasks keep their dates.`); }}>Approve as {nextV}</button>
        </div> : <div className="tiny muted" style={{ marginTop: 8 }}>A partner must approve this change.</div>}
      </div></div></div>}
      {!r.proposal && <div className="sec"><h4>Propose a change</h4><div className="fg">
        <Field label="Field"><select className="inp" value={p.field} onChange={(e) => setP({ ...p, field: e.target.value as RuleProposal['field'] })}><Opts list={[['due_rule', 'Due-date logic'], ['applicability', 'Applicability'], ['frequency', 'Frequency']]} /></select></Field>
        <Field label="Effective from"><input className="inp" type="date" value={p.eff} onChange={(e) => setP({ ...p, eff: e.target.value })} /></Field>
        <Field label="New value" req full><input className="inp" value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} /></Field>
        <Field label="Reason" req full><textarea className="inp" value={p.reason} onChange={(e) => setP({ ...p, reason: e.target.value })} placeholder="e.g. CBIC notification extending the due date" /></Field>
        <Field label="Source reference" full><input className="inp" value={p.ref} onChange={(e) => setP({ ...p, ref: e.target.value })} placeholder="Notification or circular number" /></Field>
      </div><div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}><button type="button" className="btn pri" onClick={() => {
        if (!p.to.trim() || !p.reason.trim()) { ui.toast('Enter the new value and a reason.', 'warn'); return; }
        const proposal: RuleProposal = { field: p.field, from: String(r[p.field] || ''), to: p.to.trim(), reason: p.reason.trim(), ref: p.ref.trim(), eff: p.eff, by: myName(a), at: todayISO() };
        void save({ proposal, status: 'proposed', history: [{ v: r.version, at: todayISO(), by: myName(a), note: `Change proposed to ${fieldLabel[p.field]}` }, ...r.history] }, 'Change submitted for partner approval.');
      }}>Submit for approval</button></div></div>}
      <div className="sec"><h4>Version history</h4><Timeline items={r.history.map((x) => ({ text: `${x.v} · ${x.note}`, who: x.by, when: fmtD(x.at) }))} /></div>
    </DrawerFrame>
  );
}
