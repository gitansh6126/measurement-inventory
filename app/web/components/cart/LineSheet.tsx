"use client";

import { useMemo, useState } from "react";
import { useCart, type CartLine, type CartMode, paise } from "@/components/CartContext";
import { OptionButtons } from "@/components/cart/OptionButtons";
import { ProductThumb } from "@/components/ProductThumb";
import { StockBadge } from "@/components/StockBadge";
import { DataView } from "@/components/catalog/DataView";
import { useViewMode } from "@/lib/useViewMode";
import { money } from "@/lib/format";
import { fmtSellRate } from "@/lib/measure";
import type { StockProduct, StockVariation } from "@/lib/types";

export function LineSheet({
  product,
  mode,
  onClose,
  edit,
}: {
  product: StockProduct;
  mode: CartMode;
  onClose: () => void;
  edit?: { index: number; line: CartLine };
}) {
  const cart = useCart();
  const active = useMemo(() => product.variations.filter((v) => v.active), [product]);
  const variable = product.productType === "variable";
  const initial = edit ? active.find((v) => v.id === edit.line.variationId) : active.length === 1 ? active[0] : undefined;
  const [pick, setPick] = useState<Record<string, string>>(initial ? { ...initial.attributes } : {});
  const [qtyVal, setQtyVal] = useState(edit?.line.quantity ?? 1);
  const [price, setPrice] = useState(edit ? String(Number(edit.line.price)) : "");
  const [error, setError] = useState("");
  const [view, setView] = useViewMode("cart.variations", "grid");

  const chosen: StockVariation | undefined = variable
    ? active.find((v) => product.attributes.every((a) => v.attributes[a.name] === pick[a.name]))
    : active[0];

  const possible = (attr: string, value: string) =>
    active.some((v) => v.attributes[attr] === value && product.attributes.every((a) => a.name === attr || !pick[a.name] || v.attributes[a.name] === pick[a.name]));

  const priceOk = /^\d{1,10}(?:\.\d{1,2})?$/.test(price.trim());
  const subtotal = priceOk ? qtyVal * paise(price) : 0;

  function commit() {
    if (!chosen) return setError(variable ? "Choose a value for every option" : "This product has no active variation");
    if (!priceOk) return setError("Enter a valid rupee price");
    const attributeUnits = Object.fromEntries(
      product.attributes.filter((a) => !a.isQuality && !!a.unit).map((a) => [a.name, a.unit!]),
    ) as Record<string, string>;
    const line: CartLine = {
      variationId: chosen.id,
      productId: product.id,
      productName: product.name,
      shortName: chosen.shortName,
      attributes: chosen.attributes,
      attributeUnits,
      unit: product.unit,
      imageUrl: chosen.imageUrl ?? product.imageUrl,
      price: price.trim(),
      quantity: qtyVal,
      available: chosen.quantity,
    };
    if (edit) {
      cart.replace(edit.index, line);
      return onClose();
    }
    const blocked = cart.add(mode, line);
    if (blocked) return setError(blocked);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={`${mode === "sale" ? "Add sale" : "Add purchase"}: ${product.name}`}>
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Close" onClick={onClose} />
      <div className="relative w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <ProductThumb src={chosen?.imageUrl ?? product.imageUrl} name={product.name} className="h-16 w-16 rounded-lg" />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{edit ? "Edit line" : mode === "sale" ? "Add sale" : "Add purchase"}</div>
              <div className="text-lg font-bold text-slate-900">{product.name}</div>
            </div>
          </div>
          <button type="button" className="text-slate-500" onClick={onClose}>Close</button>
        </div>

        {variable && (
          <div className="mb-4">
            <OptionButtons
              attributes={product.attributes}
              active={active}
              picks={pick}
              onChange={(name, value) => setPick((prev) => ({ ...prev, [name]: prev[name] === value ? "" : value }))}
            />
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex items-center gap-3">
            <button type="button" className="h-9 w-9 rounded-md border border-slate-300 bg-white" onClick={() => setQtyVal((v) => Math.max(1, v - 1))}>−</button>
            <span className="min-w-8 text-center font-semibold text-slate-900">{qtyVal}</span>
            <button type="button" className="h-9 w-9 rounded-md border border-slate-300 bg-white" onClick={() => setQtyVal((v) => v + 1)}>+</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <span>Price</span>
            <input autoComplete="off" aria-label="Price" value={price} onChange={(e) => setPrice(e.target.value)} className="input w-28" />
          </label>
        </div>

        {error && <div className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        {chosen && <div className="mt-3 flex items-center justify-between text-sm text-slate-600"><span>{chosen.shortName}</span><StockBadge quantity={chosen.quantity} state={chosen.state} unit={product.unit} /></div>}

        {variable && (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="font-semibold text-slate-800">All options</h3>
              <div className="flex gap-2">
                <button type="button" className={view === "grid" ? "btn-secondary" : "btn-secondary opacity-70"} onClick={() => setView("grid")}>Grid</button>
                <button type="button" className={view === "table" ? "btn-secondary" : "btn-secondary opacity-70"} onClick={() => setView("table")}>Table</button>
              </div>
            </div>
            <DataView
              rows={product.variations}
              view={view}
              rowKey={(row) => row.id}
              label="Variations"
              onOpen={(row) => setPick({ ...row.attributes })}
              renderCard={(row) => (
                <button type="button" onClick={() => setPick({ ...row.attributes })} className="card flex h-full w-full flex-col gap-2 p-3 text-left">
                  <div className="flex items-center justify-between text-xs text-slate-500"><span>{row.shortName}</span><span>{row.quantity}</span></div>
                  <div className="font-semibold text-slate-900">{fmtSellRate(null, row.minSalePrice, row.salePrice, "Sell: ")}</div>
                  <div className="text-xs text-slate-500">{Object.values(row.attributes).join(" / ") || "Variant"}</div>
                </button>
              )}
              columns={[
                { id: "variation", header: <span>Variation</span>, cell: (row) => <td>{row.shortName}</td> },
                { id: "stock", header: <span>Stock</span>, cell: (row) => <td>{row.quantity}</td> },
                { id: "price", header: <span className="text-right">Selling Price</span>, align: "right", cell: (row) => <td className="text-right font-medium">{fmtSellRate(null, row.minSalePrice, row.salePrice, "Sell: ")}</td> },
              ]}
              empty={<div className="card p-4 text-sm text-slate-500">No options.</div>}
            />
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <div className="text-sm text-slate-600">Subtotal <span className="font-semibold text-slate-900">{money(String(subtotal / 100))}</span></div>
          <button type="button" className="btn-primary" onClick={commit}>{edit ? "Save changes" : "Add to cart"}</button>
        </div>
      </div>
    </div>
  );
}
