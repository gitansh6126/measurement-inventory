"use client";

import type { CategoryHead } from "@/lib/types";

export const PRODUCT_TYPE_KEY = "product-type";

export function CategoryHeadSelect({
  heads,
  value,
  onChange,
  className = "",
}: {
  heads: CategoryHead[] | undefined;
  value: string;
  onChange: (headKey: string) => void;
  className?: string;
}) {
  const list = heads && heads.length > 0
    ? heads
    : [{ id: null, name: "Product Type", builtIn: true, active: true, sortOrder: 0, categoryCount: 0 }];

  return (
    <div className={`relative ${className}`}>
      <label htmlFor="category-head-select" className="sr-only">
        Category Head
      </label>
      <select
        id="category-head-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-lg border border-slate-300 bg-white py-1.5 pl-2 pr-6 text-xs font-semibold text-slate-800 shadow-2xs transition-colors hover:border-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 cursor-pointer truncate"
        aria-label="Category Head"
        title="Switch Category Head"
      >
        {list.map((h) => {
          const key = h.id ?? PRODUCT_TYPE_KEY;
          return (
            <option key={key} value={key}>
              {h.name}
            </option>
          );
        })}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5 text-slate-500">
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      </div>
    </div>
  );
}
