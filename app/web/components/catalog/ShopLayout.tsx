"use client";

import type { ReactNode } from "react";

/**
 * Category rail on the left, the selected category's products on the right (catalog browse,
 * reference image 1). Shared by the cart, Inventory and Products screens.
 */
export function ShopLayout({
  rail,
  crumbs,
  title,
  count,
  toolbar,
  children,
}: {
  rail: ReactNode;
  crumbs?: ReactNode;
  title?: ReactNode;
  count?: ReactNode;
  /** Chips, sort and the Grid | Table toggle. */
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    // minmax(0,1fr) everywhere: a plain grid column grows to its widest child's minimum width,
    // which pushed the product grid past the right edge on phones.
    // Phones: the rail becomes a sticky horizontal strip above the products (full-width cards).
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4">
      <div className="sticky top-0 z-20 -mx-4 min-w-0 self-start bg-slate-50/95 px-4 backdrop-blur sm:mx-0 sm:max-h-[calc(100vh-1rem)] sm:overflow-y-auto sm:bg-transparent sm:px-0 sm:backdrop-blur-none">{rail}</div>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3">
        {crumbs && <div className="text-xs text-slate-500">{crumbs}</div>}
        {(title || count !== undefined) && (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {title && <h2 className="text-lg font-bold text-slate-900 sm:text-xl">{title}</h2>}
            {count !== undefined && <span className="text-sm text-slate-500">{count}</span>}
          </div>
        )}
        {toolbar && <div className="flex flex-wrap items-center justify-between gap-2">{toolbar}</div>}
        {children}
      </div>
    </div>
  );
}

/** Horizontal chip row (stock filters); scrolls sideways on phones. */
export function Chips<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
            value === o.value ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:border-brand-500 hover:text-brand-700"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
