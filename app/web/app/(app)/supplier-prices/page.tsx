"use client";

import { Fragment, Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useCan } from "@/components/MeContext";
import type { Party } from "@/components/PartyModal";
import { Restricted } from "@/components/Restricted";
import { Alert, Avatar, EmptyState, PageHeader, SearchInput, Segmented, TableSkeleton } from "@/components/ui";
import { PlusIcon, SidebarIcon } from "@/components/icons";
import { Combobox } from "@/components/Combobox";
import { api } from "@/lib/api";
import { dateTime } from "@/lib/format";
import type { AttributeDef, CategoryList } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { variationAttributeColumns } from "@/lib/variationColumns";
import { RateField } from "@/components/measure/RateField";
import { ProductPriceView } from "@/components/vendor/ProductPriceView";
import { PriceHistoryModal } from "@/components/vendor/PriceHistoryModal";
import { VendorPricingModal } from "@/components/vendor/VendorPricingModal";
import { PriceRail, RailItem, type RailMode } from "@/components/vendor/PriceRail";
import { ProductRail, type RailProduct } from "@/components/vendor/ProductRail";
import { fmtRate, rateLabel, type LengthUnit } from "@/lib/measure";
import { useLengthView } from "@/lib/lengthView";
import { LengthViewToggle } from "@/components/measure/LengthViewToggle";
import { useEntryUnits } from "@/lib/useEntryUnits";

/** " / ft" or " / m" after a Measured rate; nothing for counted items. */

interface SheetRate {
  id: string;
  rate: string;
  active: boolean;
  notes: string | null;
  effectiveAt: string;
}

interface SheetVariation {
  id: string;
  shortName: string;
  attributes: Record<string, string>;
  active: boolean;
  purchaseCost: string;
  rate: SheetRate | null;
}

interface SheetProduct {
  id: string;
  name: string;
  unit: string;
  productType: "simple" | "variable" | "measured" | "grouped";
  /** Measured: rates are per m, or per ft on a feet + inches product (0028). */
  lengthUnit: LengthUnit | null;
  category: { id: string; name: string } | null;
  attributes: AttributeDef[];
  variations: SheetVariation[];
  pricedCount: number;
  minRate: string | null;
  maxRate: string | null;
}

interface SheetResponse {
  products: SheetProduct[];
  total: number;
  page: number;
  pageSize: number;
}


/** "By supplier" view: one supplier's rate sheet, product by product. */
function BySupplierView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const canManage = useCan("vendor_pricing.manage");
  // Supplier rates are typed in the user's remembered purchase rate unit.
  const purchaseUnits = useEntryUnits("purchase");

  // 1. Load active suppliers
  const suppliersApi = useApi<{ parties: Party[] }>("/parties?role=supplier");
  const suppliers = useMemo(
    () => (suppliersApi.data?.parties ?? []).filter((s) => s.active),
    [suppliersApi.data]
  );

  // 2. Load categories for filtering
  const categoriesApi = useApi<CategoryList>("/categories");
  const categories = categoriesApi.data?.categories ?? [];

  // Selected supplier
  const paramSupplierId = searchParams.get("supplierId");
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(paramSupplierId);

  useEffect(() => {
    if (paramSupplierId) {
      setSelectedSupplierId(paramSupplierId);
    } else if (suppliers.length > 0 && !selectedSupplierId) {
      const firstId = suppliers[0]?.id ?? null;
      setSelectedSupplierId(firstId);
      if (firstId) {
        router.replace(`/supplier-prices?supplierId=${firstId}`);
      }
    }
  }, [paramSupplierId, suppliers, selectedSupplierId, router]);

  // Edits state: keyed by variationId -> new price string
  const [newPrices, setNewPrices] = useState<Record<string, string>>({});
  // Status toggle state: keyed by variationId -> boolean
  const [statusOverrides, setStatusOverrides] = useState<Record<string, boolean>>({});

  const editedCount = useMemo(() => {
    return Object.values(newPrices).filter((v) => v.trim() !== "").length;
  }, [newPrices]);

  function switchSupplier(id: string) {
    if (id === selectedSupplierId) return;
    if (editedCount > 0) {
      const ok = window.confirm("You have unsaved price changes. Switch supplier and discard them?");
      if (!ok) return;
    }
    setSelectedSupplierId(id);
    router.replace(`/supplier-prices?supplierId=${id}`);
    setNewPrices({});
    setStatusOverrides({});
    setMsg(null);
    setPage(1);
  }

  // Supplier filter query for the sidebar
  const [supplierFilter, setSupplierFilter] = useState("");
  const [railOpen, setRailOpen] = useState(false);
  const filteredSuppliers = useMemo(() => {
    const q = supplierFilter.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.city && s.city.toLowerCase().includes(q)) ||
        (s.phone && s.phone.toLowerCase().includes(q))
    );
  }, [suppliers, supplierFilter]);

  // 3. Filters & Pagination
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [scope, setScope] = useState<"priced" | "all">("priced");
  const [page, setPage] = useState(1);
  const pageSize = 50;


  // Expand / Collapse state for variable product rows
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // 4. Load sheet data
  const sheetUrl = selectedSupplierId
    ? `/vendor-prices/sheet?supplierId=${selectedSupplierId}&page=${page}&pageSize=${pageSize}&scope=${scope}${
        search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ""
      }${selectedCategory ? `&categoryId=${encodeURIComponent(selectedCategory)}` : ""}`
    : null;

  const sheetApi = useApi<SheetResponse>(sheetUrl);
  const products = sheetApi.data?.products ?? [];
  const totalProducts = sheetApi.data?.total ?? 0;
  const totalPages = Math.ceil(totalProducts / pageSize);

  // Actions & Save states
  const [savingRows, setSavingRows] = useState<Record<string, boolean>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  // History modal
  const [historyVar, setHistoryVar] = useState<{ id: string; label: string; lengthUnit: LengthUnit | null } | null>(null);
  const [groupedModalProductId, setGroupedModalProductId] = useState<string | null>(null);

  // Helpers
  const activeSupplier = suppliers.find((s) => s.id === selectedSupplierId);

  // Copy "Same" price into input
  function copySame(v: SheetVariation) {
    const target = v.rate?.rate ?? (Number(v.purchaseCost) > 0 ? v.purchaseCost : null);
    if (!target) return;
    const rounded = String(Math.round(Number(target)));
    setNewPrices((prev) => ({ ...prev, [v.id]: rounded }));
  }

  // Toggle single variation status
  async function toggleStatus(v: SheetVariation) {
    if (!selectedSupplierId) return;
    const currentActive = statusOverrides[v.id] ?? v.rate?.active ?? true;
    const newActive = !currentActive;

    setStatusOverrides((prev) => ({ ...prev, [v.id]: newActive }));

    // If rate already exists on server and no pending rate typed, update immediately
    if (v.rate && (!newPrices[v.id] || newPrices[v.id].trim() === "")) {
      try {
        await api("/vendor-prices", {
          method: "PUT",
          body: {
            supplierId: selectedSupplierId,
            variationId: v.id,
            rate: String(Math.round(Number(v.rate.rate))),
            active: newActive,
          },
        });
        await sheetApi.reload();
      } catch (err) {
        setMsg({ kind: "error", text: errorText(err) });
      }
    }
  }

  // Save single row
  async function saveSingleRow(p: SheetProduct, v: SheetVariation) {
    if (!selectedSupplierId) return;
    const val = newPrices[v.id]?.trim();
    if (!val || !/^\d{1,10}$/.test(val) || Number(val) <= 0) {
      setMsg({ kind: "error", text: "Enter a rate above 0" });
      return;
    }
    const targetActive = statusOverrides[v.id] ?? v.rate?.active ?? true;

    setSavingRows((prev) => ({ ...prev, [v.id]: true }));
    setMsg(null);
    try {
      await api("/vendor-prices", {
        method: "PUT",
        body: {
          supplierId: selectedSupplierId,
          variationId: v.id,
          rate: val,
          active: targetActive,
        },
      });
      setNewPrices((prev) => {
        const next = { ...prev };
        delete next[v.id];
        return next;
      });
      setMsg({
        kind: "success",
        text: `Saved rate ₹${val}${!targetActive ? " (still paused)" : ""} for ${p.name} · ${v.shortName}`,
      });
      await sheetApi.reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    } finally {
      setSavingRows((prev) => ({ ...prev, [v.id]: false }));
    }
  }

  // Save All Records in batch
  async function saveAllRecords() {
    if (!selectedSupplierId) return;
    const records: Array<{ variationId: string; supplierId: string; rate: string; active: boolean }> = [];

    for (const [varId, val] of Object.entries(newPrices)) {
      if (val.trim() !== "" && /^\d{1,10}$/.test(val.trim()) && Number(val.trim()) > 0) {
        // Find variation to get active state
        let active = statusOverrides[varId];
        if (active === undefined) {
          for (const p of products) {
            const match = p.variations.find((x) => x.id === varId);
            if (match) {
              active = match.rate?.active ?? true;
              break;
            }
          }
        }
        records.push({
          supplierId: selectedSupplierId,
          variationId: varId,
          rate: val.trim(),
          active: active ?? true,
        });
      }
    }

    if (records.length === 0) {
      setMsg({ kind: "error", text: "No valid rates entered to save (rates must be above 0)." });
      return;
    }

    setSavingAll(true);
    setMsg(null);
    try {
      const res = await api<{ count: number; unchanged: number }>("/vendor-prices/batch", {
        method: "PUT",
        body: { records },
      });
      setNewPrices({});
      setMsg({
        kind: "success",
        text: `Successfully saved ${res.count} price(s)${res.unchanged > 0 ? ` (${res.unchanged} unchanged)` : ""}!`,
      });
      await sheetApi.reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    } finally {
      setSavingAll(false);
    }
  }

  function openHistory(p: SheetProduct, v: SheetVariation) {
    setHistoryVar({ id: v.id, label: `${p.name} · ${v.shortName}`, lengthUnit: p.lengthUnit });
  }

  // Expand all / Collapse all
  function toggleExpandAll(open: boolean) {
    const next: Record<string, boolean> = {};
    for (const p of products) {
      if (p.productType === "variable" || p.variations.length > 1) {
        next[p.id] = open;
      }
    }
    setExpanded(next);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-5 xl:grid-cols-[20rem_minmax(0,1fr)]">
        {/* Left rail: supplier directory (a slide-in drawer below lg). */}
        <PriceRail
          title="Suppliers"
          count={`${suppliers.length} active`}
          open={railOpen}
          onOpenChange={setRailOpen}
          current={
            activeSupplier ? (
              <span className="flex items-center gap-2.5">
                <Avatar name={activeSupplier.name} seed={activeSupplier.id} size="sm" />
                <span className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Supplier</span>
                  <span className="block truncate text-sm font-semibold text-slate-900">{activeSupplier.name}</span>
                </span>
              </span>
            ) : (
              <span className="text-sm font-semibold text-slate-600">Pick a supplier</span>
            )
          }
          search={<SearchInput value={supplierFilter} onChange={setSupplierFilter} placeholder="Filter suppliers…" />}
        >
          {filteredSuppliers.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">No suppliers match &ldquo;{supplierFilter}&rdquo;</div>
          ) : (
            filteredSuppliers.map((s) => (
              <RailItem
                key={s.id}
                selected={selectedSupplierId === s.id}
                onClick={() => {
                  switchSupplier(s.id);
                  setRailOpen(false);
                }}
                thumb={<Avatar name={s.name} seed={s.id} size="sm" />}
                title={s.name}
                subtitle={[s.city, s.phone].filter(Boolean).join(" · ") || undefined}
              />
            ))
          )}
        </PriceRail>

        {/* Right Main Content Area */}
        <div className="min-w-0 space-y-4">
          {/* Active supplier header (desktop; phones show it on the rail bar). */}
          {activeSupplier && (
            <div className="card hidden flex-wrap items-center justify-between gap-3 p-3.5 lg:flex">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={activeSupplier.name} seed={activeSupplier.id} />
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Rate sheet</div>
                  <div className="truncate text-base font-bold text-slate-900">{activeSupplier.name}</div>
                  <div className="flex flex-wrap gap-x-3 text-xs text-slate-500">
                    {activeSupplier.city && <span>{activeSupplier.city}</span>}
                    {activeSupplier.phone && <span>{activeSupplier.phone}</span>}
                  </div>
                </div>
              </div>
              <span className="text-xs text-slate-400">Rates pre-fill purchase orders automatically</span>
            </div>
          )}

          {/* Main Content Area */}
          {selectedSupplierId ? (
            <div className="card overflow-hidden">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-64">
                <SearchInput
                  value={search}
                  onChange={(val) => {
                    setSearch(val);
                    setPage(1);
                  }}
                  placeholder="Filter products or variations…"
                />
              </div>

              {/* Category dropdown */}
              <select
                className="input w-44 py-1.5 text-xs"
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              {/* Segmented: Priced only vs Entire catalogue */}
              <Segmented
                label="Scope"
                value={scope}
                onChange={(v) => {
                  setScope(v as "priced" | "all");
                  setPage(1);
                }}
                options={[
                  { value: "priced", label: "Priced only" },
                  { value: "all", label: "Entire catalogue" },
                ]}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => toggleExpandAll(true)}
                className="btn-secondary py-1 text-xs"
                title="Expand all variable products"
              >
                Expand all
              </button>
              <button
                type="button"
                onClick={() => toggleExpandAll(false)}
                className="btn-secondary py-1 text-xs"
                title="Collapse all variable products"
              >
                Collapse all
              </button>

              {canManage && scope !== "all" && (
                <button
                  type="button"
                  className="btn-secondary py-1 text-xs"
                  onClick={() => {
                    setScope("all");
                    setPage(1);
                  }}
                >
                  <PlusIcon className="h-3.5 w-3.5" /> Add product to supplier
                </button>
              )}
            </div>
          </div>

          <Alert message={msg?.text} kind={msg?.kind} />

          {/* Table */}
          {sheetApi.loading ? (
            <TableSkeleton rows={8} />
          ) : products.length === 0 ? (
            <div className="py-12 text-center">
              <EmptyState
                title={
                  search || selectedCategory
                    ? "No products match your filter"
                    : `No products priced for ${activeSupplier?.name ?? "this supplier"} yet`
                }
                action={
                  scope === "priced" && (
                    <button
                      className="btn-primary mt-3 text-xs"
                      onClick={() => {
                        setScope("all");
                        setPage(1);
                      }}
                    >
                      Browse Entire Catalogue
                    </button>
                  )
                }
              >
                <p className="mt-1 text-xs text-slate-500">
                  Switch to &apos;Entire catalogue&apos; to view all products and enter rates for this supplier.
                </p>
              </EmptyState>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-stack table-sticky-0">
                <thead>
                  <tr>
                    <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-10 text-center" />
                    <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Product</th>
                    <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-36">Category</th>
                    <th data-label="Last Price" className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-44 text-right">Last Price</th>
                    <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-64 text-right">New Price (₹)</th>
                    <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-28 text-center">Status</th>
                    <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-36 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => {
                    const isVariable = p.productType === "variable" || p.variations.length > 1;
                    const isExpanded = expanded[p.id] ?? false;

                    if (!isVariable) {
                      // Simple or single-variation product: 1 single row
                      const v = p.variations[0];
                      if (!v) return null;
                      const entered = newPrices[v.id] ?? "";
                      const isSaving = savingRows[v.id] ?? false;
                      const active = statusOverrides[v.id] ?? v.rate?.active ?? true;

                      return (
                        <tr
                          key={p.id}
                          className={v.active ? "hover:bg-slate-50/70" : "opacity-60 bg-slate-50/40"}
                        >
                          <td className="stack-hide text-center text-slate-300">•</td>
                          <td>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-slate-900">{p.name}</span>
                              {p.productType === "grouped" && (
                                <span className="rounded bg-sky-100 text-sky-800 text-[10px] font-bold px-1.5 py-0.2">
                                  Grouped Set
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-x-2">
                              <span><span className="font-mono">{v.shortName}</span> · {p.productType === "grouped" ? "₹ per set" : p.lengthUnit ? `₹ / ${rateLabel(p.lengthUnit)}` : p.unit}</span>
                              {p.productType === "grouped" && (
                                <button
                                  type="button"
                                  onClick={() => setGroupedModalProductId(p.id)}
                                  className="text-brand-600 hover:text-brand-700 font-medium hover:underline cursor-pointer"
                                >
                                  Presets & parts pricing →
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="text-slate-600 text-xs">{p.category?.name ?? "—"}</td>

                          <td className="text-right">
                            {v.rate ? (
                              <div>
                                <div className="font-semibold text-slate-900">{fmtRate(p.lengthUnit, v.rate.rate)}</div>
                                {v.rate.effectiveAt && (
                                  <div className="text-[10px] text-slate-400">
                                    {dateTime(v.rate.effectiveAt)}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400 italic">
                                {Number(v.purchaseCost) > 0 ? `Cost ${fmtRate(p.lengthUnit, v.purchaseCost)}` : "Not set"}
                              </span>
                            )}
                          </td>

                          <td className="text-right">
                            <div className="inline-flex items-center gap-1.5 justify-end">
                              {!active && v.rate && (
                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                  Paused
                                </span>
                              )}
                              {p.lengthUnit ? (
                                <RateField compact unit={p.lengthUnit} label={`Rate for ${v.shortName}`} placeholder="Enter ₹" value={entered} disabled={!canManage} onChange={(val) => setNewPrices((prev) => ({ ...prev, [v.id]: val }))} preferredUnit={purchaseUnits.rateUnit(p.lengthUnit)} onUnitChange={(u) => p.lengthUnit && purchaseUnits.setRateUnit(p.lengthUnit, u)} />
                              ) : (
                              <input
                                type="text"
                                inputMode="numeric"
                                placeholder="Enter ₹"
                                value={entered}
                                disabled={!canManage}
                                onChange={(e) => {
                                  const val = e.target.value.replace(/[^\d]/g, "");
                                  setNewPrices((prev) => ({ ...prev, [v.id]: val }));
                                }}
                                className={`input w-28 text-right font-medium py-1 text-sm ${
                                  entered ? "border-brand-500 ring-1 ring-brand-500 bg-brand-50/20" : ""
                                }`}
                              />
                              )}
                              <button
                                type="button"
                                onClick={() => copySame(v)}
                                disabled={!canManage}
                                className="rounded border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 active:scale-95"
                                title="Copy last recorded rate or default cost"
                              >
                                Same
                              </button>
                            </div>
                          </td>

                          <td className="text-center">
                            {v.rate || entered ? (
                              canManage ? (
                                <button
                                  type="button"
                                  onClick={() => toggleStatus(v)}
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                                    active
                                      ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                                      : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                                  }`}
                                >
                                  {active ? "Active" : "Paused"}
                                </button>
                              ) : (
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                    active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                                  }`}
                                >
                                  {active ? "Active" : "Paused"}
                                </span>
                              )
                            ) : (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                                Not set
                              </span>
                            )}
                          </td>

                          <td className="text-center">
                            <div className="inline-flex items-center gap-1">
                              {canManage && (
                                <button
                                  type="button"
                                  disabled={!entered || isSaving}
                                  onClick={() => saveSingleRow(p, v)}
                                  className="rounded bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                                >
                                  {isSaving ? "…" : "Save"}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openHistory(p, v)}
                                className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                              >
                                History
                              </button>
                              {p.productType === "grouped" && (
                                <button
                                  type="button"
                                  onClick={() => setGroupedModalProductId(p.id)}
                                  className="rounded border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-100 cursor-pointer"
                                  title="View standard sets & components pricing"
                                >
                                  Presets
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    // Variable product: parent row + nested variation table
                    const rateRange =
                      p.minRate && p.maxRate
                        ? p.minRate === p.maxRate
                          ? fmtRate(p.lengthUnit, p.minRate)
                          : fmtRate(p.lengthUnit, p.minRate, p.maxRate)
                        : "No rates set";

                    const attrColumns = variationAttributeColumns(p, p.variations);

                    return (
                      <Fragment key={p.id}>
                        {/* Parent Row */}
                        <tr
                          className="cursor-pointer bg-white hover:bg-slate-50/80 transition-colors"
                          onClick={() => setExpanded((o) => ({ ...o, [p.id]: !isExpanded }))}
                        >
                          <td className="stack-hide text-center">
                            <button
                              type="button"
                              className="text-brand-600 font-bold text-base"
                              aria-expanded={isExpanded}
                              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${p.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpanded((o) => ({ ...o, [p.id]: !isExpanded }));
                              }}
                            >
                              {isExpanded ? "⊖" : "⊕"}
                            </button>
                          </td>
                          <td>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-slate-900">{p.name}</span>
                              <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                                {p.variations.length} variations
                              </span>
                              <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                {p.pricedCount}/{p.variations.length} priced
                              </span>
                            </div>
                          </td>
                          <td className="text-slate-600 text-xs">{p.category?.name ?? "—"}</td>
                          <td className="text-right text-xs font-semibold text-slate-800">
                            {rateRange}
                          </td>

                          <td className="stack-hide" />
                          <td colSpan={2} className="text-center text-xs text-slate-400">
                            {isExpanded ? "Click to collapse" : "Click to view variations"}
                          </td>
                        </tr>

                        {/* Child Rows Table (when expanded) */}
                        {isExpanded && (
                          <tr>
                            <td colSpan={7} className="bg-slate-50/70 p-4 border-y border-slate-200">
                              <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
                                <table className="table table-stack">
                                  <thead>
                                    <tr>
                                      {attrColumns.map((col) => (
                                        <th key={col.name} className="bg-slate-100 text-slate-700">
                                          {col.name}
                                          {col.unit ? ` (${col.unit})` : ""}
                                        </th>
                                      ))}
                                      <th className="bg-slate-100 text-slate-700">Short Code</th>
                                      <th data-label="Last Price" className="bg-slate-100 text-slate-700 text-right">Last Price {p.lengthUnit && <LengthViewToggle className="ml-1" />}</th>
                                      <th className="bg-slate-100 text-slate-700 text-right w-64">New Price (₹)</th>
                                      <th className="bg-slate-100 text-slate-700 text-center w-28">Status</th>
                                      <th className="bg-slate-100 text-slate-700 text-center w-36">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {p.variations.map((v) => {
                                      const entered = newPrices[v.id] ?? "";
                                      const isSaving = savingRows[v.id] ?? false;
                                      const active = statusOverrides[v.id] ?? v.rate?.active ?? true;

                                      return (
                                        <tr
                                          key={v.id}
                                          className={
                                            !v.active
                                              ? "opacity-50 bg-slate-50/60"
                                              : "hover:bg-slate-50/50"
                                          }
                                        >
                                          {attrColumns.map((col) => (
                                            <td key={col.name} className="font-medium text-slate-800">
                                              {v.attributes[col.name] ?? "—"}
                                            </td>
                                          ))}

                                          <td>
                                            <span className="font-mono text-slate-600">{v.shortName}</span>
                                            {!v.active && (
                                              <span className="ml-1.5 rounded bg-slate-200 px-1 py-0.5 text-[9px] font-semibold text-slate-600">
                                                Variation inactive
                                              </span>
                                            )}
                                          </td>

                                          <td className="text-right">
                                            {v.rate ? (
                                              <div>
                                                <div className="font-semibold text-slate-900">
                                                  {fmtRate(p.lengthUnit, v.rate.rate)}
                                                </div>
                                                {v.rate.effectiveAt && (
                                                  <div className="text-[10px] text-slate-400">
                                                    {dateTime(v.rate.effectiveAt)}
                                                  </div>
                                                )}
                                              </div>
                                            ) : (
                                              <span className="text-xs text-slate-400 italic">
                                                {Number(v.purchaseCost) > 0
                                                  ? `Cost ${fmtRate(p.lengthUnit, v.purchaseCost)}`
                                                  : "Not set"}
                                              </span>
                                            )}
                                          </td>

                                          <td className="text-right">
                                            <div className="inline-flex items-center gap-1.5 justify-end">
                                              {!active && v.rate && (
                                                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                                                  Paused
                                                </span>
                                              )}
                                              {p.lengthUnit ? (
                                                <RateField compact unit={p.lengthUnit} label={`Rate for ${v.shortName}`} placeholder="Enter ₹" value={entered} disabled={!canManage} onChange={(val) => setNewPrices((prev) => ({ ...prev, [v.id]: val }))} preferredUnit={purchaseUnits.rateUnit(p.lengthUnit)} onUnitChange={(u) => p.lengthUnit && purchaseUnits.setRateUnit(p.lengthUnit, u)} />
                                              ) : (
                                              <input
                                                type="text"
                                                inputMode="numeric"
                                                placeholder="Enter ₹"
                                                value={entered}
                                                disabled={!canManage}
                                                onChange={(e) => {
                                                  const val = e.target.value.replace(/[^\d]/g, "");
                                                  setNewPrices((prev) => ({ ...prev, [v.id]: val }));
                                                }}
                                                className={`input w-28 text-right font-medium py-1 text-sm ${
                                                  entered ? "border-brand-500 ring-1 ring-brand-500 bg-brand-50/20" : ""
                                                }`}
                                              />
                                              )}
                                              <button
                                                type="button"
                                                onClick={() => copySame(v)}
                                                disabled={!canManage}
                                                className="rounded border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 active:scale-95"
                                                title="Copy last recorded rate or default cost"
                                              >
                                                Same
                                              </button>
                                            </div>
                                          </td>

                                          <td className="text-center">
                                            {v.rate || entered ? (
                                              canManage ? (
                                                <button
                                                  type="button"
                                                  onClick={() => toggleStatus(v)}
                                                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                                                    active
                                                      ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                                                      : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                                                  }`}
                                                >
                                                  {active ? "Active" : "Paused"}
                                                </button>
                                              ) : (
                                                <span
                                                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                                    active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                                                  }`}
                                                >
                                                  {active ? "Active" : "Paused"}
                                                </span>
                                              )
                                            ) : (
                                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                                                Not set
                                              </span>
                                            )}
                                          </td>

                                          <td className="text-center">
                                            <div className="inline-flex items-center gap-1">
                                              {canManage && (
                                                <button
                                                  type="button"
                                                  disabled={!entered || isSaving}
                                                  onClick={() => saveSingleRow(p, v)}
                                                  className="rounded bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
                                                >
                                                  {isSaving ? "…" : "Save"}
                                                </button>
                                              )}
                                              <button
                                                type="button"
                                                onClick={() => openHistory(p, v)}
                                                className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
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
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-3">
              <span className="text-xs text-slate-500">
                Showing <b>{(page - 1) * pageSize + 1}</b> – <b>{Math.min(page * pageSize, totalProducts)}</b> of <b>{totalProducts}</b> products
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-xs text-slate-600 px-2">
                  Page <b>{page}</b> of <b>{totalPages}</b>
                </span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <EmptyState title="No supplier selected">
            Select a supplier from the sidebar to view and manage rate cards.
          </EmptyState>
        </div>
      )}
        </div>
      </div>

      {/* Floating Save All Bar */}
      {canManage && editedCount > 0 && (
        <div className="fixed bottom-20 inset-x-0 mx-auto max-w-lg z-30 px-3 lg:bottom-4 lg:px-0">
          <div className="flex items-center justify-between rounded-xl bg-slate-900 px-5 py-3 text-white shadow-xl">
            <div>
              <div className="text-sm font-semibold">{editedCount} unsaved price change{editedCount === 1 ? "" : "s"}</div>
              <div className="text-xs text-slate-400">Save all changes in one batch</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setNewPrices({})}
                className="rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Discard
              </button>
              <button
                type="button"
                disabled={savingAll}
                onClick={saveAllRecords}
                className="btn-primary py-1.5 px-4 text-xs"
              >
                {savingAll ? "Saving…" : "Save All Records"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyVar && selectedSupplierId && (
        <PriceHistoryModal
          title={historyVar.label}
          variationId={historyVar.id}
          supplierId={selectedSupplierId}
          lengthUnit={historyVar.lengthUnit}
          onClose={() => setHistoryVar(null)}
        />
      )}

      {/* Grouped Set Pricing Modal */}
      {groupedModalProductId && (
        <VendorPricingModal
          productId={groupedModalProductId}
          onClose={() => {
            setGroupedModalProductId(null);
            sheetApi.reload();
          }}
        />
      )}
    </div>
  );
}

type PriceView = "supplier" | "product";

/** "By product" view: product rail on the left, the picked product's (or every product's) rates on the right. */
function ByProductView({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const paramProductId = searchParams.get("productId");

  const [product, setProduct] = useState<RailProduct>(null);
  // Unsaved rates on the open product's sheet: switching product asks first, as switching supplier does.
  const [dirty, setDirty] = useState(false);

  // If paramProductId is set in URL and product is not yet matching, fetch product details
  const productApi = useApi<{ product: RailProduct }>(
    paramProductId && paramProductId !== "compare" && paramProductId !== product?.id
      ? `/products/${paramProductId}`
      : null
  );

  useEffect(() => {
    if (paramProductId === "compare") {
      setProduct(null);
    } else if (productApi.data?.product) {
      setProduct(productApi.data.product);
    }
  }, [paramProductId, productApi.data]);

  // When products are loaded in the rail, auto-select the first product if none selected
  function handleProductsLoaded(products: RailProduct[]) {
    if (!paramProductId && !product && products.length > 0 && products[0]) {
      const first = products[0];
      setProduct(first);
      router.replace(`/supplier-prices?view=product&productId=${first.id}`);
    }
  }

  function pick(p: RailProduct) {
    if (p?.id === product?.id) return;
    if (dirty && !window.confirm("You have unsaved price changes. Switch product and discard them?")) return;
    setDirty(false);
    setProduct(p);
    router.replace(
      p ? `/supplier-prices?view=product&productId=${p.id}` : `/supplier-prices?view=product&productId=compare`
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-5 xl:grid-cols-[20rem_minmax(0,1fr)]">
      <ProductRail selected={product} onSelect={pick} onProductsLoaded={handleProductsLoaded} />
      <div className="min-w-0">
        <ProductPriceView initialQuery={initialQuery} product={product} onDirtyChange={setDirty} />
      </div>
    </div>
  );
}

/**
 * Vendor Pricing & Price History: one page, two views. By supplier edits one
 * supplier's rate sheet; By product lines up every supplier's rate per variation.
 */
function SupplierPricesContent() {
  useLengthView();
  const router = useRouter();
  const searchParams = useSearchParams();
  const view: PriceView = searchParams.get("view") === "product" ? "product" : "supplier";

  function switchView(v: PriceView) {
    if (v === view) return;
    router.replace(v === "product" ? "/supplier-prices?view=product" : "/supplier-prices");
  }

  return (
    <div className="space-y-4 pb-24">
      <PageHeader
        back={{ href: "/", label: "Home" }}
        title="Vendor Pricing &amp; Price History"
        subtitle={
          view === "product"
            ? "Manage product rate cards across all suppliers inline. Compare quotes, track price history, and set active rates."
            : "Manage supplier rate cards inline. Rates prefill purchase orders, and purchases automatically update these rate cards."
        }
        actions={
          <Segmented
            label="View"
            value={view}
            onChange={switchView}
            options={[
              { value: "supplier", label: "By supplier", title: "One supplier's rate sheet" },
              { value: "product", label: "By product", title: "Each product's rates from every supplier" },
            ]}
          />
        }
      />
      {view === "product" ? <ByProductView initialQuery={searchParams.get("q") ?? ""} /> : <BySupplierView />}
    </div>
  );
}

export default function SupplierPricesPage() {
  return (
    <Restricted permission="vendor_pricing.view">
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <SupplierPricesContent />
      </Suspense>
    </Restricted>
  );
}
