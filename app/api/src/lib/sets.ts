import type { Prisma, SetSource, SetStatus } from "@prisma/client";
import type { AttributeDef } from "@rs-v31/shared";
import { formatLength, formatPieceDate, formatPieceLength, ratePerOf, toMilli } from "@rs-v31/shared/measure";
import { z } from "zod";
import type { Db, Tx } from "../db.js";
import { audit } from "./audit.js";
import { AppError } from "./errors.js";
import { allocatePieceSequences, createPieces, cutPiece, dec, ledger, lengthInput, milliOf, type MeasureCtx } from "./measure.js";
import { freeBalances, lockVariations, money, recordMovements, type MovementInput } from "./stock.js";
import { balancesByWarehouse, inSetsByWarehouse, resolveWarehouse } from "./warehouses.js";

// V3.1 grouped products / sets (docs\GROUPED-PRODUCTS-V3-PLAN.md). A set's parts stay in the
// normal stock of their own products and are only marked as taken (group_set_parts ALLOCATED):
//   free stock = balance − SUM(ALLOCATED part quantity)
// Sets are created by purchase (phase 2) or as admin opening sets (D20, this file).

/** One set row of the set sheet (purchase or opening sets): a by-product variation per link. */
export const setInput = z.object({
  rate: money,
  notes: z.string().trim().max(300).nullish().transform((v) => v || null),
  parts: z
    .array(
      z.object({
        byproductId: z.string().min(1),
        variationId: z.string().min(1),
        // Measured by-products: the length fitted in this set (base units, D7).
        length: lengthInput.optional(),
      }),
    )
    .max(10),
  // V3.1 warehouses (GW-1): the warehouse this set (and all its parts) is in; default = the
  // receipt's "Receive into" choice, else the default warehouse.
  warehouseId: z.string().min(1).nullish(),
});
export type SetInput = z.infer<typeof setInput>;

export const openingSetsBody = z.object({
  groupId: z.string().min(1),
  warehouseId: z.string().min(1).nullish(),
  sets: z.array(setInput).min(1, "Enter at least one set").max(100),
  date: z
    .string()
    .nullish()
    .transform((v) => (v ? new Date(v) : undefined)),
});

const MAIN = "MAIN" as const;

/** The grouped product with what a set needs: main component variation and active links. */
export async function loadSetDefinition(db: Db, companyId: string, groupId: string) {
  const g = await db.productGroup.findFirst({
    where: { id: groupId, companyId },
    select: {
      id: true,
      name: true,
      baseShortName: true,
      productType: true,
      active: true,
      variations: { select: { id: true } },
      mainComponent: { select: { id: true, name: true, variations: { select: { id: true, shortName: true } } } },
      byproducts: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          required: true,
          product: {
            select: {
              id: true,
              name: true,
              baseShortName: true,
              productType: true,
              lengthUnit: true,
              lengthDecimals: true,
              attributeDefinitions: true,
              variations: { select: { id: true, shortName: true, active: true, attributes: true } },
            },
          },
        },
      },
    },
  });
  if (!g) throw new AppError(404, "NOT_FOUND", "Product not found");
  if (g.productType !== "grouped") throw new AppError(400, "NOT_GROUPED", `${g.name} is not a grouped product`);
  const mainVariation = g.mainComponent?.variations[0];
  if (!mainVariation) throw new AppError(409, "NO_MAIN_COMPONENT", `${g.name} has no main component`);
  return { ...g, mainVariation };
}
type SetDefinition = Awaited<ReturnType<typeof loadSetDefinition>>;
type Link = SetDefinition["byproducts"][number];

/** Code token of one fitted part (D17): attribute values "4 mm" → "4MM", a Simple part's Short Name. */
function partToken(link: Link, variation: { shortName: string; attributes: Prisma.JsonValue }, lengthMilli: number | null) {
  const defs = (link.product.attributeDefinitions as unknown as AttributeDef[]) ?? [];
  const attrs = (variation.attributes ?? {}) as Record<string, string>;
  const values = defs.length
    ? defs.map((d) => {
        const v = attrs[d.name] ?? "";
        // "8" with unit "mm" → "8MM"; a value that already carries its unit stays as typed.
        const withUnit = d.abbrMap?.[v] || (d.unit && !d.isQuality && /\d$/.test(v) ? `${v}${d.unit}` : v);
        return withUnit.replace(/\s+/g, "").toUpperCase();
      })
    : [variation.shortName];
  if (lengthMilli !== null) values.push(`${formatPieceLength(lengthMilli)}${link.product.lengthUnit === "ft_in" ? "IN" : "M"}`);
  return values.filter(Boolean).join("-");
}

/** Validates the set rows against the definition (plan §3 step 1). */
function validateSets(def: SetDefinition, sets: readonly SetInput[]) {
  const links = new Map(def.byproducts.map((b) => [b.id, b]));
  return sets.map((s, i) => {
    const label = sets.length > 1 ? `Set ${i + 1}: ` : "";
    const seen = new Set<string>();
    const parts = s.parts.map((p) => {
      const link = links.get(p.byproductId);
      if (!link) throw new AppError(400, "UNKNOWN_BYPRODUCT", `${label}this by-product is not part of ${def.name}`);
      if (seen.has(link.id)) throw new AppError(400, "BYPRODUCT_TWICE", `${label}${link.product.name} is entered twice`);
      seen.add(link.id);
      const variation = link.product.variations.find((v) => v.id === p.variationId);
      if (!variation || !variation.active) throw new AppError(400, "BAD_VARIATION", `${label}choose a ${link.product.name} variation`);
      const measured = link.product.productType === "measured";
      if (measured && !p.length) throw new AppError(400, "LENGTH_REQUIRED", `${label}enter the ${link.product.name} length`);
      if (!measured && p.length) throw new AppError(400, "NOT_MEASURED", `${label}${link.product.name} is always 1 per set`);
      const lengthMilli = measured ? p.length! : null;
      return { link, variation, lengthMilli, measured };
    });
    for (const link of def.byproducts) {
      if (link.required && !seen.has(link.id)) throw new AppError(400, "BYPRODUCT_REQUIRED", `${label}${link.product.name} is required in every set`);
    }
    return { input: s, parts };
  });
}

export interface CreateSetsOptions {
  source: SetSource;
  date: Date;
  purchase?: { id: string; number: string; lineNo: number };
  /** Movement reason, e.g. "Opening sets" or the purchase number. */
  reason: string;
  /** V3.1: header warehouse for sets that name none. */
  warehouseId?: string | null;
}

/**
 * Creates sets with their parts inside the caller's transaction (plan §3 steps 3–5). Every part
 * is received into its own product's stock (+1, or + length for measured as a new Cut piece fitted
 * in the set) and allocated to the set. Only the main part's movement carries the set rate (D11).
 */
export async function createSets(tx: Tx, ctx: MeasureCtx, groupId: string, sets: readonly SetInput[], opts: CreateSetsOptions) {
  const def = await loadSetDefinition(tx, ctx.companyId, groupId);
  if (!def.active) throw new AppError(409, "PRODUCT_ARCHIVED", `${def.name} is archived`);
  const rows = validateSets(def, sets);
  const variationIds = [def.mainVariation.id, ...rows.flatMap((r) => r.parts.map((p) => p.variation.id))];
  await lockVariations(tx, ctx.companyId, variationIds);

  // Movement type: the first stock of an item (in a warehouse) is its opening (one OPENING each).
  const movementType = async (variationId: string, warehouseId: string | undefined) => {
    if (opts.source === "PURCHASE") return "PURCHASE" as const;
    const any = await tx.stockMovement.count({ where: { companyId: ctx.companyId, variationId, ...(warehouseId ? { warehouseId } : {}) } });
    return any ? ("ADJUSTMENT" as const) : ("OPENING" as const);
  };
  // V3.1 (GW-1): each set's warehouse; undefined while warehousing is off.
  const header = await resolveWarehouse(tx, ctx.companyId, opts.warehouseId);
  const whOf = new Map<string, string | undefined>();
  for (const s of sets) if (s.warehouseId && !whOf.has(s.warehouseId)) whOf.set(s.warehouseId, await resolveWarehouse(tx, ctx.companyId, s.warehouseId));
  // Net receipt per variation|warehouse.
  const net = new Map<string, number>();
  const add = (variationId: string, warehouseId: string | undefined, milli: number) => {
    const key = `${variationId}|${warehouseId ?? ""}`;
    net.set(key, (net.get(key) ?? 0) + milli);
  };
  const rate = new Map<string, string>();
  const created: { id: string; code: string }[] = [];
  const dateStr = formatPieceDate(opts.date);

  for (const row of rows) {
    // D17 code: {SET SKU}-{fitted parts}-{D-M-YY}-{seq}; fixed for life.
    const tokens = row.parts.map((p) => partToken(p.link, p.variation, p.lengthMilli));
    const prefix = [def.baseShortName, ...tokens, dateStr].filter(Boolean).join("-");
    const seq = await allocatePieceSequences(tx, ctx.companyId, `SET|${prefix}`, 1);
    const code = `${prefix}-${seq < 100 ? String(seq).padStart(2, "0") : seq}`;
    const wh = row.input.warehouseId ? whOf.get(row.input.warehouseId) : header;
    const set = await tx.groupSet.create({
      data: {
        companyId: ctx.companyId,
        code,
        groupId: def.id,
        warehouseId: wh ?? null,
        status: "IN_STOCK",
        source: opts.source,
        purchaseId: opts.purchase?.id ?? null,
        purchaseLineNo: opts.purchase?.lineNo ?? null,
        rate: row.input.rate,
        notes: row.input.notes,
        createdAt: opts.date,
        createdById: ctx.actorId,
        updatedById: ctx.actorId,
      },
    });
    created.push({ id: set.id, code });

    await tx.groupSetPart.create({ data: { companyId: ctx.companyId, setId: set.id, role: MAIN, variationId: def.mainVariation.id, quantity: "1" } });
    add(def.mainVariation.id, wh, 1000);
    rate.set(def.mainVariation.id, row.input.rate);

    for (const p of row.parts) {
      if (p.measured) {
        const [piece] = await createPieces(
          tx,
          ctx,
          {
            id: p.variation.id,
            shortName: p.variation.shortName,
            groupName: p.link.product.name,
            measured: true,
            lengthUnit: p.link.product.lengthUnit,
            scrapBelowMilli: null,
            decimals: p.link.product.lengthDecimals ?? 3,
          },
          [{ lengthMilli: p.lengthMilli!, kind: "CUT", purchaseId: opts.purchase?.id ?? null, receivedAt: opts.date, setId: set.id, notes: `In set ${code}`, warehouseId: wh ?? null }],
        );
        await ledger(tx, ctx, [
          { pieceId: piece!.id, variationId: p.variation.id, action: opts.source === "PURCHASE" ? "RECEIVE" : "ADD", beforeMilli: 0, afterMilli: p.lengthMilli!, purchaseId: opts.purchase?.id ?? null, lineNo: opts.purchase?.lineNo ?? null, reason: opts.reason, occurredAt: opts.date, warehouseId: wh },
          { pieceId: piece!.id, variationId: p.variation.id, action: "SET_ALLOCATE", beforeMilli: p.lengthMilli!, afterMilli: p.lengthMilli!, reason: code, occurredAt: opts.date, warehouseId: wh },
        ]);
        await tx.groupSetPart.create({
          data: { companyId: ctx.companyId, setId: set.id, role: "BY", byproductId: p.link.id, variationId: p.variation.id, pieceId: piece!.id, quantity: dec(p.lengthMilli!) },
        });
        add(p.variation.id, wh, p.lengthMilli!);
      } else {
        await tx.groupSetPart.create({ data: { companyId: ctx.companyId, setId: set.id, role: "BY", byproductId: p.link.id, variationId: p.variation.id, quantity: "1" } });
        add(p.variation.id, wh, 1000);
      }
    }
  }

  const units = new Map(rows.flatMap((r) => r.parts.map((p) => [p.variation.id, p.link.product.lengthUnit] as const)));
  const movements: MovementInput[] = [];
  for (const [key, milli] of net) {
    const [variationId, w] = key.split("|") as [string, string];
    const warehouseId = w || undefined;
    movements.push({
      variationId,
      warehouseId,
      type: await movementType(variationId, warehouseId),
      quantity: milli / 1000,
      // D11: no part costs; the main part carries the (last) set rate for history only.
      rate: rate.get(variationId) ?? null,
      ratePer: ratePerOf(units.get(variationId) ?? null),
      reason: opts.reason,
      purchaseId: opts.purchase?.id,
      occurredAt: opts.date,
    });
  }
  await recordMovements(tx, ctx.companyId, ctx.actorId, movements, { sets: true, requestId: ctx.requestId });
  return created;
}

/** Admin "Add opening sets" (D20): same set sheet as a purchase, no supplier or bill. */
export async function addOpeningSets(tx: Tx, ctx: MeasureCtx, body: z.infer<typeof openingSetsBody>) {
  const date = body.date ?? new Date();
  const created = await createSets(tx, ctx, body.groupId, body.sets, { source: "OPENING", date, reason: "Opening sets", warehouseId: body.warehouseId });
  await audit(tx, {
    companyId: ctx.companyId,
    actorId: ctx.actorId,
    action: "SET_OPENING",
    entityType: "ProductGroup",
    entityId: body.groupId,
    after: { sets: created.map((c) => c.code) },
    requestId: ctx.requestId ?? null,
  });
  return created;
}

/**
 * Cancels an untouched opening set (wrong entry): its parts leave stock again, measured pieces
 * are used up, the set becomes CANCELLED. Sets from a purchase are cancelled with the purchase.
 */
export async function cancelOpeningSet(tx: Tx, ctx: MeasureCtx, setId: string, reason: string) {
  const set = await tx.groupSet.findFirst({ where: { id: setId, companyId: ctx.companyId }, include: { parts: { include: { piece: true } } } });
  if (!set) throw new AppError(404, "NOT_FOUND", "Set not found");
  if (set.source !== "OPENING") throw new AppError(409, "NOT_OPENING", `This set came from a purchase; cancel the purchase instead`);
  if (set.status !== "IN_STOCK") throw new AppError(409, "SET_NOT_IN_STOCK", `This set is ${set.status.toLowerCase().replace("_", " ")}`);
  await lockVariations(tx, ctx.companyId, set.parts.map((p) => p.variationId));
  const fresh = await tx.groupSet.findUniqueOrThrow({ where: { id: set.id } });
  if (fresh.version !== set.version || fresh.status !== "IN_STOCK") throw new AppError(409, "SET_CHANGED", `This set changed; reload and try again`);
  const live = set.parts.filter((p) => p.status === "ALLOCATED");
  const now = new Date();
  for (const p of live) {
    await tx.groupSetPart.update({ where: { id: p.id }, data: { status: "RELEASED", releasedAt: now } });
    if (p.piece) {
      const len = milliOf(p.piece.remainingLength);
      await tx.measurementPiece.update({ where: { id: p.piece.id }, data: { setId: null, remainingLength: "0", status: "USED_UP", updatedById: ctx.actorId } });
      await ledger(tx, ctx, [
        { pieceId: p.piece.id, variationId: p.variationId, action: "SET_RELEASE", beforeMilli: len, afterMilli: len, reason: set.code },
        { pieceId: p.piece.id, variationId: p.variationId, action: "CORRECTION", beforeMilli: len, afterMilli: 0, reason: `Opening set ${set.code} cancelled: ${reason}` },
      ]);
    }
  }
  await tx.groupSet.update({ where: { id: set.id }, data: { status: "CANCELLED", version: { increment: 1 }, updatedById: ctx.actorId } });
  const net = new Map<string, number>();
  for (const p of live) net.set(p.variationId, (net.get(p.variationId) ?? 0) - milliOf(p.quantity));
  await recordMovements(
    tx,
    ctx.companyId,
    ctx.actorId,
    [...net].map(([variationId, milli]) => ({ variationId, type: "ADJUSTMENT" as const, quantity: milli / 1000, reason: `Opening set ${set.code} cancelled: ${reason}`, warehouseId: set.warehouseId ?? undefined })),
    { sets: true, requestId: ctx.requestId },
  );
  await audit(tx, { companyId: ctx.companyId, actorId: ctx.actorId, action: "SET_OPENING_CANCEL", entityType: "GroupSet", entityId: set.id, before: { code: set.code }, reason, requestId: ctx.requestId ?? null });
}

/**
 * Purchase void (D16, plan §3): allowed only while every set from the purchase is in stock, not
 * held, with exactly the parts it was bought with. Parts are released, their pieces retired
 * (PURCHASE_VOID ledger) and the sets cancelled; voidDocument then reverses the movements.
 * Returns the cancelled set codes (empty when the purchase had no sets).
 */
export async function cancelPurchaseSets(tx: Tx, ctx: MeasureCtx, purchase: { id: string; number: string }) {
  const sets = await tx.groupSet.findMany({ where: { companyId: ctx.companyId, purchaseId: purchase.id }, select: { id: true } });
  if (!sets.length) return [];
  const parts = await tx.groupSetPart.findMany({ where: { setId: { in: sets.map((s) => s.id) } }, select: { variationId: true } });
  await lockVariations(tx, ctx.companyId, parts.map((p) => p.variationId));
  const fresh = await tx.groupSet.findMany({
    where: { id: { in: sets.map((s) => s.id) } },
    include: { parts: { include: { piece: true } }, _count: { select: { changes: true } } },
    orderBy: { code: "asc" },
  });
  const blocked = fresh.filter((s) => s.status !== "IN_STOCK" || s._count.changes > 0 || s.parts.some((p) => p.status !== "ALLOCATED"));
  if (blocked.length) {
    const why = (s: (typeof fresh)[number]) => (s.status === "SOLD" ? "sold" : s.status === "HELD" ? "held on an order" : s.status === "CANCELLED" ? "cancelled" : "changed");
    throw new AppError(
      409,
      "SET_CHANGED_OR_SOLD",
      `Cannot cancel ${purchase.number}: ${blocked.map((s) => `${s.code} is ${why(s)}`).join("; ")}. Cancel the sale or order first.`,
    );
  }
  const now = new Date();
  for (const s of fresh) {
    for (const p of s.parts) {
      await tx.groupSetPart.update({ where: { id: p.id }, data: { status: "RELEASED", releasedAt: now } });
      if (p.piece) {
        const len = milliOf(p.piece.remainingLength);
        await tx.measurementPiece.update({ where: { id: p.piece.id }, data: { setId: null, remainingLength: "0", status: "USED_UP", updatedById: ctx.actorId } });
        await ledger(tx, ctx, [
          { pieceId: p.piece.id, variationId: p.variationId, action: "SET_RELEASE", beforeMilli: len, afterMilli: len, reason: s.code },
          { pieceId: p.piece.id, variationId: p.variationId, action: "PURCHASE_VOID", beforeMilli: len, afterMilli: 0, purchaseId: purchase.id, lineNo: s.purchaseLineNo, reason: `VOID ${purchase.number}` },
        ]);
      }
    }
    await tx.groupSet.update({ where: { id: s.id }, data: { status: "CANCELLED", version: { increment: 1 }, updatedById: ctx.actorId } });
  }
  return fresh.map((s) => s.code);
}

// ---------------------------------------------------------------------------
// Sale (plan §5): pick sets, change / add / remove by-products, sell, void
// ---------------------------------------------------------------------------

/** One set picked on a sale line, with the part changes made in the sale (D10, §5.2). */
export const saleSetInput = z.object({
  setId: z.string().min(1),
  /** The set's version when it was picked; a set changed since is refused (409 SET_CHANGED). */
  version: z.number().int().positive().optional(),
  changes: z
    .array(
      z.object({
        byproductId: z.string().min(1),
        action: z.enum(["REPLACE", "ADD", "REMOVE"]),
        variationId: z.string().min(1).optional(),
        // Measured: the free piece to cut from (else the first that fits, DM-5) and the length.
        pieceId: z.string().min(1).nullish(),
        length: lengthInput.optional(),
        // Sale order only: no free stock had this part when the order was taken; it is fitted at
        // delivery from stock bought for it (the order's shortage report lists it).
        backorder: z.boolean().optional(),
      }),
    )
    .max(10)
    .default([]),
});
export type SaleSetInput = z.infer<typeof saleSetInput>;

export interface SaleSetLine {
  lineNo: number;
  groupId: string;
  /** The line's price per set: the main part's SALE movement carries it (history only). */
  price: string;
  sets: readonly SaleSetInput[];
}

type SaleRef = { id: string; number: string; date: Date };

const KIND_ORDER = { CUT: 0, OPEN: 1, CLOSED: 2 } as const;

/** Free stock of a counted variation, in the set's warehouse when warehousing is on. */
async function freeCounted(tx: Tx, companyId: string, variationId: string, warehouseId: string | null) {
  if (!warehouseId) return (await freeBalances(tx, companyId, [variationId])).free.get(variationId) ?? 0;
  const [stock, held] = await Promise.all([balancesByWarehouse(tx, companyId, [variationId]), inSetsByWarehouse(tx, companyId, [variationId])]);
  const have = (stock.get(variationId) ?? []).find((w) => w.warehouseId === warehouseId)?.quantity ?? 0;
  return (toMilli(have) - toMilli(held.get(`${variationId}|${warehouseId}`) ?? 0)) / 1000;
}

/**
 * Sale, step 1 (plan §5.3 steps 1–3), inside the sale's transaction and before its loose lines
 * move: locks the picked sets, checks they are still in stock as picked, and applies the part
 * changes — an old part goes back to free stock (a measured one as the same Cut piece, D13), a
 * new one is taken from free stock of the set's warehouse (measured: cut from a free piece, GW-2).
 * Nothing is sold yet; `sellSets` does that after the loose lines.
 */
export async function prepareSaleSets(tx: Tx, ctx: MeasureCtx, sale: SaleRef, lines: readonly SaleSetLine[]) {
  const picks = lines.flatMap((l) => l.sets.map((s) => ({ ...s, lineNo: l.lineNo, groupId: l.groupId })));
  if (!picks.length) return;
  const ids = picks.map((p) => p.setId);
  if (new Set(ids).size !== ids.length) throw new AppError(400, "SET_TWICE", "The same set is picked twice");

  const defs = new Map<string, SetDefinition>();
  for (const g of new Set(picks.map((p) => p.groupId))) defs.set(g, await loadSetDefinition(tx, ctx.companyId, g));
  // Lock every variation the sale touches (fixed id order), then the sets themselves.
  const heads = await tx.groupSetPart.findMany({ where: { setId: { in: ids }, status: "ALLOCATED" }, select: { variationId: true } });
  await lockVariations(tx, ctx.companyId, [...heads.map((h) => h.variationId), ...picks.flatMap((p) => p.changes.flatMap((c) => (c.variationId ? [c.variationId] : [])))]);
  await tx.$queryRaw`SELECT id FROM group_sets WHERE id = ANY(${ids}::text[]) AND company_id = ${ctx.companyId} ORDER BY id FOR UPDATE`;
  const sets = await tx.groupSet.findMany({ where: { id: { in: ids }, companyId: ctx.companyId }, include: { parts: { where: { status: "ALLOCATED" }, include: { piece: true } } } });
  const byId = new Map(sets.map((s) => [s.id, s]));

  for (const pick of picks) {
    const set = byId.get(pick.setId);
    const def = defs.get(pick.groupId)!;
    if (!set || set.groupId !== pick.groupId) throw new AppError(400, "UNKNOWN_SET", `That set is not a ${def.name} set`);
    if (set.status !== "IN_STOCK") {
      const why = set.status === "SOLD" ? "already sold" : set.status === "HELD" ? "held on an order" : "cancelled";
      throw new AppError(409, "SET_NOT_AVAILABLE", `This set is ${why}; pick another set`);
    }
    if (pick.version !== undefined && pick.version !== set.version) throw new AppError(409, "SET_CHANGED", `This set changed since it was picked; pick it again`);
    if (!def.active) throw new AppError(409, "PRODUCT_ARCHIVED", `${def.name} is archived`);

    const seen = new Set<string>();
    for (const c of pick.changes) {
      if (seen.has(c.byproductId)) throw new AppError(400, "BYPRODUCT_TWICE", `This set: one change per part`);
      seen.add(c.byproductId);
      const link = def.byproducts.find((b) => b.id === c.byproductId);
      const old = set.parts.find((p) => p.role === "BY" && p.byproductId === c.byproductId) ?? null;
      const name = link?.product.name ?? "This part";
      if (c.action === "ADD" && old) throw new AppError(400, "PART_FITTED", `This set: ${name} is already fitted; change it instead`);
      if (c.action !== "ADD" && !old) throw new AppError(400, "PART_NOT_FITTED", `This set: ${name} is not fitted in this set`);
      if (c.action === "REMOVE") {
        if (link?.required) throw new AppError(400, "PART_REQUIRED", `This set: ${name} is required; change it, it cannot be removed`);
        if (c.variationId || c.length || c.pieceId) throw new AppError(400, "BAD_CHANGE", `This set: removing ${name} takes nothing new`);
      }
      if (c.action !== "REMOVE" && !link) throw new AppError(400, "UNKNOWN_BYPRODUCT", `This set: this by-product is no longer part of ${def.name}`);

      // Old part back to free stock (§5.3 step 2): no movement, it was in the balance already.
      if (old) {
        await tx.groupSetPart.update({ where: { id: old.id }, data: { status: "RELEASED", releasedAt: sale.date } });
        if (old.piece) {
          const len = milliOf(old.piece.remainingLength);
          await tx.measurementPiece.update({ where: { id: old.piece.id }, data: { setId: null, updatedById: ctx.actorId } });
          await ledger(tx, ctx, [{ pieceId: old.piece.id, variationId: old.variationId, action: "SET_RELEASE", beforeMilli: len, afterMilli: len, saleId: sale.id, reason: `${set.code}: changed in ${sale.number}`, occurredAt: sale.date, warehouseId: old.piece.warehouseId }]);
        }
      }
      let newPartId: string | null = null;
      let sourcePieceId: string | null = null;
      if (c.action !== "REMOVE") {
        const variation = link!.product.variations.find((v) => v.id === c.variationId);
        if (!variation || !variation.active) throw new AppError(400, "BAD_VARIATION", `This set: choose a ${name} variation`);
        const measured = link!.product.productType === "measured";
        if (measured && !c.length) throw new AppError(400, "LENGTH_REQUIRED", `This set: enter the ${name} length`);
        if (!measured && (c.length || c.pieceId)) throw new AppError(400, "NOT_MEASURED", `This set: ${name} is always 1 per set`);
        if (measured) {
          // A free piece of that variation in the set's warehouse, long enough (DM-4: one piece).
          const free = await tx.measurementPiece.findMany({
            where: { companyId: ctx.companyId, variationId: variation.id, status: "ACTIVE", setId: null, ...(set.warehouseId ? { warehouseId: set.warehouseId } : {}) },
            select: { id: true, code: true, kind: true, remainingLength: true, warehouseId: true },
          });
          const fits = free.filter((p) => milliOf(p.remainingLength) >= c.length!);
          let piece = c.pieceId ? fits.find((p) => p.id === c.pieceId) : fits.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || milliOf(a.remainingLength) - milliOf(b.remainingLength))[0];
          if (!piece) {
            const unit = link!.product.lengthUnit ?? "m";
            throw new AppError(
              409,
              c.pieceId ? "PIECE_CHANGED" : "NO_PIECE_LONG_ENOUGH",
              c.pieceId
                ? `${set.code}: the chosen ${name} ${variation.shortName} piece no longer has ${formatLength(c.length!, unit)}${set.warehouseId ? " in the set's warehouse" : ""}`
                : `${set.code}: no free ${name} ${variation.shortName} piece is ${formatLength(c.length!, unit)} long${set.warehouseId ? " in the set's warehouse" : ""}`,
            );
          }
          const [child] = await cutPiece(tx, ctx, piece.id, [c.length!], { reason: `Fitted in set ${set.code} (${sale.number})`, date: sale.date });
          await tx.measurementPiece.update({ where: { id: child!.id }, data: { setId: set.id, notes: `In set ${set.code}`, updatedById: ctx.actorId } });
          await ledger(tx, ctx, [{ pieceId: child!.id, variationId: variation.id, action: "SET_ALLOCATE", beforeMilli: c.length!, afterMilli: c.length!, saleId: sale.id, reason: set.code, occurredAt: sale.date, warehouseId: piece.warehouseId }]);
          const part = await tx.groupSetPart.create({ data: { companyId: ctx.companyId, setId: set.id, role: "BY", byproductId: link!.id, variationId: variation.id, pieceId: child!.id, quantity: dec(c.length!) } });
          newPartId = part.id;
          sourcePieceId = piece.id;
        } else {
          if ((await freeCounted(tx, ctx.companyId, variation.id, set.warehouseId)) < 1) {
            throw new AppError(409, "PART_NOT_IN_STOCK", `This set: no free ${name} ${variation.shortName} in stock${set.warehouseId ? " in the set's warehouse" : ""}`);
          }
          const part = await tx.groupSetPart.create({ data: { companyId: ctx.companyId, setId: set.id, role: "BY", byproductId: link!.id, variationId: variation.id, quantity: "1" } });
          newPartId = part.id;
        }
      }
      await tx.groupSetPartChange.create({
        data: {
          companyId: ctx.companyId,
          setId: set.id,
          saleId: sale.id,
          changeType: c.action,
          oldPartId: old?.id ?? null,
          newPartId,
          oldPieceId: old?.pieceId ?? null,
          newSourcePieceId: sourcePieceId,
          createdAt: sale.date,
          createdById: ctx.actorId,
        },
      });
    }
  }
}

/**
 * Sale, step 2 (plan §5.3 steps 4–5), after the loose lines: every part now in the picked sets is
 * sold — SALE movements per part in the set's warehouse (main + by-products, so product sales show
 * the real items), measured pieces used up with a SALE ledger row, parts and sets SOLD.
 * Returns the sold set codes by line.
 */
export async function sellSets(tx: Tx, ctx: MeasureCtx, sale: SaleRef, lines: readonly SaleSetLine[]) {
  const out: { lineNo: number; codes: string[] }[] = [];
  const movements: MovementInput[] = [];
  for (const line of lines) {
    const def = await loadSetDefinition(tx, ctx.companyId, line.groupId);
    const codes: string[] = [];
    for (const pick of line.sets) {
      const set = await tx.groupSet.findUniqueOrThrow({ where: { id: pick.setId }, include: { parts: { where: { status: "ALLOCATED" }, include: { piece: true } } } });
      const wh = set.warehouseId ?? undefined;
      for (const p of set.parts) {
        await tx.groupSetPart.update({ where: { id: p.id }, data: { status: "SOLD" } });
        const milli = milliOf(p.quantity);
        if (p.piece) {
          await tx.measurementPiece.update({ where: { id: p.piece.id }, data: { setId: null, remainingLength: "0", status: "USED_UP", updatedById: ctx.actorId } });
          await ledger(tx, ctx, [{ pieceId: p.piece.id, variationId: p.variationId, action: "SALE", beforeMilli: milli, afterMilli: 0, saleId: sale.id, lineNo: line.lineNo, reason: `${sale.number} (set ${set.code})`, occurredAt: sale.date, warehouseId: p.piece.warehouseId }]);
        }
        movements.push({
          variationId: p.variationId,
          type: "SALE",
          quantity: -milli / 1000,
          // D11: no part prices; the main part carries the set's sale price for history only.
          rate: p.role === "MAIN" ? line.price : null,
          reason: `${sale.number} (set ${set.code})`,
          saleId: sale.id,
          occurredAt: sale.date,
          warehouseId: wh,
        });
      }
      if (!set.parts.some((p) => p.role === "MAIN" && p.variationId === def.mainVariation.id)) throw new AppError(409, "SET_INCOMPLETE", `This set has no main part`);
      await tx.groupSet.update({ where: { id: set.id }, data: { status: "SOLD", saleId: sale.id, saleLineNo: line.lineNo, version: { increment: 1 }, updatedById: ctx.actorId } });
      codes.push(set.code);
    }
    out.push({ lineNo: line.lineNo, codes });
  }
  // One movement per variation and warehouse.
  const merged = new Map<string, MovementInput>();
  for (const m of movements) {
    const key = `${m.variationId}|${m.warehouseId ?? ""}`;
    const prev = merged.get(key);
    merged.set(key, prev ? { ...prev, quantity: (toMilli(prev.quantity) + toMilli(m.quantity)) / 1000, rate: prev.rate ?? m.rate, reason: sale.number } : m);
  }
  await recordMovements(tx, ctx.companyId, ctx.actorId, [...merged.values()], { sets: true, requestId: ctx.requestId });
  return out;
}

/**
 * Sale void (D15): every set sold on the sale comes back in stock with the parts it was sold
 * with (parts released by changes in the sale stay free). Run after restoreSaleCuts, which gives
 * the sold measured pieces their length back; voidDocument records the SALE_VOID movements.
 * Owner rule 2026-10-24: the person cancelling chooses per set — keep it together, or release
 * its measured parts (`releaseSetIds`) as free Cut pieces in normal stock; the set then comes
 * back without them. Returns the restored set codes and the released piece codes.
 */
export async function restoreSaleSets(tx: Tx, ctx: MeasureCtx, sale: { id: string; number: string }, releaseSetIds: readonly string[] = []) {
  const sets = await tx.groupSet.findMany({ where: { companyId: ctx.companyId, saleId: sale.id }, include: { parts: { where: { status: "SOLD" } } }, orderBy: { code: "asc" } });
  const unknown = releaseSetIds.filter((id) => !sets.some((s) => s.id === id));
  if (unknown.length) throw new AppError(400, "BAD_SET", "A set chosen for release is not on this sale");
  const release = new Set(releaseSetIds);
  const released: string[] = [];
  for (const s of sets) {
    for (const p of s.parts) {
      const free = !!p.pieceId && release.has(s.id);
      await tx.groupSetPart.update({ where: { id: p.id }, data: free ? { status: "RELEASED", releasedAt: new Date() } : { status: "ALLOCATED" } });
      if (p.pieceId) {
        const piece = await tx.measurementPiece.findUniqueOrThrow({ where: { id: p.pieceId } });
        const len = milliOf(piece.remainingLength);
        if (len !== milliOf(p.quantity) || piece.status !== "ACTIVE") {
          throw new AppError(409, "SET_PIECE_CHANGED", `Cannot cancel ${sale.number}: the piece ${piece.code} of set ${s.code} did not come back as it was sold`);
        }
        if (free) {
          // Back in normal stock as a free Cut piece (it was cut for the set).
          await tx.measurementPiece.update({ where: { id: piece.id }, data: { setId: null, notes: `Released from set ${s.code} on VOID ${sale.number}`, updatedById: ctx.actorId } });
          await ledger(tx, ctx, [{ pieceId: piece.id, variationId: p.variationId, action: "SET_RELEASE", beforeMilli: len, afterMilli: len, saleId: sale.id, reason: `${s.code}: released on VOID ${sale.number}`, warehouseId: piece.warehouseId }]);
          released.push(piece.code);
          continue;
        }
        await tx.measurementPiece.update({ where: { id: piece.id }, data: { setId: s.id, updatedById: ctx.actorId } });
        await ledger(tx, ctx, [{ pieceId: piece.id, variationId: p.variationId, action: "SET_ALLOCATE", beforeMilli: len, afterMilli: len, saleId: sale.id, reason: `${s.code}: back from VOID ${sale.number}`, warehouseId: piece.warehouseId }]);
      }
    }
    await tx.groupSet.update({ where: { id: s.id }, data: { status: "IN_STOCK", saleId: null, saleLineNo: null, version: { increment: 1 }, updatedById: ctx.actorId } });
  }
  return { codes: sets.map((s) => s.code), released };
}

// ---------------------------------------------------------------------------
// Orders (plan §3 purchase orders, §3.1 sale orders hold sets, D23)
// ---------------------------------------------------------------------------

/** Checks purchase-order set rows against the definition now (they are created on receipt). */
export async function checkSetRows(db: Db, companyId: string, groupId: string, sets: readonly SetInput[]) {
  validateSets(await loadSetDefinition(db, companyId, groupId), sets);
}

/** Sale order: releases every set this order holds (order edited or cancelled). */
export async function releaseOrderSets(tx: Tx, ctx: MeasureCtx, orderId: string) {
  const held = await tx.groupSet.findMany({ where: { companyId: ctx.companyId, orderId, status: "HELD" }, select: { id: true } });
  if (!held.length) return [];
  await tx.groupSet.updateMany({
    where: { id: { in: held.map((h) => h.id) } },
    data: { status: "IN_STOCK", orderId: null, orderLineNo: null, version: { increment: 1 }, updatedById: ctx.actorId },
  });
  return held.map((h) => h.id);
}

/**
 * Sale order (D23): the picked sets become HELD by this order line — hidden from other sales and
 * shifts until delivered or the order is cancelled. Planned part changes are checked against the
 * definition here and applied at delivery. Call after releaseOrderSets on an edit.
 */
export async function holdOrderSets(
  tx: Tx,
  ctx: MeasureCtx,
  order: { id: string; number: string },
  lines: readonly { lineNo: number; groupId: string; sets: readonly SaleSetInput[] }[],
  previouslyHeld: readonly string[] = [],
) {
  const picks = lines.flatMap((l) => l.sets.map((s) => ({ ...s, lineNo: l.lineNo, groupId: l.groupId })));
  if (!picks.length) return;
  const ids = picks.map((p) => p.setId);
  if (new Set(ids).size !== ids.length) throw new AppError(400, "SET_TWICE", "The same set is picked twice");
  await tx.$queryRaw`SELECT id FROM group_sets WHERE id = ANY(${ids}::text[]) AND company_id = ${ctx.companyId} ORDER BY id FOR UPDATE`;
  const sets = new Map((await tx.groupSet.findMany({ where: { id: { in: ids }, companyId: ctx.companyId } })).map((s) => [s.id, s]));
  const defs = new Map<string, SetDefinition>();
  for (const pick of picks) {
    const def = defs.get(pick.groupId) ?? (await loadSetDefinition(tx, ctx.companyId, pick.groupId));
    defs.set(pick.groupId, def);
    const set = sets.get(pick.setId);
    if (!set || set.groupId !== pick.groupId) throw new AppError(400, "UNKNOWN_SET", `That set is not a ${def.name} set`);
    if (set.status !== "IN_STOCK") {
      const why = set.status === "SOLD" ? "already sold" : set.status === "HELD" ? "held on another order" : "cancelled";
      throw new AppError(409, "SET_NOT_AVAILABLE", `This set is ${why}; pick another set`);
    }
    // A set this order already held was just released by the edit (its version moved on).
    if (pick.version !== undefined && !previouslyHeld.includes(set.id) && pick.version !== set.version) {
      throw new AppError(409, "SET_CHANGED", `This set changed since it was picked; pick it again`);
    }
    const seen = new Set<string>();
    for (const c of pick.changes) {
      const link = def.byproducts.find((b) => b.id === c.byproductId);
      if (seen.has(c.byproductId)) throw new AppError(400, "BYPRODUCT_TWICE", `This set: one change per part`);
      seen.add(c.byproductId);
      if (c.action !== "REMOVE" && !link) throw new AppError(400, "UNKNOWN_BYPRODUCT", `This set: this by-product is not part of ${def.name}`);
      if (c.action === "REMOVE" && link?.required) throw new AppError(400, "PART_REQUIRED", `This set: ${link.product.name} is required; change it, it cannot be removed`);
      if (c.action !== "REMOVE" && !link!.product.variations.some((v) => v.id === c.variationId && v.active)) {
        throw new AppError(400, "BAD_VARIATION", `This set: choose a ${link!.product.name} variation`);
      }
    }
    await tx.groupSet.update({ where: { id: set.id }, data: { status: "HELD", orderId: order.id, orderLineNo: pick.lineNo, version: { increment: 1 }, updatedById: ctx.actorId } });
  }
}

/**
 * Delivery of a sale order's set lines: the held sets go back to IN_STOCK (still naming the order)
 * so the delivery's sale can sell them in the same transaction. Refused when a set is no longer
 * held by this order.
 */
export async function unholdForDelivery(tx: Tx, companyId: string, orderId: string, setIds: readonly string[]) {
  if (!setIds.length) return;
  await tx.$queryRaw`SELECT id FROM group_sets WHERE id = ANY(${[...setIds]}::text[]) AND company_id = ${companyId} ORDER BY id FOR UPDATE`;
  const rows = await tx.groupSet.findMany({ where: { id: { in: [...setIds] }, companyId } });
  for (const s of rows) {
    if (s.orderId !== orderId || (s.status !== "HELD" && s.status !== "IN_STOCK")) {
      throw new AppError(409, "SET_NOT_AVAILABLE", `A set is no longer held for this order; edit the order and pick another set`);
    }
  }
  if (rows.length !== setIds.length) throw new AppError(409, "SET_NOT_AVAILABLE", "A set of this order was not found");
  await tx.groupSet.updateMany({ where: { id: { in: [...setIds] } }, data: { status: "IN_STOCK" } });
}

/** The sets an order holds (or held and still names), by order line number (order page). */
export async function setsOfOrder(db: Db, companyId: string, orderId: string) {
  const rows = await db.groupSet.findMany({ where: { companyId, orderId, status: { in: ["HELD", "IN_STOCK"] } }, include: setInclude, orderBy: { code: "asc" } });
  const byLine = new Map<number, ReturnType<typeof serializeSet>[]>();
  for (const s of rows) byLine.set(s.orderLineNo ?? 0, [...(byLine.get(s.orderLineNo ?? 0) ?? []), serializeSet(s)]);
  return byLine;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

const setInclude = {
  parts: {
    where: { status: { in: ["ALLOCATED", "SOLD"] } },
    orderBy: [{ role: "asc" }, { allocatedAt: "asc" }],
    include: {
      byproduct: { select: { id: true, required: true, sortOrder: true } },
      piece: { select: { id: true, code: true } },
      variation: {
        select: {
          id: true,
          shortName: true,
          attributes: true,
          salePrice: true,
          group: { select: { id: true, name: true, productType: true, lengthUnit: true, lengthDecimals: true, attributeDefinitions: true } },
        },
      },
    },
  },
  group: { select: { id: true, name: true } },
  purchase: { select: { id: true, number: true } },
  sale: { select: { id: true, number: true } },
} satisfies Prisma.GroupSetInclude;

type SetRow = Prisma.GroupSetGetPayload<{ include: typeof setInclude }>;

/** "Chain Hoist · 4 mm 3 m · Hook" — a set is named by its current contents (D18). */
export function serializeSet(s: SetRow) {
  const parts = [...s.parts]
    .filter((p) => (s.status === "SOLD" ? p.status === "SOLD" : p.status === "ALLOCATED"))
    .sort((a, b) => (a.role === b.role ? (a.byproduct?.sortOrder ?? 0) - (b.byproduct?.sortOrder ?? 0) : a.role === "MAIN" ? -1 : 1))
    .map((p) => {
      const g = p.variation.group;
      const defs = (g.attributeDefinitions as unknown as AttributeDef[]) ?? [];
      const raw = (p.variation.attributes ?? {}) as Record<string, string>;
      // "8" with unit "mm" reads "8 mm" (same as the product's own option buttons).
      const attrs = (defs.length ? defs.map((d) => {
        const v = raw[d.name] ?? "";
        return v && d.unit && !d.isQuality && /\d$/.test(v) ? `${v} ${d.unit}` : v;
      }) : Object.values(raw)).filter(Boolean);
      const measured = g.productType === "measured";
      const length = measured ? formatLength(toMilli(Number(p.quantity)), g.lengthUnit ?? "m", g.lengthDecimals ?? 3) : null;
      const label = [...(attrs.length ? attrs : [g.name]), ...(length ? [length] : [])].join(" ");
      // Clean display value (no codes): "8 mm · 3 m"; a part with no options reads "Fitted".
      const value = [attrs.join(" "), length].filter(Boolean).join(" · ") || "Fitted";
      return {
        id: p.id,
        role: p.role,
        byproductId: p.byproductId,
        required: p.byproduct?.required ?? true,
        productId: g.id,
        productName: g.name,
        productType: g.productType,
        variationId: p.variation.id,
        shortName: p.variation.shortName,
        attributes: p.variation.attributes,
        quantity: Number(p.quantity),
        lengthUnit: g.lengthUnit,
        piece: p.piece,
        label,
        value,
        salePrice: p.variation.salePrice.toFixed(2),
      };
    });
  const by = parts.filter((p) => p.role === "BY");
  return {
    id: s.id,
    code: s.code,
    groupId: s.groupId,
    groupName: s.group.name,
    name: [s.group.name, ...by.map((p) => p.label)].join(" · "),
    /** What the set holds, part by part, for display: "Load Chain Grade 80" → "8 mm · 3 m". */
    contents: by.map((p) => ({ name: p.productName, value: p.value })),
    status: s.status,
    source: s.source,
    warehouseId: s.warehouseId,
    rate: s.rate.toFixed(2),
    notes: s.notes,
    purchase: s.purchase,
    sale: s.sale,
    // The sale order holding the set (D23).
    orderId: s.orderId,
    version: s.version,
    createdAt: s.createdAt,
    parts,
  };
}

export const setsQuery = z.object({
  groupId: z.string().min(1).optional(),
  status: z.enum(["IN_STOCK", "HELD", "SOLD", "CANCELLED", "all"]).default("IN_STOCK"),
  q: z.string().trim().max(100).optional(),
  // V3.1 (0038, G-A): only sets in this category — the grouped product is, or a fitted part is.
  categoryId: z.string().min(1).optional(),
});

/** G-A: a set is in a category when its grouped product is, or one of its fitted parts is. */
function setInCategory(categoryId: string): Prisma.GroupSetWhereInput {
  return {
    OR: [
      { group: { OR: [{ categoryId }, { categoryLinks: { some: { categoryId } } }] } },
      {
        parts: {
          some: {
            status: "ALLOCATED",
            variation: { OR: [{ categoryLinks: { some: { categoryId } } }, { group: { OR: [{ categoryId }, { categoryLinks: { some: { categoryId } } }] } }] },
          },
        },
      },
    ],
  };
}

export async function listSets(db: Db, companyId: string, q: z.infer<typeof setsQuery>) {
  const rows = await db.groupSet.findMany({
    where: {
      companyId,
      ...(q.groupId ? { groupId: q.groupId } : {}),
      ...(q.status === "all" ? {} : { status: q.status as SetStatus }),
      ...(q.q ? { code: { contains: q.q, mode: "insensitive" } } : {}),
      ...(q.categoryId ? setInCategory(q.categoryId) : {}),
    },
    include: setInclude,
    orderBy: [{ createdAt: "desc" }, { code: "asc" }],
    take: 500,
  });
  return rows.map(serializeSet);
}

export async function getSet(db: Db, companyId: string, id: string) {
  const s = await db.groupSet.findFirst({ where: { id, companyId }, include: setInclude });
  if (!s) throw new AppError(404, "NOT_FOUND", "Set not found");
  return serializeSet(s);
}

/** Display contents of the given sets, by set id (shift page; no codes shown). */
export async function setContentsByIds(db: Db, companyId: string, ids: readonly string[]) {
  if (!ids.length) return new Map<string, ReturnType<typeof serializeSet>["contents"]>();
  const rows = await db.groupSet.findMany({ where: { companyId, id: { in: [...ids] } }, include: setInclude });
  return new Map(rows.map((r) => [r.id, serializeSet(r).contents]));
}

/** The sets on a purchase's (or sale's) grouped lines, by line number (document page). */
export async function setsOfDocument(db: Db, companyId: string, kind: "sale" | "purchase", documentId: string) {
  const rows = await db.groupSet.findMany({
    where: { companyId, ...(kind === "sale" ? { saleId: documentId } : { purchaseId: documentId }) },
    include: setInclude,
    orderBy: { code: "asc" },
  });
  const byLine = new Map<number, ReturnType<typeof serializeSet>[]>();
  for (const s of rows) {
    const lineNo = (kind === "sale" ? s.saleLineNo : s.purchaseLineNo) ?? 0;
    byLine.set(lineNo, [...(byLine.get(lineNo) ?? []), serializeSet(s)]);
  }
  return byLine;
}

/** Sets per status for a grouped product (product page header). */
export async function setCounts(db: Db, companyId: string, groupId: string) {
  const rows = await db.groupSet.groupBy({ by: ["status"], where: { companyId, groupId }, _count: true });
  const out: Record<SetStatus, number> = { IN_STOCK: 0, HELD: 0, SOLD: 0, CANCELLED: 0 };
  for (const r of rows) out[r.status] = r._count;
  return out;
}

// ---------------------------------------------------------------------------
// Definition edit (plan §2 "Edit")
// ---------------------------------------------------------------------------

export const definitionBody = z.object({
  byproducts: z
    .array(z.object({ productId: z.string().min(1), required: z.boolean() }))
    .min(1, "Keep at least one by-product")
    .max(10),
});

/**
 * Replaces the by-product links: new links apply to sets bought from now on; a removed link is
 * deactivated (sets keep their part); required ↔ optional applies to new sets and new sale edits.
 */
export async function updateDefinition(tx: Tx, ctx: MeasureCtx, groupId: string, body: z.infer<typeof definitionBody>) {
  const g = await tx.productGroup.findFirst({ where: { id: groupId, companyId: ctx.companyId }, select: { id: true, name: true, productType: true } });
  if (!g) throw new AppError(404, "NOT_FOUND", "Product not found");
  if (g.productType !== "grouped") throw new AppError(400, "NOT_GROUPED", `${g.name} is not a grouped product`);
  await tx.$queryRaw`SELECT id FROM product_groups WHERE id = ${groupId} FOR UPDATE`;
  const ids = body.byproducts.map((b) => b.productId);
  if (new Set(ids).size !== ids.length) throw new AppError(400, "BYPRODUCT_DUPLICATE", "A by-product is listed twice");
  const products = await tx.productGroup.findMany({ where: { companyId: ctx.companyId, id: { in: ids } }, select: { id: true, name: true, productType: true, ownerGroupId: true, active: true } });
  for (const id of ids) {
    const p = products.find((x) => x.id === id);
    if (!p) throw new AppError(404, "NOT_FOUND", "By-product not found");
    if (p.id === groupId || p.productType === "grouped") throw new AppError(400, "BYPRODUCT_GROUPED", `${p.name} is a grouped product; a set cannot contain another set`);
    if (p.ownerGroupId) throw new AppError(400, "BYPRODUCT_MAIN", `${p.name} is the main component of a set`);
  }
  const existing = await tx.groupByproduct.findMany({ where: { groupId } });
  const before = existing.filter((e) => e.active).map((e) => ({ productId: e.productId, required: e.required }));
  for (const [sortOrder, b] of body.byproducts.entries()) {
    const link = existing.find((e) => e.productId === b.productId);
    if (link) await tx.groupByproduct.update({ where: { id: link.id }, data: { active: true, required: b.required, sortOrder } });
    else {
      const p = products.find((x) => x.id === b.productId)!;
      if (!p.active) throw new AppError(400, "BYPRODUCT_INACTIVE", `${p.name} is archived`);
      await tx.groupByproduct.create({ data: { companyId: ctx.companyId, groupId, productId: b.productId, required: b.required, sortOrder, createdById: ctx.actorId } });
    }
  }
  for (const e of existing) {
    if (e.active && !ids.includes(e.productId)) await tx.groupByproduct.update({ where: { id: e.id }, data: { active: false } });
  }
  await tx.productGroup.update({ where: { id: groupId }, data: { version: { increment: 1 }, updatedById: ctx.actorId } });
  await audit(tx, { companyId: ctx.companyId, actorId: ctx.actorId, action: "GROUPED_DEFINITION_UPDATE", entityType: "ProductGroup", entityId: groupId, before: { byproducts: before }, after: { byproducts: body.byproducts }, requestId: ctx.requestId ?? null });
}
