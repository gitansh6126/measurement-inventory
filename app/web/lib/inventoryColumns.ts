import { qty as fmtQty } from "./format";
import type { StockProduct, StockVariation } from "./types";
import { perRate } from "./measure";

/** A Measured rate is per m, or per ft on a feet + inches product (0028). */
const withPer = (p: { measure?: { lengthUnit: Parameters<typeof perRate>[0] } | null }, text: string) => (text && p.measure ? `${text}${perRate(p.measure.lengthUnit)}` : text);

// Column catalogue shared by the Stock In table, the one-click PDF and the PDF builder
// (V2 plan §1.10). Identity columns (product, variation, current stock) are always shown so a
// row stays understandable; the rest can be hidden per user.

export interface ColumnDef {
  id: string;
  label: string;
  /** Cannot be hidden. */
  fixed?: boolean;
  /** Needs cost visibility (inventory.configure); the API omits the value otherwise. */
  cost?: boolean;
  align?: "right";
  value: (p: StockProduct, v: StockVariation | null) => string;
}

const variationLabel = (p: StockProduct, v: StockVariation | null) =>
  !v ? (p.productType === "variable" ? `${p.variations.filter((x) => x.active).length} variations` : "") : Object.values(v.attributes).join(" / ") || "—";
const money = (s: string | undefined) => (s === undefined ? "" : Number(s).toLocaleString("en-IN", { maximumFractionDigits: 2 }));
const stateLabel = { ok: "In stock", low: "Low", out: "Out", negative: "Negative" } as const;

export const INVENTORY_COLUMNS: ColumnDef[] = [
  { id: "product", label: "Product", fixed: true, value: (p) => p.name },
  { id: "variation", label: "Variation", fixed: true, value: variationLabel },
  { id: "officialSku", label: "Official SKU", value: (p, v) => (v ?? (p.productType === "simple" ? p.variations[0] : null))?.officialSku ?? "" },
  { id: "category", label: "Category", value: (p) => p.category?.name ?? "" },
  { id: "stock", label: "Current Stock", fixed: true, align: "right", value: (p, v) => `${fmtQty(v ? v.quantity : p.quantity)} ${p.unit}` },
  { id: "state", label: "Status", value: (p, v) => stateLabel[(v ?? p).state as keyof typeof stateLabel] ?? "" },
  { id: "activity", label: "Sales Activity", value: (p) => p.activityStatus },
  { id: "minStock", label: "Min Stock", align: "right", value: (p, v) => String(v ? v.lowStockThreshold : p.lowStockThreshold) },
  { id: "minSalePrice", label: "Minimum Selling Price ₹", align: "right", value: (p, v) => { const price = (v ?? (p.productType === "simple" ? p.variations[0] : null))?.minSalePrice; return price && Number(price) > 0 ? withPer(p, money(price)) : ""; } },
  { id: "salePrice", label: "Selling Price ₹", align: "right", value: (p, v) => withPer(p, money((v ?? (p.productType === "simple" ? p.variations[0] : null))?.salePrice)) },
  { id: "purchaseCost", label: "Cost ₹", align: "right", cost: true, value: (p, v) => withPer(p, money((v ?? (p.productType === "simple" ? p.variations[0] : null))?.purchaseCost)) },
  { id: "stockValue", label: "Stock Value ₹", align: "right", cost: true, value: (p, v) => money((v ?? p).stockValue) },
];

/** Data columns used by the Products inventory view and its PDF exports. */
export const PRODUCT_REPORT_COLUMNS: ColumnDef[] = [
  { id: "product", label: "Product", fixed: true, value: (p) => p.name },
  { id: "variation", label: "Variation", fixed: true, value: variationLabel },
  { id: "category", label: "Category", value: (p) => p.category?.name ?? "" },
  { id: "stock", label: "Stock on Hand", fixed: true, align: "right", value: (p, v) => `${fmtQty(v ? v.quantity : p.quantity)} ${p.unit}` },
  { id: "minSalePrice", label: "Minimum Selling Price Rs", align: "right", value: (p, v) => { const price = (v ?? (p.productType === "simple" ? p.variations[0] : null))?.minSalePrice; return price && Number(price) > 0 ? withPer(p, money(price)) : ""; } },
  { id: "salePrice", label: "Selling Price Rs", align: "right", value: (p, v) => withPer(p, money((v ?? (p.productType === "simple" ? p.variations[0] : null))?.salePrice)) },
  { id: "purchaseCost", label: "Purchasing Price Rs", align: "right", cost: true, value: (p, v) => withPer(p, money((v ?? (p.productType === "simple" ? p.variations[0] : null))?.purchaseCost)) },
  { id: "activity", label: "Sales Activity", value: (p) => p.activityStatus },
];

/** Columns shown by default (Stock In and PDFs). */
export const DEFAULT_HIDDEN = ["officialSku", "purchaseCost", "stockValue"];

export interface ExportRow {
  product: StockProduct;
  variation: StockVariation | null;
  /** Child row of a variable product (indented in the PDF). */
  child: boolean;
}

/**
 * Flattens products into export rows: a simple product is one row; a variable product is its
 * parent row followed by active variations (or all variations for product reports), regardless
 * of what is expanded on screen. `pick` (PDF builder) limits which rows are included.
 */
export function exportRows(
  products: StockProduct[],
  pick?: { products: Set<string>; variations: Set<string> },
  options: { includeInactiveVariations?: boolean } = {},
): ExportRow[] {
  const rows: ExportRow[] = [];
  for (const p of products) {
    const included = options.includeInactiveVariations ? p.variations : p.variations.filter((v) => v.active);
    if (p.productType !== "variable") {
      const v = included[0] ?? p.variations[0] ?? null;
      if (!pick || pick.products.has(p.id) || (v && pick.variations.has(v.id))) rows.push({ product: p, variation: v, child: false });
      continue;
    }
    const kids = pick ? included.filter((v) => pick.variations.has(v.id)) : included;
    if (pick && !pick.products.has(p.id) && kids.length === 0) continue;
    if (!pick || pick.products.has(p.id)) rows.push({ product: p, variation: null, child: false });
    for (const v of kids) rows.push({ product: p, variation: v, child: true });
  }
  return rows;
}

export function filterProductTableRows(
  products: StockProduct[],
  filters: {
    search: string;
    category: string;
    stage?: "" | "active" | "inactive";
    activity: "" | StockProduct["activityStatus"];
    quick: "" | "low" | "out" | "negative";
  },
) {
  const search = filters.search.trim().toLowerCase();
  return products.filter((p) => {
    if (filters.stage === "active" && !p.active) return false;
    if (filters.stage === "inactive" && p.active) return false;
    if (filters.activity && p.activityStatus !== filters.activity) return false;
    if (filters.category && (filters.category === "none" ? p.category : p.category?.id !== filters.category)) return false;
    if (filters.quick === "low" && p.quantity > p.lowStockThreshold) return false;
    if (filters.quick === "out" && p.quantity !== 0) return false;
    if (filters.quick === "negative" && p.quantity >= 0) return false;
    if (!search) return true;
    const hay = [p.name, p.category?.name ?? "", ...p.variations.flatMap((v) => [v.shortName, v.officialSku ?? "", ...Object.values(v.attributes)])]
      .join(" ")
      .toLowerCase();
    return search.split(/\s+/).every((term) => hay.includes(term));
  });
}
