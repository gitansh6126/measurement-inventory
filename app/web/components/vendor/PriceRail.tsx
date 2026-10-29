"use client";

import { useEffect, type ReactNode } from "react";

/**
 * Side rail for the Vendor Pricing views (suppliers or products). Large screens: a sticky
 * column on the left. Below lg: a bar showing the current pick with a "Change" button that
 * slides the same list in from the left (RMS Tech drawer, rms.tech\ 10.39.18 PM).
 */
export function PriceRail({
  title,
  count,
  current,
  open,
  onOpenChange,
  search,
  children,
}: {
  title: string;
  count?: ReactNode;
  /** What is picked now, shown on the phone bar. */
  current: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Search box above the list. */
  search?: ReactNode;
  children: ReactNode;
}) {
  // Escape closes the phone drawer; the page behind does not scroll while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpenChange(false);
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onOpenChange]);

  const header = (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-700">{title}</span>
        {count !== undefined && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{count}</span>}
      </div>
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className="grid h-8 w-8 place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 lg:hidden"
        aria-label={`Close ${title.toLowerCase()}`}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );

  return (
    <>
      {/* Phones and tablets: the current pick and a button that opens the drawer. */}
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="card flex w-full items-center gap-3 p-2.5 text-left lg:hidden"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">{current}</div>
        <span className="shrink-0 rounded-full bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700">Change</span>
      </button>

      {open && <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => onOpenChange(false)} aria-hidden />}

      <aside
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        aria-label={title}
        // Mobile-first drawer classes, undone from lg (the config's extra "tall" screen turns off max-* variants).
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(22rem,88vw)] flex-col gap-3 rounded-r-2xl border-r border-slate-200 bg-white p-3.5 pt-[max(0.875rem,env(safe-area-inset-top))] shadow-2xl transition-transform duration-200 lg:visible lg:sticky lg:bottom-auto lg:left-auto lg:top-12 lg:z-auto lg:max-h-[calc(100vh-4rem)] lg:w-auto lg:translate-x-0 lg:rounded-lg lg:border lg:pt-3.5 lg:shadow-sm ${
          open ? "translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        {header}
        {/* SearchInput is flex-1; wrapped so it does not stretch down the column. */}
        {search && <div className="flex shrink-0">{search}</div>}
        <div className="-mr-1 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">{children}</div>
      </aside>
    </>
  );
}

/** One row of the rail: picture, name, a second line, and a round arrow (RMS Tech categories). */
export function RailItem({
  id,
  selected,
  thumb,
  title,
  subtitle,
  badge,
  onClick,
  nested,
  blink,
}: {
  id?: string;
  selected: boolean;
  thumb: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  onClick: () => void;
  /** A row inside an open group: smaller, with the accent bar always shown. */
  nested?: boolean;
  blink?: boolean;
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={`group relative flex w-full items-center gap-2.5 rounded-xl border text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
        nested ? "py-1.5 pl-3 pr-2" : "p-2"
      } ${selected ? `border-brand-500 bg-brand-50 ring-1 ring-inset ring-brand-500 ${blink ? "card-highlight-blink" : ""}` : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"}`}
    >
      {(nested || selected) && (
        <span className={`absolute inset-y-2 left-1 w-1 rounded-full ${selected ? "bg-brand-600" : "bg-slate-200"}`} aria-hidden />
      )}
      <span className="shrink-0">{thumb}</span>
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[13px] font-semibold ${selected ? "text-brand-800" : "text-slate-800"}`}>{title}</span>
        {subtitle && <span className="block truncate text-[11px] text-slate-500">{subtitle}</span>}
      </span>
      {badge}
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors ${
          selected ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-500 group-hover:bg-slate-200"
        }`}
        aria-hidden
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5">
          <path d="M3 8h9M8.5 4.5L12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  );
}
