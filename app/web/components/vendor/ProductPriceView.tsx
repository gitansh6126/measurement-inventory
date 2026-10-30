"use client";

import { useMemo, useState } from "react";
import { useCan } from "@/components/MeContext";
import type { Party } from "@/components/PartyModal";
import { Alert, EmptyState, SearchInput, Segmented, TableSkeleton } from "@/components/ui";
import { RateField } from "@/components/measure/RateField";
import { VendorPricingModal } from "@/components/vendor/VendorPricingModal";
import { ProductRateSheet } from "@/components/vendor/ProductRateSheet";
import type { RailProduct } from "@/components/vendor/ProductRail";
import { api } from "@/lib/api";
import { dateTime, variationLabel } from "@/lib/format";
import { fmtRate, type LengthUnit } from "@/lib/measure";
import { useLengthView } from "@/lib/lengthView";
import type { AttributeDef, CategoryList } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { useEntryUnits } from "@/lib/useEntryUnits";

interface CompareRate {
  supplierId: string;
  supplierName: string;
  rate: string;
  active: boolean;
  effectiveAt: string;
}

interface CompareRow {
  variationId: string;
  productId: string;
  productName: string;
  unit: string;
  /** Measured: rates are per m, or per ft on a feet + inches product (0028). */
  lengthUnit: LengthUnit | null;
  category: { id: string; name: string } | null;
  attributeDefinitions: AttributeDef[];
  shortName: string;
  attributes: Record<string, string>;
  purchaseCost: string;
  rates: CompareRate[];
  supplierCount: number;
  best: { supplierId: string; supplierName: string; rate: string } | null;
  maxRate: string | null;
  spreadPct: number | null;
}

interface CompareResponse {
  suppliers: Array<{ id: string; name: string }>;
  rows: CompareRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Pending edits are keyed by variation and supplier. */
const cellKey = (variationId: string, supplierId: string) => `${variationId}:${supplierId}`;

/**
 * Vendor Pricing "By product" view. A product picked in the rail opens its rate sheet
 * (ProductRateSheet, laid out like the By supplier sheet). With no product picked, every
 * variation's rate from every supplier sits side by side, cheapest active rate marked; in
 * edit mode every cell takes a new rate, and one batch saves them all.
 */
export function ProductPriceView({
  initialQuery = "",
  product = null,
  onDirtyChange,
}: {
  initialQuery?: string;
  product?: RailProduct;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  if (product) return <ProductRateSheet key={product.id} product={product} onDirtyChange={onDirtyChange} />;
  return <CompareGrid initialQuery={initialQuery} />;
}

/** Every product's variations against every supplier (no product picked). */
function CompareGrid({ initialQuery }: { initialQuery: string }) {
  useLengthView();
  const canManage = useCan("vendor_pricing.manage");
  const purchaseUnits = useEntryUnits("purchase");

  const suppliersApi = useApi<{ parties: Party[] }>("/parties?role=supplier");
  const allSuppliers = useMemo(() => (suppliersApi.data?.parties ?? []).filter((s) => s.active), [suppliersApi.data]);
  const categoriesApi = useApi<CategoryList>("/categories");
  const categories = categoriesApi.data?.categories ?? [];

  const [search, setSearch] = useState(initialQuery);
  const [category, setCategory] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [minSuppliers, setMinSuppliers] = useState<"0" | "1" | "2">("1");
  const [includePaused, setIncludePaused] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [detail, setDetail] = useState<{ productId: string; variationId: string } | null>(null);

  const [editing, setEditing] = useState(false);
  const [newPrices, setNewPrices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const editedCount = Object.values(newPrices).filter((v) => v.trim() !== "").length;

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), minSuppliers });
  if (search.trim()) params.set("q", search.trim());
  if (category) params.set("categoryId", category);
  if (picked.length) params.set("supplierIds", picked.join(","));
  // Editing shows paused rates too, so a paused rate is never typed over blind.
  if (includePaused || editing) params.set("includePaused", "1");
  const compareApi = useApi<CompareResponse>(`/vendor-prices/compare?${params.toString()}`);
  const rows = compareApi.data?.rows ?? [];
  const columns = compareApi.data?.suppliers ?? [];
  const total = compareApi.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function togglePick(id: string) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setPage(1);
  }

  function setPrice(variationId: string, supplierId: string, val: string) {
    setNewPrices((prev) => ({ ...prev, [cellKey(variationId, supplierId)]: val }));
  }

  function stopEditing() {
    if (editedCount > 0 && !window.confirm("Discard your unsaved price changes?")) return;
    setNewPrices({});
    setEditing(false);
    setMsg(null);
  }

  async function saveAll() {
    // A rate's paused / active state is kept; new rates start active.
    const known = new Map<string, boolean>();
    for (const r of rows) for (const x of r.rates) known.set(cellKey(r.variationId, x.supplierId), x.active);
    const records = Object.entries(newPrices)
      .map(([key, val]) => ({ key, val: val.trim() }))
      .filter(({ val }) => /^\d{1,10}$/.test(val) && Number(val) > 0)
      .map(({ key, val }) => {
        const [variationId, supplierId] = key.split(":") as [string, string];
        return { variationId, supplierId, rate: val, active: known.get(key) ?? true };
      });
    if (records.length === 0) {
      setMsg({ kind: "error", text: "No valid rates entered to save (rates must be above 0)." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const res = await api<{ count: number; unchanged: number }>("/vendor-prices/batch", { method: "PUT", body: { records } });
      setNewPrices({});
      setMsg({ kind: "success", text: `Saved ${res.count} price(s)${res.unchanged > 0 ? ` (${res.unchanged} unchanged)` : ""}.` });
      await compareApi.reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    } finally {
      setSaving(false);
    }
  }

  const label = (r: CompareRow) => variationLabel(r, r.attributeDefinitions) || r.shortName;

  function rateInput(r: CompareRow, supplierId: string, supplierName: string) {
    const entered = newPrices[cellKey(r.variationId, supplierId)] ?? "";
    if (r.lengthUnit) {
      const lu = r.lengthUnit;
      return (
        <RateField
          compact
          unit={lu}
          label={`${supplierName} rate for ${r.productName} ${r.shortName}`}
          placeholder="₹"
          value={entered}
          onChange={(val) => setPrice(r.variationId, supplierId, val)}
          preferredUnit={purchaseUnits.rateUnit(lu)}
          onUnitChange={(u) => purchaseUnits.setRateUnit(lu, u)}
        />
      );
    }
    return (
      <input autoComplete="off"
        type="text"
        inputMode="numeric"
        placeholder="₹"
        aria-label={`${supplierName} rate for ${r.productName} ${r.shortName}`}
        value={entered}
        onChange={(e) => setPrice(r.variationId, supplierId, e.target.value.replace(/[^\d]/g, ""))}
        className={`input w-24 py-1 text-right text-sm font-medium ${entered ? "border-brand-500 bg-brand-50/20 ring-1 ring-brand-500" : ""}`}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-full sm:w-64">
            <SearchInput
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Product, variation or SKU…"
            />
          </div>
          <select
            className="input w-full py-1.5 text-xs sm:w-44"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
            aria-label="Category"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Segmented
            label="Which variations"
            value={minSuppliers}
            onChange={(v) => {
              setMinSuppliers(v);
              setPage(1);
            }}
            options={[
              { value: "2", label: "2+ suppliers", title: "Only variations quoted by two or more suppliers" },
              { value: "1", label: "Any priced", title: "Every variation with at least one supplier rate" },
              { value: "0", label: "All products", title: "The whole catalogue, to enter first rates" },
            ]}
          />
          {!editing && (
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={includePaused}
                onChange={(e) => {
                  setIncludePaused(e.target.checked);
                  setPage(1);
                }}
              />
              Show paused rates
            </label>
          )}
          {canManage && (
            <button type="button" onClick={() => (editing ? stopEditing() : setEditing(true))} className={`${editing ? "btn-secondary" : "btn-primary"} ml-auto py-1.5 text-xs`}>
              {editing ? "Done editing" : "Edit rates"}
            </button>
          )}
        </div>

        {allSuppliers.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">Suppliers</span>
            <button
              type="button"
              onClick={() => {
                setPicked([]);
                setPage(1);
              }}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                picked.length === 0 ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              All
            </button>
            {allSuppliers.map((s) => {
              const on = picked.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => togglePick(s.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                    on ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
        {editing && (
          <p className="text-xs text-slate-500">
            Type a new rate in any cell, then <b>Save all</b>. To give a product a supplier it has no rate from yet, pick
            that supplier above{minSuppliers !== "0" && <> and choose <b>All products</b></>}, or pick the product in the list.
          </p>
        )}
      </div>

      <Alert message={msg?.text ?? (compareApi.error || undefined)} kind={msg?.kind ?? "error"} />

      <div className="card overflow-hidden">
        {compareApi.loading && !compareApi.data ? (
          <TableSkeleton rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState title={search || category || picked.length ? "Nothing matches these filters" : "No supplier prices to compare yet"}>
            {minSuppliers === "2"
              ? "Only variations quoted by two or more suppliers are shown. Switch to 'Any priced' to see the rest."
              : minSuppliers === "1"
                ? "Switch to 'All products' to enter first rates, or record a purchase."
                : "No products match."}
          </EmptyState>
        ) : columns.length === 0 && editing ? (
          <EmptyState title="Pick the suppliers to price">These products have no supplier rates yet. Pick one or more suppliers above to add their columns.</EmptyState>
        ) : (
          <>
            {/* Phone: one card per variation, suppliers cheapest first (every column while editing). */}
            <ul className="divide-y divide-slate-100 md:hidden">
              {rows.map((r) => {
                const byId = new Map(r.rates.map((x) => [x.supplierId, x]));
                const lines = editing ? columns.map((s) => ({ id: s.id, name: s.name, x: byId.get(s.id) })) : r.rates.map((x) => ({ id: x.supplierId, name: x.supplierName, x }));
                return (
                  <li key={r.variationId} className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" className="min-w-0 text-left" onClick={() => setDetail({ productId: r.productId, variationId: r.variationId })}>
                        <div className="truncate font-semibold text-slate-900">{r.productName}</div>
                        <div className="truncate text-xs text-slate-500">{label(r)}</div>
                      </button>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {lines.map(({ id, name, x }) => {
                        const isBest = r.supplierCount > 1 && !!x?.active && r.best?.supplierId === id;
                        return (
                          <li key={id} className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-sm ${isBest ? "bg-emerald-50" : ""}`}>
                            <span className="min-w-0 truncate text-slate-700">
                              {name}
                              {isBest && <span className="ml-1.5 text-[10px] font-bold uppercase text-emerald-700">Best</span>}
                              {x && !x.active && <span className="ml-1.5 text-[10px] text-slate-400">paused</span>}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <span className={`font-semibold ${!x ? "text-slate-300" : x.active ? "text-slate-900" : "text-slate-400 line-through"}`}>
                                {x ? fmtRate(r.lengthUnit, x.rate) : "—"}
                              </span>
                              {editing && rateInput(r, id, name)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>

            {/* Wider screens: supplier columns, product column stays put while scrolling sideways. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="sticky left-0 z-10 min-w-[14rem] bg-slate-50 px-3 py-2">Product / variation</th>
                    {columns.map((s) => (
                      <th key={s.id} className="whitespace-nowrap px-3 py-2 text-right">
                        {s.name}
                      </th>
                    ))}
                    <th className="whitespace-nowrap px-3 py-2 text-right">Best</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right">Purchase cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => {
                    const byId = new Map(r.rates.map((x) => [x.supplierId, x]));
                    return (
                      <tr
                        key={r.variationId}
                        className={`group hover:bg-slate-50 ${editing ? "" : "cursor-pointer"}`}
                        onClick={editing ? undefined : () => setDetail({ productId: r.productId, variationId: r.variationId })}
                        title={editing ? undefined : "Open price history"}
                      >
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 group-hover:bg-slate-50">
                          <div className="font-semibold text-slate-900">{r.productName}</div>
                          <div className="text-xs text-slate-500">
                            {label(r)}
                            {r.category && <span className="text-slate-400"> · {r.category.name}</span>}
                          </div>
                          {editing && (
                            <button
                              type="button"
                              onClick={() => setDetail({ productId: r.productId, variationId: r.variationId })}
                              className="mt-1 text-[11px] font-medium text-brand-600 hover:underline"
                            >
                              History
                            </button>
                          )}
                        </td>
                        {columns.map((s) => {
                          const x = byId.get(s.id);
                          const isBest = r.supplierCount > 1 && !!x?.active && r.best?.supplierId === s.id;
                          const tone = isBest ? "bg-emerald-50 font-semibold text-emerald-800" : !x ? "text-slate-300" : x.active ? "text-slate-800" : "text-slate-400 line-through";
                          return (
                            <td
                              key={s.id}
                              className={`whitespace-nowrap px-3 py-2 text-right ${editing ? (isBest ? "bg-emerald-50" : "") : tone}`}
                              title={x ? `${x.supplierName} · ${dateTime(x.effectiveAt)}${x.active ? "" : " · paused"}` : undefined}
                            >
                              {editing ? (
                                <div className="flex flex-col items-end gap-0.5">
                                  {rateInput(r, s.id, s.name)}
                                  <span className={`text-[10px] ${tone}`}>{x ? `now ${fmtRate(r.lengthUnit, x.rate)}${x.active ? "" : " · paused"}` : "not set"}</span>
                                </div>
                              ) : x ? (
                                fmtRate(r.lengthUnit, x.rate)
                              ) : (
                                "—"
                              )}
                            </td>
                          );
                        })}
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {r.best ? (
                            <>
                              <div className={`font-semibold ${r.supplierCount > 1 ? "text-emerald-700" : "text-slate-800"}`}>
                                {fmtRate(r.lengthUnit, r.best.rate)}
                              </div>
                              <div className="text-[11px] text-slate-500">{r.best.supplierName}</div>
                            </>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right text-slate-500">
                          {Number(r.purchaseCost) > 0 ? fmtRate(r.lengthUnit, r.purchaseCost) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
              <span>
                {total} variation{total === 1 ? "" : "s"}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <button type="button" className="btn-secondary py-1 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </button>
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <button type="button" className="btn-secondary py-1 text-xs" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Floating Save All Bar */}
      {canManage && editedCount > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-30 mx-auto max-w-lg px-3 lg:bottom-4 lg:px-0">
          <div className="flex items-center justify-between rounded-xl bg-slate-900 px-5 py-3 text-white shadow-xl">
            <div>
              <div className="text-sm font-semibold">
                {editedCount} unsaved price change{editedCount === 1 ? "" : "s"}
              </div>
              <div className="text-xs text-slate-400">Save all changes in one batch</div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setNewPrices({})} className="rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800">
                Discard
              </button>
              <button type="button" disabled={saving} onClick={saveAll} className="btn-primary px-4 py-1.5 text-xs">
                {saving ? "Saving…" : "Save all"}
              </button>
            </div>
          </div>
        </div>
      )}

      {detail && <VendorPricingModal productId={detail.productId} variationId={detail.variationId} onClose={() => setDetail(null)} />}
    </div>
  );
}
