'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ComboOption } from './Combobox';

type Props = {
  values: string[];
  options: ComboOption[];
  onChange: (ids: string[]) => void;
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  placeholder?: string;
  emptyText?: string;
  minMenuWidth?: number;
  inputId?: string;
  ariaLabel?: string;
};

function matches(o: ComboOption, tokens: string[]) {
  if (!tokens.length) return true;
  const hay = `${o.label} ${o.sublabel || ''} ${o.keywords || ''}`.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

// V3.1: searchable multi-select in the same look as Combobox. Selected items show as removable
// tags; clicking a row ticks / unticks it and keeps the menu open; typing a name that does not
// exist offers a "create new" row.
export function MultiCombobox({
  values, options, onChange, onCreate, createLabel = (q) => `Add “${q}”`, placeholder = 'Select…',
  emptyText = 'No matches', minMenuWidth = 280, inputId, ariaLabel,
}: Props) {
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);

  const chosen = new Set(values);
  const tokens = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const visible = useMemo(() => options.filter((o) => matches(o, tokens)), [options, tokens]);
  const q = query.trim();
  const canCreate = !!onCreate && !!q && !options.some((o) => o.label.toLowerCase() === q.toLowerCase());
  const rowCount = visible.length + (canCreate ? 1 : 0);
  const tags = values.map((id) => options.find((o) => o.id === id)).filter((o): o is ComboOption => !!o);

  const place = useCallback(() => {
    const r = boxRef.current?.getBoundingClientRect();
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
  }, [open, place, values.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!boxRef.current?.contains(t) && !menuRef.current?.contains(t)) close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function close() {
    setOpen(false);
    setQuery('');
  }
  const toggle = (id: string) => onChange(chosen.has(id) ? values.filter((v) => v !== id) : [...values, id]);
  function choose(row: number) {
    if (row < visible.length) {
      toggle(visible[row].id);
      setQuery('');
      inputRef.current?.focus();
    } else if (canCreate) {
      onCreate!(q);
      close();
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) { e.preventDefault(); setOpen(true); setActive(0); return; }
    if (e.key === 'Backspace' && !query && values.length) { onChange(values.slice(0, -1)); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, rowCount - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rowCount) choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') close();
  }

  return (
    <div className="relative">
      <div
        ref={boxRef}
        className={`input flex min-h-[2.5rem] cursor-text flex-wrap items-center gap-1.5 py-1.5 pr-8 ${open ? 'ring-2 ring-brand-500/30' : ''}`}
        onClick={() => { inputRef.current?.focus(); if (!open) { setOpen(true); setActive(0); } }}
      >
        {tags.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
            {t.label}
            <button
              type="button"
              className="rounded-full px-0.5 text-brand-500 hover:bg-brand-100 hover:text-brand-800"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => { e.stopPropagation(); toggle(t.id); }}
              aria-label={`Remove ${t.label}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          className="min-w-[8rem] flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:ring-0"
          placeholder={tags.length ? '' : placeholder}
          value={query}
          onFocus={() => { if (!open) { setOpen(true); setActive(0); } }}
          onChange={(e) => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true); }}
          onKeyDown={onKeyDown}
        />
        <svg className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </div>

      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            aria-multiselectable
            style={{ position: 'fixed', left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
            className="z-[60] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-xl"
          >
            {visible.map((o, i) => {
              const on = chosen.has(o.id);
              return (
                <div
                  key={o.id}
                  data-row={i}
                  role="option"
                  aria-selected={on}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(i)}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${i === active ? 'bg-brand-50' : ''}`}
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'}`}>{on ? '✓' : ''}</span>
                  <div className="min-w-0 flex-1">
                    <div className={`truncate ${on ? 'font-semibold text-brand-700' : 'font-medium text-slate-800'}`}>{o.label}</div>
                    {o.sublabel && <div className="truncate text-xs text-slate-500">{o.sublabel}</div>}
                  </div>
                </div>
              );
            })}
            {!visible.length && !canCreate && <div className="px-3 py-3 text-slate-500">{emptyText}</div>}
            {canCreate && (
              <div
                data-row={visible.length}
                role="option"
                aria-selected={false}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(visible.length)}
                onClick={() => choose(visible.length)}
                className={`flex cursor-pointer items-center gap-2 border-t border-slate-100 px-3 py-2.5 font-medium text-brand-700 ${active === visible.length ? 'bg-brand-50' : ''}`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-xs text-white">+</span>
                {createLabel(q)}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
