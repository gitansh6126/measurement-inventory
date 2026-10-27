import { Prisma } from "@prisma/client";
import {
  autoOfficialSku,
  autoShortName,
  comboKey,
  normalizeOfficialSku,
  normalizeShortName,
  orderAttributes,
  type AttributeDef,
  type Attributes,
} from "@rs-v31/shared";
import { z } from "zod";
import type { Db, Tx } from "../db.js";
import { audit } from "./audit.js";
import { AppError } from "./errors.js";
import { bumpVersion, lockVersion, versionField } from "./versions.js";

// Corrections of daily mistakes in the product setup (docs\CORRECTIONS-AUDIT-2026-10-27.md, P1 + P2):
// renaming an attribute or one of its values, and deleting a product or variation that was never used.

interface Ctx {
  companyId: string;
  actorId: string;
  requestId: string;
}

// ---------------------------------------------------------------------------
// P1: rename an attribute or a value
// ---------------------------------------------------------------------------

const name = z.string().trim().min(1).max(60).refine((v) => !/[|=]/.test(v), "Attribute names cannot contain | or =");
const value = z.string().trim().min(1).max(80).refine((v) => !v.includes("|"), "Attribute values cannot contain |");

export const renameAttributeBody = z.union([
  z.object({ attribute: z.string().min(1), newName: name, updateCodes: z.boolean().default(true), version: versionField }),
  z.object({ attribute: z.string().min(1), value: z.string().min(1), newValue: value, updateCodes: z.boolean().default(true), version: versionField }),
]);
export type RenameAttributeBody = z.infer<typeof renameAttributeBody>;

/**
 * Renames an attribute (e.g. "Colur" → "Colour") or one declared value ("Redd" → "Red") of a
 * Variable or Measured product, rewriting every variation that carries it (attributes and
 * combination key) in one transaction. With `updateCodes`, a Short Name / Official SKU that is
 * still the generated one is generated again from the new text; a code typed by hand is kept.
 * Documents keep their own snapshot of names, so old bills never change.
 */
export async function renameAttribute(tx: Tx, ctx: Ctx, groupId: string, body: RenameAttributeBody) {
  const { companyId, actorId, requestId } = ctx;
  await lockVersion(tx, "productGroup", companyId, groupId, body.version, "This product");
  const g = await tx.productGroup.findFirst({ where: { id: groupId, companyId }, include: { variations: true } });
  if (!g) throw new AppError(404, "NOT_FOUND", "Product not found");
  if (g.productType !== "variable" && g.productType !== "measured") {
    throw new AppError(400, "NOT_VARIABLE", "Attributes apply to Variable and Measured products only");
  }
  const oldDefs = g.attributeDefinitions as unknown as AttributeDef[];
  const def = oldDefs.find((d) => d.name === body.attribute);
  if (!def) throw new AppError(404, "UNKNOWN_ATTRIBUTE", `Attribute not found: ${body.attribute}`);

  let newDefs: AttributeDef[];
  let rewrite: (a: Attributes) => Attributes;
  let summary: string;
  if ("newName" in body) {
    if (body.newName === def.name) throw new AppError(400, "NO_CHANGES", "The name is unchanged");
    if (oldDefs.some((d) => d !== def && d.name.toLowerCase() === body.newName.toLowerCase())) {
      throw new AppError(409, "ATTRIBUTE_EXISTS", `This product already has an attribute named ${body.newName}`);
    }
    newDefs = oldDefs.map((d) => (d === def ? { ...d, name: body.newName } : d));
    rewrite = (a) => {
      const out: Attributes = {};
      for (const [k, v] of Object.entries(a)) out[k === def.name ? body.newName : k] = v;
      return out;
    };
    summary = `Attribute "${def.name}" renamed to "${body.newName}"`;
  } else {
    if (def.isQuality) throw new AppError(400, "QUALITY_VALUE", "Quality grades (stars) cannot be renamed");
    if (!def.values.includes(body.value)) throw new AppError(404, "UNKNOWN_VALUE", `"${body.value}" is not a value of ${def.name}`);
    if (body.newValue === body.value) throw new AppError(400, "NO_CHANGES", "The value is unchanged");
    if (def.values.some((v) => v !== body.value && v.toLowerCase() === body.newValue.toLowerCase())) {
      throw new AppError(409, "VALUE_EXISTS", `${def.name} already has the value "${body.newValue}"`);
    }
    const abbrMap = def.abbrMap ? Object.fromEntries(Object.entries(def.abbrMap).map(([k, v]) => [k === body.value ? body.newValue : k, v])) : undefined;
    newDefs = oldDefs.map((d) => (d === def ? { ...d, values: d.values.map((v) => (v === body.value ? body.newValue : v)), ...(abbrMap ? { abbrMap } : {}) } : d));
    rewrite = (a) => (a[def.name] === body.value ? { ...a, [def.name]: body.newValue } : a);
    summary = `${def.name}: "${body.value}" renamed to "${body.newValue}"`;
  }

  const changed: { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[] = [];
  for (const v of g.variations) {
    const attrs = (v.attributes ?? {}) as Attributes;
    const next = orderAttributes(rewrite(attrs), newDefs);
    const key = comboKey(next);
    if (key === v.attributeKey && JSON.stringify(next) === JSON.stringify(attrs)) continue;
    let shortName = v.shortName;
    let officialSku = v.officialSku;
    if (body.updateCodes) {
      if (v.shortName === normalizeShortName(autoShortName(g.baseShortName, attrs, oldDefs))) {
        shortName = normalizeShortName(autoShortName(g.baseShortName, next, newDefs));
      }
      if (v.officialSku && v.officialSku === normalizeOfficialSku(autoOfficialSku(g.baseShortName, attrs, oldDefs))) {
        officialSku = normalizeOfficialSku(autoOfficialSku(g.baseShortName, next, newDefs));
      }
    }
    if (shortName !== v.shortName) {
      const hit = await tx.productVariation.findFirst({ where: { companyId, shortName, id: { not: v.id } }, select: { id: true } });
      if (hit) throw new AppError(409, "SHORT_NAME_TAKEN", `Short Name already exists: ${shortName}. Untick "update codes" or change that Short Name first.`);
    }
    if (officialSku && officialSku !== v.officialSku) {
      const hit = await tx.productVariation.findFirst({ where: { companyId, officialSku: { equals: officialSku, mode: "insensitive" }, id: { not: v.id } }, select: { id: true } });
      if (hit) throw new AppError(409, "OFFICIAL_SKU_TAKEN", `Official SKU already exists: ${officialSku}. Untick "update codes" or change that SKU first.`);
    }
    await tx.productVariation.update({
      where: { id: v.id },
      data: { attributes: next as Prisma.InputJsonValue, attributeKey: key, shortName, officialSku, updatedById: actorId, ...bumpVersion },
    });
    changed.push({
      id: v.id,
      before: { attributes: attrs, shortName: v.shortName, officialSku: v.officialSku },
      after: { attributes: next, shortName, officialSku },
    });
  }
  await tx.productGroup.update({
    where: { id: g.id },
    data: { attributeDefinitions: newDefs as unknown as Prisma.InputJsonValue, updatedById: actorId, ...bumpVersion },
  });
  await audit(tx, {
    companyId,
    actorId,
    action: "ATTRIBUTE_RENAME",
    entityType: "ProductGroup",
    entityId: g.id,
    before: { attributes: oldDefs, variations: changed.map((c) => ({ id: c.id, ...c.before })) },
    after: { attributes: newDefs, variations: changed.map((c) => ({ id: c.id, ...c.after })) },
    reason: summary,
    requestId,
  });
  return { renamed: summary, variationsChanged: changed.length };
}

// ---------------------------------------------------------------------------
// P2: delete a product or variation that was never used
// ---------------------------------------------------------------------------

export interface Usage {
  stockMovements: number;
  sales: number;
  purchases: number;
  orders: number;
  supplierRates: number;
  rolls: number;
  sets: number;
  drafts: number;
}

const USAGE_LABEL: Record<keyof Usage, [string, string]> = {
  stockMovements: ["stock entry", "stock entries"],
  sales: ["sale", "sales"],
  purchases: ["purchase", "purchases"],
  orders: ["order", "orders"],
  supplierRates: ["supplier rate", "supplier rates"],
  rolls: ["roll", "rolls"],
  sets: ["set part", "set parts"],
  drafts: ["held cart", "held carts"],
};

/** Everything that refers to each variation, one count per kind (one query per table). */
export async function usageByVariation(db: Db, companyId: string, ids: readonly string[]): Promise<Map<string, Usage>> {
  const out = new Map<string, Usage>(ids.map((id) => [id, { stockMovements: 0, sales: 0, purchases: 0, orders: 0, supplierRates: 0, rolls: 0, sets: 0, drafts: 0 }]));
  if (!ids.length) return out;
  const variationId = { in: [...ids] };
  const add = (k: keyof Usage) => (rows: { variationId: string; _count: { _all: number } }[]) => {
    for (const r of rows) out.get(r.variationId)![k] += r._count._all;
  };
  await Promise.all([
    db.stockMovement.groupBy({ by: ["variationId"], where: { companyId, variationId }, _count: { _all: true } }).then(add("stockMovements")),
    db.saleLine.groupBy({ by: ["variationId"], where: { variationId }, _count: { _all: true } }).then(add("sales")),
    db.purchaseLine.groupBy({ by: ["variationId"], where: { variationId }, _count: { _all: true } }).then(add("purchases")),
    db.orderLine.groupBy({ by: ["variationId"], where: { variationId }, _count: { _all: true } }).then(add("orders")),
    db.vendorPrice.groupBy({ by: ["variationId"], where: { companyId, variationId }, _count: { _all: true } }).then(add("supplierRates")),
    db.vendorPriceHistory.groupBy({ by: ["variationId"], where: { companyId, variationId }, _count: { _all: true } }).then(add("supplierRates")),
    db.measurementPiece.groupBy({ by: ["variationId"], where: { companyId, variationId }, _count: { _all: true } }).then(add("rolls")),
    db.groupSetPart.groupBy({ by: ["variationId"], where: { variationId }, _count: { _all: true } }).then(add("sets")),
    // Held carts keep their lines as JSON.
    db.$queryRaw<{ variationId: string; n: bigint }[]>`
      SELECT l->>'variationId' AS "variationId", count(*) AS n
      FROM draft_orders d, jsonb_array_elements(d.lines) l
      WHERE d.company_id = ${companyId} AND d.status::text = 'ACTIVE' AND l->>'variationId' IN (${Prisma.join([...ids])})
      GROUP BY 1`.then((rows) => {
      for (const r of rows) out.get(r.variationId)!.drafts += Number(r.n);
    }),
  ]);
  return out;
}

/** The usage of several variations together. */
export async function variationUsage(db: Db, companyId: string, ids: readonly string[]): Promise<Usage> {
  const total: Usage = { stockMovements: 0, sales: 0, purchases: 0, orders: 0, supplierRates: 0, rolls: 0, sets: 0, drafts: 0 };
  for (const u of (await usageByVariation(db, companyId, ids)).values()) {
    for (const k of Object.keys(total) as (keyof Usage)[]) total[k] += u[k];
  }
  return total;
}

export const unused = (u: Usage) => Object.values(u).every((n) => n === 0);

export function usageText(u: Usage): string {
  return (Object.keys(u) as (keyof Usage)[])
    .filter((k) => u[k] > 0)
    .map((k) => `${u[k]} ${USAGE_LABEL[k][u[k] === 1 ? 0 : 1]}`)
    .join(", ");
}

function inUse(what: string, u: Usage): AppError {
  return new AppError(409, "IN_USE", `${what} is used (${usageText(u)}); archive it instead`, { usage: u });
}

async function deleteVariationRows(tx: Tx, ids: readonly string[]) {
  if (!ids.length) return;
  await tx.variationCategory.deleteMany({ where: { variationId: { in: [...ids] } } });
  await tx.warehouseStockBalance.deleteMany({ where: { variationId: { in: [...ids] } } });
  await tx.stockBalance.deleteMany({ where: { variationId: { in: [...ids] } } });
  await tx.productVariation.deleteMany({ where: { id: { in: [...ids] } } });
}

/** Deletes one never-used variation of a Variable or Measured product (not its last one). */
export async function deleteVariation(tx: Tx, ctx: Ctx, groupId: string, variationId: string) {
  const { companyId, actorId, requestId } = ctx;
  await tx.$queryRaw`SELECT id FROM product_groups WHERE id = ${groupId} AND company_id = ${companyId} FOR UPDATE`;
  const g = await tx.productGroup.findFirst({ where: { id: groupId, companyId }, include: { variations: true } });
  if (!g) throw new AppError(404, "NOT_FOUND", "Product not found");
  const v = g.variations.find((x) => x.id === variationId);
  if (!v) throw new AppError(404, "NOT_FOUND", "Variation not found");
  if (g.productType !== "variable" && g.productType !== "measured") {
    throw new AppError(400, "DELETE_PRODUCT", "This product has exactly one variation; delete the product instead");
  }
  if (g.variations.length === 1) throw new AppError(409, "LAST_VARIATION", "This is the product's only variation; delete the product instead");
  const usage = await variationUsage(tx, companyId, [v.id]);
  if (!unused(usage)) throw inUse(`${g.name} ${v.shortName}`, usage);
  await deleteVariationRows(tx, [v.id]);
  await tx.productGroup.update({ where: { id: g.id }, data: { updatedById: actorId, ...bumpVersion } });
  await audit(tx, {
    companyId,
    actorId,
    action: "VARIATION_DELETE",
    entityType: "ProductVariation",
    entityId: v.id,
    before: { productId: g.id, product: g.name, shortName: v.shortName, officialSku: v.officialSku, attributes: v.attributes },
    requestId,
  });
  return { deleted: v.shortName };
}

/**
 * Deletes a never-used product with its variations and category links. A grouped product takes
 * its main component and set definition with it; a product that is a by-product of a set is
 * refused (remove it from that set first).
 */
export async function deleteProduct(tx: Tx, ctx: Ctx, groupId: string) {
  const { companyId, actorId, requestId } = ctx;
  await tx.$queryRaw`SELECT id FROM product_groups WHERE id = ${groupId} AND company_id = ${companyId} FOR UPDATE`;
  const g = await tx.productGroup.findFirst({ where: { id: groupId, companyId }, include: { variations: true, mainComponent: { include: { variations: true } } } });
  if (!g) throw new AppError(404, "NOT_FOUND", "Product not found");
  if (g.ownerGroupId) throw new AppError(400, "MAIN_FOLLOWS_SET", "A set's main component is deleted with its grouped product");
  const of = await tx.groupByproduct.findMany({ where: { companyId, productId: g.id }, include: { group: { select: { name: true } } } });
  if (of.length) {
    throw new AppError(409, "IN_SET", `${g.name} is a by-product of ${of.map((b) => b.group.name).join(", ")}; remove it from that set first`);
  }
  const groups = [g.id, ...(g.mainComponent ? [g.mainComponent.id] : [])];
  const variationIds = [...g.variations, ...(g.mainComponent?.variations ?? [])].map((v) => v.id);
  const usage = await variationUsage(tx, companyId, variationIds);
  const sets = await tx.groupSet.count({ where: { companyId, groupId: { in: groups } } });
  if (!unused(usage) || sets > 0) throw inUse(g.name, { ...usage, sets: usage.sets + sets });

  await deleteVariationRows(tx, variationIds);
  await tx.groupByproduct.deleteMany({ where: { companyId, groupId: { in: groups } } });
  await tx.productCategory.deleteMany({ where: { productId: { in: groups } } });
  // The main component points at its grouped product: remove it first.
  if (g.mainComponent) await tx.productGroup.delete({ where: { id: g.mainComponent.id } });
  await tx.productGroup.delete({ where: { id: g.id } });
  await audit(tx, {
    companyId,
    actorId,
    action: "PRODUCT_DELETE",
    entityType: "ProductGroup",
    entityId: g.id,
    before: {
      name: g.name,
      productType: g.productType,
      attributes: g.attributeDefinitions,
      variations: g.variations.map((v) => ({ id: v.id, shortName: v.shortName, officialSku: v.officialSku, attributes: v.attributes })),
    },
    requestId,
  });
  return { deleted: g.name };
}
