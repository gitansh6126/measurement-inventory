"use client";

import Link from "next/link";
import { lineKey, useCart } from "@/components/CartContext";
import { CartSidebar } from "@/components/CartSidebar";
import { SidebarIcon, TrashIcon } from "@/components/icons";
import { ProductThumb } from "@/components/ProductThumb";
import { money } from "@/lib/format";

/** Floating "N Items in Sale Cart ₹total" pill (GAS updateCartCounts). */
export function CartPill() {
  const cart = useCart();
  const hasItems = Boolean(cart.count && cart.mode);
  const href = cart.mode === "sale" ? "/sales/checkout" : "/purchases/checkout";
  // V2 (plan §3.3): live shortage count; never blocks going to checkout.
  const short = cart.mode === "sale" ? cart.lines.filter((l) => l.quantity > l.available).length : 0;

  return (
    <>
      <CartSidebar />
      {hasItems && (
        <div className="fixed bottom-5 right-5 z-40 group flex flex-col items-end">
          {/* Layered inline buttons visible on desktop hover */}
          <div className="hidden md:flex items-center gap-1.5 pb-2 opacity-0 translate-y-1.5 pointer-events-none group-hover:opacity-100 group-hover:translate-y-0 group-hover:pointer-events-auto transition-all duration-200 ease-out">
            <div className="flex items-center gap-1 rounded-full bg-slate-900/95 p-1 shadow-2xl border border-slate-700/80 backdrop-blur-md">
              {/* 1st button: Open cart in right sidebar */}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  cart.openDrawer();
                }}
                className="flex items-center gap-1.5 rounded-full bg-slate-800 hover:bg-brand-600 active:bg-brand-700 active:scale-95 px-3 py-1.5 text-xs font-medium text-white transition-all duration-150 shadow-sm cursor-pointer select-none motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                title="Open cart in right sidebar"
                aria-label="Open cart in right sidebar"
              >
                <SidebarIcon className="h-3.5 w-3.5 text-slate-300" />
                <span>Open Cart</span>
              </button>

              {/* 2nd button: Clear cart */}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (confirm(`Remove all ${cart.count} item${cart.count > 1 ? "s" : ""} from the cart?`)) {
                    cart.clear();
                  }
                }}
                className="flex items-center gap-1.5 rounded-full bg-slate-800 hover:bg-rose-600 active:bg-rose-700 active:scale-95 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white transition-all duration-150 shadow-sm cursor-pointer select-none motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                title="Clear all items from cart"
                aria-label="Clear cart"
              >
                <TrashIcon className="h-3.5 w-3.5" />
                <span>Clear</span>
              </button>
            </div>
          </div>

          {/* Main Cart Pill */}
          <Link
            href={href}
            className="group/pill flex items-center gap-3 rounded-full bg-slate-900 py-2 pl-2 pr-4 text-white shadow-2xl border border-slate-800 transition-all duration-200 hover:bg-slate-800 hover:-translate-y-0.5 hover:shadow-brand-500/10 hover:border-slate-700 active:translate-y-0 active:scale-[0.98] motion-reduce:transition-none motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 cursor-pointer select-none"
            aria-label={`Open ${cart.mode} cart with ${cart.count} items`}
          >
            <div className="flex -space-x-3">
              {cart.lines.slice(0, 3).map((l) => (
                <ProductThumb key={lineKey(l)} src={l.imageUrl} name={l.productName} className="h-9 w-9 rounded-full border-2 border-slate-900 text-[6px]" />
              ))}
            </div>
            <div className="leading-tight">
              <div className="text-xs text-slate-300">
                {cart.count} item{cart.count > 1 ? "s" : ""} in {cart.mode === "sale" ? "Sale" : "Purchase"} Cart
                {short > 0 && <span className="ml-1 font-semibold text-amber-300">· {short} short</span>}
              </div>
              <div className="font-bold text-sky-300">{money(cart.totalPaise / 100)}</div>
            </div>
            <span className="ml-1 text-lg inline-block transition-transform duration-200 group-hover/pill:translate-x-1 motion-reduce:transform-none" aria-hidden>›</span>
          </Link>
        </div>
      )}
    </>
  );
}
