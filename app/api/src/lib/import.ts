import type { PartyType, Role } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { comboKey, normalizeShortName, orderAttributes, type AttributeDef, type Attributes } from "@rs-v31/shared";
import {
  IMPORT_KIND_LABEL,
  type ImportCheckResult,
  type ImportCommitResult,
  type ImportKind,
  type ImportRow,
  type ImportRowResult,
} from "@rs-v31/shared/import";
import { formatLength, toBaseMilli, type LengthUnit } from "@rs-v31/shared/measure";
import { z } from "zod";
import { prisma, type Db, type Tx } from "../db.js";
import { audit, auditMany } from "./audit.js";
import { documentBody, PURCHASE, SALE, writeDocument } from "./documents.js";
import { AppError } from "./errors.js";
import { addRolls, type RollInput } from "./measure.js";
import { can } from "./permissions.js";
import { createPlainProduct } from "./product-create.js";
import { plainProductBody, resolveVariation } from "./products.js";
import { MAX_ROWS } from "./sheet.js";
import { freeBalances, recordMovements, type MovementInput } from "./stock.js";
import { createWarehouse } from "./warehouses.js";

// V3.1 import (docs\IMPORT-V3.1.md). The browser matches the sheet's columns to fields and sends
// the rows; `checkImport` says per row what will happen without writing anything, `commitImport`
// does it in one transaction (all or nothing). Rows with errors are skipped only when the user
// confirmed that; a bill with any bad row is skipped whole. Every write goes through the same
// functions as the screens (createPlainProduct, addRolls, recordMovements, writeDocument).

export interface ImportCtx {
  companyId: string;
  actorId: string;
  requestId: string;
  role: Role;
}

const cell = z.string().max(500);
export const importBody = z.object({
  rows: z
    .array(
      z.object({
        rowNo: z.number().int().positive(),
        values: z.record(cell),
        options: z.array(z.object({ name: z.string().trim().max(60), value: z.string().trim().max(80) })).max(3).default([]),
      }),
    )
    .min(1, "The sheet has no rows to import")
    .max(MAX_ROWS, `At most ${MAX_ROWS} rows per import`),
  options: z
    .object({
      createProducts: z.boolean().default(true),
      createParties: z.boolean().default(true),
      createWarehouses: z.boolean().default(false),
    })
    .default({}),
  // Commit only: import the good rows and skip the ones with errors.
  skipErrors: z.boolean().default(false),
});
export type ImportBody = z.infer<typeof importBody>;

// ---------------------------------------------------------------------------
// Value parsing
// ---------------------------------------------------------------------------

const lower = (s: string) => s.trim().toLowerCase();

/** "₹1,250.50" → 1250.5; blank → undefined; junk → NaN. */
function parseNumber(s: string | undefined): number | undefined {
  const t = (s ?? "").replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (!t) return undefined;
  return /^-?\d*\.?\d+$/.test(t) ? Number(t) : NaN;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** yyyy-mm-dd, dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy or 01-Oct-2026 → "yyyy-mm-dd" (null = not a date). */
export function parseDate(s: string): string | null {
  const t = s.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[\s/-]([a-z]{3})[a-z]*[\s/-](\d{2,4})$/i.exec(t))) [d, m, y] = [Number(r[1]), MONTHS.indexOf(r[2]!.toLowerCase()) + 1, Number(r[3])];
  else return null;
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (m < 1 || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

const LENGTH_WORDS: Record<string, string> = { m: "m", mtr: "m", mtrs: "m", meter: "m", meters: "m", metre: "m", metres: "m", ft: "ft", feet: "ft", foot: "ft", in: "in", inch: "in", inches: "in", cm: "cm", mm: "mm" };

function productLengthUnit(s: string | undefined): LengthUnit | null | undefined {
  if (!s?.trim()) return undefined;
  const u = LENGTH_WORDS[lower(s)] ?? (lower(s) === "ft_in" ? "ft" : undefined);
  if (!u) return null;
  return u === "ft" || u === "in" ? "ft_in" : "m";
}

const PAYMENT: Record<string, "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE" | "CREDIT"> = {
  cash: "CASH",
  upi: "UPI",
  bank: "BANK_TRANSFER",
  "bank transfer": "BANK_TRANSFER",
  neft: "BANK_TRANSFER",
  rtgs: "BANK_TRANSFER",
  imps: "BANK_TRANSFER",
  cheque: "CHEQUE",
  check: "CHEQUE",
  credit: "CREDIT",
  udhar: "CREDIT",
};

const YES = new Set(["yes", "y", "true", "1", "sealed", "closed", "new", "unopened", "packed"]);

// ---------------------------------------------------------------------------
// Catalog: existing products and the ones the import will create
// ---------------------------------------------------------------------------

interface Group {
  id: string;
  name: string;
  productType: string;
  lengthUnit: LengthUnit | null;
  baseShortName: string;
  defs: AttributeDef[];
  active: boolean;
  variations: { id: string; attributeKey: string; attributes: Attributes; active: boolean; shortName: string }[];
}

interface NewProduct {
  key: string;
  name: string;
  type: "simple" | "variable" | "measured";
  unit: string;
  lengthUnit: LengthUnit | null;
  category: string | null;
  description: string | null;
  optionNames: string[];
}

/** One item a row points at: an existing variation or one the import creates. */
interface ItemRef {
  key: string;
  name: string;
  attributes: Attributes;
  productType: string;
  lengthUnit: LengthUnit | null;
  variationId?: string;
  /** New item: its product (new or existing) and the code / SKU typed for it. */
  create?: { productKey: string; groupId?: string; code?: string; sku?: string };
}

const label = (r: { name: string; attributes: Attributes }) => {
  const vals = Object.values(r.attributes);
  return vals.length ? `${r.name} · ${vals.join(" / ")}` : r.name;
};

class Catalog {
  groups = new Map<string, Group>();
  byName = new Map<string, Group>();
  byShort = new Map<string, { g: Group; v: Group["variations"][number] }>();
  bySku = new Map<string, { g: Group; v: Group["variations"][number] }>();
  shorts = new Set<string>();
  skus = new Set<string>();
  categories = new Map<string, string>();
  warehouses: { id: string; code: string; name: string; active: boolean }[] = [];
  warehousing = false;
  parties = new Map<string, { id: string; name: string; type: PartyType; active: boolean }>();
  newProducts = new Map<string, NewProduct>();
  /** New items by ref key. */
  newItems = new Map<string, ItemRef>();
  newCategories = new Map<string, string>();
  newParties = new Map<string, { name: string; type: PartyType }>();
  newWarehouses = new Map<string, { code: string; name: string }>();
  /** Products / items already named "(new …)" in a row's action; category notes already given. */
  announced = new Set<string>();
  /** Product name → option names that have a value on any of its rows (sheet order). */
  optionsByProduct = new Map<string, string[]>();
  notedCategories = new Set<string>();

  static async load(db: Db, companyId: string) {
    const c = new Catalog();
    const [groups, categories, warehouses, company, parties] = await Promise.all([
      db.productGroup.findMany({
        where: { companyId, ownerGroupId: null },
        select: {
          id: true,
          name: true,
          productType: true,
          lengthUnit: true,
          baseShortName: true,
          attributeDefinitions: true,
          active: true,
          variations: { select: { id: true, attributeKey: true, attributes: true, active: true, shortName: true, officialSku: true } },
        },
        orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      }),
      db.category.findMany({ where: { companyId, headId: null, active: true }, select: { id: true, name: true } }),
      db.warehouse.findMany({ where: { companyId }, select: { id: true, code: true, name: true, active: true } }),
      db.company.findUniqueOrThrow({ where: { id: companyId }, select: { warehousingEnabled: true } }),
      db.party.findMany({ where: { companyId }, select: { id: true, name: true, type: true, active: true } }),
    ]);
    // Main components of sets are not listed (ownerGroupId) but their codes are still taken.
    const hidden = await db.productVariation.findMany({ where: { companyId, group: { ownerGroupId: { not: null } } }, select: { shortName: true, officialSku: true } });
    for (const h of hidden) {
      c.shorts.add(h.shortName);
      if (h.officialSku) c.skus.add(h.officialSku.toLowerCase());
    }
    for (const g of groups) {
      const group: Group = {
        id: g.id,
        name: g.name,
        productType: g.productType,
        lengthUnit: g.lengthUnit,
        baseShortName: g.baseShortName,
        defs: g.attributeDefinitions as unknown as AttributeDef[],
        active: g.active,
        variations: g.variations.map((v) => ({ id: v.id, attributeKey: v.attributeKey, attributes: v.attributes as Attributes, active: v.active, shortName: v.shortName })),
      };
      c.groups.set(g.id, group);
      if (!c.byName.has(lower(g.name))) c.byName.set(lower(g.name), group);
      g.variations.forEach((v, i) => {
        c.shorts.add(v.shortName);
        c.byShort.set(v.shortName, { g: group, v: group.variations[i]! });
        if (v.officialSku) {
          c.skus.add(v.officialSku.toLowerCase());
          c.bySku.set(v.officialSku.toLowerCase(), { g: group, v: group.variations[i]! });
        }
      });
    }
    for (const cat of categories) c.categories.set(lower(cat.name), cat.id);
    c.warehouses = warehouses;
    c.warehousing = company.warehousingEnabled;
    for (const p of parties) c.parties.set(lower(p.name), p);
    return c;
  }
}

// ---------------------------------------------------------------------------
// Row checking
// ---------------------------------------------------------------------------

class RowCheck {
  messages: string[] = [];
  errors = 0;
  warnings = 0;
  action = "";
  constructor(readonly row: ImportRow) {}
  get v() {
    return this.row.values;
  }
  error(m: string) {
    this.messages.push(m);
    this.errors++;
    return null;
  }
  warn(m: string) {
    this.messages.push(m);
    this.warnings++;
  }
  result(): ImportRowResult {
    return { rowNo: this.row.rowNo, status: this.errors ? "error" : this.warnings ? "warning" : "ok", action: this.action, messages: this.messages };
  }
}

interface Plan {
  kind: ImportKind;
  cat: Catalog;
  checks: RowCheck[];
  /** Per row: what to do, filled by the kind's checker; null = error row. */
  work: (Work | null)[];
}

interface Work {
  ref?: ItemRef;
  quantity?: number;
  /** Measured: length in thousandths of the base unit; `rolls` = how many rolls of it. */
  lengthMilli?: number;
  rolls?: number;
  rollKind?: "CLOSED" | "OPEN";
  warehouse?: string;
  rack?: string | null;
  rollNo?: string | null;
  notes?: string | null;
  cost?: string;
  salePrice?: string;
  minSalePrice?: string;
  purchaseCost?: string;
  lowStock?: number;
  price?: string;
  discount?: string;
  bill?: string;
  billNo?: string;
  date?: string;
  party?: string;
  paymentMode?: (typeof PAYMENT)[string];
}

/** A whole-rupee money value, ≥ 0. Rates are whole rupees in this app (money in lib/stock). */
function moneyField(c: RowCheck, key: string, labelText: string): string | undefined {
  const n = parseNumber(c.v[key]);
  if (n === undefined) return undefined;
  if (!Number.isFinite(n) || n < 0) {
    c.error(`${labelText}: "${c.v[key]}" is not an amount`);
    return undefined;
  }
  const r = Math.round(n);
  if (r !== n) c.warn(`${labelText} ${n} rounded to ₹${r} (rates are whole rupees)`);
  return String(r);
}

function textField(c: RowCheck, key: string, max: number, labelText: string): string | null {
  const t = (c.v[key] ?? "").trim();
  if (!t) return null;
  if (t.length > max) {
    c.warn(`${labelText} cut to ${max} characters`);
    return t.slice(0, max);
  }
  return t;
}

function resolveWarehouse(plan: Plan, c: RowCheck, ctx: ImportCtx, opts: ImportBody["options"]): string | undefined {
  const name = (c.v.warehouse ?? "").trim();
  if (!name) return undefined;
  const cat = plan.cat;
  const hit = cat.warehouses.find((w) => w.code.toLowerCase() === lower(name) || lower(w.name) === lower(name));
  if (hit) {
    if (!hit.active) return void c.error(`Warehouse ${hit.code} is inactive`);
    return `id:${hit.id}`;
  }
  if (opts.createWarehouses && can(ctx.role, "warehouse.manage")) {
    if (!cat.newWarehouses.has(lower(name))) {
      const base = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "WH";
      let code = base;
      for (let i = 2; cat.warehouses.some((w) => w.code === code) || [...cat.newWarehouses.values()].some((w) => w.code === code); i++) code = `${base.slice(0, 8)}${i}`;
      cat.newWarehouses.set(lower(name), { code, name: name.slice(0, 60) });
    }
    return `new:${lower(name)}`;
  }
  if (!cat.warehousing) {
    c.warn(`Warehouse "${name}" ignored: warehouses are not set up (tick "Create missing warehouses" to set them up)`);
    return undefined;
  }
  return void c.error(`No warehouse "${name}"`);
}

function resolveParty(plan: Plan, c: RowCheck, type: PartyType, opts: ImportBody["options"], ctx: ImportCtx): string | undefined {
  const name = (c.v.party ?? "").trim();
  if (!name) return undefined;
  const role = type === "SUPPLIER" ? "supplier" : "customer";
  const p = plan.cat.parties.get(lower(name));
  if (p) {
    if (!p.active) return void c.error(`${p.name} is inactive`);
    if (p.type !== type && p.type !== "BOTH") return void c.error(`${p.name} is a ${p.type.toLowerCase()}, not a ${role}; change it to Both first`);
    return `id:${p.id}`;
  }
  if (!opts.createParties) return void c.error(`No ${role} "${name}"`);
  if (type === "SUPPLIER" && !can(ctx.role, "party.create")) return void c.error(`No ${role} "${name}"`);
  if (name.length > 150) return void c.error(`${role} name is too long`);
  if (!plan.cat.newParties.has(lower(name))) plan.cat.newParties.set(lower(name), { name, type });
  return `new:${lower(name)}`;
}

/**
 * Finds the row's item, or plans it: a new variation of an existing product, or a new product.
 * `wantsLength` = the row carries a length, so a new product is Measured.
 */
function resolveItem(plan: Plan, c: RowCheck, allowCreate: boolean, wantsLength: boolean): ItemRef | null {
  const cat = plan.cat;
  const code = normalizeShortName(c.v.code ?? "");
  const name = (c.v.product ?? "").trim();
  if (code) {
    const hit = cat.byShort.get(code) ?? cat.bySku.get(code.toLowerCase());
    if (hit) {
      if (hit.g.productType === "grouped") return c.error(`${hit.g.name} is a grouped product; its stock is its sets`);
      if (!hit.g.active || !hit.v.active) return c.error(`${hit.v.shortName} is archived`);
      return { key: hit.v.id, name: hit.g.name, attributes: hit.v.attributes, productType: hit.g.productType, lengthUnit: hit.g.lengthUnit, variationId: hit.v.id };
    }
    if (!name) return c.error(`No item with code ${code}`);
    if (cat.shorts.has(code)) return c.error(`Code ${code} is already used`);
  }
  if (!name) return c.error("Give a product name or an item code");
  if (name.length > 150) return c.error("Product name is too long (150 characters at most)");

  // Options with a value; a blank one counts only where the product has that option ("None").
  const options: { name: string; value: string }[] = [];
  const blank: string[] = [];
  for (const o of c.row.options) {
    if (!o.name) continue;
    if (options.some((x) => lower(x.name) === lower(o.name))) return c.error(`Option ${o.name} is given twice`);
    if (/[|=]/.test(o.name) || o.value.includes("|")) return c.error(`Option ${o.name}: | and = cannot be used`);
    if (o.value) options.push(o);
    else blank.push(o.name);
  }
  const fillBlanks = (names: readonly string[]) => {
    for (const n of names) {
      if (options.some((o) => lower(o.name) === lower(n)) || !blank.some((b) => lower(b) === lower(n))) continue;
      c.warn(`${n} is blank — used "None"`);
      options.push({ name: n, value: "None" });
    }
  };

  const g = cat.byName.get(lower(name));
  if (g) {
    if (g.productType === "grouped") return c.error(`${g.name} is a grouped product; its stock is its sets`);
    if (!g.active) return c.error(`${g.name} is archived`);
    if (g.productType === "simple") {
      if (options.length) c.warn(`${g.name} has no options; ${options.map((o) => o.name).join(", ")} ignored`);
      const v = g.variations[0]!;
      return { key: v.id, name: g.name, attributes: {}, productType: g.productType, lengthUnit: g.lengthUnit, variationId: v.id };
    }
    fillBlanks(g.defs.map((d) => d.name));
    const attrs: Attributes = {};
    for (const o of options) {
      const def = g.defs.find((d) => lower(d.name) === lower(o.name));
      if (!def) return c.error(`${g.name} has no option "${o.name}" (its options: ${g.defs.map((d) => d.name).join(", ")})`);
      attrs[def.name] = def.values.find((x) => lower(x) === lower(o.value)) ?? o.value;
    }
    const missing = g.defs.filter((d) => !attrs[d.name]);
    if (missing.length) return c.error(`Give ${missing.map((d) => d.name).join(", ")} for ${g.name}`);
    const ordered = orderAttributes(attrs, g.defs);
    const ak = comboKey(ordered);
    const v = g.variations.find((x) => x.attributeKey === ak);
    if (v) {
      if (!v.active) return c.error(`${label({ name: g.name, attributes: ordered })} is archived`);
      return { key: v.id, name: g.name, attributes: ordered, productType: g.productType, lengthUnit: g.lengthUnit, variationId: v.id };
    }
    if (!allowCreate) return c.error(`${label({ name: g.name, attributes: ordered })} does not exist`);
    return planItem(cat, c, `grp:${g.id}`, g.name, ordered, g.productType, g.lengthUnit, code, g.id);
  }

  let np = cat.newProducts.get(lower(name));
  if (!np) {
    if (!allowCreate) return c.error(`No product named "${name}"`);
    const typed = lower(c.v.productType ?? "");
    const lengthUnit = productLengthUnit(c.v.lengthUnit);
    if (lengthUnit === null) return c.error(`"${c.v.lengthUnit}" is not a length unit (m or ft)`);
    let type: NewProduct["type"];
    const optionCount = cat.optionsByProduct.get(lower(name))?.length ?? options.length;
    if (!typed) type = wantsLength || lengthUnit ? "measured" : optionCount ? "variable" : "simple";
    else if (["simple", "variable", "measured"].includes(typed)) type = typed as NewProduct["type"];
    else if (["length", "roll", "rolls", "by length", "cut"].includes(typed)) type = "measured";
    else return c.error(`Product type "${c.v.productType}": use simple, variable or measured`);
    if (type === "simple" && optionCount) type = "variable";
    if (type !== "measured" && wantsLength) return c.error(`${name} would be a counted product; a length needs a measured product`);
    // Every option any row of this product fills in (a later row may carry a brand the first lacks).
    const optionNames = [...(cat.optionsByProduct.get(lower(name)) ?? options.map((o) => o.name))];
    if (type === "measured" && !optionNames.length) optionNames.push("Variant");
    const unitIn = productLengthUnit(c.v.lengthIn);
    np = {
      key: `new:${lower(name)}`,
      name,
      type,
      unit: type === "measured" ? "" : (c.v.unit ?? "").trim().slice(0, 20) || "pcs",
      lengthUnit: type === "measured" ? (lengthUnit ?? unitIn ?? "m") : null,
      category: (c.v.category ?? "").trim().slice(0, 100) || null,
      description: (c.v.description ?? "").trim().slice(0, 1000) || null,
      optionNames,
    };
    cat.newProducts.set(lower(name), np);
    if (np.category && !cat.categories.has(lower(np.category))) cat.newCategories.set(lower(np.category), np.category);
  } else if ((c.v.category ?? "").trim() && lower(c.v.category!) !== lower(np.category ?? "") && !cat.notedCategories.has(`${np.key}|${lower(c.v.category!)}`)) {
    cat.notedCategories.add(`${np.key}|${lower(c.v.category!)}`);
    c.warn(`${np.name} is created once, in category ${np.category ?? "(none)"}; this row's category is ignored`);
  }
  fillBlanks(np.optionNames);
  const attrs: Attributes = {};
  if (np.type === "measured" && np.optionNames[0] === "Variant" && !options.length) attrs.Variant = "Standard";
  for (const o of options) {
    const n = np.optionNames.find((x) => lower(x) === lower(o.name));
    if (!n) return c.error(`Rows for new product ${np.name} must use the same options (${np.optionNames.join(", ") || "none"})`);
    attrs[n] = o.value;
  }
  if (Object.keys(attrs).length !== np.optionNames.length) return c.error(`Give ${np.optionNames.join(", ")} for ${np.name}`);
  const ordered: Attributes = {};
  for (const n of np.optionNames) ordered[n] = attrs[n]!;
  return planItem(cat, c, np.key, np.name, ordered, np.type, np.lengthUnit, code);
}

function planItem(cat: Catalog, c: RowCheck, productKey: string, name: string, attributes: Attributes, productType: string, lengthUnit: LengthUnit | null, code: string, groupId?: string): ItemRef {
  const key = `${productKey}|${comboKey(attributes)}`;
  const existing = cat.newItems.get(key);
  if (existing) return existing;
  const sku = (c.v.sku ?? "").trim() || undefined;
  if (sku && cat.skus.has(sku.toLowerCase())) c.warn(`SKU ${sku} is already used; a new one is generated`);
  const ref: ItemRef = { key, name, attributes, productType, lengthUnit, create: { productKey, groupId, code: code || undefined, sku: sku && !cat.skus.has(sku.toLowerCase()) ? sku : undefined } };
  cat.newItems.set(key, ref);
  return ref;
}

// The length as typed ("1,968.504 ft"), for the row's action text.
const typedLength = new WeakMap<RowCheck, string>();

/** Length of a measured row in thousandths of the product's base unit. */
function lengthOf(c: RowCheck, ref: ItemRef): number | null {
  const n = parseNumber(c.v.length);
  if (n === undefined) return c.error(`${ref.name} is sold by length: give the length`);
  if (!Number.isFinite(n) || n <= 0) return c.error(`Length "${c.v.length}" must be more than 0`);
  const unit = ref.lengthUnit!;
  const typed = (c.v.lengthIn ?? "").trim();
  const entry = typed ? LENGTH_WORDS[lower(typed)] : unit === "m" ? "m" : "ft";
  if (!entry) return c.error(`"${typed}" is not a length unit (m, ft, in, cm, mm)`);
  const milli = toBaseMilli(n, entry, unit);
  if (!Number.isFinite(milli)) return c.error(`${ref.name} is kept in ${unit === "m" ? "metres" : "feet + inches"}; a length in ${entry} cannot be used`);
  if (milli <= 0 || milli > 1_000_000_000) return c.error("Length is out of range");
  typedLength.set(c, `${n.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${entry}`);
  return milli;
}

/** Counted quantity: a whole number above 0. */
function countOf(c: RowCheck, ref: ItemRef): number | null {
  const n = parseNumber(c.v.quantity);
  if (n === undefined) return c.error(`Give the quantity of ${label(ref)}`);
  if (!Number.isFinite(n) || n <= 0) return c.error(`Quantity "${c.v.quantity}" must be more than 0`);
  if (!Number.isInteger(n)) return c.error(`Quantity of ${label(ref)} must be a whole number`);
  if (n > 1_000_000) return c.error("Quantity is too large");
  return n;
}

const unitText = (ref: ItemRef) => (ref.lengthUnit ? "" : " pcs");
/** " (new product)" on the first row that creates a product, " (new item)" on rows adding items. */
function newTag(cat: Catalog, ref: ItemRef) {
  if (!ref.create || cat.announced.has(ref.key)) return "";
  cat.announced.add(ref.key);
  if (ref.create.groupId || cat.announced.has(ref.create.productKey)) return " (new item)";
  cat.announced.add(ref.create.productKey);
  return " (new product)";
}

function checkRows(kind: ImportKind, cat: Catalog, body: ImportBody, ctx: ImportCtx): Plan {
  const plan: Plan = { kind, cat, checks: [], work: [] };
  const opts = body.options;
  const canCreate = opts.createProducts && can(ctx.role, "product.write");
  const canPrice = can(ctx.role, "inventory.configure");
  for (const row of body.rows) {
    const name = lower(row.values.product ?? "");
    if (!name) continue;
    const list = cat.optionsByProduct.get(name) ?? [];
    for (const o of row.options) if (o.name && o.value && !list.some((x) => lower(x) === lower(o.name))) list.push(o.name);
    cat.optionsByProduct.set(name, list);
  }
  for (const row of body.rows) {
    const c = new RowCheck(row);
    const w: Work = {};
    const hasLength = !!(c.v.length ?? "").trim();
    // A sheet's own Total / Sub total line is not a row to import.
    if ([...Object.values(c.v), ...row.options.map((o) => o.value)].some((x) => /^(grand\s*|sub\s*-?\s*)?totals?:?$/i.test(x.trim()))) {
      c.error("Looks like a totals row; skipped");
      plan.checks.push(c);
      plan.work.push(null);
      continue;
    }
    if (kind === "products") {
      const ref = resolveItem(plan, c, canCreate, !!productLengthUnit(c.v.lengthUnit) || lower(c.v.productType ?? "") === "measured");
      if (ref) {
        w.ref = ref;
        w.salePrice = moneyField(c, "salePrice", "Selling price");
        w.minSalePrice = moneyField(c, "minSalePrice", "Minimum price");
        w.purchaseCost = moneyField(c, "purchaseCost", "Cost");
        const low = parseNumber(c.v.lowStock);
        if (low !== undefined) {
          if (!Number.isInteger(low) || low < 0) c.error("Low stock alert must be a whole number");
          else w.lowStock = low;
        }
        const priced = w.salePrice !== undefined || w.minSalePrice !== undefined || w.purchaseCost !== undefined || w.lowStock !== undefined;
        if (priced && !canPrice) c.error("You cannot set prices");
        if (w.salePrice && w.minSalePrice && Number(w.minSalePrice) > Number(w.salePrice)) c.warn("Minimum price is above the selling price");
        c.action = ref.create ? `Create ${label(ref)}${newTag(cat, ref)}` : priced ? `Update prices of ${label(ref)}` : `${label(ref)} already exists`;
        if (!ref.create && !priced) c.warn("Already exists; nothing to change");
      }
    } else if (kind === "stock") {
      const ref = resolveItem(plan, c, canCreate, hasLength);
      if (ref) {
        w.ref = ref;
        w.warehouse = resolveWarehouse(plan, c, ctx, opts);
        w.cost = moneyField(c, "cost", "Cost");
        w.salePrice = moneyField(c, "salePrice", "Selling price");
        if ((w.cost !== undefined || w.salePrice !== undefined) && !canPrice) c.error("You cannot set costs or prices");
        const where = w.warehouse ? ` in ${(c.v.warehouse ?? "").trim()}` : "";
        if (ref.productType === "measured") {
          const len = lengthOf(c, ref);
          const count = parseNumber(c.v.quantity);
          if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 500)) c.error("Quantity of rolls must be a whole number from 1 to 500");
          if (len) {
            w.lengthMilli = len;
            w.rolls = count ?? 1;
            w.rollKind = c.v.rollKind === undefined || YES.has(lower(c.v.rollKind)) ? "CLOSED" : "OPEN";
            w.rack = textField(c, "rack", 40, "Rack");
            w.rollNo = textField(c, "rollNo", 60, "Roll no.");
            w.notes = textField(c, "notes", 300, "Notes");
            const len$ = typedLength.get(c) ?? formatLength(len, ref.lengthUnit!);
            c.action = `${w.rolls > 1 ? `${w.rolls} rolls` : "Roll"} ${len$} (${w.rollKind === "CLOSED" ? "sealed" : "open"})${w.rollNo ? ` ${w.rollNo}` : ""} → ${label(ref)}${newTag(cat, ref)}${where}`;
          }
        } else if (hasLength) {
          c.error(`${label(ref)} is counted, not sold by length: use Quantity`);
        } else {
          const q = countOf(c, ref);
          if (q) {
            w.quantity = q;
            c.action = `+${q}${unitText(ref)} → ${label(ref)}${newTag(cat, ref)}${where}`;
          }
        }
      }
    } else {
      const isSale = kind === "sales";
      w.billNo = (c.v.billNo ?? "").trim().slice(0, 60);
      const rawDate = (c.v.date ?? "").trim();
      if (rawDate) {
        const d = parseDate(rawDate);
        if (!d) c.error(`Date "${rawDate}" not understood (use dd/mm/yyyy)`);
        else if (d > new Date().toISOString().slice(0, 10)) c.error(`Date ${d} is in the future`);
        else w.date = d;
      }
      w.party = resolveParty(plan, c, isSale ? "CUSTOMER" : "SUPPLIER", opts, ctx);
      w.bill = w.billNo || `${w.date ?? ""}|${lower(c.v.party ?? "")}`;
      const pm = lower(c.v.paymentMode ?? "");
      if (pm) {
        w.paymentMode = PAYMENT[pm];
        if (!w.paymentMode) c.error(`Payment "${c.v.paymentMode}": use cash, upi, bank, cheque or credit`);
      }
      const ref = resolveItem(plan, c, !isSale && canCreate, hasLength);
      w.price = moneyField(c, "price", "Rate");
      if (w.price === undefined && !c.errors) c.error("Give the rate");
      w.discount = moneyField(c, "discount", "Discount");
      w.notes = textField(c, "notes", 300, "Notes");
      w.warehouse = resolveWarehouse(plan, c, ctx, opts);
      if (ref) {
        w.ref = ref;
        const bill = w.billNo ? `Bill ${w.billNo}: ` : "";
        if (ref.productType === "measured") {
          const len = lengthOf(c, ref);
          if (len) {
            w.lengthMilli = len;
            if (isSale) {
              if ((c.v.quantity ?? "").trim() && parseNumber(c.v.quantity) !== 1) c.warn("Quantity ignored: a sale row of a measured item is one cut of the given length");
              w.rolls = 1;
            } else {
              const count = parseNumber(c.v.quantity);
              if (count !== undefined && (!Number.isInteger(count) || count < 1 || count > 500)) c.error("Quantity of rolls must be a whole number from 1 to 500");
              w.rolls = count ?? 1;
              w.rollNo = textField(c, "rollNo", 60, "Roll no.");
            }
            c.action = `${bill}${isSale ? "Sell" : w.rolls! > 1 ? `${w.rolls} rolls of` : "Roll"} ${typedLength.get(c) ?? formatLength(len, ref.lengthUnit!)} ${label(ref)}${newTag(cat, ref)} @ ₹${w.price ?? "?"}`;
          }
        } else if (hasLength) {
          c.error(`${label(ref)} is counted, not sold by length: use Quantity`);
        } else {
          const q = countOf(c, ref);
          if (q) {
            w.quantity = q;
            c.action = `${bill}${q}${unitText(ref)} ${label(ref)}${newTag(cat, ref)} @ ₹${w.price ?? "?"}`;
          }
        }
      }
    }
    plan.checks.push(c);
    plan.work.push(c.errors ? null : w);
  }
  return plan;
}

/** Sales: rows use up the existing items' free stock in sheet order; rows past it are errors. */
async function checkSaleStock(plan: Plan, companyId: string) {
  const ids = [...new Set(plan.work.map((w) => w?.ref?.variationId).filter((x): x is string => !!x))];
  if (!ids.length) return;
  const { free } = await freeBalances(prisma, companyId, ids);
  const left = new Map(ids.map((id) => [id, Math.round((free.get(id) ?? 0) * 1000)]));
  plan.work.forEach((w, i) => {
    const id = w?.ref?.variationId;
    if (!w || !id) return;
    const need = w.lengthMilli ?? (w.quantity ?? 0) * 1000;
    const have = left.get(id)!;
    if (need <= have) {
      left.set(id, have - need);
      return;
    }
    const fmt = (m: number) => (w.ref!.lengthUnit ? formatLength(m, w.ref!.lengthUnit) : String(m / 1000));
    plan.checks[i]!.error(`Not enough stock of ${label(w.ref!)}: ${fmt(Math.max(0, have))} free after the rows above`);
    plan.work[i] = null;
  });
}

/** Purchases / sales: a bill with any bad row is skipped whole. */
function skipBrokenBills(plan: Plan) {
  if (plan.kind !== "sales" && plan.kind !== "purchases") return;
  const broken = new Set<string>();
  plan.checks.forEach((c, i) => {
    if (c.errors) broken.add(billKey(plan, i));
  });
  plan.checks.forEach((c, i) => {
    if (!c.errors && broken.has(billKey(plan, i))) {
      c.error("Another row of this bill has an error; the whole bill is skipped");
      plan.work[i] = null;
    }
  });
  // A bill is one document: max 200 lines.
  const sizes = new Map<string, number>();
  plan.work.forEach((w, i) => w && sizes.set(billKey(plan, i), (sizes.get(billKey(plan, i)) ?? 0) + 1));
  plan.work.forEach((w, i) => {
    if (w && (sizes.get(billKey(plan, i)) ?? 0) > 200) {
      plan.checks[i]!.error("A bill can have at most 200 rows");
      plan.work[i] = null;
    }
  });
}

function billKey(plan: Plan, i: number) {
  const v = plan.checks[i]!.v;
  const no = (v.billNo ?? "").trim();
  return no ? `no:${no.toLowerCase()}` : `${(v.date ?? "").trim()}|${lower(v.party ?? "")}`;
}

function summarize(plan: Plan): ImportCheckResult {
  const rows = plan.checks.map((c) => c.result());
  const counts = { ok: 0, warning: 0, error: 0 };
  for (const r of rows) counts[r.status]++;
  const used = usedRefs(plan);
  const products = [...plan.cat.newProducts.values()].filter((p) => [...used.values()].some((r) => r.create?.productKey === p.key));
  const items = [...used.values()].filter((r) => r.create);
  const bills = new Set<string>();
  plan.work.forEach((w, i) => w && bills.add(billKey(plan, i)));
  const usedKeys = (field: "party" | "warehouse") => new Set(plan.work.filter((w): w is Work => !!w).map((w) => w[field]).filter((k): k is string => !!k?.startsWith("new:")).map((k) => k.slice(4)));
  const parties = usedKeys("party");
  const warehouses = usedKeys("warehouse");
  return {
    kind: plan.kind,
    rows,
    counts,
    creates: {
      products: products.map((p) => `${p.name} (${p.type})`),
      variations: items.map((r) => label(r)),
      categories: [...new Set(products.map((p) => p.category).filter((x): x is string => !!x && !plan.cat.categories.has(lower(x))))],
      parties: [...parties].map((k) => plan.cat.newParties.get(k)!.name),
      warehouses: [...warehouses].map((k) => {
        const w = plan.cat.newWarehouses.get(k)!;
        return `${w.name} (${w.code})`;
      }),
    },
    documents: plan.kind === "sales" || plan.kind === "purchases" ? bills.size : 0,
  };
}

function usedRefs(plan: Plan) {
  const out = new Map<string, ItemRef>();
  for (const w of plan.work) if (w?.ref) out.set(w.ref.key, w.ref);
  return out;
}

async function buildPlan(kind: ImportKind, ctx: ImportCtx, body: ImportBody): Promise<Plan> {
  const cat = await Catalog.load(prisma, ctx.companyId);
  const plan = checkRows(kind, cat, body, ctx);
  if (kind === "sales") await checkSaleStock(plan, ctx.companyId);
  skipBrokenBills(plan);
  return plan;
}

export async function checkImport(kind: ImportKind, ctx: ImportCtx, body: ImportBody): Promise<ImportCheckResult> {
  return summarize(await buildPlan(kind, ctx, body));
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

const IMPORT_TX = { timeout: 180_000, maxWait: 10_000 } as const;

/** "Wire Rope" → "WIRE-ROPE", made unique so none of its codes clash with existing ones. */
function baseCodeFor(name: string): string {
  return (
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 16)
      .replace(/-+$/, "") || "ITEM"
  );
}

/** Creates the planned categories, products, variations, parties and warehouses; ref key → variation id. */
async function materialize(tx: Tx, plan: Plan, ctx: ImportCtx) {
  const cat = plan.cat;
  const c = { companyId: ctx.companyId, actorId: ctx.actorId, requestId: ctx.requestId };
  const ids = new Map<string, string>();
  const used = [...usedRefs(plan).values()];
  for (const r of used) if (r.variationId) ids.set(r.key, r.variationId);

  // Categories (Product Type head) of the products created.
  const products = [...cat.newProducts.values()].filter((p) => used.some((r) => r.create?.productKey === p.key));
  for (const p of products) {
    if (!p.category || cat.categories.has(lower(p.category))) continue;
    const last = await tx.category.aggregate({ where: { companyId: c.companyId, headId: null }, _max: { sortOrder: true } });
    const created = await tx.category.create({
      data: { companyId: c.companyId, name: p.category, headId: null, sortOrder: (last._max.sortOrder ?? 0) + 1, createdById: c.actorId, updatedById: c.actorId },
      select: { id: true, name: true },
    });
    await audit(tx, { companyId: c.companyId, actorId: c.actorId, action: "CATEGORY_CREATE", entityType: "Category", entityId: created.id, after: { ...created, source: "import" }, requestId: c.requestId });
    cat.categories.set(lower(p.category), created.id);
  }

  // New products with all their imported variations.
  for (const p of products) {
    const items = used.filter((r) => r.create?.productKey === p.key);
    const defs: AttributeDef[] = p.optionNames.map((n) => ({ name: n, unit: "", values: [...new Set(items.map((r) => r.attributes[n]!))], abbrMap: {} }));
    const base0 = p.type === "simple" ? (items[0]!.create!.code ?? baseCodeFor(p.name)) : baseCodeFor(p.name);
    let base = base0;
    for (let i = 2; ; i++) {
      const codes = items.map((r) =>
        p.type === "simple" ? { shortName: base, officialSku: null } : resolveVariation({ attributes: r.attributes, shortName: r.create!.code, officialSku: r.create!.sku, description: null, imageUrl: null }, defs, base),
      );
      const clash = codes.some((x) => cat.shorts.has(x.shortName) || (x.officialSku && cat.skus.has(x.officialSku.toLowerCase())));
      if (!clash || (p.type === "simple" && items[0]!.create!.code)) break;
      if (i > 99) throw new AppError(409, "CODE_TAKEN", `Could not make free codes for ${p.name}`);
      base = `${base0.slice(0, 13)}-${i}`;
    }
    const common = { name: p.name, description: p.description, imageUrl: null, categoryId: p.category ? cat.categories.get(lower(p.category))! : null };
    const body =
      p.type === "simple"
        ? { productType: "simple" as const, ...common, unit: p.unit, shortName: base, officialSku: items[0]!.create!.sku ?? undefined }
        : {
            productType: p.type,
            ...common,
            unit: p.unit || "pcs",
            baseShortName: base,
            attributes: defs,
            variations: items.map((r) => ({ attributes: r.attributes, shortName: r.create!.code, officialSku: r.create!.sku })),
            ...(p.type === "measured" ? { measure: { lengthUnit: p.lengthUnit! } } : {}),
          };
    const out = await createPlainProduct(tx, c, plainProductBody.parse(body));
    for (const v of out.variations) {
      cat.shorts.add(v.shortName);
      if (v.officialSku) cat.skus.add(v.officialSku.toLowerCase());
      const r = items.find((x) => comboKey(x.attributes) === comboKey(v.attributes as Attributes));
      if (r) ids.set(r.key, v.id);
    }
  }

  // New variations of existing products: declare the new option values, then add them.
  const byGroup = new Map<string, ItemRef[]>();
  for (const r of used) if (r.create?.groupId) byGroup.set(r.create.groupId, [...(byGroup.get(r.create.groupId) ?? []), r]);
  for (const [groupId, items] of byGroup) {
    const g = cat.groups.get(groupId)!;
    const defs = g.defs.map((d) => ({ ...d, values: [...new Set([...d.values, ...items.map((r) => r.attributes[d.name]!)])] }));
    const rows = items.map((r) => resolveVariation({ attributes: r.attributes, shortName: r.create!.code, officialSku: r.create!.sku, description: null, imageUrl: null }, defs, g.baseShortName));
    for (const row of rows) {
      if (cat.shorts.has(row.shortName)) row.shortName = `${row.shortName}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
      if (row.officialSku && cat.skus.has(row.officialSku.toLowerCase())) row.officialSku = null;
      cat.shorts.add(row.shortName);
      if (row.officialSku) cat.skus.add(row.officialSku.toLowerCase());
    }
    await tx.productGroup.update({ where: { id: g.id }, data: { attributeDefinitions: defs as unknown as Prisma.InputJsonValue, version: { increment: 1 }, updatedById: c.actorId } });
    const last = await tx.productVariation.aggregate({ where: { groupId: g.id }, _max: { sortOrder: true } });
    const created = await tx.productVariation.createManyAndReturn({
      data: rows.map((v, i) => ({ ...v, companyId: c.companyId, groupId: g.id, sortOrder: (last._max.sortOrder ?? -1) + 1 + i, createdById: c.actorId, updatedById: c.actorId })),
      select: { id: true, attributeKey: true, shortName: true },
    });
    for (const v of created) {
      const r = items.find((x) => comboKey(x.attributes) === v.attributeKey);
      if (r) ids.set(r.key, v.id);
    }
    await audit(tx, { companyId: c.companyId, actorId: c.actorId, action: "VARIATION_CREATE", entityType: "ProductGroup", entityId: g.id, after: { variations: created, source: "import" }, requestId: c.requestId });
  }

  // Parties and warehouses used by imported rows.
  const parties = new Map<string, string>();
  const warehouses = new Map<string, string>();
  for (const w of plan.work) {
    if (!w) continue;
    if (w.party?.startsWith("id:")) parties.set(w.party, w.party.slice(3));
    else if (w.party && !parties.has(w.party)) {
      const p = cat.newParties.get(w.party.slice(4))!;
      const created = await tx.party.create({ data: { companyId: c.companyId, type: p.type, name: p.name, createdById: c.actorId, updatedById: c.actorId }, select: { id: true, name: true, type: true } });
      await audit(tx, { companyId: c.companyId, actorId: c.actorId, action: "PARTY_CREATE", entityType: "Party", entityId: created.id, after: { ...created, source: "import" }, requestId: c.requestId });
      parties.set(w.party, created.id);
    }
    if (w.warehouse?.startsWith("id:")) warehouses.set(w.warehouse, w.warehouse.slice(3));
    else if (w.warehouse && !warehouses.has(w.warehouse)) {
      const spec = cat.newWarehouses.get(w.warehouse.slice(4))!;
      const { warehouse } = await createWarehouse(tx, c, { code: spec.code, name: spec.name, address: null });
      warehouses.set(w.warehouse, warehouse.id);
    }
  }
  return { ids, parties, warehouses };
}

/** Selling price / minimum / cost / low-stock settings carried by the rows (last row wins). */
async function applyPrices(tx: Tx, plan: Plan, ctx: ImportCtx, ids: Map<string, string>) {
  const per = new Map<string, Prisma.ProductVariationUpdateInput>();
  for (const w of plan.work) {
    if (!w?.ref) continue;
    const data: Prisma.ProductVariationUpdateInput = {};
    if (w.salePrice !== undefined) data.salePrice = w.salePrice;
    if (w.minSalePrice !== undefined) data.minSalePrice = w.minSalePrice;
    if (w.purchaseCost !== undefined) data.purchaseCost = w.purchaseCost;
    if (w.lowStock !== undefined) data.lowStockThreshold = w.lowStock;
    if (!Object.keys(data).length) continue;
    const id = ids.get(w.ref.key)!;
    per.set(id, { ...per.get(id), ...data });
  }
  for (const [id, data] of per) await tx.productVariation.update({ where: { id }, data: { ...data, updatedById: ctx.actorId } });
  await auditMany(
    tx,
    [...per].map(([id, data]) => ({ companyId: ctx.companyId, actorId: ctx.actorId, action: "INVENTORY_CONFIGURE", entityType: "ProductVariation", entityId: id, after: { ...data, source: "import" }, requestId: ctx.requestId })),
  );
  return per.size;
}

async function commitStock(tx: Tx, plan: Plan, ctx: ImportCtx, ids: Map<string, string>, warehouses: Map<string, string>) {
  const c = { companyId: ctx.companyId, actorId: ctx.actorId, requestId: ctx.requestId };
  // Counted: one movement per item and warehouse — OPENING the first time, else ADJUSTMENT.
  const counted = new Map<string, { variationId: string; warehouseId?: string; quantity: number; rate?: string }>();
  // Measured: rolls per item and cost.
  const rolls = new Map<string, { variationId: string; cost: string | null; rolls: RollInput[] }>();
  plan.work.forEach((w) => {
    if (!w?.ref) return;
    const variationId = ids.get(w.ref.key)!;
    const warehouseId = w.warehouse ? warehouses.get(w.warehouse) : undefined;
    if (w.lengthMilli) {
      const k = `${variationId}|${w.cost ?? ""}`;
      const e = rolls.get(k) ?? { variationId, cost: w.cost ?? null, rolls: [] };
      for (let i = 0; i < (w.rolls ?? 1); i++) e.rolls.push({ length: w.lengthMilli, kind: w.rollKind ?? "CLOSED", supplierRollNo: w.rollNo ?? null, rack: w.rack ?? null, notes: w.notes ?? null, warehouseId: warehouseId ?? null });
      rolls.set(k, e);
    } else if (w.quantity) {
      const k = `${variationId}|${warehouseId ?? ""}`;
      const e = counted.get(k) ?? { variationId, warehouseId, quantity: 0, rate: w.cost };
      e.quantity += w.quantity;
      counted.set(k, e);
    }
  });
  if (counted.size) {
    const list = [...counted.values()];
    const histories = await tx.stockMovement.groupBy({ by: ["variationId", "warehouseId"], where: { companyId: c.companyId, variationId: { in: list.map((x) => x.variationId) } }, _count: true });
    const whOn = plan.cat.warehousing || plan.cat.newWarehouses.size > 0;
    const seen = new Set(histories.map((h) => `${h.variationId}|${whOn ? h.warehouseId : ""}`));
    const defaultWh = whOn ? (await tx.warehouse.findFirst({ where: { companyId: c.companyId, isDefault: true }, select: { id: true } }))?.id : undefined;
    const movements: MovementInput[] = list.map((x) => ({
      variationId: x.variationId,
      type: seen.has(`${x.variationId}|${whOn ? (x.warehouseId ?? defaultWh) : ""}`) ? "ADJUSTMENT" : "OPENING",
      quantity: x.quantity,
      rate: x.rate ?? null,
      reason: "Imported stock",
      warehouseId: x.warehouseId,
    }));
    const change = await recordMovements(tx, c.companyId, c.actorId, movements, { requestId: c.requestId });
    await auditMany(
      tx,
      list.map((x) => ({
        companyId: c.companyId,
        actorId: c.actorId,
        action: "STOCK_IN",
        entityType: "ProductVariation",
        entityId: x.variationId,
        before: { quantity: change[x.variationId]?.before },
        after: { quantity: change[x.variationId]?.after, ...(x.warehouseId ? { warehouseId: x.warehouseId } : {}) },
        reason: "Imported stock",
        requestId: c.requestId,
      })),
    );
  }
  let rollCount = 0;
  for (const e of rolls.values()) {
    for (let i = 0; i < e.rolls.length; i += 500) {
      await addRolls(tx, c, e.variationId, e.rolls.slice(i, i + 500), { unitCost: e.cost, note: "Imported" });
    }
    rollCount += e.rolls.length;
  }
  return { counted: counted.size, rolls: rollCount };
}

async function commitDocuments(tx: Tx, plan: Plan, ctx: ImportCtx, ids: Map<string, string>, parties: Map<string, string>, warehouses: Map<string, string>) {
  const isSale = plan.kind === "sales";
  const cfg = isSale ? SALE : PURCHASE;
  const bills = new Map<string, Work[]>();
  plan.work.forEach((w, i) => {
    if (!w) return;
    const k = billKey(plan, i);
    bills.set(k, [...(bills.get(k) ?? []), w]);
  });
  const whOn = plan.cat.warehousing || plan.cat.newWarehouses.size > 0;
  const numbers: string[] = [];
  for (const rows of bills.values()) {
    const head = rows[0]!;
    type Line = z.input<typeof documentBody>["lines"][number];
    const lines: Line[] = [];
    const merge = new Map<string, Line>();
    for (const w of rows) {
      const variationId = ids.get(w.ref!.key)!;
      const warehouseId = w.warehouse ? warehouses.get(w.warehouse) : undefined;
      if (w.lengthMilli && isSale) {
        lines.push({ variationId, quantity: w.lengthMilli / 1000, price: w.price!, discount: w.discount, note: w.notes });
        continue;
      }
      const k = `${variationId}|${w.price}`;
      const line = !w.discount ? merge.get(k) : undefined;
      if (w.lengthMilli) {
        const newRolls = Array.from({ length: w.rolls ?? 1 }, () => ({ length: w.lengthMilli! / 1000, supplierRollNo: w.rollNo ?? null, warehouseId: warehouseId ?? null }));
        if (line) line.rolls = [...(line.rolls ?? []), ...newRolls];
        else {
          const l: Line = { variationId, price: w.price!, rolls: newRolls, discount: w.discount, note: w.notes };
          lines.push(l);
          if (!w.discount) merge.set(k, l);
        }
        continue;
      }
      const split = whOn && warehouseId ? [{ warehouseId, quantity: w.quantity! }] : undefined;
      if (line) {
        line.quantity = (line.quantity ?? 0) + w.quantity!;
        if (line.splits || split) {
          const all = [...(line.splits ?? []), ...(split ?? [])];
          // Rows without a warehouse cannot be told apart once merged: keep them unsplit.
          line.splits = all.reduce((s, x) => s + x.quantity, 0) === line.quantity ? all : undefined;
        }
      } else {
        const l: Line = { variationId, quantity: w.quantity!, price: w.price!, discount: w.discount, note: w.notes, splits: split };
        lines.push(l);
        if (!w.discount) merge.set(k, l);
      }
    }
    // Same warehouse twice in one line's splits → one entry.
    for (const l of lines) {
      if (!l.splits) continue;
      const m = new Map<string, number>();
      for (const s of l.splits) m.set(s.warehouseId, (m.get(s.warehouseId) ?? 0) + s.quantity);
      l.splits = [...m].map(([warehouseId, quantity]) => ({ warehouseId, quantity }));
    }
    const notes = [head.billNo ? `Imported bill ${head.billNo}` : "Imported", head.notes].filter(Boolean).join(" — ").slice(0, 500);
    const body = documentBody.parse({
      partyId: head.party ? parties.get(head.party) : null,
      notes,
      date: head.date ?? null,
      warehouseId: !isSale && head.warehouse ? warehouses.get(head.warehouse) : null,
      paymentMode: head.paymentMode ?? null,
      lines,
    });
    try {
      const id = await writeDocument(tx, cfg, ctx, body);
      const doc = isSale ? await tx.sale.findUniqueOrThrow({ where: { id }, select: { number: true } }) : await tx.purchase.findUniqueOrThrow({ where: { id }, select: { number: true } });
      numbers.push(doc.number);
    } catch (e) {
      if (e instanceof AppError) throw new AppError(e.status, e.code, `${head.billNo ? `Bill ${head.billNo}` : "A bill"}: ${e.message}`, e.details);
      throw e;
    }
  }
  return numbers;
}

export async function commitImport(kind: ImportKind, ctx: ImportCtx, body: ImportBody): Promise<ImportCommitResult> {
  const plan = await buildPlan(kind, ctx, body);
  const summary = summarize(plan);
  const good = plan.work.filter(Boolean).length;
  if (!good) throw new AppError(400, "NOTHING_TO_IMPORT", "No row can be imported; fix the errors and check again");
  if (summary.counts.error && !body.skipErrors) {
    throw new AppError(400, "ROWS_WITH_ERRORS", `${summary.counts.error} row${summary.counts.error > 1 ? "s have" : " has"} errors; fix them or confirm skipping them`);
  }
  const result = await prisma.$transaction(async (tx) => {
    const { ids, parties, warehouses } = await materialize(tx, plan, ctx);
    const priced = await applyPrices(tx, plan, ctx, ids);
    const stock = kind === "stock" ? await commitStock(tx, plan, ctx, ids, warehouses) : null;
    const numbers = kind === "sales" || kind === "purchases" ? await commitDocuments(tx, plan, ctx, ids, parties, warehouses) : [];
    await audit(tx, {
      companyId: ctx.companyId,
      actorId: ctx.actorId,
      action: "IMPORT",
      entityType: "Import",
      entityId: kind,
      after: { kind, rows: good, skipped: summary.counts.error, creates: summary.creates, priced, stock, documents: numbers },
      requestId: ctx.requestId,
    });
    return { priced, stock, numbers };
  }, IMPORT_TX);

  const parts = [
    summary.creates.products.length && `${summary.creates.products.length} product${summary.creates.products.length > 1 ? "s" : ""} created`,
    summary.creates.variations.length && `${summary.creates.variations.length} item${summary.creates.variations.length > 1 ? "s" : ""} created`,
    result.stock?.rolls && `${result.stock.rolls} roll${result.stock.rolls > 1 ? "s" : ""} added`,
    result.stock?.counted && `${result.stock.counted} stock level${result.stock.counted > 1 ? "s" : ""} raised`,
    result.numbers.length && `${result.numbers.length} ${kind === "sales" ? "sale" : "purchase"}${result.numbers.length > 1 ? "s" : ""} recorded`,
    kind === "products" && result.priced && `${result.priced} price setting${result.priced > 1 ? "s" : ""} saved`,
    summary.counts.error && `${summary.counts.error} row${summary.counts.error > 1 ? "s" : ""} skipped`,
  ].filter(Boolean);
  return {
    ...summary,
    imported: good,
    skipped: summary.counts.error,
    documentNumbers: result.numbers,
    message: `${IMPORT_KIND_LABEL[kind]} import done: ${parts.join(" · ") || `${good} rows`}`,
  };
}
