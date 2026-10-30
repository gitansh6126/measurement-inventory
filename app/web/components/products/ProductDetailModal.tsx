"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCan } from "@/components/MeContext";
import { ProductThumb } from "@/components/ProductThumb";
import { Modal, Segmented, TableSkeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, formatVariationAttributes, formatVariationAttributesString, money, qty, variationLabel } from "@/lib/format";
import { KIND_LABEL, fmtLen, fmtRate, fmtSellRate, metaOf, type ProductPieces } from "@/lib/measure";
import { VendorPricingModal } from "@/components/vendor/VendorPricingModal";
import type { Movement, StockProduct, StockVariation } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useLengthView } from "@/lib/lengthView";
import { useCustomerMode } from "@/components/CustomerModeContext";

function RollStrip({ product }: { product: StockProduct }) {
  useLengthView();
  const { data } = useApi<ProductPieces>(`/measure/products/${product.id}/pieces`);
  if (!data) return null;
  const meta = metaOf(data.product);
  return (
    <div className="mt-4 rounded-lg border border-slate-200">
      <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Measured · {meta.lengthUnit === "m" ? "metres" : "feet + inches"}
        {data.product.defaultRollLength ? ` · default ${(meta.rollName || "roll").toLowerCase()} ${fmtLen(data.product.defaultRollLength, meta)}` : ""}
        {meta.scrapBelow ? ` · scrap < ${fmtLen(meta.scrapBelow, meta)}` : ""}
      </div>
      {data.variations.map((v) => (
        <div key={v.id} className="flex gap-3 border-b border-slate-100 px-3 py-1.5 text-sm last:border-b-0">
          <span className="w-28 shrink-0 font-medium">{variationLabel(v, product.attributes) || v.shortName}</span>
          <span className="flex flex-wrap gap-1">
            {v.pieces.length === 0 ? <span className="text-slate-400">No rolls</span> : v.pieces.map((p) => (
              <Link key={p.id} href={`/inventory/rolls/${p.id}`} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs hover:bg-brand-50">
                {KIND_LABEL[p.kind]} {fmtLen(p.remainingLength, meta)}
              </Link>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

// main v2 ProductDetailModal: a read surface with two tabs — Details and Action Log.
// For a variable product a picker selects the variation shown; the log spans all of them.

export const MOVEMENT_LABEL: Record<Movement["type"], string> = {
  OPENING: "Opening",
  PURCHASE: "Purchase",
  SALE: "Sale",
  ADJUSTMENT: "Adjustment",
  // V2: reversals written when a sale / purchase is cancelled.
  SALE_VOID: "Sale cancelled",
  PURCHASE_VOID: "Purchase cancelled",
  // V3.1 shifts between warehouses.
  TRANSFER_OUT: "Shifted out",
  TRANSFER_IN: "Shifted in",
  TRANSFER_VOID: "Shift cancelled",
};

export function ProductDetailModal({
  // hooks

  product,
  initialVariationId,
  onClose,
  onEdit,
}: {
  product: StockProduct | null;
  initialVariationId?: string;
  onClose: () => void;
  onEdit?: () => void;
}) {
  useLengthView();
  const { isCustomerMode } = useCustomerMode();
  const router = useRouter();
  const canViewCost = useCan("inventory.configure");
  const canEdit = useCan("product.write");
  const canViewPurchases = useCan("purchase.view");
  const canViewSales = useCan("sale.view");
  const canViewVendor = useCan("vendor_pricing.view");
  const [tab, setTab] = useState<"details" | "log">("details");
  const [shownId, setShownId] = useState<string>("");
  const [log, setLog] = useState<(Movement & { variation: string })[] | null>(null);
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const vendorRatesApi = useApi<{ prices: any[] }>(
    product && canViewVendor ? `/vendor-prices?productId=${product.id}` : null
  );

  useEffect(() => {
    setTab("details");
    setShownId(initialVariationId ?? product?.variations[0]?.id ?? "");
    setLog(null);
  }, [product, initialVariationId]);

  useEffect(() => {
    if (!product || tab !== "log" || log) return;
    Promise.all(
      product.variations.map((v) =>
        api<{ movements: Movement[] }>(`/inventory/variations/${v.id}/movements?pageSize=200`).then((r) =>
          r.movements.map((m) => ({ ...m, variation: variationLabel(v, product.attributes) }))
        ),
      ),
    ).then((all) => setLog(all.flat().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))), () => setLog([]));
  }, [product, tab, log]);

  if (!product) return null;
  const v: StockVariation | undefined = product.variations.find((x) => x.id === shownId) ?? product.variations[0];
  const variable = product.productType !== "simple";
  const varLabel = v ? variationLabel(v, product.attributes) : "";
  const attrBadges = v ? formatVariationAttributes(v.attributes, product.attributes) : [];

  const getDocHref = (m: Movement) => {
    const doc = m.document;
    if (!doc?.id) return null;
    const origin = `?from=product:${product.id}&fromName=${encodeURIComponent(product.name)}`;
    if (doc.kind === "sale" && canViewSales) return `/sales/${doc.id}${origin}`;
    if (doc.kind === "purchase" && canViewPurchases) return `/purchases/${doc.id}${origin}`;
    if (doc.kind === "transfer") return `/shifts/${doc.id}`;
    return null;
  };

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );

  return (
    <Modal
      open
      wide
      title={
        variable && varLabel ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>{product.name}</span>
            <span className="inline-flex items-center rounded-md border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 shadow-sm">
              {varLabel}
            </span>
          </div>
        ) : (
          product.name
        )
      }
      onClose={onClose}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            { value: "details", label: "Details" },
            { value: "log", label: "Action Log" },
          ]}
        />
        {variable && tab === "details" && (
          <div className="flex items-center gap-2">
            <label htmlFor="detail-variation-picker" className="text-xs font-semibold text-slate-500">
              Variation:
            </label>
            <select
              id="detail-variation-picker"
              className="input w-auto font-medium border-brand-300 focus:border-brand-500 focus:ring-brand-500"
              value={v?.id}
              onChange={(e) => setShownId(e.target.value)}
              aria-label="Variation"
            >
              {product.variations.map((x) => (
                <option key={x.id} value={x.id}>{variationLabel(x, product.attributes)}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {tab === "details" && v && (
        <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
          <ProductThumb src={v.imageUrl ?? product.imageUrl} name={product.name} className="aspect-square w-36 rounded-lg" />
          <div>
            {row("Category", product.category?.name ?? "—")}
            {variable && varLabel && row(
              "Variation",
              <span className="inline-flex items-center rounded-md border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-bold text-brand-700 shadow-sm">
                {varLabel}
              </span>,
            )}
            {!isCustomerMode && row("Selling Price", fmtSellRate(product.measure?.lengthUnit, v.minSalePrice, v.salePrice, "Sell: "))}
            {canViewCost && row("Purchasing Price", Number(v.purchaseCost) > 0 ? fmtRate(product.measure?.lengthUnit, v.purchaseCost) : "—")}
            {product.productType !== "measured" && row(
              "Stock on Hand",
              <span className={v.state === "ok" ? "text-emerald-600" : "text-rose-600"}>
                {qty(v.quantity)} {product.unit}
                {v.state !== "ok" ? " (Low!)" : ""}
              </span>,
            )}
            {!isCustomerMode && row("Minimum Stock Level", v.lowStockThreshold)}


            {row(
              "Sales activity",
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                product.activityStatus === "Active" ? "bg-emerald-100 text-emerald-700" :
                product.activityStatus === "Min-Active" ? "bg-amber-100 text-amber-800" :
                product.activityStatus === "Inactive" ? "bg-slate-200 text-slate-700" : "bg-violet-100 text-violet-700"
              }`}>
                {product.activityStatus}
              </span>,
            )}
            {row("Last completed sale", product.lastSaleAt ? dateTime(product.lastSaleAt) : "Never sold")}
            {variable && row(
              "Attributes",
              attrBadges.length > 0 ? (
                <div className="flex flex-wrap justify-end gap-1">
                  {attrBadges.map((item) => (
                    <span key={item.name} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-700">
                      {item.name}: <b>{item.formatted}</b>
                    </span>
                  ))}
                </div>
              ) : (
                formatVariationAttributesString(v.attributes, product.attributes)
              ),
            )}
            {product.description && <p className="mt-2 text-sm text-slate-600">{product.description}</p>}

            {canViewVendor && (
              <div className="mt-4 rounded-lg border border-slate-200 p-3 bg-white">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Supplier rates {v ? `(${variationLabel(v, product.attributes) || v.shortName})` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => setVendorModalOpen(true)}
                    className="btn-secondary text-xs py-1 px-2.5"
                  >
                    Vendor pricing
                  </button>
                </div>
                {vendorRatesApi.loading ? (
                  <TableSkeleton rows={2} />
                ) : (() => {
                  const matchingRates = (vendorRatesApi.data?.prices ?? []).filter((r: any) =>
                    v ? r.variationId === v.id : true
                  );
                  if (matchingRates.length === 0) {
                    return <p className="text-xs text-slate-400 italic">No supplier rates recorded for this variation.</p>;
                  }
                  const activeMatching = matchingRates.filter((r: any) => r.active);
                  const bestRate = activeMatching.length > 1 ? Math.min(...activeMatching.map((r: any) => Number(r.rate))) : null;

                  return (
                    <div className="overflow-x-auto">
                      <table className="table text-xs">
                        <thead>
                          <tr>
                            <th>Supplier</th>
                            <th className="text-right">Rate</th>
                            <th>Updated</th>
                            <th className="text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {matchingRates.map((r: any) => {
                            const isBest = r.active && bestRate !== null && Number(r.rate) === bestRate;
                            return (
                              <tr key={r.id}>
                                <td className="font-medium text-slate-800">
                                  {r.supplierName}
                                  {isBest && (
                                    <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800 uppercase">
                                      BEST
                                    </span>
                                  )}
                                </td>
                                <td className="text-right font-semibold text-slate-900">{fmtRate(product.measure?.lengthUnit, r.rate)}</td>
                                <td className="text-slate-400 text-[11px]">{r.effectiveAt ? dateTime(r.effectiveAt) : "—"}</td>
                                <td className="text-center">
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
                                    {r.active ? "Active" : "Paused"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}
      {tab === "details" && product.productType === "measured" && <RollStrip product={product} />}

      {tab === "log" &&
        (!log ? (
          <TableSkeleton rows={4} />
        ) : log.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No stock activity yet.</p>
        ) : (
          <div className="table-scroll table-container max-h-[50vh] overflow-auto">
            <table className="table table-stack table-sticky-0">
              <thead>
                <tr>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Date</th>
                  {variable && <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Variation</th>}
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Action</th>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] text-right">Change</th>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] text-right">Balance</th>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Details</th>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">By</th>
                </tr>
              </thead>
              <tbody>
                {log.map((m) => {
                  const href = getDocHref(m);
                  return (
                    <tr
                      key={m.id}
                      onClick={(e) => {
                        if (!href) return;
                        if ((e.target as HTMLElement).closest("a, button")) return;
                        onClose();
                        router.push(href);
                      }}
                      className={href ? "cursor-pointer transition-colors hover:bg-brand-50/40" : undefined}
                    >
                      <td className="whitespace-nowrap text-slate-500">{dateTime(m.occurredAt)}</td>
                      {variable && (
                        <td>
                          <span className="inline-block rounded border border-brand-100 bg-brand-50/60 px-1.5 py-0.5 text-xs font-medium text-brand-900">
                            {m.variation}
                          </span>
                        </td>
                      )}
                      <td>
                        {MOVEMENT_LABEL[m.type]}
                        {m.warehouseCode && <span className="ml-1 rounded bg-slate-100 px-1 text-[11px] text-slate-600">{m.warehouseCode}</span>}
                      </td>
                      <td className={`text-right font-semibold ${m.quantity > 0 ? "text-emerald-700" : "text-rose-600"}`}>
                        {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                      </td>
                      <td className="text-right">{m.balanceAfter}</td>
                      <td className="text-slate-600">
                        {href ? (
                          <Link
                            href={href}
                            onClick={() => onClose()}
                            className="font-medium text-brand-700 underline decoration-brand-300 hover:text-brand-900 hover:decoration-brand-700"
                            title={`Open ${m.type.startsWith("PURCHASE") ? "purchase" : "sale"} details`}
                          >
                            {m.document?.number ?? m.reason ?? "View record"}
                          </Link>
                        ) : (
                          m.reason ?? "—"
                        )}
                        {m.rate ? ` @ ${money(m.rate)}${m.rateUnit && m.rateUnit !== m.unit ? ` / ${m.rateUnit}` : ""}` : ""}
                      </td>
                      <td className="text-slate-500">{m.actor ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

      {canEdit && (
        <div className="mt-4 flex justify-end border-t border-slate-100 pt-3">
          <Link href={`/products/${product.id}/edit?returnTo=products`} className="btn-secondary" onClick={onClose}>
            Edit product
          </Link>
        </div>
      )}
      {vendorModalOpen && (
        <VendorPricingModal
          productId={product.id}
          variationId={v?.id}
          onClose={() => {
            setVendorModalOpen(false);
            void vendorRatesApi.reload();
          }}
          onSaved={() => void vendorRatesApi.reload()}
        />
      )}
    </Modal>
  );
}
