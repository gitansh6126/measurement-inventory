"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useMemo, useState, type DragEvent } from "react";
import { BoxesIcon, CogIcon, EditIcon, EyeIcon, PackageIcon, PlusIcon, RupeeIcon, SlidersIcon, WarnIcon } from "@/components/icons";
import { ColumnsMenu } from "@/components/ColumnsMenu";
import { PageMobileSidebar, SidebarField, SidebarSection } from "@/components/PageMobileSidebar";
import { ViewToggle } from "@/components/catalog/ViewToggle";
import { CategoryHeadSelect, PRODUCT_TYPE_KEY } from "@/components/catalog/CategoryHeadSelect";
import { CategoryRail } from "@/components/catalog/CategoryRail";
import { ShopLayout } from "@/components/catalog/ShopLayout";
import { useCan } from "@/components/MeContext";
import { SetTypeRows, SetTypesBadge } from "@/components/sets/SetTypes";
import { MeasuredStock } from "@/components/measure/MeasuredStock";
import { ProductThumb } from "@/components/ProductThumb";
import { ProductDetailModal } from "@/components/products/ProductDetailModal";
import { ProductModal } from "@/components/products/ProductModal";
import { VendorPricingModal } from "@/components/vendor/VendorPricingModal";
import { VariationOrderCell } from "@/components/VariationOrderCell";
import { Alert, EmptyState, PageHeader, SearchInput, Segmented, StatCell, StatStrip, TableSkeleton, Toolbar } from "@/components/ui";
import { api } from "@/lib/api";
import { money, qty, variationLabel } from "@/lib/format";
import { variationAttributeColumns } from "@/lib/variationColumns";
import { fetchAllInventory } from "@/lib/inventoryExport";
import { downloadInventoryPdf } from "@/lib/pdf";
import { PRODUCT_REPORT_COLUMNS, exportRows, filterProductTableRows, type ColumnDef } from "@/lib/inventoryColumns";
import type { CategoryHead, CategoryStatsList, Product, ProductActivityStatus, StockProduct, StockVariation } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { useTableColumns } from "@/lib/useTableColumns";
import { useViewMode } from "@/lib/useViewMode";
import { fmtLen, fmtRate, fmtSellRate, metaOf, ratePerOf, type LengthUnit, type MeasureMeta } from "@/lib/measure";
import { useLengthView } from "@/lib/lengthView";
import { LengthViewToggle } from "@/components/measure/LengthViewToggle";

// main v2 ProductsView (index.html) rebuilt with marble UI (D23): KPI strip, All/Active/Inactive
// stages, toolbar filters, grouped table whose variation products expand into their variations.
//
// Catalog overview only (owner spec 2026-10-28): stock and prices are read-only here; each row
// has a "Stock" link to the same product on Stock In, where stock, prices and minimum stock are
// changed. Columns can be dragged into the user's order (useTableColumns).

type Quick = "" | "low" | "out";

const PRODUCT_SCREEN_COLUMNS: ColumnDef[] = [
  { id: "image", label: "Image", value: () => "" },
  { id: "product", label: "Name", fixed: true, value: () => "" },
  { id: "sku", label: "SKU", value: () => "" },
  { id: "category", label: "Category", value: () => "" },
  { id: "type", label: "Type", value: () => "" },
  { id: "stock", label: "Stock on Hand", fixed: true, value: () => "" },
  { id: "salePrice", label: "Selling Price", value: () => "" },
  { id: "minSalePrice", label: "Minimum Selling Price", value: () => "" },
  { id: "activity", label: "Sales Activity", value: () => "" },
  { id: "actions", label: "Actions", fixed: true, pinned: true, value: () => "" },
];
const TYPE_LABEL: Record<StockProduct["productType"], string> = { simple: "Simple", variable: "Variable", measured: "Measured", grouped: "Set" };
/** Columns a variation child row has (after its attribute columns). */
const CHILD_COLUMNS = ["sku", "stock", "salePrice", "minSalePrice", "actions"];

const activityTone: Record<ProductActivityStatus, string> = {
  Active: "bg-emerald-100 text-emerald-700",
  "Min-Active": "bg-amber-100 text-amber-800",
  Inactive: "bg-slate-200 text-slate-700",
  "Never Sold": "bg-violet-100 text-violet-700",
};

const range = (vals: number[], unit?: LengthUnit | null) => {
  const nz = vals.filter((v) => v > 0);
  if (!nz.length) return "—";
  const lo = Math.min(...nz);
  const hi = Math.max(...nz);
  return lo === hi ? fmtRate(unit, lo) : fmtRate(unit, lo, hi);
};

function ProductsPage() {
  useLengthView();
  const router = useRouter();
  const params = useSearchParams();
  const canEdit = useCan("product.write");
  const canViewCost = useCan("inventory.configure");
  const canAdjust = useCan("stock.adjust");
  // Stock In needs stock.adjust or inventory.configure (prices / minimum stock).
  const canManageStock = canAdjust || canViewCost;

  const { data, error, reload } = useApi<{ products: StockProduct[] }>("/inventory?status=all");
  const heads = useApi<{ heads: CategoryHead[] }>("/category-heads");
  const [headKey, setHeadKey] = useState<string>(() => params.get("head") ?? PRODUCT_TYPE_KEY);
  const cats = useApi<CategoryStatsList>(`/categories?stats=1&headId=${headKey}`);
  const [groupMode, setGroupMode] = useState<"all" | "category">("category");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(() => params.get("category") ?? params.get("categoryId") ?? "");

  const handleHeadChange = (nextHead: string) => {
    setHeadKey(nextHead);
    setCategory("");
  };
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
  // Category column is off by default (the By Category layout already groups by it).
  const columns = PRODUCT_SCREEN_COLUMNS.filter((column) => !column.cost || canViewCost);
  const cols = useTableColumns("products.columns", columns, ["category", "sku", "type", "minSalePrice"]);
  const [view, setView] = useViewMode("products", "grid");

  const [showKpi, setShowKpi] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("products.show_kpi");
      if (stored !== null) return stored === "true";
    }
    return false;
  });
  const [showTableSettings, setShowTableSettings] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("products.show_table_settings");
      if (stored !== null) return stored === "true";
    }
    return false;
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

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (headKey !== PRODUCT_TYPE_KEY) count++;
    if (category) count++;
    if (activityStage) count++;
    if (quick) count++;
    return count;
  }, [headKey, category, activityStage, quick]);

  const [modal, setModal] = useState<{ product: Product | null; presetCategoryId?: string } | null>(null);
  const [viewing, setViewing] = useState<{ product: StockProduct; variationId?: string } | null>(null);
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
  const focus = params.get("focus") ?? params.get("expand");
  useEffect(() => {
    if (!focus || !all.some((product) => product.id === focus)) return;
    setOpen((current) => current.has(focus) ? current : new Set(current).add(focus));
    const scroll = () => {
      const el = document.getElementById(`product-${focus}`) ?? document.getElementById(`product-card-${focus}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    const t1 = setTimeout(scroll, 100);
    const t2 = setTimeout(scroll, 300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [all, focus]);

  const viewId = params.get("view");
  useEffect(() => {
    if (viewId && all.length > 0 && !viewing) {
      const match = all.find((p) => p.id === viewId);
      if (match) setViewing({ product: match });
    }
  }, [all, viewId, viewing]);

  const showColumn = cols.visible;
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
          headKey !== PRODUCT_TYPE_KEY ? `Head: ${heads.data?.heads.find((h) => (h.id ?? PRODUCT_TYPE_KEY) === headKey)?.name ?? headKey}` : "",
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
  const visibleColumns = cols.shown();
  const expandAll = (expanded: boolean) =>
    setOpen(expanded ? new Set(variableRows.map((p) => p.id)) : new Set());
  // A Measured product's stock is a length, shown in the user's m / ft view.
  const lenOf = (p: StockProduct) => (p.productType === "measured" ? metaOf({ ...(p.measure ?? {}), lengthUnit: p.measure?.lengthUnit ?? "m" }) : undefined);
  const stockCell = (quantity: number, threshold: number, unit: string, bold = false, len?: MeasureMeta) => (
    <span className={`inline-flex items-center gap-1 ${quantity <= threshold ? "text-rose-600" : "text-emerald-700"} ${bold ? "font-semibold" : ""}`}>
      {len ? fmtLen(quantity, len) : <>{qty(quantity)} <span className="text-xs text-slate-400">{unit}</span></>}
      {quantity <= threshold && <WarnIcon className="h-3.5 w-3.5" />}
    </span>
  );

  // One link per row to the same product on Stock In (shown in all products, auto-scrolled & blinking).
  const stockHref = (p: StockProduct) => `/inventory?focus=${p.id}`;
  const stockLink = (p: StockProduct, label = p.name) =>
    canManageStock ? (
      <Link href={stockHref(p)} className={iconBtn} title="Manage stock & prices on Stock In" aria-label={`Manage stock and prices of ${label}`}>
        <BoxesIcon className="h-4 w-4" />
      </Link>
    ) : null;
  const priceRange = (p: StockProduct, field: "salePrice" | "minSalePrice", vars = p.variations.filter((v) => v.active)) =>
    range(vars.map((v) => Number(v[field])), p.measure?.lengthUnit);
  const headLabel: Record<string, string> = { image: "Image", product: "Name", sku: "SKU", category: "Category", type: "Type", stock: "Stock on Hand", salePrice: "Selling Price", minSalePrice: "Min. Selling Price", activity: "Sales Activity", actions: "Actions" };
  const hasMeasuredRows = rows.some((p) => p.productType === "measured");
  const headCell = (id: string) => (
    <th key={id} {...cols.headerDrag(id)} className={`${cols.headerDrag(id).className ?? ""} ${id === "actions" || id === "salePrice" || id === "minSalePrice" ? "text-right" : ""} ${id === "product" ? "col-product" : ""}`}>
      {headLabel[id]}
      {id === "stock" && hasMeasuredRows && <LengthViewToggle className="ml-1.5" />}
    </th>
  );

  return (
    <div>
      {/* Mobile Page Header Bar - clean, compact, non-overwhelming */}
      <div className="no-print mb-3 lg:hidden space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Products</h1>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              {rows.length}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {canEdit && (
              <Link href="/products/new" className="btn-primary py-1 px-2.5 text-xs font-semibold shadow-xs">
                <PlusIcon className="h-3.5 w-3.5" />
                <span>Add</span>
              </Link>
            )}
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className={`btn-secondary py-1 px-2.5 text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                activeFiltersCount > 0 ? "border-brand-500 bg-brand-50/60 text-brand-700" : ""
              }`}
              aria-label="Open page filters and view options"
            >
              <SlidersIcon className="h-3.5 w-3.5 text-slate-600" />
              <span>Options</span>
              {activeFiltersCount > 0 && (
                <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white leading-none">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Search input */}
        <SearchInput value={search} onChange={setSearch} placeholder="Search products, category…" />

        {/* Mobile Active filter chips */}
        {(search || category || headKey !== PRODUCT_TYPE_KEY || activityStage || quick) && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs [scrollbar-width:none]">
            <span className="text-[11px] font-medium text-slate-400 shrink-0">Filters:</span>
            {headKey !== PRODUCT_TYPE_KEY && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-200/90 px-2.5 py-0.5 font-medium text-slate-800 text-[11px]">
                Head: {heads.data?.heads.find((h) => (h.id ?? PRODUCT_TYPE_KEY) === headKey)?.name ?? headKey}
                <button type="button" onClick={() => handleHeadChange(PRODUCT_TYPE_KEY)} className="hover:text-slate-950 font-bold ml-0.5" aria-label="Remove head filter">×</button>
              </span>
            )}
            {quick && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100/90 px-2.5 py-0.5 font-medium text-amber-800 text-[11px]">
                {quick === "low" ? "Low Stock" : "Out of Stock"}
                <button type="button" onClick={() => setQuick("")} className="hover:text-amber-950 font-bold ml-0.5" aria-label="Remove stock filter">×</button>
              </span>
            )}
            {category && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-100/90 px-2.5 py-0.5 font-medium text-brand-800 text-[11px]">
                {category === "none" ? "Uncategorized" : cats.data?.categories.find((c) => c.id === category)?.name ?? "Category"}
                <button type="button" onClick={() => setCategory("")} className="hover:text-brand-950 font-bold ml-0.5" aria-label="Remove category filter">×</button>
              </span>
            )}
            {activityStage && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-100/90 px-2.5 py-0.5 font-medium text-violet-800 text-[11px]">
                {activityStage}
                <button type="button" onClick={() => setActivityStage("")} className="hover:text-violet-950 font-bold ml-0.5" aria-label="Remove sales activity filter">×</button>
              </span>
            )}
            {search && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-200/90 px-2.5 py-0.5 font-medium text-slate-700 text-[11px]">
                &ldquo;{search}&rdquo;
                <button type="button" onClick={() => setSearch("")} className="hover:text-slate-900 font-bold ml-0.5" aria-label="Clear search">×</button>
              </span>
            )}
            <button
              type="button"
              onClick={() => { setSearch(""); setCategory(""); setHeadKey(PRODUCT_TYPE_KEY); setActivityStage(""); setQuick(""); }}
              className="shrink-0 text-[11px] font-semibold text-slate-500 hover:text-brand-600 underline ml-1 cursor-pointer"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* In-Page Mobile Sidebar Drawer */}
      <PageMobileSidebar
        open={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        title="Products Options"
        subtitle="Layout, filters, metrics & tools"
        badge={
          activeFiltersCount > 0 ? (
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-700">
              {activeFiltersCount} active
            </span>
          ) : undefined
        }
        footer={
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="btn-primary w-full py-2.5 text-sm font-semibold shadow-sm justify-center cursor-pointer"
          >
            Show {rows.length} Product{rows.length === 1 ? "" : "s"}
          </button>
        }
      >
        {/* Quick Actions Section */}
        <SidebarSection title="Quick Actions">
          <div className="grid grid-cols-2 gap-2">
            {canEdit && (
              <Link
                href="/products/new"
                className="btn-primary justify-center py-2 text-xs font-semibold"
                onClick={() => setMobileSidebarOpen(false)}
              >
                <PlusIcon className="h-4 w-4" /> Add Product
              </Link>
            )}
            {canAdjust && (
              <Link
                href="/inventory"
                className="btn-secondary justify-center py-2 text-xs font-semibold"
                onClick={() => setMobileSidebarOpen(false)}
              >
                <BoxesIcon className="h-4 w-4" /> Stock In
              </Link>
            )}
          </div>
        </SidebarSection>

        {/* View & Layout Section */}
        <SidebarSection title="View & Layout">
          <SidebarField label="Catalog Layout" description="Group products by category or show all">
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
          </SidebarField>

          <SidebarField label="Category Head" description="Switch category grouping head">
            <CategoryHeadSelect
              heads={heads.data?.heads}
              value={headKey}
              onChange={handleHeadChange}
            />
          </SidebarField>

          <SidebarField label="Display Mode">
            <ViewToggle value={view} onChange={setView} />
          </SidebarField>

          {view === "table" && (
            <div className="space-y-2 pt-1 border-t border-slate-200/60">
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary flex-1 text-xs justify-center"
                  disabled={!variableRows.length}
                  onClick={() => expandAll(true)}
                >
                  Expand all
                </button>
                <button
                  type="button"
                  className="btn-secondary flex-1 text-xs justify-center"
                  disabled={!open.size}
                  onClick={() => expandAll(false)}
                >
                  Collapse all
                </button>
              </div>
              <div className="pt-1">
                <ColumnsMenu
                  columns={columns}
                  hidden={cols.hidden}
                  order={cols.order}
                  onMove={cols.move}
                  onChange={cols.setHidden}
                  onReset={cols.reset}
                />
              </div>
            </div>
          )}
        </SidebarSection>

        {/* Filters Section */}
        <SidebarSection
          title="Filters"
          action={
            activeFiltersCount > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setCategory("");
                  setActivityStage("");
                  setQuick("");
                }}
                className="text-xs font-semibold text-brand-600 hover:text-brand-800 cursor-pointer"
              >
                Reset filters
              </button>
            ) : null
          }
        >
          {/* Stock Condition */}
          <SidebarField label="Stock Status">
            <div className="grid grid-cols-3 gap-1.5">
              <button
                type="button"
                onClick={() => setQuick("")}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold text-center transition-all cursor-pointer ${
                  quick === ""
                    ? "border-brand-600 bg-brand-50 text-brand-700 shadow-xs"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                All ({all.length})
              </button>
              <button
                type="button"
                onClick={() => setQuick(quick === "low" ? "" : "low")}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold text-center transition-all cursor-pointer ${
                  quick === "low"
                    ? "border-amber-500 bg-amber-50 text-amber-800 shadow-xs"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                Low ({kpi.low})
              </button>
              <button
                type="button"
                onClick={() => setQuick(quick === "out" ? "" : "out")}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold text-center transition-all cursor-pointer ${
                  quick === "out"
                    ? "border-rose-500 bg-rose-50 text-rose-700 shadow-xs"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                Out ({kpi.out})
              </button>
            </div>
          </SidebarField>


          {/* Sales Activity */}
          <SidebarField label="Sales Activity">
            <select
              className="input text-sm"
              value={activityStage}
              onChange={(e) => setActivityStage(e.target.value as ProductActivityStatus | "")}
              aria-label="Sales activity"
            >
              <option value="">All sales activity</option>
              <option value="Active">Active</option>
              <option value="Min-Active">Min-Active</option>
              <option value="Inactive">Inactive</option>
              <option value="Never Sold">Never Sold</option>
            </select>
          </SidebarField>
        </SidebarSection>

        {/* Summary Metrics Section */}
        <SidebarSection title="Summary Metrics">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-slate-200 bg-white p-2.5">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Products</span>
              <span className="text-base font-bold text-slate-900">{qty(kpi.total)}</span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-2.5">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-amber-600">Low Stock</span>
              <span className="text-base font-bold text-amber-700">{qty(kpi.low)}</span>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-2.5">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-rose-500">Out of Stock</span>
              <span className="text-base font-bold text-rose-600">{qty(kpi.out)}</span>
            </div>
            {canViewCost && (
              <div className="rounded-lg border border-slate-200 bg-white p-2.5">
                <span className="block text-[10px] font-semibold uppercase tracking-wider text-violet-600">Inventory Value</span>
                <span className="text-sm font-bold text-slate-900 truncate block">
                  {showInventoryValue ? money(kpi.value) : "••••••"}
                </span>
                <button
                  type="button"
                  onClick={() => setShowInventoryValue((v) => !v)}
                  className="mt-0.5 text-[10px] font-semibold text-violet-700 hover:underline cursor-pointer"
                >
                  {showInventoryValue ? "Hide" : "Reveal"}
                </button>
              </div>
            )}
          </div>
          <div className="pt-2">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-slate-600">
              <input
                type="checkbox"
                checked={showKpi}
                onChange={toggleKpi}
                className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              <span>Show summary cards banner on page</span>
            </label>
          </div>
        </SidebarSection>

        {/* Export / Reports Section */}
        <SidebarSection title="Reports & Export">
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="btn-secondary w-full justify-center text-xs"
              disabled={exporting || !data}
              onClick={() => void downloadPdf()}
            >
              {exportProgress ? `Preparing ${exportProgress.loaded}/${exportProgress.total}…` : exporting ? "Preparing PDF…" : "Download PDF"}
            </button>
            <button
              type="button"
              className="btn-secondary w-full justify-center text-xs"
              disabled={!data}
              onClick={() => void downloadPdf(true)}
            >
              Customize PDF
            </button>
          </div>
        </SidebarSection>
      </PageMobileSidebar>

      {/* Desktop Header & Toolbars - preserved for screens lg and up */}
      <div className="hidden lg:block">
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
          <div className="w-40 shrink-0">
            <CategoryHeadSelect
              heads={heads.data?.heads}
              value={headKey}
              onChange={handleHeadChange}
            />
          </div>
          <select className="input w-auto" value={activityStage} onChange={(e) => setActivityStage(e.target.value as ProductActivityStatus | "")} aria-label="Sales activity">
            <option value="">All sales activity</option>
            <option value="Active">Active</option>
            <option value="Min-Active">Min-Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Never Sold">Never Sold</option>
          </select>
          {(search || category || headKey !== PRODUCT_TYPE_KEY || activityStage || quick) && (
            <button className="btn-secondary" onClick={() => { setSearch(""); setCategory(""); setHeadKey(PRODUCT_TYPE_KEY); setActivityStage(""); setQuick(""); }}>Clear All</button>
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
            {view === "table" && <ColumnsMenu columns={columns} hidden={cols.hidden} order={cols.order} onMove={cols.move} onChange={cols.setHidden} onReset={cols.reset} />}
            <button className="btn-secondary" disabled={exporting || !data} onClick={() => void downloadPdf()} title="Export every matching product and variation using the visible columns">
              {exportProgress ? `Preparing ${exportProgress.loaded}/${exportProgress.total}…` : exporting ? "Preparing PDF…" : "Download PDF"}
            </button>
            <button className="btn-secondary" disabled={!data} onClick={() => void downloadPdf(true)}>Customize PDF</button>
          </Toolbar>
        )}
      </div>

      <Alert message={flash?.text} kind={flash?.kind} />
      <Alert message={cols.error} />
      <Alert message={error} />

      {(() => {
        const productContent = (
          <div className={view === "grid" && rows.length > 0 ? "" : "card table-wrap"}>
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
              // A product with variations shows no price on its card; each variation has its own.
              const hasVariations = p.productType === "variable" || p.productType === "measured" || p.productType === "grouped";
              const onlyVar = p.variations.find((v) => v.active) ?? p.variations[0];
              const sale = hasVariations ? null : fmtSellRate(p.measure?.lengthUnit, onlyVar?.minSalePrice, onlyVar?.salePrice, "Sell: ");
              return (
                <div key={p.id} id={`product-card-${p.id}`} className={`group card relative flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md ${p.active ? "" : "opacity-60"} ${focus === p.id ? "card-highlight-blink" : ""}`}>
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
                        {stockCell(p.quantity, p.lowStockThreshold, p.unit, false, lenOf(p))}
                      </div>
                      {sale && <div className="text-sm font-semibold text-brand-700">{sale}</div>}
                    </div>
                  </Link>
                  <div className="absolute right-2 top-2 z-10 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {stockLink(p)}
                    {canEdit && (
                      <Link href={`/products/${p.id}/edit?returnTo=products`} className="flex h-8 w-8 items-center justify-center rounded-md bg-white/90 text-slate-600 shadow-sm hover:text-slate-900" title="Edit" aria-label={`Edit ${p.name}`}>
                        <EditIcon className="h-4 w-4" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th className="w-8" aria-label="Expand" />
                {visibleColumns.map(headCell)}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const variable = p.productType === "variable";
                const measured = p.productType === "measured";
                const sets = p.productType === "grouped";
                const expandable = variable || measured || sets;
                const expanded = open.has(p.id);
                const only = p.variations[0]!;
                // Child rows: one column per attribute, its unit in the header ("Size (mm)" → 3).
                const attrCols = variable ? variationAttributeColumns(p, p.variations) : [];
                const childCols = visibleColumns.filter((id) => CHILD_COLUMNS.includes(id));
                return (
                  <Fragment key={p.id}>
                    <tr id={`product-${p.id}`} className={`${expandable ? "cursor-pointer" : ""} ${focus === p.id ? "row-highlight-blink" : ""}`} onClick={expandable ? () => toggle(p.id) : undefined}>
                      <td>
                        {expandable && (
                          <button className="text-brand-600" aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${p.name}`} onClick={(e) => { e.stopPropagation(); toggle(p.id); }}>
                            {expanded ? "⊖" : "⊕"}
                          </button>
                        )}
                      </td>
                      {visibleColumns.map((id) => {
                        const cells: Record<string, React.ReactNode> = {
                          image: (
                            <td className="align-top py-2">
                              <ProductThumb src={p.imageUrl} name={p.name} className="h-11 w-11 rounded-md text-[7px]" />
                            </td>
                          ),
                          product: (
                            <td className={expandable ? "font-semibold text-slate-900 align-top py-2" : "text-slate-900 align-top py-2"}>
                              <Link href={`/products/${p.id}`} className="hover:text-brand-700 hover:underline" onClick={(e) => e.stopPropagation()}>{p.name}</Link>
                              {(variable || measured) && (
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
                          ),
                          sku: <td className="whitespace-nowrap font-mono text-xs text-slate-600">{expandable ? "—" : only.officialSku || only.shortName || "—"}</td>,
                          category: <td className="text-slate-600">{p.category?.name ?? "—"}</td>,
                          type: <td><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700">{TYPE_LABEL[p.productType]}</span></td>,
                          stock: <td>{stockCell(p.quantity, p.lowStockThreshold, sets ? "sets" : p.unit, expandable, lenOf(p))}</td>,
                          salePrice: <td className="whitespace-nowrap text-right font-medium text-slate-800">{expandable ? "" : priceRange(p, "salePrice")}</td>,
                          minSalePrice: <td className="whitespace-nowrap text-right text-slate-600">{expandable ? "" : priceRange(p, "minSalePrice")}</td>,
                          activity: <td><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${activityTone[p.activityStatus]}`}>{p.activityStatus}</span></td>,
                          actions: (
                            <td onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-1">
                                <button className={iconBtn} title="View details and action log" aria-label={`View ${p.name}`} onClick={() => setViewing({ product: p })}><EyeIcon className="h-4 w-4" /></button>
                                {seesVendor && !sets && (
                                  <button className={iconBtn} title="Vendor pricing" aria-label={`Vendor pricing for ${p.name}`} onClick={() => setVendorPricingTarget({ productId: p.id })}>
                                    <RupeeIcon className="h-4 w-4" />
                                  </button>
                                )}
                                {stockLink(p)}
                                {canEdit && <Link href={`/products/${p.id}/edit?returnTo=products`} className={iconBtn} title={expandable ? "Edit entire product" : "Edit"} aria-label={`Edit ${p.name}`}><EditIcon className="h-4 w-4" /></Link>}
                              </div>
                            </td>
                          ),
                        };
                        return <Fragment key={id}>{cells[id] ?? <td />}</Fragment>;
                      })}
                    </tr>
                    {sets && expanded && <SetTypeRows colSpan={visibleColumns.length + 1} groupId={p.id} layout="columns" productHref={`/products/${p.id}`} />}
                    {measured && expanded && (() => {
                      const extraCols = visibleColumns.filter((id) => ["sku", "salePrice", "minSalePrice"].includes(id));
                      return (
                        <MeasuredStock
                          product={p}
                          colSpan={visibleColumns.length + 1}
                          readOnly
                          extraCount={extraCols.length}
                          extraHeads={extraCols.map((id) => (
                            <th key={id} className={id === "salePrice" || id === "minSalePrice" ? "text-right" : ""}>
                              {id === "sku" ? "SKU" : id === "salePrice" ? "Selling Price" : "Min. Selling Price"}
                            </th>
                          ))}
                          extraCells={(variationId) => {
                            const v = p.variations.find((x) => x.id === variationId);
                            if (!v) return null;
                            return extraCols.map((id) => {
                              if (id === "sku") {
                                return (
                                  <td key="sku" className="whitespace-nowrap font-mono text-xs text-slate-600">
                                    {v.officialSku || v.shortName || "—"}
                                  </td>
                                );
                              }
                              if (id === "salePrice") {
                                return (
                                  <td key="salePrice" className="whitespace-nowrap text-right font-medium text-slate-800">
                                    {priceRange(p, "salePrice", [v])}
                                  </td>
                                );
                              }
                              if (id === "minSalePrice") {
                                return (
                                  <td key="minSalePrice" className="whitespace-nowrap text-right text-slate-600">
                                    {priceRange(p, "minSalePrice", [v])}
                                  </td>
                                );
                              }
                              return null;
                            });
                          }}
                          renderActions={(v) => {
                            const varLabel = variationLabel(v, p.attributes);
                            return (
                              <div className="flex justify-end gap-1">
                                <button className={iconBtn} title="View" aria-label={`View ${p.name} (${varLabel})`} onClick={() => setViewing({ product: p, variationId: v.id })}>
                                  <EyeIcon className="h-4 w-4" />
                                </button>
                                {seesVendor && (
                                  <button className={iconBtn} title="Vendor pricing" aria-label={`Vendor pricing for ${p.name} (${varLabel})`} onClick={() => setVendorPricingTarget({ productId: p.id, variationId: v.id })}>
                                    <RupeeIcon className="h-4 w-4" />
                                  </button>
                                )}
                                {stockLink(p, `${p.name} (${varLabel})`)}
                              </div>
                            );
                          }}
                        />
                      );
                    })()}
                    {variable && expanded && (
                      <tr>
                        <td colSpan={visibleColumns.length + 1} className="bg-slate-50/70 !p-0">
                          <div className="child-panel">
                            <table className="table rounded-md bg-white">
                              <thead>
                                <tr>
                                  <th>Order</th>
                                  {showColumn("image") && <th />}
                                  {attrCols.map((c) => <th key={c.name}>{c.name}{c.unit ? ` (${c.unit})` : ""}</th>)}
                                  {visibleColumns.filter((id) => CHILD_COLUMNS.includes(id)).map(headCell)}
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
                                      {attrCols.map((c) => <td key={c.name} className="whitespace-nowrap text-slate-900">{v.attributes[c.name] ?? "—"}</td>)}
                                      {childCols.map((id) => {
                                        const cells: Record<string, React.ReactNode> = {
                                          sku: <td className="whitespace-nowrap font-mono text-xs text-slate-600">{v.officialSku || v.shortName || "—"}</td>,
                                          stock: <td>{stockCell(v.quantity, v.lowStockThreshold, p.unit, false, lenOf(p))}</td>,
                                          salePrice: <td className="whitespace-nowrap text-right font-medium text-slate-800">{priceRange(p, "salePrice", [v])}</td>,
                                          minSalePrice: <td className="whitespace-nowrap text-right text-slate-600">{priceRange(p, "minSalePrice", [v])}</td>,
                                          actions: (
                                            <td>
                                              <div className="flex justify-end gap-1">
                                                <button className={iconBtn} title="View" aria-label={`View ${p.name} (${varLabel})`} onClick={() => setViewing({ product: p, variationId: v.id })}><EyeIcon className="h-4 w-4" /></button>
                                                {seesVendor && (
                                                  <button className={iconBtn} title="Vendor pricing" aria-label={`Vendor pricing for ${p.name} (${varLabel})`} onClick={() => setVendorPricingTarget({ productId: p.id, variationId: v.id })}>
                                                    <RupeeIcon className="h-4 w-4" />
                                                  </button>
                                                )}
                                                {stockLink(p, `${p.name} (${varLabel})`)}
                                              </div>
                                            </td>
                                          ),
                                        };
                                        return <Fragment key={id}>{cells[id]}</Fragment>;
                                      })}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
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
          const currentHead = heads.data?.heads.find((h) => (h.id ?? PRODUCT_TYPE_KEY) === headKey);
          return (
            <ShopLayout
              rail={
                <CategoryRail
                  data={cats.data ?? null}
                  selected={category || "all"}
                  onSelect={(key) => setCategory(key === "all" ? "" : key)}
                  alerts
                  includeUncategorized={headKey === PRODUCT_TYPE_KEY}
                  headDropdown={
                    <CategoryHeadSelect
                      heads={heads.data?.heads}
                      value={headKey}
                      onChange={handleHeadChange}
                    />
                  }
                />
              }
              title={
                category === "none"
                  ? "Uncategorized"
                  : category
                  ? cats.data?.categories.find((c) => c.id === category)?.name ?? "Category"
                  : currentHead && currentHead.id !== null
                  ? `All ${currentHead.name}`
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

