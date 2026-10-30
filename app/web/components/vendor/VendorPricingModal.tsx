"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Alert, Modal, TableSkeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, money, variationLabel } from "@/lib/format";
import { fmtRate } from "@/lib/measure";
import { LengthScopeProvider, useLengthView } from "@/lib/lengthView";
import { LengthViewToggle } from "@/components/measure/LengthViewToggle";
import type { StockProduct } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { GroupedSetPricing } from "@/components/vendor/GroupedSetPricing";

interface RateRecord {
  id: string;
  variationId: string;
  supplierId: string;
  supplierName: string;
  rate: string;
  active: boolean;
  effectiveAt: string;
}

interface HistoryItem {
  id: string;
  rate: string;
  /** 12 = per ft; 1 on a feet + inches product = an older per-inch rate (0028). */
  ratePer?: number;
  active: boolean;
  notes: string | null;
  recordedAt: string;
  recordedBy: string | null;
}

/**
 * Read-only vendor price view for one variation: each supplier's last price,
 * date, status and history. Rate entry lives on the Supplier Prices page
 * (By supplier or By product view).
 */
type Props = {
  productId: string;
  variationId?: string;
  onClose: () => void;
  /** Kept for caller compatibility; this view no longer edits rates. */
  onSaved?: () => void;
};

/** Vendor prices are purchase figures: they follow the purchase length view (metres by default). */
export function VendorPricingModal(props: Props) {
  return (
    <LengthScopeProvider scope="purchase">
      <VendorPricing {...props} />
    </LengthScopeProvider>
  );
}

function VendorPricing({ productId, variationId, onClose }: Props) {
  useLengthView();
  const productApi = useApi<{ product: StockProduct }>(`/inventory/products/${productId}`);
  const product = productApi.data?.product ?? null;
  // Measured rates are per m, or per ft on a feet + inches product (0028).
  const lu = product?.measure?.lengthUnit;
  const ratesApi = useApi<{ prices: RateRecord[] }>(`/vendor-prices?productId=${productId}`);
  const prices = useMemo(() => ratesApi.data?.prices ?? [], [ratesApi.data]);

  const variations = useMemo(() => product?.variations ?? [], [product]);
  const [selectedId, setSelectedId] = useState<string | undefined>(variationId);

  // Without a preselected variation, default to the first one that has rates.
  useEffect(() => {
    if (selectedId || variations.length === 0) return;
    const withRate = variations.find((v) => prices.some((p) => p.variationId === v.id));
    setSelectedId((withRate ?? variations[0])!.id);
  }, [selectedId, variations, prices]);

  const selected = variations.find((v) => v.id === selectedId) ?? null;

  // Supplier rows for the selected variation: active rates cheapest first, paused last.
  const rows = useMemo(() => {
    return prices
      .filter((p) => p.variationId === selectedId)
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return Number(a.rate) - Number(b.rate);
      });
  }, [prices, selectedId]);
  const activeRows = rows.filter((r) => r.active && Number(r.rate) > 0);
  const bestId = activeRows.length > 1 ? activeRows[0]!.id : null;

  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, HistoryItem[]>>({});
  const [error, setError] = useState<string | null>(null);

  async function toggleHistory(rec: RateRecord) {
    if (openHistory === rec.id) {
      setOpenHistory(null);
      return;
    }
    setOpenHistory(rec.id);
    if (history[rec.id]) return;
    try {
      const res = await api<{ history: HistoryItem[] }>(
        `/vendor-prices/history?variationId=${rec.variationId}&supplierId=${rec.supplierId}`
      );
      setHistory((prev) => ({ ...prev, [rec.id]: res.history }));
    } catch (err) {
      setError(errorText(err));
    }
  }

  const manageHref = product ? `/supplier-prices?view=product&productId=${product.id}&focus=${product.id}` : "/supplier-prices?view=product";
  const showPicker = !variationId && variations.length > 1;

  if (product?.productType === "grouped") {
    return (
      <Modal open title={`Vendor prices — ${product.name}`} onClose={onClose} xl>
        <GroupedSetPricing product={product as any} />
        <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
          <Link
            href={manageHref}
            target="_blank"
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
          >
            Open in full Supplier Prices page →
          </Link>
          <button type="button" className="btn-secondary text-xs" onClick={onClose}>
            Close
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      title={
        <div className="mr-6 min-w-0">
          <div className="truncate">Vendor prices — {product?.name ?? "Product"}</div>
          {selected && !showPicker && variations.length > 1 && (
            <div className="mt-0.5 truncate text-xs font-normal text-slate-500">{variationLabel(selected, product?.attributes)}</div>
          )}
        </div>
      }
      onClose={onClose}
    >
      <div className="space-y-3">
        <Alert message={error ?? undefined} kind="error" />
        {lu && (
          <div className="flex items-center justify-end gap-1.5 text-xs text-slate-500">
            Rates per <LengthViewToggle />
          </div>
        )}

        {showPicker && (
          <select
            value={selectedId ?? ""}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setOpenHistory(null);
            }}
            className="input w-full py-1.5 text-sm"
            aria-label="Variation"
          >
            {variations.map((v) => (
              <option key={v.id} value={v.id}>
                {variationLabel(v, product?.attributes) || v.shortName}
              </option>
            ))}
          </select>
        )}

        {productApi.loading || ratesApi.loading ? (
          <TableSkeleton rows={3} />
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center">
            <p className="text-sm font-semibold text-slate-700">No supplier prices for this variation yet.</p>
            {selected && Number(selected.purchaseCost) > 0 && (
              <p className="mt-1 text-xs text-slate-500">Purchase cost {fmtRate(lu, selected.purchaseCost)}</p>
            )}
          </div>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
            {rows.map((rec) => {
              const isOpen = openHistory === rec.id;
              const items = history[rec.id];
              return (
                <li key={rec.id} className={rec.id === bestId ? "bg-emerald-50/50" : ""}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-slate-900">{rec.supplierName}</span>
                        {rec.id === bestId && (
                          <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                            Best
                          </span>
                        )}
                        {!rec.active && (
                          <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                            Paused
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400">{dateTime(rec.effectiveAt)}</div>
                    </div>
                    <span className={`text-base font-semibold ${rec.active ? "text-slate-900" : "text-slate-400 line-through"}`}>
                      {fmtRate(lu, rec.rate)}
                    </span>
                    <button
                      type="button"
                      onClick={() => void toggleHistory(rec)}
                      aria-expanded={isOpen}
                      className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      {isOpen ? "Hide" : "History"}
                    </button>
                  </div>

                  {isOpen && (
                    <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-2">
                      {!items ? (
                        <TableSkeleton rows={2} />
                      ) : items.length === 0 ? (
                        <p className="py-2 text-center text-xs text-slate-500">No history recorded yet.</p>
                      ) : (
                        <ul className="space-y-1 text-xs">
                          {items.map((h) => (
                            <li key={h.id} className="flex items-center justify-between gap-3">
                              <span className="text-slate-500">
                                {dateTime(h.recordedAt)}
                                {h.recordedBy ? ` · ${h.recordedBy}` : ""}
                              </span>
                              <span className={`font-semibold ${h.active ? "text-slate-800" : "text-slate-400"}`}>
                                {fmtRate(lu, h.rate)}
                                {!h.active && <span className="ml-1 font-normal">(paused)</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link href={manageHref} target="_blank" className="text-xs font-medium text-brand-600 hover:text-brand-700 hover:underline">
              Compare &amp; edit by product ↗
            </Link>
          </div>
          <button type="button" onClick={onClose} className="btn-secondary text-xs">
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
