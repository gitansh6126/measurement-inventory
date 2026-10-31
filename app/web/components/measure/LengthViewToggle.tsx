"use client";

import { LENGTH_VIEWS, setLengthView, useLengthScope, useLengthView, type LengthView } from "@/lib/lengthView";

/**
 * Compact m / ft / m+ft dropdown placed in a length or rate column header, summary, or badge.
 * Changes only its area (sales + inventory, or purchase — lib/lengthView), remembered per browser.
 */
export function LengthViewToggle({ className = "" }: { className?: string }) {
  const scope = useLengthScope();
  const view = useLengthView();

  return (
    <div
      className={`relative inline-flex items-center align-middle normal-case tracking-normal ${className}`}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <select
        value={view}
        onChange={(e) => {
          e.stopPropagation();
          setLengthView(scope, e.target.value as LengthView);
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label="Length display unit"
        title="Change length display unit (m, ft, or m+ft)"
        className="appearance-none rounded border border-slate-300 bg-white py-0.5 pl-2 pr-5 text-[11px] font-semibold text-slate-700 shadow-2xs transition-colors hover:border-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer"
      >
        {LENGTH_VIEWS.map((o) => (
          <option key={o.value} value={o.value} title={o.title}>
            {o.label}
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1 text-slate-500">
        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    </div>
  );
}
