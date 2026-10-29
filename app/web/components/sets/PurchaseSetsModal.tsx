"use client";

import { useEffect, useState } from "react";
import { useCart, type CartLine } from "@/components/CartContext";
import { SupplierRateList } from "@/components/vendor/SupplierRateList";
import { Alert, Modal } from "@/components/ui";
import { money } from "@/lib/format";
import { ratePerOf } from "@/lib/measure";
import type { Product } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { useSupplierRates } from "@/lib/useSupplierRates";
import { useWarehouses } from "@/lib/useWarehouses";
import { SetTypesTable, useSetsInStock } from "./SetTypes";
import { buildSets, emptyRow, rowsFromSets, setContentRows, setSummary, SetSheetTable, type SetBody, type SheetRow } from "./SetSheet";

// V3.1 purchase cart (docs\GROUPED-PRODUCTS-V3-PLAN.md §3): the set sheet for a grouped product.
// Confirm turns the rows into cart lines — one line per set rate ("Chain Hoist Set × 2 @ 6,200"),
// because a document line has one price (D11: one purchase rate per set, no part costs).
// V3.2 A3 (owner 2026-10-28): a supplier's rate for a set is kept per grouped product on its own
// variation, like any rate card, and updated when the purchase completes. The sheet shows every
// supplier's set rate (tap to fill) and, per row, what the chosen parts cost from this supplier.

export function PurchaseSetsModal({
  productId,
  initial,
  defaultRate = "",
  pickWarehouse = false,
  onClose,
  onConfirm,
}: {
  productId: string;
  /** Sets of the cart line(s) being edited, each with its rate. */
  initial?: SetBody[];
  /** Rate a new set row starts with (receiving on an order line: the line's rate). */
  defaultRate?: string;
  /** Per-set warehouse column: only when receiving an order. Picking products for the cart has
   *  none; the purchase's "Receive into" places them. */
  pickWarehouse?: boolean;
  onClose: () => void;
  onConfirm: (lines: CartLine[]) => void;
}) {
  const { data, error: loadError } = useApi<{ product: Product }>(`/products/${productId}`);
  const product = data?.product ?? null;
  const info = product?.grouped ?? null;
  const [rows, setRows] = useState<SheetRow[] | null>(null);
  const wh = useWarehouses();
  const [error, setError] = useState("");
  const [showStock, setShowStock] = useState(false);
  const inStock = useSetsInStock(productId);
  // Receiving an order line keeps the order's rate: no vendor pricing there.
  const showVendor = !pickWarehouse;
  const cart = useCart();
  const supplier = cart.party?.mode === "purchase" ? cart.party : null;
  const setVariationId = product?.variations[0]?.id ?? "";
  const partIds = info ? [info.main?.variationId ?? "", ...info.byproducts.flatMap((b) => b.variations.map((v) => v.id))] : [];
  const vendor = useSupplierRates(showVendor ? [setVariationId, ...partIds] : [], supplier?.id);
  const setRates = vendor.suggestions.get(setVariationId);
  const mySetRate = setRates?.supplierRate ? String(Math.round(Number(setRates.supplierRate))) : "";

  // A new sheet starts at this supplier's set rate (never over a rate already typed).
  useEffect(() => {
    if (!mySetRate || initial?.length || defaultRate) return;
    setRows((rs) => rs?.map((r) => (r.rate ? r : { ...r, rate: mySetRate })) ?? rs);
  }, [mySetRate, initial, defaultRate]);

  /** Supplier cost of a row's parts: this supplier's rate, else the cheapest; null while a part has none. */
  function partsCost(row: SheetRow): { total: number; missing: number } | null {
    if (!info) return null;
    const rateOf = (variationId: string) => {
      const s = vendor.suggestions.get(variationId);
      const r = s?.supplierRate ?? s?.cheapest?.rate;
      return r ? Number(r) : null;
    };
    let total = 0;
    let missing = 0;
    let picked = 0;
    if (info.main?.variationId) {
      const r = rateOf(info.main.variationId);
      if (r === null) missing++;
      else total += r;
    }
    for (const b of info.byproducts) {
      const p = row.parts[b.id];
      if (!p?.variationId) continue;
      picked++;
      const r = rateOf(p.variationId);
      if (r === null) {
        missing++;
        continue;
      }
      // Measured: the length is in base units, the rate per m / per ft (0028).
      total += b.productType === "measured" ? ((Number(p.length) || 0) / ratePerOf(b.lengthUnit)) * r : r;
    }
    return picked || info.main?.variationId ? { total, missing } : null;
  }

  /** Supplier cost of a standard preset's parts. */
  function presetPartsCost(t: { parts: { byproductId: string; variationId: string; length: number | null }[] }): { total: number; missing: number } | null {
    if (!info) return null;
    const rateOf = (variationId: string) => {
      const s = vendor.suggestions.get(variationId);
      const r = s?.supplierRate ?? s?.cheapest?.rate;
      return r ? Number(r) : null;
    };
    let total = 0;
    let missing = 0;
    if (info.main?.variationId) {
      const r = rateOf(info.main.variationId);
      if (r === null) missing++;
      else total += r;
    }
    for (const p of t.parts) {
      const b = info.byproducts.find((x) => x.id === p.byproductId);
      if (!b) continue;
      const r = rateOf(p.variationId);
      if (r === null) {
        missing++;
        continue;
      }
      total += b.productType === "measured" ? ((Number(p.length) || 0) / ratePerOf(b.lengthUnit)) * r : r;
    }
    return { total, missing };
  }

  useEffect(() => {
    if (info && !rows) setRows(initial?.length ? rowsFromSets(info, initial) : [emptyRow(info, 1, defaultRate)]);
  }, [info, rows, initial, defaultRate]);

  function confirm() {
    if (!product || !info || !rows) return;
    setError("");
    try {
      const sets = buildSets(info, rows, { rateRequired: true }).map(({ warehouseId, ...s }) => (pickWarehouse && warehouseId ? { ...s, warehouseId } : s));
      const variation = product.variations[0]!;
      const byRate = new Map<string, SetBody[]>();
      for (const s of sets) byRate.set(s.rate, [...(byRate.get(s.rate) ?? []), s]);
      onConfirm(
        [...byRate].map(([rate, group]) => ({
          variationId: variation.id,
          productId: product.id,
          productName: product.name,
          shortName: variation.shortName,
          attributes: {},
          unit: product.unit,
          imageUrl: variation.imageUrl ?? product.imageUrl,
          price: rate,
          quantity: group.length,
          available: 0,
          sets: group.map((s) => ({ parts: s.parts, notes: s.notes, ...(s.warehouseId ? { warehouseId: s.warehouseId } : {}) })),
          setSummaries: group.map((s) => [setSummary(info, s), s.warehouseId ? `in ${wh.codeOf(s.warehouseId)}` : ""].filter(Boolean).join(" · ")),
          setDetails: group.map((s) => ({ rows: setContentRows(info, s), ...(s.warehouseId ? { note: wh.codeOf(s.warehouseId) } : {}) })),
        })),
      );
    } catch (e) {
      setError(e instanceof Error && !("status" in e) ? e.message : errorText(e));
    }
  }

  const total = (rows ?? []).reduce((s, r) => s + (Number(r.rate) || 0), 0);
  return (
    <Modal open title={product ? `Sets bought · ${product.name}` : "Sets bought"} onClose={onClose} xl>
      <Alert message={loadError} />
      {product && !info && <Alert message={`${product.name} is not a grouped product`} />}
      {info && rows && (
        <>
          <p className="mb-3 text-xs text-slate-500">
            One row per set received: pick every part ({info.byproducts.map((b) => b.name).join(", ")}), the chain length, and the rate paid for the set.
            Sets at the same rate become one cart line.
          </p>
          <div className="mb-3 rounded-lg border border-slate-200">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm cursor-pointer hover:bg-slate-50"
              aria-expanded={showStock}
              onClick={() => setShowStock((x) => !x)}
            >
              <span className="font-semibold text-slate-700">
                Check Stock{" "}
                <span className="font-normal text-slate-500">
                  · {inStock.data ? `${inStock.data.sets.length} set${inStock.data.sets.length === 1 ? "" : "s"} in stock` : "…"}
                </span>
              </span>
              <span className="text-xs text-brand-600">{showStock ? "Hide" : "Show"}</span>
            </button>
            {showStock && (
              <div className="overflow-x-auto border-t border-slate-100 p-2">
                <SetTypesTable groupId={productId} layout="columns" />
              </div>
            )}
          </div>
          {showVendor && vendor.list.length > 0 && (
            <div className="mb-3">
              <SupplierRateList
                suggestion={setRates}
                supplierId={supplier?.id ?? null}
                supplierName={supplier?.name}
                price={rows.length && rows.every((r) => r.rate === rows[0]!.rate) ? rows[0]!.rate : ""}
                onPick={(rate) => setRows((rs) => rs?.map((r) => ({ ...r, rate })) ?? rs)}
              />
              <p className="mt-1 text-[11px] text-slate-500">Set rates per supplier · tapping one fills every set below. Completing the purchase saves the rate paid.</p>
            </div>
          )}
          <SetSheetTable
            groupId={productId}
            info={info}
            rows={rows}
            setRows={(fn) => setRows((r) => fn(r ?? []))}
            defaultRate={defaultRate || mySetRate}
            rateLabel="Rate per set (₹) *"
            defaultWarehouseLabel="Receive into"
            showWarehouse={pickWarehouse}
            rateHint={
              showVendor && vendor.list.length > 0
                ? (row) => {
                    const c = partsCost(row);
                    if (!c) return null;
                    if (c.total === 0 && c.missing > 0) return <div className="mt-0.5 whitespace-nowrap text-[10px] text-slate-400">Parts: no supplier rates yet</div>;
                    return (
                      <div className="mt-0.5 whitespace-nowrap text-[10px] text-slate-500" title="Supplier rates of the parts chosen in this row">
                        From parts {money(Math.round(c.total))}
                        {c.missing > 0 && <span className="text-amber-700"> · {c.missing} part{c.missing === 1 ? "" : "s"} without a rate</span>}
                      </div>
                    );
                  }
                : undefined
            }
            standardRateHint={
              showVendor && vendor.list.length > 0
                ? (t) => {
                    const c = presetPartsCost(t);
                    if (!c) return null;
                    if (c.total === 0 && c.missing > 0) return <span className="text-[10px] text-slate-400">Parts: no rates yet</span>;
                    return (
                      <span className="text-[11px] font-medium text-slate-600" title="Supplier rates of parts in this preset">
                        Parts: <strong className="font-semibold text-emerald-700">{money(Math.round(c.total))}</strong>
                        {c.missing > 0 && <span className="text-amber-700"> · {c.missing} unpriced</span>}
                      </span>
                    );
                  }
                : undefined
            }
          />
          <div className="mt-2 text-xs text-slate-500">
            {rows.length} set{rows.length === 1 ? "" : "s"} · total {money(total)}
          </div>
        </>
      )}
      <div className="mt-3">
        <Alert message={error} />
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={confirm} disabled={!info || !rows}>
          {initial?.length ? "Update sets" : `Add ${rows?.length ?? 0} set${rows?.length === 1 ? "" : "s"} to purchase`}
        </button>
      </div>
    </Modal>
  );
}
