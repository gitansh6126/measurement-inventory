"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useEffect, useMemo, useState, type DragEvent } from "react";
import { ColumnsMenu } from "@/components/ColumnsMenu";
import { ViewToggle } from "@/components/catalog/ViewToggle";
import { CategoryRail } from "@/components/catalog/CategoryRail";
import { ShopLayout } from "@/components/catalog/ShopLayout";
import { ProductThumb } from "@/components/ProductThumb";
import { BoxesIcon, CogIcon, PlusIcon, ShiftIcon } from "@/components/icons";
import { useCan } from "@/components/MeContext";
import { StockBadge } from "@/components/StockBadge";
import { StockEditDrawer } from "@/components/products/StockEditDrawer";
import { MeasuredStock, MeasuredStockPanel } from "@/components/measure/MeasuredStock";
import { AddRollsModal } from "@/components/measure/RollActions";
import { AddSetsModal } from "@/components/sets/SetsPanel";
import { SetCountIn, SetTypeRows, SetTypesBadge, SetTypesTable } from "@/components/sets/SetTypes";
import { RateField } from "@/components/measure/RateField";
import { VariationOrderCell } from "@/components/VariationOrderCell";
import { Alert, EmptyState, Modal, PageHeader, SearchInput, Segmented, TableSkeleton, Toolbar } from "@/components/ui";
import { api } from "@/lib/api";
import type { ColumnDef } from "@/lib/inventoryColumns";
import type { Category, CategoryHead, CategoryStatsList, InventoryList, StockFilter, StockProduct, StockVariation } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { money, variationLabel } from "@/lib/format";
import { fmtLen, metaOf } from "@/lib/measure";
import { usePreference } from "@/lib/usePreference";
import { useEntryUnits } from "@/lib/useEntryUnits";
import { useViewMode } from "@/lib/useViewMode";
import { variationAttributeColumns } from "@/lib/variationColumns";
import { useWarehouses } from "@/lib/useWarehouses";
import type { StockState } from "@/lib/types";

// main v2 StockInPanel (index.html) rebuilt with marble UI (D23). Inventory owns the new stock
// level, selling price and minimum stock (BR-08a). Only the fields a user actually changes are
// sent; one save is one transaction (POST /api/inventory/stock-in).
//
// V2 (plan §1.3, §1.10, §3.3): stock tabs (All / Low / Out / Negative) and search run in SQL on
// the server; Expand all / Collapse all; a per-user Columns picker; a "Receive" shortcut on
// negative rows. Grid cards open a stock drawer (StockEditDrawer) instead of the product page. Unsaved edits remember their starting values, so changing a filter or tab
// never drops them.

const REASONS = ["Stock Received", "Opening Stock", "Manual Count", "Return to Stock", "Purchase Add", "Correction", "Other"];
// `free`: V3.1 free stock per warehouse when the edit started (a price-only row is saved against
// the default warehouse and needs its expected stock).
interface Base { quantity: number; salePrice: string; minSalePrice: string; lowStockThreshold: number; label: string; free?: Record<string, number> }
type Edits = Record<string, { qty?: string; price?: string; minPrice?: string; min?: string; base: Base }>;
// V3.1 (WH-12): with warehousing on, new stock is typed per (variation, warehouse); key "variationId|warehouseId".
type WarehouseEdits = Record<string, { qty: string; base: number; variationId: string; warehouseId: string }>;

/** Free stock of a variation in one warehouse (balance minus what is fitted in sets). */
const freeIn = (v: StockVariation, warehouseId: string) => {
  const r = v.byWarehouse?.find((w) => w.warehouseId === warehouseId);
  return r ? Math.round((r.quantity - (r.inSets ?? 0)) * 1000) / 1000 : 0;
};
/** Same rule as the API (lib\stock.ts stockState), for one warehouse's stock (WH-15). */
const stateOf = (quantity: number, threshold: number): StockState => (quantity < 0 ? "negative" : quantity <= 0 ? "out" : quantity <= threshold ? "low" : "ok");

// On-screen hideable columns (identity columns are always shown).
const SCREEN_COLUMNS: ColumnDef[] = [
  { id: "image", label: "Image", value: () => "" },
  { id: "product", label: "Product", fixed: true, value: () => "" },
  { id: "category", label: "Category", value: () => "" },
  { id: "stock", label: "Current / New Stock", fixed: true, value: () => "" },
  { id: "change", label: "Change", value: () => "" },
  { id: "minSalePrice", label: "Minimum Selling Price", value: () => "" },
  { id: "salePrice", label: "Selling Price", value: () => "" },
  { id: "minStock", label: "Min Stock", value: () => "" },
];
const PREF_KEY = "stockin.columns";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function StockIn() {
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

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [groupMode, setGroupMode] = useState<"all" | "category">("all");
  const [stage, setStage] = useState<StockFilter>("all");
  const q = useDebounced(search.trim(), 300);
  const params = new URLSearchParams({ state: stage, ...(q ? { q } : {}), ...(category ? { categoryId: category } : {}) }).toString();
  const { data, error, reload, loading } = useApi<InventoryList>(`/inventory?${params}`);
  const cats = useApi<CategoryStatsList>("/categories?stats=1");
  // V3.1 (0038): categories of the other heads in the filter too (Industry, Material…).
  const otherCats = useApi<{ categories: Category[] }>("/categories?headId=all");
  const heads = useApi<{ heads: CategoryHead[] }>("/category-heads");
  const otherHeads = (heads.data?.heads ?? []).filter((h) => !h.builtIn && h.id);
  const categoryName = (id: string) =>
    cats.data?.categories.find((c) => c.id === id)?.name ?? otherCats.data?.categories.find((c) => c.id === id)?.name;
  // Sets of a grouped product under the chosen category (G-A); none for "Uncategorized".
  const setCategory_ = category && category !== "none" ? category : undefined;
  const cols = usePreference<{ hidden: string[] }>(PREF_KEY, { hidden: [] });
  // A focus link (from Add Product) needs the editable table, so it always opens the Table view.
  const [savedView, setView] = useViewMode("inventory.products", "grid");
  const view = focus ? "table" : savedView;
  const hidden = cols.value.hidden ?? [];
  const visible = (id: string) => !hidden.includes(id);
  const show = visible;
  const availableColumns = SCREEN_COLUMNS.filter((column) => canConfigure || !["minSalePrice", "salePrice", "minStock"].includes(column.id));

  const [showTableSettings, setShowTableSettings] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("inventory.show_table_settings");
      if (stored !== null) return stored === "true";
    }
    return false;
  });

  const toggleTableSettings = () => {
    setShowTableSettings((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") localStorage.setItem("inventory.show_table_settings", String(next));
      return next;
    });
  };

  const [edits, setEdits] = useState<Edits>({});
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
      setOpenGroup({ [focus]: true });
      setTimeout(() => document.getElementById(`stock-in-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
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
  const dirtyIds = [...new Set([...Object.keys(edits).filter((id) => Object.values(changedOf(id)).some(Boolean)), ...whDirtyKeys.map((k) => whEdits[k]!.variationId)])];
  const pricedCount = dirtyIds.filter((id) => changedOf(id).price || changedOf(id).minPrice || changedOf(id).min).length;

  const setEdit = (p: StockProduct, v: StockVariation, patch: Partial<Omit<Edits[string], "base">>) => {
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

  // `only` limits the save to some variations (the drawer saves just its product's rows).
  async function save(only?: string[]): Promise<boolean> {
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
    if (!rows.length) return fail("No changes to save");
    const bad = rows.find((r) =>
      ("quantity" in r && (!Number.isInteger(r.quantity) || r.quantity! < 0)) ||
      ("lowStockThreshold" in r && (!Number.isInteger(r.lowStockThreshold) || r.lowStockThreshold! < 0)) ||
      ("salePrice" in r && !/^\d{1,10}$/.test(String(r.salePrice))) ||
      ("minSalePrice" in r && !/^\d{1,10}$/.test(String(r.minSalePrice)))
    );
    if (bad) return fail("Prices, quantities, and minimum stock must be whole numbers, 0 or more");
    setSaving(true);
    try {
      const r = await api<{ message: string }>("/inventory/stock-in", { method: "POST", body: { reason, notes: notes || null, rows } });
      setEdits((prev) => (only ? Object.fromEntries(Object.entries(prev).filter(([id]) => !ids.includes(id))) : {}));
      setWhEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([, e]) => !ids.includes(e.variationId))));
      setExtraWh({});
      setNotes("");
      setFlash({ kind: "success", text: r.message });
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
    if (dirtyIds.length && !window.confirm("Leave Stock In and discard the unsaved changes?")) e.preventDefault();
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

  // Editable cells shared by simple products, variation rows and the stock drawer
  // (Current → New Stock → Change → Sell → Min). `all` ignores the Columns picker (drawer).
  const editCells = (p: StockProduct, v: StockVariation, all = false) => {
    const show = (id: string) => all || visible(id);
    const e = edits[v.id];
    const base = e?.base.quantity ?? v.quantity;
    const target = parse(e?.qty) !== undefined ? Number(e!.qty) : base;
    const diff = Number.isFinite(target) ? target - base : 0;
    const c = changedOf(v.id);
    const step = (d: number) => setEdit(p, v, { qty: String(Math.max(0, (Number.isFinite(target) ? target : base) + d)) });
    // A Measured rate is per m, or per ft on a feet + inches product; it may be typed per another
    // unit and is converted (0028).
    const lu = p.productType === "measured" ? p.measure?.lengthUnit : undefined;
    const ratePref = lu ? { preferredUnit: saleUnits.rateUnit(lu), onUnitChange: (u: string) => saleUnits.setRateUnit(lu, u) } : {};
    const prices = lu ? (
      <>
        {canConfigure && show("minSalePrice") && (
          <td className={c.minPrice ? "bg-brand-50" : ""}><RateField compact unit={lu} label={`Minimum selling price of ${v.shortName}`} value={e?.minPrice ?? String(Number(v.minSalePrice))} onChange={(x) => setEdit(p, v, { minPrice: x })} {...ratePref} /></td>
        )}
        {canConfigure && show("salePrice") && (
          <td className={c.price ? "bg-brand-50" : ""}><RateField compact unit={lu} label={`Selling price of ${v.shortName}`} value={e?.price ?? String(Number(v.salePrice))} onChange={(x) => setEdit(p, v, { price: x })} {...ratePref} /></td>
        )}
        {canConfigure && show("minStock") && (
          <td><input className={`input w-20 ${c.min ? "border-brand-500 bg-brand-50" : ""}`} inputMode="numeric" aria-label={`Minimum stock of ${v.shortName}`} value={e?.min ?? String(v.lowStockThreshold)} onChange={(ev) => setEdit(p, v, { min: ev.target.value.replace(/[^\d]/g, "") })} /></td>
        )}
      </>
    ) : (
      <>
        {canConfigure && show("minSalePrice") && (
            <td><input className={`input w-24 ${c.minPrice ? "border-brand-500 bg-brand-50" : ""}`} inputMode="numeric" aria-label={`Minimum selling price of ${v.shortName}`} value={e?.minPrice ?? String(Number(v.minSalePrice))} onChange={(ev) => setEdit(p, v, { minPrice: ev.target.value })} /></td>
          )}
          {canConfigure && show("salePrice") && (
            <td><input className={`input w-24 ${c.price ? "border-brand-500 bg-brand-50" : ""}`} inputMode="numeric" aria-label={`Selling price of ${v.shortName}`} value={e?.price ?? String(Number(v.salePrice))} onChange={(ev) => setEdit(p, v, { price: ev.target.value })} /></td>
          )}
          {canConfigure && show("minStock") && (
            <td><input className={`input w-20 ${c.min ? "border-brand-500 bg-brand-50" : ""}`} inputMode="numeric" aria-label={`Minimum stock of ${v.shortName}`} value={e?.min ?? String(v.lowStockThreshold)} onChange={(ev) => setEdit(p, v, { min: ev.target.value.replace(/[^\d]/g, "") })} /></td>
          )}
      </>
    );
    // V3.1 grouped product: its stock is its sets (plan §4) — the set count, with "+ Add sets"
    // (the opening-sets sheet, D20) in place of the New Stock stepper; purchases add sets too.
    if (p.productType === "grouped") {
      return (
        <>
          <td className="whitespace-nowrap">
            <Link href={`/products/${p.id}`} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium shadow-xs hover:border-brand-500" onClick={guardLeave}>
              {/* With a warehouse chosen, the sets in that warehouse only. */}
              {whFilter ? (
                <span className="font-bold"><SetCountIn groupId={p.id} warehouseId={whFilter} categoryId={setCategory_} /></span>
              ) : (
                <span className={`font-bold ${v.quantity > 0 ? "text-slate-900" : "text-rose-600"}`}>{v.quantity} set{v.quantity === 1 ? "" : "s"}</span>
              )}
              <span className="font-semibold text-brand-600">Sets ↗</span>
            </Link>
          </td>
          {canAdjust && (
            <td>
              {canOpenSets ? (
                <button type="button" className="btn border border-emerald-600 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100" onClick={() => setAddingSets(p.id)}>
                  + Add sets
                </button>
              ) : (
                <span className="text-xs text-slate-400" title="Sets come in by purchase; an admin adds sets already in the shop">By purchase</span>
              )}
            </td>
          )}
          {show("change") && <td className="text-slate-400">—</td>}
          {prices}
        </>
      );
    }
    // Measured stock changes only through its pieces (BR-18): the length is shown, with "+ Add
    // rolls" in place of the New Stock stepper.
    if (p.productType === "measured") {
      const meta = metaOf({ ...(p.measure ?? {}), lengthUnit: p.measure?.lengthUnit ?? "m" });
      const low = v.state === "low" || v.state === "out";
      return (
        <>
          <td className="whitespace-nowrap">
            <button type="button" className="group inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium shadow-xs transition hover:border-brand-500 hover:bg-brand-50/30" onClick={() => setMeasured({ kind: "view", product: p, variation: v })}>
              <span className={`font-bold ${low ? "text-rose-600" : "text-slate-900"}`}>{fmtLen(v.quantity, meta)}</span>
              {low && <span className="rounded bg-rose-100 px-1 text-[9px] font-bold text-rose-700">Low</span>}
              <span className="ml-0.5 font-semibold text-brand-600 group-hover:underline">Pieces ↗</span>
            </button>
            {whChips(v, (q) => fmtLen(q, meta))}
          </td>
          {canAdjust && (
            <td>
              <button type="button" className="btn border border-emerald-600 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100" onClick={() => setMeasured({ kind: "add", product: p, variation: v })}>
                + Add {(p.measure?.rollName || "roll").toLowerCase()}s
              </button>
            </td>
          )}
          {show("change") && <td className="text-slate-400">—</td>}
          {prices}
        </>
      );
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
      return (
        <>
          <td className="whitespace-nowrap">
            <StockBadge quantity={shown} state={whFilter ? stateOf(shown, v.lowStockThreshold) : v.state} unit={p.unit} />
            {whChips(v)}
          </td>
          {canAdjust && (
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
          )}
          {show("change") && (
            <td className={`whitespace-nowrap text-sm font-semibold ${totalDiff > 0 ? "text-emerald-600" : totalDiff < 0 ? "text-rose-600" : "text-slate-400"}`} title="Change in stock">
              {totalDiff > 0 ? `+${totalDiff}` : totalDiff} {p.unit}
            </td>
          )}
          {prices}
        </>
      );
    }
    return (
      <>
        <td className="whitespace-nowrap">
          <StockBadge quantity={v.quantity} state={v.state} unit={p.unit} />
          {v.quantity < 0 && canAdjust && (
            <button type="button" className="ml-2 rounded border border-emerald-600 px-1.5 py-0.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50" title={`Bring stock back to 0 (+${-v.quantity} ${p.unit})`} onClick={() => setEdit(p, v, { qty: "0" })}>
              + Receive
            </button>
          )}
        </td>
        {canAdjust && (
          <td>
            <div className="flex w-fit items-center rounded-md border border-slate-300 bg-white">
              <button type="button" className="h-8 w-8" aria-label={`Decrease ${v.shortName}`} onClick={() => step(-1)}>−</button>
              <input className="h-8 w-20 border-x border-slate-300 text-center text-sm font-semibold outline-none" inputMode="numeric" aria-label={`New stock of ${v.shortName}`} value={e?.qty ?? String(v.quantity)} onChange={(ev) => setEdit(p, v, { qty: ev.target.value.replace(/[^\d]/g, "") })} />
              <button type="button" className="h-8 w-8" aria-label={`Increase ${v.shortName}`} onClick={() => step(1)}>+</button>
            </div>
          </td>
        )}
        {show("change") && (
          <td className={`whitespace-nowrap text-sm font-semibold ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-600" : "text-slate-400"}`} title="Change in stock">
            {diff > 0 ? `+${diff}` : diff} {p.unit}
          </td>
        )}
        {prices}
      </>
    );
  };
  const editHeadsFor = (all = false, measuredRows = false) => {
    const show = (id: string) => all || visible(id);
    return (
    <>
      <th>{whFilter && !measuredRows ? `In ${wh.codeOf(whFilter)}` : "Current Stock"}</th>
      {canAdjust && <th>{measuredRows ? "Add stock" : whFilter ? `New Stock (${wh.codeOf(whFilter)})` : "New Stock"}</th>}
      {show("change") && <th>Change</th>}
      {canConfigure && show("minSalePrice") && <th title="Minimum Selling Price — stored as a reference and not enforced">Minimum Selling Price ₹</th>}
      {canConfigure && show("salePrice") && <th title="Selling Price — what the customer pays">Selling Price ₹</th>}
      {canConfigure && show("minStock") && <th title="Minimum stock level — warns when stock drops to or below it">Min Stock</th>}
    </>
    );
  };
  const editHeads = editHeadsFor();
  const editCount = 1 + (canAdjust ? 1 : 0) + (show("change") ? 1 : 0) + (canConfigure && show("minSalePrice") ? 1 : 0) + (canConfigure && show("salePrice") ? 1 : 0) + (canConfigure && show("minStock") ? 1 : 0);
  // expand + product (+ category, sku) + edit columns
  const colCount = 2 + (show("category") ? 1 : 0) + (show("sku") ? 1 : 0) + editCount;
  // Variation sub-table: one column per attribute, in the product's attribute-definition order.
  const attrColumns = (p: StockProduct, vs: StockVariation[]) => variationAttributeColumns(p, vs);
  const drawerProduct = drawerId ? products.find((p) => p.id === drawerId) ?? null : null;
  const drawerVarIds = drawerProduct?.variations.map((v) => v.id) ?? [];
  const drawerDirty = dirtyIds.filter((id) => drawerVarIds.includes(id));
  const closeDrawer = () => setDrawerId(null);
  const tab = (label: string, n: number | undefined) => (n === undefined ? label : `${label} (${n})`);

  return (
    <div>
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
            {canEditProducts && (
              <Link href="/products/new?from=stock-in" className="btn-primary" onClick={guardLeave}><PlusIcon className="h-4 w-4" /> Add Product</Link>
            )}
          </div>
        }
      />

      <Toolbar>
        <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
          <b className={dirtyIds.length ? "text-emerald-600" : ""}>{dirtyIds.length}</b> with changes
          {pricedCount > 0 && <> • <b className="text-sky-600">{pricedCount}</b> repriced</>}
        </span>
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
        <button className="btn border border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800" disabled={saving || dirtyIds.length === 0} onClick={() => void save()}>
          {saving ? "Saving…" : `Save Stock (${dirtyIds.length})`}
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
            <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="">All Categories ({cats.data?.categories.length ?? 0})</option>
              {otherHeads.length > 0 ? (
                <optgroup label="Product Type">
                  {cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ) : (
                cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
              )}
              {otherHeads.map((h) => (
                <optgroup key={h.id} label={h.name}>
                  {(otherCats.data?.categories ?? []).filter((c) => c.headId === h.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>
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
            {view === "table" && <ColumnsMenu columns={availableColumns} hidden={hidden} onChange={(h) => void cols.save({ hidden: h })} onReset={() => void cols.save(null)} />}
          </Toolbar>
        </>
      )}

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
            action={!loading && canEditProducts ? <Link href="/products/new?from=stock-in" className="btn-primary"><PlusIcon className="h-4 w-4" /> Add Product</Link> : undefined}
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
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { setDrawerError(null); setDrawerId(p.id); }}
                  className="group card flex flex-col overflow-hidden text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <div className="overflow-hidden bg-slate-100">
                    <ProductThumb src={p.imageUrl ?? active[0]?.imageUrl ?? null} name={p.name} className="aspect-[4/3] w-full text-xl transition-transform duration-300 group-hover:scale-105" />
                  </div>
                  <div className="grid flex-1 content-start gap-1 p-3">
                    <div className="line-clamp-2 font-semibold text-slate-900">{p.name}</div>
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                      <span className="truncate">
                        {p.productType === "measured" ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">Measured</span>
                            <span>{active.length}{ofAll(p)} variations</span>
                          </span>
                        ) : p.productType === "variable" ? (
                          `${active.length}${ofAll(p)} variations`
                        ) : p.productType === "grouped" ? (
                          <SetTypesBadge groupId={p.id} warehouseId={whFilter} categoryId={setCategory_} />
                        ) : (
                          p.category?.name ?? "Uncategorized"
                        )}
                      </span>
                      <StockBadge quantity={p.quantity} state={p.state} unit={p.unit} />
                    </div>
                    {hi > 0 && <div className="text-sm font-semibold text-brand-700">{lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`}</div>}
                    {pending > 0 && <div className="text-[11px] font-semibold text-emerald-700">{pending} unsaved change(s)</div>}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto lg:overflow-x-visible">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-8" aria-label="Expand" />
                  <th>Product</th>
                  {show("category") && <th>Category</th>}
                  {editHeads}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const active = p.variations.filter((v) => v.active);
                  if (p.productType === "measured") {
                    const isOpen = !!openGroup[p.id];
                    return (
                      <Fragment key={p.id}>
                        <tr id={`stock-in-${p.id}`} className={`cursor-pointer ${focus === p.id ? "bg-brand-50" : ""}`} onClick={() => setOpenGroup((o) => ({ ...o, [p.id]: !isOpen }))}>
                          <td>
                            <button className="text-brand-600" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${p.name}`} onClick={(e) => { e.stopPropagation(); setOpenGroup((o) => ({ ...o, [p.id]: !isOpen })); }}>
                              {isOpen ? "⊖" : "⊕"}
                            </button>
                          </td>
                          <td className="font-semibold text-slate-900 align-top py-2">
                            <div className="flex items-center gap-2.5">
                              {show("image") && <ProductThumb src={p.imageUrl ?? active[0]?.imageUrl ?? null} name={p.name} className="h-9 w-9 rounded-md text-[7px] shrink-0" />}
                              <div>
                                <Link href={`/inventory/${p.id}`} className="hover:text-brand-700 hover:underline" onClick={(e) => { e.stopPropagation(); guardLeave(e); }}>{p.name}</Link>
                                <div className="mt-1 flex items-center gap-1.5">
                                  <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                                    {active.length}{ofAll(p)} variation{active.length === 1 && !ofAll(p) ? "" : "s"}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>
                          {show("category") && <td className="text-slate-600">{p.category?.name ?? "—"}</td>}
                          <td className="whitespace-nowrap"><StockBadge quantity={p.quantity} state={p.state} unit={p.unit} /></td>
                          <td colSpan={Math.max(1, editCount - 1)} className="text-xs font-medium text-sky-700">Expand to view & manage rolls</td>
                        </tr>
                        {isOpen && (
                          <MeasuredStock product={p} colSpan={colCount} />
                        )}
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
                        <tr id={`stock-in-${p.id}`} className={focus === p.id ? "bg-brand-50" : ""}>
                          <td>
                            <button className="text-brand-600" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${p.name}`} onClick={() => setOpenGroup((o) => ({ ...o, [p.id]: !isOpen }))}>
                              {isOpen ? "⊖" : "⊕"}
                            </button>
                          </td>
                          <td className="font-semibold text-slate-900 align-top py-2">
                            <div className="flex items-center gap-2.5">
                              {show("image") && <ProductThumb src={p.imageUrl ?? v.imageUrl ?? null} name={p.name} className="h-9 w-9 rounded-md text-[7px] shrink-0" />}
                              <div>
                                <Link href={`/inventory/${p.id}`} className="hover:text-brand-700 hover:underline" onClick={guardLeave}>{p.name}</Link>
                                <div className="mt-1">
                                  <SetTypesBadge groupId={p.id} warehouseId={whFilter} categoryId={setCategory_} />
                                </div>
                              </div>
                            </div>
                          </td>
                          {show("category") && <td className="text-slate-600">{p.category?.name ?? "—"}</td>}
                          {editCells(p, v)}
                        </tr>
                        {isOpen && <SetTypeRows groupId={p.id} colSpan={colCount} warehouseId={whFilter} layout="columns" categoryId={setCategory_} />}
                      </Fragment>
                    );
                  }
                  if (p.productType !== "variable") {
                    const v = active[0];
                    if (!v) return null;
                    return (
                      <tr key={p.id} id={`stock-in-${p.id}`} className={focus === p.id ? "bg-brand-50" : ""}>
                        <td />
                        <td className="font-medium text-slate-900">
                          <div className="flex items-center gap-2.5">
                            {show("image") && <ProductThumb src={p.imageUrl ?? active[0]?.imageUrl ?? null} name={p.name} className="h-9 w-9 rounded-md text-[7px] shrink-0" />}
                            <Link href={`/inventory/${p.id}`} className="hover:text-brand-700 hover:underline" onClick={guardLeave}>{p.name}</Link>
                          </div>
                        </td>
                        {show("category") && <td className="text-slate-600">{p.category?.name ?? "—"}</td>}
                        {editCells(p, v)}
                      </tr>
                    );
                  }
                  const isOpen = !!openGroup[p.id];
                  const total = active.reduce((s, v) => s + v.quantity, 0);
                  const attrCols = attrColumns(p, active);
                  return (
                    <Fragment key={p.id}>
                      <tr id={`stock-in-${p.id}`} className={`cursor-pointer ${focus === p.id ? "bg-brand-50" : ""}`} onClick={() => setOpenGroup((o) => ({ ...o, [p.id]: !isOpen }))}>
                        <td>
                          <button className="text-brand-600" aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${p.name}`} onClick={(e) => { e.stopPropagation(); setOpenGroup((o) => ({ ...o, [p.id]: !isOpen })); }}>
                            {isOpen ? "⊖" : "⊕"}
                          </button>
                        </td>
                        <td className="font-semibold text-slate-900 align-top py-2">
                          <div className="flex items-center gap-2.5">
                            {show("image") && <ProductThumb src={p.imageUrl ?? active[0]?.imageUrl ?? null} name={p.name} className="h-9 w-9 rounded-md text-[7px] shrink-0" />}
                            <div>
                              <Link href={`/inventory/${p.id}`} className="hover:text-brand-700 hover:underline" onClick={(e) => { e.stopPropagation(); guardLeave(e); }}>{p.name}</Link>
                              <div className="mt-1">
                                <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
                                  {active.length} variation{active.length === 1 ? "" : "s"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>
                        {show("category") && <td className="text-slate-600">{p.category?.name ?? "—"}</td>}
                        <td className="whitespace-nowrap"><StockBadge quantity={total} state={p.state} unit={p.unit} /></td>
                        <td colSpan={Math.max(1, editCount - 1)} className="text-xs text-slate-500">Expand to edit stock</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={colCount} className="bg-slate-50/70 px-4 py-3">
                            <table className="table rounded-md bg-white">
                              <thead>
                                <tr>
                                  <th>Order</th>
                                  {show("image") && <th aria-label="Image" />}
                                  {attrCols.map((c) => <th key={c.name}>{c.name}{c.unit ? ` (${c.unit})` : ""}</th>)}
                                  {editHeads}
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
                                    {editCells(p, v)}
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
          </div>
        )}
        {data && <div className={`${view === "grid" && products.length > 0 ? "pt-3" : "border-t border-slate-100 px-4 py-2"} text-xs text-slate-500`}>{data.total} products{dirtyIds.length ? ` · ${dirtyIds.length} unsaved change(s) are kept while you switch filters` : ""}</div>}
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
          dirty={drawerDirty.length}
          saving={saving}
          error={drawerError}
          reason={reason}
          reasons={REASONS}
          onReason={setReason}
          notes={notes}
          onNotes={setNotes}
          onSave={() => void save(drawerDirty).then((ok) => ok && setDrawerId(null))}
          onDiscard={() => setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => !drawerVarIds.includes(id))))}
          onClose={closeDrawer}
          extra={
            drawerProduct.productType === "grouped" ? (
              <>
                <h3 className="mb-1.5 text-sm font-semibold text-slate-800">Sets in stock</h3>
                <SetTypesTable groupId={drawerProduct.id} warehouseId={whFilter} layout="columns" categoryId={setCategory_} />
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
          meta={metaOf({ ...(measured.product.measure ?? {}), lengthUnit: measured.product.measure?.lengthUnit ?? "m" })}
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
