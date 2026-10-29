"use client";

import { useState } from "react";
import { RupeeIcon } from "@/components/icons";
import { money } from "@/lib/format";
import type { SupplierRateSuggestion } from "@/lib/useSupplierRates";

// V3.1 purchase drawer: every supplier's rate for the chosen variation, cheapest first, so the
// buyer compares vendors before typing the price. Tapping a rate fills the price (advisory only,
// BR-01 / D19: a typed price is never overwritten). The cart's supplier is marked "this supplier".

const SHOWN = 4;

export function SupplierRateList({
  suggestion,
  supplierId,
  supplierName,
  defaultCost,
  per = "",
  price,
  onPick,
  onEdit,
}: {
  suggestion: SupplierRateSuggestion | undefined;
  /** The supplier chosen in the cart, if any. */
  supplierId: string | null;
  supplierName?: string | null;
  defaultCost?: string | null;
  /** Rate suffix, e.g. " / m" for measured products. */
  per?: string;
  price: string;
  onPick: (rate: string) => void;
  /** Vendor pricing managers: open the rate editor. */
  onEdit?: () => void;
}) {
  const [all, setAll] = useState(false);
  const rates = suggestion?.rates ?? [];
  const best = rates[0] ? Number(rates[0].rate) : null;
  const mineMissing = supplierId && !rates.some((r) => r.supplierId === supplierId);
  // The cart's supplier always shows, even when it is not among the cheapest.
  const shown = all ? rates : rates.filter((r, i) => i < SHOWN || r.supplierId === supplierId);
  const asPrice = (rate: string) => String(Math.round(Number(rate)));
  const cost = Number(defaultCost) > 0 ? defaultCost! : null;

  return (
    <div className="mt-3 rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs">
        <span className="font-semibold text-slate-600">
          Vendor pricing{rates.length > 0 && <span className="font-normal text-slate-500"> · {rates.length} supplier{rates.length === 1 ? "" : "s"}</span>}
        </span>
        {onEdit && (
          <button type="button" className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-700 hover:underline cursor-pointer" onClick={onEdit}>
            <RupeeIcon className="h-3.5 w-3.5" />
            <span>Edit rates</span>
          </button>
        )}
      </div>
      {!supplierId && (
        <p className="border-b border-slate-100 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">Choose the supplier in the cart to mark their rate.</p>
      )}
      {rates.length === 0 ? (
        <p className="px-3 py-2 text-xs text-slate-500">No supplier rates for this item yet.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {shown.map((r) => {
            const mine = r.supplierId === supplierId;
            const isBest = rates.length > 1 && best !== null && Number(r.rate) === best;
            const over = rates.length > 1 && best !== null && !isBest ? Number(r.rate) - best : 0;
            const picked = price === asPrice(r.rate);
            return (
              <li key={r.supplierId}>
                <button
                  type="button"
                  onClick={() => onPick(asPrice(r.rate))}
                  title={`Use ${r.supplierName}'s rate`}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors cursor-pointer ${picked ? "bg-emerald-50" : mine ? "bg-sky-50/60 hover:bg-sky-50" : "hover:bg-slate-50"}`}
                >
                  <span className="min-w-0 flex-1 truncate text-slate-800">
                    {r.supplierName}
                    {mine && <span className="ml-1.5 rounded bg-sky-100 px-1.5 text-[10px] font-semibold text-sky-700">this supplier</span>}
                    {isBest && <span className="ml-1.5 rounded bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-700">Best</span>}
                  </span>
                  {over > 0 && <span className="text-[11px] text-rose-600">+{money(over)}</span>}
                  <span className={`whitespace-nowrap font-semibold ${picked ? "text-emerald-800" : "text-slate-900"}`}>
                    {money(r.rate)}
                    {per && <span className="text-[11px] font-normal text-slate-500">{per}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {(rates.length > shown.length || mineMissing || cost) && (
      <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-3 py-1.5 text-xs">
        {rates.length > shown.length && (
          <button type="button" className="font-medium text-brand-600 hover:underline cursor-pointer" onClick={() => setAll(true)}>
            Show all {rates.length}
          </button>
        )}
        {mineMissing && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-500">No rate for {supplierName ?? "this supplier"}</span>}
        {cost && (
          <button
            type="button"
            className={`ml-auto rounded-full border px-2.5 py-0.5 transition-colors cursor-pointer ${
              price === asPrice(cost) ? "border-emerald-500 bg-emerald-50 text-emerald-800 font-medium" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}
            onClick={() => onPick(asPrice(cost))}
            title="Use default purchase cost"
          >
            Default cost {money(cost)}
            {per}
          </button>
        )}
      </div>
      )}
    </div>
  );
}
