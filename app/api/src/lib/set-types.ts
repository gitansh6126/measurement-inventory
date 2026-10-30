import type { Prisma } from "@prisma/client";
import type { AttributeDef } from "@rs-v31/shared";
import { formatLength, toMilli } from "@rs-v31/shared/measure";
import { byproductName } from "@rs-v31/shared/sets";
import { z } from "zod";
import type { Db, Tx } from "../db.js";
import { audit } from "./audit.js";
import { AppError } from "./errors.js";
import { assertOwnImages } from "./images.js";
import { lengthInput, type MeasureCtx } from "./measure.js";
import { imageUrl, specsInput, specsOut } from "./products.js";
import { cancelOpeningSet, createSets, listSets, loadSetDefinition, validateSets, type SetDefinition } from "./sets.js";
import { money } from "./stock.js";
import { resolveWarehouse } from "./warehouses.js";

// Set types and standard sets (0041, owner 2026-10-28). A set type is the in-stock sets of one
// grouped product with the same parts; it carries its own selling price, minimum selling price
// and minimum stock (the grouped product keeps no standard price). A standard set is a set type
// defined on the product form: Stock In builds sets from it when its count is raised (the parts
// come in as new stock with the set, like opening sets) and undoes opening sets when lowered.

export interface TypePart {
  byproductId: string;
  variationId: string;
  /** Measured part: the fitted length in thousandths; null for a counted part. */
  length: number | null;
}

/** "bp:variation:milli|…" sorted by by-product, so the same parts always give the same key. */
export function setTypeKey(parts: readonly { byproductId: string; variationId: string; length?: number | null }[]) {
  return [...parts]
    .map((p) => `${p.byproductId}:${p.variationId}:${p.length ?? ""}`)
    .sort()
    .join("|");
}

const partsInput = z
  .array(z.object({ byproductId: z.string().min(1), variationId: z.string().min(1), length: lengthInput.optional() }))
  .max(10);

type PriceFields = { salePrice?: string; minSalePrice?: string; lowStockThreshold?: number };

/** Upserts the price / minimum stock of the set types of these parts (Add sets sheet, Stock In). */
export async function upsertSetTypePrices(tx: Tx, ctx: MeasureCtx, groupId: string, rows: readonly ({ parts: readonly { byproductId: string; variationId: string; length?: number }[] } & PriceFields)[]) {
  for (const r of rows) {
    const parts = r.parts.map((p) => ({ byproductId: p.byproductId, variationId: p.variationId, length: p.length ?? null }));
    const typeKey = setTypeKey(parts);
    const data = {
      ...(r.salePrice !== undefined ? { salePrice: r.salePrice } : {}),
      ...(r.minSalePrice !== undefined ? { minSalePrice: r.minSalePrice } : {}),
      ...(r.lowStockThreshold !== undefined ? { lowStockThreshold: r.lowStockThreshold } : {}),
      updatedById: ctx.actorId,
    };
    await tx.groupSetType.upsert({
      where: { companyId_groupId_typeKey: { companyId: ctx.companyId, groupId, typeKey } },
      // A type first priced here goes after the ones already placed.
      create: { companyId: ctx.companyId, groupId, typeKey, parts: parts as unknown as Prisma.InputJsonValue, sortOrder: 10_000, ...data },
      update: data,
    });
  }
}

/**
 * Owner 2026-10-30: a custom set bought on a purchase becomes a standard set of its grouped
 * product, so the next Stock In / purchase can take it by count. A type already priced keeps its
 * prices and place; a new one takes the grouped product's old price and goes after the standards.
 */
export async function promotePurchasedSetTypes(tx: Tx, ctx: MeasureCtx, groupId: string, sets: readonly { parts: readonly { byproductId: string; variationId: string; length?: number }[] }[]) {
  const byKey = new Map<string, TypePart[]>();
  for (const s of sets) {
    const parts = s.parts.map((p) => ({ byproductId: p.byproductId, variationId: p.variationId, length: p.length ?? null }));
    byKey.set(setTypeKey(parts), parts);
  }
  if (!byKey.size) return [];
  const rows = await tx.groupSetType.findMany({ where: { companyId: ctx.companyId, groupId } });
  const existing = new Map(rows.map((r) => [r.typeKey, r]));
  const fresh = [...byKey.keys()].filter((k) => !existing.get(k)?.standard);
  if (!fresh.length) return [];
  const own = await tx.productVariation.findFirst({ where: { groupId }, select: { salePrice: true, minSalePrice: true, lowStockThreshold: true } });
  let next = Math.max(-1, ...rows.filter((r) => r.standard).map((r) => r.sortOrder)) + 1;
  for (const typeKey of fresh) {
    const r = existing.get(typeKey);
    if (r) {
      await tx.groupSetType.update({ where: { id: r.id }, data: { standard: true, ...(r.sortOrder >= 10_000 ? { sortOrder: next++ } : {}), updatedById: ctx.actorId } });
    } else {
      await tx.groupSetType.create({
        data: {
          companyId: ctx.companyId,
          groupId,
          typeKey,
          standard: true,
          parts: byKey.get(typeKey) as unknown as Prisma.InputJsonValue,
          salePrice: own?.salePrice ?? 0,
          minSalePrice: own?.minSalePrice ?? 0,
          lowStockThreshold: own?.lowStockThreshold ?? 0,
          sortOrder: next++,
          updatedById: ctx.actorId,
        },
      });
    }
  }
  await audit(tx, { companyId: ctx.companyId, actorId: ctx.actorId, action: "SET_STANDARD_FROM_PURCHASE", entityType: "ProductGroup", entityId: groupId, after: { standardSets: fresh.length }, requestId: ctx.requestId ?? null });
  return fresh;
}

/** Display value of one defined part, the same text as a set's contents ("8 mm · 3 m"). */
function partValue(link: SetDefinition["byproducts"][number], variationId: string, length: number | null) {
  const v = link.product.variations.find((x) => x.id === variationId);
  const defs = (link.product.attributeDefinitions as unknown as AttributeDef[]) ?? [];
  const raw = ((v?.attributes ?? {}) as Record<string, string>) ?? {};
  const attrs = (defs.length ? defs.map((d) => {
    const x = raw[d.name] ?? "";
    return x && d.unit && !d.isQuality && /\d$/.test(x) ? `${x} ${d.unit}` : x;
  }) : Object.values(raw)).filter(Boolean);
  const len = link.product.productType === "measured" && length !== null ? formatLength(length, link.product.lengthUnit ?? "m", link.product.lengthDecimals ?? 3) : null;
  return [attrs.join(" "), len].filter(Boolean).join(" · ") || "Fitted";
}

export const setTypesQuery = z.object({
  warehouseId: z.string().min(1).optional(),
  categoryId: z.string().min(1).optional(),
});

/**
 * Child rows of a grouped product: its standard sets (even with none in stock, not under a
 * category filter) and every other set type in stock, each with count, warehouses, prices and
 * minimum stock. A type without its own prices shows the grouped product's old price.
 */
export async function listSetTypes(db: Db, companyId: string, groupId: string, q: z.infer<typeof setTypesQuery>) {
  const def = await loadSetDefinition(db, companyId, groupId);
  const [sets, rows, own] = await Promise.all([
    listSets(db, companyId, { groupId, status: "IN_STOCK", ...(q.categoryId ? { categoryId: q.categoryId } : {}) }),
    db.groupSetType.findMany({ where: { companyId, groupId } }),
    db.productVariation.findFirst({ where: { groupId }, select: { salePrice: true, minSalePrice: true, lowStockThreshold: true } }),
  ]);
  const links = new Map(def.byproducts.map((b) => [b.id, b]));
  const byKey = new Map(rows.map((r) => [r.typeKey, r]));
  type Out = {
    typeKey: string;
    name: string | null;
    standard: boolean;
    // 0044: a standard set's own technical specifications and image.
    specs: { name: string; value: string }[];
    imageUrl: string | null;
    parts: { byproductId: string; variationId: string; length: number | null }[];
    contents: { name: string; value: string }[];
    count: number;
    openingCount: number;
    byWarehouse: Record<string, number>;
    salePrice: string;
    minSalePrice: string;
    lowStockThreshold: number;
    priced: boolean;
    sortOrder: number;
    rate: string;
  };
  const types = new Map<string, Out>();
  const base = (typeKey: string, parts: TypePart[], contents: Out["contents"]): Out => {
    const r = byKey.get(typeKey);
    return {
      typeKey,
      name: r?.standard ? r.name : null,
      standard: !!r?.standard,
      specs: r?.standard ? specsOut(r.specs) : [],
      imageUrl: r?.standard ? r.imageUrl : null,
      parts: parts.map((p) => ({ ...p, length: p.length === null ? null : p.length / 1000 })),
      contents,
      count: 0,
      openingCount: 0,
      byWarehouse: {},
      salePrice: (r?.salePrice ?? own?.salePrice ?? 0).toString(),
      minSalePrice: (r?.minSalePrice ?? own?.minSalePrice ?? 0).toString(),
      lowStockThreshold: r?.lowStockThreshold ?? own?.lowStockThreshold ?? 0,
      priced: !!r,
      // The saved child-row order (V3.2 A2); types never placed go last.
      sortOrder: r ? r.sortOrder : 10_000,
      rate: "0",
    };
  };
  if (!q.categoryId) {
    for (const r of rows.filter((x) => x.standard)) {
      // Parts in the by-product order (it can change after the set was saved, V3.2 A2).
      const rank = (id: string) => def.byproducts.findIndex((b) => b.id === id);
      const parts = [...((r.parts as unknown as TypePart[]) ?? [])].sort((a, b) => rank(a.byproductId) - rank(b.byproductId));
      const contents = parts.flatMap((p) => {
        const link = links.get(p.byproductId);
        return link ? [{ name: byproductName(link.product.name, link.label), value: partValue(link, p.variationId, p.length) }] : [];
      });
      types.set(r.typeKey, base(r.typeKey, parts, contents));
    }
  }
  for (const s of sets) {
    if (q.warehouseId && s.warehouseId !== q.warehouseId) continue;
    let t = types.get(s.typeKey);
    if (!t) {
      const parts = s.parts
        .filter((p) => p.role === "BY")
        .map((p) => ({ byproductId: p.byproductId ?? "", variationId: p.variationId, length: p.productType === "measured" ? toMilli(p.quantity) : null }));
      t = base(s.typeKey, parts, s.contents);
      types.set(s.typeKey, t);
    }
    t.count += 1;
    if (s.source === "OPENING") t.openingCount += 1;
    if (s.warehouseId) t.byWarehouse[s.warehouseId] = (t.byWarehouse[s.warehouseId] ?? 0) + 1;
    if (t.rate === "0") t.rate = s.rate;
  }
  const valuesOf = (t: Out) => t.contents.map((c) => c.value).join(" ");
  return [...types.values()].sort((a, b) => a.sortOrder - b.sortOrder || valuesOf(a).localeCompare(valuesOf(b), undefined, { numeric: true }));
}

/** Product form: the grouped product's standard sets, in order (replaces the list). */
export const standardSetsBody = z.object({
  sets: z
    .array(
      z.object({
        name: z.string().trim().max(80).nullish().transform((v) => v || null),
        parts: partsInput,
        specs: specsInput,
        imageUrl,
        salePrice: money.default("0"),
        minSalePrice: money.default("0"),
        lowStockThreshold: z.coerce.number().int().min(0).max(1_000_000).default(0),
      }),
    )
    .max(50),
});

export async function saveStandardSets(tx: Tx, ctx: MeasureCtx, groupId: string, body: z.infer<typeof standardSetsBody>) {
  const def = await loadSetDefinition(tx, ctx.companyId, groupId);
  // Same checks as a set row: every required part chosen, a length for measured parts.
  validateSets(def, body.sets.map((s) => ({ rate: "0", notes: null, parts: s.parts, warehouseId: null })));
  const keys = body.sets.map((s) => setTypeKey(s.parts.map((p) => ({ ...p, length: p.length ?? null }))));
  const dup = keys.findIndex((k, i) => keys.indexOf(k) !== i);
  if (dup >= 0) throw new AppError(400, "DUPLICATE_SET_TYPE", `Standard set ${dup + 1} has the same parts as an earlier one`);
  await assertOwnImages(tx, ctx.companyId, body.sets.map((s) => s.imageUrl));
  // A standard set taken off the list keeps its prices as an ordinary set type.
  await tx.groupSetType.updateMany({ where: { companyId: ctx.companyId, groupId, standard: true, typeKey: { notIn: keys } }, data: { standard: false, updatedById: ctx.actorId } });
  for (const [i, s] of body.sets.entries()) {
    if (Number(s.minSalePrice) > Number(s.salePrice)) {
      throw new AppError(400, "INVALID_PRICE", `${s.name || `Standard set ${i + 1}`}: minimum selling price (${s.minSalePrice}) cannot be higher than selling price (${s.salePrice})`);
    }
    const parts = s.parts.map((p) => ({ byproductId: p.byproductId, variationId: p.variationId, length: p.length ?? null }));
    const data = {
      standard: true,
      name: s.name,
      parts: parts as unknown as Prisma.InputJsonValue,
      specs: (s.specs ?? []) as unknown as Prisma.InputJsonValue,
      imageUrl: s.imageUrl,
      salePrice: s.salePrice,
      minSalePrice: s.minSalePrice,
      lowStockThreshold: s.lowStockThreshold,
      sortOrder: i,
      updatedById: ctx.actorId,
    };
    await tx.groupSetType.upsert({
      where: { companyId_groupId_typeKey: { companyId: ctx.companyId, groupId, typeKey: keys[i]! } },
      create: { companyId: ctx.companyId, groupId, typeKey: keys[i]!, ...data },
      update: data,
    });
  }
  await audit(tx, { companyId: ctx.companyId, actorId: ctx.actorId, action: "SET_STANDARD_SAVE", entityType: "ProductGroup", entityId: groupId, after: { standardSets: body.sets.length }, requestId: ctx.requestId ?? null });
}

/** Stock In child rows of a grouped product: new set count and/or prices per set type. */
export const setTypeStockBody = z.object({
  reason: z.string().trim().min(1).max(60).default("Stock Received"),
  notes: z.string().trim().max(300).nullish(),
  warehouseId: z.string().min(1).nullish(),
  rows: z
    .array(
      z.object({
        typeKey: z.string().max(2000),
        // Count of sets in stock (in the chosen warehouse) the user saw, and the new count.
        expectedCount: z.coerce.number().int().min(0).optional(),
        count: z.coerce.number().int().min(0).max(1000).optional(),
        salePrice: money.optional(),
        minSalePrice: money.optional(),
        lowStockThreshold: z.coerce.number().int().min(0).max(1_000_000).optional(),
      }),
    )
    .min(1)
    .max(100),
});

export async function stockInSetTypes(tx: Tx, ctx: MeasureCtx, groupId: string, body: z.infer<typeof setTypeStockBody>) {
  const warehouseId = await resolveWarehouse(tx, ctx.companyId, body.warehouseId);
  const types = new Map((await listSetTypes(tx, ctx.companyId, groupId, body.warehouseId ? { warehouseId: body.warehouseId } : {})).map((t) => [t.typeKey, t]));
  const reason = [body.reason, body.notes].filter(Boolean).join(": ");
  let added = 0;
  let removed = 0;
  for (const r of body.rows) {
    const t = types.get(r.typeKey);
    if (!t) throw new AppError(404, "SET_TYPE_NOT_FOUND", "This set type is no longer in stock; reload and try again");
    const parts = t.parts.map((p) => ({ byproductId: p.byproductId, variationId: p.variationId, ...(p.length !== null ? { length: toMilli(p.length) } : {}) }));
    if (r.salePrice !== undefined || r.minSalePrice !== undefined || r.lowStockThreshold !== undefined) {
      const effectiveSalePrice = r.salePrice !== undefined ? Number(r.salePrice) : Number(t.salePrice);
      const effectiveMinSalePrice = r.minSalePrice !== undefined ? Number(r.minSalePrice) : Number(t.minSalePrice);
      if (effectiveMinSalePrice > effectiveSalePrice) {
        const name = t.name ?? "Set";
        throw new AppError(400, "INVALID_PRICE", `${name}: minimum selling price (${effectiveMinSalePrice}) cannot be higher than selling price (${effectiveSalePrice})`);
      }
      await upsertSetTypePrices(tx, ctx, groupId, [{ parts, salePrice: r.salePrice, minSalePrice: r.minSalePrice, lowStockThreshold: r.lowStockThreshold }]);
    }
    if (r.count === undefined || r.count === t.count) continue;
    if (r.expectedCount !== undefined && r.expectedCount !== t.count) {
      throw new AppError(409, "STOCK_CHANGED", `Sets in stock changed (now ${t.count}); reload and try again`);
    }
    const delta = r.count - t.count;
    if (delta > 0) {
      await createSets(tx, ctx, groupId, Array.from({ length: delta }, () => ({ rate: t.rate, notes: null, parts, warehouseId: warehouseId ?? null })), {
        source: "OPENING",
        date: new Date(),
        reason,
        warehouseId,
      });
      added += delta;
    } else {
      // Only opening sets can be undone here (newest first); purchase sets go with their purchase.
      const opening = await tx.groupSet.findMany({
        where: { companyId: ctx.companyId, groupId, status: "IN_STOCK", source: "OPENING", ...(warehouseId && body.warehouseId ? { warehouseId } : {}) },
        include: { parts: { where: { role: "BY", status: "ALLOCATED" }, include: { variation: { select: { group: { select: { productType: true } } } } } } },
        orderBy: { createdAt: "desc" },
      });
      const ofType = opening.filter(
        (s) => setTypeKey(s.parts.map((p) => ({ byproductId: p.byproductId ?? "", variationId: p.variationId, length: p.variation.group.productType === "measured" ? toMilli(Number(p.quantity)) : null }))) === r.typeKey,
      );
      if (ofType.length < -delta) {
        throw new AppError(409, "NOT_OPENING", `Only ${ofType.length} of these sets can be removed here (added in Stock In); sets from a purchase are removed by cancelling the purchase`);
      }
      for (const s of ofType.slice(0, -delta)) await cancelOpeningSet(tx, ctx, s.id, reason || "Stock In correction");
      removed += -delta;
    }
  }
  return { added, removed };
}

/** V3.2 A2: the order of a grouped product's set-type child rows (Stock In, Products, pickers). */
export const setTypeOrderBody = z.object({ typeKeys: z.array(z.string().max(2000)).min(1).max(500) });

export async function saveSetTypeOrder(tx: Tx, ctx: MeasureCtx, groupId: string, body: z.infer<typeof setTypeOrderBody>) {
  if (new Set(body.typeKeys).size !== body.typeKeys.length) throw new AppError(400, "INVALID_ORDER", "Each set type must appear exactly once");
  const types = new Map((await listSetTypes(tx, ctx.companyId, groupId, {})).map((t) => [t.typeKey, t]));
  for (const [i, typeKey] of body.typeKeys.entries()) {
    const t = types.get(typeKey);
    if (!t) throw new AppError(409, "SET_TYPES_CHANGED", "The sets changed; reload before reordering");
    await tx.groupSetType.upsert({
      where: { companyId_groupId_typeKey: { companyId: ctx.companyId, groupId, typeKey } },
      // A type with no row yet keeps the prices it shows now (the product's old price).
      create: {
        companyId: ctx.companyId,
        groupId,
        typeKey,
        parts: t.parts.map((p) => ({ ...p, length: p.length === null ? null : toMilli(p.length) })) as unknown as Prisma.InputJsonValue,
        salePrice: t.salePrice,
        minSalePrice: t.minSalePrice,
        lowStockThreshold: t.lowStockThreshold,
        sortOrder: i,
        updatedById: ctx.actorId,
      },
      update: { sortOrder: i, updatedById: ctx.actorId },
    });
  }
  await audit(tx, { companyId: ctx.companyId, actorId: ctx.actorId, action: "SET_TYPE_ORDER", entityType: "ProductGroup", entityId: groupId, after: { typeKeys: body.typeKeys.length }, requestId: ctx.requestId ?? null });
}
