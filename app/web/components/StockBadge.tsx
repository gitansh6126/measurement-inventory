import { qty } from "@/lib/format";
import { fmtLen, type MeasureMeta } from "@/lib/measure";
import { useLengthView } from "@/lib/lengthView";

export type StockState = "ok" | "low" | "out" | "negative";

/**
 * Quantity badge: red outline when low or out of stock (current GAS Inventory Status style).
 * V2: a negative balance (sold before the purchase was entered, plan §3.3) is solid crimson
 * with an alert mark and an explanation on hover.
 */
/** `length`: a Measured product's quantity, shown in the user's length view (m / ft / both) instead of `unit`. */
export function StockBadge({ quantity, state, unit, length }: { quantity: number; state: StockState; unit?: string; length?: Pick<MeasureMeta, "lengthUnit" | "decimals"> }) {
  useLengthView();
  const negative = state === "negative" || quantity < 0;
  const tone = negative ? "border-rose-700 bg-rose-600 text-white" : state === "ok" ? "border-transparent text-slate-800" : "border-rose-400 text-rose-600";
  const title = negative
    ? `Backorder: ${qty(-quantity)} ${unit ?? ""} sold more than recorded stock. Receive a purchase or count to correct it.`
    : state === "out"
      ? "Out of stock"
      : state === "low"
        ? "Low stock"
        : undefined;
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={`rounded-md border px-1.5 py-0.5 font-semibold ${tone}`} title={title}>
        {negative && <span aria-hidden>! </span>}
        {length ? fmtLen(quantity, length) : qty(quantity)}
      </span>
      {unit && !length && <span className="text-xs text-slate-400">{unit}</span>}
    </span>
  );
}
