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
 * VariationTabs: clean circular & capsule pills matching the app design
 * (e.g., circular white borders, vibrant brand-orange active fill).
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

  // Count matches given other active filters
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

  // Base pill class: circular for 1-2 chars, expanding capsule for longer text
  const pillBase = compact
    ? "inline-flex items-center justify-center min-w-[2rem] h-8 px-2.5 rounded-full text-xs font-semibold select-none cursor-pointer transition-all duration-150 active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1"
    : "inline-flex items-center justify-center min-w-[2.25rem] h-9 px-3 rounded-full text-sm font-semibold select-none cursor-pointer transition-all duration-150 active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1";

  const pillActive = "border border-brand-600 bg-brand-600 text-white shadow-xs font-bold";
  const pillInactive =
    "border border-slate-300 bg-white text-slate-800 hover:border-brand-500 hover:text-brand-600 hover:bg-slate-50/50 shadow-xs";
  const pillDisabled = "border border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed opacity-50 active:scale-100";

  return (
    <div
      className={`flex flex-col gap-2 py-1.5 ${className}`}
      role="region"
      aria-label="Variation navigation tabs"
    >
      {/* If single attribute or few variations: render clean direct tabs */}
      {attrList.length <= 1 ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mr-0.5">
            {attrList[0]?.name || "Option"}:
          </span>
          <button
            type="button"
            onClick={() => handleSelectDirectVariation(null)}
            className={`${pillBase} ${isAllSelected ? pillActive : pillInactive}`}
          >
            All
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
                className={`${pillBase} ${
                  isSelected ? pillActive : pillInactive
                } ${v.active === false ? "opacity-50" : ""}`}
                title={v.shortName ? `${label} (${v.shortName})` : label}
              >
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      ) : (
        /* Multi-attribute layout: one row per attribute dimension */
        <div className="space-y-2">
          {attrList.map((attr) => {
            const selectedVal = selectedFilters[attr.name];
            return (
              <div key={attr.name} className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 min-w-14">
                  {attr.name}
                  {attr.unit ? ` (${attr.unit})` : ""}:
                </span>
                <button
                  type="button"
                  onClick={() => handleSelectAttribute(attr.name, null)}
                  className={`${pillBase} ${!selectedVal ? pillActive : pillInactive}`}
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
                      className={`${pillBase} ${
                        isSelected ? pillActive : count > 0 ? pillInactive : pillDisabled
                      }`}
                    >
                      <span>{val}</span>
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
