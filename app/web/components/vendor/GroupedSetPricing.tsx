"use client";

import { useMemo, useState } from "react";
import { useCan } from "@/components/MeContext";
import type { Party } from "@/components/PartyModal";
import { Alert, Avatar, EmptyState, SearchInput, TableSkeleton } from "@/components/ui";
import { ProductThumb } from "@/components/ProductThumb";
import { PriceHistoryModal } from "@/components/vendor/PriceHistoryModal";
import type { RailProduct } from "@/components/vendor/ProductRail";
import { setTypeName, useSetTypes } from "@/components/sets/SetTypes";
import { formatContentItem } from "@/components/sets/SetContents";
import { variationText } from "@/components/sets/SetSheet";
import { api } from "@/lib/api";
import { dateTime, money } from "@/lib/format";
import { ratePerOf } from "@/lib/measure";
import type { Product, GroupedInfo, SetTypeRow } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { useSupplierRates } from "@/lib/useSupplierRates";

type Byproduct = GroupedInfo["byproducts"][number];

interface CompareRate {
  supplierId: string;
  supplierName: string;
  rate: string;
  active: boolean;
  effectiveAt: string;
}

interface CompareRow {
  variationId: string;
  unit: string;
  purchaseCost: string;
  rates: CompareRate[];
  best: { supplierId: string; supplierName: string; rate: string } | null;
}

interface CompareResponse {
  rows: CompareRow[];
  total: number;
}

/**
 * Vendor Pricing for Grouped Products (Sets):
 * 1. Prominent Standard Sets breakdown with live calculated parts cost from each quoting supplier.
 * 2. Custom Set Builder / Pricing Calculator (collapsible field view) to compute set rates from custom parts.
 * 3. Supplier Set Rate table to record & save the whole-set rate per supplier.
 */
export function GroupedSetPricing({
  product,
  onDirtyChange,
}: {
  product: NonNullable<RailProduct>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const canManage = useCan("vendor_pricing.manage");

  // 1. Fetch grouped product details (main component & by-products)
  const productApi = useApi<{ product: Product }>(`/products/${product.id}`);
  const groupedInfo: GroupedInfo | undefined = productApi.data?.product?.grouped ?? undefined;

  // 2. Fetch standard sets
  const typesApi = useSetTypes(product.id, "");
  const standardSets = useMemo(
    () => (typesApi.data?.types ?? []).filter((t) => t.standard),
    [typesApi.data]
  );

  // 3. Fetch all active suppliers
  const suppliersApi = useApi<{ parties: Party[] }>("/parties?role=supplier");
  const suppliers = useMemo(
    () => (suppliersApi.data?.parties ?? []).filter((s) => s.active),
    [suppliersApi.data]
  );

  // 4. Gather all part variation IDs to fetch supplier rates for all parts
  const setVariationId = productApi.data?.product?.variations[0]?.id ?? "";
  const allPartVariationIds = useMemo(() => {
    if (!groupedInfo) return [];
    const ids = [groupedInfo.main?.variationId ?? ""];
    for (const b of groupedInfo.byproducts) {
      for (const v of b.variations) {
        ids.push(v.id);
      }
    }
    return ids.filter(Boolean);
  }, [groupedInfo]);

  // Supplier rates for all parts
  const vendorRates = useSupplierRates(allPartVariationIds);

  // 5. Compare rates for the set variation itself
  const compareApi = useApi<CompareResponse>(
    `/vendor-prices/compare?productId=${encodeURIComponent(product.id)}&minSuppliers=0&includePaused=1&page=1&pageSize=100`
  );
  const setRow = compareApi.data?.rows[0];

  // Rate inputs and pending edits
  const [newPrices, setNewPrices] = useState<Record<string, string>>({});
  const [statusOverrides, setStatusOverrides] = useState<Record<string, boolean>>({});
  const [savingRows, setSavingRows] = useState<Record<string, boolean>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [historyVar, setHistoryVar] = useState<{ variationId: string; supplierId: string; title: string } | null>(null);

  // Custom set field view state
  const [customOpen, setCustomOpen] = useState(false);
  const [customParts, setCustomParts] = useState<Record<string, { variationId: string; length: string }>>({});

  const unitOf = (b: Byproduct) => (b.lengthUnit === "ft_in" ? "in" : "m");

  /** Calculate parts cost for a given parts list from a specific supplier (or cheapest if null) */
  function calculatePartsCost(
    parts: Array<{ byproductId: string; variationId: string; length?: number | null }>,
    supplierId?: string | null
  ): { total: number; missing: number } | null {
    if (!groupedInfo) return null;
    let total = 0;
    let missing = 0;

    // Main component
    if (groupedInfo.main?.variationId) {
      const s = vendorRates.suggestions.get(groupedInfo.main.variationId);
      const r = supplierId
        ? s?.rates.find((x) => x.supplierId === supplierId)?.rate ?? null
        : s?.cheapest?.rate ?? null;
      if (r === null) missing++;
      else total += Number(r);
    }

    // Parts
    for (const p of parts) {
      if (!p.variationId) continue;
      const b = groupedInfo.byproducts.find((x) => x.id === p.byproductId);
      if (!b) continue;
      const s = vendorRates.suggestions.get(p.variationId);
      const r = supplierId
        ? s?.rates.find((x) => x.supplierId === supplierId)?.rate ?? null
        : s?.cheapest?.rate ?? null;
      if (r === null) {
        missing++;
        continue;
      }
      total += b.productType === "measured" ? ((Number(p.length) || 0) / ratePerOf(b.lengthUnit)) * Number(r) : Number(r);
    }

    return { total, missing };
  }

  // Calculate custom set cost across all suppliers
  const customPartsArray = useMemo(() => {
    return Object.entries(customParts).map(([byproductId, p]) => ({
      byproductId,
      variationId: p.variationId,
      length: p.length ? Number(p.length) : null,
    }));
  }, [customParts]);

  const customSetSummary = useMemo(() => {
    if (!groupedInfo || customPartsArray.length === 0) return [];
    return suppliers.map((s) => {
      const cost = calculatePartsCost(customPartsArray, s.id);
      return {
        supplierId: s.id,
        supplierName: s.name,
        cost,
      };
    }).filter((x) => x.cost && x.cost.total > 0).sort((a, b) => (a.cost?.total ?? 0) - (b.cost?.total ?? 0));
  }, [groupedInfo, customPartsArray, suppliers, vendorRates]);

  // Filter supplier list
  const filteredSuppliers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => s.name.toLowerCase().includes(q) || (s.city && s.city.toLowerCase().includes(q)));
  }, [suppliers, filter]);

  // Set single price input
  function setPrice(supplierId: string, val: string) {
    setNewPrices((prev) => ({ ...prev, [supplierId]: val }));
    onDirtyChange?.(true);
  }

  // Save single supplier set rate
  async function saveSingleSupplier(supplierId: string, supplierName: string) {
    if (!setVariationId) return;
    const val = newPrices[supplierId]?.trim();
    if (!val || !/^\d{1,10}$/.test(val) || Number(val) <= 0) {
      setMsg({ kind: "error", text: "Enter a rate above 0" });
      return;
    }
    const currentActive = statusOverrides[supplierId] ?? setRow?.rates.find((r) => r.supplierId === supplierId)?.active ?? true;

    setSavingRows((prev) => ({ ...prev, [supplierId]: true }));
    setMsg(null);
    try {
      await api("/vendor-prices", {
        method: "PUT",
        body: {
          supplierId,
          variationId: setVariationId,
          rate: val,
          active: currentActive,
        },
      });
      setNewPrices((prev) => {
        const next = { ...prev };
        delete next[supplierId];
        return next;
      });
      setMsg({ kind: "success", text: `Saved set rate ₹${val} for ${product.name} · ${supplierName}` });
      await compareApi.reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    } finally {
      setSavingRows((prev) => ({ ...prev, [supplierId]: false }));
    }
  }

  // Save all pending set rates
  async function saveAllSetRates() {
    if (!setVariationId) return;
    const records: Array<{ variationId: string; supplierId: string; rate: string; active: boolean }> = [];
    for (const [sId, val] of Object.entries(newPrices)) {
      if (val.trim() && /^\d{1,10}$/.test(val.trim()) && Number(val.trim()) > 0) {
        const active = statusOverrides[sId] ?? setRow?.rates.find((r) => r.supplierId === sId)?.active ?? true;
        records.push({ variationId: setVariationId, supplierId: sId, rate: val.trim(), active });
      }
    }
    if (!records.length) {
      setMsg({ kind: "error", text: "No valid set rates to save." });
      return;
    }
    setSavingAll(true);
    setMsg(null);
    try {
      const res = await api<{ count: number }>("/vendor-prices/batch", { method: "PUT", body: { records } });
      setNewPrices({});
      setMsg({ kind: "success", text: `Successfully saved ${res.count} set rate(s)!` });
      await compareApi.reload();
      onDirtyChange?.(false);
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    } finally {
      setSavingAll(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Top Product Header */}
      <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <ProductThumb src={product.imageUrl} name={product.name} className="h-12 w-12 shrink-0 rounded-lg border border-slate-200" />
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Grouped Product · Set Rates</div>
            <div className="truncate text-base font-bold text-slate-900">{product.name}</div>
            <div className="flex flex-wrap gap-x-3 text-xs text-slate-500">
              <span>{product.category?.name ?? "Uncategorized"}</span>
              <span>{standardSets.length} standard presets</span>
              <span>{suppliers.length} active suppliers</span>
              <span>₹ per set</span>
            </div>
          </div>
        </div>
        {setRow?.best && (
          <div className="text-right text-xs">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Best quoted set rate</span>
            <span className="font-bold text-sm text-emerald-700">₹{money(setRow.best.rate)}</span>
            <span className="block text-[11px] text-slate-500">· {setRow.best.supplierName}</span>
          </div>
        )}
      </div>

      {msg && <Alert message={msg.text} kind={msg.kind} />}

      {/* 1. Big & User-Friendly Standard Sets Breakdown */}
      {standardSets.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-gradient-to-b from-sky-50/80 to-sky-50/20 p-4 shadow-2xs">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-1 border-b border-sky-100 pb-2">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-sky-950 flex items-center gap-1.5">
                <svg className="h-4 w-4 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Standard Sets · Supplier Parts Pricing
              </h3>
              <p className="text-[11px] text-sky-700">Calculated cost of each standard preset from suppliers' component rates.</p>
            </div>
            <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-semibold text-sky-800">
              {standardSets.length} {standardSets.length === 1 ? "preset" : "presets"}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {standardSets.map((t) => {
              const bestPartsCost = calculatePartsCost(t.parts, null);
              return (
                <div key={t.typeKey} className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs hover:border-slate-300 transition">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <div className="font-bold text-sm text-slate-900">{t.name || setTypeName(t)}</div>
                      {t.name && <div className="text-[11px] text-slate-500">{setTypeName(t)}</div>}
                    </div>
                    {bestPartsCost && bestPartsCost.total > 0 && (
                      <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                        Cheapest parts: ₹{money(Math.round(bestPartsCost.total))}
                      </span>
                    )}
                  </div>

                  {/* Components */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {t.contents.map((c) => {
                      const { label, displayValue, isFitted, fullTitle } = formatContentItem(c);
                      return (
                        <span key={c.name} className="inline-flex items-center gap-1 text-[11px] bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-md text-slate-700" title={fullTitle}>
                          {isFitted ? (
                            <span className="font-semibold text-slate-900">{displayValue}</span>
                          ) : (
                            <>
                              <span className="text-slate-500 font-medium">{label}:</span>
                              <span className="font-semibold text-slate-900">{displayValue}</span>
                            </>
                          )}
                        </span>
                      );
                    })}
                  </div>

                  {/* Top Quoting Suppliers for this preset */}
                  <div className="border-t border-slate-100 pt-2 text-xs">
                    <span className="text-[11px] font-semibold text-slate-500 block mb-1">Calculated from supplier parts:</span>
                    <div className="space-y-1">
                      {suppliers.slice(0, 3).map((s) => {
                        const cost = calculatePartsCost(t.parts, s.id);
                        if (!cost || cost.total === 0) return null;
                        return (
                          <div key={s.id} className="flex items-center justify-between text-slate-700 bg-slate-50 px-2 py-1 rounded">
                            <span className="truncate">{s.name}</span>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">₹{money(Math.round(cost.total))}</span>
                              {canManage && (
                                <button
                                  type="button"
                                  onClick={() => setPrice(s.id, String(Math.round(cost.total)))}
                                  className="text-[10px] font-semibold text-brand-600 hover:underline"
                                  title="Copy as set rate"
                                >
                                  Use rate
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 2. Custom Set Builder / Pricing Calculator (Collapsible Dropdown Field View) */}
      {groupedInfo && (
        <div className="rounded-xl border border-slate-200/90 bg-white shadow-2xs overflow-hidden transition-all">
          <button
            type="button"
            onClick={() => setCustomOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100/80 transition text-left cursor-pointer border-b border-transparent data-[open=true]:border-slate-200"
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
                  Custom Set Pricing Calculator (Field View)
                </span>
                <span className="ml-2 text-[11px] text-slate-500 hidden sm:inline">
                  (Configure custom components & lengths to calculate supplier pricing in real time)
                </span>
              </div>
            </div>
            <span className="text-xs font-semibold text-brand-600 hover:text-brand-700">
              {customOpen ? "Collapse calculator" : "+ Configure Custom Set"}
            </span>
          </button>

          {customOpen && (
            <div className="p-4 space-y-4 bg-slate-50/30">
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Select Components & Variations
                  </span>
                  <span className="h-px bg-slate-100 flex-1"></span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {groupedInfo.byproducts.map((b) => {
                    const p = customParts[b.id] ?? { variationId: "", length: "" };
                    const isMeasured = b.productType === "measured";

                    return (
                      <div
                        key={b.id}
                        className="flex flex-col justify-between rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 transition focus-within:border-brand-500 focus-within:bg-white"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1 mb-1.5">
                            <label className="text-xs font-semibold text-slate-700 truncate" title={b.name}>
                              {b.name}
                              {b.required ? <span className="text-rose-500 font-bold ml-0.5">*</span> : <span className="text-[10px] text-slate-400 ml-1">(optional)</span>}
                            </label>
                            {isMeasured && (
                              <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">
                                {unitOf(b)}
                              </span>
                            )}
                          </div>

                          <select
                            className="input py-1.5 text-xs bg-white"
                            value={p.variationId}
                            onChange={(e) => setCustomParts((prev) => ({ ...prev, [b.id]: { ...p, variationId: e.target.value } }))}
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
                                onChange={(e) => setCustomParts((prev) => ({ ...prev, [b.id]: { ...p, length: e.target.value } }))}
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

                {/* Live Calculated Supplier Pricing for this Custom Set */}
                {customSetSummary.length > 0 && (
                  <div className="mt-4 border-t border-slate-100 pt-3">
                    <span className="text-xs font-bold text-slate-700 block mb-2">
                      Calculated Parts Cost for this Custom Set:
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                      {customSetSummary.map((item, idx) => (
                        <div
                          key={item.supplierId}
                          className={`rounded-lg p-2.5 border transition ${
                            idx === 0 ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200 bg-white"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1 mb-1">
                            <span className="text-xs font-semibold text-slate-800 truncate">{item.supplierName}</span>
                            {idx === 0 && (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[10px] font-bold text-emerald-800">
                                Best
                              </span>
                            )}
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-bold text-slate-900">₹{money(Math.round(item.cost?.total ?? 0))}</span>
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => setPrice(item.supplierId, String(Math.round(item.cost?.total ?? 0)))}
                                className="text-[11px] font-semibold text-brand-600 hover:underline"
                              >
                                Set as rate
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. Supplier Quoted Set Rates Table */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 p-4">
          <div className="w-full sm:w-64">
            <SearchInput value={filter} onChange={setFilter} placeholder="Filter suppliers…" />
          </div>

          {canManage && (
            <button
              type="button"
              className="btn-primary py-1.5 text-xs font-semibold"
              onClick={saveAllSetRates}
              disabled={savingAll || Object.keys(newPrices).length === 0}
            >
              {savingAll ? "Saving…" : "Save All Records"}
            </button>
          )}
        </div>

        {compareApi.loading && !compareApi.data ? (
          <TableSkeleton rows={6} />
        ) : filteredSuppliers.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">No suppliers match the filter.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-stack text-xs">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Contact</th>
                  <th className="text-right">Quoted Set Rate</th>
                  <th className="text-right">New Set Rate (₹)</th>
                  <th className="text-center">Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.map((s) => {
                  const existingQuote = setRow?.rates.find((r) => r.supplierId === s.id);
                  const isBest = setRow?.best?.supplierId === s.id;
                  const entered = newPrices[s.id] ?? "";
                  const active = statusOverrides[s.id] ?? existingQuote?.active ?? true;
                  const isSaving = savingRows[s.id] ?? false;

                  return (
                    <tr key={s.id} className={active ? "hover:bg-slate-50/70" : "opacity-60 bg-slate-50/40"}>
                      <td>
                        <div className="flex items-center gap-2">
                          <Avatar name={s.name} seed={s.id} size="sm" muted={!existingQuote} />
                          <div>
                            <div className="font-semibold text-slate-900">{s.name}</div>
                            {isBest && (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-800">
                                Best quote
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="text-slate-600">{[s.city, s.phone].filter(Boolean).join(" · ") || "—"}</td>

                      <td className="text-right">
                        {existingQuote ? (
                          <div>
                            <div className={`font-semibold ${existingQuote.active ? (isBest ? "text-emerald-700" : "text-slate-900") : "text-slate-400 line-through"}`}>
                              ₹{money(existingQuote.rate)}
                            </div>
                            {existingQuote.effectiveAt && (
                              <div className="text-[10px] text-slate-400">{dateTime(existingQuote.effectiveAt)}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Not set</span>
                        )}
                      </td>

                      <td className="text-right">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="Enter ₹"
                            value={entered}
                            disabled={!canManage}
                            onChange={(e) => setPrice(s.id, e.target.value.replace(/[^\d]/g, ""))}
                            className={`input w-28 text-right font-medium py-1 text-xs ${
                              entered ? "border-brand-500 ring-1 ring-brand-500 bg-brand-50/20" : ""
                            }`}
                          />
                          {existingQuote && (
                            <button
                              type="button"
                              onClick={() => setPrice(s.id, String(Math.round(Number(existingQuote.rate))))}
                              disabled={!canManage}
                              className="rounded border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-200 active:scale-95"
                              title="Copy last rate"
                            >
                              Same
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="text-center">
                        <button
                          type="button"
                          onClick={() => setStatusOverrides((prev) => ({ ...prev, [s.id]: !active }))}
                          disabled={!canManage}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                            active ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200" : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                          }`}
                        >
                          {active ? "Active" : "Paused"}
                        </button>
                      </td>

                      <td className="text-right">
                        <div className="inline-flex items-center gap-1">
                          {canManage && entered && (
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => saveSingleSupplier(s.id, s.name)}
                              className="rounded bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700"
                            >
                              {isSaving ? "…" : "Save"}
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={!existingQuote}
                            onClick={() =>
                              setHistoryVar({
                                variationId: setVariationId,
                                supplierId: s.id,
                                title: `${product.name} · ${s.name}`,
                              })
                            }
                            className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                          >
                            History
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {historyVar && (
        <PriceHistoryModal
          variationId={historyVar.variationId}
          supplierId={historyVar.supplierId}
          title={historyVar.title}
          lengthUnit={null}
          onClose={() => setHistoryVar(null)}
        />
      )}
    </div>
  );
}
