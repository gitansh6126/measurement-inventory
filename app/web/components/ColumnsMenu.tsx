"use client";

import { useEffect, useRef, useState } from "react";
import type { ColumnDef } from "@/lib/inventoryColumns";

/**
 * "Columns" picker (V2 plan §1.10): one checkbox per hideable column plus "Reset to defaults".
 * Fixed identity columns are listed but locked so a row always stays understandable.
 * With `order` + `onMove`, columns are listed in the user's order and can be dragged (or moved
 * with ↑ / ↓ on touch and keyboard); pinned columns stay where they are.
 */
export function ColumnsMenu({
  columns,
  hidden,
  onChange,
  onReset,
  order,
  onMove,
}: {
  columns: ColumnDef[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
  onReset: () => void;
  order?: string[];
  onMove?: (from: string, to: string, position: "before" | "after") => void;
}) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const shownCount = columns.filter((c) => !hidden.includes(c.id)).length;
  const byId = new Map(columns.map((c) => [c.id, c]));
  const list = order ? order.map((id) => byId.get(id)).filter((c): c is ColumnDef => !!c) : columns;
  const movable = list.filter((c) => !c.pinned);
  const step = (c: ColumnDef, d: -1 | 1) => {
    const i = movable.indexOf(c);
    const target = movable[i + d];
    if (target && onMove) onMove(c.id, target.id, d < 0 ? "before" : "after");
  };
  return (
    <div className="relative" ref={box}>
      <button type="button" className="btn-secondary" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Columns ({shownCount}/{columns.length})
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
          {onMove && <p className="px-2 pb-1 text-[11px] text-slate-500">Drag to reorder, or drag a table header.</p>}
          {list.map((c) => {
            const canMove = !!onMove && !c.pinned;
            const i = movable.indexOf(c);
            return (
              <div
                key={c.id}
                draggable={canMove}
                onDragStart={(e) => {
                  setDrag(c.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => canMove && drag && drag !== c.id && e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag && onMove && canMove) onMove(drag, c.id, movable.findIndex((m) => m.id === drag) < i ? "after" : "before");
                  setDrag(null);
                }}
                onDragEnd={() => setDrag(null)}
                className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${drag === c.id ? "opacity-50" : ""} ${canMove ? "cursor-grab" : ""}`}
              >
                {onMove && <span aria-hidden className={`w-3 text-slate-400 ${canMove ? "" : "invisible"}`}>⠿</span>}
                <label className={`flex flex-1 items-center gap-2 ${c.fixed ? "text-slate-400" : "cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    checked={c.fixed || !hidden.includes(c.id)}
                    disabled={c.fixed}
                    onChange={(e) => onChange(e.target.checked ? hidden.filter((h) => h !== c.id) : [...hidden, c.id])}
                  />
                  {c.label}
                  {c.fixed && <span className="ml-auto text-[10px] uppercase">always</span>}
                </label>
                {canMove && (
                  <span className="flex">
                    <button type="button" className="h-6 w-5 text-xs text-slate-500 hover:text-slate-900 disabled:opacity-30" disabled={i <= 0} aria-label={`Move ${c.label} earlier`} onClick={() => step(c, -1)}>↑</button>
                    <button type="button" className="h-6 w-5 text-xs text-slate-500 hover:text-slate-900 disabled:opacity-30" disabled={i >= movable.length - 1} aria-label={`Move ${c.label} later`} onClick={() => step(c, 1)}>↓</button>
                  </span>
                )}
              </div>
            );
          })}
          <button type="button" className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs font-medium text-brand-600 hover:bg-brand-50" onClick={onReset}>
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}
