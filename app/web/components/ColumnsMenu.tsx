"use client";

import { useEffect, useRef, useState } from "react";
import type { ColumnDef } from "@/lib/inventoryColumns";

/**
 * "Columns" picker (V2 plan §1.10): one checkbox per hideable column plus "Reset to defaults".
 * Fixed identity columns are listed but locked so a row always stays understandable.
 */
export function ColumnsMenu({ columns, hidden, onChange, onReset }: { columns: ColumnDef[]; hidden: string[]; onChange: (hidden: string[]) => void; onReset: () => void }) {
  const [open, setOpen] = useState(false);
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
  return (
    <div className="relative" ref={box}>
      <button type="button" className="btn-secondary" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Columns ({shownCount}/{columns.length})
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
          {columns.map((c) => (
            <label key={c.id} className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${c.fixed ? "text-slate-400" : "cursor-pointer hover:bg-slate-50"}`}>
              <input
                type="checkbox"
                checked={c.fixed || !hidden.includes(c.id)}
                disabled={c.fixed}
                onChange={(e) => onChange(e.target.checked ? hidden.filter((h) => h !== c.id) : [...hidden, c.id])}
              />
              {c.label}
              {c.fixed && <span className="ml-auto text-[10px] uppercase">always</span>}
            </label>
          ))}
          <button type="button" className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs font-medium text-brand-600 hover:bg-brand-50" onClick={onReset}>
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}
