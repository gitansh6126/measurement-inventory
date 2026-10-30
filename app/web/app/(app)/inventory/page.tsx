"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { ColumnsMenu } from "@/components/ColumnsMenu";
import { ViewToggle } from "@/components/catalog/ViewToggle";
import { CategoryRail } from "@/components/catalog/CategoryRail";
import { ShopLayout } from "@/components/catalog/ShopLayout";
import { ProductThumb } from "@/components/ProductThumb";
import { BoxesIcon, CogIcon, ShiftIcon, SlidersIcon } from "@/components/icons";
import { PageMobileSidebar, SidebarField, SidebarSection } from "@/components/PageMobileSidebar";
import { useCan } from "@/components/MeContext";
import { StockBadge, stockState } from "@/components/StockBadge";
import { ProductKind, ProductTile } from "@/components/products/ProductTile";
import { StockEditDrawer } from "@/components/products/StockEditDrawer";
import { MeasuredStock, MeasuredStockPanel } from "@/components/measure/MeasuredStock";
import { AddRollsModal } from "@/components/measure/RollActions";
import { AddSetsModal } from "@/components/sets/SetsPanel";
import { SetCountIn, SetTypeRows, SetTypesBadge, SetTypesTable, setTypeName } from "@/components/sets/SetTypes";
import { RateField } from "@/components/measure/RateField";
import { LengthViewToggle } from "@/components/measure/LengthViewToggle";
import { VariationOrderCell } from "@/components/VariationOrderCell";
import { Alert, EmptyState, Modal, PageHeader, SearchInput, Segmented, TableSkeleton, Toolbar } from "@/components/ui";
import { api } from "@/lib/api";
import type { ColumnDef } from "@/lib/inventoryColumns";
import type { Category, CategoryStatsList, InventoryList, SetTypeRow, StockFilter, StockProduct, StockVariation } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { money, variationLabel } from "@/lib/format";
import { fmtLen, fmtSellRate, stockLengthOf } from "@/lib/measure";
import { useDebounced } from "@/lib/useDebounced";
import { scrollToFocus } from "@/lib/scrollToFocus";
import { usePreference } from "@/lib/usePreference";
import { useTableColumns } from "@/lib/useTableColumns";
import { useEntryUnits } from "@/lib/useEntryUnits";
import { useViewMode } from "@/lib/useViewMode";
import { variationAttributeColumns } from "@/lib/variationColumns";
import { useWarehouses } from "@/lib/useWarehouses";
import { useLengthView } from "@/lib/lengthView";

// main v2 StockInPanel (index.html) rebuilt with marble UI (D23). Inventory owns the new stock
// level, selling price and minimum stock (BR-08a). Only the fields a user actually changes are
// sent; one save is one transaction (POST /api/inventory/stock-in).
//
// V2 (plan §1.3, §1.10, §3.3): stock tabs (All / Low / Out / Negative) and search run in SQL on
// the server; Expand all / Collapse all; a per-user Columns picker; a "Receive" shortcut on
// negative rows. Grid cards open a stock drawer (StockEditDrawer) instead of the product page. Unsaved edits remember their starting values, so changing a filter or tab
// never drops them.

const REASONS = ["Stock Received", "Opening Stock", "Manual Count", "Return to Stock", "Purchase Add", "Damaged", "Correction", "Other"];
// `free`: V3.1 free stock per warehouse when the edit started (a price-only row is saved against
// the default warehouse and needs its expected stock).
interface Base { quantity: number; salePrice: string; minSalePrice: string; lowStockThreshold: number; label: string; free?: Record<string, number> }
type Edits = Record<string, { qty?: string; price?: string; minPrice?: string; min?: string; base: Base }>;
// V3.1 (WH-12): with warehousing on, new stock is typed per (variation, warehouse); key "variationId|warehouseId".
type WarehouseEdits = Record<string, { qty: string; base: number; variationId: string; warehouseId: string }>;
// 0041: grouped product child rows (set types), key "groupId|typeKey": new set count, prices and
// minimum stock per set type (the grouped product has no standard price).
interface SetBase { count: number; salePrice: string; minSalePrice: string; lowStockThreshold: number; openingCount: number; label: string }
type SetEdits = Record<string, { groupId: string; typeKey: string; count?: string; price?: string; minPrice?: string; min?: string; base: SetBase }>;

/** Free stock of a variation in one warehouse (balance minus what is fitted in sets). */
const freeIn = (v: StockVariation, warehouseId: string) => {
  const r = v.byWarehouse?.find((w) => w.warehouseId === warehouseId);
  return r ? Math.round((r.quantity - (r.inSets ?? 0)) * 1000) / 1000 : 0;
};

// On-screen columns (identity columns are always shown). Order is per user and can be changed
// by dragging a header or in the Columns menu (useTableColumns); the image sits in the product
// cell, so it is pinned.
const SCREEN_COLUMNS: ColumnDef[] = [
  { id: "image", label: "Image", pinned: true, value: () => "" },
  { id: "product", label: "Product", fixed: true, value: () => "" },
  { id: "category", label: "Category", value: () => "" },
  { id: "sku", label: "SKU", value: () => "" },
  { id: "shortName", label: "Short Name", value: () => "" },
  { id: "stock", label: "Current Stock", fixed: true, value: () => "" },
  { id: "newStock", label: "New Stock", fixed: true, value: () => "" },
  { id: "change", label: "Change", value: () => "" },
  { id: "minSalePrice", label: "Minimum Selling Price", value: () => "" },
  { id: "salePrice", label: "Selling Price", value: () => "" },
  { id: "minStock", label: "Min Stock", value: () => "" },
];
/** Stock and price columns, shared by product rows, variation sub-tables and the stock drawer. */
const EDIT_IDS = ["stock", "newStock", "change", "minSalePrice", "salePrice", "minStock"];
const PREF_KEY = "stockin.columns";

function StockIn() {
  useLengthView();
  const router = useRouter();
  const searchParams = useSearchParams();
  const focus = searchParams.get("focus");
  const canConfigure = useCan("inventory.configure");
  const canAdjust = useCan("stock.adjust");
  // Selling prices are typed in the user's remembered sale rate unit.
  const saleUnits = useEntryUnits("sale");
  const canEditProducts = useCan("product.write");
  const canShift = useCan("stock.transfer");
  // V3.1: grouped rows add sets through the opening-sets sheet (admin, D20).
  const canOpenSets = useCan("set.opening");
  const [addingSets, setAddingSets] = useState<string | null>(null);

  // V3.1 warehouse filter (plan §4.3): "" = all warehouses. A link (?warehouse=) wins, else the
  // user's remembered choice. Off while warehousing is not set up (WH-0).
  const wh = useWarehouses();
  const whPref = usePreference<{ id: string }>("stockin.warehouse", { id: "" });
  const [whChoice, setWhChoice] = useState<string | null>(null);
  const wanted = whChoice ?? searchParams.get("warehouse") ?? whPref.value.id ?? "";
  const whFilter = wh.enabled && wanted && wh.byId.has(wanted) ? wanted : "";
  const chooseWarehouse = (id: string) => {
    setWhChoice(id);
    void whPref.save({ id });
  };
  const [whEdits, setWhEdits] = useState<WarehouseEdits>({});
  // "+ add stock in another warehouse": warehouses added to a variation's rows before typing.
  const [extraWh, setExtraWh] = useState<Record<string, string[]>>({});

  // ?search= (e.g. "Manage stock & prices" on a product page) pre-fills the search.
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [category, setCategory] = useState(() => searchParams.get("category") ?? searchParams.get("categoryId") ?? "");
  const [groupMode, setGroupMode] = useState<"all" | "category">("category");
  const [stage, setStage] = useState<StockFilter>(() => {
    const s = searchParams.get("stage");
    return s === "low" || s === "out" || s === "negative" ? s : "all";
  });
  useEffect(() => {
    const s = searchParams.get("stage");
    if (s === "low" || s === "out" || s === "negative" || s === "all") setStage(s);
  }, [searchParams]);
  const q = useDebounced(search.trim(), 300);
  const params = new URLSearchParams({ state: stage, ...(q ? { q } : {}), ...(category ? { categoryId: category } : {}) }).toString();
  const { data, error, reload, loading } = useApi<InventoryList>(`/inventory?${params}`);
  const cats = useApi<CategoryStatsList>("/categories?stats=1");
  // V3.1 (0038): categories of the other heads in the filter too (Industry, Material…).
  const otherCats = useApi<{ categories: Category[] }>("/categories?headId=all");
  const categoryName = (id: string) =>
    cats.data?.categories.find((c) => c.id === id)?.name ?? otherCats.data?.categories.find((c) => c.id === id)?.name;
  // Sets of a grouped product under the chosen category (G-A); none for "Uncategorized".
  const setCategory_ = category && category !== "none" ? category : undefined;
  // Category column is off by default (the By Category layout already groups by it).
  const availableColumns = SCREEN_COLUMNS.filter(
    (column) => (canConfigure || !["minSalePrice", "salePrice", "minStock"].includes(column.id)) && (canAdjust || column.id !== "newStock"),
  );
  const cols = useTableColumns(PREF_KEY, availableColumns, ["category"]);
  // A focus link (from Add Product or a product page) needs the editable table, so it always opens the Table view.
  const [savedView, setView] = useViewMode("inventory.products", "grid");
  const view = focus ? "table" : savedView;
  const visible = cols.visible;
  const show = visible;
  /** Main table columns after the expand column, in the user's order. */
  const mainCols = cols.shown(availableColumns.filter((c) => !c.pinned).map((c) => c.id));
  /** Stock / price columns in the user's order; `all` (drawer) ignores hidden ones. */
  const editIds = (all = false) => (all ? cols.order.filter((id) => EDIT_IDS.includes(id) && availableColumns.some((c) => c.id === id)) : mainCols.filter((id) => EDIT_IDS.includes(id)));

  const [showTableSettings, setShowTableSettings] = useState<boolean>(() => {
    if (searchParams.get("search")) return true;
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("inventory.show_table_settings");
      if (stored !== null) return stored === "true";
    }
    return false;
  });

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (category) count++;
    if (stage !== "all") count++;
    if (whFilter) count++;
    return count;
  }, [category, stage, whFilter]);

  const toggleTableSettings = () => {
    setShowTableSettings((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") localStorage.setItem("inventory.show_table_settings", String(next));
      return next;
    });
  };

  const [edits, setEdits] = useState<Edits>({});
  const [setEdits_, setSetEdits] = useState<SetEdits>({});
  const [reason, setReason] = useState(focus ? "Opening Stock" : "Stock Received");
  const [notes, setNotes] = useState("");
  const [openGroup, setOpenGroup] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  // Measured rows in the stock drawer: add rolls, or see one variation's pieces (owner design 2026-10-16).
  const [measured, setMeasured] = useState<{ kind: "add" | "view"; product: StockProduct; variation: StockVariation } | null>(null);
  const [variationOrder, setVariationOrder] = useState<Record<string, string[]>>({});
  const [reordering, setReordering] = useState("");
  const [draggedVariation, setDraggedVariation] = useState<{ productId: string; variationId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ productId: string; variationId: string; position: "before" | "after" } | null>(null);

  // V3.1 (0038, VC8): under a category on some variations only, rows list just those variations;
  // `fullById` keeps every variation for reordering.
  const fullById = useMemo(() => new Map((data?.products ?? []).map((p) => [p.id, p])), [data]);
  const products = useMemo(
    () => (data?.products ?? []).map((p) => (p.categoryMatch ? { ...p, variations: p.variations.filter((v) => p.categoryMatch!.includes(v.id)) } : p)),
    [data],
  );
  const ofAll = (p: StockProduct) => {
    const full = fullById.get(p.id);
    return p.categoryMatch && full ? ` of ${full.variations.filter((v) => v.active).length}` : "";
  };
  const summary = data?.summary;

  // Keep product creation links focused without restricting which edited rows can be saved.
  useEffect(() => {
    if (!data) return;
    if (focus) {
      setOpenGroup((prev) => ({ ...prev, [focus]: true }));
      return scrollToFocus(`stock-in-${focus}`, `stock-in-grid-${focus}`);
    }
  }, [data, focus]);

  const parse = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v.trim());
  const changedOf = (id: string) => {
    const e = edits[id];
    if (!e) return { qty: false, price: false, minPrice: false, min: false };
    const qv = parse(e.qty);
    const price = parse(e.price);
    const minPrice = parse(e.minPrice);
    const min = parse(e.min);
    return {
      qty: qv !== undefined && Number(qv) !== e.base.quantity,
      price: price !== undefined && Number(price) !== Number(e.base.salePrice),
      minPrice: minPrice !== undefined && Number(minPrice) !== Number(e.base.minSalePrice),
      min: min !== undefined && Number(min) !== e.base.lowStockThreshold,
    };
  };
  const whDirtyKeys = Object.keys(whEdits).filter((k) => {
    const e = whEdits[k]!;
    const qv = parse(e.qty);
    return qv !== undefined && Number(qv) !== e.base;
  });
  const setChangedOf = (k: string) => {
    const e = setEdits_[k];
    if (!e) return { count: false, price: false, minPrice: false, min: false };
    const c = parse(e.count);
    const price = parse(e.price);
    const minPrice = parse(e.minPrice);
    const min = parse(e.min);
    return {
      count: c !== undefined && Number(c) !== e.base.count,
      price: price !== undefined && Number(price) !== Number(e.base.salePrice),
      minPrice: minPrice !== undefined && Number(minPrice) !== Number(e.base.minSalePrice),
      min: min !== undefined && Number(min) !== e.base.lowStockThreshold,
    };
  };
  const dirtySetKeys = Object.keys(setEdits_).filter((k) => Object.values(setChangedOf(k)).some(Boolean));
  const dirtyIds = [...new Set([...Object.keys(edits).filter((id) => Object.values(changedOf(id)).some(Boolean)), ...whDirtyKeys.map((k) => whEdits[k]!.variationId)])];
  const pricedCount =
    dirtyIds.filter((id) => changedOf(id).price || changedOf(id).minPrice || changedOf(id).min).length +
    dirtySetKeys.filter((k) => setChangedOf(k).price || setChangedOf(k).minPrice || setChangedOf(k).min).length;
  /** Rows with changes: items plus set types. */
  const changeCount = dirtyIds.length + dirtySetKeys.length;

  const variationPriceError = (v: StockVariation, e?: Edits[string]) => {
    if (!e) return null;
    const c = changedOf(v.id);
    if (!c.price && !c.minPrice) return null;
    const sp = parse(e.price) !== undefined ? Number(e.price) : Number(e.base.salePrice);
    const msp = parse(e.minPrice) !== undefined ? Number(e.minPrice) : Number(e.base.minSalePrice);
    if (Number.isFinite(sp) && Number.isFinite(msp) && msp > sp) {
      return { minSalePrice: msp, salePrice: sp };
    }
    return null;
  };

  const setTypePriceError = (groupId: string, t: SetTypeRow) => {
    const k = `${groupId}|${t.typeKey}`;
    const e = setEdits_[k];
    if (!e) return null;
    const c = setChangedOf(k);
    if (!c.price && !c.minPrice) return null;
    const sp = parse(e.price) !== undefined ? Number(e.price) : Number(e.base.salePrice);
    const msp = parse(e.minPrice) !== undefined ? Number(e.minPrice) : Number(e.base.minSalePrice);
    if (Number.isFinite(sp) && Number.isFinite(msp) && msp > sp) {
      return { minSalePrice: msp, salePrice: sp };
    }
    return null;
  };

  const hasPriceErrors = useMemo(() => {
    for (const id of dirtyIds) {
      const e = edits[id];
      if (!e) continue;
      const c = changedOf(id);
      if (c.price || c.minPrice) {
        const sp = parse(e.price) !== undefined ? Number(e.price) : Number(e.base.salePrice);
        const msp = parse(e.minPrice) !== undefined ? Number(e.minPrice) : Number(e.base.minSalePrice);
        if (Number.isFinite(sp) && Number.isFinite(msp) && msp > sp) return true;
      }
    }
    for (const k of dirtySetKeys) {
      const e = setEdits_[k];
      if (!e) continue;
      const c = setChangedOf(k);
      if (c.price || c.minPrice) {
        const sp = parse(e.price) !== undefined ? Number(e.price) : Number(e.base.salePrice);
        const msp = parse(e.minPrice) !== undefined ? Number(e.minPrice) : Number(e.base.minSalePrice);
        if (Number.isFinite(sp) && Number.isFinite(msp) && msp > sp) return true;
      }
    }
    return false;
  }, [dirtyIds, dirtySetKeys, edits, setEdits_]);
  const setEdit = (groupId: string, t: SetTypeRow, patch: Partial<Omit<SetEdits[string], "base" | "groupId" | "typeKey">>) => {
    const k = `${groupId}|${t.typeKey}`;
    setSetEdits((e) => ({
      ...e,
      [k]: {
        ...e[k],
        ...patch,
        groupId,
        typeKey: t.typeKey,
        base: e[k]?.base ?? { count: t.count, salePrice: t.salePrice, minSalePrice: t.minSalePrice, lowStockThreshold: t.lowStockThreshold, openingCount: t.openingCount, label: setTypeName(t) },
      },
    }));
  };

  const setItemEdit = (p: StockProduct, v: StockVariation, patch: Partial<Omit<Edits[string], "base">>) => {
    setEdits((e) => ({
      ...e,
      [v.id]: {
        ...e[v.id],
        ...patch,
        base: e[v.id]?.base ?? {
          quantity: v.quantity,
          salePrice: v.salePrice,
          minSalePrice: v.minSalePrice,
          lowStockThreshold: v.lowStockThreshold,
          label: `${p.name} ${v.shortName}`,
          ...(v.byWarehouse ? { free: Object.fromEntries(wh.warehouses.map((w) => [w.id, freeIn(v, w.id)])) } : {}),
        },
      },
    }));
  };
  const setWhEdit = (v: StockVariation, warehouseId: string, qty: string) => {
    const key = `${v.id}|${warehouseId}`;
    setWhEdits((e) => ({ ...e, [key]: { qty, base: e[key]?.base ?? freeIn(v, warehouseId), variationId: v.id, warehouseId } }));
  };
  /** Warehouses shown for a variation: the filtered one, else every one holding it, added or edited. */
  const whRowsOf = (v: StockVariation) => {
    if (whFilter) return [whFilter];
    const ids = [
      ...(v.byWarehouse ?? []).filter((r) => r.quantity !== 0).map((r) => r.warehouseId),
      ...(extraWh[v.id] ?? []),
      ...Object.values(whEdits).filter((e) => e.variationId === v.id).map((e) => e.warehouseId),
    ];
    const unique = [...new Set(ids)].sort((a, b) => (wh.byId.get(a)?.sortOrder ?? 0) - (wh.byId.get(b)?.sortOrder ?? 0));
    return unique.length ? unique : wh.defaultWarehouse ? [wh.defaultWarehouse.id] : [];
  };

  // `only` limits the save to some variations (the drawer saves just its product's rows) and
  // `onlyGroup` to one grouped product's set types.
  async function save(only?: string[], onlyGroup?: string): Promise<boolean> {
    setFlash(null);
    setDrawerError(null);
    const fail = (text: string) => {
      if (only) setDrawerError(text);
      else setFlash({ kind: "error", text });
      return false;
    };
    const ids = only ? dirtyIds.filter((id) => only.includes(id)) : dirtyIds;
    type Row = { variationId: string; warehouseId?: string; expectedQuantity: number; quantity?: number; salePrice?: string; minSalePrice?: string; lowStockThreshold?: number };
    const priceFields = (id: string) => {
      const c = changedOf(id);
      const e = edits[id];
      if (!e) return {};
      return {
        ...(c.price ? { salePrice: e.price!.trim() } : {}),
        ...(c.minPrice ? { minSalePrice: e.minPrice!.trim() } : {}),
        ...(c.min ? { lowStockThreshold: Number(e.min) } : {}),
      };
    };
    let rows: Row[];
    const whKeys = whDirtyKeys.filter((k) => ids.includes(whEdits[k]!.variationId));
    if (wh.enabled) {
      // One row per edited (item, warehouse); prices ride on the item's first row, or on a row for
      // the default warehouse that changes no stock (WH-12: prices are company-wide).
      rows = whKeys.map((k) => {
        const e = whEdits[k]!;
        return { variationId: e.variationId, warehouseId: e.warehouseId, expectedQuantity: e.base, quantity: Number(e.qty) };
      });
      for (const id of ids) {
        const fields = priceFields(id);
        if (!Object.keys(fields).length) continue;
        const row = rows.find((r) => r.variationId === id);
        if (row) Object.assign(row, fields);
        else {
          const def = wh.defaultWarehouse?.id;
          rows.push({ variationId: id, ...(def ? { warehouseId: def } : {}), expectedQuantity: def ? (edits[id]?.base.free?.[def] ?? 0) : edits[id]!.base.quantity, ...fields });
        }
      }
    } else {
      rows = ids.map((id) => {
        const c = changedOf(id);
        const e = edits[id]!;
        return { variationId: id, expectedQuantity: e.base.quantity, ...(c.qty ? { quantity: Number(e.qty) } : {}), ...priceFields(id) };
      });
    }
    // 0041: set-type rows, one request per grouped product.
    const setKeys = dirtySetKeys.filter((k) => (only ? setEdits_[k]!.groupId === onlyGroup : true));
    type SetRow = { typeKey: string; expectedCount?: number; count?: number; salePrice?: string; minSalePrice?: string; lowStockThreshold?: number };
    const setRowsByGroup = new Map<string, SetRow[]>();
    for (const k of setKeys) {
      const e = setEdits_[k]!;
      const c = setChangedOf(k);
      const row: SetRow = {
        typeKey: e.typeKey,
        ...(c.count ? { expectedCount: e.base.count, count: Number(e.count) } : {}),
        ...(c.price ? { salePrice: e.price!.trim() } : {}),
        ...(c.minPrice ? { minSalePrice: e.minPrice!.trim() } : {}),
        ...(c.min ? { lowStockThreshold: Number(e.min) } : {}),
      };
      if (c.count && Number(e.count) < e.base.count - e.base.openingCount) {
        return fail(`${e.base.label}: only ${e.base.openingCount} set(s) were added in Stock In and can be removed here; sets from a purchase are removed by cancelling the purchase`);
      }
      setRowsByGroup.set(e.groupId, [...(setRowsByGroup.get(e.groupId) ?? []), row]);
    }
    if (!rows.length && !setKeys.length) return fail("No changes to save");
    for (const id of ids) {
      const e = edits[id];
      if (!e) continue;
      const c = changedOf(id);
      if (c.price || c.minPrice) {
        const sp = parse(e.price) !== undefined ? Number(e.price) : Number(e.base.salePrice);
        const msp = parse(e.minPrice) !== undefined ? Number(e.minPrice) : Number(e.base.minSalePrice);
        if (Number.isFinite(sp) && Number.isFinite(msp) && msp > sp) {
          return fail(`${e.base.label || "Product"}: minimum selling price (₹${msp}) cannot be higher than selling price (₹${sp})`);
        }
      }
    }
    for (const k of setKeys) {
      const e = setEdits_[k];
      if (!e) continue;
      const c = setChangedOf(k);
      if (c.price || c.minPrice) {
        const sp = parse(e.price) !== undefined ? Number(e.price) : Number(e.base.salePrice);
        const msp = parse(e.minPrice) !== undefined ? Number(e.minPrice) : Number(e.base.minSalePrice);
        if (Number.isFinite(sp) && Number.isFinite(msp) && msp > sp) {
          return fail(`${e.base.label || "Set"}: minimum selling price (₹${msp}) cannot be higher than selling price (₹${sp})`);
        }
      }
    }
    const badSet = [...setRowsByGroup.values()].flat().find((r) =>
      ("count" in r && (!Number.isInteger(r.count) || r.count! < 0 || r.count! > 1000)) ||
      ("lowStockThreshold" in r && (!Number.isInteger(r.lowStockThreshold) || r.lowStockThreshold! < 0)) ||
      ("salePrice" in r && !/^\d{1,10}$/.test(String(r.salePrice))) ||
      ("minSalePrice" in r && !/^\d{1,10}$/.test(String(r.minSalePrice)))
    );
    if (badSet) return fail("Set counts, prices and minimum stock must be whole numbers, 0 or more");
    const bad = rows.find((r) =>
      ("quantity" in r && (!Number.isInteger(r.quantity) || r.quantity! < 0)) ||
      ("lowStockThreshold" in r && (!Number.isInteger(r.lowStockThreshold) || r.lowStockThreshold! < 0)) ||
      ("salePrice" in r && !/^\d{1,10}$/.test(String(r.salePrice))) ||
      ("minSalePrice" in r && !/^\d{1,10}$/.test(String(r.minSalePrice)))
    );
    if (bad) return fail("Prices, quantities, and minimum stock must be whole numbers, 0 or more");
    setSaving(true);
    try {
      const messages: string[] = [];
      if (rows.length) messages.push((await api<{ message: string }>("/inventory/stock-in", { method: "POST", body: { reason, notes: notes || null, rows } })).message);
      for (const [groupId, setRows] of setRowsByGroup) {
        const r = await api<{ added: number; removed: number }>(`/sets/types/${groupId}/stock-in`, { method: "POST", body: { reason, notes: notes || null, warehouseId: whFilter || null, rows: setRows } });
        // Saved: drop this product's set edits now, so a failure on the next one keeps only its own.
        setSetEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([, e]) => e.groupId !== groupId)));
        messages.push(r.added || r.removed ? `Sets: ${r.added ? `+${r.added}` : ""}${r.added && r.removed ? " " : ""}${r.removed ? `−${r.removed}` : ""}` : "Set prices saved");
      }
      setEdits((prev) => (only ? Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.includes(id))) : {}));
      setWhEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([, e]) => !ids.includes(e.variationId))));
      setExtraWh({});
      setNotes("");
      setFlash({ kind: "success", text: messages.join(" · ") });
      await reload();
      return true;
    } catch (e) {
      return fail(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  // Expand / Collapse all act on the variable, measured or grouped products currently listed (the filtered set).
  const variable = products.filter((p) => p.productType === "variable" || p.productType === "measured" || p.productType === "grouped");
  const expandAll = (open: boolean) => setOpenGroup(open ? Object.fromEntries(variable.map((p) => [p.id, true])) : {});
  const toggleGroup = (id: string) => setOpenGroup((prev) => ({ ...prev, [id]: !prev[id] }));

  const orderedVariations = (shown: StockProduct) => {
    const p = fullById.get(shown.id) ?? shown;
    const byId = new Map(p.variations.map((v) => [v.id, v]));
    const ids = variationOrder[p.id] ?? p.variations.map((v) => v.id);
    return [...ids.filter((id) => byId.has(id)).map((id) => byId.get(id)!), ...p.variations.filter((v) => !ids.includes(v.id))];
  };
  /** Active variation rows in order, only those in the chosen category (VC8). */
  const shownVariations = (p: StockProduct) => orderedVariations(p).filter((v) => v.active && (!p.categoryMatch || p.categoryMatch.includes(v.id)));

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
    const visible = shownVariations(p).map((v) => v.id);
    if (to < 0 || to >= visible.length || from === to || reordering === p.id) return;
    const reordered = [...visible];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved!);
    const visibleIds = new Set(visible);
    let nextIndex = 0;
    const next = orderedVariations(p).map((v) => visibleIds.has(v.id) ? reordered[nextIndex++]! : v.id);
    void saveVariationOrder(p, next);
  }

  const startVariationDrag = (event: DragEvent<HTMLButtonElement>, productId: string, variationId: string) => {
    setDraggedVariation({ productId, variationId });
    setDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", variationId);
  };

  // Opening a product page leaves Stock In; unsaved edits would be lost.
  const guardLeave = (e: React.MouseEvent) => {
    if (changeCount && !window.confirm("Leave Stock In and discard the unsaved changes?")) e.preventDefault();
  };

  // V3.1 "In warehouses" chips under the stock: every warehouse holding it, or (filtered) the others.
  const whChips = (v: StockVariation, fmt: (q: number) => string = (q) => String(q)) => {
    if (!v.byWarehouse) return null;
    const rows = v.byWarehouse.filter((r) => r.quantity !== 0 && r.warehouseId !== whFilter);
    if (!rows.length) return null;
    return (
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
        {whFilter && <span className="text-slate-400">Other:</span>}
        {rows.map((r) => (
          <span key={r.warehouseId} className={`rounded px-1.5 ${r.quantity < 0 ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"}`} title={r.inSets ? `${r.inSets} fitted in sets` : undefined}>
            {r.code} {fmt(r.quantity)}
          </span>
        ))}
      </div>
    );
  };

  // Lays out cells (full <td>s keyed by column id) in column order; a run of columns a row has
  // no cell for becomes one spanning cell, the first one carrying `hint`.
  const rowCells = (ids: string[], map: Record<string, ReactNode>, hint?: ReactNode) => {
    const out: ReactNode[] = [];
    let gap: string[] = [];
    const flush = () => {
      if (!gap.length) return;
      out.push(<td key={`gap-${gap[0]}`} colSpan={gap.length}>{hint}</td>);
      hint = null;
      gap = [];
    };
    for (const id of ids) {
      if (id in map) {
        flush();
        out.push(<Fragment key={id}>{map[id]}</Fragment>);
      } else gap.push(id);
    }
    flush();
    return out;
  };

  // Editable cells shared by simple products, variation rows and the stock drawer, keyed by
  // column id (Current, New Stock, Change, prices, Min Stock); shown in the user's column order.
  const editCellMap = (p: StockProduct, v: StockVariation): Record<string, ReactNode> => {
    const e = edits[v.id];
    const base = e?.base.quantity ?? v.quantity;
    const target = parse(e?.qty) !== undefined ? Number(e!.qty) : base;
    const diff = Number.isFinite(target) ? target - base : 0;
    const c = changedOf(v.id);
    const priceErr = variationPriceError(v, e);
    const step = (d: number) => setItemEdit(p, v, { qty: String(Math.max(0, (Number.isFinite(target) ? target : base) + d)) });
    // A Measured rate is per m, or per ft on a feet + inches product; it may be typed per another
    // unit and is converted (0028).
    const lu = p.productType === "measured" ? p.measure?.lengthUnit : undefined;
    const ratePref = lu ? { preferredUnit: saleUnits.rateUnit(lu), onUnitChange: (u: string) => saleUnits.setRateUnit(lu, u) } : {};
    const prices: Record<string, ReactNode> = lu ? {
        minSalePrice: (
          <td className={priceErr ? "bg-rose-50/50" : c.minPrice ? "bg-brand-50" : ""}>
            <RateField
              compact
              followLengthView
              unit={lu}
              label={`Minimum selling price of ${v.shortName}`}
              value={e?.minPrice ?? String(Number(v.minSalePrice))}
              onChange={(x) => setItemEdit(p, v, { minPrice: x })}
              hasError={!!priceErr}
              error={priceErr ? `Must be ≤ ₹${priceErr.salePrice}` : undefined}
              title={priceErr ? `Minimum selling price (₹${priceErr.minSalePrice}) cannot be higher than selling price (₹${priceErr.salePrice})` : undefined}
              {...ratePref}
            />
          </td>
        ),
        salePrice: (
          <td className={priceErr ? "bg-rose-50/50" : c.price ? "bg-brand-50" : ""}>
            <RateField
              compact
              followLengthView
              unit={lu}
              label={`Selling price of ${v.shortName}`}
              value={e?.price ?? String(Number(v.salePrice))}
              onChange={(x) => setItemEdit(p, v, { price: x })}
              hasError={!!priceErr}
              error={priceErr ? `Must be ≥ ₹${priceErr.minSalePrice}` : undefined}
              title={priceErr ? `Selling price (₹${priceErr.salePrice}) cannot be lower than minimum selling price (₹${priceErr.minSalePrice})` : undefined}
              {...ratePref}
            />
          </td>
        ),
        minStock: (
          <td><input className={`input w-16 sm:w-20 h-8 text-xs sm:h-9 sm:text-sm ${c.min ? "border-brand-500 bg-brand-50" : ""}`} inputMode="numeric" aria-label={`Minimum stock of ${v.shortName}`} value={e?.min ?? String(v.lowStockThreshold)} onChange={(ev) => setItemEdit(p, v, { min: ev.target.value.replace(/[^\d]/g, "") })} /></td>
        ),
      } : {
        minSalePrice: (
            <td className={priceErr ? "bg-rose-50/50" : ""}>
              <input
                className={`input w-24 ${priceErr ? "border-rose-500 bg-rose-50 text-rose-900 focus:border-rose-600 focus:ring-rose-500" : c.minPrice ? "border-brand-500 bg-brand-50" : ""}`}
                inputMode="numeric"
                aria-label={`Minimum selling price of ${v.shortName}`}
                title={priceErr ? `Minimum selling price (₹${priceErr.minSalePrice}) cannot be higher than selling price (₹${priceErr.salePrice})` : undefined}
                value={e?.minPrice ?? String(Number(v.minSalePrice))}
                onChange={(ev) => setItemEdit(p, v, { minPrice: ev.target.value.replace(/[^\d]/g, "") })}
              />
              {priceErr && (
                <div className="mt-0.5 text-[10px] font-medium leading-tight text-rose-600" role="alert">
                  Must be ≤ ₹{priceErr.salePrice}
                </div>
              )}
            </td>
          ),
        salePrice: (
            <td className={priceErr ? "bg-rose-50/50" : ""}>
              <input
                className={`input w-24 ${priceErr ? "border-rose-500 bg-rose-50 text-rose-900 focus:border-rose-600 focus:ring-rose-500" : c.price ? "border-brand-500 bg-brand-50" : ""}`}
                inputMode="numeric"
                aria-label={`Selling price of ${v.shortName}`}
                title={priceErr ? `Selling price (₹${priceErr.salePrice}) cannot be lower than minimum selling price (₹${priceErr.minSalePrice})` : undefined}
                value={e?.price ?? String(Number(v.salePrice))}
                onChange={(ev) => setItemEdit(p, v, { price: ev.target.value.replace(/[^\d]/g, "") })}
              />
            </td>
          ),
        minStock: (
            <td><input className={`input w-20 ${c.min ? "border-brand-500 bg-brand-50" : ""}`} inputMode="numeric" aria-label={`Minimum stock of ${v.shortName}`} value={e?.min ?? String(v.lowStockThreshold)} onChange={(ev) => setItemEdit(p, v, { min: ev.target.value.replace(/[^\d]/g, "") })} /></td>
          ),
      };
    // V3.1 grouped product: its stock is its sets (plan §4) — the set count, with "+ Add sets"
    // (the opening-sets sheet, D20) in place of the New Stock stepper; purchases add sets too.
    if (p.productType === "grouped") {
      // 0041: no standard price on the product; set counts, prices and minimum stock are edited
      // on its set-type child rows (⊕).
      return {
        stock: (
          <td className="whitespace-nowrap">
            {/* With a warehouse chosen, the sets in that warehouse only. */}
            {whFilter ? (
              <span className="text-sm font-bold"><SetCountIn groupId={p.id} warehouseId={whFilter} categoryId={setCategory_} /></span>
            ) : (
              <span className={`text-sm font-bold ${v.quantity > 0 ? "text-slate-900" : "text-rose-600"}`}>{v.quantity} set{v.quantity === 1 ? "" : "s"}</span>
            )}
          </td>
        ),
        newStock: <td className="text-slate-400">—</td>,
        change: <td className="text-slate-400">—</td>,
      };
    }
    // Measured stock changes only through its pieces (BR-18): the length is shown, with "+ Add
    // rolls" in place of the New Stock stepper.
    if (p.productType === "measured") {
      const meta = stockLengthOf(p)!;
      const low = v.state === "low" || v.state === "out";
      return {
        stock: (
          <td className="whitespace-nowrap">
            <button type="button" className="group inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium shadow-xs transition hover:border-brand-500 hover:bg-brand-50/30" onClick={() => setMeasured({ kind: "view", product: p, variation: v })}>
              <span className={`font-bold ${low ? "text-rose-600" : "text-slate-900"}`}>{fmtLen(v.quantity, meta)}</span>
              {low && <span className="rounded bg-rose-100 px-1 text-[9px] font-bold text-rose-700">Low</span>}
              <span className="ml-0.5 font-semibold text-brand-600 group-hover:underline">Pieces ↗</span>
            </button>
            {whChips(v, (q) => fmtLen(q, meta))}
          </td>
        ),
        newStock: (
            <td>
              <button type="button" className="btn border border-emerald-600 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100" onClick={() => setMeasured({ kind: "add", product: p, variation: v })}>
                + Add {(p.measure?.rollName || "roll").toLowerCase()}s
              </button>
            </td>
        ),
        change: <td className="text-slate-400">—</td>,
        ...prices,
      };
    }
    if (wh.enabled) {
      // V3.1 (plan §4.3): one stepper per warehouse; with a filter, that warehouse only.
      const rowsWh = whRowsOf(v);
      const diffs = rowsWh.map((w) => {
        const we = whEdits[`${v.id}|${w}`];
        const b = we?.base ?? freeIn(v, w);
        const t = parse(we?.qty) !== undefined ? Number(we!.qty) : b;
        return Number.isFinite(t) ? t - b : 0;
      });
      const totalDiff = diffs.reduce((s, d) => s + d, 0);
      const shown = whFilter ? freeIn(v, whFilter) : v.quantity;
      const addable = wh.active.filter((w) => !rowsWh.includes(w.id));
      return {
        stock: (
          <td className="whitespace-nowrap">
            <StockBadge quantity={shown} state={whFilter ? stockState(shown, v.lowStockThreshold) : v.state} unit={p.unit} />
            {whChips(v)}
          </td>
        ),
        newStock: (
            <td>
              <div className="space-y-1">
                {rowsWh.map((w) => {
                  const we = whEdits[`${v.id}|${w}`];
                  const b = we?.base ?? freeIn(v, w);
                  const t = parse(we?.qty) !== undefined ? Number(we!.qty) : b;
                  const stepWh = (d: number) => setWhEdit(v, w, String(Math.max(0, (Number.isFinite(t) ? t : b) + d)));
                  return (
                    <div key={w} className="flex items-center gap-1.5">
                      {!whFilter && <span className="w-9 font-mono text-[11px] font-semibold text-slate-500">{wh.codeOf(w)}</span>}
                      <div className={`flex w-fit items-center rounded-md border bg-white ${we && Number(we.qty) !== we.base ? "border-brand-500" : "border-slate-300"}`}>
                        <button type="button" className="h-7 w-7" aria-label={`Decrease ${v.shortName} in ${wh.codeOf(w)}`} onClick={() => stepWh(-1)}>−</button>
                        <input className="h-7 w-16 border-x border-slate-300 text-center text-sm font-semibold outline-none" inputMode="numeric" aria-label={`New stock of ${v.shortName} in ${wh.codeOf(w)}`} value={we?.qty ?? String(b)} onChange={(ev) => setWhEdit(v, w, ev.target.value.replace(/[^\d]/g, ""))} />
                        <button type="button" className="h-7 w-7" aria-label={`Increase ${v.shortName} in ${wh.codeOf(w)}`} onClick={() => stepWh(1)}>+</button>
                      </div>
                      {canShift && freeIn(v, w) > 0 && wh.active.length > 1 && (
                        <Link href={`/shifts/new?from=${w}&variation=${v.id}`} className="text-slate-400 hover:text-brand-700" title={`Shift from ${wh.codeOf(w)}`} onClick={guardLeave}>
                          <ShiftIcon className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </div>
                  );
                })}
                {!whFilter && addable.length > 0 && (
                  <select
                    className="input h-7 w-auto py-0 text-xs text-slate-500"
                    value=""
                    aria-label={`Add stock of ${v.shortName} in another warehouse`}
                    onChange={(ev) => ev.target.value && setExtraWh((x) => ({ ...x, [v.id]: [...(x[v.id] ?? []), ev.target.value] }))}
                  >
                    <option value="">+ another warehouse</option>
                    {addable.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.code} · {w.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </td>
        ),
        change: (
            <td className={`whitespace-nowrap text-sm font-semibold ${totalDiff > 0 ? "text-emerald-600" : totalDiff < 0 ? "text-rose-600" : "text-slate-400"}`} title="Change in stock">
              {totalDiff > 0 ? `+${totalDiff}` : totalDiff} {p.unit}
            </td>
        ),
        ...prices,
      };
    }
    return {
      stock: (
        <td className="whitespace-nowrap">
          <StockBadge quantity={v.quantity} state={v.state} unit={p.unit} />
          {v.quantity < 0 && canAdjust && (
            <button type="button" className="ml-2 rounded border border-emerald-600 px-1.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50" title={`Bring stock back to 0 (+${-v.quantity} ${p.unit})`} onClick={() => setItemEdit(p, v, { qty: "0" })}>
              + Receive
            </button>
          )}
        </td>
      ),
      newStock: (
          <td>
            <div className="flex w-fit items-center rounded-md border border-slate-300 bg-white">
              <button type="button" className="h-8 w-8" aria-label={`Decrease ${v.shortName}`} onClick={() => step(-1)}>−</button>
              <input className="h-8 w-20 border-x border-slate-300 text-center text-sm font-semibold outline-none" inputMode="numeric" aria-label={`New stock of ${v.shortName}`} value={e?.qty ?? String(v.quantity)} onChange={(ev) => setItemEdit(p, v, { qty: ev.target.value.replace(/[^\d]/g, "") })} />
              <button type="button" className="h-8 w-8" aria-label={`Increase ${v.shortName}`} onClick={() => step(1)}>+</button>
            </div>
          </td>
      ),
      change: (
          <td className={`whitespace-nowrap text-sm font-semibold ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-600" : "text-slate-400"}`} title="Change in stock">
            {diff > 0 ? `+${diff}` : diff} {p.unit}
          </td>
      ),
      ...prices,
    };
  };
  const editCells = (p: StockProduct, v: StockVariation, all = false) => rowCells(editIds(all), editCellMap(p, v));

  // 0041: editable cells of one set-type child row of a grouped product — sets in stock, new
  // count (builds sets from these parts as new stock, or undoes sets added here), prices and
  // minimum stock of this set type.
  const setCellMap = (p: StockProduct, t: SetTypeRow): Record<string, ReactNode> => {
    const k = `${p.id}|${t.typeKey}`;
    const e = setEdits_[k];
    const c = setChangedOf(k);
    const base = e?.base.count ?? t.count;
    const target = parse(e?.count) !== undefined ? Number(e!.count) : base;
    const diff = Number.isFinite(target) ? target - base : 0;
    const name = setTypeName(t);
    const step = (d: number) => setEdit(p.id, t, { count: String(Math.max(0, (Number.isFinite(target) ? target : base) + d)) });
    const low = t.count <= t.lowStockThreshold;
    return {
      stock: (
        <td className="whitespace-nowrap">
          <span className={`font-semibold ${t.count === 0 ? "text-rose-600" : low ? "text-amber-700" : "text-emerald-700"}`}>
            {t.count} <span className="text-xs font-normal text-slate-400">set{t.count === 1 ? "" : "s"}</span>
          </span>
          {low && <span className="ml-1 rounded bg-rose-100 px-1 text-[9px] font-bold text-rose-700">Low</span>}
        </td>
      ),
      newStock: canOpenSets ? (
        <td>
          <div className={`flex w-fit items-center rounded-md border bg-white ${c.count ? "border-brand-500" : "border-slate-300"}`}>
            <button type="button" className="h-8 w-8" aria-label={`Decrease ${name}`} onClick={() => step(-1)}>−</button>
            <input className="h-8 w-16 border-x border-slate-300 text-center text-sm font-semibold outline-none" inputMode="numeric" aria-label={`New set count of ${name}`} value={e?.count ?? String(t.count)} onChange={(ev) => setEdit(p.id, t, { count: ev.target.value.replace(/[^\d]/g, "") })} />
            <button type="button" className="h-8 w-8" aria-label={`Increase ${name}`} onClick={() => step(1)}>+</button>
          </div>
        </td>
      ) : (
        <td className="text-xs text-slate-400">By purchase</td>
      ),
      change: (
        <td className={`whitespace-nowrap text-sm font-semibold ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-600" : "text-slate-400"}`} title="Change in sets">
          {diff > 0 ? `+${diff}` : diff} set{Math.abs(diff) === 1 ? "" : "s"}
        </td>
      ),
      minSalePrice: (() => {
        const setPriceErr = setTypePriceError(p.id, t);
        return (
          <td className={setPriceErr ? "bg-rose-50/50" : ""}>
            <input
              className={`input w-24 ${setPriceErr ? "border-rose-500 bg-rose-50 text-rose-900 focus:border-rose-600 focus:ring-rose-500" : c.minPrice ? "border-brand-500 bg-brand-50" : ""}`}
              inputMode="numeric"
              aria-label={`Minimum selling price of ${name}`}
              title={setPriceErr ? `Minimum selling price (₹${setPriceErr.minSalePrice}) cannot be higher than selling price (₹${setPriceErr.salePrice})` : undefined}
              value={e?.minPrice ?? String(Number(t.minSalePrice))}
              onChange={(ev) => setEdit(p.id, t, { minPrice: ev.target.value.replace(/[^\d]/g, "") })}
            />
            {setPriceErr && (
              <div className="mt-0.5 text-[10px] font-medium leading-tight text-rose-600" role="alert">
                Must be ≤ ₹{setPriceErr.salePrice}
              </div>
            )}
          </td>
        );
      })(),
      salePrice: (() => {
        const setPriceErr = setTypePriceError(p.id, t);
        return (
          <td className={setPriceErr ? "bg-rose-50/50" : ""}>
            <input
              className={`input w-24 ${setPriceErr ? "border-rose-500 bg-rose-50 text-rose-900 focus:border-rose-600 focus:ring-rose-500" : c.price ? "border-brand-500 bg-brand-50" : ""}`}
              inputMode="numeric"
              aria-label={`Selling price of ${name}`}
              title={setPriceErr ? `Selling price (₹${setPriceErr.salePrice}) cannot be lower than minimum selling price (₹${setPriceErr.minSalePrice})` : undefined}
              value={e?.price ?? String(Number(t.salePrice))}
              onChange={(ev) => setEdit(p.id, t, { price: ev.target.value.replace(/[^\d]/g, "") })}
            />
          </td>
        );
      })(),
      minStock: (
        <td><input className={`input w-20 ${c.min ? "border-brand-500 bg-brand-50" : ""}`} inputMode="numeric" aria-label={`Minimum stock of ${name}`} value={e?.min ?? String(t.lowStockThreshold)} onChange={(ev) => setEdit(p.id, t, { min: ev.target.value.replace(/[^\d]/g, "") })} /></td>
      ),
    };
  };
  /** Set-type child table heads / cells in the user's column order (`all`: the stock drawer). */
  const setTableProps = (p: StockProduct, all = false) => {
    const ids = editIds(all).filter((id) => id !== "minSalePrice" && id !== "minStock");
    return {
      heads: headCells(ids, { drag: false }),
      cells: (t: SetTypeRow) => rowCells(ids, setCellMap(p, t)),
    };
  };
  const headOf = (id: string, measuredRows = false): ReactNode => {
    switch (id) {
      case "product": return "Product";
      case "category": return "Category";
      case "sku": return "SKU";
      case "shortName": return "Short Name";
      case "stock":
        return (
          <>
            {whFilter && !measuredRows ? `In ${wh.codeOf(whFilter)}` : "Current Stock"}
            {measuredRows && <LengthViewToggle className="ml-1.5" />}
          </>
        );
      case "newStock": return measuredRows ? "Add stock" : whFilter ? `New Stock (${wh.codeOf(whFilter)})` : "New Stock";
      case "change": return "Change";
      case "minSalePrice":
        return (
          <span className="inline-block whitespace-normal leading-tight max-w-[6.5rem]" title="Minimum Selling Price — stored as a reference and not enforced">
            Min Selling<span className="block text-[10px] font-normal text-slate-500">Price ₹</span>
          </span>
        );
      case "salePrice":
        return (
          <span className="inline-block whitespace-normal leading-tight max-w-[5.5rem]" title="Selling Price — what the customer pays">
            Selling<span className="block text-[10px] font-normal text-slate-500">Price ₹</span>
          </span>
        );
      case "minStock": return <span title="Minimum stock level — warns when stock drops to or below it">Min Stock</span>;
      default: return null;
    }
  };
  /** Header cells for `ids`; on screen tables they can be dragged to reorder the columns. */
  const headCells = (ids: string[], { measuredRows = false, drag = true } = {}) =>
    ids.map((id) => {
      const dragProps = drag ? cols.headerDrag(id) : {};
      const dataLabel = id === "minSalePrice" ? "Min Selling Price" : id === "salePrice" ? "Selling Price" : undefined;
      return <th key={id} {...dragProps} data-label={dataLabel} className={`${dragProps.className ?? ""} ${id === "product" ? "col-product" : ""}`}>{headOf(id, measuredRows)}</th>;
    });
  const editHeadsFor = (all = false, measuredRows = false) => headCells(editIds(all), { measuredRows, drag: !all });
  // expand + the user's columns
  const colCount = 1 + mainCols.length;
  /** Columns of a variation sub-table after its attribute columns (no product / category). */
  const subCols = mainCols.filter((id) => id !== "product" && id !== "category");
  // SKU / Short Name cells; a parent row (variations or pieces below it) has none of its own.
  const idCellMap = (v: StockVariation | null): Record<string, ReactNode> => ({
    sku: <td className="whitespace-nowrap font-mono text-xs text-slate-600">{v?.officialSku || "—"}</td>,
    shortName: <td className="whitespace-nowrap font-mono text-xs text-slate-600">{v?.shortName || "—"}</td>,
  });
  const categoryCell = (p: StockProduct) => <td className="text-slate-600">{p.category?.name ?? "—"}</td>;
  // Variation sub-table: one column per attribute, in the product's attribute-definition order.
  const attrColumns = (p: StockProduct, vs: StockVariation[]) => variationAttributeColumns(p, vs);
  // A Measured product's stock is a length, shown in the user's m / ft view.
  const drawerProduct = drawerId ? products.find((p) => p.id === drawerId) ?? null : null;
  const drawerVarIds = drawerProduct?.variations.map((v) => v.id) ?? [];
  const drawerDirty = dirtyIds.filter((id) => drawerVarIds.includes(id));
  const drawerSetDirty = drawerProduct ? dirtySetKeys.filter((k) => setEdits_[k]!.groupId === drawerProduct.id).length : 0;
  const closeDrawer = () => setDrawerId(null);
  const tab = (label: string, n: number | undefined) => (n === undefined ? label : `${label} (${n})`);

  return (
    <div>
      {/* Mobile Page Header Bar - compact and clean */}
      <div className="no-print mb-3 lg:hidden space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 shadow-xs hover:bg-slate-50"
              aria-label="Back to Home"
              title="Back to Home"
            >
              ←
            </Link>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">Stock In</h1>
            {changeCount > 0 ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                {changeCount} changed
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                {products.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {changeCount > 0 && (
              <button
                type="button"
                className="btn-primary py-1 px-2.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 border-emerald-700 shadow-xs cursor-pointer"
                disabled={saving}
                onClick={() => void save()}
              >
                {saving ? "Saving…" : `Save (${changeCount})`}
              </button>
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
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, short name or SKU…" />

        {/* Mobile Active filter chips */}
        {(search || category || stage !== "all" || whFilter) && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs [scrollbar-width:none]">
            <span className="text-[11px] font-medium text-slate-400 shrink-0">Filters:</span>
            {stage !== "all" && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100/90 px-2.5 py-0.5 font-medium text-amber-800 text-[11px]">
                Status: {stage.toUpperCase()}
                <button type="button" onClick={() => setStage("all")} className="hover:text-amber-950 font-bold ml-0.5" aria-label="Remove stage filter">×</button>
              </span>
            )}
            {whFilter && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-100/90 px-2.5 py-0.5 font-medium text-sky-800 text-[11px]">
                WH: {wh.byId.get(whFilter)?.code ?? whFilter}
                <button type="button" onClick={() => chooseWarehouse("")} className="hover:text-sky-950 font-bold ml-0.5" aria-label="Remove warehouse filter">×</button>
              </span>
            )}
            {category && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-100/90 px-2.5 py-0.5 font-medium text-brand-800 text-[11px]">
                {category === "none" ? "Uncategorized" : categoryName(category) ?? "Category"}
                <button type="button" onClick={() => setCategory("")} className="hover:text-brand-950 font-bold ml-0.5" aria-label="Remove category filter">×</button>
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
              onClick={() => { setSearch(""); setCategory(""); setStage("all"); chooseWarehouse(""); }}
              className="shrink-0 text-[11px] font-semibold text-slate-500 hover:text-brand-600 underline ml-1 cursor-pointer"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* In-Page Mobile Sidebar Drawer for Stock In */}
      <PageMobileSidebar
        open={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        title="Stock In Options"
        subtitle="Save stock, layout & filters"
        badge={
          changeCount > 0 ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
              {changeCount} changes
            </span>
          ) : undefined
        }
        footer={
          <div className="flex gap-2">
            {changeCount > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  void save();
                }}
                disabled={saving}
                className="btn-primary w-full py-2.5 text-sm font-semibold shadow-sm justify-center bg-emerald-700 hover:bg-emerald-800 border-emerald-700 cursor-pointer"
              >
                {saving ? "Saving…" : `Save Stock (${changeCount})`}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(false)}
                className="btn-primary w-full py-2.5 text-sm font-semibold shadow-sm justify-center cursor-pointer"
              >
                Show {products.length} Products
              </button>
            )}
          </div>
        }
      >
        {/* Transaction & Save Section */}
        <SidebarSection title="Save Stock">
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs bg-white rounded-lg p-2.5 border border-slate-200">
              <span className="text-slate-600">Pending changes:</span>
              <span className="font-bold text-slate-900">
                <span className={changeCount ? "text-emerald-600" : ""}>{changeCount}</span> changed
                {pricedCount > 0 && <> • <span className="text-sky-600">{pricedCount}</span> repriced</>}
              </span>
            </div>

            {hasPriceErrors && (
              <div className="rounded-md bg-rose-50 p-2 text-xs font-semibold text-rose-700 ring-1 ring-rose-200">
                Min price cannot be higher than selling price!
              </div>
            )}

            {wh.enabled && (
              <SidebarField label="Target Warehouse">
                <select
                  className="input text-sm font-medium"
                  value={whFilter}
                  onChange={(e) => chooseWarehouse(e.target.value)}
                  aria-label="Target warehouse"
                >
                  <option value="">All warehouses</option>
                  {wh.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} · {w.name}
                      {w.active ? "" : " (inactive)"}
                    </option>
                  ))}
                </select>
              </SidebarField>
            )}

            <SidebarField label="Reason">
              <select
                className="input text-sm"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-label="Stock reason"
              >
                {REASONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            </SidebarField>

            <SidebarField label="Notes (optional)">
              <input
                className="input text-sm"
                placeholder="Enter notes for this batch…"
                maxLength={300}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </SidebarField>

            <button
              type="button"
              className="btn-primary w-full justify-center py-2 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 border-emerald-700 cursor-pointer"
              disabled={saving || changeCount === 0}
              onClick={() => {
                setMobileSidebarOpen(false);
                void save();
              }}
            >
              {saving ? "Saving…" : `Save Stock Changes (${changeCount})`}
            </button>
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

          <SidebarField label="Display Mode">
            <ViewToggle value={view} onChange={(v) => { if (focus) router.replace("/inventory"); setView(v); }} />
          </SidebarField>

          {view === "table" && (
            <div className="space-y-2 pt-1 border-t border-slate-200/60">
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary flex-1 text-xs justify-center"
                  disabled={!variable.length}
                  onClick={() => expandAll(true)}
                >
                  Expand all
                </button>
                <button
                  type="button"
                  className="btn-secondary flex-1 text-xs justify-center"
                  disabled={!Object.keys(openGroup).length}
                  onClick={() => expandAll(false)}
                >
                  Collapse all
                </button>
              </div>
              <div className="pt-1">
                <ColumnsMenu
                  columns={availableColumns}
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

        {/* Stock Filter Section */}
        <SidebarSection
          title="Stock Filters"
          action={
            activeFiltersCount > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setCategory("");
                  setStage("all");
                  chooseWarehouse("");
                }}
                className="text-xs font-semibold text-brand-600 hover:text-brand-800 cursor-pointer"
              >
                Reset filters
              </button>
            ) : null
          }
        >
          <SidebarField label="Stock Condition">
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => setStage("all")}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold text-center transition-all cursor-pointer ${
                  stage === "all"
                    ? "border-brand-600 bg-brand-50 text-brand-700 shadow-xs"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {tab("All", summary?.tabs?.all)}
              </button>
              <button
                type="button"
                onClick={() => setStage("low")}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold text-center transition-all cursor-pointer ${
                  stage === "low"
                    ? "border-amber-500 bg-amber-50 text-amber-800 shadow-xs"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {tab("Low", summary?.tabs?.low)}
              </button>
              <button
                type="button"
                onClick={() => setStage("out")}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold text-center transition-all cursor-pointer ${
                  stage === "out"
                    ? "border-rose-500 bg-rose-50 text-rose-700 shadow-xs"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {tab("Out", summary?.tabs?.out)}
              </button>
              <button
                type="button"
                onClick={() => setStage("negative")}
                className={`rounded-lg border px-2 py-1.5 text-xs font-semibold text-center transition-all cursor-pointer ${
                  stage === "negative"
                    ? "border-purple-600 bg-purple-50 text-purple-800 shadow-xs"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                {tab("Negative", summary?.tabs?.negative)}
              </button>
            </div>
          </SidebarField>

          <SidebarField label="Category">
            <select
              className="input text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter category"
            >
              <option value="">All Categories</option>
              {cats.data?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.productCount})
                </option>
              ))}
              <option value="none">No category ({cats.data?.uncategorized.productCount ?? 0})</option>
            </select>
          </SidebarField>
        </SidebarSection>

        {/* Quick Links Section */}
        <SidebarSection title="Quick Links">
          <Link
            href="/products"
            className="btn-secondary w-full justify-center text-xs"
            onClick={(e) => {
              setMobileSidebarOpen(false);
              guardLeave(e);
            }}
          >
            Go to Products Catalog
          </Link>
        </SidebarSection>
      </PageMobileSidebar>

      {/* Desktop Header & Toolbars - preserved for screens lg and up */}
      <div className="hidden lg:block">
        <PageHeader
          title="Stock In"
          subtitle="Receive stock and set selling prices and minimum stock"
          actions={
            <div className="flex flex-wrap items-center gap-2">
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
              <Link href="/products" className="btn-secondary" onClick={guardLeave}>Products</Link>
            </div>
          }
        />

        <Toolbar>
          <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
            <b className={changeCount ? "text-emerald-600" : ""}>{changeCount}</b> with changes
            {pricedCount > 0 && <> • <b className="text-sky-600">{pricedCount}</b> repriced</>}
          </span>
          {hasPriceErrors && (
            <span className="rounded-md bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 ring-1 ring-rose-200" role="alert">
              Min price &gt; selling price
            </span>
          )}
          {wh.enabled && (
            <select className="input w-auto font-medium" value={whFilter} onChange={(e) => chooseWarehouse(e.target.value)} aria-label="Warehouse">
              <option value="">All warehouses</option>
              {wh.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                  {w.active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          )}
          <select className="input w-auto" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
            {REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
          <input className="input min-w-[10rem] flex-1" placeholder="Notes (optional)" maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button className="btn border border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800" disabled={saving || changeCount === 0} onClick={() => void save()}>
            {saving ? "Saving…" : `Save Stock (${changeCount})`}
          </button>
        </Toolbar>

        {showTableSettings && (
          <>
            <Toolbar>
              <Segmented<StockFilter>
                label="Stock filter"
                value={stage}
                onChange={setStage}
                options={[
                  // tabs? tolerates a cached answer from an older API during an update.
                  { value: "all", label: tab("All", summary?.tabs?.all) },
                  { value: "low", label: tab("Low", summary?.tabs?.low), title: "At or below minimum stock (includes out of stock), for the product or any of its variations" },
                  { value: "out", label: tab("Out", summary?.tabs?.out), title: "Nothing on hand (includes negative)" },
                  { value: "negative", label: tab("Negative", summary?.tabs?.negative), title: "Sold more than recorded stock — receive a purchase or count to correct" },
                ]}
              />
              <SearchInput value={search} onChange={setSearch} placeholder="Search name, short name or SKU…" />
              {(search || category || stage !== "all") && <button className="btn-secondary" onClick={() => { setSearch(""); setCategory(""); setStage("all"); }}>Clear Filters</button>}
            </Toolbar>

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
              <ViewToggle value={view} onChange={(v) => { if (focus) router.replace("/inventory"); setView(v); }} />
              {view === "table" && (
                <>
                  <button className="btn-secondary" disabled={!variable.length} onClick={() => expandAll(true)}>Expand all</button>
                  <button className="btn-secondary" disabled={!Object.keys(openGroup).length} onClick={() => expandAll(false)}>Collapse all</button>
                </>
              )}
              <span className="flex-1" />
              {view === "table" && <ColumnsMenu columns={availableColumns} hidden={cols.hidden} order={cols.order} onMove={cols.move} onChange={cols.setHidden} onReset={cols.reset} />}
            </Toolbar>
          </>
        )}
      </div>

      <Alert message={flash?.text} kind={flash?.kind} />
      <Alert message={cols.error} />
      <Alert message={error} />

      {(() => {
        const productContent = (
          <div className={view === "grid" && products.length > 0 ? "" : "card"}>
        {!data && !error ? (
          <TableSkeleton rows={6} />
        ) : products.length === 0 ? (
          <EmptyState
            icon={<BoxesIcon className="h-6 w-6" />}
            title={loading ? "Loading…" : "No products match the filters"}
          />
        ) : view === "grid" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {products.map((p) => {
              const active = p.variations.filter((v) => v.active);
              const prices = active.map((v) => Number(v.salePrice)).filter((n) => n > 0);
              const lo = prices.length ? Math.min(...prices) : 0;
              const hi = prices.length ? Math.max(...prices) : 0;
              const pending = active.filter((v) => dirtyIds.includes(v.id)).length;
              return (
                <ProductTile
                  key={p.id}
                  id={`stock-in-grid-${p.id}`}
                  name={p.name}
                  image={p.imageUrl ?? active[0]?.imageUrl ?? null}
                  onClick={() => { setDrawerError(null); setDrawerId(p.id); }}
                  highlight={focus === p.id}
                  meta={p.productType === "grouped" ? (
                    <SetTypesBadge groupId={p.id} warehouseId={whFilter} categoryId={setCategory_} />
                  ) : (
                    <ProductKind type={p.productType} count={`${active.length}${ofAll(p)}`} fallback={p.category?.name ?? "Uncategorized"} />
                  )}
                  badge={p.productType !== "measured" && <StockBadge quantity={p.quantity} state={p.state} unit={p.unit} length={stockLengthOf(p)} />}
                  price={hi > 0 && p.productType !== "variable" && p.productType !== "measured" && p.productType !== "grouped" && fmtSellRate(null, active[0]?.minSalePrice, active[0]?.salePrice, "Sell: ")}
                  note={pending > 0 && <div className="text-[11px] font-semibold text-emerald-700">{pending} unsaved change(s)</div>}
                />
              );
            })}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-8" aria-label="Expand" />
                  {headCells(mainCols)}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const active = p.variations.filter((v) => v.active);
                  if (p.productType === "measured") {
                    const isOpen = !!openGroup[p.id];
                    return (
                      <Fragment key={p.id}>
                        <tr
                          id={`stock-in-${p.id}`}
                          className={`cursor-pointer ${focus === p.id ? "row-highlight-blink" : ""}`}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest("a, button, input, select")) return;
                            toggleGroup(p.id);
                          }}
                        >
                          <td>
                            <button
                              type="button"
                              className="text-brand-600 font-bold"
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? "Collapse" : "Expand"} ${p.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleGroup(p.id);
                              }}
                            >
                              {isOpen ? "⊖" : "⊕"}
                            </button>
                          </td>
                          {rowCells(
                            mainCols,
                            {
                              product: (
                                <td className="font-semibold text-slate-900 align-top py-2">
                                  <div className="flex items-center gap-2.5">
                                    {show("image") && <ProductThumb src={p.imageUrl ?? active[0]?.imageUrl ?? null} name={p.name} className="h-9 w-9 rounded-md text-[7px] shrink-0" />}
                                    <div>
                                      <Link
                                        href={`/inventory/${p.id}`}
                                        className="hover:text-brand-700 hover:underline"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          guardLeave(e);
                                        }}
                                      >
                                        {p.name}
                                      </Link>
                                      <div className="mt-1 flex items-center gap-1.5">
                                        <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                                          {active.length}{ofAll(p)} variation{active.length === 1 && !ofAll(p) ? "" : "s"}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              ),
                              category: categoryCell(p),
                              ...idCellMap(null),
                              stock: <td className="text-slate-400">—</td>,
                            },
                            <span className="text-xs font-medium text-sky-700">Expand for pieces, prices and min stock by variation</span>,
                          )}
                        </tr>
                        {isOpen && (() => {
                          // Prices and minimum stock are edited per variation, beside its pieces.
                          const priceIds = editIds().filter((id) => ["minSalePrice", "salePrice", "minStock"].includes(id));
                          return (
                            <MeasuredStock
                              product={p}
                              colSpan={colCount}
                              singleStockCell
                              extraHeads={headCells(priceIds, { measuredRows: true, drag: false })}
                              extraCount={priceIds.length}
                              extraCells={(id) => {
                                const v = p.variations.find((x) => x.id === id);
                                return v ? rowCells(priceIds, editCellMap(p, v)) : null;
                              }}
                            />
                          );
                        })()}
                      </Fragment>
                    );
                  }
                  // V3.1 grouped product: expands into its sets in stock (child rows, no codes).
                  if (p.productType === "grouped") {
                    const v = active[0];
                    if (!v) return null;
                    const isOpen = !!openGroup[p.id];
                    return (
                      <Fragment key={p.id}>
                        <tr
                          id={`stock-in-${p.id}`}
                          className={`cursor-pointer ${focus === p.id ? "row-highlight-blink" : ""}`}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest("a, button, input, select")) return;
                            toggleGroup(p.id);
                          }}
                        >
                          <td>
                            <button
                              type="button"
                              className="text-brand-600 font-bold"
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? "Collapse" : "Expand"} ${p.name}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleGroup(p.id);
                              }}
                            >
                              {isOpen ? "⊖" : "⊕"}
                            </button>
                          </td>
                          {rowCells(
                            mainCols,
                            {
                              product: (
                                <td className="font-semibold text-slate-900 align-top py-2">
                                  <div className="flex items-center gap-2.5">
                                    {show("image") && <ProductThumb src={p.imageUrl ?? v.imageUrl ?? null} name={p.name} className="h-9 w-9 rounded-md text-[7px] shrink-0" />}
                                    <div>
                                      <Link
                                        href={`/inventory/${p.id}`}
                                        className="hover:text-brand-700 hover:underline"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          guardLeave(e);
                                        }}
                                      >
                                        {p.name}
                                      </Link>
                                      <div className="mt-1">
                                        <SetTypesBadge groupId={p.id} warehouseId={whFilter} categoryId={setCategory_} />
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              ),
                              category: categoryCell(p),
                              ...idCellMap(null),
                              stock: <td className="whitespace-nowrap"><StockBadge quantity={p.quantity} state={p.state} unit="sets" /></td>,
                            },
                            <span className="text-xs text-slate-500">Expand to edit stock and selling price by set</span>,
                          )}
                        </tr>
                        {isOpen && <SetTypeRows groupId={p.id} colSpan={colCount} warehouseId={whFilter} layout="chips" categoryId={setCategory_} {...setTableProps(p)} />}
                      </Fragment>
                    );
                  }
                  if (p.productType !== "variable") {
                    const v = active[0];
                    if (!v) return null;
                    return (
                      <tr key={p.id} id={`stock-in-${p.id}`} className={focus === p.id ? "row-highlight-blink" : ""}>
                        <td />
                        {rowCells(mainCols, {
                          product: (
                            <td className="font-medium text-slate-900">
                              <div className="flex items-center gap-2.5">
                                {show("image") && <ProductThumb src={p.imageUrl ?? active[0]?.imageUrl ?? null} name={p.name} className="h-9 w-9 rounded-md text-[7px] shrink-0" />}
                                <Link href={`/inventory/${p.id}`} className="hover:text-brand-700 hover:underline" onClick={guardLeave}>{p.name}</Link>
                              </div>
                            </td>
                          ),
                          category: categoryCell(p),
                          ...idCellMap(v),
                          ...editCellMap(p, v),
                        })}
                      </tr>
                    );
                  }
                  const isOpen = !!openGroup[p.id];
                  const total = active.reduce((s, v) => s + v.quantity, 0);
                  const attrCols = attrColumns(p, active);
                  return (
                    <Fragment key={p.id}>
                      <tr
                        id={`stock-in-${p.id}`}
                        className={`cursor-pointer ${focus === p.id ? "row-highlight-blink" : ""}`}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("a, button, input, select")) return;
                          toggleGroup(p.id);
                        }}
                      >
                        <td>
                          <button
                            type="button"
                            className="text-brand-600 font-bold"
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Collapse" : "Expand"} ${p.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleGroup(p.id);
                            }}
                          >
                            {isOpen ? "⊖" : "⊕"}
                          </button>
                        </td>
                        {rowCells(
                          mainCols,
                          {
                            product: (
                              <td className="font-semibold text-slate-900 align-top py-2">
                                <div className="flex items-center gap-2.5">
                                  {show("image") && <ProductThumb src={p.imageUrl ?? active[0]?.imageUrl ?? null} name={p.name} className="h-9 w-9 rounded-md text-[7px] shrink-0" />}
                                  <div>
                                    <Link
                                      href={`/inventory/${p.id}`}
                                      className="hover:text-brand-700 hover:underline"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        guardLeave(e);
                                      }}
                                    >
                                      {p.name}
                                    </Link>
                                    <div className="mt-1">
                                      <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                                        {active.length} variation{active.length === 1 ? "" : "s"}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                            ),
                            category: categoryCell(p),
                            ...idCellMap(null),
                            stock: <td className="whitespace-nowrap"><StockBadge quantity={total} state={p.state} unit={p.unit} /></td>,
                          },
                          <span className="text-xs text-slate-500">Expand to edit stock and prices by variation</span>,
                        )}
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={colCount} className="bg-slate-50/70 !p-0">
                            <div className="child-panel">
                              <table className="table rounded-md bg-white">
                                <thead>
                                  <tr>
                                    <th>Order</th>
                                    {show("image") && <th aria-label="Image" />}
                                    {attrCols.map((c) => <th key={c.name}>{c.name}{c.unit ? ` (${c.unit})` : ""}</th>)}
                                    {headCells(subCols)}
                                  </tr>
                                </thead>
                                <tbody
                                  onDragLeave={(event) => {
                                    if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                                      setDropTarget(null);
                                    }
                                  }}
                                >
                                  {shownVariations(p).map((v, index, ordered) => {
                                    const isSelected = draggedVariation?.variationId === v.id;
                                    const isDropTarget = dropTarget?.productId === p.id && dropTarget?.variationId === v.id && !isSelected;
                                    const indicatorClass = isDropTarget
                                      ? dropTarget.position === "before"
                                        ? "drop-indicator-top"
                                        : "drop-indicator-bottom"
                                      : "";
                                    const rowClass = [
                                      isSelected ? "row-dragging bg-light border shadow-sm" : "",
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
                                          label={`${p.name} ${v.shortName}`}
                                          index={index}
                                          count={ordered.length}
                                          disabled={!canEditProducts || reordering === p.id}
                                          onMove={(from, to) => moveVariation(p, from, to)}
                                          onDragStart={(event) => startVariationDrag(event, p.id, v.id)}
                                          onDragEnd={() => {
                                            setDraggedVariation(null);
                                            setDropTarget(null);
                                          }}
                                        />
                                      {show("image") && (
                                        <td className="w-14">
                                          <ProductThumb src={v.imageUrl ?? p.imageUrl ?? null} name={`${p.name} (${variationLabel(v, p.attributes)})`} className="h-10 w-10 rounded text-[6px]" />
                                        </td>
                                      )}
                                      {attrCols.map((c) => <td key={c.name} className="text-slate-900">{v.attributes[c.name] ?? "—"}</td>)}
                                      {rowCells(subCols, { ...idCellMap(v), ...editCellMap(p, v) })}
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
          </div>
        )}
        {data && <div className={`${view === "grid" && products.length > 0 ? "pt-3" : "border-t border-slate-100 px-4 py-2"} text-xs text-slate-500`}>{data.total} products{changeCount ? ` · ${changeCount} unsaved change(s) are kept while you switch filters` : ""}</div>}
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
              ? categoryName(category) ?? "Category"
              : "All Categories"
          }
          count={`${products.length} product${products.length === 1 ? "" : "s"}`}
        >
          {productContent}
        </ShopLayout>
      );
    }

    return productContent;
  })()}
      {drawerProduct && (
        <StockEditDrawer
          product={drawerProduct}
          heads={editHeadsFor(true, drawerProduct.productType === "measured")}
          cells={(v) => editCells(drawerProduct, v, true)}
          dirty={drawerDirty.length + drawerSetDirty}
          saving={saving}
          error={drawerError}
          reason={reason}
          reasons={REASONS}
          onReason={setReason}
          notes={notes}
          onNotes={setNotes}
          onSave={() => void save(drawerDirty, drawerProduct.id).then((ok) => ok && setDrawerId(null))}
          onDiscard={() => {
            setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !drawerVarIds.includes(id))));
            setSetEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([, e]) => e.groupId !== drawerProduct.id)));
          }}
          onClose={closeDrawer}
          extra={
            drawerProduct.productType === "grouped" ? (
              <>
                <h3 className="mb-1.5 text-sm font-semibold text-slate-800">Sets in stock</h3>
                <SetTypesTable groupId={drawerProduct.id} warehouseId={whFilter} layout="chips" categoryId={setCategory_} {...setTableProps(drawerProduct, true)} />
              </>
            ) : undefined
          }
        />
      )}
      {measured?.kind === "add" && (
        <AddRollsModal
          open
          onClose={() => setMeasured(null)}
          onDone={(m) => {
            setMeasured(null);
            setFlash({ kind: "success", text: m });
            void reload();
          }}
          variationId={measured.variation.id}
          title={`${measured.product.name} ${variationLabel(measured.variation, measured.product.attributes)}`}
          meta={stockLengthOf(measured.product)!}
          defaultLength={measured.variation.defaultRollLength ?? measured.product.measure?.defaultRollLength ?? null}
          warehouseId={whFilter || null}
        />
      )}
      {measured?.kind === "view" && (
        <Modal open wide xl title={`Stock · ${measured.product.name} (${variationLabel(measured.variation, measured.product.attributes)})`} onClose={() => { setMeasured(null); void reload(); }}>
          <MeasuredStockPanel product={measured.product} onlyVariationId={measured.variation.id} />
        </Modal>
      )}
      {addingSets && (
        <AddSetsModal
          productId={addingSets}
          onClose={() => setAddingSets(null)}
          onSaved={(n) => {
            setAddingSets(null);
            setFlash({ kind: "success", text: `${n} set${n === 1 ? "" : "s"} added to stock.` });
            void reload();
          }}
        />
      )}
</div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <StockIn />
    </Suspense>
  );
}
