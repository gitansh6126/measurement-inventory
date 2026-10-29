import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, WRITE_TX, type Tx } from "../db.js";
import { formatLength, ratePerOf, toMilli } from "@rs-v31/shared/measure";
import { audit } from "./audit.js";
import { AppError } from "./errors.js";
import { cutForSale, dec, receiveRolls, restoreSaleCuts, reversePurchaseRolls, rollInput } from "./measure.js";
import { fiscalYearOf, nextDocNumber } from "./numbering.js";
import { lockOrderOfDocument, syncNote, syncOrderFromDocuments, type OrderSyncResult } from "./order-sync.js";
import { recalculateProductActivityForSale, recordProductSale } from "./product-activity.js";
import { cancelPurchaseSets, createSets, prepareSaleSets, restoreSaleSets, saleSetInput, sellSets, setInput, type SaleSetLine } from "./sets.js";
import { money, recordMovements, type MovementInput } from "./stock.js";
import { isWarehousingOn, requireWarehouse, requireWarehouses, resolveWarehouse, splitsInput, validateSplits } from "./warehouses.js";
import { upsertRate } from "./vendor-prices.js";

// Sales and purchases share one engine (D18). References: main v2 completeSale/completePurchase
// and addOrder (BR-01/02), marble 2110 lib/documents.ts (per-line totals, assertActive).

// ---------------------------------------------------------------------------
// Money in whole paise (BigInt): exact, no float drift.
// ---------------------------------------------------------------------------

/** "450.5" → 45050n. Input is already validated by `money` (≤ 2 decimals, non-negative). */
export function toPaise(v: string): bigint {
  const [whole, frac = ""] = v.split(".");
  return BigInt(whole!) * 100n + BigInt((frac + "00").slice(0, 2));
}

/** 45050n → "450.50" */
export function fromPaise(p: bigint): string {
  const neg = p < 0n;
  const a = neg ? -p : p;
  return `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}

/** Largest amount a Decimal(14,2) column holds. */
const MAX_PAISE = 99_999_999_999_999n;

/**
 * Gross line amount in paise. A whole quantity keeps the exact product, as before; a fractional
 * Measured length is rounded half-up to the whole rupee (owner decision: no paise in V2), the same
 * rule the 0020 line check applies. `ratePer` is base units per rate unit: a feet + inches line has
 * its length in inches and its price per foot (12), so its amount is always rounded (0028).
 */
export function lineGrossPaise(quantityMilli: number, pricePaise: bigint, ratePer = 1): bigint {
  const q = BigInt(quantityMilli);
  if (ratePer === 1 && q % 1000n === 0n) return (q / 1000n) * pricePaise;
  const div = 100_000n * BigInt(ratePer);
  const scaled = q * pricePaise; // paise × 1000 × ratePer
  const rupees = (scaled + div / 2n) / div;
  return rupees * 100n;
}

/**
 * Line quantity: a positive number with at most 3 decimals. Whole numbers are required for
 * Simple / Variable items (checked per line once the item is known, and by the 0020 trigger).
 */
export const lineQuantity = z
  .number()
  .positive("Quantity must be more than 0")
  .max(1_000_000)
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, "Use at most 3 decimal places");

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const documentBody = z.object({
  partyId: z.string().min(1).nullish().transform((v) => v ?? null),
  notes: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v || null),
  // Client-generated per checkout; a repeated submit returns the same document (D21).
  clientRef: z.string().uuid().optional(),
  // V2 (plan §3.3): the seller confirmed selling below zero. Honoured only for sales, and only
  // when the company policy lets this user oversell; otherwise the shortage is still refused.
  allowNegative: z.boolean().optional().default(false),
  // V3.1 warehouses (WH-5): purchase "Receive into" for lines, rolls and sets that name none.
  warehouseId: z.string().min(1).nullish(),
  date: z
    .string()
    .nullish()
    .transform((v) => (v ? new Date(v) : undefined)),
  lines: z
    .array(
      z.object({
        variationId: z.string().min(1),
        // Measured purchase lines may omit it: the line is the sum of its rolls.
        quantity: lineQuantity.optional(),
        price: money,
        // Measured sale lines (V2 plan §2.8): the piece the seller chose (else the first in DM-5
        // order) and the scrap prompt's answer (DM-7).
        pieceId: z.string().min(1).nullish(),
        writeOffLeftover: z.boolean().optional(),
        // Measured purchase lines (§2.7): one entry per physical roll, each length typed.
        rolls: z.array(rollInput).min(1).max(500).optional(),
        // V3.1 grouped purchase lines (plan §3): one entry per set bought on this line; every set
        // on the line has the line price as its rate (sets at another rate go on another line).
        sets: z.array(setInput.extend({ rate: money.optional() })).min(1).max(100).optional(),
        // V3.1 grouped sale lines (plan §5): the sets picked from stock, each with its part
        // changes; all sets on the line sell at the line price (repriced sets go on another line).
        saleSets: z.array(saleSetInput).min(1).max(100).optional(),
        // V3.1 warehouses (WH-5, WH-6): counted lines only — how much comes from / goes to each
        // warehouse; must add up to the quantity. Omitted: purchase → header / default warehouse,
        // sale → default warehouse first, then the others by stock (suggestSaleSplits).
        splits: splitsInput.optional(),
        // V2 (plan §3.1): flat line discount in rupees and a short line note.
        discount: money.optional(),
        note: z
          .string()
          .trim()
          .max(300)
          .nullish()
          .transform((v) => v || null),
      }),
    )
    .min(1, "Add at least one item")
    .max(200, "At most 200 lines per document"),
  // V2 (plan §3.1): payment information only — ledgers and settlement are V3. With a mode and no
  // amount, CREDIT means nothing paid yet and any other mode means paid in full.
  paymentMode: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CREDIT"]).nullish(),
  amountPaid: money.nullish(),
  // V2 (plan §3.4): checking out a held cart marks that draft COMPLETED in the same transaction.
  draftId: z.string().min(1).optional(),
});
export type DocumentBody = z.infer<typeof documentBody>;

/** Payment status from what was paid against the total (paise). */
export function paymentFor(mode: DocumentBody["paymentMode"], paidInput: string | null | undefined, totalPaise: bigint) {
  if (!mode && (paidInput === null || paidInput === undefined)) return { paymentMode: null, paymentStatus: null, amountPaid: null };
  const paid = paidInput !== null && paidInput !== undefined ? toPaise(paidInput) : mode === "CREDIT" ? 0n : totalPaise;
  if (paid > totalPaise) throw new AppError(400, "OVERPAID", "Amount paid cannot be more than the total");
  const paymentStatus = paid === totalPaise ? "PAID" : paid === 0n ? "PENDING" : "PARTIAL";
  return { paymentMode: mode ?? null, paymentStatus, amountPaid: fromPaise(paid) } as const;
}

export interface KindConfig {
  kind: "sale" | "purchase";
  action: string;
  sign: 1 | -1;
  partyTypes: ("CUSTOMER" | "SUPPLIER" | "BOTH")[];
  partyLabel: string;
}

export const SALE: KindConfig = { kind: "sale", action: "SALE_CREATE", sign: -1, partyTypes: ["CUSTOMER", "BOTH"], partyLabel: "customer" };
export const PURCHASE: KindConfig = { kind: "purchase", action: "PURCHASE_CREATE", sign: 1, partyTypes: ["SUPPLIER", "BOTH"], partyLabel: "supplier" };

export interface DocContext {
  companyId: string;
  actorId: string;
  requestId: string;
}

/**
 * Creates a sale or purchase atomically: validates every line against the live catalog,
 * computes totals on the server, allocates the number, writes document + line snapshots +
 * stock movements, and audits — all in one transaction. The database re-checks totals,
 * stock and line/movement agreement at commit (0004_documents).
 */
export async function createDocument(cfg: KindConfig, ctx: DocContext, body: DocumentBody): Promise<{ id: string; created: boolean }> {
  const { companyId } = ctx;
  const existing = await findByClientRef(cfg, companyId, body.clientRef);
  if (existing) return { id: existing, created: false };

  try {
    const id = await prisma.$transaction((tx) => writeDocument(tx, cfg, ctx, body), WRITE_TX);
    return { id, created: true };
  } catch (e) {
    // Two submits with the same key raced: return the one that won.
    if (body.clientRef && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await findByClientRef(cfg, companyId, body.clientRef);
      if (winner) return { id: winner, created: false };
    }
    throw e;
  }
}

export interface WriteDocOptions {
  number?: string;
  replacesId?: string;
  revision?: number;
  occurredAt?: Date;
  reason?: string;
  skipMovements?: boolean;
  orderId?: string;
  /** 0027: the order line each document line delivers / receives, by index (internal only). */
  orderLineIds?: (string | null)[];
}

/**
 * The body of createDocument inside the caller's transaction, so completing an order can create
 * its sale / purchase atomically with the order's own status change.
 */
export async function writeDocument(
  tx: Tx,
  cfg: KindConfig,
  ctx: DocContext,
  body: DocumentBody,
  options?: WriteDocOptions,
): Promise<string> {
  const { companyId, actorId, requestId } = ctx;
  const ids = [...new Set(body.lines.map((l) => l.variationId))];
  // A held cart being checked out: lock and validate it first (plan §3.4).
  if (body.draftId) {
    const drafts = await tx.$queryRaw<{ status: string; mode: string }[]>`
      SELECT status::text, mode::text FROM draft_orders WHERE id = ${body.draftId} AND company_id = ${companyId} FOR UPDATE`;
    const draft = drafts[0];
    if (!draft || draft.mode !== (cfg.kind === "sale" ? "SALE" : "PURCHASE")) throw new AppError(400, "UNKNOWN_DRAFT", "That draft was not found");
    if (draft.status !== "ACTIVE") throw new AppError(409, "DRAFT_CLOSED", "This draft was already completed or discarded");
  }
  const party = await loadParty(tx, cfg, companyId, body.partyId);
  // V3.1 warehouses: a purchase's "Receive into" (undefined while warehousing is off). A sale has
  // no header warehouse; its lines' splits (or the automatic pick) decide.
  const warehousing = await isWarehousingOn(tx, companyId);
  if (!warehousing && body.lines.some((l) => l.splits)) throw new AppError(400, "WAREHOUSING_OFF", "Warehousing is not set up yet");
  const header = cfg.kind === "purchase" ? await resolveWarehouse(tx, companyId, body.warehouseId) : undefined;
  const splitWarehouseIds = body.lines.flatMap((l) => (l.splits ?? []).map((s) => s.warehouseId));
  if (splitWarehouseIds.length) {
    await requireWarehouses(tx, companyId, splitWarehouseIds, { active: cfg.kind === "purchase" });
  }
  const variations = await tx.productVariation.findMany({
    where: { companyId, id: { in: ids } },
    include: { group: { select: { name: true, unit: true, active: true, productType: true, lengthUnit: true, lengthDecimals: true } } },
  });
  const byId = new Map(variations.map((v) => [v.id, v]));
  // A counted item appears once per document; a Measured variation may repeat, one line per
  // cut or roll batch (W16). Migration 0021 re-checks this per inserted line.
  // V3.1: a grouped product may repeat too (one line per set rate).
  const counted = body.lines.map((l) => l.variationId).filter((id) => !["measured", "grouped"].includes(byId.get(id)?.group.productType ?? ""));
  if (new Set(counted).size !== counted.length) {
    throw new AppError(400, "DUPLICATE_LINE", "The same item appears twice; change its quantity instead");
  }

  let subtotal = 0n;
  const lines = body.lines.map((l, i) => {
    const v = byId.get(l.variationId);
    if (!v) throw new AppError(400, "UNKNOWN_ITEM", `Line ${i + 1}: item not found`);
    // marble assertActive: new documents use only active variations of active products.
    if (!v.group.active || !v.active) throw new AppError(400, "INACTIVE_ITEM", `${v.group.name} ${v.shortName} is archived`);
    const measured = v.group.productType === "measured";
    const grouped = v.group.productType === "grouped";
    const name = `${v.group.name} ${v.shortName}`;
    // Rolls / pieces / sets carry their own warehouse; a split is for counted lines only.
    if (l.splits && (measured || grouped)) throw new AppError(400, "BAD_LINE", `${name}: ${measured ? "each roll or piece" : "each set"} has its own warehouse`);
    if (l.splits && l.quantity !== undefined) validateSplits(name, l.quantity, l.splits);
    let qtyMilli = l.quantity === undefined ? 0 : toMilli(l.quantity);
    if (grouped && cfg.kind === "sale") {
      // V3.1 (plan §5): a grouped sale line is the sets picked from stock.
      if (!l.saleSets?.length) throw new AppError(400, "SETS_REQUIRED", `${v.group.name}: pick the sets sold`);
      if (l.sets) throw new AppError(400, "BAD_LINE", `${v.group.name}: a sale picks sets from stock`);
      if (l.quantity !== undefined && qtyMilli !== l.saleSets.length * 1000) {
        throw new AppError(400, "SETS_TOTAL", `${v.group.name}: ${l.saleSets.length} set${l.saleSets.length === 1 ? "" : "s"} picked, not ${l.quantity}`);
      }
      if (l.pieceId || l.rolls || l.writeOffLeftover) throw new AppError(400, "BAD_LINE", `${name}: a set line carries sets only`);
      qtyMilli = l.saleSets.length * 1000;
    } else if (l.saleSets) {
      throw new AppError(400, "BAD_LINE", `${name}: ${grouped ? "a purchase enters new sets" : "only a grouped product picks sets"}`);
    } else if (grouped) {
      // V3.1 (plan §3): a grouped line is whole sets, entered one by one.
      if (!l.sets?.length) throw new AppError(400, "SETS_REQUIRED", `${v.group.name}: enter each set bought (its parts)`);
      if (l.quantity !== undefined && qtyMilli !== l.sets.length * 1000) {
        throw new AppError(400, "SETS_TOTAL", `${v.group.name}: ${l.sets.length} set${l.sets.length === 1 ? "" : "s"} entered, not ${l.quantity}`);
      }
      if (l.sets.some((s) => s.rate !== undefined && toPaise(s.rate) !== toPaise(l.price))) {
        throw new AppError(400, "SET_RATE_MISMATCH", `${v.group.name}: sets on one line share its rate; put sets at another rate on another line`);
      }
      if (l.pieceId || l.rolls || l.writeOffLeftover) throw new AppError(400, "BAD_LINE", `${name}: a set line carries sets only`);
      qtyMilli = l.sets.length * 1000;
    } else if (l.sets) {
      throw new AppError(400, "NOT_GROUPED", `${name} is not a grouped product`);
    } else if (!measured) {
      if (l.quantity === undefined) throw new AppError(400, "QUANTITY_REQUIRED", `Line ${i + 1}: enter a quantity`);
      if (qtyMilli % 1000 !== 0) throw new AppError(400, "WHOLE_QUANTITY", `${name}: quantity must be a whole number`);
      if (l.pieceId || l.rolls || l.writeOffLeftover) throw new AppError(400, "NOT_MEASURED", `${name} is not sold by length`);
    } else if (cfg.kind === "purchase") {
      // §2.7: every roll's length is typed; the line is their sum.
      if (!l.rolls?.length) throw new AppError(400, "ROLLS_REQUIRED", `${name}: enter the length of each roll received`);
      if (l.pieceId || l.writeOffLeftover) throw new AppError(400, "BAD_LINE", `${name}: a purchase receives rolls, it does not cut them`);
      const sum = l.rolls.reduce((s, r) => s + r.length, 0);
      if (l.quantity !== undefined && qtyMilli !== sum) {
        const unit = v.group.lengthUnit ?? "m";
        throw new AppError(400, "ROLLS_TOTAL", `${name}: the rolls add up to ${formatLength(sum, unit)}, not ${formatLength(qtyMilli, unit)}`);
      }
      qtyMilli = sum;
    } else {
      if (l.quantity === undefined) throw new AppError(400, "QUANTITY_REQUIRED", `Line ${i + 1}: enter the length`);
      if (l.rolls) throw new AppError(400, "BAD_LINE", `${name}: rolls are entered on purchases`);
    }
    // Measured rates are per rate unit (per ft on a feet + inches product, 0028).
    const ratePer = measured ? ratePerOf(v.group.lengthUnit) : 1;
    const gross = lineGrossPaise(qtyMilli, toPaise(l.price), ratePer);
    if (gross > MAX_PAISE) throw new AppError(400, "AMOUNT_TOO_LARGE", `Line ${i + 1}: amount is too large`);
    const discount = l.discount ? toPaise(l.discount) : 0n;
    if (discount > gross) throw new AppError(400, "DISCOUNT_TOO_LARGE", `Line ${i + 1}: discount is more than the line amount`);
    const total = gross - discount;
    subtotal += total;
    return {
      lineNo: i + 1,
      variationId: v.id,
      productNameSnapshot: v.group.name,
      shortNameSnapshot: v.shortName,
      officialSkuSnapshot: v.officialSku,
      attributesSnapshot: v.attributes as Prisma.InputJsonValue,
      unit: v.group.unit,
      quantity: dec(qtyMilli),
      price: fromPaise(toPaise(l.price)),
      ratePer,
      discount: fromPaise(discount),
      note: l.note,
      lineTotal: fromPaise(total),
      orderLineId: options?.orderLineIds?.[i] ?? null,
    };
  });
  // Measured lines and what they carry, by line number (pieces, rolls).
  const measuredLines = body.lines
    .map((l, i) => ({ l, i, line: lines[i]! }))
    .filter(({ l }) => byId.get(l.variationId)!.group.productType === "measured");
  if (subtotal > MAX_PAISE) throw new AppError(400, "AMOUNT_TOO_LARGE", "Document total is too large");
  const payment = paymentFor(body.paymentMode, body.amountPaid, subtotal);

  const docDate = body.date instanceof Date && !isNaN(body.date.getTime()) ? body.date : new Date();
  const number = options?.number ?? (await nextDocNumber(tx, companyId, cfg.kind, docDate));
  const common = {
    companyId,
    number,
    partyId: party?.id ?? null,
    partyName: party?.name ?? null,
    subtotal: fromPaise(subtotal),
    total: fromPaise(subtotal),
    notes: body.notes,
    clientRef: body.clientRef ?? null,
    orderId: options?.orderId ?? null,
    ...payment,
    replacesId: options?.replacesId ?? null,
    revision: options?.revision ?? 0,
    createdAt: docDate,
    createdById: actorId,
  };
  const doc =
    cfg.kind === "sale"
      ? await tx.sale.create({
          data: {
            ...common,
            saleDate: docDate,
            lines: { create: lines.map(({ price, ...l }): Prisma.SaleLineUncheckedCreateWithoutSaleInput => ({ ...l, unitPrice: price })) },
          },
          select: { id: true },
        })
      : await tx.purchase.create({
          data: {
            ...common,
            purchaseDate: docDate,
            lines: { create: lines.map(({ price, ...l }): Prisma.PurchaseLineUncheckedCreateWithoutPurchaseInput => ({ ...l, unitCost: price })) },
          },
          select: { id: true },
        });

  // Measured items (V2 plan §2.7–2.8): purchases create one Closed piece per typed roll; sales
  // cut each line from one piece. Done before the movements so a missing length is reported
  // by roll, not as a plain shortage. Migration 0020 re-checks rolls = stock at commit.
  let measuredResult: unknown = undefined;
  // V3.1: measured lines' warehouse parts — purchase: per roll; sale: the cut piece's warehouse.
  const measuredWh = new Map<number, Map<string | undefined, number>>();
  if (measuredLines.length) {
    const mctx = { companyId, actorId, requestId };
    if (cfg.kind === "purchase") {
      const received = await receiveRolls(
        tx,
        mctx,
        { id: doc.id, number, supplierId: party?.id ?? null, date: docDate },
        measuredLines.map(({ l, line }) => ({ lineNo: line.lineNo, variationId: l.variationId, rolls: l.rolls!, unitCost: line.price, warehouseId: header })),
      );
      for (const r of received) measuredWh.set(r.lineNo, r.byWarehouse);
      measuredResult = received.map(({ byWarehouse: _, ...r }) => r);
    }
  }
  if (measuredLines.length && cfg.kind === "sale") {
    const mctx = { companyId, actorId, requestId };
    const cuts = await cutForSale(
      tx,
      mctx,
      { id: doc.id, number, date: docDate },
      measuredLines.map(({ l, line }) => ({
        key: String(line.lineNo),
        variationId: l.variationId,
        lengthMilli: toMilli(line.quantity),
        pieceId: l.pieceId ?? null,
        writeOffLeftover: l.writeOffLeftover,
      })),
    );
    for (const c of cuts) {
      const parts = measuredWh.get(Number(c.key)) ?? new Map<string | undefined, number>();
      parts.set(c.warehouseId, (parts.get(c.warehouseId) ?? 0) + c.beforeMilli - c.afterMilli);
      measuredWh.set(Number(c.key), parts);
    }
    measuredResult = cuts;
  }

  // V3.1 grouped lines (plan §3 steps 3–6): each set is created with its parts; the parts'
  // PURCHASE movements carry this purchase. The grouped variation itself never moves.
  const isGrouped = (variationId: string) => byId.get(variationId)!.group.productType === "grouped";
  let setCodes: { lineNo: number; codes: string[] }[] = [];
  // V3.1 grouped sale lines (plan §5.3): part changes now, before the loose lines move (so they
  // cannot take a replacement part's free stock); the sets are sold after them.
  const saleSetLines: SaleSetLine[] =
    cfg.kind === "sale"
      ? body.lines.flatMap((l, i) => (isGrouped(l.variationId) ? [{ lineNo: lines[i]!.lineNo, groupId: byId.get(l.variationId)!.groupId, price: lines[i]!.price, sets: l.saleSets! }] : []))
      : [];
  const saleRef = { id: doc.id, number, date: docDate };
  await prepareSaleSets(tx, { companyId, actorId, requestId }, saleRef, saleSetLines);
  for (const [i, l] of body.lines.entries()) {
    if (cfg.kind === "sale" || !isGrouped(l.variationId)) continue;
    const line = lines[i]!;
    const created = await createSets(
      tx,
      { companyId, actorId, requestId },
      byId.get(l.variationId)!.groupId,
      l.sets!.map((s) => ({ ...s, rate: line.price })),
      { source: "PURCHASE", date: docDate, purchase: { id: doc.id, number, lineNo: line.lineNo }, reason: options?.reason ?? number, warehouseId: header },
    );
    setCodes.push({ lineNo: line.lineNo, codes: created.map((c) => c.code) });
  }

  if (!options?.skipMovements) {
    // One movement per line and warehouse (0035: the movements are the line's split, WH-5/WH-6).
    const movements: MovementInput[] = [];
    for (const [i, l] of lines.entries()) {
      if (isGrouped(l.variationId)) continue;
      const base = {
        variationId: l.variationId,
        type: cfg.kind === "sale" ? ("SALE" as const) : ("PURCHASE" as const),
        rate: l.price,
        ratePer: l.ratePer,
        reason: options?.reason ?? number,
        occurredAt: options?.occurredAt ?? docDate,
        ...(cfg.kind === "sale" ? { saleId: doc.id } : { purchaseId: doc.id }),
      };
      const parts: { warehouseId: string | undefined; milli: number }[] = measuredWh.has(l.lineNo)
        ? [...measuredWh.get(l.lineNo)!].map(([warehouseId, milli]) => ({ warehouseId, milli }))
        : body.lines[i]!.splits
          ? body.lines[i]!.splits!.map((s) => ({ warehouseId: s.warehouseId, milli: toMilli(s.quantity) }))
          : [{ warehouseId: header, milli: toMilli(l.quantity) }];
      for (const p of parts) movements.push({ ...base, quantity: (cfg.sign * p.milli) / 1000, warehouseId: p.warehouseId });
    }
    await recordMovements(tx, companyId, actorId, movements, { allowNegative: cfg.kind === "sale" && body.allowNegative, requestId });
  }
  if (saleSetLines.length) setCodes = await sellSets(tx, { companyId, actorId, requestId }, saleRef, saleSetLines);
  if (cfg.kind === "sale") {
    await recordProductSale(tx, companyId, lines.map((line) => line.variationId), docDate);
  }
  if (cfg.kind === "purchase" && party?.id) {
    for (const l of lines) {
      // V3.2 A3: a grouped line updates the supplier's set rate (kept on the grouped product's own
      // variation) like any other line; sets at another rate are another line, the last one wins.
      if (Number(l.price) > 0) {
        await upsertRate(
          tx,
          {
            companyId,
            actorId,
            requestId: body.clientRef ?? null,
            fromPurchase: true,
            supplierName: party.name,
          },
          {
            variationId: l.variationId,
            supplierId: party.id,
            rate: l.price,
            notes: `Auto-updated from Purchase #${number}`,
            effectiveAt: docDate,
          }
        );
      }
    }
  }
  if (body.draftId) {
    await tx.draftOrder.update({ where: { id: body.draftId }, data: { status: "COMPLETED", documentId: doc.id, updatedById: actorId, version: { increment: 1 } } });
  }
  await audit(tx, {
    companyId,
    actorId,
    action: cfg.action,
    entityType: cfg.kind === "sale" ? "Sale" : "Purchase",
    entityId: doc.id,
    after: {
      number,
      party: party?.name ?? null,
      total: fromPaise(subtotal),
      payment,
      lines: lines.map((l) => ({ shortName: l.shortNameSnapshot, quantity: Number(l.quantity), price: l.price, ...(l.discount !== "0.00" ? { discount: l.discount } : {}) })),
      ...(measuredResult ? { measured: measuredResult } : {}),
      ...(setCodes.length ? { sets: setCodes } : {}),
    },
    requestId,
  });
  return doc.id;
}

export const voidBody = z.object({
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(300),
  // Sale cancel (owner rule 2026-10-24): sets whose measured parts come back as free Cut pieces.
  releaseSetIds: z.array(z.string().min(1)).max(500).optional(),
});

/**
 * Voids a sale or purchase (D3, plan §3.1). Nothing is edited or deleted: a void row records who,
 * when and why, and SALE_VOID / PURCHASE_VOID movements reverse the document's stock exactly
 * (checked again by the database at commit). A purchase whose stock has already been sold
 * cannot be voided (the stock check refuses to go below zero).
 */
export async function voidDocument(cfg: KindConfig, ctx: DocContext, id: string, reason: string, opts: { releaseSetIds?: readonly string[] } = {}) {
  const { companyId, actorId, requestId } = ctx;
  const isSale = cfg.kind === "sale";
  try {
    return await prisma.$transaction(async (tx) => {
      // A delivery made from an order: lock the order first (same lock order as fulfilment).
      const order = await lockOrderOfDocument(tx, companyId, cfg.kind, id);
      // Lock the document row so two voids of the same document serialise.
      const rows = isSale
        ? await tx.$queryRaw<{ id: string; number: string }[]>`SELECT id, number FROM sales WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`
        : await tx.$queryRaw<{ id: string; number: string }[]>`SELECT id, number FROM purchases WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`;
      const doc = rows[0];
      if (!doc) throw new AppError(404, "NOT_FOUND", `${isSale ? "Sale" : "Purchase"} not found`);
      const already = await tx.documentVoid.findFirst({ where: isSale ? { saleId: id } : { purchaseId: id }, select: { id: true } });
      if (already) throw new AppError(409, "ALREADY_VOID", `${doc.number} is already cancelled`);

      const original = await tx.stockMovement.groupBy({
        by: ["variationId", "warehouseId"],
        where: { companyId, ...(isSale ? { saleId: id, movementType: "SALE" } : { purchaseId: id, movementType: "PURCHASE" }) },
        _sum: { quantity: true },
      });
      const v = await tx.documentVoid.create({
        data: { companyId, ...(isSale ? { saleId: id } : { purchaseId: id }), reason, createdById: actorId },
        select: { id: true, createdAt: true },
      });
      // Measured items: lengths go back to their pieces (sale), or the untouched rolls are
      // retired (purchase; refused once any roll was opened, cut or sold). V2 plan §2.9.
      const mctx = { companyId, actorId, requestId };
      // V3.1 sets bought on this purchase: refused once any was changed, held or sold (D16).
      const setCodes = isSale ? [] : await cancelPurchaseSets(tx, mctx, { id, number: doc.number });
      const measured = isSale ? await restoreSaleCuts(tx, mctx, { id, number: doc.number }) : await reversePurchaseRolls(tx, mctx, { id, number: doc.number });
      // V3.1 sets sold on this sale come back with the parts they were sold with (D15).
      const setsResult = isSale ? await restoreSaleSets(tx, mctx, { id, number: doc.number }, opts.releaseSetIds ?? []) : { codes: [], released: [] };
      const setsBack = setsResult.codes;
      await recordMovements(
        tx,
        companyId,
        actorId,
        original.map((m) => ({
          variationId: m.variationId,
          warehouseId: m.warehouseId ?? undefined,
          type: isSale ? "SALE_VOID" : "PURCHASE_VOID",
          quantity: -Number(m._sum.quantity ?? 0),
          reason: `VOID ${doc.number}`,
          ...(isSale ? { saleId: id } : { purchaseId: id }),
        })),
        { requestId, sets: setCodes.length > 0 || setsBack.length > 0 },
      );
      if (isSale) await recalculateProductActivityForSale(tx, companyId, id);
      // The order reopens: what this document delivered is outstanding again (plan Q2).
      let orderSync: OrderSyncResult | null = null;
      if (order) {
        orderSync = await syncOrderFromDocuments(tx, companyId, order.id, actorId);
        // V3.1 (D23): sets delivered on this sale are held by the reopened order again.
        if (setsBack.length) {
          const open = ["DRAFT", "PLACED", "ON_DELIVERY", "PARTIALLY_FULFILLED"].includes(orderSync.to);
          await tx.groupSet.updateMany({
            where: { companyId, orderId: order.id, status: "IN_STOCK" },
            data: open ? { status: "HELD" } : { orderId: null, orderLineNo: null },
          });
        }
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            fromStatus: orderSync.from,
            toStatus: orderSync.to,
            note: syncNote(`${doc.number} cancelled, ${isSale ? "items back in stock" : "items taken back out of stock"}`, orderSync),
            createdById: actorId,
          },
        });
      }
      await audit(tx, {
        companyId,
        actorId,
        action: isSale ? "SALE_VOID" : "PURCHASE_VOID",
        entityType: isSale ? "Sale" : "Purchase",
        entityId: id,
        after: {
          number: doc.number,
          reversed: original.map((m) => ({ variationId: m.variationId, quantity: -Number(m._sum.quantity ?? 0) })),
          ...(measured.length ? { measured } : {}),
          ...(setCodes.length ? { setsCancelled: setCodes } : {}),
          ...(setsBack.length ? { setsBackInStock: setsBack } : {}),
          ...(setsResult.released.length ? { setPiecesReleased: setsResult.released } : {}),
          ...(order && orderSync ? { order: { number: order.number, status: orderSync.to, delivered: orderSync.changed } } : {}),
        },
        reason,
        requestId,
      });
      return { id, number: doc.number, voidedAt: v.createdAt };
    }, WRITE_TX);
  } catch (e) {
    if (e instanceof AppError && e.code === "INSUFFICIENT_STOCK") {
      throw new AppError(409, "STOCK_ALREADY_USED", `Cannot cancel this purchase: some of its stock has already been sold or used. ${e.message}`, e.details);
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError(409, "ALREADY_VOID", "This document is already cancelled");
    }
    throw e;
  }
}

async function findByClientRef(cfg: KindConfig, companyId: string, clientRef: string | undefined) {
  if (!clientRef) return null;
  const where = { companyId_clientRef: { companyId, clientRef } };
  const row = cfg.kind === "sale" ? await prisma.sale.findUnique({ where, select: { id: true } }) : await prisma.purchase.findUnique({ where, select: { id: true } });
  return row?.id ?? null;
}

export async function loadParty(tx: Tx, cfg: KindConfig, companyId: string, partyId: string | null) {
  if (!partyId) return null;
  const p = await tx.party.findFirst({ where: { id: partyId, companyId }, select: { id: true, name: true, type: true, active: true } });
  if (!p) throw new AppError(400, "UNKNOWN_PARTY", `That ${cfg.partyLabel} was not found`);
  if (!p.active) throw new AppError(400, "INACTIVE_PARTY", `${p.name} is inactive`);
  if (!cfg.partyTypes.includes(p.type)) throw new AppError(400, "WRONG_PARTY_TYPE", `${p.name} is not a ${cfg.partyLabel}`);
  return p;
}

export const editDocumentBody = documentBody.extend({
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(300),
  expectedNumber: z.string().trim().optional(),
});
export type EditDocumentBody = z.infer<typeof editDocumentBody>;

/**
 * Edits a sale or purchase (plan §1, §3). Implemented as replace: the original is cancelled in a
 * REPLACED void row, and a new document is written with number `<original>-R<n>`.
 */
export async function editDocument(cfg: KindConfig, ctx: DocContext, id: string, body: EditDocumentBody): Promise<{ id: string; number: string; replacedId: string }> {
  const { companyId, actorId, requestId } = ctx;
  const isSale = cfg.kind === "sale";
  const now = new Date();

  if (body.clientRef) {
    const existing = await findByClientRef(cfg, companyId, body.clientRef);
    if (existing) {
      const existingDoc = isSale
        ? await prisma.sale.findUnique({ where: { id: existing }, select: { id: true, number: true, replacesId: true } })
        : await prisma.purchase.findUnique({ where: { id: existing }, select: { id: true, number: true, replacesId: true } });
      if (existingDoc && existingDoc.replacesId === id) {
        return { id: existingDoc.id, number: existingDoc.number, replacedId: id };
      }
    }
  }

  try {
    return await prisma.$transaction(async (tx) => {
      // 0. A delivery made from an order: lock the order first (same lock order as fulfilment).
      const order = await lockOrderOfDocument(tx, companyId, cfg.kind, id);
      // 1. Lock original document
      const rows = isSale
        ? await tx.$queryRaw<{ id: string; number: string; revision: number; sale_date: Date }[]>`
            SELECT id, number, revision, sale_date FROM sales WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`
        : await tx.$queryRaw<{ id: string; number: string; revision: number; purchase_date: Date }[]>`
            SELECT id, number, revision, purchase_date FROM purchases WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`;
      const original = rows[0];
      if (!original) throw new AppError(404, "NOT_FOUND", `${isSale ? "Sale" : "Purchase"} not found`);

      // 2. Check if already voided or replaced
      const alreadyVoid = await tx.documentVoid.findFirst({
        where: isSale ? { saleId: id } : { purchaseId: id },
        select: { id: true, kind: true, replacedBySaleId: true, replacedByPurchaseId: true },
      });
      if (alreadyVoid) {
        if (alreadyVoid.kind === "REPLACED") {
          const latestId = isSale ? alreadyVoid.replacedBySaleId : alreadyVoid.replacedByPurchaseId;
          throw new AppError(409, "ALREADY_REPLACED", `This document has already been edited and replaced`, { latestId });
        }
        throw new AppError(409, "ALREADY_CANCELLED", `${original.number} is cancelled and cannot be edited`);
      }

      // 3. Expected number check
      if (body.expectedNumber && body.expectedNumber !== original.number) {
        throw new AppError(409, "ALREADY_REPLACED", `Document number mismatch: opened ${body.expectedNumber} but current is ${original.number}`);
      }

      // 4. Financial year check
      const origDate: Date = "sale_date" in original ? (original as { sale_date: Date }).sale_date : (original as { purchase_date: Date }).purchase_date;
      const docDate = body.date instanceof Date && !isNaN(body.date.getTime()) ? body.date : origDate;
      if (fiscalYearOf(docDate) !== fiscalYearOf(origDate)) {
        throw new AppError(400, "FY_CHANGE", "Cannot move a document to a different financial year. Cancel and re-enter instead.");
      }

      // 5. Measured items check (Phase 1)
      const origLines = isSale
        ? await tx.saleLine.findMany({ where: { saleId: id }, include: { variation: { include: { group: { select: { productType: true } } } } } })
        : await tx.purchaseLine.findMany({ where: { purchaseId: id }, include: { variation: { include: { group: { select: { productType: true } } } } } });
      // V3.1: a purchase with sets is cancelled and entered again (plan §3). V3.2: a sale with sets
      // is edited — its sets come back in stock as sold and the revision sells them again.
      if (!isSale && origLines.some((l) => l.variation.group.productType === "grouped")) {
        throw new AppError(409, "SETS_NOT_EDITABLE", "Contains sets — cancel and re-enter this document");
      }
      const hasMeasuredOrig = origLines.some((l) => l.variation.group.productType === "measured");
      if (hasMeasuredOrig) {
        throw new AppError(409, "MEASURED_NOT_EDITABLE", "Contains measured items — cancel and re-enter this document");
      }
      const newVariationIds = [...new Set(body.lines.map((l) => l.variationId))];
      const newVariations = await tx.productVariation.findMany({
        where: { companyId, id: { in: newVariationIds } },
        include: { group: { select: { productType: true } } },
      });
      if (!isSale && newVariations.some((v) => v.group.productType === "grouped")) {
        throw new AppError(409, "SETS_NOT_EDITABLE", "Contains sets — cancel and re-enter this document");
      }
      if (newVariations.some((v) => v.group.productType === "measured")) {
        throw new AppError(409, "MEASURED_NOT_EDITABLE", "Contains measured items — cancel and re-enter this document");
      }
      const origSets = isSale ? await tx.groupSet.findMany({ where: { companyId, saleId: id }, select: { id: true, code: true } }) : [];
      if (order) assertSameOrderSets(origSets, body.lines, order.number);

      // The revision stays a delivery of the same order: each kept item keeps its order line
      // (0027). V2 allows only price / discount / note / party / payment changes here; changing
      // what was delivered is "cancel the delivery and deliver again" (order follow-up is V3).
      if (order) assertSameOrderQuantities(origLines, body.lines, order.number);
      const pool = origLines.flatMap((l) => (l.orderLineId ? [{ variationId: l.variationId, orderLineId: l.orderLineId }] : []));
      const orderLink = order
        ? {
            orderId: order.id,
            orderLineIds: body.lines.map((l) => {
              const k = pool.findIndex((p) => p.variationId === l.variationId);
              return k < 0 ? null : pool.splice(k, 1)[0]!.orderLineId;
            }),
          }
        : {};

      // 6. Numbering: derive -R<n>
      const baseNumber = original.number.replace(/-R\d+$/, "");
      const revision = original.revision + 1;
      const newNumber = `${baseNumber}-R${revision}`;

      // 7. Original movements to reverse
      const originalMovements = await tx.stockMovement.groupBy({
        by: ["variationId", "warehouseId"],
        where: { companyId, ...(isSale ? { saleId: id, movementType: "SALE" } : { purchaseId: id, movementType: "PURCHASE" }) },
        _sum: { quantity: true },
      });

      let newDocId: string;

      if (isSale) {
        // Sale edit:
        // V3.2: sets sold on the original come back in stock with the parts they were sold with
        // (measured parts get their length back first), exactly as a cancel does; the revision
        // below sells the sets it lists again, with any new part changes. Sets left out stay in stock.
        const label = `${original.number} edited (${newNumber})`;
        if (origSets.length) {
          const mctx = { companyId, actorId, requestId };
          await restoreSaleCuts(tx, mctx, { id, number: original.number }, label);
          await restoreSaleSets(tx, mctx, { id, number: original.number }, [], label);
        }
        // Reverse original movements (+) first
        await recordMovements(
          tx,
          companyId,
          actorId,
          originalMovements.map((m) => ({
            variationId: m.variationId,
            warehouseId: m.warehouseId ?? undefined,
            type: "SALE_VOID",
            quantity: -Number(m._sum.quantity ?? 0),
            reason: `REPLACED by ${newNumber}`,
            occurredAt: now,
            saleId: id,
          })),
          { requestId, sets: origSets.length > 0 },
        );

        // Then write new sale with SALE movements (-). A set of the original was picked at the
        // version it had when sold; coming back in stock moved it on, so it is not version-checked
        // (the original sale's lock already serialises edits of it).
        const origSetIds = new Set(origSets.map((s) => s.id));
        const revisionBody: EditDocumentBody = {
          ...body,
          lines: body.lines.map((l) => (l.saleSets ? { ...l, saleSets: l.saleSets.map((p) => (origSetIds.has(p.setId) ? { ...p, version: undefined } : p)) } : l)),
        };
        newDocId = await writeDocument(tx, cfg, ctx, revisionBody, {
          number: newNumber,
          replacesId: id,
          revision,
          occurredAt: now,
          reason: `${newNumber} (Edit of ${original.number})`,
          ...orderLink,
        });

        // Insert REPLACED void
        await tx.documentVoid.create({
          data: {
            companyId,
            saleId: id,
            kind: "REPLACED",
            replacedBySaleId: newDocId,
            reason: body.reason,
            createdById: actorId,
          },
        });

        await recalculateProductActivityForSale(tx, companyId, id);
      } else {
        // Purchase edit:
        // Write new purchase with PURCHASE movements (+) first
        newDocId = await writeDocument(tx, cfg, ctx, body, {
          number: newNumber,
          replacesId: id,
          revision,
          occurredAt: now,
          reason: `${newNumber} (Edit of ${original.number})`,
          ...orderLink,
        });

        // Reverse original movements (-) next
        try {
          await recordMovements(
            tx,
            companyId,
            actorId,
            originalMovements.map((m) => ({
              variationId: m.variationId,
              warehouseId: m.warehouseId ?? undefined,
              type: "PURCHASE_VOID",
              quantity: -Number(m._sum.quantity ?? 0),
              reason: `REPLACED by ${newNumber}`,
              occurredAt: now,
              purchaseId: id,
            })),
            { requestId },
          );
        } catch (e) {
          if (e instanceof AppError && e.code === "INSUFFICIENT_STOCK") {
            throw new AppError(409, "STOCK_ALREADY_USED", `Cannot reduce purchase quantity: some stock has already been sold. ${e.message}`, e.details);
          }
          throw e;
        }

        // Insert REPLACED void
        await tx.documentVoid.create({
          data: {
            companyId,
            purchaseId: id,
            kind: "REPLACED",
            replacedByPurchaseId: newDocId,
            reason: body.reason,
            createdById: actorId,
          },
        });
      }

      // The order now points at the revision (quantities are unchanged, so only the link moves).
      if (order) await syncOrderFromDocuments(tx, companyId, order.id, actorId);

      // 8. Audit event SALE_EDIT / PURCHASE_EDIT
      await audit(tx, {
        companyId,
        actorId,
        action: isSale ? "SALE_EDIT" : "PURCHASE_EDIT",
        entityType: isSale ? "Sale" : "Purchase",
        entityId: newDocId,
        before: {
          number: original.number,
          revision: original.revision,
          lines: origLines.map((l) => ({
            variationId: l.variationId,
            shortName: l.shortNameSnapshot,
            quantity: Number(l.quantity),
            price: (isSale ? (l as any).unitPrice : (l as any).unitCost).toFixed(2),
            discount: l.discount.toFixed(2),
          })),
          ...(origSets.length ? { sets: origSets.map((s) => s.code).sort() } : {}),
        },
        after: {
          number: newNumber,
          revision,
          lines: body.lines.map((l) => ({
            variationId: l.variationId,
            quantity: l.quantity,
            price: l.price,
            discount: l.discount ?? "0.00",
            ...(l.saleSets ? { sets: l.saleSets.map((p) => ({ setId: p.setId, changes: p.changes.length })) } : {}),
          })),
        },
        reason: body.reason,
        requestId,
      });

      return { id: newDocId, number: newNumber, replacedId: id };
    }, WRITE_TX);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new AppError(409, "ALREADY_REPLACED", "This document has already been edited");
    }
    throw e;
  }
}

/**
 * A delivery / receipt made from an order keeps the same items and quantities when edited (V2).
 * Changing them would leave the order's delivered quantities behind; the order-aware edit
 * (v2/docs/orders/ORDER-EDIT-AFTER-DELIVERY-PLAN.md steps 3–5) is deferred to V3.
 */
function assertSameOrderQuantities(
  before: { variationId: string; quantity: Prisma.Decimal }[],
  after: { variationId: string; quantity?: string | number | null; saleSets?: readonly unknown[] }[],
  orderNumber: string,
) {
  const sum = (rows: { variationId: string; milli: number }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.variationId, (m.get(r.variationId) ?? 0) + r.milli);
    return m;
  };
  const a = sum(before.map((l) => ({ variationId: l.variationId, milli: toMilli(Number(l.quantity)) })));
  // A set line counts the sets picked (it sends no quantity).
  const qty = (l: (typeof after)[number]) => (l.saleSets ? l.saleSets.length : l.quantity === undefined || l.quantity === null ? 0 : Number(l.quantity));
  const b = sum(after.map((l) => ({ variationId: l.variationId, milli: toMilli(qty(l)) })));
  const same = a.size === b.size && [...a].every(([v, q]) => b.get(v) === q);
  if (!same) {
    throw new AppError(
      409,
      "ORDER_QTY_LOCKED",
      `This was delivered for order ${orderNumber}: items and quantities cannot be changed here. Cancel this document and deliver again from the order (prices, discounts, notes and payment can still be edited).`,
    );
  }
}

/**
 * V3.2: a delivery of a sale order sells the sets the order held. Its revision keeps exactly those
 * sets (their parts may still be changed); other sets → cancel the delivery and deliver again.
 */
function assertSameOrderSets(origSets: readonly { id: string }[], lines: DocumentBody["lines"], orderNumber: string) {
  const before = origSets.map((s) => s.id).sort();
  const after = lines.flatMap((l) => (l.saleSets ?? []).map((p) => p.setId)).sort();
  if (before.length !== after.length || before.some((x, i) => x !== after[i])) {
    throw new AppError(
      409,
      "ORDER_SETS_LOCKED",
      `This was delivered for order ${orderNumber}: the sets delivered cannot be swapped here. Cancel this document and deliver again from the order (parts, prices, discounts, notes and payment can still be edited).`,
    );
  }
}

/**
 * Previews the diff (lines, totals, stock delta) for editing a document without committing changes.
 */
export async function previewEditDocument(cfg: KindConfig, ctx: DocContext, id: string, body: DocumentBody) {
  const { companyId } = ctx;
  const isSale = cfg.kind === "sale";

  const original = isSale
    ? await prisma.sale.findFirst({
        where: { id, companyId },
        include: {
          void: { select: { kind: true } },
          lines: {
            include: {
              variation: {
                include: {
                  group: { select: { name: true, unit: true, productType: true } },
                },
              },
            },
          },
        },
      })
    : await prisma.purchase.findFirst({
        where: { id, companyId },
        include: {
          void: { select: { kind: true } },
          lines: {
            include: {
              variation: {
                include: {
                  group: { select: { name: true, unit: true, productType: true } },
                },
              },
            },
          },
        },
      });

  if (!original) throw new AppError(404, "NOT_FOUND", `${isSale ? "Sale" : "Purchase"} not found`);
  if (original.void) {
    if (original.void.kind === "REPLACED") throw new AppError(409, "ALREADY_REPLACED", "This document has already been edited and replaced");
    throw new AppError(409, "ALREADY_CANCELLED", `${original.number} is cancelled and cannot be edited`);
  }

  if (!isSale && original.lines.some((l) => l.variation.group.productType === "grouped")) {
    throw new AppError(409, "SETS_NOT_EDITABLE", "Contains sets — cancel and re-enter this document");
  }
  if (original.lines.some((l) => l.variation.group.productType === "measured")) {
    throw new AppError(409, "MEASURED_NOT_EDITABLE", "Contains measured items — cancel and re-enter this document");
  }
  const origSets = isSale ? await prisma.groupSet.findMany({ where: { companyId, saleId: id }, select: { id: true, code: true } }) : [];
  if (original.orderId) {
    const order = await prisma.order.findFirst({ where: { id: original.orderId, companyId }, select: { number: true } });
    assertSameOrderQuantities(original.lines, body.lines, order?.number ?? "its order");
    assertSameOrderSets(origSets, body.lines, order?.number ?? "its order");
  }

  const origDate = isSale ? (original as any).saleDate : (original as any).purchaseDate;
  const docDate = body.date instanceof Date && !isNaN(body.date.getTime()) ? body.date : origDate;
  if (fiscalYearOf(docDate) !== fiscalYearOf(origDate)) {
    throw new AppError(400, "FY_CHANGE", "Cannot move a document to a different financial year. Cancel and re-enter instead.");
  }

  const newIds = [...new Set(body.lines.map((l) => l.variationId))];
  const variations = await prisma.productVariation.findMany({
    where: { companyId, id: { in: newIds } },
    include: { group: { select: { name: true, unit: true, productType: true } } },
  });
  if (!isSale && variations.some((v) => v.group.productType === "grouped")) {
    throw new AppError(409, "SETS_NOT_EDITABLE", "Contains sets — cancel and re-enter this document");
  }
  if (variations.some((v) => v.group.productType === "measured")) {
    throw new AppError(409, "MEASURED_NOT_EDITABLE", "Contains measured items — cancel and re-enter this document");
  }
  const byId = new Map(variations.map((v) => [v.id, v]));
  // V3.2: a grouped product may be on several lines (one per set price): compared as one row,
  // price = average per set.
  const groupedIds = new Set([
    ...variations.filter((v) => v.group.productType === "grouped").map((v) => v.id),
    ...original.lines.filter((l) => l.variation.group.productType === "grouped").map((l) => l.variationId),
  ]);
  const addRow = (
    map: Map<string, { qty: number; price: string; discount: string; total: string; name: string; shortName: string; unit: string }>,
    variationId: string,
    row: { qty: number; price: string; discount: string; total: string; name: string; shortName: string; unit: string },
  ) => {
    const prev = map.get(variationId);
    if (!prev || !groupedIds.has(variationId)) return void map.set(variationId, row);
    const qty = prev.qty + row.qty;
    const total = toPaise(prev.total) + toPaise(row.total);
    const discount = toPaise(prev.discount) + toPaise(row.discount);
    map.set(variationId, { ...prev, qty, total: fromPaise(total), discount: fromPaise(discount), price: fromPaise(qty > 0 ? (total + discount) / BigInt(Math.round(qty)) : 0n) });
  };

  const oldMap = new Map<string, { qty: number; price: string; discount: string; total: string; name: string; shortName: string; unit: string }>();
  for (const l of original.lines) {
    const priceStr = (isSale ? (l as any).unitPrice : (l as any).unitCost).toFixed(2);
    addRow(oldMap, l.variationId, {
      qty: Number(l.quantity),
      price: priceStr,
      discount: l.discount.toFixed(2),
      total: l.lineTotal.toFixed(2),
      name: l.productNameSnapshot,
      shortName: l.shortNameSnapshot,
      unit: l.unit,
    });
  }

  const newMap = new Map<string, { qty: number; price: string; discount: string; total: string; name: string; shortName: string; unit: string }>();
  let newSubtotal = 0n;
  for (const l of body.lines) {
    const v = byId.get(l.variationId);
    if (!v) continue;
    // A set line's quantity is the number of sets picked.
    const qty = l.saleSets?.length ?? l.quantity ?? 0;
    const pricePaise = toPaise(l.price);
    const gross = (BigInt(Math.round(qty * 1000)) * pricePaise) / 1000n;
    const disc = l.discount ? toPaise(l.discount) : 0n;
    const lineTot = gross - disc;
    newSubtotal += lineTot;
    addRow(newMap, l.variationId, {
      qty,
      price: fromPaise(pricePaise),
      discount: fromPaise(disc),
      total: fromPaise(lineTot),
      name: v.group.name,
      shortName: v.shortName,
      unit: v.group.unit,
    });
  }

  const allVarIds = [...new Set([...oldMap.keys(), ...newMap.keys()])];
  const lines: any[] = [];
  for (const varId of allVarIds) {
    const oldVal = oldMap.get(varId);
    const newVal = newMap.get(varId);
    let change: "added" | "removed" | "changed" | "same" = "same";
    if (!oldVal && newVal) change = "added";
    else if (oldVal && !newVal) change = "removed";
    else if (oldVal && newVal) {
      if (oldVal.qty !== newVal.qty || oldVal.price !== newVal.price || oldVal.discount !== newVal.discount) {
        change = "changed";
      }
    }
    const ref = newVal ?? oldVal!;
    lines.push({
      variationId: varId,
      productName: ref.name,
      shortName: ref.shortName,
      unit: ref.unit,
      change,
      before: oldVal ? { quantity: oldVal.qty, price: oldVal.price, discount: oldVal.discount, lineTotal: oldVal.total } : undefined,
      after: newVal ? { quantity: newVal.qty, price: newVal.price, discount: newVal.discount, lineTotal: newVal.total } : undefined,
    });
  }

  const balances = await prisma.stockBalance.findMany({
    where: { companyId, variationId: { in: allVarIds } },
  });
  const balanceMap = new Map(balances.map((b) => [b.variationId, Number(b.quantity)]));

  const stock: any[] = [];
  let hasStockWarning = false;
  for (const varId of allVarIds) {
    // A grouped product has no stock of its own: its sets are listed below instead.
    if (groupedIds.has(varId)) continue;
    const oldQty = oldMap.get(varId)?.qty ?? 0;
    const newQty = newMap.get(varId)?.qty ?? 0;
    const currentBalance = balanceMap.get(varId) ?? 0;
    const delta = isSale ? oldQty - newQty : newQty - oldQty;
    const afterBalance = currentBalance + delta;
    const belowZero = afterBalance < 0;
    if (belowZero) hasStockWarning = true;
    const ref = newMap.get(varId) ?? oldMap.get(varId)!;
    stock.push({
      variationId: varId,
      productName: ref.name,
      shortName: ref.shortName,
      unit: ref.unit,
      delta,
      currentBalance,
      afterBalance,
      belowZero,
    });
  }

  const baseNumber = original.number.replace(/-R\d+$/, "");
  const revision = original.revision + 1;
  const newNumber = `${baseNumber}-R${revision}`;

  return {
    originalNumber: original.number,
    newNumber,
    revision,
    lines,
    totals: {
      before: { subtotal: original.subtotal.toFixed(2), total: original.total.toFixed(2) },
      after: { subtotal: fromPaise(newSubtotal), total: fromPaise(newSubtotal) },
    },
    stock,
    hasStockWarning,
    // V3.2: sets of the original not on the revision come back in stock; sets new on it are sold.
    ...(groupedIds.size ? { sets: await previewSets(companyId, origSets, body.lines) } : {}),
  };
}

async function previewSets(companyId: string, origSets: readonly { id: string; code: string }[], lines: DocumentBody["lines"]) {
  const picks = lines.flatMap((l) => l.saleSets ?? []);
  const was = new Set(origSets.map((s) => s.id));
  const now = new Set(picks.map((p) => p.setId));
  const added = await prisma.groupSet.findMany({ where: { companyId, id: { in: [...now].filter((x) => !was.has(x)) } }, select: { code: true } });
  return {
    kept: origSets.filter((s) => now.has(s.id)).length,
    backInStock: origSets.filter((s) => !now.has(s.id)).map((s) => s.code).sort(),
    newlySold: added.map((s) => s.code).sort(),
    partChanges: picks.reduce((n, p) => n + (p.changes?.length ?? 0), 0),
  };
}

/**
 * Returns the entire revision chain for a document (oldest first).
 */
export async function getRevisionChain(isSale: boolean, companyId: string, docId: string) {
  let currentId = docId;
  const visited = new Set<string>();

  while (true) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const prev = isSale
      ? await prisma.sale.findFirst({ where: { id: currentId, companyId }, select: { id: true, replacesId: true } })
      : await prisma.purchase.findFirst({ where: { id: currentId, companyId }, select: { id: true, replacesId: true } });
    if (!prev || !prev.replacesId) break;
    currentId = prev.replacesId;
  }

  const rootId = currentId;
  const chain: { id: string; number: string; revision: number; date: Date; total: string; by: string | null; reason: string | null; status: "COMPLETED" | "CANCELLED" | "REPLACED" }[] = [];
  let nextId: string | null = rootId;
  const forwardVisited = new Set<string>();

  while (nextId) {
    const currentDocId: string = nextId;
    if (forwardVisited.has(currentDocId)) break;
    forwardVisited.add(currentDocId);
    let docNumber: string;
    let docRevision: number;
    let docDate: Date;
    let docTotal: Prisma.Decimal;
    let docCreatedById: string;
    let docVoidReason: string | null = null;
    let docStatus: "COMPLETED" | "CANCELLED" | "REPLACED" = "COMPLETED";
    let nextReplacedId: string | null = null;

    if (isSale) {
      const s = await prisma.sale.findFirst({
        where: { id: currentDocId, companyId },
        select: {
          id: true,
          number: true,
          revision: true,
          saleDate: true,
          total: true,
          createdById: true,
          void: { select: { reason: true, kind: true, replacedBySaleId: true } },
        },
      });
      if (!s) break;
      docNumber = s.number;
      docRevision = s.revision;
      docDate = s.saleDate;
      docTotal = s.total;
      docCreatedById = s.createdById;
      docVoidReason = s.void?.reason ?? null;
      if (s.void) docStatus = s.void.kind === "REPLACED" ? "REPLACED" : "CANCELLED";
      nextReplacedId = s.void?.kind === "REPLACED" ? s.void.replacedBySaleId : null;
    } else {
      const p = await prisma.purchase.findFirst({
        where: { id: currentDocId, companyId },
        select: {
          id: true,
          number: true,
          revision: true,
          purchaseDate: true,
          total: true,
          createdById: true,
          void: { select: { reason: true, kind: true, replacedByPurchaseId: true } },
        },
      });
      if (!p) break;
      docNumber = p.number;
      docRevision = p.revision;
      docDate = p.purchaseDate;
      docTotal = p.total;
      docCreatedById = p.createdById;
      docVoidReason = p.void?.reason ?? null;
      if (p.void) docStatus = p.void.kind === "REPLACED" ? "REPLACED" : "CANCELLED";
      nextReplacedId = p.void?.kind === "REPLACED" ? p.void.replacedByPurchaseId : null;
    }

    const user = await prisma.user.findUnique({ where: { id: docCreatedById }, select: { name: true } });
    chain.push({
      id: nextId,
      number: docNumber,
      revision: docRevision,
      date: docDate,
      total: docTotal.toFixed(2),
      by: user?.name ?? null,
      reason: docVoidReason,
      status: docStatus,
    });
    nextId = nextReplacedId;
  }

  return chain;
}
