import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, createFirm, authLinkError } from './lib';
import { Ctx, EMPTY, loadFirmData, loadMemberships, loadPortalData, roleOf, sb, clientName } from './app/store';
import type { AppCtx } from './app/store';
import { UI, Icon, Modal, Pill, Empty, useUI } from './app/ui';
import type { UICtx, Filters } from './app/ui';
import type { FirmData, Firm, Membership, Role } from './app/types';
import { errMsg, initials, isOverdue, fmtDT } from './app/util';
import { Dashboard, Clients, ClientDetail, Calendar, Tasks, Filings, Documents } from './app/pages1';
import { Notices, Notifications, Team, Reports, Billing, Rules, Integrations, SettingsPage, SearchResults } from './app/pages2';
import { TaskDrawer, FilingDrawer, RuleDrawer } from './app/drawers';
import { ViewMsgModal } from './app/modals';

type NavItem = [id: string, label: string, icon: string, roles: string];
const NAV: [string, NavItem[]][] = [
  ['Practice', [['dashboard', 'Dashboard', 'home', 'pac'], ['clients', 'Clients', 'users', 'pa'], ['calendar', 'Compliance Calendar', 'cal', 'pac'], ['tasks', 'Tasks & Workflows', 'tasks', 'pa'], ['filings', 'Regulatory Filings', 'file', 'pac'], ['documents', 'Documents', 'folder', 'pac'], ['notices', 'Notices & Assessments', 'alert', 'pa'], ['notifications', 'Notifications', 'bell', 'pac']]],
  ['Firm', [['team', 'Team & Workload', 'team', 'pa'], ['reports', 'Reports', 'chart', 'p'], ['billing', 'Billing', 'bill', 'pc'], ['rules', 'Compliance Rules', 'book', 'pa'], ['integrations', 'Integrations', 'plug', 'p'], ['settings', 'Settings', 'cog', 'pa']]],
];
const roleKey = (r: Role) => ({ partner: 'p', accountant: 'a', client: 'c' })[r];
const allowed = (page: string, r: Role) => (page === 'client' ? r !== 'client' : NAV.some(([, items]) => items.some((i) => i[0] === page && i[3].includes(roleKey(r)))));
const PAGES: Record<string, () => ReactNode> = {
  dashboard: () => <Dashboard />, clients: () => <Clients />, client: () => <ClientDetail />, calendar: () => <Calendar />, tasks: () => <Tasks />,
  filings: () => <Filings />, documents: () => <Documents />, notices: () => <Notices />, notifications: () => <Notifications />, team: () => <Team />,
  reports: () => <Reports />, billing: () => <Billing />, rules: () => <Rules />, integrations: () => <Integrations />, settings: () => <SettingsPage />,
};

/* ================= Root: session & routing between screens ================= */
type Phase = { k: 'loading' } | { k: 'signedout' } | { k: 'setpassword' } | { k: 'nofirm'; uid: string; email: string } | { k: 'error'; msg: string }
  | { k: 'staff'; uid: string; email: string; memberships: Membership[] } | { k: 'client'; uid: string; email: string };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ k: 'loading' });
  const resolve = useCallback(async (user: User | null) => {
    if (!user) { setPhase({ k: 'signedout' }); return; }
    const uid = user.id; const email = user.email ?? '';
    // Invited team members arrive through the email link without a password.
    if (user.user_metadata?.needs_password) { setPhase({ k: 'setpassword' }); return; }
    try {
      await Promise.all([
        sb().rpc('claim_team_invites').then(() => undefined, () => undefined),
        sb().rpc('claim_client_access').then(() => undefined, () => undefined),
      ]);
      const ms = await loadMemberships(uid);
      if (ms.length) { setPhase({ k: 'staff', uid, email, memberships: ms }); return; }
      const { data } = await sb().from('client_users').select('id').eq('user_id', uid).limit(1);
      if (data && data.length) { setPhase({ k: 'client', uid, email }); return; }
      setPhase({ k: 'nofirm', uid, email });
    } catch (e) { setPhase({ k: 'error', msg: errMsg(e) }); }
  }, []);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => { if (alive) void resolve(data.session?.user ?? null); });
    const { data: sub } = supabase.auth.onAuthStateChange((ev, session) => {
      if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT' || ev === 'USER_UPDATED') void resolve(session?.user ?? null);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [resolve]);
  useEffect(() => { try { const th = localStorage.getItem('caflow-theme'); if (th) document.documentElement.dataset.theme = th; } catch { /* storage unavailable */ } }, []);

  if (!isSupabaseConfigured) return <Centered><h1>Connect the database</h1><p className="muted">Set <span className="mono">VITE_SUPABASE_URL</span> and <span className="mono">VITE_SUPABASE_ANON_KEY</span> (in <span className="mono">.env</span> locally, or in Vercel's environment variables), then rebuild.</p></Centered>;
  if (phase.k === 'loading') return <Centered><div className="row"><span className="spin" /> Loading…</div></Centered>;
  if (phase.k === 'error') return <Centered><h1>Something went wrong</h1><p className="muted">{phase.msg}</p><button type="button" className="btn" onClick={() => window.location.reload()}>Try again</button></Centered>;
  if (phase.k === 'signedout') return <AuthScreen />;
  if (phase.k === 'setpassword') return <SetPasswordScreen />;
  if (phase.k === 'nofirm') return <CreateFirmScreen email={phase.email} onDone={() => void sb().auth.getUser().then(({ data }) => resolve(data.user))} />;
  return <Workspace key={phase.uid} uid={phase.uid} email={phase.email} memberships={phase.k === 'staff' ? phase.memberships : []} portal={phase.k === 'client'} />;
}

/** Anupal mark: an open checkbox with a tick that runs out of it. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" style={{ flex: 'none', display: 'block' }}>
      <rect width="64" height="64" rx="15" fill="#2348D8" />
      <path d="M37 17H21a4 4 0 0 0-4 4v22a4 4 0 0 0 4 4h22a4 4 0 0 0 4-4V35" fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 31.5l7.5 7.5L50 15" fill="none" stroke="#5EE6B8" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const AUTH_POINTS: [string, string][] = [
  ['Every deadline in one calendar', 'GST, income tax, TDS and ROC dates for every client, with internal targets and owners.'],
  ['Review before anything is filed', 'Preparer, reviewer and partner sign-off, then acknowledgement and evidence on record.'],
  ['A secure portal for your clients', 'Clients upload documents and track filings. Each firm sees only its own data.'],
];

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="auth-split">
      <aside className="auth-hero" aria-label="About Anupal">
        <div className="auth-logo"><BrandMark size={44} /><span>Anupal</span></div>
        <div className="auth-pitch">
          <div className="auth-eyebrow">Practice management for CA firms</div>
          <h2>One workspace for your clients, compliance and team.</h2>
          <p>Track statutory deadlines, run every return through review, and keep filing evidence on record, from one secure workspace.</p>
          <ul className="auth-points">{AUTH_POINTS.map(([t, d]) => (
            <li key={t}><span className="auth-tick" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg></span><div><b>{t}</b><span>{d}</span></div></li>
          ))}</ul>
        </div>
        <div className="auth-foot">Anupal · Made for Indian chartered accountants</div>
      </aside>
      <main className="auth-side">
        <div className="auth-logo auth-logo-sm"><BrandMark size={34} /><span>Anupal</span></div>
        <div className="auth-card">{children}</div>
        <div className="auth-legal">Each firm's data is kept separate and checked on every request.</div>
      </main>
    </div>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [v, setV] = useState({ name: '', email: '', password: '' });
  const [msg, setMsg] = useState<{ kind: 'bad' | 'ok'; text: string } | null>(authLinkError ? { kind: 'bad', text: authLinkError } : null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setMsg(null);
    if (!v.email.trim() || v.password.length < 8) { setMsg({ kind: 'bad', text: 'Enter your email and a password of at least 8 characters.' }); return; }
    setBusy(true);
    try {
      if (mode === 'signup') {
        const { data, error } = await sb().auth.signUp({ email: v.email.trim(), password: v.password, options: { data: { full_name: v.name.trim() }, emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (!data.session) setMsg({ kind: 'ok', text: 'Account created. Check your email to confirm it, then sign in.' });
      } else {
        const { error } = await sb().auth.signInWithPassword({ email: v.email.trim(), password: v.password });
        if (error) throw error;
      }
    } catch (err) { setMsg({ kind: 'bad', text: errMsg(err) }); }
    setBusy(false);
  };
  return (
    <Centered>
      <h1>{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
      <p className="small muted" style={{ marginTop: 0 }}>{mode === 'signin' ? 'Sign in to continue to your practice workspace.' : 'Start a workspace for your CA firm. Clients: use the email your CA gave portal access to.'}</p>
      <form onSubmit={submit} className="auth-form">
        {mode === 'signup' && <div className="fld"><label>Full name</label><input className="inp" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoComplete="name" /></div>}
        <div className="fld"><label>Email address</label><input className="inp" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} autoComplete="email" required /></div>
        <div className="fld"><label>Password</label><input className="inp" type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required /></div>
        {msg && <div className={`note ${msg.kind === 'bad' ? 'bad' : ''}`}><Icon n={msg.kind === 'bad' ? 'alert' : 'info'} /><div>{msg.text}</div></div>}
        <button type="submit" className="btn pri" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
      </form>
      <div className="small auth-switch">{mode === 'signin' ? <>Don't have an account? <button type="button" className="linkbtn" onClick={() => { setMode('signup'); setMsg(null); }}>Create account</button></> : <>Already registered? <button type="button" className="linkbtn" onClick={() => { setMode('signin'); setMsg(null); }}>Sign in</button></>}</div>
    </Centered>
  );
}

function SetPasswordScreen() {
  const [v, setV] = useState({ password: '', confirm: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  useEffect(() => { void sb().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? '')); }, []);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setErr('');
    if (v.password.length < 8) { setErr('Use a password of at least 8 characters.'); return; }
    if (v.password !== v.confirm) { setErr('The two passwords do not match.'); return; }
    setBusy(true);
    // USER_UPDATED then moves the app on to the firm workspace.
    const { error } = await sb().auth.updateUser({ password: v.password, data: { needs_password: false } });
    if (error) { setErr(errMsg(error)); setBusy(false); }
  };
  return (
    <Centered>
      <h1>Set your password</h1>
      <p className="small muted" style={{ marginTop: 0 }}>You were invited to join your firm on Anupal{email ? <> as <b>{email}</b></> : null}. Choose a password to finish setting up your login.</p>
      <form onSubmit={submit} className="auth-form">
        <div className="fld"><label>New password</label><input className="inp" type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete="new-password" required /></div>
        <div className="fld"><label>Confirm password</label><input className="inp" type="password" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} autoComplete="new-password" required /></div>
        {err && <div className="note bad"><Icon n="alert" /><div>{err}</div></div>}
        <button type="submit" className="btn pri" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Saving…' : 'Set password and continue'}</button>
      </form>
      <div className="row" style={{ marginTop: 12 }}><button type="button" className="btn sm ghost" onClick={() => void sb().auth.signOut()}>Sign out</button></div>
    </Centered>
  );
}

function CreateFirmScreen({ email, onDone }: { email: string; onDone: () => void }) {
  const [v, setV] = useState({ name: '', city: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setErr('');
    if (!v.name.trim()) { setErr('Enter your CA firm name.'); return; }
    setBusy(true);
    try { await createFirm(v.name, v.city); onDone(); } catch (x) { setErr(errMsg(x)); }
    setBusy(false);
  };
  return (
    <Centered>
      <h1>Set up your firm</h1>
      <p className="small muted" style={{ marginTop: 0 }}>Signed in as {email}. Create your CA firm workspace; you become its managing partner.</p>
      <div className="note"><Icon n="info" /><div>Joining an existing firm? Ask a partner there to add <b>{email}</b> on the Team page and send you an invitation, then reload this page.</div></div>
      <div className="note"><Icon n="info" /><div>Are you a client of a CA firm? Ask them to give <b>{email}</b> portal access, make sure your email is confirmed, then reload this page.</div></div>
      <form onSubmit={submit} className="auth-form">
        <div className="fld"><label>Firm name</label><input className="inp" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
        <div className="fld"><label>City</label><input className="inp" value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} /></div>
        {err && <div className="note bad"><Icon n="alert" /><div>{err}</div></div>}
        <button type="submit" className="btn pri" disabled={busy} style={{ justifyContent: 'center' }}>{busy ? 'Creating…' : 'Create firm'}</button>
      </form>
      <div className="row" style={{ marginTop: 12 }}><button type="button" className="btn sm ghost" onClick={() => window.location.reload()}>Reload</button><button type="button" className="btn sm ghost" onClick={() => void sb().auth.signOut()}>Sign out</button></div>
    </Centered>
  );
}

/* ================= Signed-in workspace ================= */
function Workspace({ uid, email, memberships, portal }: { uid: string; email: string; memberships: Membership[]; portal: boolean }) {
  const [firmId, setFirmId] = useState<string>(() => { try { const s = localStorage.getItem('caflow-firm'); if (s && memberships.some((m) => m.firm_id === s)) return s; } catch { /* ignore */ } return memberships[0]?.firm_id || ''; });
  const [d, setD] = useState<FirmData>(EMPTY);
  const [portalFirm, setPortalFirm] = useState<Firm | null>(null);
  const [portalClientId, setPortalClientId] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadErr, setLoadErr] = useState('');
  const membership = memberships.find((m) => m.firm_id === firmId) || null;
  const role: Role = portal ? 'client' : roleOf(membership);
  const reload = useCallback(async () => {
    try {
      if (portal) {
        const r = await loadPortalData(); setD(r.data); setPortalFirm(r.firm);
        setPortalClientId((cur) => (cur && r.data.clients.some((c) => c.id === cur) ? cur : r.data.clients[0]?.id || ''));
      } else if (firmId) setD(await loadFirmData(firmId, roleOf(memberships.find((m) => m.firm_id === firmId) || null) === 'partner'));
      setState('ready');
    } catch (e) { setLoadErr(errMsg(e)); setState('error'); }
  }, [portal, firmId, memberships]);
  useEffect(() => { setState('loading'); void reload(); }, [reload]);

  const firm: Firm = portal ? (portalFirm || { id: '', name: 'Your CA firm', city: '' }) : (membership?.firm || { id: firmId, name: '', city: '' });
  const me = d.team.find((m) => m.user_id === uid) || null;
  const app: AppCtx = {
    uid, email, role, firm, memberships, me, d, reload,
    switchFirm: (id) => { try { localStorage.setItem('caflow-firm', id); } catch { /* ignore */ } setFirmId(id); },
    signOut: () => { void sb().auth.signOut(); },
    portalClientId, setPortalClientId,
  };

  /* UI state */
  const [page, setPage] = useState('dashboard'); const [params, setParams] = useState<Record<string, string>>({});
  const [drawer, setDrawer] = useState<{ kind: string; id: string } | null>(null);
  const [modal, setModal] = useState<ReactNode | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const [filters, setFilters] = useState<Record<string, Filters>>({});
  const [fy, setFy] = useState('all'); const [search, setSearch] = useState('');
  const [sideOpen, setSideOpen] = useState(false); const [pop, setPop] = useState('');
  const toast = useCallback((msg: string, kind: 'ok' | 'warn' | 'info' = 'ok') => {
    const id = Date.now() + Math.random(); setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4800);
  }, []);
  const ui: UICtx = {
    page, params,
    go: (p, prm) => { if (!allowed(p, role)) { toast('Your role cannot open that page.', 'warn'); return; } setPage(p); setParams(prm || {}); setSearch(''); setSideOpen(false); setPop(''); document.querySelector('.content')?.scrollTo(0, 0); },
    drawer, openDrawer: (kind, id) => setDrawer({ kind, id }), closeDrawer: () => setDrawer(null),
    modal, openModal: (n) => setModal(n), closeModal: () => setModal(null), toast,
    f: (p, defs = {}) => ({ ...defs, ...(filters[p] || {}) }),
    setF: (p, k, v) => setFilters((all) => ({ ...all, [p]: { ...(all[p] || {}), [k]: v } })),
    setFAll: (p, vals) => setFilters((all) => ({ ...all, [p]: vals })),
    fy, setFy, search, setSearch,
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key !== 'Escape') return; if (modal) setModal(null); else if (drawer) setDrawer(null); else setPop(''); };
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h);
  }, [modal, drawer]);
  useEffect(() => { if (!allowed(page, role)) setPage('dashboard'); }, [role, page]);

  const fys = useMemo(() => [...new Set(d.tasks.map((t) => t.fy).filter(Boolean))].sort().reverse(), [d.tasks]);
  const myInApp = d.msgs.filter((m) => m.channel === 'in_app' && (role === 'partner' || !me || m.recipient_member_id === me.id));
  const unread = role === 'client' ? 0 : myInApp.filter((m) => !m.read).length;
  const badge = (id: string) => {
    if (role === 'client') return null;
    const n = id === 'tasks' ? d.tasks.filter(isOverdue).length : id === 'notifications' ? unread : id === 'notices' ? d.notices.filter((x) => x.status === 'new').length : id === 'documents' ? d.docs.filter((x) => x.status === 'awaiting_review').length : 0;
    return n ? <span className={`badge ${id === 'tasks' || id === 'notices' ? 'red' : ''}`}>{n}</span> : null;
  };
  const toggleTheme = () => {
    const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    r.dataset.theme = dark ? 'light' : 'dark'; try { localStorage.setItem('caflow-theme', r.dataset.theme); } catch { /* ignore */ }
  };
  const myName = me?.name || email.split('@')[0];
  const roleLabel = role === 'partner' ? 'Partner' : role === 'accountant' ? 'Staff' : 'Client user';
  const cur = page === 'client' ? 'clients' : page;

  let content: ReactNode;
  if (state === 'loading') content = <div className="card"><div className="card-b">{Array.from({ length: 6 }).map((_, i) => <div className="skel" key={i} style={{ margin: '10px 0' }} />)}</div></div>;
  else if (state === 'error') content = <div className="card"><Empty title="Could not load your data" text={loadErr} action={<button type="button" className="btn" onClick={() => { setState('loading'); void reload(); }}>Retry</button>} /></div>;
  else if (portal && !d.clients.length) content = <div className="card"><Empty title="No company linked yet" text="Your access may have been removed. Contact your CA firm." /></div>;
  else content = search ? <SearchResults /> : (PAGES[page] || PAGES.dashboard)();

  return (
    <Ctx.Provider value={app}><UI.Provider value={ui}>
      <div className="app">
        <aside className={`side ${sideOpen ? 'open' : ''}`} aria-label="Main navigation">
          <div className="brand"><BrandMark size={30} /><div><div className="brand-name">Anupal</div><div className="brand-sub">{d.settings?.short_code || initials(firm.name)}{firm.city ? ` · ${firm.city}` : ''}</div></div></div>
          <nav className="nav">{NAV.map(([sec, items]) => { const vis = items.filter((i) => i[3].includes(roleKey(role))); if (!vis.length) return null; return (
            <div key={sec}><div className="nav-sec">{sec}</div>{vis.map(([id, l, ic]) => (
              <button type="button" key={id} className={cur === id ? 'on' : ''} aria-current={cur === id ? 'page' : undefined} onClick={() => ui.go(id)}>
                <Icon n={ic} /><span>{role === 'client' && id === 'dashboard' ? 'My compliance' : l}</span>{badge(id)}
              </button>))}</div>); })}</nav>
          <div className="side-foot">{firm.name}<br />Due dates must be checked against official sources.</div>
        </aside>
        <div className="main">
          <header className="top">
            <button type="button" className="iconbtn menu-toggle" onClick={() => setSideOpen(!sideOpen)} aria-label="Open navigation"><Icon n="menu" /></button>
            <div className="search"><Icon n="search" /><input className="inp" placeholder="Search clients, tasks, forms, ack numbers…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Global search" autoComplete="off" /></div>
            <div className="top-sp" />
            <div className="rel"><button type="button" className="btn" onClick={() => setPop(pop === 'firm' ? '' : 'firm')} disabled={portal || memberships.length < 2} aria-haspopup="true" title={memberships.length < 2 ? firm.name : 'Switch firm'}><span className="hide-sm">{firm.name}</span><span className="tag">{d.settings?.short_code || initials(firm.name)}</span></button>
              {pop === 'firm' && <div className="pop" role="menu"><div className="ph2">Switch firm</div>{memberships.map((m) => <button type="button" key={m.firm_id} className={`mi ${m.firm_id === firmId ? 'on' : ''}`} onClick={() => { setPop(''); app.switchFirm(m.firm_id); setPage('dashboard'); setFilters({}); setDrawer(null); }}>{m.firm.name}<span className="faint small" style={{ marginLeft: 'auto' }}>{m.firm.city}</span></button>)}</div>}</div>
            <select className="inp" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Financial year"><option value="all">All financial years</option>{fys.map((x) => <option key={x} value={x}>FY {x}</option>)}</select>
            {role !== 'client' && <div className="rel"><button type="button" className="iconbtn" onClick={() => setPop(pop === 'bell' ? '' : 'bell')} aria-label="Notifications"><Icon n="bell" />{unread > 0 && <span className="dot">{unread}</span>}</button>
              {pop === 'bell' && <BellPop items={myInApp.slice(0, 6)} close={() => setPop('')} />}</div>}
            <button type="button" className="iconbtn" onClick={() => setModal(<HelpModal />)} aria-label="Help"><Icon n="help" /></button>
            <button type="button" className="iconbtn" onClick={toggleTheme} aria-label="Toggle dark mode"><Icon n="moon" /></button>
            <div className="rel"><button type="button" className="btn ghost" onClick={() => setPop(pop === 'user' ? '' : 'user')} aria-haspopup="true"><span className="av">{initials(myName)}</span><span className="hide-sm">{myName}</span></button>
              {pop === 'user' && <div className="pop" role="menu"><div className="ph2">Signed in</div><div style={{ padding: '4px 10px 8px' }}><div className="strong">{myName}</div><div className="tiny muted">{email} · {roleLabel}</div></div>
                <button type="button" className="mi" onClick={() => { setPop(''); app.signOut(); }}><Icon n="out" />Sign out</button></div>}</div>
          </header>
          {role === 'client' && <div className="demo-strip"><b>Client portal</b> You are viewing {portalClientId ? clientName(d, portalClientId) : 'your company'}'s records shared by {firm.name}.</div>}
          <main className="content" id="content" onClick={() => pop && setPop('')}>{content}</main>
        </div>
      </div>
      {sideOpen && <div className="scrim" style={{ zIndex: 45 }} onClick={() => setSideOpen(false)} />}
      {drawer && state === 'ready' && (drawer.kind === 'task' && role !== 'client' ? <TaskDrawer id={drawer.id} /> : drawer.kind === 'rule' && role !== 'client' ? <RuleDrawer id={drawer.id} /> : <FilingDrawer id={drawer.id} />)}
      {modal}
      <div className="toast-wrap" aria-live="polite">{toasts.map((t) => <div className="toast" role="status" key={t.id}><span>{t.kind === 'warn' ? '⚠' : t.kind === 'info' ? '◇' : '✓'}</span><span>{t.msg}</span></div>)}</div>
    </UI.Provider></Ctx.Provider>
  );
}

function BellPop({ items, close }: { items: FirmData['msgs']; close: () => void }) {
  const ui = useUI();
  const open = async (id: string) => {
    const m = items.find((x) => x.id === id); close();
    if (!m) return;
    if (!m.read) await sb().from('messages').update({ read: true }).eq('id', m.id);
    if (m.task_id) ui.openDrawer('task', m.task_id); else ui.openModal(<ViewMsgModal m={m} />);
  };
  return (
    <div className="pop" style={{ width: 340 }} role="menu">
      <div className="row" style={{ padding: '4px 8px' }}><b className="grow">In-app alerts</b></div>
      {items.length ? items.map((m) => <button type="button" key={m.id} className="mi" style={{ alignItems: 'flex-start' }} onClick={() => void open(m.id)}><Pill label={m.read ? 'Read' : 'New'} cls={m.read ? '' : 'bad'} nodot /><div><div className="small">{m.body}</div><div className="tiny faint">{m.purpose} · {fmtDT(m.scheduled_at || m.created_at)}</div></div></button>) : <Empty title="No alerts" text="You are all caught up." />}
      <div style={{ padding: '6px 8px' }}><button type="button" className="btn sm" onClick={() => { close(); ui.go('notifications'); }}>Open notifications centre</button></div>
    </div>
  );
}

function HelpModal() {
  const ui = useUI();
  return (
    <Modal title="Help" footer={<button type="button" className="btn pri" onClick={ui.closeModal}>Done</button>}>
      <div className="sec"><h4>Getting around</h4><p style={{ margin: '0 0 8px' }}>Use the sidebar to move between modules. Dashboard tiles open the matching filtered list. Click any task, filing or calendar entry to open its detail panel.</p>
        <dl className="kv"><dt>Esc</dt><dd>Close the open panel or dialog</dd><dt>Kanban</dt><dd>Drag cards between columns, or change status in the task panel</dd><dt>Financial year</dt><dd>The selector in the top bar filters tasks and documents</dd></dl></div>
      <div className="sec"><h4>What is not automatic yet</h4><p style={{ margin: 0 }}>Nothing is filed with GSTN, the Income Tax Department or MCA, and no email or WhatsApp is sent: those need provider connections (see Integrations). Messages are logged for the team. Automation rules run when a partner presses Run now. Due dates follow standard patterns and must be checked against official notifications.</p></div>
    </Modal>
  );
}
