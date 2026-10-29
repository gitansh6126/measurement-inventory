import type { AttributeDef, Attributes } from "@rs-v31/shared";

export type { AttributeDef, Attributes };

export type ProductActivityStatus = "Active" | "Min-Active" | "Inactive" | "Never Sold";

export interface Category {
  id: string;
  name: string;
  /** V3.1: null = the built-in Product Type head. */
  headId?: string | null;
  imageUrl: string | null;
  active: boolean;
  productCount: number;
  /** V3.1 (0038): products in it only for some variations or through a set's parts. */
  partialCount?: number;
}

/** V3.1 category head (GET /api/category-heads). Product Type is built in (id null). */
export interface CategoryHead {
  id: string | null;
  name: string;
  builtIn: boolean;
  active: boolean;
  sortOrder: number;
  categoryCount: number;
}

/** A product's category under a head other than Product Type. */
export interface HeadCategory {
  id: string;
  name: string;
  active: boolean;
  headId: string;
  headName: string;
}

/** V3.1 (0038): a category of another head on some variations only. */
export interface VariationCategory extends HeadCategory {
  variationIds: string[];
}

export interface Variation {
  id: string;
  shortName: string;
  officialSku: string | null;
  attributes: Attributes;
  description: string | null;
  imageUrl: string | null;
  salePrice: string;
  minSalePrice: string;
  purchaseCost: string;
  lowStockThreshold: number;
  /** Measured products: default roll length for this variation (purchase pre-fill only). */
  defaultRollLength?: number | null;
  active: boolean;
  version?: number;
  /** V3.1 (0038): categories of other heads on this variation only. */
  categoryIds?: string[];
}

/** Length settings of a Measured product (V2 plan §2.4). */
export interface MeasureSettings {
  lengthUnit: "m" | "ft_in";
  rollName: string | null;
  defaultRollLength: number | null;
  decimals: number | null;
  scrapBelow: number | null;
}

export type ProductType = "simple" | "variable" | "measured" | "grouped";

/** V3.1 grouped product (set): main component + by-products (docs\GROUPED-PRODUCTS-V3-PLAN.md). */
export interface GroupedInfo {
  main: {
    productId: string;
    name: string;
    unit: string;
    description: string | null;
    variationId: string | null;
    shortName: string | null;
    officialSku: string | null;
  } | null;
  byproducts: {
    id: string;
    productId: string;
    /** Shown name: the product name, plus " · label" when the link has one (two chains). */
    name: string;
    productName: string;
    label: string | null;
    productType: ProductType;
    unit: string;
    lengthUnit: "m" | "ft_in" | null;
    decimals: number | null;
    required: boolean;
    active: boolean;
    variations: { id: string; shortName: string; attributes: Attributes; label: string; salePrice: string }[];
  }[];
}

export type SetStatus = "IN_STOCK" | "HELD" | "SOLD" | "CANCELLED";

export interface SetPart {
  id: string;
  role: "MAIN" | "BY";
  byproductId: string | null;
  required: boolean;
  productId: string;
  productName: string;
  productType: ProductType;
  variationId: string;
  shortName: string;
  attributes: Attributes;
  quantity: number;
  lengthUnit: "m" | "ft_in" | null;
  piece: { id: string; code: string } | null;
  label: string;
  /** Clean display value: "8 mm · 3 m", or "Fitted" for a part with no options. */
  value: string;
  salePrice: string;
}

/** One part of a set as shown on screen: "Load Chain Grade 80" → "8 mm · 3 m" (no codes). */
export interface SetContentRow {
  name: string;
  value: string;
}

/** One set on a cart / order line: its parts, plus a short note such as the warehouse ("W1"). */
export interface SetDetail {
  rows: SetContentRow[];
  note?: string;
}

export interface GroupSet {
  id: string;
  code: string;
  groupId: string;
  groupName: string;
  /** Named by its current contents (D18): "Chain Hoist Set · 8 mm 3 m · Safety Hook 1 Ton". */
  name: string;
  /** Its set type (sets with the same parts, 0041). */
  typeKey: string;
  /** By-products part by part, for display. */
  contents: SetContentRow[];
  status: SetStatus;
  source: "PURCHASE" | "OPENING";
  warehouseId: string | null;
  rate: string;
  notes: string | null;
  purchase: { id: string; number: string } | null;
  sale: { id: string; number: string } | null;
  /** The sale order holding the set (status HELD, D23). */
  orderId?: string | null;
  version: number;
  createdAt: string;
  parts: SetPart[];
}

/**
 * 0041: one set type of a grouped product (GET /api/sets/types/:groupId): a standard set from
 * the product form, or sets in stock with the same parts. Prices and minimum stock are per type.
 */
export interface SetTypeRow {
  typeKey: string;
  name: string | null;
  standard: boolean;
  /** Parts as the set sheet takes them; `length` in base units (m, or inches on ft + in). */
  parts: { byproductId: string; variationId: string; length: number | null }[];
  contents: SetContentRow[];
  /** Sets in stock (in the asked warehouse); `openingCount` of them can be undone in Stock In. */
  count: number;
  openingCount: number;
  byWarehouse: Record<string, number>;
  salePrice: string;
  minSalePrice: string;
  lowStockThreshold: number;
  /** False: no own prices yet (the grouped product's old price is shown). */
  priced: boolean;
  sortOrder: number;
  rate: string;
}

export interface Product {
  id: string;
  name: string;
  productType: ProductType;
  baseShortName: string;
  description: string | null;
  unit: string;
  imageUrl: string | null;
  gallery?: string[];
  category: { id: string; name: string; active: boolean } | null;
  /** V3.1: categories under other heads (Industry, Material…), any number. */
  categories?: HeadCategory[];
  /** V3.1 (0038): categories of other heads on some variations only. */
  variationCategories?: VariationCategory[];
  attributes: AttributeDef[];
  /** Measured products only (null otherwise). */
  measure?: MeasureSettings | null;
  /** V3.1: grouped products only (null otherwise). */
  grouped?: GroupedInfo | null;
  /** V3.1: set on a grouped product's main component. */
  ownerGroup?: { id: string; name: string } | null;
  active: boolean;
  lastSaleAt: string | null;
  activityStatus: ProductActivityStatus;
  version?: number;
  variations: Variation[];
}

export interface CategoryList {
  categories: Category[];
  uncategorizedCount: number;
  totalCount: number;
}

// Common units for the unit field's suggestions; any text is allowed.
export const UNIT_SUGGESTIONS = ["Piece", "Nos", "Pcs", "Set", "Pair", "Box", "Kg", "Mtr", "Roll", "Ltr"];

// V2: "negative" = counted stock sold below zero after explicit Warn & Allow confirmation.
export type StockState = "ok" | "low" | "out" | "negative";
export type StockFilter = "all" | "low" | "out" | "negative";

export interface StockVariation extends Variation {
  /** Free stock (V3.1: stock fitted in sets is in `inSets`); a grouped product: sets in stock. */
  quantity: number;
  inSets?: number;
  state: StockState;
  stockValue: string;
  /** V3.1: stock per warehouse (zero rows left out); null while warehousing is off. */
  byWarehouse?: WarehouseQty[] | null;
}

// ---------------------------------------------------------------------------
// V3.1 warehouses (docs\WAREHOUSE-V3-PLAN.md)
// ---------------------------------------------------------------------------

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  address: string | null;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
  version: number;
  items: number;
  stockValue: string;
  rolls: number;
  sets: number;
}

/** GET /api/warehouses — `enabled` false = warehousing off (WH-0: show nothing about it). */
export interface WarehouseList {
  enabled: boolean;
  warehouses: Warehouse[];
}

/** Stock of one variation in one warehouse; `inSets` is fitted in sets there (not free). */
export interface WarehouseQty {
  warehouseId: string;
  code: string;
  quantity: number;
  inSets?: number;
}

/** A line's warehouse split: how much comes from / goes to each warehouse. */
export interface LineSplit {
  warehouseId: string;
  quantity: number;
}

export interface TransferSummary {
  id: string;
  number: string;
  date: string;
  from: { id: string; code: string; name: string } | null;
  to: { id: string; code: string; name: string } | null;
  lineCount: number;
  notes: string | null;
  createdBy: string | null;
  status: "DONE" | "CANCELLED";
}

export interface TransferDetail extends Omit<TransferSummary, "lineCount"> {
  createdAt: string;
  cancel: { reason: string; at: string; by: string | null } | null;
  lines: {
    lineNo: number;
    variationId: string;
    productName: string;
    shortName: string;
    unit: string;
    quantity: number;
    pieceId: string | null;
    pieceCode: string | null;
    setId: string | null;
    /** V3.1: a set line's parts (null for other lines). */
    setContents?: SetContentRow[] | null;
    note: string | null;
  }[];
}

export interface StockProduct extends Omit<Product, "variations"> {
  variations: StockVariation[];
  /** V3.1 (0038): under a category filter, the variations in it when not all are (else null). */
  categoryMatch?: string[] | null;
  quantity: number;
  lowStockThreshold: number;
  state: StockState;
  stockValue: string;
}

export interface InventorySummary {
  products: number;
  low: number;
  out: number;
  negative: number;
  variationsLow: number;
  variationsOut: number;
  variationsNegative: number;
  stockValue?: string;
  /** Rows each stock tab lists (product or any active variation matches). */
  tabs?: Record<StockFilter, number>;
}

/** GET /api/inventory: the page (or all matches when unpaged) plus KPIs over the filtered set. */
export interface InventoryList {
  products: StockProduct[];
  summary: InventorySummary;
  total: number;
  page: number;
  pageSize: number;
}

export interface Movement {
  id: string;
  type: "OPENING" | "PURCHASE" | "SALE" | "ADJUSTMENT" | "SALE_VOID" | "PURCHASE_VOID" | "TRANSFER_OUT" | "TRANSFER_IN" | "TRANSFER_VOID";
  quantity: number;
  unit: string;
  rate: string | null;
  /** The unit `rate` is per: "ft" on a feet + inches movement priced per foot (0028). */
  rateUnit?: string;
  reason: string | null;
  occurredAt: string;
  actor: string | null;
  balanceAfter: number;
  document?: { kind: "sale" | "purchase" | "transfer"; id: string; number: string | null } | null;
  /** V3.1: the warehouse the movement was in (null while warehousing is off). */
  warehouseCode?: string | null;
}

// ---------------------------------------------------------------------------
// Catalog browse (v2/docs/catalog-browse/ARCHITECTURE.md §3.2)
// ---------------------------------------------------------------------------

export interface StockCounts {
  productCount: number;
  lowCount: number;
  outCount: number;
  negativeCount: number;
}

export interface RailCategory extends Category {
  sortOrder: number;
  lowCount: number;
  outCount: number;
  negativeCount: number;
  coverImageUrl: string | null;
}

/** GET /api/categories?stats=1 */
export interface CategoryStatsList {
  categories: RailCategory[];
  uncategorizedCount: number;
  totalCount: number;
  uncategorized: StockCounts;
  all: StockCounts;
}

/** One card from GET /api/catalog/products (a summary: no variation rows). */
export interface ProductCard {
  id: string;
  name: string;
  productType: ProductType;
  /** Measured only: its prices are per m, or per ft on feet + inches (0028). */
  lengthUnit?: "m" | "ft_in" | null;
  shortName: string;
  unit: string;
  imageUrl: string | null;
  active: boolean;
  createdAt: string;
  category: { id: string; name: string } | null;
  /** Simple products only: the one variation, so the card can add it to the cart. */
  variationId: string | null;
  activeVariations: number;
  quantity: number;
  lowStockThreshold: number;
  state: StockState;
  lowVariations: number;
  outVariations: number;
  negativeVariations: number;
  priceMin: string | null;
  priceMax: string | null;
  minSalePrice: string | null;
  /** Cost roles only. */
  costMin?: string | null;
  costMax?: string | null;
  stockValue?: string;
  /** Vendor pricing roles: active supplier rates over the active variations (null = none). */
  vendor?: { min: string; max: string; suppliers: number } | null;
  saleCount30d?: number;
}

export type CatalogSort = "high_moving" | "name" | "price_asc" | "price_desc" | "stock" | "stock_low" | "newest";
export type CatalogStock = "all" | "in_stock" | "low" | "out" | "negative";

export interface CatalogPage {
  products: ProductCard[];
  summary: InventorySummary;
  total: number;
  page: number;
  pageSize: number;
}
