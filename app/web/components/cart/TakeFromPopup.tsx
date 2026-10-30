"use client";

import { useEffect, useState } from "react";
import { Alert, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { qty } from "@/lib/format";
import type { LineSplit, StockProduct, WarehouseQty } from "@/lib/types";
import { errorText } from "@/lib/useApi";
import { freeByWarehouse, splitTotal, suggestSplits, useWarehouses } from "@/lib/useWarehouses";

// V3.1 "Take from" popup (docs\WAREHOUSE-V3-PLAN.md WH-6, §4.6): one quantity box per warehouse
// holding the item, default warehouse first and pre-filled, a running "5 of 5" check. "Let the
// system pick" adds the line without a split (default first at checkout; on a sale order this is
// "Decide at delivery"). Measured items never come here: their pieces decide.

/** Free stock per warehouse of one variation, read live from the inventory API. */
export async function loadFreeStock(productId: string, variationId: string): Promise<WarehouseQty[]> {
  const { product } = await api<{ product: StockProduct }>(`/inventory/products/${productId}`);
  return freeByWarehouse(product.variations.find((v) => v.id === variationId)?.byWarehouse);
}

export function TakeFromPopup({
  title,
  unit,
  quantity,
  productId,
  variationId,
  initial,
  laterLabel = "Let the system pick",
  receive = false,
  onConfirm,
  onClose,
}: {
  title: string;
  unit: string;
  quantity: number;
  productId: string;
  variationId: string;
  initial?: LineSplit[];
  laterLabel?: string;
  /** Purchase split (WH-5): where the line is received; no stock limits. */
  receive?: boolean;
  /** undefined = no split (automatic / decide at delivery). */
  onConfirm: (splits: LineSplit[] | undefined) => void;
  onClose: () => void;
}) {
  const wh = useWarehouses();
  const [free, setFree] = useState<WarehouseQty[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    loadFreeStock(productId, variationId).then(
      (f) => {
        if (!live) return;
        setFree(f);
        const start = initial ?? (receive ? [] : suggestSplits(f, quantity, wh.defaultWarehouse?.id ?? null));
        setValues(Object.fromEntries(start.map((s) => [s.warehouseId, String(s.quantity)])));
      },
      (e) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
    // Loaded once per opening; `initial` / `quantity` are the values at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, variationId]);

  // Warehouses holding the item first (default on top), then the other active ones (stock may be
  // taken below zero only when the company as a whole is short, WH-6a).
  const rows = wh.active
    .map((w) => ({ w, have: free?.find((f) => f.warehouseId === w.id)?.quantity ?? 0 }))
    .sort((a, b) => (a.w.isDefault ? -1 : b.w.isDefault ? 1 : b.have - a.have));
  const splits: LineSplit[] = Object.entries(values)
    .map(([warehouseId, v]) => ({ warehouseId, quantity: Number(v) }))
    .filter((s) => Number.isFinite(s.quantity) && s.quantity > 0);
  const total = splitTotal(splits);
  const over = receive ? [] : rows.filter(({ w, have }) => Number(values[w.id] ?? 0) > have);
  const companyFree = (free ?? []).reduce((s, f) => s + f.quantity, 0);
  const ok = total === quantity && splits.every((s) => Number.isInteger(s.quantity)) && (over.length === 0 || companyFree < quantity);

  return (
    <Modal open title={`${receive ? "Receive into" : "Take from"} · ${title}`} onClose={onClose}>
      <Alert message={error} />
      {!free ? (
        <p className="text-sm text-slate-500">Loading stock per warehouse…</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            {qty(quantity)} {unit} — choose how much {receive ? "goes to" : "comes from"} each warehouse.
          </p>
          <table className="table">
            <thead>
              <tr>
                <th>Warehouse</th>
                <th className="text-right">In stock</th>
                <th className="w-32 text-right">{receive ? "Receive" : "Take"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ w, have }) => (
                <tr key={w.id}>
                  <td>
                    <span className="font-mono font-semibold">{w.code}</span> {w.name}
                    {w.isDefault && <span className="ml-1 text-xs text-slate-400">(default)</span>}
                  </td>
                  <td className="text-right tabular-nums">{qty(have)}</td>
                  <td className="text-right">
                    <input autoComplete="off"
                      className={`input w-24 text-right ${!receive && Number(values[w.id] ?? 0) > have ? "border-rose-400" : ""}`}
                      inputMode="numeric"
                      aria-label={`${receive ? "Receive into" : "Take from"} ${w.code}`}
                      value={values[w.id] ?? ""}
                      placeholder="0"
                      onChange={(e) => setValues((v) => ({ ...v, [w.id]: e.target.value.replace(/[^\d]/g, "") }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={`text-sm font-semibold ${total === quantity ? "text-emerald-700" : "text-rose-600"}`}>
            {qty(total)} of {qty(quantity)} {unit}
          </div>
          {over.length > 0 && companyFree >= quantity && (
            <p className="text-xs text-rose-600">
              {over.map((o) => o.w.code).join(", ")} does not have that much. Take the rest from another warehouse, or shift stock first.
            </p>
          )}
          {over.length > 0 && companyFree < quantity && (
            <p className="text-xs text-amber-700">The company as a whole is short; the sale will ask to confirm selling below zero.</p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => onConfirm(undefined)}>
              {laterLabel}
            </button>
            <button type="button" className="btn-primary" disabled={!ok} onClick={() => onConfirm(splits)}>
              Confirm
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** "W1 3 · W2 2" chips of a line's split, or "Auto" (button opens the popup). */
export function SplitChips({ splits, onClick, emptyLabel = "Auto" }: { splits?: LineSplit[]; onClick?: () => void; emptyLabel?: string }) {
  const wh = useWarehouses();
  if (!wh.enabled) return null;
  const body = splits?.length ? (
    splits.length === 1 ? (
      <span>from {wh.codeOf(splits[0]!.warehouseId)}</span>
    ) : (
      splits.map((s) => (
        <span key={s.warehouseId}>
          {wh.codeOf(s.warehouseId)} {qty(s.quantity)}
        </span>
      ))
    )
  ) : (
    <span>{emptyLabel}</span>
  );
  const cls = "inline-flex flex-wrap items-center gap-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-800";
  return onClick ? (
    <button type="button" className={`${cls} hover:bg-sky-100`} onClick={onClick} title="Change warehouses">
      {body} ✎
    </button>
  ) : (
    <span className={cls}>{body}</span>
  );
}

/** "In warehouses" chips of a variation's stock (product drawer, WH-6 §4.6); nothing while off. */
export function WarehouseStockChips({ rows }: { rows?: WarehouseQty[] | null }) {
  const list = (rows ?? []).filter((r) => r.quantity !== 0);
  if (!list.length) return null;
  return (
    <span className="inline-flex flex-wrap justify-end gap-1 text-[11px]">
      {list.map((r) => (
        <span key={r.warehouseId} className={`rounded px-1.5 ${r.quantity < 0 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"}`}>
          {r.code} {qty(r.quantity)}
        </span>
      ))}
    </span>
  );
}
