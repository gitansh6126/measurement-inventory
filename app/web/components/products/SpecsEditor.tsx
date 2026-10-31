"use client";

import { useEffect, useRef } from "react";
import type { TechSpec } from "@/lib/types";

// 0044 technical specifications (owner 2026-10-30): name / value rows the user adds, removes and
// orders. Used on the product form (whole product), in the variation builder (one variation) and
// on each standard set; the product page shows them as a two-column table.

/** Rows as sent to the API: trimmed, fully blank rows dropped. */
export const cleanSpecs = (rows: readonly TechSpec[]): TechSpec[] =>
  rows.map((r) => ({ name: r.name.trim(), value: r.value.trim() })).filter((r) => r.name || r.value);

/** Same rows after cleaning (to send a PATCH only when something changed). */
export const sameSpecs = (a: readonly TechSpec[] | undefined, b: readonly TechSpec[] | undefined) =>
  JSON.stringify(cleanSpecs(a ?? [])) === JSON.stringify(cleanSpecs(b ?? []));

export function SpecsEditor({
  value,
  onChange,
  label = "Technical specifications",
  hint,
  compact = false,
  disabled = false,
}: {
  value: TechSpec[];
  onChange: (rows: TechSpec[]) => void;
  label?: string;
  hint?: string;
  compact?: boolean;
  disabled?: boolean;
}) {
  const set = (i: number, p: Partial<TechSpec>) => onChange(value.map((r, ix) => (ix === i ? { ...r, ...p } : r)));
  const moveRow = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r!);
    onChange(next);
  };
  // Enter on the last row's value (when the row has text) adds a row and moves into it.
  const listRef = useRef<HTMLDivElement>(null);
  const focusNew = useRef(false);
  useEffect(() => {
    if (!focusNew.current) return;
    focusNew.current = false;
    listRef.current?.querySelector<HTMLInputElement>("div:last-child input")?.focus();
  }, [value.length]);
  const addRow = () => onChange([...value, { name: "", value: "" }]);
  const arrow = "px-1 text-slate-500 hover:text-slate-900 disabled:text-slate-300";
  const input = `input ${compact ? "py-1 text-xs" : "py-1.5 text-sm"}`;

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className={compact ? "text-[11px] font-bold uppercase tracking-wider text-slate-400" : "text-sm font-semibold text-slate-900"}>{label}</div>
          {hint && <p className="text-xs text-slate-500">{hint}</p>}
        </div>
        <button type="button" className="btn-secondary py-1 text-xs" disabled={disabled || value.length >= 60} onClick={addRow}>
          + Add row
        </button>
      </div>
      {value.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400">No specifications yet (optional), e.g. Breaking load · 12 t.</p>
      ) : (
        <div ref={listRef} className="grid gap-1.5">
          {value.map((r, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="inline-flex shrink-0 items-center">
                <button type="button" className={arrow} aria-label={`Move specification ${i + 1} up`} title="Move up" disabled={disabled || i === 0} onClick={() => moveRow(i, i - 1)}>↑</button>
                <button type="button" className={arrow} aria-label={`Move specification ${i + 1} down`} title="Move down" disabled={disabled || i === value.length - 1} onClick={() => moveRow(i, i + 1)}>↓</button>
              </span>
              <input
                className={`${input} w-2/5 min-w-0 font-medium`}
                maxLength={80}
                placeholder="Name (e.g. Breaking load)"
                value={r.name}
                disabled={disabled}
                aria-label={`Specification ${i + 1} name`}
                onChange={(e) => set(i, { name: e.target.value })}
              />
              <input
                className={`${input} min-w-0 flex-1`}
                maxLength={300}
                placeholder="Value (e.g. 12 t)"
                value={r.value}
                disabled={disabled}
                aria-label={`Specification ${i + 1} value`}
                onChange={(e) => set(i, { value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || i !== value.length - 1 || value.length >= 60) return;
                  if (!r.name.trim() && !r.value.trim()) return;
                  e.preventDefault();
                  focusNew.current = true;
                  addRow();
                }}
              />
              <button type="button" className="btn-danger shrink-0 px-2" disabled={disabled} onClick={() => onChange(value.filter((_, ix) => ix !== i))} aria-label={`Remove specification ${i + 1}`}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Read-only two-column table (product page). */
export function SpecsTable({ rows }: { rows: readonly TechSpec[] }) {
  if (!rows.length) return null;
  return (
    <dl className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 text-sm">
      {rows.map((r, i) => (
        <div key={`${r.name}-${i}`} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-1.5 odd:bg-slate-50/70">
          <dt className="text-slate-500">{r.name}</dt>
          <dd className="font-medium text-slate-800">{r.value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
