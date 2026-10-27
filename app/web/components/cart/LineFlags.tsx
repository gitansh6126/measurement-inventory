"use client";

import { hasSetBackorder, type CartLine } from "@/components/CartContext";

/**
 * Cart line flags: a sale line on backorder (a measured length no bundle has, or a set waiting for a
 * by-product — customer order only) and a purchase line bought for a customer order.
 */
export function LineFlags({ line, className = "" }: { line: CartLine; className?: string }) {
  const measured = !!line.measure && (line.measure.isShortage || (!line.measure.pieceId && !line.measure.rolls));
  const set = hasSetBackorder(line);
  if (!measured && !set && !line.linked) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {(measured || set) && (
        <span className="rounded border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[11px] font-semibold text-rose-800">
          Backorder — {set ? "part to be bought for the set" : "order a new bundle"}
        </span>
      )}
      {line.linked && (
        <span className="rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800">For customer order {line.linked.orderNumber}</span>
      )}
    </div>
  );
}
