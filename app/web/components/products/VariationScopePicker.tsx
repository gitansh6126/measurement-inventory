"use client";

import { useState } from "react";
import type { Attributes } from "@/lib/types";

/** A variation of the product being edited (saved or still in the builder), keyed by combination. */
export interface ScopeVariation {
  key: string;
  attrs: Attributes;
  active: boolean;
}

export const comboLabel = (attrs: Attributes) => Object.values(attrs).filter(Boolean).join(" · ") || "—";

/**
 * V3.1 (0038, plan §6.1): for each ticked category of another head on a Variable / Measured
 * product, "All variations" or "Only some" with a checklist and quick picks per attribute value
 * (Diameter: 12 mm ☐ 16 mm ☐ ticks every variation with that value). `scopes` holds the ticked
 * combination keys of the "Only some" categories; a category not in it applies to all.
 */
export function VariationScopePicker({
  categories,
  variations,
  scopes,
  onChange,
}: {
  categories: { id: string; name: string; headName: string }[];
  variations: ScopeVariation[];
  scopes: Record<string, string[]>;
  onChange: (next: Record<string, string[]>) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const shown = variations.filter((v) => v.active);
  if (!categories.length || shown.length < 2) return null;

  const setScope = (id: string, keys: string[] | null) => {
    const next = { ...scopes };
    if (keys === null) delete next[id];
    else next[id] = keys;
    onChange(next);
  };

  // Attribute → values present among the variations, in first-seen order.
  const values = new Map<string, string[]>();
  for (const v of shown) {
    for (const [name, value] of Object.entries(v.attrs)) {
      if (!value) continue;
      const list = values.get(name) ?? [];
      if (!list.includes(value)) list.push(value);
      values.set(name, list);
    }
  }

  return (
    <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Applies to</p>
      <ul className="mt-2 grid gap-2">
        {categories.map((c) => {
          const some = scopes[c.id];
          const ticked = new Set(some ?? []);
          const count = some ? shown.filter((v) => ticked.has(v.key)).length : shown.length;
          return (
            <li key={c.id} className="rounded-md bg-white p-2 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-slate-800">
                  <span className="text-slate-500">{c.headName}:</span> {c.name}
                </span>
                <div className="ml-auto inline-flex overflow-hidden rounded-md ring-1 ring-slate-300" role="group" aria-label={`${c.name} applies to`}>
                  <button
                    type="button"
                    className={`px-2.5 py-1 text-xs ${some ? "bg-white text-slate-600" : "bg-brand-600 text-white"}`}
                    aria-pressed={!some}
                    onClick={() => {
                      setScope(c.id, null);
                      setOpen(null);
                    }}
                  >
                    All variations
                  </button>
                  <button
                    type="button"
                    className={`px-2.5 py-1 text-xs ${some ? "bg-brand-600 text-white" : "bg-white text-slate-600"}`}
                    aria-pressed={!!some}
                    onClick={() => {
                      if (!some) setScope(c.id, []);
                      setOpen(c.id);
                    }}
                  >
                    Only some
                  </button>
                </div>
              </div>
              {some && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                  {count === 0 ? (
                    <span className="text-rose-600">Tick at least one variation, or choose All variations.</span>
                  ) : (
                    shown
                      .filter((v) => ticked.has(v.key))
                      .map((v) => (
                        <span key={v.key} className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700 ring-1 ring-violet-200">
                          {comboLabel(v.attrs)}
                        </span>
                      ))
                  )}
                  <button type="button" className="ml-1 text-brand-700 underline-offset-2 hover:underline" onClick={() => setOpen(open === c.id ? null : c.id)}>
                    {open === c.id ? "Done" : "Edit variations"}
                  </button>
                </div>
              )}
              {some && open === c.id && (
                <div className="mt-2 grid gap-2 border-t border-slate-100 pt-2">
                  {[...values].map(([name, list]) => (
                    <div key={name} className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="w-24 shrink-0 text-slate-500">{name}</span>
                      {list.map((value) => {
                        const keys = shown.filter((v) => v.attrs[name] === value).map((v) => v.key);
                        const all = keys.every((k) => ticked.has(k));
                        return (
                          <button
                            key={value}
                            type="button"
                            className={`rounded-full px-2 py-0.5 ring-1 ${all ? "bg-violet-600 text-white ring-violet-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
                            aria-pressed={all}
                            title={all ? `Untick every variation with ${name} ${value}` : `Tick every variation with ${name} ${value}`}
                            onClick={() => setScope(c.id, all ? [...ticked].filter((k) => !keys.includes(k)) : [...new Set([...ticked, ...keys])])}
                          >
                            {value}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  <div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
                    {shown.map((v) => (
                      <label key={v.key} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={ticked.has(v.key)}
                          onChange={(e) => setScope(c.id, e.target.checked ? [...ticked, v.key] : [...ticked].filter((k) => k !== v.key))}
                        />
                        {comboLabel(v.attrs)}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
