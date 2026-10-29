"use client";

import { useEffect, useMemo, useState } from "react";
import { useCart, type CartMode } from "@/components/CartContext";
import { DataView } from "@/components/catalog/DataView";
import { ProductThumb } from "@/components/ProductThumb";
import { useViewMode } from "@/lib/useViewMode";
import { money, qty } from "@/lib/format";
import { fmtSellRate } from "@/lib/measure";
import { useApi } from "@/lib/useApi";
import type { StockProduct, StockVariation } from "@/lib/types";
import { OptionButtons } from "@/components/cart/OptionButtons";
import { MeasuredDrawer } from "@/components/measure/MeasuredDrawer";
import { useSupplierRates } from "@/lib/useSupplierRates";
import { useCan } from "@/components/MeContext";
import { VendorPricingModal } from "@/components/vendor/VendorPricingModal";
import { RupeeIcon } from "@/components/icons";

export function ProductOptionsPage({
  productId,
  mode,
  onClose,
}: {
  productId: string;
  mode: CartMode;
  onClose: () => void;
}) {
  const { data } = useApi<{ product: StockProduct }>(`/inventory/products/${productId}`);
  const product = data?.product ?? null;

  if (!product) return <div className="card p-4 text-sm text-slate-500">Loading product…</div>;
  // Measured products (V2 plan §2.7–2.8): length + cut plan for sales, typed rolls for purchases.
  if (product.productType === "measured") {
    return <MeasuredDrawer product={product} mode={mode} onClose={onClose} />;
  }

  return <CountedProductOptionsPage product={product} mode={mode} onClose={onClose} />;
}

// Before an option is picked: the lowest to highest selling price over the variations.
const priceRange = (vars: StockVariation[]) => {
  const prices = vars.map((v) => Number(v.salePrice)).filter((n) => n > 0);
  if (!prices.length) return "—";
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`;
};

function CountedProductOptionsPage({
  product,
  mode,
  onClose,
}: {
  product: StockProduct;
  mode: CartMode;
  onClose: () => void;
}) {
  const cart = useCart();
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

  // Nothing is picked up front (owner 2026-10-27) unless there is only one variation.
  const [pick, setPick] = useState<Record<string, string>>(() =>
    product.productType === "variable" && active.length === 1 ? { ...active[0].attributes } : {},
  );

  const [quantity, setQuantity] = useState(1);
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");
  const [view, setView] = useViewMode("cart.variations", "grid");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showVendorModal, setShowVendorModal] = useState(false);

  const chosen = product.productType === "variable"
    ? active.find((v) => product.attributes.every((a) => (v.attributes[a.name] ?? "") === (pick[a.name] ?? "")))
    : active[0] ?? product.variations[0];

  const sug = chosen ? suggestions.get(chosen.id) : undefined;

  // No price prefill (owner, 2026-10-20): the price is typed or picked from a price chip.
  // A new variation starts empty so another variation's price is never carried over.
  useEffect(() => {
    setPrice("");
  }, [chosen?.id]);

  const commit = () => {
    if (!chosen) {
      setError("Choose an option first.");
      return;
    }
    const value = price.trim();
    if (!/^\d{1,10}$/.test(value)) {
      setError("Enter a whole rupee price.");
      return;
    }
    const attributeUnits = Object.fromEntries(
      product.attributes.filter((a) => !a.isQuality && !!a.unit).map((a) => [a.name, a.unit!]),
    ) as Record<string, string>;
    const line = {
      variationId: chosen.id,
      productId: product.id,
      productName: product.name,
      shortName: chosen.shortName,
      attributes: chosen.attributes,
      attributeUnits,
      unit: product.unit,
      imageUrl: chosen.imageUrl ?? product.imageUrl,
      price: value,
      quantity,
      available: chosen.quantity,
    };
    const blocked = cart.add(mode, line);
    if (blocked) {
      setError(blocked);
      return;
    }
    onClose();
  };

  const image = selectedImage ?? (chosen?.imageUrl ?? product.imageUrl);
  const gallery = [product.imageUrl, ...(product.gallery ?? [])].filter(Boolean) as string[];

  return (
    <div className="card grid gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="btn-secondary" onClick={onClose}>Back</button>
      </div>
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="grid gap-2">
          <ProductThumb src={image} name={product.name} className="aspect-square w-full rounded-xl" />
          {gallery.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {gallery.map((src, index) => (
                <button
                  key={`${src}-${index}`}
                  type="button"
                  onClick={() => setSelectedImage(src)}
                  className={`h-12 w-12 overflow-hidden rounded-md border ${image === src ? "border-brand-500 ring-2 ring-brand-500/20" : "border-slate-200"}`}
                >
                  <ProductThumb src={src} name={product.name} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              {product.productType === "variable" ? "Variable product" : "Simple product"}
            </div>
            <h2 className="text-2xl font-bold text-slate-900">{product.name}</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xl font-bold text-brand-700" title={isSale ? "Selling price" : "Cost / Supplier rate"}>
              {isSale ? (
                chosen ? fmtSellRate(null, chosen.minSalePrice, chosen.salePrice, "Sell: ") : priceRange(active)
              ) : (
                sug?.supplierRate ? (
                  <span>{money(sug.supplierRate)} <span className="text-xs font-normal text-slate-500">({cart.party?.name ?? "supplier"})</span></span>
                ) : chosen && Number(chosen.purchaseCost) > 0 ? (
                  <span>{money(chosen.purchaseCost)} <span className="text-xs font-normal text-slate-500">(cost)</span></span>
                ) : "—"
              )}
            </div>
            <div className="text-sm text-slate-500">
              {chosen ? `${qty(chosen.quantity)} ${product.unit} in stock` : `${qty(product.quantity)} ${product.unit} in stock`}
            </div>
          </div>
          {product.productType === "variable" && (
            <OptionButtons
              attributes={product.attributes}
              active={active}
              picks={pick}
              onChange={(name, value) => {
                // Tapping the picked value again clears it.
                setPick((prev) => {
                  const next = { ...prev };
                  if (next[name] === value) delete next[name];
                  else next[name] = value;
                  return next;
                });
                setError("");
              }}
            />
          )}
          {product.productType === "variable" && !chosen && (
            <div className="text-xs text-amber-700">
              Choose {product.attributes.filter((a) => !pick[a.name] && active.some((v) => v.attributes[a.name])).map((a) => a.name).join(", ") || "another combination"}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50">
              <button type="button" className="px-3 py-2 text-lg" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button>
              <span className="min-w-10 text-center font-semibold">{quantity}</span>
              <button type="button" className="px-3 py-2 text-lg" onClick={() => setQuantity((q) => q + 1)}>+</button>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <span>{isSale ? "Selling price" : "Cost"} ₹</span>
              <input
                aria-label="Price"
                type="text"
                inputMode="numeric"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                }}
                className="input w-28"
              />
            </label>
          </div>

          {isPurchase && canViewVendor && chosen && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-medium text-slate-500">Supplier rates:</span>
              {supplierId ? (
                sug?.supplierRate ? (
                  <button
                    type="button"
                    className={`rounded-full border px-2.5 py-0.5 transition-colors cursor-pointer ${
                      price === String(Math.round(Number(sug.supplierRate)))
                        ? "border-emerald-500 bg-emerald-50 text-emerald-800 font-medium"
                        : "border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100"
                    }`}
                    onClick={() => {
                      setPrice(String(Math.round(Number(sug.supplierRate))));
                    }}
                    title={`Use rate from ${cart.party?.name}`}
                  >
                    {cart.party?.name} {money(sug.supplierRate)} (this supplier)
                  </button>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-500">
                    No rate for {cart.party?.name}
                  </span>
                )
              ) : (
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-800 border border-amber-200">
                  Choose the supplier in the cart to see their rate
                </span>
              )}

              {sug?.cheapest && (!sug.supplierRate || sug.cheapest.supplierId !== supplierId) && (() => {
                const ch = sug.cheapest;
                const multi = (sug.rates?.length ?? 0) > 1;
                return (
                  <button
                    type="button"
                    className={`rounded-full border px-2.5 py-0.5 transition-colors cursor-pointer ${
                      price === String(Math.round(Number(ch.rate)))
                        ? "border-emerald-500 bg-emerald-50 text-emerald-800 font-medium"
                        : "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                    onClick={() => {
                      setPrice(String(Math.round(Number(ch.rate))));
                    }}
                    title={multi ? `Use best rate from ${ch.supplierName}` : `Use rate from ${ch.supplierName}`}
                  >
                    {multi ? `Best ${money(ch.rate)} (${ch.supplierName})` : `${ch.supplierName} ${money(ch.rate)}`}
                  </button>
                );
              })()}

              {Number(chosen.purchaseCost) > 0 && (
                <button
                  type="button"
                  className={`rounded-full border px-2.5 py-0.5 transition-colors cursor-pointer ${
                    price === String(Number(chosen.purchaseCost))
                      ? "border-emerald-500 bg-emerald-50 text-emerald-800 font-medium"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                  onClick={() => {
                    setPrice(String(Number(chosen.purchaseCost)));
                  }}
                  title="Use default purchase cost"
                >
                  Default cost {money(chosen.purchaseCost)}
                </button>
              )}

              {canManageVendor && (
                <button
                  type="button"
                  className="ml-auto inline-flex items-center gap-1 font-semibold text-brand-600 hover:text-brand-700 hover:underline cursor-pointer"
                  onClick={() => setShowVendorModal(true)}
                >
                  <RupeeIcon className="h-3.5 w-3.5" />
                  <span>Edit rates</span>
                </button>
              )}
            </div>
          )}

          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button type="button" className="btn-primary w-fit" onClick={commit}>Add to Cart</button>
        </div>
      </div>

      <div className="border-t border-slate-200 pt-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">All options</h3>
          <div className="flex items-center gap-2">
            <button type="button" className={view === "grid" ? "btn-secondary" : "btn-secondary opacity-70"} onClick={() => setView("grid")}>Grid</button>
            <button type="button" className={view === "table" ? "btn-secondary" : "btn-secondary opacity-70"} onClick={() => setView("table")}>Table</button>
          </div>
        </div>
        <DataView
          rows={product.variations}
          view={view}
          rowKey={(row) => row.id}
          label="Variations"
          onOpen={(row) => {
            setPick({ ...row.attributes });
          }}
          renderCard={(row) => {
            const vSug = suggestions.get(row.id);
            return (
              <button
                type="button"
                onClick={() => {
                  setPick({ ...row.attributes });
                }}
                className="card flex h-full min-h-[120px] w-full flex-col gap-2 p-3 text-left hover:border-brand-500 transition-colors"
              >
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>{row.shortName}</span>
                  <span>{qty(row.quantity)}</span>
                </div>
                <div className="font-semibold text-slate-900">
                  {isSale ? (
                    fmtSellRate(null, row.minSalePrice, row.salePrice, "Sell: ")
                  ) : (
                    vSug?.supplierRate ? (
                      `${money(vSug.supplierRate)} (rate)`
                    ) : Number(row.purchaseCost) > 0 ? (
                      `${money(row.purchaseCost)} (cost)`
                    ) : "—"
                  )}
                </div>
                <div className="text-xs text-slate-500">{Object.values(row.attributes).join(" / ") || "Single option"}</div>
              </button>
            );
          }}
          columns={[
            { id: "variation", header: <span>Variation</span>, cell: (row) => <td>{row.shortName}</td> },
            { id: "stock", header: <span>Stock</span>, cell: (row) => <td>{qty(row.quantity)}</td> },
            {
              id: "price",
              header: <span className="text-right">{isSale ? "Selling Price" : "Supplier Rate / Cost"}</span>,
              align: "right",
              cell: (row) => {
                const vSug = suggestions.get(row.id);
                return (
                  <td className="text-right">
                    {isSale ? (
                      fmtSellRate(null, row.minSalePrice, row.salePrice, "Sell: ")
                    ) : (
                      vSug?.supplierRate ? (
                        <div>
                          <span className="font-semibold">{money(vSug.supplierRate)}</span>
                          {cart.party?.name && <span className="block text-[10px] text-sky-600">{cart.party.name}</span>}
                        </div>
                      ) : Number(row.purchaseCost) > 0 ? (
                        money(row.purchaseCost)
                      ) : "—"
                    )}
                  </td>
                );
              },
            },
          ]}
          empty={<div className="card p-4 text-sm text-slate-500">No variations available.</div>}
        />
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
