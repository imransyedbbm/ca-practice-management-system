import { useMemo, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import {
  useApp, sb, memberName, clientName, myName, isPartnerRole, isReviewerRole, addActivity, logMessage, pushInApp,
  createFromOccurrences, normClient, uploadFile, mergeTemplate, patchTask, changeStatus, inviteMember,
} from './store';
import { useUI, Modal, Field, Opts, Note, Icon, Empty, Pill } from './ui';
import { useRun, can } from './parts';
import { ENTITY_TYPES, PACKAGES, SERVICES, CATS, STATE_NAMES, TEAM_ROLES, CHANNEL_LABEL, MSG_STATUS_LABEL } from './constants';
import { TEMPLATES, templateByKey, nextOccurrence, upcomingFor } from './obligations';
import type { Occurrence } from './obligations';
import {
  PAN_RE, TAN_RE, GSTIN_RE, EMAIL_RE, PHONE_RE, todayISO, addD, fyOf, isOpen, isOverdue, taskNo, dDiff, fmtD, fmtDT,
  STATUSES, STATUS_LABEL, si, errMsg, inr,
} from './util';
import type { Task, Doc, Message, AutoRule, TeamMember, Client, Invoice, Channel, MsgStatus } from './types';

type Errs = Record<string, string>;
const upper = (e: ChangeEvent<HTMLInputElement>) => e.target.value.toUpperCase();

/* ================= Add client ================= */
export function AddClientModal() {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const partners = a.d.team.filter((m) => m.active && isPartnerRole(m));
  const [v, setV] = useState({ name: '', type: '', state: '29', pan: '', tan: '', gstreg: 'no', gstin: '', contact: '', email: '', phone: '', partner: partners[0]?.id || '', pkg: 'Growth' });
  const [svc, setSvc] = useState<string[]>([]);
  const [gen, setGen] = useState(true);
  const [err, setErr] = useState<Errs>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    const e: Errs = {};
    if (!v.name.trim()) e.name = 'Required.';
    if (!v.type) e.type = 'Required.';
    if (!PAN_RE.test(v.pan)) e.pan = 'PAN format is 5 letters, 4 digits, 1 letter.';
    if (v.tan && !TAN_RE.test(v.tan)) e.tan = 'TAN format is 4 letters, 5 digits, 1 letter.';
    if (v.gstreg === 'yes' && !GSTIN_RE.test(v.gstin)) e.gstin = 'Enter a 15-character GSTIN, or set registration to Not registered.';
    else if (v.gstreg === 'yes' && v.gstin.slice(2, 12) !== v.pan) e.gstin = 'Characters 3–12 of the GSTIN must match the PAN.';
    if (!v.contact.trim()) e.contact = 'Required.';
    if (!EMAIL_RE.test(v.email)) e.email = 'Enter a valid email address.';
    if (!PHONE_RE.test(v.phone)) e.phone = 'Enter a 10-digit mobile number, optionally with +91.';
    if (!svc.length) e.svc = 'Select at least one.';
    if (a.d.clients.some((c) => c.pan && c.pan === v.pan)) e.pan = 'A client with this PAN already exists in this firm.';
    setErr(e);
    if (Object.keys(e).length) { ui.toast('Fix the highlighted fields to save.', 'warn'); return; }
    setBusy(true);
    let newId = ''; let n = 0;
    const ok = await run(async () => {
      const { data, error } = await sb().from('clients').insert({
        firm_id: a.firm.id, created_by: a.uid, name: v.name.trim(), entity_type: v.type, state_code: v.state, pan: v.pan, tan: v.tan,
        gstin: v.gstreg === 'yes' ? v.gstin : '', contact_person: v.contact.trim(), email: v.email.trim(), phone: v.phone.trim(),
        partner_id: v.partner || null, package: v.pkg, status: 'onboarding', services: svc, client_since: String(new Date().getFullYear()),
      }).select('*').single();
      if (error) throw error;
      const c = normClient(data as Record<string, unknown>); newId = c.id;
      if (gen) n = await createFromOccurrences(a, c, upcomingFor(c, todayISO(), 60));
    });
    setBusy(false);
    if (ok) {
      ui.closeModal(); ui.go('client', { id: newId });
      ui.toast(`${v.name} added as Onboarding.${gen ? ` ${n} upcoming compliance task(s) created.` : ''}`);
    }
  };
  return (
    <Modal title="Add client" wide footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save client'}</button></>}>
      <div className="fg">
        <Field label="Legal name" req full error={err.name}><input className={`inp ${err.name ? 'err' : ''}`} value={v.name} onChange={set('name')} placeholder="e.g. Shivaji Nagar Traders Pvt Ltd" /></Field>
        <Field label="Entity type" req error={err.type}><select className={`inp ${err.type ? 'err' : ''}`} value={v.type} onChange={set('type')}><Opts list={ENTITY_TYPES} all="Select…" /></select></Field>
        <Field label="State" req><select className="inp" value={v.state} onChange={set('state')}><Opts list={Object.entries(STATE_NAMES).map(([k, n]) => [k, `${n} (${k})`] as [string, string])} /></select></Field>
        <Field label="PAN" req error={err.pan}><input className={`inp mono ${err.pan ? 'err' : ''}`} maxLength={10} value={v.pan} onChange={(e) => setV({ ...v, pan: upper(e) })} placeholder="ABCDE1234F" /></Field>
        <Field label="TAN" error={err.tan}><input className={`inp mono ${err.tan ? 'err' : ''}`} maxLength={10} value={v.tan} onChange={(e) => setV({ ...v, tan: upper(e) })} placeholder="Optional · BLRA12345B" /></Field>
        <Field label="GST registration"><select className="inp" value={v.gstreg} onChange={set('gstreg')}><Opts list={[['yes', 'Registered'], ['no', 'Not registered']]} /></select></Field>
        <Field label="GSTIN" error={err.gstin}><input className={`inp mono ${err.gstin ? 'err' : ''}`} maxLength={15} value={v.gstin} onChange={(e) => setV({ ...v, gstin: upper(e) })} placeholder="Required if registered" disabled={v.gstreg !== 'yes'} /></Field>
        <Field label="Contact person" req error={err.contact}><input className={`inp ${err.contact ? 'err' : ''}`} value={v.contact} onChange={set('contact')} /></Field>
        <Field label="Email" req error={err.email}><input className={`inp ${err.email ? 'err' : ''}`} type="email" value={v.email} onChange={set('email')} /></Field>
        <Field label="Phone" req error={err.phone}><input className={`inp ${err.phone ? 'err' : ''}`} value={v.phone} onChange={set('phone')} placeholder="+91 98xxx xxxxx" /></Field>
        <Field label="Assigned partner"><select className="inp" value={v.partner} onChange={set('partner')}><Opts list={partners.map((p) => [p.id, p.name] as [string, string])} all="Not assigned" /></select></Field>
        <Field label="Compliance package"><select className="inp" value={v.pkg} onChange={set('pkg')}><Opts list={PACKAGES} /></select></Field>
        <Field label="Services required" req full error={err.svc}>
          <div className="chks">{SERVICES.map((s) => (
            <label className="chk" key={s}><input type="checkbox" checked={svc.includes(s)} onChange={(e) => setSvc(e.target.checked ? [...svc, s] : svc.filter((x) => x !== s))} />{s}</label>
          ))}</div>
        </Field>
        <label className="chk full"><input type="checkbox" checked={gen} onChange={(e) => setGen(e.target.checked)} />Create compliance tasks due in the next 60 days from the selected services</label>
      </div>
      <div className="tiny muted" style={{ marginTop: 10 }}>Due dates come from standard patterns and must be checked against official notifications and extensions.</div>
    </Modal>
  );
}

/* ================= New task ================= */
export function NewTaskModal({ clientId }: { clientId?: string }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const preps = a.d.team.filter((m) => m.active && m.role !== 'Managing Partner');
  const revs = a.d.team.filter((m) => m.active && isReviewerRole(m));
  const [v, setV] = useState({ client: clientId || '', tpl: '', title: '', cat: 'GST', prio: 'medium', prep: a.role === 'accountant' ? a.me?.id || '' : '', rev: '', internal: '', due: '', docs: '', period: '' });
  const [err, setErr] = useState<Errs>({});
  const client = a.d.clients.find((c) => c.id === v.client);
  const pickTpl = (key: string, cid = v.client) => {
    const t = templateByKey(key); const c = a.d.clients.find((x) => x.id === cid);
    if (t && c) {
      const o = nextOccurrence(t, c, todayISO());
      if (o) { setV((p) => ({ ...p, client: cid, tpl: key, cat: t.cat, due: o.due, internal: o.internal, docs: o.docs.join(', '), period: o.period })); return; }
    }
    setV((p) => ({ ...p, client: cid, tpl: key }));
  };
  const save = async () => {
    const e: Errs = {};
    if (!v.client) e.client = 'Required.';
    if (!v.tpl) e.tpl = 'Required.';
    if (v.tpl === 'custom' && !v.title.trim()) e.title = 'Give the custom task a title.';
    if (!v.prep) e.prep = 'Required.';
    if (!v.rev) e.rev = 'Required.';
    if (!v.internal) e.internal = 'Required.';
    if (!v.due) e.due = 'Required.';
    if (v.internal && v.due && v.internal > v.due) e.internal = 'Internal due date must be on or before the statutory date.';
    setErr(e);
    if (Object.keys(e).length || !client) { ui.toast('Fix the highlighted fields to create the task.', 'warn'); return; }
    const docs = v.docs.split(',').map((x) => x.trim()).filter(Boolean);
    let createdId = '';
    const ok = await run(async () => {
      if (v.tpl === 'custom') {
        const { data, error } = await sb().from('compliance_tasks').insert({
          firm_id: a.firm.id, client_id: client.id, created_by: a.uid, title: v.title.trim(), form: v.title.trim().split(' ')[0], category: v.cat,
          period: v.period || 'Ad hoc', fy: fyOf(v.due), template_key: null, due_date: v.due, internal_due_date: v.internal, status: 'scheduled',
          priority: v.prio, preparer_id: v.prep, reviewer_id: v.rev, required_docs: docs,
          checklist: [{ t: 'Prepare working', done: false }, { t: 'Reviewer sign-off', done: false }],
        }).select('id').single();
        if (error) throw error;
        createdId = String((data as { id: string }).id);
        await sb().from('task_activity').insert({ firm_id: a.firm.id, task_id: createdId, actor_name: myName(a), text: 'Task created manually' });
      } else {
        const t = templateByKey(v.tpl); if (!t) throw new Error('Unknown compliance template.');
        const occ: Occurrence = { key: t.key, form: t.form, cat: t.cat, title: `${t.form} — ${v.period}`, period: v.period, fy: fyOf(v.due), due: v.due, internal: v.internal, docs, cl: [...t.cl] };
        const n = await createFromOccurrences(a, client, [occ], { preparer_id: v.prep, reviewer_id: v.rev, priority: v.prio, docs }, true);
        if (!n) throw new Error(`${t.form} for ${v.period} already exists for this client.`);
        const { data } = await sb().from('compliance_tasks').select('id').eq('client_id', client.id).eq('template_key', t.key).eq('period', v.period).maybeSingle();
        createdId = data ? String((data as { id: string }).id) : '';
      }
      if (createdId) await logMessage(a, { channel: 'in_app', client_id: client.id, task_id: createdId, recipient: memberName(a.d, v.prep), purpose: 'Assignment', body: `New task for ${client.name} assigned to you.`, recipient_member_id: v.prep });
    });
    if (ok) { ui.closeModal(); if (createdId) ui.openDrawer('task', createdId); ui.toast(`Task created and assigned to ${memberName(a.d, v.prep)}.`); }
  };
  return (
    <Modal title="Create task" wide footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" onClick={save}>Create task</button></>}>
      <div className="fg">
        <Field label="Client" req full error={err.client}>
          <select className={`inp ${err.client ? 'err' : ''}`} value={v.client} onChange={(e) => (v.tpl && v.tpl !== 'custom' ? pickTpl(v.tpl, e.target.value) : setV({ ...v, client: e.target.value }))}>
            <Opts list={a.d.clients.map((c) => [c.id, c.name] as [string, string])} all="Select client…" />
          </select>
        </Field>
        <Field label="Compliance" req full error={err.tpl}>
          <select className={`inp ${err.tpl ? 'err' : ''}`} value={v.tpl} onChange={(e) => pickTpl(e.target.value)}>
            <Opts list={[...TEMPLATES.map((t) => [t.key, `${t.form} (${t.cat})`] as [string, string]), ['custom', 'Custom task…']]} all="Select…" />
          </select>
        </Field>
        {v.tpl === 'custom' && <Field label="Custom title" req full error={err.title}><input className={`inp ${err.title ? 'err' : ''}`} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} placeholder="e.g. DIR-3 KYC for directors" /></Field>}
        <Field label="Period"><input className="inp" value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })} placeholder="e.g. Oct 2026" disabled={v.tpl !== 'custom' && !!v.tpl} /></Field>
        <Field label="Category"><select className="inp" value={v.cat} onChange={(e) => setV({ ...v, cat: e.target.value })} disabled={v.tpl !== 'custom'}><Opts list={CATS} /></select></Field>
        <Field label="Priority"><select className="inp" value={v.prio} onChange={(e) => setV({ ...v, prio: e.target.value })}><Opts list={[['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']]} /></select></Field>
        <Field label="Preparer" req error={err.prep}><select className={`inp ${err.prep ? 'err' : ''}`} value={v.prep} onChange={(e) => setV({ ...v, prep: e.target.value })}><Opts list={preps.map((m) => [m.id, `${m.name} · ${m.role}`] as [string, string])} all="Select…" /></select></Field>
        <Field label="Reviewer" req error={err.rev}><select className={`inp ${err.rev ? 'err' : ''}`} value={v.rev} onChange={(e) => setV({ ...v, rev: e.target.value })}><Opts list={revs.map((m) => [m.id, `${m.name} · ${m.role}`] as [string, string])} all="Select…" /></select></Field>
        <Field label="Internal due date" req error={err.internal}><input className={`inp ${err.internal ? 'err' : ''}`} type="date" value={v.internal} onChange={(e) => setV({ ...v, internal: e.target.value })} /></Field>
        <Field label="Statutory due date" req error={err.due}><input className={`inp ${err.due ? 'err' : ''}`} type="date" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} /></Field>
        <Field label="Required documents" full><input className="inp" value={v.docs} onChange={(e) => setV({ ...v, docs: e.target.value })} placeholder="Comma-separated, e.g. Sales register, Bank statement" /></Field>
      </div>
      <div className="tiny muted" style={{ marginTop: 10 }}>Choosing a standard compliance fills the next due date, checklist and documents. Check the date against the official source; you can edit it.</div>
      {!revs.length && <div style={{ marginTop: 10 }}><Note kind="warn">Add a partner or manager in Team &amp; Workload so tasks have a reviewer.</Note></div>}
    </Modal>
  );
}

/* ================= Document request ================= */
export function RequestDocsModal({ clientId, taskId }: { clientId?: string; taskId?: string }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const [cid, setCid] = useState(clientId || '');
  const [tid, setTid] = useState(taskId || '');
  const task = a.d.tasks.find((t) => t.id === tid);
  const received = (n: string) => a.d.docs.some((x) => x.task_id === tid && x.name === n && x.status === 'received');
  const [picked, setPicked] = useState<string[]>(() => (task ? task.required_docs.filter((n) => !received(n)) : []));
  const [extra, setExtra] = useState('');
  const [ch, setCh] = useState<string[]>(['email', 'portal']);
  const tasks = a.d.tasks.filter((t) => t.client_id === cid && isOpen(t));
  const chooseTask = (id: string) => { setTid(id); const t = a.d.tasks.find((x) => x.id === id); setPicked(t ? t.required_docs.filter((n) => !a.d.docs.some((x) => x.task_id === id && x.name === n && x.status === 'received')) : []); };
  const save = async () => {
    const c = a.d.clients.find((x) => x.id === cid);
    const names = [...picked, ...(extra.trim() ? [extra.trim()] : [])];
    if (!c || !task || !names.length) { ui.toast('Pick a client, task and at least one document.', 'warn'); return; }
    if (!ch.length) { ui.toast('Choose at least one channel.', 'warn'); return; }
    const ok = await run(async () => {
      const today = todayISO();
      for (const n of names) {
        const ex = a.d.docs.find((x) => x.task_id === task.id && x.name === n);
        if (ex) { const { error } = await sb().from('documents').update({ status: 'requested', requested_on: today }).eq('id', ex.id); if (error) throw error; }
        else { const { error } = await sb().from('documents').insert({ firm_id: a.firm.id, client_id: c.id, task_id: task.id, name: n, fy: task.fy, status: 'requested', requested_on: today }); if (error) throw error; }
      }
      const docsNew = names.filter((n) => !task.required_docs.includes(n));
      const patch: Record<string, unknown> = {};
      if (docsNew.length) patch.required_docs = [...task.required_docs, ...docsNew];
      if (task.status === 'scheduled') patch.status = 'documents_requested';
      if (Object.keys(patch).length) await patchTask(task, patch);
      const body = `Dear ${c.contact_person || c.name},\n\nTo complete ${task.title}, please share:\n${names.map((x) => '• ' + x).join('\n')}\n\nYou can upload them through the client portal.\n\nRegards,\n${a.firm.name}`;
      if (ch.includes('email')) await logMessage(a, { channel: 'email', client_id: c.id, task_id: task.id, recipient: c.contact_person || c.name, to_addr: c.email, purpose: 'Document request', template: 'doc_request', body });
      if (ch.includes('whatsapp')) await logMessage(a, { channel: 'whatsapp', client_id: c.id, task_id: task.id, recipient: c.contact_person || c.name, to_addr: c.phone, purpose: 'Document request', template: 'doc_request', body: `${a.firm.name}: please share ${names.join(', ')} for ${task.title}.`, status: 'queued' });
      await addActivity(a, task, `Requested ${names.length} document(s) via ${ch.map((x) => (x === 'portal' ? 'client portal' : CHANNEL_LABEL[x])).join(', ')}`);
    }, `${names.length} document request(s) created. Email/WhatsApp messages are logged in Notifications, not sent.`, 'info');
    if (ok) ui.closeModal();
  };
  return (
    <Modal title="New document request" wide footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" onClick={save}>Create request</button></>}>
      <div className="fg">
        <Field label="Client" req><select className="inp" value={cid} onChange={(e) => { setCid(e.target.value); setTid(''); setPicked([]); }}><Opts list={a.d.clients.map((c) => [c.id, c.name] as [string, string])} all="Select client…" /></select></Field>
        <Field label="Related task" req><select className="inp" value={tid} onChange={(e) => chooseTask(e.target.value)}><Opts list={tasks.map((t) => [t.id, `${taskNo(t)} · ${t.title}`] as [string, string])} all={cid ? 'Select task…' : 'Select a client first'} /></select></Field>
        <Field label="Documents" req full>
          {task ? <div className="chks">{task.required_docs.map((n) => (
            <label className="chk" key={n}><input type="checkbox" checked={picked.includes(n)} onChange={(e) => setPicked(e.target.checked ? [...picked, n] : picked.filter((x) => x !== n))} />{n}</label>
          ))}{!task.required_docs.length && <span className="small muted">This task lists no documents yet; add one below.</span>}</div> : <span className="small muted">Pick a task to see its required documents.</span>}
        </Field>
        <Field label="Additional document" full><input className="inp" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Optional, e.g. Loan sanction letter" /></Field>
        <Field label="Send through" full>
          <div className="chks">{[['email', 'Email (logged, not sent)'], ['whatsapp', 'WhatsApp (queued: not configured)'], ['portal', 'Client portal']].map(([k, l]) => (
            <label className="chk" key={k}><input type="checkbox" checked={ch.includes(k)} onChange={(e) => setCh(e.target.checked ? [...ch, k] : ch.filter((x) => x !== k))} />{l}</label>
          ))}</div>
        </Field>
      </div>
    </Modal>
  );
}

/* ================= Upload a document (staff or client) ================= */
export function UploadDocModal({ doc }: { doc: Doc }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setMsg('File is over 10 MB. Choose a smaller file.'); setFile(null); return; }
    setMsg(''); setFile(f);
  };
  const go = async () => {
    if (!file) return;
    setBusy(true);
    const ok = await run(async () => {
      const path = await uploadFile(doc.firm_id, doc.client_id, file);
      if (a.role === 'client') {
        const { error } = await sb().rpc('client_upload_document', { p_doc: doc.id, p_path: path, p_name: file.name });
        if (error) throw error;
      } else {
        const { error } = await sb().from('documents').update({ status: 'awaiting_review', file_path: path, file_name: file.name, uploaded_on: todayISO(), comment: '' }).eq('id', doc.id);
        if (error) throw error;
        const t = a.d.tasks.find((x) => x.id === doc.task_id);
        if (t) {
          await addActivity(a, t, `Team uploaded ${doc.name}`);
          if (t.blocked) await patchTask(t, { blocked: '' });
          await pushInApp(a, t.preparer_id, t, 'Document received', `${clientName(a.d, doc.client_id)}: ${doc.name} uploaded.`);
        }
      }
    }, `${file.name} uploaded. Waiting for review.`);
    setBusy(false);
    if (ok) ui.closeModal();
  };
  return (
    <Modal title={`Upload: ${doc.name}`} footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" disabled={!file || busy} onClick={go}>{busy ? 'Uploading…' : 'Upload'}</button></>}>
      <Note>Files are stored privately for your firm. Only your firm{a.role === 'client' ? '' : ' and this client'} can open them.</Note>
      <label className="dz" htmlFor="up-file" style={{ display: 'block', cursor: 'pointer' }}
        onDragOver={(e: DragEvent<HTMLLabelElement>) => e.preventDefault()}
        onDrop={(e: DragEvent<HTMLLabelElement>) => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
        <Icon n="upload" /><div style={{ marginTop: 6 }}><b>Choose a file</b> or drop it here</div><div className="tiny">PDF, XLSX, CSV, JPG or PNG · up to 10 MB</div>
      </label>
      <input type="file" id="up-file" hidden accept=".pdf,.xlsx,.xls,.csv,.jpg,.jpeg,.png" onChange={(e) => pick(e.target.files?.[0])} />
      <div className="small" style={{ marginTop: 8 }}>{msg ? <span style={{ color: 'var(--bad)' }}>{msg}</span> : file ? <><span className="mono">{file.name}</span> · {Math.max(1, Math.round(file.size / 1024))} KB</> : null}</div>
    </Modal>
  );
}

/* ================= Reject a document ================= */
export function RejectDocModal({ doc }: { doc: Doc }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const [c, setC] = useState(''); const [err, setErr] = useState('');
  const go = async () => {
    if (!c.trim()) { setErr('Add a comment so the client knows what to fix.'); return; }
    const cl = a.d.clients.find((x) => x.id === doc.client_id);
    const ok = await run(async () => {
      const { error } = await sb().from('documents').update({ status: 'rejected', comment: c.trim(), reviewed_by: myName(a) }).eq('id', doc.id);
      if (error) throw error;
      if (cl) await logMessage(a, { channel: 'email', client_id: cl.id, task_id: doc.task_id, recipient: cl.contact_person || cl.name, to_addr: cl.email, purpose: 'Document rejected', template: 'doc_request', body: `Dear ${cl.contact_person || cl.name},\n\nWe could not use ${doc.name}: ${c.trim()}\nPlease upload a corrected copy.\n\nRegards,\n${a.firm.name}` });
      const t = a.d.tasks.find((x) => x.id === doc.task_id); if (t) await addActivity(a, t, `Rejected document ${doc.name}: ${c.trim()}`);
    }, 'Rejected. The client sees the comment in their portal; the email is logged, not sent.', 'info');
    if (ok) ui.closeModal();
  };
  return (
    <Modal title="Reject document" footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn danger" onClick={go}>Reject and notify</button></>}>
      <Field label="Comment for the client" req error={err}><textarea className={`inp ${err ? 'err' : ''}`} value={c} onChange={(e) => setC(e.target.value)} placeholder="What is wrong and what to send instead" /></Field>
    </Modal>
  );
}

/* ================= Compose / edit message ================= */
export function ComposeModal({ clientId, edit }: { clientId?: string; edit?: Message }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const tpls = a.d.settings?.templates || {};
  const firstTpl = edit ? edit.template : (tpls.doc_request ? 'doc_request' : '');
  const [v, setV] = useState({
    channel: (edit?.channel === 'whatsapp' ? 'whatsapp' : 'email') as Channel, tpl: firstTpl, client: edit?.client_id || clientId || '',
    task: edit?.task_id || '', when: edit?.status === 'scheduled' ? 'later' : 'now',
    at: edit?.scheduled_at ? edit.scheduled_at.slice(0, 16) : `${todayISO()}T10:00`, body: edit ? edit.body : (tpls[firstTpl]?.body || ''),
  });
  const c = a.d.clients.find((x) => x.id === v.client); const t = a.d.tasks.find((x) => x.id === v.task);
  const to = c ? (v.channel === 'whatsapp' ? `${c.contact_person || c.name} · ${c.phone}` : `${c.contact_person || c.name} <${c.email}>`) : 'Select a client';
  const save = async (draft: boolean) => {
    if (!c || !v.body.trim()) { ui.toast('Choose a client and write a message.', 'warn'); return; }
    if (!draft && v.when === 'later' && (!v.at || v.at.slice(0, 10) < todayISO())) { ui.toast('Pick a schedule time from today onward.', 'warn'); return; }
    const status: MsgStatus = draft ? 'draft' : v.when === 'later' ? 'scheduled' : v.channel === 'whatsapp' ? 'queued' : 'logged';
    const row = {
      channel: v.channel, client_id: c.id, task_id: t ? t.id : null, recipient: c.contact_person || c.name, to_addr: v.channel === 'whatsapp' ? c.phone : c.email,
      purpose: tpls[v.tpl]?.name || 'Custom message', template: v.tpl || 'custom', body: mergeTemplate(v.body, a, c, t), status,
      scheduled_at: v.when === 'later' ? new Date(v.at).toISOString() : new Date().toISOString(),
    };
    const ok = await run(async () => {
      if (edit) { const { error } = await sb().from('messages').update(row).eq('id', edit.id); if (error) throw error; }
      else await logMessage(a, row);
    }, status === 'draft' ? 'Draft saved.' : status === 'scheduled' ? 'Scheduled. It is logged; no provider is connected to send it.' : status === 'queued' ? 'Queued: WhatsApp is not configured, so nothing can be sent.' : 'Message logged. No email provider is connected, so it was not sent.', 'info');
    if (ok) ui.closeModal();
  };
  return (
    <Modal title={edit ? 'Edit message' : 'New message'} wide footer={<>
      <button type="button" className="btn" onClick={ui.closeModal}>Cancel</button>
      <button type="button" className="btn" onClick={() => save(true)}>Save draft</button>
      <button type="button" className="btn pri" onClick={() => save(false)}>Log message</button>
    </>}>
      <Note kind="warn">No email or WhatsApp provider is connected yet. Messages are recorded here so the team has a history, but nothing is delivered.</Note>
      <div className="fg">
        <Field label="Channel"><select className="inp" value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value as Channel })}><Opts list={[['email', 'Email'], ['whatsapp', 'WhatsApp']]} /></select></Field>
        <Field label="Template"><select className="inp" value={v.tpl} onChange={(e) => setV({ ...v, tpl: e.target.value, body: tpls[e.target.value]?.body || v.body })}><Opts list={Object.entries(tpls).map(([k, x]) => [k, x.name] as [string, string])} all="No template" /></select></Field>
        <Field label="Client" req><select className="inp" value={v.client} onChange={(e) => setV({ ...v, client: e.target.value, task: '' })}><Opts list={a.d.clients.map((x) => [x.id, x.name] as [string, string])} all="Select client…" /></select></Field>
        <Field label="Related task"><select className="inp" value={v.task} onChange={(e) => setV({ ...v, task: e.target.value })}><Opts list={a.d.tasks.filter((x) => x.client_id === v.client).map((x) => [x.id, `${taskNo(x)} · ${x.title}`] as [string, string])} all="None" /></select></Field>
        <Field label="Send"><select className="inp" value={v.when} onChange={(e) => setV({ ...v, when: e.target.value })}><Opts list={[['now', 'Now'], ['later', 'Schedule']]} /></select></Field>
        <Field label="Schedule for"><input className="inp" type="datetime-local" value={v.at} onChange={(e) => setV({ ...v, at: e.target.value })} disabled={v.when !== 'later'} /></Field>
        <Field label="Message" req full><textarea className="inp" rows={7} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
        <Field label="Preview as recipient sees it" full><div className="cmt" style={{ whiteSpace: 'pre-wrap', minHeight: 60 }}><div className="tiny muted" style={{ marginBottom: 4 }}>To: {to}</div>{mergeTemplate(v.body, a, c, t)}</div></Field>
      </div>
    </Modal>
  );
}

export function ViewMsgModal({ m }: { m: Message }) {
  const a = useApp(); const ui = useUI();
  return (
    <Modal title={m.purpose || 'Message'} footer={<>
      {m.task_id && a.role !== 'client' && <button type="button" className="btn" onClick={() => { ui.closeModal(); ui.openDrawer('task', m.task_id || ''); }}>Open task</button>}
      <button type="button" className="btn pri" onClick={ui.closeModal}>Close</button>
    </>}>
      <dl className="kv" style={{ marginBottom: 12 }}>
        <dt>Channel</dt><dd>{CHANNEL_LABEL[m.channel]}</dd><dt>To</dt><dd>{m.recipient} {m.to_addr && <span className="mono tiny muted">{m.to_addr}</span>}</dd>
        <dt>Status</dt><dd><Pill label={MSG_STATUS_LABEL[m.status] || m.status} /></dd><dt>Time</dt><dd>{fmtDT(m.scheduled_at || m.created_at)}</dd>
      </dl>
      <div className="cmt" style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div>
    </Modal>
  );
}

export function EditTemplateModal({ k }: { k: string }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const t = a.d.settings?.templates[k];
  const [ch, setCh] = useState<'Email' | 'WhatsApp'>(t?.channel || 'Email');
  const [body, setBody] = useState(t?.body || '');
  if (!t || !a.d.settings) return null;
  const save = async () => {
    if (!body.trim()) { ui.toast('Template body cannot be empty.', 'warn'); return; }
    const templates = { ...a.d.settings!.templates, [k]: { ...t, channel: ch, body: body.trim() } };
    const ok = await run(async () => { const { error } = await sb().from('firm_settings').update({ templates, updated_at: new Date().toISOString() }).eq('firm_id', a.firm.id); if (error) throw error; }, 'Template saved.');
    if (ok) ui.closeModal();
  };
  return (
    <Modal title={`Edit template: ${t.name}`} footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" onClick={save}>Save template</button></>}>
      <Field label="Default channel"><select className="inp" value={ch} onChange={(e) => setCh(e.target.value as 'Email' | 'WhatsApp')}><Opts list={['Email', 'WhatsApp']} /></select></Field>
      <div style={{ height: 10 }} />
      <Field label="Body" req><textarea className="inp" rows={8} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <div className="tiny muted" style={{ marginTop: 6 }}>Merge fields: {'{{contact}} {{client}} {{task}} {{due}} {{ack}} {{firm}}'}</div>
    </Modal>
  );
}

/* ================= Notices ================= */
export function LogNoticeModal() {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const owners = a.d.team.filter((m) => m.active && isReviewerRole(m));
  const [v, setV] = useState({ client: '', auth: 'GST', ref: '', subject: '', demand: '0', due: '', owner: owners[0]?.id || '', docRef: '' });
  const [err, setErr] = useState<Errs>({});
  const save = async () => {
    const e: Errs = {};
    if (!v.client) e.client = 'Required.'; if (!v.ref.trim()) e.ref = 'Required.'; if (!v.subject.trim()) e.subject = 'Required.';
    if (!v.due) e.due = 'Required.'; if (Number(v.demand) < 0 || Number.isNaN(Number(v.demand))) e.demand = 'Enter zero or more.';
    setErr(e); if (Object.keys(e).length) { ui.toast('Fill in the required fields.', 'warn'); return; }
    const ok = await run(async () => {
      const { error } = await sb().from('notices').insert({ firm_id: a.firm.id, client_id: v.client, authority: v.auth, ref: v.ref.trim(), subject: v.subject.trim(), demand: Number(v.demand) || 0, received_on: todayISO(), response_due: v.due, status: 'new', owner_id: v.owner || null, doc_ref: v.docRef.trim() });
      if (error) throw error;
    }, 'Notice logged.');
    if (ok) ui.closeModal();
  };
  return (
    <Modal title="Log notice" wide footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" onClick={save}>Save notice</button></>}>
      <div className="fg">
        <Field label="Client" req full error={err.client}><select className="inp" value={v.client} onChange={(e) => setV({ ...v, client: e.target.value })}><Opts list={a.d.clients.map((c) => [c.id, c.name] as [string, string])} all="Select client…" /></select></Field>
        <Field label="Authority"><select className="inp" value={v.auth} onChange={(e) => setV({ ...v, auth: e.target.value })}><Opts list={CATS} /></select></Field>
        <Field label="Notice / section" req error={err.ref}><input className="inp" value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} placeholder="e.g. ASMT-10" /></Field>
        <Field label="Subject" req full error={err.subject}><input className="inp" value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field>
        <Field label="Demand (₹)" error={err.demand}><input className="inp" type="number" min={0} value={v.demand} onChange={(e) => setV({ ...v, demand: e.target.value })} /></Field>
        <Field label="Response due" req error={err.due}><input className="inp" type="date" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} /></Field>
        <Field label="Owner"><select className="inp" value={v.owner} onChange={(e) => setV({ ...v, owner: e.target.value })}><Opts list={owners.map((m) => [m.id, m.name] as [string, string])} all="Unassigned" /></select></Field>
        <Field label="Document reference"><input className="inp mono" value={v.docRef} onChange={(e) => setV({ ...v, docRef: e.target.value })} placeholder="DIN / reference on the notice" /></Field>
      </div>
    </Modal>
  );
}

/* ================= Billing ================= */
export function NewInvoiceModal() {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const now = new Date();
  const [v, setV] = useState({ client: '', period: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][now.getMonth()]} ${now.getFullYear()}`, amt: '', due: addD(todayISO(), 15), draft: false });
  const save = async () => {
    if (!v.client || !v.period.trim() || !(Number(v.amt) > 0) || !v.due) { ui.toast('Pick a client, period, a fee above zero and a due date.', 'warn'); return; }
    const short = a.d.settings?.short_code || 'INV';
    const fy = fyOf(todayISO());
    const seq = a.d.invoices.filter((i) => i.invoice_no.includes(`/${fy}/`)).length + 101;
    const ok = await run(async () => {
      const { error } = await sb().from('invoices').insert({ firm_id: a.firm.id, client_id: v.client, invoice_no: `${short}/${fy}/${seq}`, period: v.period.trim(), amount: Math.round(Number(v.amt) * 1.18), issued_on: todayISO(), due_on: v.due, status: v.draft ? 'draft' : 'unpaid' });
      if (error) throw error;
    }, 'Invoice created.');
    if (ok) ui.closeModal();
  };
  return (
    <Modal title="New invoice" footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" onClick={save}>Create invoice</button></>}>
      <div className="fg">
        <Field label="Client" req full><select className="inp" value={v.client} onChange={(e) => setV({ ...v, client: e.target.value })}><Opts list={a.d.clients.map((c) => [c.id, c.name] as [string, string])} all="Select client…" /></select></Field>
        <Field label="Period" req><input className="inp" value={v.period} onChange={(e) => setV({ ...v, period: e.target.value })} /></Field>
        <Field label="Fee before GST (₹)" req><input className="inp" type="number" min={1} value={v.amt} onChange={(e) => setV({ ...v, amt: e.target.value })} /></Field>
        <Field label="Due date" req><input className="inp" type="date" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} /></Field>
        <label className="chk" style={{ alignSelf: 'end' }}><input type="checkbox" checked={v.draft} onChange={(e) => setV({ ...v, draft: e.target.checked })} />Save as draft (hidden from client)</label>
      </div>
      <div className="tiny muted" style={{ marginTop: 8 }}>18% GST is added to the fee. Amount with GST: {Number(v.amt) > 0 ? inr(Math.round(Number(v.amt) * 1.18)) : '—'}</div>
    </Modal>
  );
}

export function RecordPaymentModal({ inv }: { inv: Invoice }) {
  const ui = useUI(); const run = useRun();
  const [amt, setAmt] = useState(String(inv.amount)); const [dt, setDt] = useState(todayISO()); const [ref, setRef] = useState('');
  const save = async () => {
    if (Number(amt) !== inv.amount) { ui.toast('Part payments are not supported yet. Enter the full amount.', 'warn'); return; }
    if (!dt || dt > todayISO()) { ui.toast('Enter a payment date up to today.', 'warn'); return; }
    const ok = await run(async () => {
      const { error } = await sb().from('invoices').update({ status: 'paid', paid_note: `Recorded ${fmtD(dt)}${ref.trim() ? ' · ' + ref.trim() : ''}` }).eq('id', inv.id);
      if (error) throw error;
    }, `${inv.invoice_no} marked paid.`);
    if (ok) ui.closeModal();
  };
  return (
    <Modal title={`Record payment ${inv.invoice_no}`} footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" onClick={save}>Record payment</button></>}>
      <Note>This records a payment your firm already received. The app does not collect or move money.</Note>
      <div className="fg">
        <Field label="Amount received (₹)" req><input className="inp" type="number" value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
        <Field label="Received on" req><input className="inp" type="date" max={todayISO()} value={dt} onChange={(e) => setDt(e.target.value)} /></Field>
        <Field label="Reference" full><input className="inp" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="UTR or cheque number" /></Field>
      </div>
    </Modal>
  );
}

/* ================= Team ================= */
const DUP_EMAIL = 'Someone in this firm already uses that email.';
/** True for the unique-index error from 0007 (two active team members with one email). */
const isDupEmail = (e: unknown) => { const x = e as { code?: string; message?: string } | null; return x?.code === '23505' && !!x.message?.includes('team_members_firm_email_uniq'); };

export function TeamMemberModal({ m }: { m?: TeamMember }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const [v, setV] = useState({ name: m?.name || '', role: m?.role || 'Accountant', email: m?.email || '', capacity: String(m?.capacity ?? 16), active: m?.active ?? true });
  const [invite, setInvite] = useState(true); const [busy, setBusy] = useState(false);
  const isMe = !!m?.user_id && m.user_id === a.uid;
  const save = async () => {
    if (!v.name.trim()) { ui.toast('Enter a name.', 'warn'); return; }
    if (v.email && !EMAIL_RE.test(v.email)) { ui.toast('Enter a valid email or leave it blank.', 'warn'); return; }
    if (!m && invite && !v.email.trim()) { ui.toast('Enter an email to send a login invitation, or untick the invitation.', 'warn'); return; }
    const email = v.email.trim().toLowerCase();
    if (email && a.d.team.some((x) => x.id !== m?.id && x.email.trim().toLowerCase() === email)) { ui.toast(DUP_EMAIL, 'warn'); return; }
    const cap = Math.round(Number(v.capacity));
    if (!(cap >= 1 && cap <= 100)) { ui.toast('Capacity must be between 1 and 100 tasks.', 'warn'); return; }
    const row = { name: v.name.trim(), role: v.role, email: v.email.trim(), capacity: cap, active: v.active };
    if (m) {
      const ok = await run(async () => {
        const r = await sb().from('team_members').update(row).eq('id', m.id);
        if (r.error) throw isDupEmail(r.error) ? new Error(DUP_EMAIL) : r.error;
      }, m.user_id ? 'Team member updated. Their login now has the same role and access.' : 'Team member updated.');
      if (ok) ui.closeModal();
      return;
    }
    setBusy(true);
    const r = await sb().from('team_members').insert({ ...row, firm_id: a.firm.id }).select('id').single();
    if (r.error) { setBusy(false); ui.toast(isDupEmail(r.error) ? DUP_EMAIL : errMsg(r.error), 'warn'); return; }
    ui.closeModal();
    if (!invite) { await a.reload().catch(() => undefined); ui.toast(`${row.name} added to the team.`); return; }
    try {
      const res = await inviteMember(String(r.data.id));
      ui.toast(res === 'linked' ? `${row.name} already had an account and can now sign in to this firm.` : `${row.name} added. An invitation was emailed to ${row.email}.`);
    } catch (e) {
      ui.toast(`${row.name} was added, but the invitation was not sent: ${errMsg(e)} Use Send invite on the Team page to try again.`, 'warn');
    }
    await a.reload().catch(() => undefined);
  };
  return (
    <Modal title={m ? `Edit ${m.name}` : 'Add team member'} footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="fg">
        <Field label="Full name" req full><input className="inp" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Role"><select className="inp" value={v.role} disabled={isMe} onChange={(e) => setV({ ...v, role: e.target.value })}><Opts list={TEAM_ROLES} /></select></Field>
        <Field label="Weekly capacity (tasks)"><input className="inp" type="number" min={1} max={100} value={v.capacity} onChange={(e) => setV({ ...v, capacity: e.target.value })} /></Field>
        <Field label="Email" full><input className="inp" type="email" value={v.email} disabled={!!m?.user_id} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        {!m && <label className="chk full"><input type="checkbox" checked={invite} onChange={(e) => setInvite(e.target.checked)} />Email a login invitation (they set a password and join this firm with the role above)</label>}
        {m && !isMe && <label className="chk full"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />Active (inactive people are hidden from assignment lists{m.user_id ? ' and can no longer sign in to this firm' : ''})</label>}
      </div>
      <div className="tiny muted" style={{ marginTop: 8 }}>
        {m?.user_id ? 'This person has a login. Their role and active status apply to it straight away.'
          : 'Partners see everything including billing and settings; other roles get staff access. People without a login can still be assigned work.'}
      </div>
    </Modal>
  );
}

export function ReassignModal({ from }: { from?: string }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const people = a.d.team.filter((m) => m.active && m.role !== 'Managing Partner');
  const [f, setF] = useState(from || ''); const [to, setTo] = useState('');
  const open = useMemo(() => a.d.tasks.filter((t) => t.preparer_id === f && isOpen(t)), [a.d.tasks, f]);
  const [ids, setIds] = useState<string[]>(() => a.d.tasks.filter((t) => t.preparer_id === (from || '') && isOpen(t) && isOverdue(t)).map((t) => t.id));
  const target = a.d.team.find((m) => m.id === to);
  const load = (id: string) => a.d.tasks.filter((t) => (t.preparer_id === id && isOpen(t)) || (t.reviewer_id === id && (t.status === 'under_review' || t.status === 'prepared'))).length;
  const save = async () => {
    if (!f || !to || !ids.length) { ui.toast('Choose both people and at least one task.', 'warn'); return; }
    if (f === to) { ui.toast('Pick a different person to move work to.', 'warn'); return; }
    const ok = await run(async () => {
      for (const id of ids) {
        const t = a.d.tasks.find((x) => x.id === id); if (!t) continue;
        await patchTask(t, { preparer_id: to });
        await addActivity(a, t, `Preparer reassigned from ${memberName(a.d, f)} to ${memberName(a.d, to)}`);
        await pushInApp(a, to, t, 'Assignment', `You are now preparer on ${t.title} (${clientName(a.d, t.client_id)}).`);
      }
    }, `${ids.length} task(s) moved to ${memberName(a.d, to)}.`);
    if (ok) ui.closeModal();
  };
  return (
    <Modal title="Reassign tasks" wide footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" onClick={save}>Reassign selected</button></>}>
      <div className="fg">
        <Field label="From" req><select className="inp" value={f} onChange={(e) => { setF(e.target.value); setIds([]); }}><Opts list={people.map((m) => [m.id, `${m.name} · ${m.role}`] as [string, string])} all="Select person…" /></select></Field>
        <Field label="To" req><select className="inp" value={to} onChange={(e) => setTo(e.target.value)}><Opts list={people.map((m) => [m.id, `${m.name} · ${m.role}`] as [string, string])} all="Select person…" /></select></Field>
        <Field label="Open tasks as preparer" req full>
          {!f ? <span className="small muted">Choose who the work is moving from.</span> : !open.length ? <span className="small muted">No open tasks.</span> :
            <div className="cl">{open.map((t) => (
              <label key={t.id}><input type="checkbox" checked={ids.includes(t.id)} onChange={(e) => setIds(e.target.checked ? [...ids, t.id] : ids.filter((x) => x !== t.id))} />
                <span className="tag">{t.form}</span><span className="grow small">{clientName(a.d, t.client_id)}</span><span className="num small">{t.internal_due_date ? fmtD(t.internal_due_date) : '—'}</span></label>
            ))}</div>}
        </Field>
      </div>
      {target && <div className="tiny muted" style={{ marginTop: 8 }}>{target.name} goes from {Math.round((100 * load(target.id)) / target.capacity)}% to {Math.round((100 * (load(target.id) + ids.length)) / target.capacity)}% utilisation.</div>}
    </Modal>
  );
}

/* ================= Client portal access ================= */
export function InviteClientUserModal({ client }: { client: Client }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const [email, setEmail] = useState(client.email || '');
  const save = async () => {
    if (!EMAIL_RE.test(email.trim())) { ui.toast('Enter a valid email address.', 'warn'); return; }
    const ok = await run(async () => {
      const { error } = await sb().from('client_users').insert({ firm_id: a.firm.id, client_id: client.id, email: email.trim().toLowerCase(), invited_by: myName(a) });
      if (error) throw error;
    }, `Portal access added for ${email.trim()}. Ask them to sign up with this email at the app address.`);
    if (ok) ui.closeModal();
  };
  return (
    <Modal title={`Give portal access · ${client.name}`} footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" onClick={save}>Give access</button></>}>
      <Field label="Client user's email" req><input className="inp" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <div style={{ marginTop: 10 }}><Note>The person signs up (or signs in) with this exact email. Once their email is confirmed they see only {client.name}: its compliance timeline, filings, requested documents and invoices. No email is sent automatically, so share the app link with them yourself.</Note></div>
    </Modal>
  );
}

/* ================= Automation rules ================= */
export function RuleEditModal({ r }: { r: AutoRule }) {
  const ui = useUI(); const run = useRun();
  const [v, setV] = useState({ name: r.name, days: String(r.days), scope: r.scope, action: r.action });
  const usesDays = r.trig.includes('N days') || r.kind === 'evidence';
  const save = async () => {
    if (!v.name.trim() || !v.action.trim()) { ui.toast('Name and action are required.', 'warn'); return; }
    const days = Math.round(Number(v.days));
    if (usesDays && !(days >= 1 && days <= 60)) { ui.toast('Days must be between 1 and 60.', 'warn'); return; }
    const ok = await run(async () => { const { error } = await sb().from('automation_rules').update({ name: v.name.trim(), scope: v.scope.trim(), action: v.action.trim(), days: usesDays ? days : r.days }).eq('id', r.id); if (error) throw error; }, 'Rule saved.');
    if (ok) ui.closeModal();
  };
  return (
    <Modal title="Edit rule" footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn pri" onClick={save}>Save rule</button></>}>
      <div className="fg">
        <Field label="Rule name" req full><input className="inp" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        {usesDays && <Field label="Days (N)" req><input className="inp" type="number" min={1} max={60} value={v.days} onChange={(e) => setV({ ...v, days: e.target.value })} /></Field>}
        <Field label="Scope"><input className="inp" value={v.scope} onChange={(e) => setV({ ...v, scope: e.target.value })} /></Field>
        <Field label="Action" req full><textarea className="inp" value={v.action} onChange={(e) => setV({ ...v, action: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

interface RuleTarget { label: string; apply: () => Promise<void> }
export function useRuleTargets() {
  const a = useApp();
  return (r: AutoRule): RuleTarget[] => {
    const T = a.d.tasks.filter(isOpen); const today = todayISO();
    if (r.kind === 'generate') {
      return a.d.clients.filter((c) => c.gstin && c.services.includes('GST') && c.status !== 'inactive').flatMap((c) =>
        upcomingFor(c, today, 45, ['GSTR1', 'GSTR3B'])
          .filter((o) => !a.d.tasks.some((t) => t.client_id === c.id && t.template_key === o.key && t.period === o.period))
          .map((o) => ({ label: `Create ${o.form} ${o.period} for ${c.name}`, apply: async () => { await createFromOccurrences(a, c, [o]); } })));
    }
    if (r.kind === 'docs') {
      return a.d.docs.filter((d) => d.status === 'requested' || d.status === 'missing').filter((d) => {
        const t = a.d.tasks.find((x) => x.id === d.task_id); return !!t && !!t.internal_due_date && dDiff(t.internal_due_date) <= r.days;
      }).map((d) => {
        const c = a.d.clients.find((x) => x.id === d.client_id);
        return { label: `Request "${d.name}" from ${c?.contact_person || c?.name || 'client'}`, apply: async () => {
          if (!c) return;
          await logMessage(a, { channel: 'email', client_id: c.id, task_id: d.task_id, recipient: c.contact_person || c.name, to_addr: c.email, purpose: 'Document request', template: 'doc_request', body: `Dear ${c.contact_person || c.name},\n\nPlease share: ${d.name}.\n\nRegards,\n${a.firm.name}` });
          await sb().from('documents').update({ requested_on: today }).eq('id', d.id);
        } };
      });
    }
    if (r.kind === 'remind') return T.filter((t) => si(t.status) < 3 && t.internal_due_date && dDiff(t.internal_due_date) >= 0 && dDiff(t.internal_due_date) <= r.days)
      .map((t) => ({ label: `Remind ${memberName(a.d, t.preparer_id)} about ${taskNo(t)} ${t.title}`, apply: async () => { await pushInApp(a, t.preparer_id, t, 'Deadline reminder', `${t.title} for ${clientName(a.d, t.client_id)} is due internally on ${fmtD(t.internal_due_date)}.`); } }));
    if (r.kind === 'escalate') return T.filter(isOverdue).filter((t) => t.priority !== 'critical')
      .map((t) => ({ label: `Escalate ${taskNo(t)} to ${memberName(a.d, t.reviewer_id)} and set priority to Critical`, apply: async () => {
        await patchTask(t, { priority: 'critical' });
        await addActivity(a, t, 'Overdue: escalated to reviewer by rule', 'CAFlow automation');
        await pushInApp(a, t.reviewer_id, t, 'Overdue escalation', `${t.title} for ${clientName(a.d, t.client_id)} is overdue.`);
      } }));
    if (r.kind === 'review') return a.d.tasks.filter((t) => t.status === 'prepared')
      .map((t) => ({ label: `Move ${taskNo(t)} to Under Review and notify ${memberName(a.d, t.reviewer_id)}`, apply: async () => {
        await patchTask(t, { status: 'under_review' });
        await addActivity(a, t, 'Moved to Under Review by rule', 'CAFlow automation');
        await pushInApp(a, t.reviewer_id, t, 'Review request', `${t.title} is ready for your review.`);
      } }));
    if (r.kind === 'evidence') return a.d.tasks.filter((t) => (t.status === 'filed' || t.status === 'evidence_pending') && t.filing.evidence === 'awaiting_upload')
      .map((t) => ({ label: `Remind ${memberName(a.d, t.preparer_id)} to upload evidence for ${taskNo(t)}`, apply: async () => { await pushInApp(a, t.preparer_id, t, 'Evidence reminder', `Upload the acknowledgement for ${t.title}.`); } }));
    return [];
  };
}

export function RulePreviewModal({ r }: { r: AutoRule }) {
  const a = useApp(); const ui = useUI(); const run = useRun(); const targets = useRuleTargets();
  const tg = useMemo(() => targets(r), [r]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    setBusy(true);
    const ok = await run(async () => {
      for (const x of tg) await x.apply();
      const { error } = await sb().from('automation_rules').update({ last_run: `${fmtD(todayISO())} · ${tg.length} action(s) by ${myName(a)}` }).eq('id', r.id);
      if (error) throw error;
    }, `${tg.length} action(s) applied.`);
    setBusy(false);
    if (ok) ui.closeModal();
  };
  return (
    <Modal title={`Run now: ${r.name}`} wide footer={<><button type="button" className="btn" onClick={ui.closeModal}>Close</button>{tg.length > 0 && a.role === 'partner' && <button type="button" className="btn pri" disabled={busy} onClick={apply}>{busy ? 'Applying…' : `Apply ${tg.length} action(s)`}</button>}</>}>
      <Note>Preview against today's data. Nothing changes until you apply. Rules run when a partner presses Apply; there is no background scheduler yet, and messages are logged, not sent.</Note>
      {tg.length ? <><div className="tiny muted" style={{ marginBottom: 6 }}>{tg.length} action(s) would run</div>
        <div className="list card">{tg.slice(0, 40).map((x, i) => <div className="li small" key={i}><Icon n="check" /><span>{x.label}</span></div>)}</div>
        {tg.length > 40 && <div className="tiny muted" style={{ marginTop: 6 }}>…and {tg.length - 40} more</div>}</>
        : <Empty title="Nothing to do" text="No records currently meet this rule's conditions." />}
    </Modal>
  );
}

/* ================= Calendar day ================= */
export function CalDayModal({ date, tasks }: { date: string; tasks: Task[] }) {
  const a = useApp(); const ui = useUI();
  return (
    <Modal title={`Obligations on ${fmtD(date)}`}>
      <div className="list">{tasks.map((t) => (
        <div className="li click" key={t.id} onClick={() => { ui.closeModal(); ui.openDrawer(a.role === 'client' ? 'filing' : 'task', t.id); }}>
          <span className="tag">{t.form}</span><div className="main-t"><div className="ttl">{clientName(a.d, t.client_id)}</div><div className="tiny muted">{t.period} · {memberName(a.d, t.preparer_id)}</div></div><Pill label={STATUS_LABEL[t.status]} />
        </div>
      ))}</div>
    </Modal>
  );
}

/* ================= Evidence reject ================= */
export function RejectEvidenceModal({ t }: { t: Task }) {
  const a = useApp(); const ui = useUI(); const run = useRun();
  const [v, setV] = useState('');
  const go = async () => {
    if (!v.trim()) { ui.toast('Give a reason so the preparer can fix it.', 'warn'); return; }
    const ok = await run(async () => {
      await patchTask(t, { filing: { ...t.filing, evidence: 'awaiting_upload', ev_rejected: v.trim() } });
      await addActivity(a, t, 'Evidence rejected: ' + v.trim());
      await pushInApp(a, t.preparer_id, t, 'Evidence rejected', `Evidence for ${t.title} was rejected: ${v.trim()}`);
    }, 'Evidence rejected.');
    if (ok) ui.closeModal();
  };
  return (
    <Modal title="Reject evidence" footer={<><button type="button" className="btn" onClick={ui.closeModal}>Cancel</button><button type="button" className="btn danger" onClick={go}>Reject</button></>}>
      <Field label="Reason" req><textarea className="inp" value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. Acknowledgement number on the file does not match" /></Field>
    </Modal>
  );
}

export { STATUSES, changeStatus, can, errMsg };
