"use client";

import { useMemo } from "react";
import type { AttributeDef } from "@/lib/types";

export interface GenericVariation {
  id: string;
  shortName?: string;
  attributes: Record<string, string>;
  active?: boolean;
  quantity?: number;
  [key: string]: any;
}

export interface GenericAttributeDef {
  name: string;
  unit?: string;
  values?: string[];
  isQuality?: boolean;
}

export interface VariationTabsProps {
  attributes?: GenericAttributeDef[] | AttributeDef[];
  variations: GenericVariation[];
  selectedFilters?: Record<string, string>;
  selectedVariationId?: string | null;
  onFilterChange: (
    filteredIds: string[] | null,
    filters: Record<string, string>,
    singleVariationId: string | null
  ) => void;
  scrollTargetPrefix?: string;
  className?: string;
  compact?: boolean;
}

/**
 * VariationTabs: renders attribute chips and variation tabs allowing users
 * to quickly filter, navigate, and highlight specific variations in tables.
 */
export function VariationTabs({
  attributes = [],
  variations = [],
  selectedFilters = {},
  selectedVariationId = null,
  onFilterChange,
  scrollTargetPrefix,
  className = "",
  compact = false,
}: VariationTabsProps) {
  // Infer attribute definitions and all unique values present in the variations
  const attrList = useMemo(() => {
    const list: Array<{ name: string; unit?: string; values: string[] }> = [];
    const seenNames = new Set<string>();

    for (const a of attributes) {
      if (!a.name || seenNames.has(a.name)) continue;
      seenNames.add(a.name);
      // Values actually used in variations
      const usedValues = new Set<string>();
      variations.forEach((v) => {
        const val = v.attributes?.[a.name];
        if (val) usedValues.add(val);
      });
      list.push({
        name: a.name,
        unit: a.unit,
        values: Array.from(usedValues),
      });
    }

    // In case variations have attributes not declared in `attributes`
    variations.forEach((v) => {
      Object.keys(v.attributes || {}).forEach((k) => {
        if (!seenNames.has(k)) {
          seenNames.add(k);
          const usedValues = new Set<string>();
          variations.forEach((varItem) => {
            const val = varItem.attributes?.[k];
            if (val) usedValues.add(val);
          });
          list.push({
            name: k,
            values: Array.from(usedValues),
          });
        }
      });
    });

    return list.filter((a) => a.values.length > 0);
  }, [attributes, variations]);

  // Compute how many variations match a particular attribute value given other active filters
  const getMatchCount = (attrName: string, value: string) => {
    return variations.filter((v) => {
      if (v.attributes?.[attrName] !== value) return false;
      return Object.entries(selectedFilters).every(([k, filterVal]) => {
        if (!filterVal || k === attrName) return true;
        return v.attributes?.[k] === filterVal;
      });
    }).length;
  };

  const handleSelectAttribute = (attrName: string, value: string | null) => {
    const nextFilters = { ...selectedFilters };
    if (!value) {
      delete nextFilters[attrName];
    } else {
      nextFilters[attrName] = value;
    }

    const hasFilters = Object.keys(nextFilters).length > 0;
    if (!hasFilters) {
      onFilterChange(null, {}, null);
      return;
    }

    const matches = variations.filter((v) => {
      return Object.entries(nextFilters).every(([k, val]) => v.attributes?.[k] === val);
    });

    const matchingIds = matches.map((m) => m.id);
    const singleId = matches.length === 1 ? matches[0]!.id : null;

    onFilterChange(matchingIds, nextFilters, singleId);

    // Scroll to target row if single match or specific variation
    if (singleId && scrollTargetPrefix) {
      scrollToRow(`${scrollTargetPrefix}-${singleId}`);
    }
  };

  const handleSelectDirectVariation = (variationId: string | null) => {
    if (!variationId) {
      onFilterChange(null, {}, null);
      return;
    }
    const match = variations.find((v) => v.id === variationId);
    if (!match) return;

    onFilterChange([match.id], match.attributes, match.id);

    if (scrollTargetPrefix) {
      scrollToRow(`${scrollTargetPrefix}-${match.id}`);
    }
  };

  function scrollToRow(id: string) {
    if (typeof window === "undefined") return;
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        el.classList.add("ring-2", "ring-brand-500", "bg-brand-50/60");
        setTimeout(() => {
          el.classList.remove("ring-2", "ring-brand-500", "bg-brand-50/60");
        }, 1800);
      }
    }, 50);
  }

  if (variations.length <= 1) return null;

  const isAllSelected = Object.keys(selectedFilters).length === 0 && !selectedVariationId;

  return (
    <div
      className={`rounded-lg border border-slate-200/80 bg-slate-50/90 p-2.5 space-y-2 ${className}`}
      role="region"
      aria-label="Variation navigation tabs"
    >
      {/* If single attribute or few variations: render clean direct tabs */}
      {attrList.length <= 1 ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-1">
            {attrList[0]?.name || "Variations"}:
          </span>
          <button
            type="button"
            onClick={() => handleSelectDirectVariation(null)}
            className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-all select-none cursor-pointer ${
              isAllSelected
                ? "bg-brand-600 text-white shadow-xs"
                : "border border-slate-200 bg-white text-slate-700 hover:border-brand-500 hover:text-brand-600"
            }`}
          >
            All ({variations.length})
          </button>
          {variations.map((v) => {
            const isSelected = selectedVariationId === v.id;
            const label =
              (attrList[0] && v.attributes[attrList[0].name]) ||
              v.shortName ||
              Object.values(v.attributes).join(" · ") ||
              v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => handleSelectDirectVariation(isSelected ? null : v.id)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all select-none cursor-pointer inline-flex items-center gap-1.5 ${
                  isSelected
                    ? "bg-brand-600 text-white shadow-xs"
                    : "border border-slate-200 bg-white text-slate-700 hover:border-brand-500 hover:text-brand-600"
                } ${v.active === false ? "opacity-50" : ""}`}
              >
                <span>{label}</span>
                {v.quantity !== undefined && (
                  <span
                    className={`rounded px-1 py-0.2 text-[10px] ${
                      isSelected ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {v.quantity}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        /* Multi-attribute layout: one row per attribute dimension + Reset button */
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Filter Variation by Option:
            </span>
            {!isAllSelected && (
              <button
                type="button"
                onClick={() => handleSelectAttribute("", null)}
                className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 hover:underline cursor-pointer"
              >
                Show All Variations ({variations.length})
              </button>
            )}
          </div>

          {attrList.map((attr) => {
            const selectedVal = selectedFilters[attr.name];
            return (
              <div key={attr.name} className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium text-slate-600 min-w-16">
                  {attr.name}
                  {attr.unit ? ` (${attr.unit})` : ""}:
                </span>
                <button
                  type="button"
                  onClick={() => handleSelectAttribute(attr.name, null)}
                  className={`rounded-md px-2 py-0.5 text-xs font-medium transition-all select-none cursor-pointer ${
                    !selectedVal
                      ? "bg-slate-700 text-white shadow-xs"
                      : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  All
                </button>
                {attr.values.map((val) => {
                  const isSelected = selectedVal === val;
                  const count = getMatchCount(attr.name, val);
                  return (
                    <button
                      key={val}
                      type="button"
                      disabled={count === 0 && !isSelected}
                      onClick={() => handleSelectAttribute(attr.name, isSelected ? null : val)}
                      className={`rounded-md px-2 py-0.5 text-xs font-medium transition-all select-none cursor-pointer inline-flex items-center gap-1 ${
                        isSelected
                          ? "bg-brand-600 text-white shadow-xs"
                          : count > 0
                          ? "border border-slate-200 bg-white text-slate-700 hover:border-brand-500 hover:text-brand-600"
                          : "border-slate-100 bg-slate-100 text-slate-300 cursor-not-allowed"
                      }`}
                    >
                      <span>{val}</span>
                      <span
                        className={`text-[10px] ${
                          isSelected ? "text-brand-100" : "text-slate-400"
                        }`}
                      >
                        ({count})
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
