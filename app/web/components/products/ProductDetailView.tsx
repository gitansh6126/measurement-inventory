"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DataView } from "@/components/catalog/DataView";
import { ViewToggle } from "@/components/catalog/ViewToggle";
import { OptionButtons } from "@/components/cart/OptionButtons";
import { useCan } from "@/components/MeContext";
import { ProductThumb } from "@/components/ProductThumb";
import { VariationTabs } from "@/components/products/VariationTabs";
import { MOVEMENT_LABEL } from "@/components/products/ProductDetailModal";
import { VendorPricingModal } from "@/components/vendor/VendorPricingModal";
import { StockBadge } from "@/components/StockBadge";
import { WarehouseStockChips } from "@/components/cart/TakeFromPopup";
import { MeasuredStockPanel } from "@/components/measure/MeasuredStock";
import { SetsPanel } from "@/components/sets/SetsPanel";
import { SetTypesPriceRange, setTypeName, useSetTypes } from "@/components/sets/SetTypes";
import { Alert, Modal, PageHeader, TableSkeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, formatVariationAttributes, money, qty, variationLabel } from "@/lib/format";
import type { Movement, StockProduct, StockVariation } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { useViewMode } from "@/lib/useViewMode";
import { variationAttributeColumns } from "@/lib/variationColumns";
import { fmtLen, fmtLenSigned, fmtRate, fmtSellRate, metaOf, type LengthUnit } from "@/lib/measure";
import { BundleHistory } from "@/components/measure/BundleHistory";
import { useLengthView } from "@/lib/lengthView";

// Single-product page (catalog browse §2.2, owner reference image 2 — Crossbee): image carousel
// with dots, name, price, one row of option buttons per attribute; then details, measurements,
// stock, every variation (Grid | Table) and the stock movement history. Shared by
// /products/[id] and /inventory/[id] so both list screens open the same page.
//
// Product hub (owner spec 2026-10-28): read-only stock and prices; changes go through Stock In
// ("Manage stock & prices", with its reason and warehouse), never an inline adjust form here.

type ProductMovement = Omit<Movement, "type"> & {
  type: Movement["type"];
  variation: { id: string; shortName: string; attributes: Record<string, string> };
  document: { kind: "sale" | "purchase" | "transfer"; id: string; number: string | null } | null;
  // V3.1: the warehouse the movement was in (null while warehousing is off).
  warehouseCode?: string | null;
};

// Measured rates are per m, or per ft on a feet + inches product (0028): `per` is " / ft" etc.
const priceText = (v: StockVariation, lu?: LengthUnit | null) =>
  fmtSellRate(lu, v.minSalePrice, v.salePrice, "Sell: ");

// (No range text shown for products with variations)
const rangeText = (vars: StockVariation[], lu?: LengthUnit | null) => {
  const prices = vars.map((v) => Number(v.salePrice)).filter((n) => n > 0);
  if (!prices.length) return "—";
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return lo === hi ? fmtRate(lu, lo) : fmtRate(lu, lo, hi);
};

export function ProductDetailView({ productId, back }: { productId: string; back: { href: string; label: string } }) {
  useLengthView();
  const canEdit = useCan("product.write");
  const canAdjust = useCan("stock.adjust");
  const canViewCost = useCan("inventory.configure");
  // Stock In needs stock.adjust or inventory.configure (prices / minimum stock).
  const canManageStock = canAdjust || canViewCost;
  const canViewVendor = useCan("vendor_pricing.view");
  const { data, error, reload } = useApi<{ product: StockProduct }>(`/inventory/products/${productId}`);
  const product = data?.product ?? null;
  const per = product?.measure?.lengthUnit;

  const [pick, setPick] = useState<Record<string, string>>({});
  const [slide, setSlide] = useState(0);
  const [view, setView] = useViewMode("product.variations", "grid");
  const [tableFilteredIds, setTableFilteredIds] = useState<string[] | null>(null);
  const [tableFilters, setTableFilters] = useState<Record<string, string>>({});
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [stockHistoryOpen, setStockHistoryOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  // Measured products open on the per-bundle timeline (owner 2026-10-24).
  const [historyTab, setHistoryTab] = useState<"bundles" | "movements">("bundles");
  const isMeasured = product?.productType === "measured";
  const showBundles = isMeasured && historyTab === "bundles";
  const history = useApi<{ movements: ProductMovement[]; total: number }>(
    stockHistoryOpen && !showBundles ? `/inventory/products/${productId}/movements?page=${historyPage}&pageSize=20` : null,
  );
  const lenMeta = product?.measure ? metaOf(product.measure) : null;
  // Measured quantities are lengths in the base unit (shown in the product's unit).
  const qtyText = (v: number, signed = false) => (lenMeta ? (signed ? fmtLenSigned(v, lenMeta) : fmtLen(v, lenMeta)) : signed && v > 0 ? `+${v}` : String(v));

  // Nothing is picked up front (owner 2026-10-27); a single-variation product shows that one.
  useEffect(() => {
    if (!product) return;
    setPick(product.variations.length === 1 ? { ...product.variations[0].attributes } : {});
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const allVars = useMemo(() => product?.variations ?? [], [product]);
  const isGroup = product?.productType === "variable" || product?.productType === "measured";
  const chosen: StockVariation | undefined = product
    ? isGroup
      ? product.variations.find((v) => product.attributes.every((a) => (v.attributes[a.name] ?? "") === (pick[a.name] ?? "")))
      : product.variations[0]
    : undefined;

  const images = useMemo(() => {
    if (!product) return [] as string[];
    const list = [chosen?.imageUrl, product.imageUrl, ...(product.gallery ?? [])].filter(Boolean) as string[];
    return [...new Set(list)];
  }, [product, chosen?.imageUrl]);
  useEffect(() => setSlide(0), [chosen?.id]);

  // Sticky mini bar (RMS Tech reference, owner 2026-10-28): once the hero's name and price scroll
  // under the top bar, a compact bar with thumbnail, name, option and price pins below it.
  const heroRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = heroRef.current;
    if (!el) return;
    // 64 px = the sticky app header (top-7 + h-9).
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting && e.boundingClientRect.top < 64), { rootMargin: "-64px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [product?.id]);

  if (error) return <Alert message={error} />;
  if (!product) return <TableSkeleton rows={6} />;

  const variable = isGroup;
  // V3.1: a grouped product's "stock" is its sets in stock (Sets panel below).
  const grouped = product.productType === "grouped";
  const stockUnit = grouped ? "sets" : product.unit;
  // Attributes with a unit (size, capacity, length…) are measurements; the rest are plain options.
  const attributeItems = chosen ? formatVariationAttributes(chosen.attributes, product.attributes) : [];
  const isMeasure = (name: string) => product.attributes.some((a) => a.name === name && !a.isQuality && !!a.unit);
  const measurements = attributeItems.filter((item) => isMeasure(item.name));
  const otherAttributes = attributeItems.filter((item) => !isMeasure(item.name));
  const low = allVars.filter((v) => v.state === "low").length;
  const out = allVars.filter((v) => v.state === "out" || v.state === "negative").length;
  const selectVariation = (v: StockVariation) => {
    setPick({ ...v.attributes });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const stockHref = `/inventory?focus=${product.id}`;
  const row = (label: string, value: React.ReactNode) => (
    <div key={label} className="flex justify-between gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );

  return (
    <div className="grid gap-4">
      {/* h-0 + -mb-4 keep the page from moving when the bar shows; it overlays the content. */}
      <div className="no-print sticky top-0 z-20 -mb-4 h-0">
        <div
          aria-hidden={!compact}
          className={`-mx-4 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2 shadow-sm backdrop-blur transition duration-200 sm:mx-0 sm:rounded-b-xl sm:border-x ${compact ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0"}`}
        >
          <ProductThumb src={images[0] ?? null} name={product.name} className="h-10 w-10 shrink-0 rounded-md border border-slate-200 object-contain text-[8px]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold uppercase tracking-wide text-slate-900" title={product.name}>{product.name}</div>
            <div className="truncate text-xs text-slate-500">
              {/* Phones: the price sits here so the name keeps the full width. */}
              <span className="font-bold text-slate-900 sm:hidden">{grouped ? <SetTypesPriceRange groupId={product.id} /> : chosen ? priceText(chosen, per) : rangeText(allVars, per)} · </span>
              {variable ? (chosen ? `${variationLabel(chosen, product.attributes)} · ${chosen.shortName}` : "Select options") : (product.category?.name ?? "Uncategorized")}
            </div>
          </div>
          <div className="hidden shrink-0 text-right sm:block">
            <div className="text-sm font-bold text-slate-900">{grouped ? <SetTypesPriceRange groupId={product.id} /> : chosen ? priceText(chosen, per) : rangeText(allVars, per)}</div>
            {chosen && <div><StockBadge quantity={chosen.quantity} state={chosen.state} unit={stockUnit} /></div>}
          </div>
          <button
            type="button"
            tabIndex={compact ? 0 : -1}
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            className="btn-secondary shrink-0 px-2 py-1 text-xs"
          >
            {variable ? "Options ↑" : "Top ↑"}
          </button>
          {canManageStock && (
            <Link href={stockHref} tabIndex={compact ? 0 : -1} className="btn-primary hidden shrink-0 px-2 py-1 text-xs sm:inline-flex">
              Manage stock
            </Link>
          )}
        </div>
      </div>

      <PageHeader
        back={back}
        title={product.name}
        subtitle={[product.category?.name ?? "Uncategorized", variable ? `${allVars.length} variations` : grouped ? "Grouped product (set)" : "Simple product"].join(" · ")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canViewVendor && (
              <button
                type="button"
                onClick={() => setVendorModalOpen(true)}
                className="btn-secondary"
              >
                Vendor pricing
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setHistoryPage(1);
                setStockHistoryOpen(true);
              }}
              className="btn-secondary"
            >
              Stock history
            </button>
            {canManageStock && <Link href={stockHref} className="btn-secondary">Manage stock & prices</Link>}
            {canEdit && <Link href={`/products/${product.id}/edit?returnTo=detail`} className="btn-primary">Edit product</Link>}
          </div>
        }
      />

      {/* Hero: reference image 2 */}
      <div className="card grid gap-5 p-4 md:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="grid gap-2">
          <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white">
            <ProductThumb src={images[slide] ?? null} name={product.name} className="aspect-square w-full object-contain text-2xl" />
            {images.length > 1 && (
              <div className="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
                {images.map((src, i) => (
                  <button
                    key={src}
                    type="button"
                    aria-label={`Image ${i + 1}`}
                    aria-current={i === slide ? "true" : undefined}
                    onClick={() => setSlide(i)}
                    className={`h-2 rounded-full transition-all ${i === slide ? "w-5 bg-brand-600" : "w-2 bg-slate-300 hover:bg-slate-400"}`}
                  />
                ))}
              </div>
            )}
          </div>
          {images.length > 1 && (
            <div className="flex gap-2 overflow-x-auto">
              {images.map((src, i) => (
                <button key={src} type="button" onClick={() => setSlide(i)} className={`h-14 w-14 shrink-0 overflow-hidden rounded-md border ${i === slide ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200"}`}>
                  <ProductThumb src={src} name={product.name} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid content-start gap-4">
          <div>
            <h2 className="text-xl font-bold uppercase tracking-wide text-slate-900 sm:text-2xl">{product.name}</h2>
            {variable && chosen && <div className="mt-1 text-sm text-slate-500">{variationLabel(chosen, product.attributes)} · <span className="font-mono text-xs">{chosen.shortName}</span></div>}
          </div>
          <div ref={heroRef} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-slate-200 pb-4">
            <div className="text-2xl font-bold text-slate-900">
              <span className="text-base font-medium text-slate-500">Price: </span>
              {/* 0041: a grouped product has no own price; the range over its set types. */}
              {grouped ? <SetTypesPriceRange groupId={product.id} /> : chosen ? priceText(chosen, per) : rangeText(allVars, per)}
            </div>
            {chosen && <StockBadge quantity={chosen.quantity} state={chosen.state} unit={stockUnit} />}
            {!chosen && variable && <span className="text-sm text-amber-700">Select options to see price and stock</span>}
          </div>
          {grouped && product.grouped && (
            <p className="text-sm text-slate-600">
              Set of <b>{product.grouped.main?.name}</b>
              {product.grouped.byproducts.map((b) => ` + ${b.name}${b.required ? "" : " (optional)"}`).join("")}
            </p>
          )}

          {variable && (
            <OptionButtons attributes={product.attributes} active={allVars} picks={pick} onChange={(name, value) =>
                setPick((p) => {
                  // Tapping the picked value again clears it.
                  const next = { ...p };
                  if (next[name] === value) delete next[name];
                  else next[name] = value;
                  return next;
                })
              } />
          )}

        </div>
      </div>

      {/* Details · Measurements · Stock */}
      <div className={`grid gap-4 ${attributeItems.length > 0 ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
        <section className="card p-4">
          <h3 className="mb-2 font-semibold text-slate-900">Details</h3>
          {row("Category", product.category?.name ?? "—")}
          {/* V3.1: categories under other heads, one row per head; 0038: "Marine (12 mm, 16 mm)" when
              on some variations only, the chosen variation's ones in bold. */}
          {[...new Set([...(product.categories ?? []), ...(product.variationCategories ?? [])].map((c) => c.headName))].map((head) =>
            row(
              head,
              <span>
                {[
                  ...(product.categories ?? []).filter((c) => c.headName === head).map((c) => ({ id: c.id, name: c.name, only: null as string[] | null })),
                  ...(product.variationCategories ?? [])
                    .filter((c) => c.headName === head)
                    .map((c) => ({
                      id: c.id,
                      name: c.name,
                      only: product.variations.filter((v) => v.active && c.variationIds.includes(v.id)).map((v) => variationLabel(v, product.attributes)),
                    })),
                ].map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && ", "}
                    <span className={c.only && chosen?.categoryIds?.includes(c.id) ? "font-semibold text-violet-700" : undefined}>{c.name}</span>
                    {c.only && <span className="text-xs text-slate-500"> ({c.only.join(", ")})</span>}
                  </span>
                ))}
              </span>,
            ),
          )}
          {row("Type", product.productType === "measured" ? "Measured" : grouped ? "Grouped (set)" : variable ? "Variable" : "Simple")}
          {row("Unit", product.unit)}
          {/* Grouped (set) products never show a short name or SKU (owner, 2026-10-22). */}
          {chosen && !grouped && row("Short name", <span className="font-mono text-xs">{chosen.shortName}</span>)}
          {chosen?.officialSku && !grouped && row("SKU", <span className="font-mono text-xs">{chosen.officialSku}</span>)}
          {row("Sales activity", product.activityStatus)}
          {row("Last completed sale", product.lastSaleAt ? dateTime(product.lastSaleAt) : "Never sold")}
          {(chosen?.description || product.description) && <p className="mt-2 text-sm text-slate-600">{chosen?.description || product.description}</p>}
        </section>

        {attributeItems.length > 0 && (
        <section className="card p-4">
          <h3 className="mb-2 font-semibold text-slate-900">Measurements & attributes</h3>
          {measurements.map((item) => row(item.name, item.formatted))}
          {otherAttributes.length > 0 && measurements.length > 0 && <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Attributes</div>}
          {otherAttributes.map((item) => row(item.name, item.formatted))}
        </section>
        )}

        <section className="card p-4">
          <h3 className="mb-2 font-semibold text-slate-900">Stock & prices</h3>
          {grouped && <SetTypePrices groupId={product.id} row={row} />}
          {chosen && !grouped && (
            <>
              {row(grouped ? "Sets in stock" : (chosen.inSets ?? 0) > 0 ? "Free stock" : "Stock on hand", <StockBadge quantity={chosen.quantity} state={chosen.state} unit={stockUnit} />)}
              {!grouped && (chosen.inSets ?? 0) > 0 && row("In sets", `${qty(chosen.inSets!)} ${product.unit}`)}
              {/* V3.1: per-warehouse stock (absent while warehousing is off). */}
              {!grouped && chosen.byWarehouse && row("In warehouses", chosen.byWarehouse.some((w) => w.quantity !== 0) ? <WarehouseStockChips rows={chosen.byWarehouse} /> : "—")}
              {row("Minimum stock", chosen.lowStockThreshold)}
              {row("Selling price", fmtSellRate(per, chosen.minSalePrice, chosen.salePrice, "Sell: "))}
              {canViewCost && row("Purchasing price", Number(chosen.purchaseCost) > 0 ? fmtRate(per, chosen.purchaseCost) : "—")}
            </>
          )}
          {variable && row("Total stock", `${qty(product.quantity)} ${product.unit}`)}
          {variable && (low > 0 || out > 0) && row("Low / out", `${low} low · ${out} out`)}
          <div className="mt-2 grid gap-2 border-t border-slate-100 pt-2">
            {canManageStock && <Link href={stockHref} className="btn-secondary w-full text-xs">Change stock or prices on Stock In</Link>}
            <button
              type="button"
              onClick={() => {
                setHistoryPage(1);
                setStockHistoryOpen(true);
              }}
              className="btn-secondary w-full text-xs"
            >
              View stock history
            </button>
          </div>
        </section>
      </div>

      {/* Variations: Grid | Table of the same rows; tapping one sets the option buttons. */}
      {variable && (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-900">Variations <span className="text-sm font-normal text-slate-500">{product.variations.length}</span></h3>
            <ViewToggle value={view} onChange={setView} />
          </div>
          <DataView<StockVariation>
            rows={product.variations}
            view={view}
            rowKey={(v) => v.id}
            label="Variations"
            containerClassName="card overflow-auto max-h-[60vh]"
            onOpen={selectVariation}
            rowClassName={(v) => (v.id === chosen?.id ? "bg-brand-50" : "")}
            renderCard={(v) => (
              <button
                type="button"
                onClick={() => selectVariation(v)}
                className={`card flex h-full w-full flex-col overflow-hidden text-left transition hover:shadow-md ${v.id === chosen?.id ? "ring-2 ring-brand-500" : ""}`}
              >
                <ProductThumb src={v.imageUrl ?? product.imageUrl} name={product.name} className="aspect-[4/3] w-full text-lg" />
                <div className="grid gap-1 p-3">
                  <div className="text-sm font-semibold text-slate-900">{variationLabel(v, product.attributes)}</div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-mono">{v.shortName}</span>
                    <StockBadge quantity={v.quantity} state={v.state} />
                  </div>
                  <div className="text-sm font-semibold text-brand-700">{priceText(v, per)}</div>
                </div>
              </button>
            )}
            columns={[
              { id: "image", header: "", cell: (v) => <ProductThumb src={v.imageUrl ?? product.imageUrl} name={product.name} className="h-10 w-10 rounded text-[6px]" /> },
              // One column per attribute, its unit in the header ("Size (mm)" → 3).
              ...variationAttributeColumns(product, product.variations).map((c) => ({
                id: `attr:${c.name}`,
                header: c.unit ? `${c.name} (${c.unit})` : c.name,
                cell: (v: StockVariation) => <span className="font-medium text-slate-900">{v.attributes[c.name] ?? "—"}</span>,
              })),
              { id: "short", header: "Short name", cell: (v) => <span className="font-mono text-xs">{v.shortName}</span> },
              { id: "stock", header: "Stock", cell: (v) => <StockBadge quantity={v.quantity} state={v.state} unit={product.unit} /> },
              ...(product.variations.some((v) => v.byWarehouse) ? [{ id: "warehouses", header: "In warehouses", cell: (v: StockVariation) => <WarehouseStockChips rows={v.byWarehouse} /> }] : []),
              { id: "min", header: "Min stock", align: "right", cell: (v) => v.lowStockThreshold },
              { id: "price", header: "Selling price", align: "right", cell: (v) => priceText(v, per) },
              ...(canViewCost ? [{ id: "cost", header: "Cost", align: "right" as const, cell: (v: StockVariation) => (Number(v.purchaseCost) > 0 ? fmtRate(per, v.purchaseCost) : "—") }] : []),
            ]}
          />
        </section>
      )}

      {/* Measured rolls & physical pieces (owner design 2026-10-16): one card per variation with its
          total length and sealed / in-use / cut counts; the chosen variation opens first and its
          pieces show in Cut / Open / Closed columns. */}
      {product.productType === "measured" && (
        <section className="card p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Rolls & Physical Bundles</h3>
              <p className="text-xs text-slate-500">
                Stock is kept as separate physical pieces, each with its own length, never as one pooled number. Open a piece for its record, or cut, open, correct or write it off here.
              </p>
            </div>
            {canManageStock && <Link href={stockHref} className="btn-secondary text-xs">Manage stock & prices ↗</Link>}
          </div>
          <MeasuredStockPanel product={product} focusVariationId={chosen?.id} />
        </section>
      )}

      {/* V3.1 grouped product: its sets */}
      {grouped && <SetsPanel product={product} onChanged={reload} />}

      {/* Stock history section with button to open details */}
      <section className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <h3 className="font-semibold text-slate-900">Stock history</h3>
          <p className="text-xs text-slate-500">
            View transaction logs, purchases, sales, and manual adjustments for this product.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setHistoryPage(1);
            setStockHistoryOpen(true);
          }}
          className="btn-secondary text-xs"
        >
          Open stock history
        </button>
      </section>

      {/* Stock History Modal with fixed header table */}
      {stockHistoryOpen && (
        <Modal
          open
          wide
          xl
          title={`Stock History — ${product.name}`}
          onClose={() => setStockHistoryOpen(false)}
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {isMeasured ? (
                <div className="flex gap-1 rounded-full bg-slate-100 p-1" role="tablist" aria-label="History view">
                  {(
                    [
                      ["bundles", `By ${(product.measure?.rollName || "roll").toLowerCase()}`],
                      ["movements", "Stock movements"],
                    ] as const
                  ).map(([k, t]) => (
                    <button
                      key={k}
                      type="button"
                      role="tab"
                      aria-selected={historyTab === k}
                      onClick={() => setHistoryTab(k)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${historyTab === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-500">Movement log across all variations and inventory transactions.</p>
              )}
              {!showBundles && history.data && (
                <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-full">
                  {history.data.total} movement{history.data.total === 1 ? "" : "s"}
                </span>
              )}
            </div>

            {showBundles ? (
              <BundleHistory
                productId={product.id}
                attributeDefs={product.attributes}
                variations={allVars}
                from={`product:${product.id}&fromName=${encodeURIComponent(product.name)}`}
              />
            ) : !history.data ? (
              <TableSkeleton rows={4} />
            ) : history.data.movements.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No stock activity yet.</p>
            ) : (
              <div className="table-scroll table-container max-h-[60vh] overflow-auto rounded-lg border border-slate-200">
                <table className="table table-sticky-0 text-xs">
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
                    {history.data.movements.map((m) => (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap text-slate-500">{dateTime(m.occurredAt)}</td>
                        {variable && <td className="text-xs font-medium text-slate-800">{variationLabel(m.variation, product.attributes)}</td>}
                        <td>
                          <span className="font-medium text-slate-900">{MOVEMENT_LABEL[m.type] ?? m.type}</span>
                          {m.warehouseCode && <span className="ml-1 rounded bg-slate-100 px-1 text-[11px] text-slate-600">{m.warehouseCode}</span>}
                          {m.document && (
                            <Link
                              className="ml-1 text-xs text-brand-700 hover:underline"
                              href={
                                m.document.kind === "transfer"
                                  ? `/shifts/${m.document.id}`
                                  : `/${m.document.kind === "sale" ? "sales" : "purchases"}/${m.document.id}?from=product:${product.id}&fromName=${encodeURIComponent(product.name)}`
                              }
                            >
                              {m.document.number ?? "Open"}
                            </Link>
                          )}
                        </td>
                        <td className={`text-right font-semibold ${m.quantity > 0 ? "text-emerald-700" : "text-rose-600"}`}>
                          {qtyText(m.quantity, true)}
                        </td>
                        <td className="text-right font-medium text-slate-800">{qtyText(m.balanceAfter)}</td>
                        <td className="text-slate-600">{m.reason ?? "—"}{m.rate ? ` @ ${money(m.rate)}${m.rateUnit && (m.rateUnit !== m.unit || lenMeta) ? ` / ${m.rateUnit}` : ""}` : ""}</td>
                        <td className="text-slate-500">{m.actor ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!showBundles && history.data && history.data.total > 20 && (
              <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
                <span className="text-slate-500">
                  Showing {(historyPage - 1) * 20 + 1}–{Math.min(historyPage * 20, history.data.total)} of {history.data.total}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary py-1 text-xs"
                    disabled={historyPage <= 1}
                    onClick={() => setHistoryPage((p) => p - 1)}
                  >
                    Newer
                  </button>
                  <span className="text-slate-600 font-medium">
                    Page {historyPage} of {Math.ceil(history.data.total / 20)}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary py-1 text-xs"
                    disabled={historyPage * 20 >= history.data.total}
                    onClick={() => setHistoryPage((p) => p + 1)}
                  >
                    Older
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {vendorModalOpen && (
        <VendorPricingModal
          productId={product.id}
          variationId={chosen?.id}
          onClose={() => setVendorModalOpen(false)}
          onSaved={() => void reload()}
        />
      )}
    </div>
  );
}

/** 0041 grouped product: stock, prices and minimum stock per set type (it has no own price). */
function SetTypePrices({ groupId, row }: { groupId: string; row: (label: string, value: React.ReactNode) => React.ReactNode }) {
  const { data } = useSetTypes(groupId);
  if (!data) return <p className="text-sm text-slate-500">Loading sets…</p>;
  if (!data.types.length) return <p className="text-sm text-slate-500">No standard sets and no sets in stock.</p>;
  return (
    <div className="grid gap-2">
      {row("Sets in stock", `${data.types.reduce((s, t) => s + t.count, 0)} sets`)}
      {data.types.map((t) => (
        <div key={t.typeKey} className="rounded-md border border-slate-200 p-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-800">{setTypeName(t)}</span>
            <span className={t.count <= t.lowStockThreshold ? "font-semibold text-rose-600" : "font-semibold text-emerald-700"}>
              {t.count} set{t.count === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-0.5 text-slate-500">
            {fmtSellRate(null, t.minSalePrice, t.salePrice, "Sell: ")} · min stock {t.lowStockThreshold}
          </div>
        </div>
      ))}
    </div>
  );
}
