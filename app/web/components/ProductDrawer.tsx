"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { paise, useCart, type CartLine, type CartMode } from "@/components/CartContext";
import { ProductThumb } from "@/components/ProductThumb";
import { StockBadge } from "@/components/StockBadge";
import { SearchInput, Segmented } from "@/components/ui";
import { formatVariationAttributesString, money, qty } from "@/lib/format";
import { fmtSellRate } from "@/lib/measure";
import type { StockProduct, StockVariation } from "@/lib/types";
import { MeasuredDrawer } from "@/components/measure/MeasuredDrawer";
import { useSupplierRates } from "@/lib/useSupplierRates";
import { useCan } from "@/components/MeContext";
import { VendorPricingModal } from "@/components/vendor/VendorPricingModal";
import { SupplierRateList } from "@/components/vendor/SupplierRateList";
import { WarehouseStockChips } from "@/components/cart/TakeFromPopup";
import { useCustomerMode } from "@/components/CustomerModeContext";

// Bottom drawer (V1 layout): GAS 06 attribute pills + GAS 07 quantity/price + main v2 ProductBrowser
// variation details. Only active variations can be chosen. The cart opens it
// from a product card; Checkout opens it to edit a line.
export function ProductDrawer(props: {
  product: StockProduct;
  mode: CartMode;
  onClose: () => void;
  edit?: { index: number; line: CartLine };
  initialPick?: Record<string, string>;
  initialVariationId?: string;
}) {
  if (props.product.productType === "measured") {
    const { initialPick, initialVariationId, ...measuredProps } = props;
    return <MeasuredDrawer {...measuredProps} />;
  }
  return <CountedProductDrawer {...props} />;
}

function CountedProductDrawer({
  product,
  mode,
  onClose: close,
  edit,
  initialPick,
  initialVariationId,
}: {
  product: StockProduct;
  mode: CartMode;
  onClose: () => void;
  /** Editing an existing cart line (GAS editCartItem). */
  edit?: { index: number; line: CartLine };
  initialPick?: Record<string, string>;
  initialVariationId?: string;
}) {
  const cart = useCart();
  const { isCustomerMode } = useCustomerMode();
  const canViewVendor = useCan("vendor_pricing.view");
  const canManageVendor = useCan("vendor_pricing.manage");
  const isSale = mode === "sale";
  const isPurchase = mode === "purchase";
  const supplierId = isPurchase && cart.party?.mode === "purchase" ? cart.party.id : null;

  const active = useMemo(() => product.variations.filter((v) => v.active), [product]);
  const activeVarIds = useMemo(() => active.map((v) => v.id), [active]);
  const { suggestions, reload: reloadRates } = useSupplierRates(
    isPurchase ? activeVarIds : [],
    supplierId
  );

  const variable = product.productType === "variable";
  const initial = edit
    ? active.find((v) => v.id === edit.line.variationId)
    : initialVariationId
      ? active.find((v) => v.id === initialVariationId)
      : active.length === 1
        ? active[0]
        : undefined;
  const [tab, setTab] = useState<"form" | "stock">("form");
  const [filter, setFilter] = useState("");
  const [pick, setPick] = useState<Record<string, string>>(() => {
    if (initial) return { ...initial.attributes };
    if (initialPick && Object.keys(initialPick).length > 0) return { ...initialPick };
    return {};
  });
  const [qtyVal, setQtyVal] = useState(edit?.line.quantity ?? 1);
  const [price, setPrice] = useState<string>(edit ? String(Number(edit.line.price)) : "");
  const [error, setError] = useState("");
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  // Compact header (RMS Tech reference, owner 2026-10-28): once the form scrolls, the header shrinks
  // to a small thumbnail + one-line name so the product stays visible and the form gets the room.
  // Only when the form overflows by more than the space saved, so it cannot flip back and forth.
  const [compact, setCompact] = useState(false);
  const onBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (!compact && el.scrollTop > 32 && el.scrollHeight - el.clientHeight > 72) setCompact(true);
    else if (compact && el.scrollTop < 4) setCompact(false);
  };

  // Slide the sheet back down before unmounting (instant when reduced motion is on).
  const onClose = useCallback(() => {
    if (closeTimer.current !== undefined) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return close();
    setClosing(true);
    closeTimer.current = window.setTimeout(close, 200);
  }, [close]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const chosen: StockVariation | undefined = variable
    ? active.find((v) => product.attributes.every((a) => v.attributes[a.name] === pick[a.name]))
    : active[0];

  const sug = chosen ? suggestions.get(chosen.id) : undefined;

  // No price prefill (owner, 2026-10-20): the price is typed or picked from a price chip.
  // A new variation starts empty so another variation's price is never carried over.
  useEffect(() => {
    if (isCustomerMode && chosen) {
      setPrice(String(chosen.salePrice || 0));
    } else if (!edit) {
      setPrice("");
    }
  }, [chosen?.id, edit, isCustomerMode, chosen?.salePrice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A value is selectable if some active variation has it and matches the other picks.
  const possible = (attr: string, value: string) =>
    active.some((v) => v.attributes[attr] === value && product.attributes.every((a) => a.name === attr || !pick[a.name] || v.attributes[a.name] === pick[a.name]));

  const priceOk = /^\d{1,10}$/.test(price.trim());
  // Sale stock check: what other sale-cart lines already take of each variation (the line being
  // edited is left out), so "Left" is what this line can still use.
  const inCartOf =
    isSale && cart.mode === "sale"
      ? (variationId: string) =>
          cart.lines.reduce((s, l, i) => (l.variationId === variationId && !l.measure && !l.saleSets && (!edit || i !== edit.index) ? s + l.quantity : s), 0)
      : null;
  const freeForLine = chosen ? chosen.quantity - (inCartOf?.(chosen.id) ?? 0) : 0;
  const short = mode === "sale" && chosen ? qtyVal > freeForLine : false;
  const subtotal = priceOk ? qtyVal * paise(price) : 0;

  const displayedVariations = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return product.variations;
    return product.variations.filter((v) => {
      if (v.shortName.toLowerCase().includes(term)) return true;
      if (v.officialSku?.toLowerCase().includes(term)) return true;
      return Object.entries(v.attributes).some(
        ([k, val]) => k.toLowerCase().includes(term) || val.toLowerCase().includes(term)
      );
    });
  }, [product.variations, filter]);

  function commit() {
    if (!chosen) return setError(variable ? "Choose a value for every option" : "This product has no active variation");
    if (!priceOk) return setError("Enter a whole rupee price");
    const attrUnits: Record<string, string> = {};
    for (const a of product.attributes) {
      if (!a.isQuality && a.unit) attrUnits[a.name] = a.unit;
    }
    const line: CartLine = {
      variationId: chosen.id,
      productId: product.id,
      productName: product.name,
      shortName: chosen.shortName,
      attributes: chosen.attributes,
      attributeUnits: attrUnits,
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
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={`${isSale ? "Add sale" : "Add purchase"}: ${product.name}`}>
      <button className={`absolute inset-0 bg-slate-900/40 motion-reduce:animate-none ${closing ? "animate-fade-out" : "animate-fade-in"}`} aria-label="Close" onClick={onClose} />
      <div className={`relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl will-change-transform motion-reduce:animate-none sm:max-w-3xl ${closing ? "animate-sheet-out" : "animate-sheet-in"}`}>
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-200 sm:hidden" aria-hidden />
        <div className={`flex shrink-0 gap-3 px-5 transition-all duration-200 ${compact ? "items-center pt-2 pb-2 shadow-[0_6px_12px_-10px_rgba(15,23,42,0.25)]" : "items-start pt-3 pb-4 sm:pt-5"}`}>
          <ProductThumb src={chosen?.imageUrl ?? product.imageUrl} name={product.name} className={`shrink-0 rounded-lg transition-all duration-200 ${compact ? "h-10 w-10 text-[7px]" : "h-16 w-16 text-[9px]"}`} />
          <div className="min-w-0 flex-1">
            {!compact && <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{edit ? "Edit line" : isSale ? "Add sale" : "Add purchase"}</div>}
            <h2 className={`font-bold text-slate-900 ${compact ? "truncate text-sm" : "text-lg"}`} title={product.name}>{product.name}</h2>
            {variable && (chosen || compact) && (
              <div className="truncate text-xs text-slate-500">
                {chosen ? formatVariationAttributesString(chosen.attributes, product.attributes) : "Select options"}
                {compact && chosen && <> · <StockBadge quantity={chosen.quantity} state={chosen.state} unit={product.unit} /></>}
              </div>
            )}
          </div>
          <button className="flex h-8 w-8 items-center justify-center rounded-full text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700 active:scale-90 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label="Close" onClick={onClose}>×</button>
        </div>

        {/* View Mode Segmented Controls: every counted product can check its stock (V3.1). */}
        {(
          <div className="mx-5 mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <Segmented
              label="View Mode"
              value={tab}
              onChange={(t) => {
                setError("");
                setCompact(false);
                setTab(t);
              }}
              options={[
                { value: "form", label: edit ? "Edit Line" : isSale ? "Add to Sale" : "Add to Purchase" },
                { value: "stock", label: variable ? `Check Stock (${active.length})` : "Check Stock" },
              ]}
            />
            {tab === "stock" && (
              <span className="text-xs text-slate-500">
                Total in stock: <b className="text-slate-800">{qty(product.quantity)}</b> {product.unit}
              </span>
            )}
          </div>
        )}

        {/* Tab Content */}
        {tab === "stock" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5">
            {product.variations.length > 5 && (
              <div className="mb-2 shrink-0">
                <SearchInput
                  value={filter}
                  onChange={setFilter}
                  placeholder="Filter by attribute…"
                />
              </div>
            )}
            {/* Properly sized table container with internal horizontal and vertical scrolling */}
            <div className="max-h-[50vh] min-h-0 w-full flex-1 overflow-auto rounded-lg border border-slate-200">
              <table className={`table table-stack min-w-full ${variable ? "table-stack-all" : ""}`}>
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-xs">
                  <tr>
                    {!variable && <th className="bg-slate-50">Item</th>}
                    {product.attributes.map((a) => (
                      <th key={a.name} className="bg-slate-50">
                        {a.name}{a.unit ? ` (${a.unit})` : ""}
                      </th>
                    ))}
                    {!isCustomerMode && <th className="bg-slate-50 text-right">{isSale ? "Selling Price" : "Supplier Rate / Cost"}</th>}
                    <th className="bg-slate-50 text-right">In Stock</th>
                    {inCartOf && <th className="bg-slate-50 text-right">In cart · Left</th>}
                    <th className="bg-slate-50 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {displayedVariations.map((v) => {
                    const isSelected = chosen?.id === v.id;
                    return (
                      <tr
                        key={v.id}
                        onClick={() => {
                          if (!v.active) return;
                          setPick({ ...v.attributes });
                          setError("");
                        }}
                        className={`transition-colors duration-150 ${v.active ? "cursor-pointer hover:bg-brand-50/50" : "opacity-40 cursor-not-allowed"} ${
                          isSelected ? "bg-brand-50 font-medium" : ""
                        }`}
                      >
                        {!variable && <td className="whitespace-nowrap text-slate-800">{product.name}</td>}
                        {product.attributes.map((a) => (
                          <td key={a.name} className="whitespace-nowrap text-slate-800">
                            {v.attributes[a.name] ?? "—"}
                          </td>
                        ))}
                        <td className="whitespace-nowrap text-right text-slate-800">
                          {isSale ? (
                            <div className="font-semibold text-slate-900">
                              {fmtSellRate(null, v.minSalePrice, v.salePrice, "Sell: ")}
                            </div>
                          ) : (
                            <div>
                              {(() => {
                                const vSug = suggestions.get(v.id);
                                if (vSug?.supplierRate) {
                                  return (
                                    <>
                                      <div className="font-semibold text-slate-900">{money(vSug.supplierRate)}</div>
                                      {cart.party?.name && <span className="block text-[10px] text-sky-600 font-medium">{cart.party.name}</span>}
                                      {vSug.rates.length > 1 && <span className="block text-[10px] text-slate-500">{vSug.rates.length} suppliers · best {money(vSug.rates[0]!.rate)}</span>}
                                      {Number(v.purchaseCost) > 0 && <span className="block text-[10px] text-slate-400">Cost: {money(v.purchaseCost)}</span>}
                                    </>
                                  );
                                }
                                if (vSug?.cheapest) {
                                  return (
                                    <>
                                      <div className="font-semibold text-slate-900">{money(vSug.cheapest.rate)}</div>
                                      <span className="block text-[10px] text-slate-500">
                                        {vSug.rates.length > 1 ? `Best: ${vSug.cheapest.supplierName} · ${vSug.rates.length} suppliers` : vSug.cheapest.supplierName}
                                      </span>
                                      {Number(v.purchaseCost) > 0 && <span className="block text-[10px] text-slate-400">Cost: {money(v.purchaseCost)}</span>}
                                    </>
                                  );
                                }
                                return (
                                  <>
                                    <div className="font-semibold">{Number(v.purchaseCost) > 0 ? money(v.purchaseCost) : "—"}</div>
                                    {Number(v.salePrice) > 0 && (
                                      <span className="block text-[10px] text-slate-400">Sale: {money(v.salePrice)}</span>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-right">
                          <StockBadge quantity={v.quantity} state={v.state} unit={product.unit} />
                          <div className="mt-0.5">
                            <WarehouseStockChips rows={v.byWarehouse} />
                          </div>
                        </td>
                        {inCartOf && (() => {
                          const n = inCartOf(v.id);
                          const left = v.quantity - n;
                          return (
                            <td className="whitespace-nowrap text-right text-sm">
                              {n > 0 ? <span className="text-slate-600">{qty(n)}</span> : <span className="text-slate-400">—</span>}
                              <span className="mx-1 text-slate-300">·</span>
                              <b className={left < 0 ? "text-rose-600" : left === 0 ? "text-amber-600" : "text-emerald-700"}>{qty(left)}</b>
                            </td>
                          );
                        })()}
                        <td className="whitespace-nowrap text-center" onClick={(e) => e.stopPropagation()}>
                          {!v.active ? (
                            <span className="text-xs text-slate-400">Inactive</span>
                          ) : (
                            <button
                              type="button"
                              className={`rounded px-3 py-1 text-xs font-semibold transition-all duration-150 cursor-pointer select-none active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                                isSelected
                                  ? "bg-brand-600 text-white hover:bg-brand-700 shadow-xs"
                                  : "border border-slate-300 bg-white text-slate-700 hover:border-brand-500 hover:text-brand-600 hover:bg-brand-50/50"
                              }`}
                              onClick={() => {
                                setPick({ ...v.attributes });
                                setError("");
                                setTab("form");
                              }}
                            >
                              {isSelected ? "Selected ✓" : "Select"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {displayedVariations.length === 0 && (
                    <tr>
                      <td colSpan={product.attributes.length + 3 + (variable ? 0 : 1) + (inCartOf ? 1 : 0)} className="py-12 text-center text-sm text-slate-500">
                        No variations match &ldquo;{filter}&rdquo;
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* Form Tab Body: Scrollable only inside this container, preserving pinned header & footer */
          <div className="min-h-0 flex-1 overflow-y-auto px-5" onScroll={onBodyScroll}>
            {variable &&
              product.attributes.map((a) => (
                <div key={a.name} className="mb-4">
                  <div className="label">
                    {a.name}
                    {a.unit ? ` (${a.unit})` : ""}
                  </div>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={a.name}>
                    {a.values
                      .filter((val) => active.some((v) => v.attributes[a.name] === val))
                      .map((val) => {
                        const selected = pick[a.name] === val;
                        const ok = possible(a.name, val);
                        return (
                          <button
                            key={val}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={!ok && !selected}
                            onClick={() => {
                              setError("");
                              setPick((p) => (selected ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== a.name)) : { ...p, [a.name]: val }));
                            }}
                            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-all duration-150 select-none cursor-pointer active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 ${
                              selected
                                ? "border-brand-600 bg-brand-600 text-white shadow-xs"
                                : ok
                                ? "border-slate-300 bg-white text-slate-700 hover:border-brand-500 hover:text-brand-600 hover:bg-brand-50/50"
                                : "border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed opacity-50 active:scale-100"
                            }`}
                          >
                            {val}
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}

            {chosen && (
              <div className="mb-4 flex flex-wrap items-center gap-4 rounded-lg bg-slate-50 px-3 py-2 text-sm border border-slate-200/60">
                <span>
                  In stock: <StockBadge quantity={chosen.quantity} state={chosen.state} unit={product.unit} />
                </span>
                <WarehouseStockChips rows={chosen.byWarehouse} />
                {isSale ? (
                  <span className="font-semibold text-brand-700">
                    {fmtSellRate(null, chosen.minSalePrice, chosen.salePrice, "Sell: ")}
                  </span>
                ) : Number(chosen.purchaseCost) > 0 && <span>Last cost: <b>{money(chosen.purchaseCost)}</b></span>}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="label">Quantity</div>
                <div className="flex w-fit items-center rounded-lg border border-slate-300 bg-slate-50 shadow-xs">
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-l-lg text-lg font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-600 active:bg-rose-100 active:scale-90 transition-all duration-150 cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                    aria-label="Decrease quantity"
                    disabled={qtyVal <= 1}
                    onClick={() => setQtyVal((q) => Math.max(1, q - 1))}
                  >
                    −
                  </button>
                  <input
                    className="h-11 w-16 border-x border-slate-300 bg-white text-center font-semibold outline-none focus:bg-brand-50/20"
                    inputMode="numeric"
                    aria-label="Quantity"
                    value={qtyVal}
                    onChange={(e) => setQtyVal(Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1))}
                  />
                  <button
                    type="button"
                    className="flex h-11 w-11 items-center justify-center rounded-r-lg text-lg font-semibold text-slate-700 hover:bg-brand-50 hover:text-brand-600 active:bg-brand-100 active:scale-90 transition-all duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                    aria-label="Increase quantity"
                    onClick={() => setQtyVal((q) => q + 1)}
                  >
                    +
                  </button>
                </div>
              </div>
              {!isCustomerMode ? (
              <div>
                <label className="label" htmlFor="drawer-price">{isSale ? "Selling price ₹ / unit" : "Purchase cost ₹ / unit"}</label>
                <input
                  id="drawer-price"
                  className="input"
                  inputMode="numeric"
                  value={price}
                  placeholder="0"
                  onChange={(e) => {
                    setPrice(e.target.value);
                  }}
                />
                {isSale && chosen && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-medium text-slate-500">Price guide:</span>
                    {Number(chosen.minSalePrice) > 0 && (
                      <button
                        type="button"
                        className={`rounded-full border px-2.5 py-0.5 transition-colors cursor-pointer ${
                          price === String(Math.round(Number(chosen.minSalePrice)))
                            ? "border-emerald-500 bg-emerald-50 text-emerald-800 font-medium"
                            : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                        }`}
                        onClick={() => {
                          setPrice(String(Math.round(Number(chosen.minSalePrice))));
                        }}
                        title="Use minimum selling price"
                      >
                        Min {money(chosen.minSalePrice)}
                      </button>
                    )}
                    <button
                      type="button"
                      className={`rounded-full border px-2.5 py-0.5 transition-colors cursor-pointer ${
                        price === String(Math.round(Number(chosen.salePrice)))
                          ? "border-emerald-500 bg-emerald-50 text-emerald-800 font-medium"
                          : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                      }`}
                      onClick={() => {
                        setPrice(String(Math.round(Number(chosen.salePrice))));
                      }}
                      title="Use standard selling price"
                    >
                      Selling {money(chosen.salePrice)}
                    </button>
                  </div>
                )}
              </div>
              ) : (
                <div className="flex items-center text-xs text-slate-500">
                  <span>Price will be finalized with staff upon handover.</span>
                </div>
              )}
            </div>

            {isPurchase && canViewVendor && chosen && (
              <SupplierRateList
                suggestion={sug}
                supplierId={supplierId}
                supplierName={cart.party?.name}
                defaultCost={chosen.purchaseCost}
                price={price}
                onPick={setPrice}
                onEdit={canManageVendor ? () => setShowVendorModal(true) : undefined}
              />
            )}

            {short && chosen && (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 border border-amber-200">
                {freeForLine < chosen.quantity
                  ? `Only ${qty(Math.max(0, freeForLine))} left (${qty(chosen.quantity)} in stock, ${qty(chosen.quantity - freeForLine)} already in the cart).`
                  : `Only ${qty(chosen.quantity)} in stock.`}{" "}
                You can still add it; you will confirm the shortage at checkout.
              </p>
            )}
            {error && <p className="mt-3 text-sm text-rose-600" role="alert">{error}</p>}
          </div>
        )}

        {/* Always Visible Sticky Footer */}
        <div className="shrink-0 border-t border-slate-100 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-[0_-6px_12px_-10px_rgba(15,23,42,0.25)] sm:pt-4">
          {tab === "stock" ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <div className="text-sm">
                {chosen ? (
                  <span className="text-slate-600">
                    Selected: <b className="text-slate-900">{formatVariationAttributesString(chosen.attributes, product.attributes) || product.name}</b> · In stock:{" "}
                    <StockBadge quantity={chosen.quantity} state={chosen.state} unit={product.unit} />
                  </span>
                ) : (
                  <span className="text-slate-400">Select a variation from the table to proceed</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-secondary" onClick={onClose}>
                  Close
                </button>
                <button
                  type="button"
                  disabled={!chosen}
                  className={`btn text-white transition-all duration-150 active:scale-[0.98] motion-reduce:transform-none ${
                    isSale
                      ? "bg-brand-600 hover:bg-brand-700 hover:shadow-md focus-visible:ring-brand-500"
                      : "bg-slate-900 hover:bg-slate-800 hover:shadow-md focus-visible:ring-slate-700"
                  }`}
                  onClick={() => setTab("form")}
                >
                  Continue with Selected
                </button>
              </div>
            </div>
          ) : (
            // Estimated total with its working (price × quantity) beside the main action, so the
            // line can be checked before it goes into the cart (RMS Tech reference).
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-sm text-slate-500" aria-live="polite">
                {!isCustomerMode && subtotal > 0 ? (
                  <>
                    <div className="text-xs">{isSale ? "Line total" : "Line cost"}</div>
                    <b className="block text-lg leading-tight text-slate-900">{money(subtotal / 100)}</b>
                    <div className="truncate text-xs text-slate-400">
                      {money(Number(price))} × {qty(qtyVal)}
                    </div>
                  </>
                ) : isCustomerMode ? (
                  <span className="text-xs text-slate-500">Ready to add to cart</span>
                ) : (
                  <span className="text-xs">{isSale ? "Enter a selling price" : "Enter a cost"} to see the total</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className={`btn h-11 px-5 text-white sm:h-auto sm:px-3 transition-all duration-150 active:scale-[0.98] motion-reduce:transform-none ${
                    isSale
                      ? "bg-brand-600 hover:bg-brand-700 hover:shadow-md focus-visible:ring-brand-500"
                      : "bg-slate-900 hover:bg-slate-800 hover:shadow-md focus-visible:ring-slate-700"
                  }`}
                  onClick={commit}
                >
                  {edit ? "Update line" : isSale ? "Add to Sales Cart" : "Add to Purchase Cart"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showVendorModal && chosen && (
        <VendorPricingModal
          productId={product.id}
          variationId={chosen.id}
          onClose={() => setShowVendorModal(false)}
          onSaved={() => {
            void reloadRates();
          }}
        />
      )}
    </div>
  );
}

