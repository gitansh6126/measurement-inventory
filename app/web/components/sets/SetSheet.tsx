"use client";

import { useState, type ReactNode } from "react";
import { formatContentItem } from "@/components/sets/SetContents";
import { setTypeName, useSetTypes } from "@/components/sets/SetTypes";
import type { GroupedInfo, SetContentRow, SetTypeRow } from "@/lib/types";
import { useWarehouses } from "@/lib/useWarehouses";

// V3.1 set sheet (docs\GROUPED-PRODUCTS-V3-PLAN.md §3): one row per set, picking every
// by-product's variation (and the length of a measured part) plus the set's rate. Shared by the
// admin "Add opening sets" dialog and the purchase cart.

type Byproduct = GroupedInfo["byproducts"][number];

export interface SheetPart {
  variationId: string;
  length: string;
}

export interface SheetRow {
  key: number;
  rate: string;
  notes: string;
  parts: Record<string, SheetPart>;
  /** V3.1 (GW-1): the warehouse this set is in; "" = the header / default warehouse. */
  warehouseId?: string;
  /** 0041 Add sets sheet: selling price, minimum selling price and minimum stock of its set type. */
  salePrice?: string;
  minSalePrice?: string;
  lowStockThreshold?: string;
}

/** One set as the API takes it (POST /api/sets/opening, purchase line `sets[]`). */
export interface SetBody {
  rate: string;
  notes: string | null;
  parts: { byproductId: string; variationId: string; length?: number }[];
  warehouseId?: string | null;
  salePrice?: string;
  minSalePrice?: string;
  lowStockThreshold?: number;
}

export const variationText = (b: Byproduct, v: Byproduct["variations"][number]) => v.label || b.name;

export function emptyRow(info: GroupedInfo, key: number, rate: string): SheetRow {
  return {
    key,
    rate,
    notes: "",
    parts: Object.fromEntries(
      info.byproducts.map((b) => [b.id, { variationId: b.required && b.variations.length === 1 ? b.variations[0]!.id : "", length: "" }]),
    ),
  };
}

/** Sheet rows from sets already entered (editing a cart line). */
export function rowsFromSets(info: GroupedInfo, sets: readonly SetBody[]): SheetRow[] {
  return sets.map((s, i) => {
    const row = emptyRow(info, i + 1, s.rate);
    row.notes = s.notes ?? "";
    row.warehouseId = s.warehouseId ?? "";
    for (const p of s.parts) row.parts[p.byproductId] = { variationId: p.variationId, length: p.length !== undefined ? String(p.length) : "" };
    return row;
  });
}

/** Validates the rows and returns the API body; throws a readable Error on the first problem. */
export function buildSets(info: GroupedInfo, rows: readonly SheetRow[], opts: { rateRequired: boolean; prices?: boolean }): SetBody[] {
  if (!rows.length) throw new Error("Add at least one set");
  return rows.map((r, i) => {
    if (opts.rateRequired && !r.rate.trim()) throw new Error(`Set ${i + 1}: enter the rate`);
    if (opts.prices && r.salePrice?.trim() && r.minSalePrice?.trim() && Number(r.minSalePrice) > Number(r.salePrice)) {
      throw new Error(`Set ${i + 1}: minimum selling price (₹${r.minSalePrice.trim()}) cannot be higher than selling price (₹${r.salePrice.trim()})`);
    }
    return {
      rate: r.rate.trim() || "0",
      notes: r.notes.trim() || null,
      ...(opts.prices && r.salePrice?.trim() ? { salePrice: r.salePrice.trim() } : {}),
      ...(opts.prices && r.minSalePrice?.trim() ? { minSalePrice: r.minSalePrice.trim() } : {}),
      ...(opts.prices && r.lowStockThreshold?.trim() ? { lowStockThreshold: Number(r.lowStockThreshold) } : {}),
      ...(r.warehouseId ? { warehouseId: r.warehouseId } : {}),
      parts: info.byproducts.flatMap((b) => {
        const p = r.parts[b.id] ?? { variationId: "", length: "" };
        if (!p.variationId) {
          if (b.required) throw new Error(`Set ${i + 1}: choose the ${b.name}`);
          return [];
        }
        if (b.productType === "measured") {
          const n = Number(p.length);
          if (!p.length.trim() || !Number.isFinite(n) || n <= 0) throw new Error(`Set ${i + 1}: enter the ${b.name} length`);
          return [{ byproductId: b.id, variationId: p.variationId, length: n }];
        }
        return [{ byproductId: b.id, variationId: p.variationId }];
      }),
    };
  });
}

/** Short contents of one set for a cart line: "8 mm 3 m · Safety Hook 1 Ton". */
export function setSummary(info: GroupedInfo, set: SetBody): string {
  return set.parts
    .map((p) => {
      const b = info.byproducts.find((x) => x.id === p.byproductId);
      const v = b?.variations.find((x) => x.id === p.variationId);
      if (!b || !v) return "";
      const len = p.length !== undefined ? ` ${p.length} ${b.lengthUnit === "ft_in" ? "in" : "m"}` : "";
      return b.productType === "simple" ? b.name : `${variationText(b, v)}${len}`;
    })
    .filter(Boolean)
    .join(" · ");
}

/** A part's clean value: "8 mm · 3 m" (measured), "8 mm" (variable), "Fitted" (simple). */
export function partValue(b: Byproduct, v: Byproduct["variations"][number] | undefined, length?: number | string) {
  if (b.productType === "simple") return "Fitted";
  const len = b.productType === "measured" && length !== undefined && length !== "" ? `${length} ${b.lengthUnit === "ft_in" ? "in" : "m"}` : "";
  return [v ? variationText(b, v) : "", len].filter(Boolean).join(" · ");
}

/** One set's contents part by part, for cart lines (no codes). */
export function setContentRows(info: GroupedInfo, set: SetBody): SetContentRow[] {
  return info.byproducts.flatMap((b) => {
    const p = set.parts.find((x) => x.byproductId === b.id);
    if (!p) return [];
    return [{ name: b.name, value: partValue(b, b.variations.find((x) => x.id === p.variationId), p.length) }];
  });
}

export function SetSheetTable({
  info,
  rows,
  setRows,
  defaultRate,
  rateLabel = "Rate (₹) *",
  defaultWarehouseLabel = "Default",
  showWarehouse = true,
  rateHint,
  standardRateHint,
  groupId,
  prices = false,
}: {
  /** 0041: the grouped product, to offer its standard sets ("+ 5 sets" of one standard set). */
  groupId?: string;
  /** 0041 Add sets sheet: selling price, minimum selling price and minimum stock columns. */
  prices?: boolean;
  info: GroupedInfo;
  rows: SheetRow[];
  setRows: (fn: (rows: SheetRow[]) => SheetRow[]) => void;
  defaultRate: string;
  rateLabel?: string;
  /** What an empty warehouse choice means ("Receive into W1", "Default W1"). */
  defaultWarehouseLabel?: string;
  /** False hides the per-set warehouse column (purchase product picking). */
  showWarehouse?: boolean;
  /** Line under a row's rate (purchase cart: the supplier's cost of its parts). */
  rateHint?: (row: SheetRow) => ReactNode;
  /** Line under a standard preset's rate (purchase cart: the supplier's cost of its parts). */
  standardRateHint?: (t: SetTypeRow) => ReactNode;
}) {
  const wh = useWarehouses();
  const whCol = wh.enabled && showWarehouse;
  const setPart = (key: number, bp: string, patch: Partial<SheetPart>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, parts: { ...r.parts, [bp]: { ...r.parts[bp]!, ...patch } } } : r)));
  const unitOf = (b: Byproduct) => (b.lengthUnit === "ft_in" ? "in" : "m");
  const nextKey = (rs: SheetRow[]) => (rs.at(-1)?.key ?? 0) + 1;
  const types = useSetTypes(groupId ?? "", "");
  const standard = groupId ? (types.data?.types ?? []).filter((t) => t.standard) : [];
  const [customOpen, setCustomOpen] = useState(false);
  const setPrice = (key: number, patch: Partial<SheetRow>) => setRows((rs) => rs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const duplicateRow = (r: SheetRow) =>
    setRows((rs) => [...rs, { ...r, key: nextKey(rs), parts: structuredClone(r.parts) }]);
  const removeRow = (key: number) =>
    setRows((rs) => rs.filter((x) => x.key !== key));

  // Check if a row matches a standard preset's parts
  const matchesPreset = (r: SheetRow, t: SetTypeRow) => {
    if (!t.parts.length) return false;
    const tMap = new Map(t.parts.map((p) => [p.byproductId, p]));
    for (const b of info.byproducts) {
      const tp = tMap.get(b.id);
      const rp = r.parts[b.id];
      const rVar = rp?.variationId ?? "";
      const tVar = tp?.variationId ?? "";
      if (rVar !== tVar) return false;
      if (b.productType === "measured" && rVar) {
        const rLen = rp?.length ? String(rp.length) : "";
        const tLen = tp?.length !== null && tp?.length !== undefined ? String(tp.length) : "";
        if (rLen !== tLen) return false;
      }
    }
    return true;
  };

  const countForPreset = (t: SetTypeRow) => rows.filter((r) => matchesPreset(r, t)).length;

  const removeOneOfPreset = (t: SetTypeRow) => {
    setRows((rs) => {
      const idx = rs.map((r) => matchesPreset(r, t)).lastIndexOf(true);
      if (idx === -1) return rs;
      return rs.filter((_, i) => i !== idx);
    });
  };

  // A standard set fills N rows with its parts (and, on the Add sets sheet, its prices).
  const addStandard = (t: SetTypeRow, n: number) =>
    setRows((rs) => {
      // A first row with nothing chosen yet is replaced.
      const blank = rs.length === 1 && info.byproducts.every((b) => {
        const p = rs[0]!.parts[b.id];
        return !p?.variationId || (b.variations.length === 1 && !p.length);
      });
      const out = blank ? [] : [...rs];
      const rate = rs.at(-1)?.rate || (Number(t.rate) > 0 ? t.rate.split(".")[0]! : defaultRate);
      for (let i = 0; i < n && out.length < 100; i++) {
        const row = emptyRow(info, nextKey(out.length ? out : rs), rate);
        for (const b of info.byproducts) row.parts[b.id] = { variationId: "", length: "" };
        for (const p of t.parts) row.parts[p.byproductId] = { variationId: p.variationId, length: p.length !== null ? String(p.length) : "" };
        if (prices) Object.assign(row, { salePrice: String(Number(t.salePrice)), minSalePrice: String(Number(t.minSalePrice)), lowStockThreshold: String(t.lowStockThreshold) });
        out.push(row);
      }
      return out;
    });

  const isCustomRow = (r: SheetRow) => !standard.some((t) => matchesPreset(r, t));
  const customRowsCount = rows.filter(isCustomRow).length;

  return (
    <>
      {/* 1. Big & User-Friendly Standard Sets Section */}
      {standard.length > 0 && (
        <div className="mb-4 rounded-xl border border-sky-200 bg-gradient-to-b from-sky-50/80 to-sky-50/20 p-3.5 shadow-2xs">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-1 border-b border-sky-100 pb-2">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-sky-950 flex items-center gap-1.5">
                <svg className="h-4 w-4 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Standard Sets
              </h3>
              <p className="text-[11px] text-sky-700">Pre-configured standard sets. Click + or type quantity to add sets directly.</p>
            </div>
            <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-semibold text-sky-800">
              {standard.length} {standard.length === 1 ? "preset" : "presets"}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {standard.map((t) => {
              const count = countForPreset(t);
              return (
                <div
                  key={t.typeKey}
                  className={`rounded-xl border p-3.5 transition-all shadow-2xs bg-white ${
                    count > 0 ? "border-brand-500 ring-1 ring-brand-500/20" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <div className="font-bold text-sm text-slate-900 truncate">
                        {t.name || setTypeName(t)}
                      </div>
                      {t.name && (
                        <div className="text-[11px] text-slate-500 truncate">
                          {setTypeName(t)}
                        </div>
                      )}
                    </div>
                    {count > 0 && (
                      <span className="shrink-0 rounded-full bg-brand-50 border border-brand-200 px-2.5 py-0.5 text-xs font-bold text-brand-700">
                        {count} in order
                      </span>
                    )}
                  </div>

                  {/* Contents Pills */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {t.contents.map((c) => {
                      const { label, displayValue, isFitted, fullTitle } = formatContentItem(c);
                      return (
                        <span
                          key={c.name}
                          className="inline-flex items-center gap-1 text-[11px] bg-slate-50 border border-slate-200/80 px-2 py-0.5 rounded-md text-slate-700 font-medium"
                          title={fullTitle}
                        >
                          {isFitted ? (
                            <span className="font-semibold text-slate-800">{displayValue}</span>
                          ) : (
                            <>
                              <span className="text-slate-500 font-medium">{label}:</span>
                              <span className="font-semibold text-slate-800">{displayValue}</span>
                            </>
                          )}
                        </span>
                      );
                    })}
                  </div>

                  {/* Pricing / Rate row */}
                  <div className="mb-3 rounded-lg bg-slate-50 p-2 border border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
                    {prices ? (
                      <div className="flex flex-wrap items-center gap-2 text-slate-600">
                        <span>Selling: <strong className="text-slate-900">₹{t.salePrice}</strong></span>
                        <span>·</span>
                        <span>Min: <strong className="text-slate-900">₹{t.minSalePrice}</strong></span>
                        <span>·</span>
                        <span>Min Stock: <strong className="text-slate-900">{t.lowStockThreshold}</strong></span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between w-full gap-2">
                        <span className="text-slate-600">
                          Rate: <strong className="text-slate-900">₹{t.rate || defaultRate || "0"}</strong>
                        </span>
                        {standardRateHint?.(t)}
                      </div>
                    )}
                  </div>

                  {/* Stepper & Quick Add */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                    <span className="text-xs font-semibold text-slate-600">Quantity</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={count === 0}
                        onClick={() => removeOneOfPreset(t)}
                        className="h-7 w-7 rounded-md border border-slate-300 bg-white font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition flex items-center justify-center text-sm cursor-pointer"
                        title="Remove 1 set"
                      >
                        −
                      </button>
                      <span className="w-8 text-center text-xs font-bold text-slate-900">
                        {count}
                      </span>
                      <button
                        type="button"
                        disabled={rows.length >= 100}
                        onClick={() => addStandard(t, 1)}
                        className="h-7 w-7 rounded-md border border-slate-300 bg-white font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none transition flex items-center justify-center text-sm cursor-pointer"
                        title="Add 1 set"
                      >
                        +
                      </button>
                      <button
                        type="button"
                        disabled={rows.length >= 100}
                        onClick={() => addStandard(t, 1)}
                        className="ml-1 rounded border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-100 transition cursor-pointer"
                      >
                        +1
                      </button>
                      <button
                        type="button"
                        disabled={rows.length >= 96}
                        onClick={() => addStandard(t, 5)}
                        className="rounded border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 hover:bg-sky-100 transition cursor-pointer"
                      >
                        +5
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. Collapsible Custom Set Builder (Dropdown Accordion) */}
      <div className="rounded-xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden transition-all">
        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v)}
          className="w-full flex items-center justify-between px-3.5 py-2.5 bg-slate-50 hover:bg-slate-100/80 transition text-left cursor-pointer border-b border-transparent data-[open=true]:border-slate-200"
          data-open={customOpen}
        >
          <div className="flex items-center gap-2">
            <svg
              className={`w-4 h-4 text-slate-500 transition-transform duration-200 ${customOpen ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <div>
              <span className="text-xs font-bold text-slate-800">
                Custom Set Builder
              </span>
              <span className="ml-2 text-[11px] text-slate-500 hidden sm:inline">
                (Non-standard parts, custom lengths & one-off sets)
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {customRowsCount > 0 && (
              <span className="rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                {customRowsCount} custom {customRowsCount === 1 ? "set" : "sets"}
              </span>
            )}
            <span className="text-xs font-semibold text-brand-600 hover:text-brand-700">
              {customOpen ? "Collapse" : "+ Configure Custom Set"}
            </span>
          </div>
        </button>

        {customOpen && (
          <div className="p-3.5 space-y-3.5 bg-slate-50/30">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 pb-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-secondary py-1 text-xs font-semibold"
                  onClick={() => setRows((rs) => [...rs, emptyRow(info, nextKey(rs), rs.at(-1)?.rate ?? defaultRate)])}
                  disabled={rows.length >= 100}
                >
                  + Add custom set
                </button>
                <button
                  type="button"
                  className="btn-secondary py-1 text-xs"
                  onClick={() => rows.length && duplicateRow(rows[rows.length - 1]!)}
                  disabled={!rows.length || rows.length >= 100}
                >
                  Copy last set
                </button>
              </div>
              <span className="text-xs font-medium text-slate-500">
                {rows.length} {rows.length === 1 ? "set" : "sets"} in order
              </span>
            </div>

            {/* Set Cards */}
            <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-3.5">
              {rows.map((r, i) => {
                const matched = standard.find((t) => matchesPreset(r, t));
                return (
                  <div key={r.key} className="rounded-xl border border-slate-200/90 bg-white shadow-2xs hover:border-slate-300 transition-all overflow-hidden">
                    {/* Card Header */}
                    <div className="bg-slate-50/90 px-3.5 py-2 border-b border-slate-200/80 flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center h-6 px-2.5 rounded-full bg-brand-600 text-white text-xs font-bold tracking-wide">
                          Set #{i + 1}
                        </span>
                        {matched ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded-md">
                            Standard: {matched.name || setTypeName(matched)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                            Custom
                          </span>
                        )}
                        {info.main?.name && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 bg-white border border-slate-200 px-2 py-0.5 rounded-md shadow-2xs">
                            <span className="text-[10px] uppercase font-semibold text-slate-400">Main:</span>
                            <span className="font-semibold text-slate-800">{info.main.name}</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-brand-600 font-medium px-2 py-1 rounded hover:bg-white border border-transparent hover:border-slate-200 transition"
                          onClick={() => duplicateRow(r)}
                          title="Duplicate this set"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Duplicate
                        </button>
                        {rows.length > 1 && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-medium px-2 py-1 rounded hover:bg-rose-50 border border-transparent hover:border-rose-100 transition"
                            onClick={() => removeRow(r.key)}
                            title="Remove this set"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="p-3.5 space-y-3.5">
                      {/* Section 1: Components & Variations */}
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            Components & Variations
                          </span>
                          <span className="h-px bg-slate-100 flex-1"></span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {info.byproducts.map((b) => {
                            const p = r.parts[b.id] ?? { variationId: "", length: "" };
                            const isMeasured = b.productType === "measured";

                            return (
                              <div
                                key={b.id}
                                className="flex flex-col justify-between rounded-lg border border-slate-200/90 bg-slate-50/40 p-2.5 transition focus-within:border-brand-500 focus-within:bg-white focus-within:ring-1 focus-within:ring-brand-500/10"
                              >
                                <div>
                                  <div className="flex items-center justify-between gap-1 mb-1.5">
                                    <label className="text-xs font-semibold text-slate-700 truncate" title={b.name}>
                                      {b.name}
                                      {b.required ? (
                                        <span className="text-rose-500 font-bold ml-0.5" title="Required">*</span>
                                      ) : (
                                        <span className="text-[10px] font-normal text-slate-400 ml-1">(optional)</span>
                                      )}
                                    </label>
                                    {isMeasured && (
                                      <span className="shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">
                                        {unitOf(b)}
                                      </span>
                                    )}
                                  </div>

                                  <select
                                    className="input py-1.5 text-xs bg-white"
                                    value={p.variationId}
                                    onChange={(e) => setPart(r.key, b.id, { variationId: e.target.value })}
                                    aria-label={`Set ${i + 1} ${b.name}`}
                                  >
                                    <option value="">{b.required ? "Choose variation…" : "— not fitted —"}</option>
                                    {b.variations.map((v) => (
                                      <option key={v.id} value={v.id}>
                                        {variationText(b, v)}
                                      </option>
                                    ))}
                                  </select>
                                </div>

                                {isMeasured && (
                                  <div className="mt-2 pt-2 border-t border-slate-200/70">
                                    <label className="flex items-center justify-between text-[11px] font-medium text-slate-500 mb-1">
                                      <span>Length</span>
                                      <span className="text-[10px] text-slate-400">in {unitOf(b)}</span>
                                    </label>
                                    <div className="relative flex items-center">
                                      <input
                                        className="input py-1.5 pr-8 text-xs font-mono bg-white"
                                        inputMode="decimal"
                                        placeholder="Length"
                                        value={p.length}
                                        onChange={(e) => setPart(r.key, b.id, { length: e.target.value })}
                                        aria-label={`Set ${i + 1} ${b.name} length`}
                                      />
                                      <span className="absolute right-2.5 text-xs font-bold text-slate-400 pointer-events-none">
                                        {unitOf(b)}
                                      </span>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Section 2: Pricing, Warehouse & Notes */}
                      <div className="border-t border-slate-100 pt-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            Pricing & Inventory Details
                          </span>
                          <span className="h-px bg-slate-100 flex-1"></span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                          {/* Rate Field */}
                          <div>
                            <label className="label text-[11px] font-semibold text-slate-600 mb-1">
                              {rateLabel}
                            </label>
                            <div className="relative flex items-center">
                              <span className="absolute left-2.5 text-xs font-bold text-slate-400 pointer-events-none">₹</span>
                              <input
                                className="input pl-6 py-1.5 text-xs font-semibold"
                                inputMode="numeric"
                                placeholder="0"
                                value={r.rate}
                                onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, rate: e.target.value.replace(/\D/g, "") } : x)))}
                                aria-label={`Set ${i + 1} rate`}
                              />
                            </div>
                            {rateHint?.(r)}
                          </div>

                          {/* Warehouse Field (if whCol) */}
                          {whCol && (
                            <div>
                              <label className="label text-[11px] font-semibold text-slate-600 mb-1">
                                Warehouse
                              </label>
                              <select
                                className="input py-1.5 text-xs"
                                value={r.warehouseId ?? ""}
                                onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, warehouseId: e.target.value } : x)))}
                                aria-label={`Set ${i + 1} warehouse`}
                              >
                                <option value="">{defaultWarehouseLabel}</option>
                                {wh.active.map((w) => (
                                  <option key={w.id} value={w.id}>
                                    {w.code} · {w.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}

                          {/* Selling Prices (if prices is true) */}
                          {prices && (() => {
                            const sp = r.salePrice?.trim();
                            const msp = r.minSalePrice?.trim();
                            const priceErr = sp && msp && Number(msp) > Number(sp);
                            return (
                              <>
                                <div>
                                  <label className="label text-[11px] font-semibold text-slate-600 mb-1" title="Selling price of this set type">
                                    Selling Price
                                  </label>
                                  <div className="relative flex items-center">
                                    <span className="absolute left-2.5 text-xs font-bold text-slate-400 pointer-events-none">₹</span>
                                    <input
                                      className={`input pl-6 py-1.5 text-xs ${priceErr ? "border-rose-500 bg-rose-50 text-rose-900" : ""}`}
                                      inputMode="numeric"
                                      placeholder="Unchanged"
                                      value={r.salePrice ?? ""}
                                      onChange={(e) => setPrice(r.key, { salePrice: e.target.value.replace(/\D/g, "") })}
                                      aria-label={`Set ${i + 1} selling price`}
                                    />
                                  </div>
                                </div>

                                <div>
                                  <label className="label text-[11px] font-semibold text-slate-600 mb-1" title="Minimum selling price of this set type">
                                    Min Selling Price
                                  </label>
                                  <div className="relative flex items-center">
                                    <span className="absolute left-2.5 text-xs font-bold text-slate-400 pointer-events-none">₹</span>
                                    <input
                                      className={`input pl-6 py-1.5 text-xs ${priceErr ? "border-rose-500 bg-rose-50 text-rose-900 focus:border-rose-600 focus:ring-rose-500" : ""}`}
                                      inputMode="numeric"
                                      placeholder="Unchanged"
                                      value={r.minSalePrice ?? ""}
                                      onChange={(e) => setPrice(r.key, { minSalePrice: e.target.value.replace(/\D/g, "") })}
                                      aria-label={`Set ${i + 1} minimum selling price`}
                                    />
                                  </div>
                                  {priceErr && <div className="mt-0.5 text-[10px] font-medium leading-tight text-rose-600">Must be ≤ ₹${sp}</div>}
                                </div>
                                <div>
                                  <label className="label text-[11px] font-semibold text-slate-600 mb-1" title="Warn when this set type is at or below it">
                                    Min Stock Alert
                                  </label>
                                  <input
                                    className="input py-1.5 text-xs"
                                    inputMode="numeric"
                                    placeholder="Unchanged"
                                    value={r.lowStockThreshold ?? ""}
                                    onChange={(e) => setPrice(r.key, { lowStockThreshold: e.target.value.replace(/\D/g, "") })}
                                    aria-label={`Set ${i + 1} minimum stock`}
                                  />
                                </div>
                              </>
                            );
                          })()}

                          {/* Note Field */}
                          <div className={prices ? "sm:col-span-2 lg:col-span-3" : whCol ? "sm:col-span-1 md:col-span-1" : "sm:col-span-2"}>
                            <label className="label text-[11px] font-semibold text-slate-600 mb-1">
                              Note / Remarks
                            </label>
                            <input
                              className="input py-1.5 text-xs"
                              maxLength={300}
                              placeholder="Optional notes, condition or serial #"
                              value={r.notes}
                              onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, notes: e.target.value } : x)))}
                              aria-label={`Set ${i + 1} note`}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom Add CTA Strip */}
            <div className="pt-1 flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary flex-1 py-2 text-xs font-semibold flex items-center justify-center gap-1.5 border-dashed border-slate-300 hover:border-brand-500 hover:text-brand-600 transition"
                onClick={() => setRows((rs) => [...rs, emptyRow(info, nextKey(rs), rs.at(-1)?.rate ?? defaultRate)])}
                disabled={rows.length >= 100}
              >
                + Add another custom set
              </button>
              <button
                type="button"
                className="btn-secondary py-2 text-xs font-semibold"
                onClick={() => rows.length && duplicateRow(rows[rows.length - 1]!)}
                disabled={!rows.length || rows.length >= 100}
              >
                Copy last set
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

