"use client";

import { useEffect, useState } from "react";
import type { CartLine } from "@/components/CartContext";
import { Alert, Modal } from "@/components/ui";
import { money } from "@/lib/format";
import type { Product } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { useWarehouses } from "@/lib/useWarehouses";
import { SetTypesTable, useSetsInStock } from "./SetTypes";
import { buildSets, emptyRow, rowsFromSets, setContentRows, setSummary, SetSheetTable, type SetBody, type SheetRow } from "./SetSheet";

// V3.1 purchase cart (docs\GROUPED-PRODUCTS-V3-PLAN.md §3): the set sheet for a grouped product.
// Confirm turns the rows into cart lines — one line per set rate ("Chain Hoist Set × 2 @ 6,200"),
// because a document line has one price (D11: one purchase rate per set, no part costs).

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
          <SetSheetTable info={info} rows={rows} setRows={(fn) => setRows((r) => fn(r ?? []))} defaultRate={defaultRate} rateLabel="Rate per set (₹) *" defaultWarehouseLabel="Receive into" showWarehouse={pickWarehouse} />
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
