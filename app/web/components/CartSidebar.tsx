"use client";

import Link from "next/link";
import { useEffect } from "react";
import { isSetLine, linePaise, useCart } from "@/components/CartContext";
import { SetDetailsList } from "@/components/sets/SetContents";
import { CloseIcon, TrashIcon } from "@/components/icons";
import { ProductThumb } from "@/components/ProductThumb";
import { formatAttributeValue, money } from "@/lib/format";
import { rateLabel } from "@/lib/measure";
import { SplitChips } from "@/components/cart/TakeFromPopup";
import { LineFlags } from "@/components/cart/LineFlags";

export function CartSidebar() {
  const cart = useCart();

  useEffect(() => {
    if (!cart.drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cart.closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart.drawerOpen, cart.closeDrawer]);

  if (!cart.drawerOpen) return null;

  const isSale = cart.mode === "sale";
  const checkoutHref = isSale ? "/sales/checkout" : "/purchases/checkout";

  function handleClear() {
    if (confirm("Are you sure you want to clear all items from the cart?")) {
      cart.clear();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
        onClick={cart.closeDrawer}
        aria-hidden="true"
      />

      {/* Slide-out right sidebar */}
      <div
        className="relative z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl border-l border-slate-200"
        role="dialog"
        aria-modal="true"
        aria-label="Shopping Cart Sidebar"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${
                isSale ? "bg-sky-100 text-sky-800" : "bg-slate-200 text-slate-800"
              }`}
            >
              {isSale ? "Sale Cart" : "Purchase Cart"}
            </span>
            <span className="text-xs font-medium text-slate-500">
              {cart.count} {cart.count === 1 ? "item" : "items"}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {cart.count > 0 && (
              <button
                type="button"
                onClick={handleClear}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-slate-500 hover:bg-rose-50 hover:text-rose-600 active:scale-95 active:bg-rose-100 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                title="Clear all items"
              >
                <TrashIcon className="h-3.5 w-3.5" />
                <span>Clear</span>
              </button>
            )}
            <button
              type="button"
              onClick={cart.closeDrawer}
              className="rounded-full p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 active:scale-90 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              aria-label="Close cart sidebar"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Cart Item List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.lines.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center p-6 text-center text-slate-500">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400 mb-3">
                <TrashIcon className="h-8 w-8 opacity-40" />
              </div>
              <p className="text-base font-semibold text-slate-800">Your cart is empty</p>
              <p className="mt-1 text-xs text-slate-400 max-w-xs">
                Pick products from the catalog to build your {isSale ? "sale" : "purchase"} order.
              </p>
              <button
                type="button"
                onClick={cart.closeDrawer}
                className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 hover:shadow-sm active:scale-95 transition-all duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-600"
              >
                Browse Catalog
              </button>
            </div>
          ) : (
            cart.lines.map((l, index) => {
              const lineTotal = linePaise(l) / 100;
              const short = isSale && l.quantity > l.available;
              return (
                <div
                  key={`${l.variationId}-${index}`}
                  className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:border-slate-300 transition"
                >
                  <ProductThumb
                    src={l.imageUrl}
                    name={l.productName}
                    className="h-14 w-14 shrink-0 rounded-md border border-slate-200 text-[8px]"
                  />

                  <div className="flex flex-1 flex-col justify-between min-w-0">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="truncate text-sm font-semibold text-slate-900" title={l.productName}>
                          {l.productName}
                        </h4>
                        <button
                          type="button"
                          onClick={() => cart.remove(index)}
                          className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 active:bg-rose-100 active:scale-90 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                          title="Remove item"
                          aria-label={`Delete ${l.productName} from cart`}
                        >
                          <TrashIcon className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {l.attributes && Object.keys(l.attributes).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(l.attributes).map(([k, v]) => (
                            <span
                              key={k}
                              className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600"
                            >
                              {k}: {formatAttributeValue(k, v, l.attributeUnits?.[k])}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="mt-1 text-xs text-slate-500">
                        ₹{l.price} / {l.measure ? rateLabel(l.measure.lengthUnit) : isSetLine(l) ? "set" : l.unit}
                      </div>
                      {!l.measure && !isSetLine(l) && (
                        <div className="mt-1">
                          <SplitChips splits={l.splits} emptyLabel={cart.mode === "sale" ? "Auto" : "Receive into"} />
                        </div>
                      )}
                      {isSetLine(l) && (
                        <SetDetailsList className="mt-1" details={l.setDetails} summaries={l.setSummaries} />
                      )}

                      <LineFlags line={l} className="mt-1" />
                      {short && (
                        <p className="mt-1 text-[11px] text-amber-700 font-medium">
                          Shortage: selling {l.quantity}, {l.available} on hand
                        </p>
                      )}
                    </div>

                    <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2">
                      {/* Quantity Stepper (V3.1 set lines: the count follows the sets entered) */}
                      {isSetLine(l) ? (
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-semibold text-slate-900">{l.quantity} set{l.quantity === 1 ? "" : "s"}</span>
                          <button type="button" className="text-rose-600 hover:underline" onClick={() => cart.remove(index)}>
                            Remove
                          </button>
                        </div>
                      ) : (
                      <div className="flex items-center rounded-md border border-slate-300 bg-slate-50 shadow-sm">
                        <button
                          type="button"
                          onClick={() => {
                            if (l.quantity <= 1) {
                              cart.remove(index);
                            } else {
                              cart.setQuantity(index, l.quantity - 1);
                            }
                          }}
                          className="h-7 w-7 text-xs font-semibold text-slate-600 hover:bg-rose-50 hover:text-rose-600 active:bg-rose-100 active:scale-90 rounded-l-md transition-all duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                          aria-label="Decrease quantity"
                        >
                          −
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          className="h-7 w-10 border-x border-slate-300 bg-white text-center text-xs font-semibold text-slate-900 outline-none focus:bg-brand-50/30"
                          value={l.quantity}
                          onChange={(e) => {
                            const val = Number(e.target.value.replace(/\D/g, "")) || 1;
                            cart.setQuantity(index, val);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => cart.setQuantity(index, l.quantity + 1)}
                          className="h-7 w-7 text-xs font-semibold text-slate-600 hover:bg-brand-50 hover:text-brand-600 active:bg-brand-100 active:scale-90 rounded-r-md transition-all duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                          aria-label="Increase quantity"
                        >
                          +
                        </button>
                      </div>
                      )}

                      {/* Line Total */}
                      <div className="text-right">
                        <span className="text-xs text-slate-400 mr-1 font-normal">Total:</span>
                        <span className="font-semibold text-slate-900">{money(lineTotal)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {cart.lines.length > 0 && (
          <div className="border-t border-slate-200 bg-slate-50/90 p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <span className="text-sm font-medium text-slate-600">Subtotal</span>
              <span className="text-2xl font-bold text-slate-900">{money(cart.totalPaise / 100)}</span>
            </div>

            <p className="mb-3 text-[11px] text-slate-400">
              Stock, pricing, and taxes will be confirmed during checkout.
            </p>

            <div className="grid gap-2">
              <Link
                href={checkoutHref}
                onClick={cart.closeDrawer}
                className={`group/checkout flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:transform-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
                  isSale ? "bg-brand-600 hover:bg-brand-700 hover:shadow-md focus-visible:ring-brand-500" : "bg-slate-900 hover:bg-slate-800 hover:shadow-md focus-visible:ring-slate-700"
                }`}
              >
                <span>Proceed to Checkout</span>
                <span className="inline-block transition-transform duration-200 group-hover/checkout:translate-x-1 motion-reduce:transform-none">›</span>
              </Link>

              <button
                type="button"
                onClick={cart.closeDrawer}
                className="w-full rounded-lg border border-slate-300 bg-white py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:border-slate-400 active:bg-slate-200 active:scale-[0.98] transition-all duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              >
                Continue Browsing
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
