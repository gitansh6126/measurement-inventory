"use client";

import type { AttributeDef, StockVariation } from "@/lib/types";

export function OptionButtons({
  attributes,
  active,
  picks,
  onChange,
}: {
  attributes: AttributeDef[];
  active: StockVariation[];
  picks: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  return (
    <div className="grid gap-3">
      {attributes.map((attribute) => {
        const values = [...new Set(active.map((v) => v.attributes[attribute.name]).filter(Boolean))];
        const selected = picks[attribute.name];
        if (!values.length) return null;

        const possible = (value: string) =>
          active.some((v) => v.attributes[attribute.name] === value && attributes.every((a) => a.name === attribute.name || !picks[a.name] || v.attributes[a.name] === picks[a.name]));

        return (
          <div key={attribute.name} className="grid gap-2">
            <div className="text-sm font-medium text-slate-700">
              {attribute.name}{attribute.unit ? ` (${attribute.unit})` : ""}
            </div>
            <div className="flex flex-wrap gap-2">
              {values.map((value) => {
                const ok = possible(value);
                const isSelected = selected === value;
                return (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                      isSelected
                        ? "border-brand-600 bg-brand-600 text-white"
                        : ok
                          ? "border-slate-300 bg-white text-slate-700 hover:border-brand-500 hover:text-brand-700"
                          : "border-slate-200 bg-slate-100 text-slate-300"
                    }`}
                    disabled={!ok && !isSelected}
                    onClick={() => onChange(attribute.name, value)}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
