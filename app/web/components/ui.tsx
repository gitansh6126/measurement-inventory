// Ported from references for final inven/marble 2110/frontend1/components/ui.tsx (2026-10-13);
// only the two lib imports are replaced by local helpers.
'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeftIcon, SearchIcon } from '@/components/icons';

// Local replacements for marble lib/docTypes STATUS_COLORS and lib/format isoDate.
const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  INACTIVE: 'bg-slate-200 text-slate-600',
  ARCHIVED: 'bg-slate-200 text-slate-600',
};
// Calendar date in India (decision D8), YYYY-MM-DD.
const isoDate = (d: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

// Compact page header: title (+ optional badge) with a short note beside it, actions on the right.
export function PageHeader({ title, subtitle, actions, back, badge }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; back?: { href?: string; label: string; onClick?: () => void }; badge?: React.ReactNode }) {
  return (
    <div className="no-print mb-3">
      {back && (
        back.onClick && !back.href ? (
          <button type="button" onClick={back.onClick} className="mb-0.5 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-600">
            <ArrowLeftIcon className="h-3.5 w-3.5" /> {back.label}
          </button>
        ) : (
          <Link href={back.href ?? "#"} onClick={back.onClick} className="mb-0.5 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-600">
            <ArrowLeftIcon className="h-3.5 w-3.5" /> {back.label}
          </Link>
        )
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900">{title}{badge}</h1>
          {subtitle && <span className="text-sm text-slate-500">{subtitle}</span>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

// ---- Stats strip ----

const STRIP_COLS = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5' } as const;

export function StatStrip({ children, cols = 4 }: { children: React.ReactNode; cols?: keyof typeof STRIP_COLS }) {
  return <div className={`card mb-3 grid grid-cols-2 ${STRIP_COLS[cols]} lg:divide-x lg:divide-slate-100`}>{children}</div>;
}

export type Tone = 'slate' | 'blue' | 'green' | 'red' | 'orange' | 'violet';
const TONE_BG: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-600', blue: 'bg-sky-100 text-sky-600', green: 'bg-emerald-100 text-emerald-600',
  red: 'bg-rose-100 text-rose-600', orange: 'bg-brand-100 text-brand-600', violet: 'bg-violet-100 text-violet-600',
};

// One cell of a stats strip: small icon, label, value with a short note beside it. Clickable when `onClick` is set.
export function StatCell({ icon, label, value, sub, tone = 'slate', onClick, active }: { icon?: React.ReactNode; label: string; value: React.ReactNode; sub?: string; tone?: Tone; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      {icon && <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${TONE_BG[tone]}`}>{icon}</span>}
      <span className="min-w-0 leading-tight">
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <span className="flex items-baseline gap-2">
          <span className={`whitespace-nowrap text-base font-semibold ${tone === 'red' ? 'text-rose-600' : 'text-slate-900'}`}>{value}</span>
          {sub && <span className="truncate text-xs text-slate-500">{sub}</span>}
        </span>
      </span>
    </>
  );
  const cls = 'flex w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left sm:px-4';
  if (!onClick) return <div className={cls} title={sub ? `${label}: ${sub}` : undefined}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${cls} transition-colors duration-150 hover:bg-slate-50 active:bg-slate-100 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${active ? 'bg-brand-50 hover:bg-brand-100/70' : ''}`}
    >
      {body}
    </button>
  );
}

// ---- Toolbar pieces ----

export function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="card mb-3 flex flex-wrap items-center gap-2 p-2">{children}</div>;
}

export function SearchInput({ value, onChange, placeholder = 'Search…', className = '' }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={`relative min-w-[200px] flex-1 ${className}`}>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input className="input pl-9 pr-8" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:scale-90 transition-all duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          aria-label="Clear search"
        >
          ×
        </button>
      )}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; title?: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-[13px] font-medium transition-all duration-150 select-none cursor-pointer active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800 hover:bg-white/60'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type Period = { from: string; to: string };
type Preset = 'all' | 'today' | 'week' | 'month' | 'lastMonth' | 'fy' | 'custom';

// Indian financial year runs April–March.
function presetRange(p: Preset): Period {
  const t = new Date();
  const d = (y: number, m: number, day: number) => isoDate(new Date(y, m, day));
  switch (p) {
    case 'today': return { from: isoDate(t), to: isoDate(t) };
    case 'week': return { from: d(t.getFullYear(), t.getMonth(), t.getDate() - 6), to: isoDate(t) };
    case 'month': return { from: d(t.getFullYear(), t.getMonth(), 1), to: isoDate(t) };
    case 'lastMonth': return { from: d(t.getFullYear(), t.getMonth() - 1, 1), to: d(t.getFullYear(), t.getMonth(), 0) };
    case 'fy': { const y = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1; return { from: d(y, 3, 1), to: d(y + 1, 2, 31) }; }
    default: return { from: '', to: '' };
  }
}

// Date-range filter with quick presets; "Custom range…" reveals two date boxes.
export function PeriodFilter({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const [preset, setPreset] = useState<Preset>(() => (value.from || value.to ? 'custom' : 'all'));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        className="input w-auto pr-8"
        value={preset}
        aria-label="Period"
        onChange={(e) => {
          const p = e.target.value as Preset;
          setPreset(p);
          if (p !== 'custom') onChange(presetRange(p));
        }}
      >
        <option value="all">All dates</option>
        <option value="today">Today</option>
        <option value="week">Last 7 days</option>
        <option value="month">This month</option>
        <option value="lastMonth">Last month</option>
        <option value="fy">This financial year</option>
        <option value="custom">Custom range…</option>
      </select>
      {preset === 'custom' && (
        <>
          <input className="input w-auto" type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="From date" />
          <span className="text-slate-400">–</span>
          <input className="input w-auto" type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="To date" />
        </>
      )}
    </div>
  );
}

// ---- Pagination ----

// Page numbers with gaps, e.g. 1 … 4 5 6 … 12.
function pageList(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  if (page <= 3) [2, 3, 4].forEach((p) => keep.add(p));
  if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach((p) => keep.add(p));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
}

// "Showing 1–25 of 132 · [25 / page] · ‹ 1 2 3 … ›". Changing page scrolls the list back into view:
// `anchorId` names the element to scroll to; by default the surrounding card.
export function Pagination({ state, label = 'rows', anchorId, className = '' }: { state: { page: number; pages: number; pageSize: number; total: number; from: number; to: number; setPage: (p: number) => void; setPageSize: (n: number) => void }; label?: string; anchorId?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { page, pages, pageSize, total, from, to } = state;
  if (!total) return null;

  function go(p: number) {
    state.setPage(p);
    const target = (anchorId ? document.getElementById(anchorId) : ref.current?.closest('.card')) as HTMLElement | null;
    if (target && target.getBoundingClientRect().top < 40) {
      target.style.scrollMarginTop = '40px';
      target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  const btn = 'flex h-7 min-w-[28px] items-center justify-center rounded-md px-2 text-xs font-medium transition-all duration-150 select-none cursor-pointer active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100';
  return (
    <div ref={ref} className={`no-print flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-2 text-xs text-slate-500 ${className}`}>
      <div className="flex items-center gap-2">
        <span>
          Showing <b className="text-slate-800">{from}–{to}</b> of <b className="text-slate-800">{total}</b> {label}
        </span>
        <select
          className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-700 outline-none focus:border-brand-500"
          value={pageSize}
          onChange={(e) => state.setPageSize(Number(e.target.value))}
          aria-label="Rows per page"
        >
          {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
      </div>
      {pages > 1 && (
        <nav className="flex items-center gap-1" aria-label="Pagination">
          <button type="button" className={`${btn} text-slate-600 hover:bg-slate-100`} disabled={page === 1} onClick={() => go(page - 1)} aria-label="Previous page">‹ Prev</button>
          {pageList(page, pages).map((p, i) =>
            p === '…' ? (
              <span key={`gap-${i}`} className="px-1 text-slate-400">…</span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => go(p)}
                aria-current={p === page ? 'page' : undefined}
                className={`${btn} ${p === page ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {p}
              </button>
            )
          )}
          <button type="button" className={`${btn} text-slate-600 hover:bg-slate-100`} disabled={page === pages} onClick={() => go(page + 1)} aria-label="Next page">Next ›</button>
        </nav>
      )}
    </div>
  );
}

// ---- Misc ----

const AVATAR_COLORS = [
  'bg-orange-100 text-orange-700', 'bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700', 'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-700', 'bg-teal-100 text-teal-700', 'bg-indigo-100 text-indigo-700',
];

// Initials tile; the same seed always gets the same colour.
export function Avatar({ name, seed, muted, size = 'md' }: { name: string; seed?: string; muted?: boolean; size?: 'sm' | 'md' }) {
  const h = [...(seed || name)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const dims = size === 'sm' ? 'h-8 w-8 text-xs rounded-md' : 'h-10 w-10 text-sm rounded-lg';
  return <span className={`flex shrink-0 items-center justify-center font-bold ${dims} ${muted ? 'bg-slate-200 text-slate-500' : AVATAR_COLORS[h % AVATAR_COLORS.length]}`}>{initials}</span>;
}

export function EmptyState({ icon, title, children, action }: { icon?: React.ReactNode; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      {icon && <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">{icon}</span>}
      <h3 className="mt-3 font-semibold text-slate-900">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-slate-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-2 p-4" aria-hidden>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-8 rounded bg-slate-100" />)}
    </div>
  );
}

export function Field({
  label,
  children,
  className = '',
  error,
  id,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  error?: string;
  id?: string;
}) {
  return (
    <label className={`block ${className}`} id={id}>
      <span className="label">{label}</span>
      {children}
      {error && (
        <span className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-rose-600 animate-fade-in" role="alert">
          <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          {error}
        </span>
      )}
    </label>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[status] || 'bg-slate-100 text-slate-700'}`}>{status.replace(/_/g, ' ')}</span>;
}

export function Alert({ message, children, kind = 'error' }: { message?: string | null; children?: React.ReactNode; kind?: 'error' | 'success' }) {
  if (!message && !children) return null;
  const cls = kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  // Audit M3: announced to screen readers and findable by automation (getByRole('alert' | 'status')).
  return <div role={kind === 'error' ? 'alert' : 'status'} className={`mb-4 rounded-md border px-3 py-2 text-sm ${cls}`}>{children ?? message}</div>;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ open, title, onClose, children, wide, xl }: { open: boolean; title: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean; xl?: boolean }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // Latest onClose without re-running the focus effect when a parent passes a new function.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    // Audit M3: focus moves into the dialog, Tab stays inside it, and focus returns on close.
    const opener = document.activeElement as HTMLElement | null;
    const node = panel.current;
    const items = () => Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    // First form field, else the dialog itself — never a button, so Enter cannot confirm by accident.
    const field = items().find((el) => /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));
    (field ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return close.current();
      if (e.key !== 'Tab' || !node) return;
      const list = items();
      if (!list.length) return;
      const first = list[0]!;
      const last = list[list.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16" onMouseDown={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`card w-full outline-none ${xl ? 'max-w-5xl' : wide ? 'max-w-3xl' : 'max-w-lg'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 id={titleId} className="font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            data-modal-close="true"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:scale-90 transition-all duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// Accessible on/off toggle. Stops click propagation so it can sit inside clickable rows/headers.
export function Switch({ checked, onChange, label, title, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; title?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label || title}
      title={title}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 rounded"
    >
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label && <span className={checked ? 'text-emerald-700' : 'text-slate-500'}>{label}</span>}
    </button>
  );
}

export type MenuItem = { label: string; onClick: () => void; danger?: boolean; icon?: React.ReactNode };

// Small "⋯" dropdown; closes on outside click or Escape. `trigger` swaps the "⋯" for a labelled primary button.
export function Menu({ items, label = 'More actions', compact = false, align = 'right', trigger }: { items: MenuItem[]; label?: string; compact?: boolean; align?: 'left' | 'right'; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      {trigger ? (
        <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="btn-primary">
          {trigger}
        </button>
      ) : (
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className={`flex ${compact ? 'h-6 w-6' : 'h-9 w-9'} items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 active:scale-95 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}
      >
        <svg className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      )}
      {open && (
        <div className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} z-30 mt-1 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg`} role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); it.onClick(); }}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors duration-150 cursor-pointer ${
                it.danger
                  ? 'text-rose-600 hover:bg-rose-50 active:bg-rose-100'
                  : 'text-slate-700 hover:bg-slate-50 active:bg-slate-100'
              }`}
            >
              {it.icon && <span className="opacity-70">{it.icon}</span>}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-12 text-center text-sm text-slate-500">{children}</div>;
}

export function Stat({ label, value, hint, tone = 'slate' }: { label: string; value: string; hint?: string; tone?: 'slate' | 'green' | 'red' | 'orange' | 'blue' }) {
  const tones = { slate: 'text-slate-900', green: 'text-emerald-600', red: 'text-rose-600', orange: 'text-brand-600', blue: 'text-sky-600' };
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tones[tone]}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

/**
 * DeliveryDatePicker: allows selecting or typing a delivery date with quick preset options:
 * "Today", "Tomorrow", "3 days", "5 days", "7 days", or custom date.
 */
export function DeliveryDatePicker({
  id,
  value,
  onChange,
  className = "",
}: {
  id?: string;
  value: string;
  onChange: (val: string) => void;
  className?: string;
}) {
  const getDateStr = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  };

  const today = getDateStr(0);
  const tomorrow = getDateStr(1);
  const in3Days = getDateStr(3);
  const in5Days = getDateStr(5);
  const in7Days = getDateStr(7);

  let selectedPreset = "";
  if (!value) {
    selectedPreset = "";
  } else if (value === today) {
    selectedPreset = "today";
  } else if (value === tomorrow) {
    selectedPreset = "tomorrow";
  } else if (value === in3Days) {
    selectedPreset = "3days";
  } else if (value === in5Days) {
    selectedPreset = "5days";
  } else if (value === in7Days) {
    selectedPreset = "7days";
  } else {
    selectedPreset = "custom";
  }

  const handleSelectPreset = (preset: string) => {
    if (preset === "today") onChange(today);
    else if (preset === "tomorrow") onChange(tomorrow);
    else if (preset === "3days") onChange(in3Days);
    else if (preset === "5days") onChange(in5Days);
    else if (preset === "7days") onChange(in7Days);
    else if (preset === "clear") onChange("");
  };

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input flex-1 min-w-[140px] text-xs py-1.5"
          value={selectedPreset}
          onChange={(e) => handleSelectPreset(e.target.value)}
          aria-label="Preset delivery date"
        >
          <option value="">Choose preset…</option>
          <option value="today">Today ({today})</option>
          <option value="tomorrow">Tomorrow ({tomorrow})</option>
          <option value="3days">3 days ({in3Days})</option>
          <option value="5days">5 days ({in5Days})</option>
          <option value="7days">7 days ({in7Days})</option>
          {selectedPreset === "custom" && <option value="custom">Custom date ({value})</option>}
          {value && <option value="clear">Clear date</option>}
        </select>
        <input
          id={id}
          type="date"
          className="input flex-1 min-w-[130px] text-xs py-1.5"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Custom delivery date"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-[11px] text-slate-400 mr-0.5">Quick:</span>
        <button
          type="button"
          onClick={() => onChange(today)}
          className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            value === today
              ? "border-brand-500 bg-brand-50 text-brand-700 font-semibold"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => onChange(tomorrow)}
          className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            value === tomorrow
              ? "border-brand-500 bg-brand-50 text-brand-700 font-semibold"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          Tomorrow
        </button>
        <button
          type="button"
          onClick={() => onChange(in3Days)}
          className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            value === in3Days
              ? "border-brand-500 bg-brand-50 text-brand-700 font-semibold"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          3 days
        </button>
        <button
          type="button"
          onClick={() => onChange(in5Days)}
          className={`rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            value === in5Days
              ? "border-brand-500 bg-brand-50 text-brand-700 font-semibold"
              : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          5 days
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded border border-transparent px-1.5 py-0.5 text-[11px] text-slate-400 hover:text-rose-600 ml-auto"
            title="Clear date"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

