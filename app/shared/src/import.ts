// V3.1 import (docs\IMPORT-V3.1.md): the columns each import understands. Shared so the web
// app's column matching and the API's templates and checks use the same list.

export type ImportKind = "products" | "stock" | "purchases" | "sales";

export const IMPORT_KINDS: readonly ImportKind[] = ["products", "stock", "purchases", "sales"];

export const IMPORT_KIND_LABEL: Record<ImportKind, string> = {
  products: "Products",
  stock: "Stock",
  purchases: "Purchases",
  sales: "Sales",
};

export interface ImportField {
  key: string;
  label: string;
  /** Required on every row (a fixed value counts). */
  required?: boolean;
  /** An option column (Size, Brand…): its header becomes the option name. */
  option?: boolean;
  /** Lower-case header words that match this field automatically. */
  match: readonly string[];
  hint: string;
  /** The template's demo line. */
  demo: string;
}

/** Up to three options per item, matched by header (Size, Brand, Colour…). */
export const OPTION_KEYS = ["option1", "option2", "option3"] as const;

const OPTION_HEADERS = ["size", "brand", "colour", "color", "grade", "variant", "type of", "model", "thickness", "capacity", "make", "finish", "material"];

// Item columns: find an existing product, or describe the one to create.
const ITEM: ImportField[] = [
  { key: "product", label: "Product name", match: ["product", "product name", "item", "item name", "name", "particulars"], hint: "Existing product, or the name of the product to create", demo: "Wire Rope" },
  { key: "code", label: "Item code", match: ["item code", "short name", "sku code", "product code"], hint: "An existing item's code (finds it directly); on a new item, its code", demo: "" },
  { key: "option1", label: "Option 1", option: true, match: OPTION_HEADERS, hint: "e.g. Size — the header is the option name", demo: "20X36" },
  { key: "option2", label: "Option 2", option: true, match: OPTION_HEADERS, hint: "e.g. Brand", demo: "Tata" },
  { key: "option3", label: "Option 3", option: true, match: OPTION_HEADERS, hint: "e.g. Colour", demo: "" },
  { key: "productType", label: "Product type", match: ["product type", "item type"], hint: "New products: simple, variable or measured (blank = worked out)", demo: "measured" },
  { key: "unit", label: "Unit", match: ["unit", "uom", "units"], hint: "New counted products: pcs, kg, box…", demo: "" },
  { key: "lengthUnit", label: "Sold by length in", match: ["product length unit", "sold in"], hint: "New measured products: m or ft", demo: "m" },
  { key: "category", label: "Category", match: ["category", "group", "product group"], hint: "Product Type category; created if missing", demo: "X36" },
];

const LENGTH: ImportField[] = [
  { key: "length", label: "Length", match: ["length", "remaining", "remaining (ft)", "remaining (m)", "roll length", "meter", "metre", "mtr", "feet"], hint: "Measured items: one row = one roll / bundle", demo: "600" },
  { key: "lengthIn", label: "Length typed in", match: ["length unit", "length in"], hint: "m, ft, in, cm or mm (blank = the product's unit)", demo: "m" },
];

const FIELDS: Record<ImportKind, ImportField[]> = {
  products: [
    ...ITEM,
    { key: "sku", label: "Official SKU", match: ["sku", "official sku", "barcode"], hint: "Customer-facing code (new items)", demo: "" },
    { key: "description", label: "Description", match: ["description", "details"], hint: "New products", demo: "Steel wire rope" },
    { key: "salePrice", label: "Selling price", match: ["selling price", "sale price", "mrp", "rate", "price"], hint: "Per unit (per m / per ft for measured)", demo: "120" },
    { key: "minSalePrice", label: "Minimum price", match: ["minimum price", "min price", "min sale price"], hint: "Lowest price a sale may use", demo: "100" },
    { key: "purchaseCost", label: "Cost", match: ["cost", "purchase cost", "purchase price", "cost price"], hint: "Fallback cost per unit", demo: "80" },
    { key: "lowStock", label: "Low stock alert", match: ["low stock", "reorder level", "min stock", "low stock alert"], hint: "Whole number", demo: "50" },
  ],
  stock: [
    ...ITEM,
    { key: "quantity", label: "Quantity", match: ["quantity", "qty", "stock", "closing stock", "balance"], hint: "Counted items: quantity to add", demo: "" },
    ...LENGTH,
    { key: "rollKind", label: "Sealed / open", match: ["sealed pack", "sealed", "roll status", "closed", "condition"], hint: "Yes / sealed / closed = unopened roll; anything else = open", demo: "Yes" },
    { key: "warehouse", label: "Warehouse", match: ["warehouse", "godown", "godam", "location", "store"], hint: "Code or name (when warehouses are set up)", demo: "Godam" },
    { key: "rack", label: "Rack", match: ["rack", "shelf", "bin"], hint: "Measured rolls: where it sits", demo: "" },
    { key: "rollNo", label: "Roll no.", match: ["roll no", "roll number", "bundle no", "code", "bundle code", "tag"], hint: "Measured rolls: the roll's own number / tag", demo: "20-36-T1" },
    { key: "cost", label: "Cost", match: ["cost", "unit cost", "purchase rate", "cost price"], hint: "Cost per unit (per m / per ft for measured)", demo: "" },
    { key: "salePrice", label: "Selling price", match: ["selling price", "sale price", "mrp"], hint: "Optional: sets the item's selling price", demo: "" },
    { key: "notes", label: "Notes", match: ["notes", "remarks", "remark", "note"], hint: "Measured rolls: note on the roll", demo: "" },
  ],
  purchases: [
    { key: "billNo", label: "Bill no.", match: ["bill no", "bill number", "invoice no", "invoice number", "voucher no", "bill"], hint: "Rows with the same bill no. become one purchase", demo: "PB-101" },
    { key: "date", label: "Date", match: ["date", "bill date", "invoice date"], hint: "dd/mm/yyyy or yyyy-mm-dd (blank = today)", demo: "2026-10-01" },
    { key: "party", label: "Supplier", match: ["supplier", "supplier name", "vendor", "party", "party name"], hint: "Created if missing", demo: "Crossbee Ropes" },
    ...ITEM,
    { key: "quantity", label: "Quantity", match: ["quantity", "qty"], hint: "Counted items", demo: "" },
    ...LENGTH,
    { key: "price", label: "Rate", required: true, match: ["rate", "price", "unit price", "purchase rate"], hint: "Per unit (per m / per ft for measured)", demo: "95" },
    { key: "discount", label: "Discount", match: ["discount", "disc"], hint: "Flat ₹ off the line", demo: "" },
    { key: "warehouse", label: "Warehouse", match: ["warehouse", "godown", "godam", "location"], hint: "Receive into (when warehouses are set up)", demo: "" },
    { key: "rollNo", label: "Roll no.", match: ["roll no", "roll number", "bundle no"], hint: "Measured rolls", demo: "" },
    { key: "paymentMode", label: "Payment", match: ["payment", "payment mode", "mode"], hint: "cash, upi, bank, cheque or credit", demo: "credit" },
    { key: "notes", label: "Notes", match: ["notes", "remarks", "narration"], hint: "Bill note (first row of the bill)", demo: "" },
  ],
  sales: [
    { key: "billNo", label: "Bill no.", match: ["bill no", "bill number", "invoice no", "invoice number", "voucher no", "bill"], hint: "Rows with the same bill no. become one sale", demo: "SB-201" },
    { key: "date", label: "Date", match: ["date", "bill date", "invoice date"], hint: "dd/mm/yyyy or yyyy-mm-dd (blank = today)", demo: "2026-10-02" },
    { key: "party", label: "Customer", match: ["customer", "customer name", "buyer", "party", "party name"], hint: "Created if missing; blank = walk-in", demo: "Sharma Traders" },
    ...ITEM.filter((f) => f.key === "product" || f.key === "code" || f.option),
    { key: "quantity", label: "Quantity", match: ["quantity", "qty"], hint: "Counted items", demo: "" },
    ...LENGTH.map((f) => (f.key === "length" ? { ...f, hint: "Measured items: length sold", demo: "25" } : f)),
    { key: "price", label: "Rate", required: true, match: ["rate", "price", "unit price", "selling price"], hint: "Per unit (per m / per ft for measured)", demo: "120" },
    { key: "discount", label: "Discount", match: ["discount", "disc"], hint: "Flat ₹ off the line", demo: "" },
    { key: "warehouse", label: "Warehouse", match: ["warehouse", "godown", "godam", "location"], hint: "Take from (counted items, when warehouses are set up)", demo: "" },
    { key: "paymentMode", label: "Payment", match: ["payment", "payment mode", "mode"], hint: "cash, upi, bank, cheque or credit", demo: "cash" },
    { key: "notes", label: "Notes", match: ["notes", "remarks", "narration"], hint: "Bill note (first row of the bill)", demo: "" },
  ],
};

export const importFields = (kind: ImportKind): readonly ImportField[] => FIELDS[kind];

const norm = (s: string) => s.toLowerCase().replace(/[_.:#]/g, " ").replace(/\s+/g, " ").trim();
const stripUnits = (s: string) => s.replace(/\(.*?\)/g, "").trim();

/**
 * Suggests a column for each field from the sheet's headers: exact header first, then the
 * header without its "(unit)", then a header that starts with a known word. Each column is used
 * once; option fields take the remaining option-like headers in sheet order.
 */
export function suggestMapping(kind: ImportKind, headers: readonly string[]): Record<string, number> {
  const fields = FIELDS[kind];
  const used = new Set<number>();
  const out: Record<string, number> = {};
  const h = headers.map((x) => norm(x ?? ""));
  const passes: ((header: string, word: string) => boolean)[] = [
    (header, word) => header === word,
    (header, word) => stripUnits(header) === word,
    (header, word) => word.length > 3 && header.startsWith(word),
  ];
  for (const test of passes) {
    for (const f of fields) {
      if (f.option || out[f.key] !== undefined) continue;
      // A field always matches its own label, so the templates' headers come back matched.
      const words = [norm(f.label), ...f.match];
      const i = h.findIndex((header, idx) => header && !used.has(idx) && words.some((w) => test(header, w)));
      if (i >= 0) {
        out[f.key] = i;
        used.add(i);
      }
    }
  }
  const optionCols = h.map((header, i) => ({ header, i })).filter(({ header, i }) => header && !used.has(i) && OPTION_HEADERS.some((w) => stripUnits(header) === w || header.startsWith(w + " ")));
  OPTION_KEYS.forEach((key, n) => {
    const c = optionCols[n];
    if (c && fields.some((f) => f.key === key)) {
      out[key] = c.i;
      used.add(c.i);
    }
  });
  return out;
}

/** "Remaining (ft)" → "ft": a length unit written in the header, else null. */
export function unitInHeader(header: string): string | null {
  const m = /\((m|ft|in|cm|mm|mtr|meter|metre|feet|inch)\)/i.exec(header ?? "");
  if (!m) return null;
  const u = m[1]!.toLowerCase();
  return u === "mtr" || u === "meter" || u === "metre" ? "m" : u === "feet" ? "ft" : u === "inch" ? "in" : u;
}

/** One sheet row after column matching: field key → text, options as name/value pairs. */
export interface ImportRow {
  rowNo: number;
  values: Record<string, string>;
  options: { name: string; value: string }[];
}

export type ImportRowStatus = "ok" | "warning" | "error";

export interface ImportRowResult {
  rowNo: number;
  status: ImportRowStatus;
  /** What the row will do / did, e.g. "Roll 600 m → Wire Rope 20X36 / Tata (new item)". */
  action: string;
  messages: string[];
}

export interface ImportCheckResult {
  kind: ImportKind;
  rows: ImportRowResult[];
  counts: Record<ImportRowStatus, number>;
  creates: { products: string[]; variations: string[]; categories: string[]; parties: string[]; warehouses: string[] };
  /** Purchases / sales: documents the valid rows make. */
  documents: number;
}

export interface ImportCommitResult extends ImportCheckResult {
  imported: number;
  skipped: number;
  /** Sale / purchase numbers created. */
  documentNumbers: string[];
  message: string;
}
