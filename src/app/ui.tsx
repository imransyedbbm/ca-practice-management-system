import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import { STATUS_CLS } from './constants';
import { dDiff, fmtDs, initials } from './util';
import type { Risk, Priority } from './types';

/* ---------- navigation / overlay context ---------- */
export type Filters = Record<string, string>;
export interface UICtx {
  page: string; params: Record<string, string>;
  go: (page: string, params?: Record<string, string>) => void;
  drawer: { kind: string; id: string } | null;
  openDrawer: (kind: string, id: string) => void; closeDrawer: () => void;
  modal: ReactNode | null; openModal: (node: ReactNode) => void; closeModal: () => void;
  toast: (msg: string, kind?: 'ok' | 'warn' | 'info') => void;
  f: (page: string, defs?: Filters) => Filters;
  setF: (page: string, key: string, value: string) => void;
  setFAll: (page: string, values: Filters) => void;
  fy: string; setFy: (v: string) => void;
  search: string; setSearch: (v: string) => void;
}
export const UI = createContext<UICtx | null>(null);
export function useUI(): UICtx {
  const v = useContext(UI);
  if (!v) throw new Error('UI context missing');
  return v;
}

/* ---------- icons (from the prototype) ---------- */
const IC: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z', users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8',
  cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4', tasks: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2', file: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6',
  folder: 'M3 7h6l2 2h10v10H3z', alert: 'M12 3 2 20h20zM12 10v4M12 17v.5', bell: 'M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4', team: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', bill: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6', book: 'M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4zM4 16a4 4 0 0 1 4-4h10',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4', cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 14H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.7 3.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4', help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17v.5', plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6 6 18',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5M12 8v.5', moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5', menu: 'M4 6h16M4 12h16M4 18h16', down: 'M12 4v12M6 11l6 6 6-6M5 20h14',
  ext: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6', upload: 'M12 16V4M6 9l6-6 6 6M5 20h14', send: 'M3 11l18-8-8 18-2-8z', check: 'M5 12l5 5 9-10', out: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3',
};
export function Icon({ n }: { n: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={IC[n] || IC.info} />
    </svg>
  );
}

/* ---------- small display pieces ---------- */
export function Pill({ label, cls, nodot }: { label: string; cls?: string; nodot?: boolean }) {
  return <span className={`pill ${cls ?? STATUS_CLS[label] ?? ''} ${nodot ? 'nodot' : ''}`}>{label}</span>;
}
export function PrioPill({ p }: { p: Priority }) {
  const label = p.charAt(0).toUpperCase() + p.slice(1);
  return <span className={`pill nodot ${p === 'critical' ? 'bad' : p === 'high' ? 'warn' : p === 'medium' ? 'info' : ''}`}>{label}</span>;
}
export function RiskTag({ r }: { r: Risk }) {
  return <span className={`risk ${r}`}><i />{r}</span>;
}
export function Who({ name }: { name: string }) {
  return <span className="who"><span className="av">{initials(name)}</span>{name}</span>;
}
export function DueCell({ date, closed }: { date: string | null | undefined; closed?: boolean }) {
  if (!date) return <span className="faint">—</span>;
  const d = dDiff(date);
  const cls = closed ? '' : d < 0 ? 'due-od' : d <= 7 ? 'due-soon' : '';
  const rel = closed ? '' : d < 0 ? `${-d}d overdue` : d === 0 ? 'today' : `in ${d}d`;
  return <><span className={`num ${cls}`}>{fmtDs(date)}</span>{rel && <> <span className={`tiny ${cls || 'faint'}`}>{rel}</span></>}</>;
}
export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{text}{action && <div style={{ marginTop: 10 }}>{action}</div>}</div>;
}
export function Note({ kind, children }: { kind?: 'warn' | 'bad'; children: ReactNode }) {
  return <div className={`note ${kind || ''}`}><Icon n={kind ? 'alert' : 'info'} /><div>{children}</div></div>;
}
export function Field({ label, req, full, error, children }: { label: string; req?: boolean; full?: boolean; error?: string; children: ReactNode }) {
  return (
    <div className={`fld ${full ? 'full' : ''}`}>
      <label>{label}{req && <> <span className="req">*</span></>}</label>
      {children}
      {error && <div className="ferr">{error}</div>}
    </div>
  );
}
export function Bar({ pct, cls, width }: { pct: number; cls?: string; width?: number }) {
  return <div className={`bar ${cls || ''}`} style={width ? { width } : undefined}><span style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>;
}
export function Tabs({ tabs, value, onChange }: { tabs: [string, string, number?][]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, l, n]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>
          {l}{n != null && <span className="cnt">{n}</span>}
        </button>
      ))}
    </div>
  );
}
export function Steps({ labels, stage }: { labels: string[]; stage: number }) {
  return (
    <div className="steps">
      {labels.map((s, i) => (
        <div key={s} className={`step ${i < stage ? 'done' : i === stage ? 'cur' : ''}`}><span className="c">{i < stage ? '✓' : i + 1}</span>{s}</div>
      ))}
    </div>
  );
}
export function Timeline({ items }: { items: { text: string; who: string; when: string }[] }) {
  if (!items.length) return <div className="small muted">Nothing yet.</div>;
  return <div className="tl">{items.map((a, i) => <div className="te" key={i}><div>{a.text}</div><div className="w">{a.who} · {a.when}</div></div>)}</div>;
}
export function Opts({ list, all }: { list: (string | [string, string])[]; all?: string }) {
  return (
    <>
      {all != null && <option value="">{all}</option>}
      {list.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{l}</option>; })}
    </>
  );
}

/* ---------- overlays ---------- */
export function Modal({ title, wide, children, footer }: { title: string; wide?: boolean; children: ReactNode; footer?: ReactNode }) {
  const ui = useUI();
  return (
    <div className="scrim center" onMouseDown={(e) => { if (e.target === e.currentTarget) ui.closeModal(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="dh2"><h2>{title}</h2><button type="button" className="iconbtn" onClick={ui.closeModal} aria-label="Close"><Icon n="x" /></button></div>
        <div className="db">{children}</div>
        {footer && <div className="df">{footer}</div>}
      </div>
    </div>
  );
}
export function DrawerFrame({ head, children, footer }: { head: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const ui = useUI();
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) ui.closeDrawer(); }}>
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="dh2"><div style={{ flex: 1, minWidth: 0 }}>{head}</div><button type="button" className="iconbtn" onClick={ui.closeDrawer} aria-label="Close"><Icon n="x" /></button></div>
        <div className="db">{children}</div>
        {footer && <div className="df">{footer}</div>}
      </aside>
    </div>
  );
}
export function Confirm({ title, text, ok, danger, onOk }: { title: string; text: ReactNode; ok: string; danger?: boolean; onOk: () => void | Promise<void> }) {
  const ui = useUI();
  return (
    <Modal title={title} footer={<>
      <button type="button" className="btn" onClick={ui.closeModal}>Cancel</button>
      <button type="button" className={`btn ${danger ? 'danger' : 'pri'}`} onClick={() => { ui.closeModal(); void onOk(); }}>{ok}</button>
    </>}>
      <p style={{ margin: 0 }}>{text}</p>
    </Modal>
  );
}
export function useEscape(fn: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') fn(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [fn]);
}

/* ---------- charts ---------- */
export const C = { a: 'var(--accent)', ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', vio: 'var(--info)', mute: 'var(--line-2)', fg2: 'var(--fg-2)' };
const niceMax = (v: number) => { if (v <= 5) return 5; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
export function BarChart({ labels, series, stacked, label, height }: { labels: string[]; series: { name: string; color: string; values: number[] }[]; stacked?: boolean; label: string; height?: number }) {
  const W = 560, H = height || 200, pl = 34, pr = 8, pt = 10, pb = 24;
  const totals = labels.map((_, i) => (stacked ? series.reduce((a, s) => a + (s.values[i] || 0), 0) : Math.max(0, ...series.map((s) => s.values[i] || 0))));
  const mx = niceMax(Math.max(1, ...totals));
  const cw = (W - pl - pr) / Math.max(1, labels.length);
  const bw = stacked ? Math.min(34, cw * 0.55) : Math.min(16, (cw * 0.7) / Math.max(1, series.length));
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / mx);
  return (
    <>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label}>
        <g className="grid">
          {[0, 1, 2, 3, 4].map((k) => { const v = (mx * k) / 4; return <g key={k}><line x1={pl} x2={W - pr} y1={y(v)} y2={y(v)} /><text x={pl - 6} y={y(v) + 3.5} textAnchor="end">{Math.round(v)}</text></g>; })}
        </g>
        {labels.map((l, i) => {
          const cx = pl + cw * i + cw / 2; let acc = 0;
          return (
            <g key={l + i}>
              {series.map((s, j) => {
                const v = s.values[i] || 0;
                if (stacked) {
                  const y0 = y(acc), y1 = y(acc + v); acc += v;
                  return v > 0 ? <rect key={j} x={cx - bw / 2} y={y1} width={bw} height={Math.max(0, y0 - y1)} fill={s.color} rx="1.5"><title>{`${l} · ${s.name}: ${v}`}</title></rect> : null;
                }
                const x = cx - (series.length * bw) / 2 + j * bw;
                return <rect key={j} x={x + 1} y={y(v)} width={Math.max(1, bw - 2)} height={Math.max(0, y(0) - y(v))} fill={s.color} rx="1.5"><title>{`${l} · ${s.name}: ${v}`}</title></rect>;
              })}
              <text x={cx} y={H - 7} textAnchor="middle">{l}</text>
            </g>
          );
        })}
      </svg>
      <div className="legend" style={{ marginTop: 6 }}>{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</div>
    </>
  );
}
export function HBars({ items }: { items: { label: string; value: number; max?: number; text?: string; cls?: string }[] }) {
  if (!items.length) return <div className="small muted">No data yet.</div>;
  const mx = Math.max(1, ...items.map((i) => i.max ?? i.value));
  return (
    <div className="list">
      {items.map((i, k) => {
        const pct = Math.round((100 * i.value) / (i.max ?? mx));
        return (
          <div key={i.label + k} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,150px) minmax(0,1fr) 64px', gap: 10, alignItems: 'center', padding: '5px 0', fontSize: 12.5 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.label}</span>
            <Bar pct={pct} cls={i.cls} />
            <span className="num" style={{ textAlign: 'right' }}>{i.text ?? i.value}</span>
          </div>
        );
      })}
    </div>
  );
}
export function Stack({ parts, height }: { parts: { n: number; color: string; title: string }[]; height?: number }) {
  const tot = parts.reduce((a, p) => a + p.n, 0) || 1;
  return <div className="stack" style={{ height: height || 10 }}>{parts.map((p, i) => (p.n ? <span key={i} style={{ width: `${(100 * p.n) / tot}%`, background: p.color }} title={`${p.title}: ${p.n}`} /> : null))}</div>;
}
