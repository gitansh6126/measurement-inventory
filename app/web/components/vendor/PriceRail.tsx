"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";

export type RailMode = "expanded" | "small" | "hidden";

const RailContext = createContext<{ mode: RailMode }>({ mode: "expanded" });
export const useRail = () => useContext(RailContext);

/**
 * Side rail for the Vendor Pricing views (suppliers or products).
 * Large screens: sticky column on the left with 3 view modes (expanded, small icon bar, hidden)
 * with smooth animation matching the main app sidebar.
 * Below lg: a bar showing the current pick with a "Change" button that slides in from the left.
 */
export function PriceRail({
  title,
  count,
  current,
  open,
  onOpenChange,
  search,
  children,
  mode = "expanded",
  onModeChange,
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
  /** Desktop rail mode */
  mode?: RailMode;
  onModeChange?: (mode: RailMode) => void;
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

  const fullHeader = (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="truncate text-xs font-bold uppercase tracking-wider text-slate-700">{title}</span>
        {count !== undefined && (
          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
            {count}
          </span>
        )}
      </div>

      {/* Mobile close button */}
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

      {/* Desktop collapse and hide controls */}
      {onModeChange && (
        <div className="hidden lg:flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => onModeChange("small")}
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            title={`Make ${title.toLowerCase()} sidebar small (more table space)`}
            aria-label="Make sidebar small"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 3L5 8l5 5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onModeChange("hidden")}
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            title={`Hide ${title.toLowerCase()} sidebar completely`}
            aria-label="Hide sidebar"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M3 8h10" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );

  const smallHeader = (
    <div className="flex flex-col items-center gap-2 border-b border-slate-100 pb-2.5">
      <button
        type="button"
        onClick={() => onModeChange?.("expanded")}
        className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 text-slate-600 hover:bg-brand-50 hover:text-brand-700 transition-colors"
        title={`Expand ${title.toLowerCase()} sidebar`}
        aria-label={`Expand ${title.toLowerCase()} sidebar`}
      >
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 3l5 5-5 5" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onModeChange?.("hidden")}
        className="grid h-6 w-6 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
        title={`Hide ${title.toLowerCase()} sidebar`}
        aria-label={`Hide ${title.toLowerCase()} sidebar`}
      >
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 8h10" />
        </svg>
      </button>
    </div>
  );

  return (
    <RailContext.Provider value={{ mode }}>
      {/* Phones and tablets: current pick bar with Change button */}
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

      {/* When hidden completely on desktop, render a floating restore tab on the left margin */}
      {mode === "hidden" && onModeChange && (
        <button
          type="button"
          onClick={() => onModeChange("expanded")}
          className="no-print hidden lg:flex fixed left-16 top-28 z-30 items-center gap-1.5 rounded-r-xl border border-l-0 border-slate-200 bg-white/95 px-2.5 py-2 text-xs font-semibold text-slate-700 shadow-md backdrop-blur hover:bg-slate-50 hover:text-brand-700 transition-all hover:pl-3"
          title={`Show ${title} sidebar`}
          aria-label={`Show ${title} sidebar`}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="12" height="12" rx="2" />
            <path d="M6 2v12" />
          </svg>
          <span className="font-bold text-[11px] uppercase tracking-wider">{title}</span>
          <span className="text-[10px] text-slate-400 font-bold">»</span>
        </button>
      )}

      {/* Sidebar container */}
      <aside
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        aria-label={title}
        className={`fixed inset-y-0 left-0 z-50 flex w-[min(22rem,88vw)] flex-col gap-3 rounded-r-2xl border-r border-slate-200 bg-white shadow-2xl transition-all duration-200 ease-out lg:visible lg:sticky lg:bottom-auto lg:left-auto lg:top-12 lg:z-auto lg:max-h-[calc(100vh-4rem)] lg:translate-x-0 lg:rounded-lg lg:border lg:shadow-sm ${
          open ? "translate-x-0" : "invisible -translate-x-full lg:visible"
        } ${
          mode === "small"
            ? "p-3.5 pt-[max(0.875rem,env(safe-area-inset-top))] lg:w-16 lg:px-2 lg:py-3.5 lg:overflow-x-hidden shrink-0"
            : mode === "hidden"
            ? "p-3.5 pt-[max(0.875rem,env(safe-area-inset-top))] lg:w-0 lg:p-0 lg:m-0 lg:border-0 lg:shadow-none lg:opacity-0 lg:overflow-hidden lg:invisible shrink-0"
            : "p-3.5 pt-[max(0.875rem,env(safe-area-inset-top))] lg:w-64 xl:w-72 lg:p-3.5 shrink-0"
        }`}
      >
        {mode === "small" ? smallHeader : fullHeader}

        {/* Search input is hidden in small icon mode */}
        {search && mode !== "small" && <div className="flex shrink-0">{search}</div>}

        {/* List of items */}
        <div
          className={`min-h-0 flex-1 space-y-1.5 overflow-y-auto ${
            mode === "small" ? "overflow-x-hidden px-0.5" : "-mr-1 pr-1"
          }`}
        >
          {children}
        </div>
      </aside>
    </RailContext.Provider>
  );
}

/** One row of the rail: picture/thumb, name, subtitle, and badge. Arrows removed for extra space. */
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
  const { mode } = useRail();
  const isSmall = mode === "small";

  if (isSmall) {
    return (
      <div className="relative group/railitem flex justify-center py-0.5">
        <button
          id={id}
          type="button"
          onClick={onClick}
          aria-current={selected ? "true" : undefined}
          title={typeof title === "string" ? title : undefined}
          className={`relative flex h-10 w-10 items-center justify-center rounded-xl border transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            selected
              ? `border-brand-500 bg-brand-50 text-brand-700 ring-2 ring-brand-500 shadow-sm ${blink ? "card-highlight-blink" : ""}`
              : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 text-slate-700"
          }`}
        >
          {selected && (
            <span className="absolute -left-1 top-2 bottom-2 w-1 rounded-r-full bg-brand-600" aria-hidden />
          )}
          <span className="shrink-0">{thumb}</span>
        </button>

        {/* Floating tooltip like main sidebar */}
        <div className="pointer-events-none absolute left-12 top-1/2 -translate-y-1/2 z-50 hidden rounded-lg bg-slate-900 px-3 py-1.5 text-xs text-white shadow-xl border border-slate-700 whitespace-nowrap group-hover/railitem:block">
          <div className="font-semibold text-slate-100">{title}</div>
          {subtitle && <div className="text-[11px] text-slate-400 mt-0.5">{subtitle}</div>}
        </div>
      </div>
    );
  }

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
    </button>
  );
}
