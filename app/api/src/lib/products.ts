import { Prisma, type Role } from "@prisma/client";
import {
  autoOfficialSku,
  autoShortName,
  comboKey,
  normalizeOfficialSku,
  normalizeShortName,
  orderAttributes,
  type AttributeDef,
  type Attributes,
  type TechSpec,
} from "@rs-v31/shared";
import { BASE_UNIT_LABEL, LENGTH_UNITS, type LengthUnit } from "@rs-v31/shared/measure";
import { byproductName } from "@rs-v31/shared/sets";
import { z } from "zod";
import type { Tx } from "../db.js";
import { categoryIdsInput, variationCategoriesInput } from "./category-heads.js";
import { AppError } from "./errors.js";
import { internalImageId } from "./images.js";
import { can } from "./permissions.js";
import { productActivity } from "./product-activity.js";
import { hasChanges, versionField } from "./versions.js";

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const imageUrl = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v ? v : null))
  // An uploaded image ("/api/images/<id>", audit B01) or an external http(s) URL.
  .refine((v) => v === null || /^https?:\/\/\S+$/i.test(v) || internalImageId(v) !== null, "Image must be an uploaded image or start with http:// or https://");

export const gallery = z
  .array(
    z
      .string()
      .trim()
      .max(500)
      .refine(
        (v) => /^https?:\/\/\S+$/i.test(v) || internalImageId(v) !== null,
        "Image must be an uploaded image or start with http:// or https://"
      )
  )
  .max(30)
  .optional();

// 0044: technical specifications in the user's order; blank rows are dropped, a name only once.
export const specsInput = z
  .array(z.object({ name: z.string().trim().max(80), value: z.string().trim().max(300) }))
  .max(60, "At most 60 specification rows")
  .transform((rows) => rows.filter((r) => r.name || r.value))
  .superRefine((rows, ctx) => {
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.name) ctx.addIssue({ code: "custom", message: `Name the specification "${r.value}"` });
      const k = r.name.toLowerCase();
      if (r.name && seen.has(k)) ctx.addIssue({ code: "custom", message: `Specification listed twice: ${r.name}` });
      seen.add(k);
    }
  })
  .optional();

/** Stored specs as output (older rows may hold anything). */
export const specsOut = (v: Prisma.JsonValue | null | undefined): TechSpec[] =>
  Array.isArray(v) ? (v as unknown as TechSpec[]).filter((r) => r && typeof r.name === "string").map((r) => ({ name: r.name, value: String(r.value ?? "") })) : [];

const shortNameInput = z
  .string()
  .max(80)
  .transform(normalizeShortName)
  .refine((v) => v.length > 0, "Short Name is required");

// undefined = generate it; null or "" = no Official SKU assigned (BR-05).
const officialSkuInput = z
  .string()
  .max(80)
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : normalizeOfficialSku(v)));

// '|' and '=' are the separators of the combination key, so they cannot appear inside it.
const attrName = text(60).refine((v) => !/[|=]/.test(v), "Attribute names cannot contain | or =");
const attrValue = text(80).refine((v) => !v.includes("|"), "Attribute values cannot contain |");

export const attributeDefSchema = z
  .object({
    name: attrName,
    unit: z.string().trim().max(20).optional().default(""),
    values: z.array(attrValue).min(1, "Each attribute needs at least one value").max(200),
    abbrMap: z.record(z.string().trim().max(20)).optional().default({}),
    // main v2 VariationBuilder attribute kinds.
    isQuality: z.boolean().optional().default(false),
    sub: z.boolean().optional().default(false),
    subName: z.string().trim().max(60).optional().default(""),
    subUnit: z.string().trim().max(20).optional().default(""),
  })
  .superRefine((d, ctx) => {
    if (new Set(d.values).size !== d.values.length) {
      ctx.addIssue({ code: "custom", path: ["values"], message: `Duplicate value in ${d.name}` });
    }
    if (d.isQuality && d.values.some((v) => !/^[1-5]$/.test(v))) {
      ctx.addIssue({ code: "custom", path: ["values"], message: `${d.name}: quality grades are 1 to 5 stars` });
    }
    if (d.isQuality && d.sub) ctx.addIssue({ code: "custom", message: `${d.name}: an attribute is either Quality or Sub Var, not both` });
  })
  .transform((d): AttributeDef => {
    // Keep only abbreviations of declared values, and drop blanks.
    const abbrMap: Record<string, string> = {};
    for (const v of d.values) {
      const ab = d.abbrMap[v]?.trim();
      if (ab) abbrMap[v] = ab.toUpperCase();
    }
    const out: AttributeDef = { name: d.name, unit: d.isQuality ? "" : d.unit, values: d.values, abbrMap };
    if (d.isQuality) out.isQuality = true;
    if (d.sub) Object.assign(out, { sub: true, subName: d.subName, subUnit: d.subUnit });
    return out;
  });

export const attributeDefsSchema = z
  .array(attributeDefSchema)
  .min(1, "Define at least one attribute")
  .max(6, "At most 6 attributes")
  .superRefine((defs, ctx) => {
    const seen = new Set<string>();
    for (const d of defs) {
      const k = d.name.toLowerCase();
      if (seen.has(k)) ctx.addIssue({ code: "custom", message: `Duplicate attribute: ${d.name}` });
      seen.add(k);
    }
  });

// Optional positive length (base units, ≤ 3 decimals); null clears it.
const lengthSetting = z
  .number()
  .positive()
  .max(1_000_000)
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, "Use at most 3 decimal places")
  .nullish();

export const variationInput = z.object({
  attributes: z.record(z.string()),
  shortName: shortNameInput.optional(),
  officialSku: officialSkuInput,
  description: optionalText(1000),
  imageUrl,
  specs: specsInput,
  // Measured products: overrides the product's default roll length (purchase pre-fill only).
  defaultRollLength: lengthSetting,
  // V3.1 (0038): categories of other heads on this variation only (Variable / Measured).
  categoryIds: categoryIdsInput,
});
export type VariationInput = z.infer<typeof variationInput>;

const groupCommon = {
  name: text(150),
  unit: text(20),
  description: optionalText(1000),
  imageUrl,
  gallery,
  specs: specsInput,
  categoryId: z.string().min(1).nullish().transform((v) => v ?? null),
  // V3.1 (0033): categories of heads other than Product Type, e.g. Industry → Agriculture, Gym.
  categoryIds: categoryIdsInput,
};

// Measured products (V2 plan §2.4, DM-1/DM-7): length only — metres, or feet + inches stored
// in inches. The product's unit follows the length unit.
export const measureSettings = z.object({
  lengthUnit: z.enum(LENGTH_UNITS as unknown as [LengthUnit, ...LengthUnit[]]),
  rollName: z.string().trim().min(1).max(30).nullish().transform((v) => v || null),
  defaultRollLength: lengthSetting,
  // Decimal places and scrap-below are company settings per length unit (0029), not per product.
});
export type MeasureSettings = z.infer<typeof measureSettings>;

/** The company's decimal places and scrap-below length for one length unit (Settings, 0029). */
export async function companyLengthSettings(tx: Tx, companyId: string, unit: LengthUnit) {
  const c = await tx.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { lengthDecimalsM: true, scrapBelowM: true, lengthDecimalsFtIn: true, scrapBelowFtIn: true },
  });
  return unit === "ft_in"
    ? { lengthDecimals: c.lengthDecimalsFtIn, scrapBelow: c.scrapBelowFtIn }
    : { lengthDecimals: c.lengthDecimalsM, scrapBelow: c.scrapBelowM };
}

/** Columns for a Measured product's settings (unit is derived from the length unit). */
export const measureColumns = async (tx: Tx, companyId: string, m: MeasureSettings) => ({
  unit: BASE_UNIT_LABEL[m.lengthUnit],
  lengthUnit: m.lengthUnit,
  rollName: m.rollName ?? null,
  defaultRollLength: m.defaultRollLength ?? null,
  ...(await companyLengthSettings(tx, companyId, m.lengthUnit)),
});

const simpleBody = z.object({ productType: z.literal("simple"), ...groupCommon, shortName: shortNameInput, officialSku: officialSkuInput });
const variableBody = z.object({
  productType: z.literal("variable"),
  ...groupCommon,
  baseShortName: shortNameInput,
  attributes: attributeDefsSchema,
  variations: z.array(variationInput).min(1, "Create at least one variation").max(500),
});
const measuredBody = z.object({
  productType: z.literal("measured"),
  ...groupCommon,
  // The unit comes from the length unit; any typed unit is ignored.
  unit: z.string().trim().max(20).optional(),
  baseShortName: shortNameInput,
  attributes: attributeDefsSchema,
  // A Measured product always has variations (owner decision DM-1).
  variations: z.array(variationInput).min(1, "A measured product needs at least one variation").max(500),
  measure: measureSettings,
});

/** A Simple, Variable or Measured product (also a by-product created inside a grouped product). */
export const plainProductBody = z.discriminatedUnion("productType", [simpleBody, variableBody, measuredBody]);
export type PlainProductBody = z.infer<typeof plainProductBody>;

// V3.1 grouped product = set (docs\GROUPED-PRODUCTS-V3-PLAN.md §2). The main component is always
// created new and always Simple (D2, D3); by-products are linked as products, existing or created
// inline (D5), required or optional (D6). The grouped product itself is like a Simple product: one
// variation holding the set SKU and the set price.
export const groupedBody = z.object({
  productType: z.literal("grouped"),
  ...groupCommon,
  unit: text(20).default("Set"),
  shortName: shortNameInput,
  officialSku: officialSkuInput,
  main: z.object({
    name: text(150),
    shortName: shortNameInput,
    unit: text(20),
    officialSku: officialSkuInput,
    description: optionalText(1000),
  }),
  byproducts: z
    .array(
      z
        .object({
          productId: z.string().min(1).optional(),
          newProduct: plainProductBody.optional(),
          required: z.boolean().default(true),
          // The same product may be listed more than once (two chains); the label tells them apart.
          label: z.string().trim().max(60).nullish(),
        })
        .refine((b) => !!b.productId !== !!b.newProduct, "Pick an existing product or create a new one for each by-product"),
    )
    .min(1, "Add at least one by-product")
    .max(10, "At most 10 by-products"),
});
export type GroupedBody = z.infer<typeof groupedBody>;

export const createProductBody = z.discriminatedUnion("productType", [simpleBody, variableBody, measuredBody, groupedBody]);
export type CreateProductBody = z.infer<typeof createProductBody>;

export const updateProductBody = z
  .object({
    name: text(150).optional(),
    unit: text(20).optional(),
    description: optionalText(1000).optional(),
    imageUrl: imageUrl.optional(),
    gallery,
    specs: specsInput,
    categoryId: z.string().min(1).nullable().optional(),
    categoryIds: categoryIdsInput,
    // V3.1 (0038): categories on chosen variations only; replaces all of them when sent.
    variationCategories: variationCategoriesInput,
    active: z.boolean().optional(),
    // Simple products only: identity of the single variation.
    shortName: shortNameInput.optional(),
    officialSku: officialSkuInput,
    // Variable and Measured products.
    baseShortName: shortNameInput.optional(),
    attributes: attributeDefsSchema.optional(),
    // Measured products only (length unit changes are refused once stock exists; see routes).
    measure: measureSettings.partial().optional(),
    version: versionField,
  })
  .refine(hasChanges, "Nothing to update");

export const addVariationsBody = z.object({ variations: z.array(variationInput).min(1).max(500) });

export const updateVariationBody = z
  .object({
    shortName: shortNameInput.optional(),
    officialSku: officialSkuInput,
    description: optionalText(1000).optional(),
    imageUrl: imageUrl.optional(),
    specs: specsInput,
    active: z.boolean().optional(),
    defaultRollLength: lengthSetting.optional(),
    // V3.1 (0038): this variation's own categories of other heads (replaces them).
    categoryIds: categoryIdsInput,
    version: versionField,
  })
  .refine(hasChanges, "Nothing to update");

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface ResolvedVariation {
  attributes: Attributes;
  attributeKey: string;
  shortName: string;
  officialSku: string | null;
  description: string | null;
  imageUrl: string | null;
  specs?: Prisma.InputJsonValue;
  defaultRollLength?: number | null;
}

/**
 * Validates a variation against the declared attributes and fills generated codes
 * (BR-05/BR-07): every attribute needs a declared value; Short Name and Official SKU
 * are composed when omitted.
 */
export function resolveVariation(v: VariationInput, defs: readonly AttributeDef[], base: string): ResolvedVariation {
  const names = new Set(defs.map((d) => d.name));
  for (const k of Object.keys(v.attributes)) {
    if (!names.has(k)) throw new AppError(400, "UNKNOWN_ATTRIBUTE", `Unknown attribute: ${k}`);
  }
  for (const d of defs) {
    const value = v.attributes[d.name]?.trim();
    if (!value) throw new AppError(400, "MISSING_ATTRIBUTE", `Choose a value for ${d.name}`);
    if (!d.values.includes(value)) throw new AppError(400, "UNDECLARED_VALUE", `"${value}" is not a declared value of ${d.name}`);
  }
  const attributes = orderAttributes(v.attributes, defs);
  const shortName = v.shortName ?? normalizeShortName(autoShortName(base, attributes, defs));
  const officialSku = v.officialSku === undefined ? normalizeOfficialSku(autoOfficialSku(base, attributes, defs)) : v.officialSku;
  return {
    attributes,
    attributeKey: comboKey(attributes),
    shortName,
    officialSku,
    description: v.description,
    imageUrl: v.imageUrl,
    ...(v.specs ? { specs: v.specs as unknown as Prisma.InputJsonValue } : {}),
    ...(v.defaultRollLength ? { defaultRollLength: v.defaultRollLength } : {}),
  };
}

/** Rejects duplicate combinations, Short Names or Official SKUs inside one request. */
export function assertBatchUnique(rows: readonly ResolvedVariation[]) {
  const keys = new Set<string>();
  const shorts = new Set<string>();
  const skus = new Set<string>();
  for (const r of rows) {
    if (keys.has(r.attributeKey)) throw new AppError(409, "DUPLICATE_COMBINATION", `Combination listed twice: ${describe(r.attributes)}`);
    if (shorts.has(r.shortName)) throw new AppError(409, "SHORT_NAME_TAKEN", `Short Name listed twice: ${r.shortName}`);
    const sku = r.officialSku?.toLowerCase();
    if (sku && skus.has(sku)) throw new AppError(409, "OFFICIAL_SKU_TAKEN", `Official SKU listed twice: ${r.officialSku}`);
    keys.add(r.attributeKey);
    shorts.add(r.shortName);
    if (sku) skus.add(sku);
  }
}

const describe = (a: Attributes) => Object.values(a).join(" / ") || "(none)";

/** Friendly uniqueness checks; the database indexes remain the final guarantee under concurrency. */
export async function assertCodesFree(
  tx: Tx,
  companyId: string,
  rows: readonly { shortName: string; officialSku: string | null }[],
  exceptVariationId?: string,
) {
  const not = exceptVariationId ? { id: { not: exceptVariationId } } : {};
  const shortHit = await tx.productVariation.findFirst({
    where: { companyId, shortName: { in: rows.map((r) => r.shortName) }, ...not },
    select: { shortName: true },
  });
  if (shortHit) throw new AppError(409, "SHORT_NAME_TAKEN", `Short Name already exists: ${shortHit.shortName}`);
  for (const r of rows) {
    if (!r.officialSku) continue;
    const hit = await tx.productVariation.findFirst({
      where: { companyId, officialSku: { equals: r.officialSku, mode: "insensitive" }, ...not },
      select: { officialSku: true },
    });
    if (hit) throw new AppError(409, "OFFICIAL_SKU_TAKEN", `Official SKU already exists: ${hit.officialSku}`);
  }
}

export async function assertActiveCategory(tx: Tx, companyId: string, categoryId: string | null) {
  if (!categoryId) return;
  const c = await tx.category.findFirst({ where: { id: categoryId, companyId }, select: { active: true, headId: true } });
  if (!c) throw new AppError(400, "UNKNOWN_CATEGORY", "Category not found");
  // V3.1: the product's one category is a Product Type; other heads go in categoryIds.
  if (c.headId) throw new AppError(400, "NOT_PRODUCT_TYPE", "That category belongs to another head; add it under the head's categories");
  if (!c.active) throw new AppError(400, "INACTIVE_CATEGORY", "That category is inactive");
}

/**
 * Attribute edits on a Variable product may only extend it, so no variation can lose
 * its identity (BR-08 without main v2's rename/delete risk):
 * same attribute names (their order may change: identity is order-independent); declared
 * values may be added; a value may be removed only when no variation (active or archived)
 * uses it. Order, units and abbreviations affect only codes generated from now on (stored
 * codes are never rewritten).
 */
export function assertAttributeEditSafe(
  oldDefs: readonly AttributeDef[],
  newDefs: readonly AttributeDef[],
  variations: readonly { attributes: Prisma.JsonValue }[],
) {
  const oldNames = oldDefs.map((d) => d.name).sort();
  const newNames = newDefs.map((d) => d.name).sort();
  if (variations.length > 0 && oldNames.join("\u0000") !== newNames.join("\u0000")) {
    throw new AppError(409, "ATTRIBUTES_LOCKED", "Attribute names cannot be added, removed or renamed once variations exist");
  }
  for (const d of newDefs) {
    const before = oldDefs.find((o) => o.name === d.name);
    if (!before) continue;
    for (const removed of before.values.filter((v) => !d.values.includes(v))) {
      const used = variations.some((v) => (v.attributes as Attributes | null)?.[d.name] === removed);
      if (used) throw new AppError(409, "VALUE_IN_USE", `"${removed}" is used by a variation of ${d.name}; archive that variation instead`);
    }
  }
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export const groupInclude = {
  category: { select: { id: true, name: true, active: true } },
  // V3.1 (0033): categories of other heads, shown grouped by head.
  categoryLinks: {
    select: { category: { select: { id: true, name: true, active: true, head: { select: { id: true, name: true, active: true, sortOrder: true } } } } },
  },
  // V3.1 (0038): categories of other heads on chosen variations only.
  variationCategoryLinks: {
    select: { variationId: true, category: { select: { id: true, name: true, active: true, head: { select: { id: true, name: true, active: true, sortOrder: true } } } } },
  },
  // User-selected position is consistent across Inventory and Stock In; older records use
  // created_at/id as deterministic tie-breakers until the migration assigns their positions.
  variations: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }] },
  // V3.1 sets: a grouped product's main component and by-products; a main component's owner.
  mainComponent: { select: { id: true, name: true, unit: true, description: true, variations: { select: { id: true, shortName: true, officialSku: true } } } },
  byproducts: {
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      productId: true,
      label: true,
      required: true,
      sortOrder: true,
      product: {
        select: {
          id: true,
          name: true,
          productType: true,
          unit: true,
          lengthUnit: true,
          lengthDecimals: true,
          attributeDefinitions: true,
          active: true,
          variations: {
            where: { active: true },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
            select: { id: true, shortName: true, attributes: true, salePrice: true },
          },
        },
      },
    },
  },
  ownerGroup: { select: { id: true, name: true } },
} satisfies Prisma.ProductGroupInclude;

type GroupWithVariations = Prisma.ProductGroupGetPayload<{ include: typeof groupInclude }>;
type Variation = GroupWithVariations["variations"][number];

/**
 * @param defs the group's attribute definitions: JSONB does not keep key order, so attributes
 * are returned in definition order (the order codes are composed and chips are shown).
 */
export function serializeVariation(v: Variation, defs?: readonly AttributeDef[]) {
  const attrs = v.attributes as Attributes;
  return {
    id: v.id,
    shortName: v.shortName,
    officialSku: v.officialSku,
    attributes: defs?.length ? orderAttributes(attrs, defs) : attrs,
    description: v.description,
    imageUrl: v.imageUrl,
    specs: specsOut(v.specs),
    salePrice: v.salePrice.toFixed(2),
    minSalePrice: v.minSalePrice.toFixed(2),
    purchaseCost: v.purchaseCost.toFixed(2),
    lowStockThreshold: v.lowStockThreshold,
    defaultRollLength: v.defaultRollLength === null ? null : Number(v.defaultRollLength),
    active: v.active,
    version: v.version,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

type CategoryLink = GroupWithVariations["categoryLinks"][number]["category"];
const linkOut = (c: CategoryLink) => ({ id: c.id, name: c.name, active: c.active, headId: c.head!.id, headName: c.head!.name, headSort: c.head!.sortOrder });
const byHead = (a: ReturnType<typeof linkOut>, b: ReturnType<typeof linkOut>) =>
  a.headSort - b.headSort || a.headName.localeCompare(b.headName) || a.name.localeCompare(b.name);

/** V3.1 (0038): each variation-only category with the variations it is on. */
function variationCategoriesOf(g: GroupWithVariations) {
  const byCategory = new Map<string, ReturnType<typeof linkOut> & { variationIds: string[] }>();
  for (const l of g.variationCategoryLinks) {
    const row = byCategory.get(l.category.id) ?? { ...linkOut(l.category), variationIds: [] };
    row.variationIds.push(l.variationId);
    byCategory.set(l.category.id, row);
  }
  return [...byCategory.values()].sort(byHead).map(({ headSort: _, ...c }) => c);
}

export function serializeGroup(g: GroupWithVariations) {
  const variationCategories = variationCategoriesOf(g);
  return {
    id: g.id,
    name: g.name,
    productType: g.productType,
    baseShortName: g.baseShortName,
    description: g.description,
    unit: g.unit,
    imageUrl: g.imageUrl,
    gallery: g.gallery && g.gallery.length > 0 ? g.gallery : (g.imageUrl ? [g.imageUrl] : []),
    specs: specsOut(g.specs),
    category: g.category,
    categories: g.categoryLinks
      .map(({ category }) => linkOut(category))
      .sort(byHead)
      .map(({ headSort: _, ...c }) => c),
    // V3.1 (0038): categories of other heads on some variations only (each variation's ids too).
    variationCategories,
    attributes: g.attributeDefinitions as unknown as AttributeDef[],
    // Measured products (V2 plan §2): null for Simple / Variable.
    measure:
      g.productType === "measured" && g.lengthUnit
        ? {
            lengthUnit: g.lengthUnit,
            rollName: g.rollName,
            defaultRollLength: g.defaultRollLength === null ? null : Number(g.defaultRollLength),
            decimals: g.lengthDecimals,
            scrapBelow: g.scrapBelow === null ? null : Number(g.scrapBelow),
          }
        : null,
    // V3.1 grouped product (set): its main component and by-products; null otherwise.
    grouped:
      g.productType === "grouped"
        ? {
            main: g.mainComponent
              ? {
                  productId: g.mainComponent.id,
                  name: g.mainComponent.name,
                  unit: g.mainComponent.unit,
                  description: g.mainComponent.description,
                  variationId: g.mainComponent.variations[0]?.id ?? null,
                  shortName: g.mainComponent.variations[0]?.shortName ?? null,
                  officialSku: g.mainComponent.variations[0]?.officialSku ?? null,
                }
              : null,
            byproducts: g.byproducts.map((b) => {
              const defs = b.product.attributeDefinitions as unknown as AttributeDef[];
              return {
                id: b.id,
                productId: b.productId,
                // "Load Chain Grade 80 · Hand chain" when the link has a label.
                name: byproductName(b.product.name, b.label),
                productName: b.product.name,
                label: b.label,
                productType: b.product.productType,
                unit: b.product.unit,
                lengthUnit: b.product.lengthUnit,
                decimals: b.product.lengthDecimals,
                required: b.required,
                active: b.product.active,
                variations: b.product.variations.map((v) => {
                  const attrs = defs?.length ? orderAttributes(v.attributes as Attributes, defs) : (v.attributes as Attributes);
                  // "8 mm · Grade 80": a number gets its attribute's unit, as on the option buttons.
                  const label = defs?.length
                    ? defs.map((d) => { const x = attrs[d.name] ?? ""; return x && d.unit && !d.isQuality && /\d$/.test(x) ? `${x} ${d.unit}` : x; }).filter(Boolean).join(" · ")
                    : b.product.name;
                  return { id: v.id, shortName: v.shortName, attributes: attrs, label, salePrice: v.salePrice.toFixed(2) };
                }),
              };
            }),
          }
        : null,
    // Set on a grouped product's main component: it exists only inside that product's sets.
    ownerGroup: g.ownerGroup,
    active: g.active,
    lastSaleAt: g.lastSaleAt?.toISOString() ?? null,
    activityStatus: productActivity(g.lastSaleAt),
    version: g.version,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    variations: g.variations.map((v) => ({
      ...serializeVariation(v, g.attributeDefinitions as unknown as AttributeDef[]),
      categoryIds: variationCategories.filter((c) => c.variationIds.includes(v.id)).map((c) => c.id),
    })),
  };
}
export type SerializedGroup = ReturnType<typeof serializeGroup>;

// ---------------------------------------------------------------------------
// Cost visibility (audit B05, owner decision 2026-10-13): purchase cost and values derived
// from it are shown only to roles that manage prices (inventory.configure).
// ---------------------------------------------------------------------------

export const seesCost = (role: Role) => can(role, "inventory.configure");

const COST_KEYS = ["purchaseCost", "stockValue"];

/** Copy of a serialized product (and its variations) without cost fields. */
export function withoutCost<T extends object>(product: T): T {
  const strip = (o: object) => Object.fromEntries(Object.entries(o).filter(([k]) => !COST_KEYS.includes(k)));
  const out = strip(product) as Record<string, unknown>;
  if (Array.isArray(out.variations)) out.variations = out.variations.map((v: object) => strip(v));
  return out as T;
}

/** Applies withoutCost when the role may not see cost. */
export const costFor = <T extends object>(role: Role, product: T): T => (seesCost(role) ? product : withoutCost(product));

const CUSTOMER_SENSITIVE_KEYS = [
  "purchaseCost",
  "minSalePrice",
  "salePrice",
  "stockValue",
  "totalStockValue",
  "costMin",
  "costMax",
  "priceMin",
  "priceMax",
  "activityStatus",
  "lastSaleAt",
  "byWarehouse",
  "warehouseId",
  "warehouse",
  "warehouses",
  "warehouseStock",
  "warehouseName",
  "warehouseCode",
  "stockByWarehouse",
  "lowStockThreshold",
  "rolls",
  "pieces",
  "pieceCount",
  "totalQuantity",
  "stockOnHand",
  "margin",
  "markup",
  "vendorPrices",
  "supplierPrices",
  "vendor",
  "saleCount30d",
  "salesCount",
  "movementCount",
  "lowVariations",
  "outVariations",
  "negativeVariations",
  "cost",
  "lastCost",
  "minStock",
  "maxStock",
  "reorderPoint",
  "inSets",
  "lowCount",
  "outCount",
  "negativeCount",
];

export function customerModeScrub<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) {
    return input.map((item) => customerModeScrub(item)) as unknown as T;
  }
  if (typeof input === "object" && !(input instanceof Date)) {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (CUSTOMER_SENSITIVE_KEYS.includes(k)) continue;
      if (k === "quantity" && typeof v === "number") {
        res.inStock = v > 0;
        res.quantity = v > 0 ? 1 : 0;
        continue;
      }
      if (k === "state") {
        res.state = v === "out" ? "out" : "ok";
        continue;
      }
      res[k] = customerModeScrub(v);
    }
    return res as T;
  }
  return input;
}
