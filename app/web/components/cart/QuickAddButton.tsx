"use client";

import { useEffect, useState } from "react";
import { useCart, type CartMode } from "@/components/CartContext";
import type { ProductCard } from "@/lib/types";

export function QuickAddButton({ product, mode }: { product: ProductCard; mode: CartMode }) {
  const cart = useCart();
  const defaultPrice = mode === "sale" ? product.priceMin ?? product.priceMax ?? "0" : product.costMin ?? product.priceMin ?? "0";
  const cartIndex = cart.lines.findIndex((line) => line.productId === product.id && line.variationId === (product.variationId ?? product.id));
  const count = cartIndex >= 0 ? cart.lines[cartIndex]!.quantity : 0;
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(() => setMessage(null), 4000);
    return () => window.clearTimeout(id);
  }, [message]);

  const addOne = () => {
    const line = {
      variationId: product.variationId ?? product.id,
      productId: product.id,
      productName: product.name,
      shortName: product.shortName,
      attributes: {},
      unit: product.unit,
      imageUrl: product.imageUrl,
      price: defaultPrice,
      quantity: 1,
      available: product.quantity,
    };
    const blocked = cart.add(mode, line);
    if (blocked) {
      setMessage(blocked);
      return;
    }
    setMessage("Added");
  };

  const updateQty = (next: number) => {
    if (cartIndex < 0) return;
    if (next <= 0) {
      cart.remove(cartIndex);
      setMessage("Removed");
      return;
    }
    cart.setQuantity(cartIndex, next);
  };

  const exceedStock = product.quantity > 0 && count >= product.quantity;
  if (count > 0) {
    return (
      <div className="grid gap-2">
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
          <button type="button" className="h-7 w-7 rounded-full border border-slate-300 bg-white text-sm font-semibold" onClick={() => updateQty(count - 1)}>-</button>
          <span className="min-w-5 text-center text-sm font-semibold">{count}</span>
          <button type="button" className="h-7 w-7 rounded-full border border-slate-300 bg-white text-sm font-semibold" onClick={() => {
            if (exceedStock) {
              setMessage(`Only ${product.quantity} in stock — you'll confirm at checkout`);
              return;
            }
            updateQty(count + 1);
          }}>+</button>
        </div>
        {message && (
          <div className="flex items-center gap-2 text-[11px] text-slate-600">
            <span>{message}</span>
            {cartIndex >= 0 && message === "Added" && (
              <button type="button" className="text-brand-700 underline" onClick={() => { cart.remove(cartIndex); setMessage(null); }}>
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <button type="button" className="btn-primary text-sm" onClick={addOne}>
        {product.productType === "variable" ? "Choose options" : "Add to Cart"}
      </button>
      {message && <div className="text-[11px] text-slate-600">{message}</div>}
    </div>
  );
}
