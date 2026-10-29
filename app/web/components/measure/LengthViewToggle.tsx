"use client";

import { LENGTH_VIEWS, setLengthView, useLengthScope, useLengthView } from "@/lib/lengthView";

/**
 * Small m / ft / m+ft switch placed in a length or rate column header. It changes only its area
 * (sales + inventory, or purchase — lib/lengthView), remembered per browser.
 */
export function LengthViewToggle({ className = "" }: { className?: string }) {
  const scope = useLengthScope();
  const view = useLengthView();
  return (
    <span
      className={`inline-flex overflow-hidden rounded border border-slate-200 align-middle text-[10px] normal-case tracking-normal ${className}`}
      role="group"
      aria-label="Length units"
      onClick={(e) => e.stopPropagation()}
    >
      {LENGTH_VIEWS.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          aria-pressed={view === o.value}
          onClick={() => setLengthView(scope, o.value)}
          className={`px-1.5 py-px font-semibold leading-4 ${view === o.value ? "bg-brand-600 text-white" : "bg-white text-slate-500 hover:bg-slate-100"}`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
