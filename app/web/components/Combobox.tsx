// Ported unchanged from references for final inven/marble 2110/frontend1/components/Combobox.tsx (2026-10-13).
'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type ComboOption = {
  id: string;
  label: string;
  sublabel?: string;
  meta?: React.ReactNode; // right-aligned extra (price, stock…)
  keywords?: string; // extra searchable text
};

type Props = {
  value: string | null;
  options: ComboOption[];
  onSelect: (id: string | null) => void;
  // Shown in the box when the selected value isn't among `options` (e.g. a not-yet-saved new party).
  selectedLabel?: string;
  badge?: React.ReactNode;
  onCreate?: (query: string, abbr?: string) => void;
  createLabel?: (query: string) => string;
  // Adds an optional "Abbr" box to the create row; its text is passed to onCreate.
  createAbbr?: boolean;
  placeholder?: string;
  emptyText?: string;
  minMenuWidth?: number;
  limit?: number;
  autoFocus?: boolean;
  required?: boolean;
  inputId?: string;
};

// Every typed word must appear somewhere in the option's text ("chain 1t3" matches "Chain Block – 1T3MTR…").
function matches(o: ComboOption, tokens: string[]) {
  if (!tokens.length) return true;
  const hay = `${o.label} ${o.sublabel || ''} ${o.keywords || ''}`.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

// Searchable select with keyboard support and an optional "create new" row.
// The menu is portalled to <body> with fixed positioning so scrolling containers can't clip it.
export function Combobox({
  value, options, onSelect, selectedLabel, badge, onCreate, createLabel = (q) => `Add “${q}”`, placeholder = 'Search…',
  emptyText = 'No matches', minMenuWidth = 320, limit = 60, autoFocus, required, inputId, createAbbr,
}: Props) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const abbrRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [abbr, setAbbr] = useState('');
  const [active, setActive] = useState(0);
  const touched = useRef(false); // arrow key pressed since the menu opened
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);

  const selected = options.find((o) => o.id === value);
  const shownLabel = selected?.label ?? selectedLabel ?? '';

  const tokens = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const filtered = useMemo(() => options.filter((o) => matches(o, tokens)), [options, tokens]);
  const visible = filtered.slice(0, limit);
  const q = query.trim();
  const canCreate = !!onCreate && !!q && !options.some((o) => o.label.toLowerCase() === q.toLowerCase());
  const rowCount = visible.length + (canCreate ? 1 : 0);

  const place = useCallback(() => {
    const r = inputRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(Math.max(r.width, minMenuWidth), window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    if (below < 240 && above > below) setPos({ left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(360, above - 4) });
    else setPos({ left, width, top: r.bottom + 4, maxHeight: Math.min(360, below - 4) });
  }, [minMenuWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, place]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!inputRef.current?.parentElement?.contains(t) && !menuRef.current?.contains(t)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlighted row in view.
  useEffect(() => {
    if (open) menuRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function openMenu() {
    touched.current = false;
    setQuery('');
    const idx = visible.findIndex((o) => o.id === value);
    setActive(idx >= 0 ? idx : 0);
    setOpen(true);
  }
  function close() {
    setOpen(false);
    setQuery('');
    setAbbr('');
  }
  function choose(row: number) {
    if (row < visible.length) onSelect(visible[row].id);
    else if (canCreate) onCreate!(q, createAbbr ? abbr.trim() : undefined);
    close();
  }

  // Enter navigation (lib/enterNav.ts): Enter picks the row only after typing or an arrow key;
  // otherwise (and when the menu is closed) it is left to move on to the next field.
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && e.key === 'ArrowDown') { e.preventDefault(); openMenu(); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); touched.current = true; setActive((a) => Math.min(a + 1, rowCount - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); touched.current = true; setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter' && (e.shiftKey || (!touched.current && !q))) close();
    else if (e.key === 'Enter') { e.preventDefault(); if (rowCount) choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab' && createAbbr && canCreate && !e.shiftKey) { e.preventDefault(); abbrRef.current?.focus(); }
    else if (e.key === 'Tab') close();
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && rowCount ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        required={required && !value && !selectedLabel}
        className={`input ${!open && badge ? 'pr-24' : 'pr-14'} ${!open && shownLabel ? 'font-medium text-slate-900' : ''}`}
        placeholder={open ? shownLabel || placeholder : placeholder}
        value={open ? query : shownLabel}
        onFocus={() => !open && openMenu()}
        onClick={() => !open && openMenu()}
        onChange={(e) => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center gap-1">
        {!open && badge}
        {!open && (value || selectedLabel) ? (
          <button
            type="button"
            tabIndex={-1}
            className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(null)}
            aria-label="Clear selection"
          >
            ×
          </button>
        ) : (
          <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
        )}
      </div>

      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
            className="z-[60] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-xl"
          >
            {visible.map((o, i) => (
              <div
                key={o.id}
                id={`${listId}-${i}`}
                data-row={i}
                role="option"
                aria-selected={o.id === value}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 ${i === active ? 'bg-brand-50' : ''}`}
              >
                <div className="min-w-0">
                  <div className={`truncate ${o.id === value ? 'font-semibold text-brand-700' : 'font-medium text-slate-800'}`}>{o.label}</div>
                  {o.sublabel && <div className="truncate text-xs text-slate-500">{o.sublabel}</div>}
                </div>
                {o.meta && <div className="shrink-0 text-right text-xs">{o.meta}</div>}
              </div>
            ))}
            {!visible.length && !canCreate && <div className="px-3 py-3 text-slate-500">{emptyText}</div>}
            {filtered.length > visible.length && (
              <div className="px-3 py-1.5 text-xs text-slate-400">Showing {visible.length} of {filtered.length} — keep typing to narrow down</div>
            )}
            {canCreate && (
              <div
                id={`${listId}-${visible.length}`}
                data-row={visible.length}
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(visible.length)}
                onClick={() => choose(visible.length)}
                className={`flex cursor-pointer items-center gap-2 border-t border-slate-100 px-3 py-2.5 font-medium text-brand-700 ${active === visible.length ? 'bg-brand-50' : ''}`}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs text-white">+</span>
                <span className="min-w-0 flex-1 truncate">{createLabel(q)}</span>
                {createAbbr && (
                  <input
                    ref={abbrRef}
                    className="input h-8 w-28 shrink-0 py-1 text-xs font-normal uppercase text-slate-800"
                    placeholder="Abbr (optional)"
                    aria-label={`Abbreviation for ${q}`}
                    title="Short form used in the auto-generated Short Name and Official SKU"
                    value={abbr}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => setActive(visible.length)}
                    onChange={(e) => setAbbr(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); choose(visible.length); inputRef.current?.focus(); }
                      else if (e.key === 'Escape') { e.preventDefault(); close(); inputRef.current?.focus(); }
                    }}
                  />
                )}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
