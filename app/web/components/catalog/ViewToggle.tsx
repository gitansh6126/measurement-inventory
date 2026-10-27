"use client";

import type { ViewMode } from "@/lib/useViewMode";

const GridIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
    <path fill="currentColor" d="M1 1h6v6H1zM9 1h6v6H9zM1 9h6v6H1zM9 9h6v6H9z" />
  </svg>
);
const TableIcon = () => (
  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
    <path fill="currentColor" d="M1 2h14v3H1zM1 7h14v2.5H1zM1 11.5h14V14H1z" />
  </svg>
);

/** Grid | Table switch (catalog browse §2.0). Both views show the same data. */
export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const opts: { v: ViewMode; label: string; icon: React.ReactNode }[] = [
    { v: "grid", label: "Grid", icon: <GridIcon /> },
    { v: "table", label: "Table", icon: <TableIcon /> },
  ];
  return (
    <div role="group" aria-label="View" className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5">
      {opts.map((o) => (
        <button
          key={o.v}
          type="button"
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            value === o.v ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:bg-white/60 hover:text-slate-800"
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
