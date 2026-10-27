"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useMemo, useState, type DragEvent } from "react";
import { BoxesIcon, CogIcon, EditIcon, EyeIcon, PackageIcon, PlusIcon, RupeeIcon, WarnIcon } from "@/components/icons";
import { ColumnsMenu } from "@/components/ColumnsMenu";
import { ViewToggle } from "@/components/catalog/ViewToggle";
import { CategoryRail } from "@/components/catalog/CategoryRail";
import { ShopLayout } from "@/components/catalog/ShopLayout";
import { useCan } from "@/components/MeContext";
import { SetTypeRows, SetTypesBadge } from "@/components/sets/SetTypes";
import { ProductThumb } from "@/components/ProductThumb";
import { ProductDetailModal } from "@/components/products/ProductDetailModal";
import { ProductModal } from "@/components/products/ProductModal";
import { StockAdjustModal } from "@/components/products/StockAdjustModal";
import { VendorPricingModal } from "@/components/vendor/VendorPricingModal";
import { VariationOrderCell } from "@/components/VariationOrderCell";
import { Alert, EmptyState, PageHeader, SearchInput, Segmented, StatCell, StatStrip, TableSkeleton, Toolbar } from "@/components/ui";
import { api } from "@/lib/api";
import { formatVariationAttributes, money, qty, variationLabel } from "@/lib/format";
import { fetchAllInventory } from "@/lib/inventoryExport";
import { downloadInventoryPdf } from "@/lib/pdf";
import { PRODUCT_REPORT_COLUMNS, exportRows, filterProductTableRows, type ColumnDef } from "@/lib/inventoryColumns";
import type { CategoryStatsList, Product, ProductActivityStatus, StockProduct, StockVariation } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { usePreference } from "@/lib/usePreference";
import { useViewMode } from "@/lib/useViewMode";
import { perRate, ratePerOf } from "@/lib/measure";

// main v2 ProductsView (index.html) rebuilt with marble UI (D23): KPI strip, All/Active/Inactive
// stages, toolbar filters, grouped table whose variation products expand into their variations.

type Quick = "" | "low" | "out";

const PRODUCT_SCREEN_COLUMNS: ColumnDef[] = [
  { id: "image", label: "Image", value: () => "" },
  { id: "product", label: "Name", fixed: true, value: () => "" },
  { id: "category", label: "Category", value: () => "" },
  { id: "stock", label: "Stock on Hand", fixed: true, value: () => "" },
  { id: "activity", label: "Sales Activity", value: () => "" },
  { id: "actions", label: "Actions", fixed: true, value: () => "" },
];

const activityTone: Record<ProductActivityStatus, string> = {
  Active: "bg-emerald-100 text-emerald-700",
  "Min-Active": "bg-amber-100 text-amber-800",
  Inactive: "bg-slate-200 text-slate-700",
  "Never Sold": "bg-violet-100 text-violet-700",
};

const range = (vals: number[]) => {
  const nz = vals.filter((v) => v > 0);
  if (!nz.length) return "—";
  const lo = Math.min(...nz);
  const hi = Math.max(...nz);
  return lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`;
};

function ProductsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const canEdit = useCan("product.write");
  const canViewCost = useCan("inventory.configure");
  const canAdjust = useCan("stock.adjust");

  const { data, error, reload } = useApi<{ products: StockProduct[] }>("/inventory?status=all");
  const cats = useApi<CategoryStatsList>("/categories?stats=1");
  const [groupMode, setGroupMode] = useState<"all" | "category">("all");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [activityStage, setActivityStage] = useState<ProductActivityStatus | "">("");
  const [quick, setQuick] = useState<Quick>("");
  const [showInventoryValue, setShowInventoryValue] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [variationOrder, setVariationOrder] = useState<Record<string, string[]>>({});
  const [reordering, setReordering] = useState("");
  const [draggedVariation, setDraggedVariation] = useState<{ productId: string; variationId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ productId: string; variationId: string; position: "before" | "after" } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ loaded: number; total: number } | null>(null);
  const columnsPreference = usePreference<{ hidden: string[] }>("products.columns", { hidden: [] });
  const [view, setView] = useViewMode("products", "grid");

  const [showKpi, setShowKpi] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("products.show_kpi");
      if (stored !== null) return stored === "true";
    }
    return true;
  });
  const [showTableSettings, setShowTableSettings] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("products.show_table_settings");
      if (stored !== null) return stored === "true";
    }
    return true;
  });

  const toggleKpi = () => {
    setShowKpi((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") localStorage.setItem("products.show_kpi", String(next));
      return next;
    });
  };

  const toggleTableSettings = () => {
    setShowTableSettings((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") localStorage.setItem("products.show_table_settings", String(next));
      return next;
    });
  };

  const [modal, setModal] = useState<{ product: Product | null; presetCategoryId?: string } | null>(null);
  const [viewing, setViewing] = useState<{ product: StockProduct; variationId?: string } | null>(null);
  const [adjusting, setAdjusting] = useState<{ name: string; unit: string; variation: StockVariation } | null>(null);
  const [vendorPricingTarget, setVendorPricingTarget] = useState<{ productId: string; variationId?: string } | null>(null);
  const seesVendor = useCan("vendor_pricing.view");

  // Deep link from a category page: /products?new=1&categoryId=… opens Add Product page.
  useEffect(() => {
    if (params.get("new") === "1" && canEdit) {
      const cat = params.get("categoryId");
      router.push(cat ? `/products/new?categoryId=${cat}` : "/products/new");
    }
  }, [params, canEdit, router]);

  const all = data?.products ?? [];
  const expandProduct = params.get("expand");
  useEffect(() => {
    if (!expandProduct || !all.some((product) => product.id === expandProduct)) return;
    setOpen((current) => current.has(expandProduct) ? current : new Set(current).add(expandProduct));
  }, [all, expandProduct]);

  const viewId = params.get("view");
  useEffect(() => {
    if (viewId && all.length > 0 && !viewing) {
      const match = all.find((p) => p.id === viewId);
      if (match) setViewing({ product: match });
    }
  }, [all, viewId, viewing]);

  const columns = PRODUCT_SCREEN_COLUMNS.filter((column) => !column.cost || canViewCost);
  const hiddenColumns = columnsPreference.value.hidden ?? [];
  const showColumn = (id: string) => !hiddenColumns.includes(id);
  // KPIs count each product once (main v2 BR-06a); value uses raw variations (money is per SKU).
  const kpi = useMemo(() => {
    const low = all.filter((p) => p.quantity <= p.lowStockThreshold).length;
    const out = all.filter((p) => p.quantity === 0).length;
    // A Measured rate is per its rate unit: a feet + inches product's stock is in inches, its cost per ft.
    const value = all.reduce(
      (t, p) => t + p.variations.reduce((s, v) => s + (v.quantity * (Number(v.purchaseCost) || Number(v.salePrice) || 0)) / ratePerOf(p.measure?.lengthUnit), 0),
      0,
    );
    return { total: all.length, low, out, value };
  }, [all]);

  const rows = useMemo(
    () => filterProductTableRows(all, { search, category, activity: activityStage, quick }),
    [all, search, activityStage, category, quick],
  );

  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const orderedVariations = (p: StockProduct) => {
    const byId = new Map(p.variations.map((v) => [v.id, v]));
    const ids = variationOrder[p.id] ?? p.variations.map((v) => v.id);
    return [...ids.filter((id) => byId.has(id)).map((id) => byId.get(id)!), ...p.variations.filter((v) => !ids.includes(v.id))];
  };

  async function saveVariationOrder(p: StockProduct, next: string[]) {
    const before = orderedVariations(p).map((v) => v.id);
    setVariationOrder((orders) => ({ ...orders, [p.id]: next }));
    setReordering(p.id);
    setFlash(null);
    try {
      await api(`/products/${p.id}/variations/order`, { method: "PUT", body: { variationIds: next } });
      setVariationOrder({});
      await reload();
    } catch (e) {
      setVariationOrder((orders) => ({ ...orders, [p.id]: before }));
      setFlash({ kind: "error", text: errorText(e) });
    } finally {
      setReordering("");
    }
  }

  function moveVariation(p: StockProduct, from: number, to: number) {
    const ids = orderedVariations(p).map((v) => v.id);
    if (to < 0 || to >= ids.length || from === to || reordering === p.id) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    void saveVariationOrder(p, next);
  }

  const startVariationDrag = (event: DragEvent<HTMLButtonElement>, productId: string, variationId: string) => {
    setDraggedVariation({ productId, variationId });
    setDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", variationId);
  };

  async function downloadPdf(customize = false) {
    setExporting(true);
    setExportProgress(null);
    setFlash(null);
    try {
      const reportColumns = PRODUCT_REPORT_COLUMNS.filter((column) => (!column.cost || canViewCost) && (column.fixed || showColumn(column.id)));
      const selectedColumns = reportColumns.map((column) => column.id);
      if (customize) {
        const params = new URLSearchParams({
          source: "products",
          search: search.trim(),
          category,
          activity: activityStage,
          quick,
          columns: selectedColumns.join(","),
        });
        router.push(`/inventory/pdf?${params}`);
        return;
      }
      const query = new URLSearchParams({ state: "all", status: "all" });
      const complete = await fetchAllInventory(query, (loaded, total) => setExportProgress({ loaded, total }));
      const filtered = filterProductTableRows(complete, {
        search,
        category,
        activity: activityStage,
        quick,
      });
      await downloadInventoryPdf({
        title: "Inventory Report",
        subtitle: [
          activityStage ? `Sales activity: ${activityStage}` : "",
          quick ? `Stock: ${quick}` : "",
          search.trim() ? `Search: "${search.trim()}"` : "",
          category ? `Category: ${category === "none" ? "Uncategorized" : cats.data?.categories.find((c) => c.id === category)?.name ?? ""}` : "",
        ].filter(Boolean).join("  ·  ") || "All products",
        columns: reportColumns,
        rows: exportRows(filtered, undefined, { includeInactiveVariations: true }),
        filename: `inventory-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
    } catch (e) {
      setFlash({ kind: "error", text: errorText(e) });
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  }



  function onSaved(p: Product, created: boolean) {
    setModal(null);
    void reload();
    setFlash({ kind: "success", text: created ? `${p.name} added` : `${p.name} updated` });
  }

  const iconBtn = "flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900";
  // V3.1: grouped products expand too (into set types, like variations).
  const variableRows = rows.filter((p) => p.productType === "variable" || p.productType === "measured" || p.productType === "grouped");
  const visibleColumns = columns.filter((column) => column.fixed || showColumn(column.id));
  const expandAll = (expanded: boolean) =>
    setOpen(expanded ? new Set(variableRows.map((p) => p.id)) : new Set());
  const stockCell = (quantity: number, threshold: number, unit: string, bold = false) => (
    <span className={`inline-flex items-center gap-1 ${quantity <= threshold ? "text-rose-600" : "text-emerald-700"} ${bold ? "font-semibold" : ""}`}>
      {qty(quantity)} <span className="text-xs text-slate-400">{unit}</span>
      {quantity <= threshold && <WarnIcon className="h-3.5 w-3.5" />}
    </span>
  );

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Manage your products and stock information"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={`btn-secondary ${!showKpi ? "bg-slate-100 text-slate-700" : ""}`}
              onClick={toggleKpi}
              aria-expanded={showKpi}
              title={showKpi ? "Hide KPI summary" : "Show KPI summary"}
            >
              <EyeIcon className="h-4 w-4" />
              <span>{showKpi ? "Hide KPIs" : "Show KPIs"}</span>
            </button>
            <button
              type="button"
              className={`btn-secondary ${!showTableSettings ? "bg-slate-100 text-slate-700" : ""}`}
              onClick={toggleTableSettings}
              aria-expanded={showTableSettings}
              title={showTableSettings ? "Hide table layout & columns settings" : "Show table layout & columns settings"}
            >
              <CogIcon className="h-4 w-4" />
              <span>{showTableSettings ? "Hide Table Settings" : "Table Settings"}</span>
            </button>
            {canAdjust && (
              <Link href="/inventory" className="btn-secondary"><BoxesIcon className="h-4 w-4" /> Stock In</Link>
            )}
            {canEdit && (
              <Link href="/products/new" className="btn-primary"><PlusIcon className="h-4 w-4" /> Add Product</Link>
            )}
          </div>
        }
      />

      {showKpi && (
        <StatStrip cols={canViewCost ? 4 : 3}>
          <StatCell icon={<PackageIcon className="h-4 w-4" />} tone="blue" label="Total Products" value={qty(kpi.total)} />
          <StatCell icon={<WarnIcon className="h-4 w-4" />} tone="orange" label="Low Stock" value={qty(kpi.low)} onClick={() => setQuick(quick === "low" ? "" : "low")} active={quick === "low"} />
          <StatCell icon={<span className="text-sm">⊘</span>} tone="red" label="Out of Stock" value={qty(kpi.out)} onClick={() => setQuick(quick === "out" ? "" : "out")} active={quick === "out"} />
          {canViewCost && (
            <StatCell
              icon={<RupeeIcon className="h-4 w-4" />}
              tone="violet"
              label="Inventory Value"
              value={
                <span className="inline-flex items-center gap-2">
                  <span>{showInventoryValue ? money(kpi.value) : "Hidden"}</span>
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-xs font-semibold text-violet-700 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                    onClick={() => setShowInventoryValue((visible) => !visible)}
                    aria-label={showInventoryValue ? "Hide inventory value" : "Reveal inventory value"}
                    aria-pressed={showInventoryValue}
                  >
                    {showInventoryValue ? "Hide" : "Reveal"}
                  </button>
                </span>
              }
            />
          )}
        </StatStrip>
      )}

      <Toolbar>
        <SearchInput value={search} onChange={setSearch} placeholder="Search products, category…" />
        <select className="input w-auto" value={activityStage} onChange={(e) => setActivityStage(e.target.value as ProductActivityStatus | "")} aria-label="Sales activity">
          <option value="">All sales activity</option>
          <option value="Active">Active</option>
          <option value="Min-Active">Min-Active</option>
          <option value="Inactive">Inactive</option>
          <option value="Never Sold">Never Sold</option>
        </select>
        <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All Categories</option>
          {cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="none">No category</option>
        </select>
        {(search || category || activityStage || quick) && (
          <button className="btn-secondary" onClick={() => { setSearch(""); setCategory(""); setActivityStage(""); setQuick(""); }}>Clear All</button>
        )}
      </Toolbar>

      {showTableSettings && (
        <Toolbar>
          <Segmented
            label="Catalog Layout"
            value={groupMode}
            onChange={(m) => {
              setGroupMode(m);
              if (m === "all") setCategory("");
            }}
            options={[
              { value: "all", label: "All Products" },
              { value: "category", label: "By Category" },
            ]}
          />
          <ViewToggle value={view} onChange={setView} />
          {view === "table" && (
            <>
              <button className="btn-secondary" disabled={!variableRows.length} onClick={() => expandAll(true)}>Expand all</button>
              <button className="btn-secondary" disabled={!open.size} onClick={() => expandAll(false)}>Collapse all</button>
            </>
          )}
          <span className="flex-1" />
          {view === "table" && <ColumnsMenu
            columns={columns}
            hidden={hiddenColumns}
            onChange={(hidden) => void columnsPreference.save({ hidden })}
            onReset={() => void columnsPreference.save(null)}
          />}
          <button className="btn-secondary" disabled={exporting || !data} onClick={() => void downloadPdf()} title="Export every matching product and variation using the visible columns">
            {exportProgress ? `Preparing ${exportProgress.loaded}/${exportProgress.total}…` : exporting ? "Preparing PDF…" : "Download PDF"}
          </button>
          <button className="btn-secondary" disabled={!data} onClick={() => void downloadPdf(true)}>Customize PDF</button>
        </Toolbar>
      )}

      <Alert message={flash?.text} kind={flash?.kind} />
      <Alert message={columnsPreference.error} />
      <Alert message={error} />

      {(() => {
        const productContent = (
          <div className={view === "grid" && rows.length > 0 ? "" : "card overflow-x-auto lg:overflow-x-visible"}>
        {!data && !error ? (
          <TableSkeleton rows={6} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<PackageIcon className="h-6 w-6" />}
            title={all.length ? "No products match the filters" : "No products yet"}
            action={!all.length && canEdit ? <Link href="/products/new" className="btn-primary">Add Product</Link> : undefined}
          >
            {all.length ? "Try clearing the search or filters." : "Create your first product; price and stock are set from Stock In."}
          </EmptyState>
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {rows.map((p) => {
              const sale = range(p.variations.filter((v) => v.active).map((v) => Number(v.salePrice)));
              return (
                <div key={p.id} className={`group card relative flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md ${p.active ? "" : "opacity-60"}`}>
                  <Link href={`/products/${p.id}`} className="flex flex-1 flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label={`Open ${p.name}`}>
                    <div className="overflow-hidden bg-slate-100">
                      <ProductThumb src={p.imageUrl ?? null} name={p.name} className="aspect-[4/3] w-full text-xl transition-transform duration-300 group-hover:scale-105" />
                    </div>
                    <div className="grid flex-1 content-start gap-1 p-3">
                      <div className="line-clamp-2 font-semibold text-slate-900">{p.name}</div>
                      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                        <span className="truncate">
                          {p.productType === "measured" ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">Measured</span>
                              <span>{p.variations.length} variations</span>
                            </span>
                          ) : p.productType === "variable" ? (
                            `${p.variations.length} variations`
                          ) : (
                            p.category?.name ?? "Uncategorized"
                          )}
                        </span>
                        {stockCell(p.quantity, p.lowStockThreshold, p.unit)}
                      </div>
                      <div className="text-sm font-semibold text-brand-700">{sale}{sale !== "—" ? perRate(p.measure?.lengthUnit) : ""}</div>
                    </div>
                  </Link>
                  {canEdit && (
                    <Link href={`/products/${p.id}/edit`} className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm hover:text-slate-900" title="Edit" aria-label={`Edit ${p.name}`}>
                      <EditIcon className="h-4 w-4" />
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="w-8" aria-label="Expand" />
                {showColumn("image") && <th>Image</th>}
                <th>Name</th>
                {showColumn("category") && <th>Category</th>}
                <th>Stock on Hand</th>
                {showColumn("activity") && <th>Sales Activity</th>}
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const group = p.productType === "variable" || p.productType === "measured";
                // V3.1 grouped product: expands into its set types (sets with the same parts).
                const sets = p.productType === "grouped";
                const expandable = group || sets;
                const expanded = open.has(p.id);
                const only = p.variations[0]!;
                return (
                  <Fragment key={p.id}>
                    <tr className={expandable ? "cursor-pointer" : ""} onClick={expandable ? () => toggle(p.id) : undefined}>
                      <td>
                        {expandable && (
                          <button className="text-brand-600" aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${p.name}`} onClick={(e) => { e.stopPropagation(); toggle(p.id); }}>
                            {expanded ? "⊖" : "⊕"}
                          </button>
                        )}
                      </td>
                      {showColumn("image") && (
                        <td className="align-top py-2">
                          <ProductThumb src={p.imageUrl} name={p.name} className="h-11 w-11 rounded-md text-[7px]" />
                        </td>
                      )}
                      <td className={expandable ? "font-semibold text-slate-900 align-top py-2" : "text-slate-900 align-top py-2"}>
                        <Link href={`/products/${p.id}`} className="hover:text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>{p.name}</Link>
                        {group && (
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                              {p.variations.length} variation{p.variations.length === 1 ? "" : "s"}
                            </span>
                          </div>
                        )}
                        {sets && (
                          <div className="mt-0.5">
                            <SetTypesBadge groupId={p.id} />
                          </div>
                        )}
                      </td>
                      {showColumn("category") && <td className="text-slate-600">{p.category?.name ?? "—"}</td>}
                      <td>{stockCell(p.quantity, p.lowStockThreshold, sets ? "sets" : p.unit, expandable)}</td>
                      {showColumn("activity") && <td><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${activityTone[p.activityStatus]}`}>{p.activityStatus}</span></td>}
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          <button className={iconBtn} title="View details and action log" aria-label={`View ${p.name}`} onClick={() => setViewing({ product: p })}><EyeIcon className="h-4 w-4" /></button>
                          {seesVendor && !sets && (
                            <button className={iconBtn} title="Vendor pricing" aria-label={`Vendor pricing for ${p.name}`} onClick={() => setVendorPricingTarget({ productId: p.id })}>
                              <RupeeIcon className="h-4 w-4" />
                            </button>
                          )}
                          {!group && !sets && canAdjust && p.productType !== "measured" && <button className={iconBtn} title="Adjust Stock" aria-label={`Adjust stock of ${p.name}`} onClick={() => setAdjusting({ name: p.name, unit: p.unit, variation: only })}><BoxesIcon className="h-4 w-4" /></button>}
                          {canEdit && <Link href={`/products/${p.id}/edit`} className={iconBtn} title={group ? "Edit entire variation product — all variations at once" : "Edit"} aria-label={`Edit ${p.name}`}><EditIcon className="h-4 w-4" /></Link>}
                        </div>
                      </td>
                    </tr>
                    {sets && expanded && <SetTypeRows colSpan={visibleColumns.length + 1} groupId={p.id} layout="chips" productHref={`/products/${p.id}`} />}
                    {group && expanded && (
                      <tr>
                        <td colSpan={visibleColumns.length + 1} className="bg-slate-50/70 px-4 py-3">
                          <table className="table rounded-md bg-white">
                            <thead>
                              <tr>
                                <th>Order</th>
                                {showColumn("image") && <th />}
                                <th>Variation Attributes</th>
                                <th>Stock on Hand</th>
                                <th className="text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody
                              onDragLeave={(event) => {
                                if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                                  setDropTarget(null);
                                }
                              }}
                            >
                              {orderedVariations(p).map((v, index, ordered) => {
                                const varLabel = variationLabel(v, p.attributes);
                                const isSelected = draggedVariation?.variationId === v.id;
                                const isDropTarget = dropTarget?.productId === p.id && dropTarget?.variationId === v.id && !isSelected;
                                const indicatorClass = isDropTarget
                                  ? dropTarget.position === "before"
                                    ? "drop-indicator-top"
                                    : "drop-indicator-bottom"
                                  : "";
                                const rowClass = [
                                  isSelected ? "row-dragging bg-light border shadow-sm" : v.active ? "" : "opacity-60",
                                  indicatorClass,
                                ].filter(Boolean).join(" ");

                                return (
                                  <tr
                                    key={v.id}
                                    className={rowClass}
                                    onDragOver={(event) => {
                                      if (!draggedVariation || draggedVariation.productId !== p.id) return;
                                      if (draggedVariation.variationId === v.id) {
                                        if (dropTarget) setDropTarget(null);
                                        return;
                                      }
                                      event.preventDefault();
                                      event.dataTransfer.dropEffect = "move";
                                      const rect = event.currentTarget.getBoundingClientRect();
                                      const isUpper = event.clientY < rect.top + rect.height / 2;
                                      const position = isUpper ? "before" : "after";
                                      if (dropTarget?.variationId !== v.id || dropTarget?.position !== position) {
                                        setDropTarget({ productId: p.id, variationId: v.id, position });
                                      }
                                    }}
                                    onDrop={(event) => {
                                      event.preventDefault();
                                      if (!draggedVariation || draggedVariation.productId !== p.id) {
                                        setDraggedVariation(null);
                                        setDropTarget(null);
                                        return;
                                      }
                                      const draggedId = event.dataTransfer.getData("text/plain") || draggedVariation.variationId;
                                      const from = ordered.findIndex((item) => item.id === draggedId);
                                      const targetIdx = ordered.findIndex((item) => item.id === v.id);
                                      if (from >= 0 && targetIdx >= 0 && from !== targetIdx) {
                                        const position = dropTarget?.position ?? (targetIdx > from ? "after" : "before");
                                        const to = position === "before"
                                          ? (from < targetIdx ? targetIdx - 1 : targetIdx)
                                          : (from < targetIdx ? targetIdx : targetIdx + 1);
                                        if (to >= 0 && to < ordered.length && to !== from) {
                                          moveVariation(p, from, to);
                                        }
                                      }
                                      setDraggedVariation(null);
                                      setDropTarget(null);
                                    }}
                                  >
                                    <VariationOrderCell
                                      label={`${p.name} ${varLabel}`}
                                      index={index}
                                      count={ordered.length}
                                      disabled={!canEdit || reordering === p.id}
                                      onMove={(from, to) => moveVariation(p, from, to)}
                                      onDragStart={(event) => startVariationDrag(event, p.id, v.id)}
                                      onDragEnd={() => {
                                        setDraggedVariation(null);
                                        setDropTarget(null);
                                      }}
                                    />
                                    {showColumn("image") && (
                                      <td className="w-14">
                                        {v.imageUrl ? (
                                          <ProductThumb src={v.imageUrl} name={`${p.name} (${varLabel})`} className="h-10 w-10 rounded text-[6px]" />
                                        ) : null}
                                      </td>
                                    )}
                                    <td>
                                      <div className="flex flex-wrap gap-1">
                                        {formatVariationAttributes(v.attributes, p.attributes).map((item) => (
                                          <span key={item.name} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-700">
                                            {item.name}: <b>{item.formatted}</b>
                                          </span>
                                        ))}
                                      </div>
                                    </td>
                                    <td>{stockCell(v.quantity, v.lowStockThreshold, p.unit)}</td>
                                    <td>
                                      <div className="flex justify-end gap-1">
                                        <button className={iconBtn} title="View" aria-label={`View ${p.name} (${varLabel})`} onClick={() => setViewing({ product: p, variationId: v.id })}><EyeIcon className="h-4 w-4" /></button>
                                        {seesVendor && (
                                          <button className={iconBtn} title="Vendor pricing" aria-label={`Vendor pricing for ${p.name} (${varLabel})`} onClick={() => setVendorPricingTarget({ productId: p.id, variationId: v.id })}>
                                            <RupeeIcon className="h-4 w-4" />
                                          </button>
                                        )}
                                        {canAdjust && p.productType !== "measured" && <button className={iconBtn} title="Adjust Stock" aria-label={`Adjust stock of ${p.name} (${varLabel})`} onClick={() => setAdjusting({ name: p.name, unit: p.unit, variation: v })}><BoxesIcon className="h-4 w-4" /></button>}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    );

        if (groupMode === "category") {
          return (
            <ShopLayout
              rail={
                <CategoryRail
                  data={cats.data ?? null}
                  selected={category || "all"}
                  onSelect={(key) => setCategory(key === "all" ? "" : key)}
                  alerts
                />
              }
              title={
                category === "none"
                  ? "Uncategorized"
                  : category
                  ? cats.data?.categories.find((c) => c.id === category)?.name ?? "Category"
                  : "All Categories"
              }
              count={`${rows.length} product${rows.length === 1 ? "" : "s"}`}
            >
              {productContent}
            </ShopLayout>
          );
        }

        return productContent;
      })()}
      <ProductDetailModal
        product={viewing?.product ?? null}
        initialVariationId={viewing?.variationId}
        onClose={() => setViewing(null)}
        onEdit={() => {
          const p = viewing?.product;
          setViewing(null);
          if (p) setModal({ product: p });
        }}
      />
      <StockAdjustModal
        target={adjusting}
        onClose={() => setAdjusting(null)}
        onSaved={(m) => { setAdjusting(null); setFlash({ kind: "success", text: m }); void reload(); }}
      />
      {vendorPricingTarget && (
        <VendorPricingModal
          productId={vendorPricingTarget.productId}
          variationId={vendorPricingTarget.variationId}
          onClose={() => setVendorPricingTarget(null)}
          onSaved={() => void reload()}
        />
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <ProductsPage />
    </Suspense>
  );
}
