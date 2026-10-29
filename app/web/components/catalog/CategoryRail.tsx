"use client";

import { ProductThumb } from "@/components/ProductThumb";
import type { CategoryStatsList } from "@/lib/types";

/** "all", "none" (uncategorized) or a category id. */
export type CategoryKey = string;
export const ALL = "all";
export const NONE = "none";

// Category rail from the owner's reference (v2/docs/catalog-browse/reference/01-…): always on the
// left, image + name per category, "All" first and "Uncategorized" last. In inventory mode a dot
// marks categories with low (amber) or out-of-stock (red) products.

export function CategoryRail({
  data,
  selected,
  onSelect,
  alerts = false,
}: {
  data: CategoryStatsList | null;
  /** null while a search across all categories is active. */
  selected: CategoryKey | null;
  onSelect: (key: CategoryKey) => void;
  alerts?: boolean;
}) {
  const items: { key: string; name: string; image: string | null; count: number; low: number; out: number }[] = data
    ? [
        { key: ALL, name: "All", image: null, count: data.all.productCount, low: data.all.lowCount, out: data.all.outCount },
        ...data.categories.map((c) => ({ key: c.id, name: c.name, image: c.coverImageUrl, count: c.productCount, low: c.lowCount, out: c.outCount })),
        ...(data.uncategorized.productCount > 0
          ? [{ key: NONE, name: "Uncategorized", image: null, count: data.uncategorized.productCount, low: data.uncategorized.lowCount, out: data.uncategorized.outCount }]
          : []),
      ]
    : [];

  return (
    // Phones: one swipeable row under the top bar; sm and up: the vertical rail on the left.
    <nav aria-label="Categories" className="flex snap-x gap-1 overflow-x-auto border-b border-slate-200 py-1.5 [scrollbar-width:none] sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r sm:py-0 sm:pr-2">
      {!data &&
        Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="mx-auto my-1 h-14 w-14 shrink-0 animate-pulse rounded-lg bg-slate-100" aria-hidden />
        ))}
      {items.map((c) => {
        const on = selected === c.key;
        const dot = alerts ? (c.out > 0 ? "bg-rose-500" : c.low > 0 ? "bg-amber-500" : null) : null;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onSelect(c.key)}
            aria-current={on ? "true" : undefined}
            title={`${c.name} · ${c.count} products${alerts && c.low ? ` · ${c.low} low` : ""}${alerts && c.out ? ` · ${c.out} out` : ""}`}
            className={`relative flex w-[4.5rem] shrink-0 snap-start flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-center sm:w-auto text-[11px] leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:text-xs ${
              on ? "bg-brand-50 font-semibold text-brand-700 ring-1 ring-inset ring-brand-500" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            }`}
          >
            {c.key === ALL ? (
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-slate-100 text-slate-500 sm:h-12 sm:w-12" aria-hidden>
                <svg viewBox="0 0 16 16" className="h-5 w-5">
                  <path fill="currentColor" d="M1 1h6v6H1zM9 1h6v6H9zM1 9h6v6H1zM9 9h6v6H9z" />
                </svg>
              </span>
            ) : (
              <ProductThumb src={c.image} name={c.name} className="h-10 w-10 rounded-lg text-[8px] sm:h-12 sm:w-12" />
            )}
            <span className="line-clamp-2 break-words">{c.name}</span>
            {dot && <span className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${dot}`} aria-hidden />}
          </button>
        );
      })}
    </nav>
  );
}
