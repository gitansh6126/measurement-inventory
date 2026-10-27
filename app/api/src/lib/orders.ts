import { Prisma, type OrderKind, type OrderStatus, type Role } from "@prisma/client";
import { formatLength, planCuts, ratePerOf, toMilli, type PlanRequest } from "@rs-v31/shared/measure";
import { z } from "zod";
import { prisma, WRITE_TX, type Tx } from "../db.js";
import { audit } from "./audit.js";
import { fromPaise, lineGrossPaise, lineQuantity, loadParty, PURCHASE, SALE, toPaise, writeDocument, type DocContext } from "./documents.js";
import { AppError } from "./errors.js";
import { activePieces, dec, milliOf, num, rollInput } from "./measure.js";
import { syncOrderFromDocuments } from "./order-sync.js";
import { nextDocNumber } from "./numbering.js";
import { can, type Permission } from "./permissions.js";
import { checkSetRows, holdOrderSets, releaseOrderSets, saleSetInput, setInput, unholdForDelivery, type SaleSetInput } from "./sets.js";
import { lockVariations, money } from "./stock.js";
import { isWarehousingOn, requireWarehouse, splitsInput, validateSplits, type Split } from "./warehouses.js";
import { bumpVersion, versionField } from "./versions.js";

// Sale and purchase orders (v2/docs/orders/ORDER-LIFECYCLE-PLAN.md).
// DRAFT → PLACED → ON_DELIVERY → COMPLETED, CANCELLED from any open state. An order never moves
// stock: completing it creates the normal Sale / Purchase through writeDocument in the same
// transaction, so every stock, price and negative-stock rule of the checkout applies unchanged.
//
// Measured items (0022, v2.1): a line's quantity is a length (3 decimals) and one Measured
// variation may have several lines, as on documents. A sale-order line may name the piece the
// seller chose (a preference, re-planned at completion); a purchase-order line carries the rolls
// expected, each length typed, and its quantity is their sum. Both reach writeDocument unchanged.

const MAX_PAISE = 99_999_999_999_999n;

/**
 * Status changes through POST /:id/status. Completion and cancellation have their own calls.
 * Once part of an order is fulfilled it can never go back to Draft / Placed (its items would
 * become editable and the delivered quantities lost); "back" from On delivery returns it to
 * Partially fulfilled instead (checked in moveOrder).
 */
export const MOVES: Partial<Record<OrderStatus, OrderStatus[]>> = {
  DRAFT: ["PLACED"],
  PLACED: ["DRAFT", "ON_DELIVERY"],
  ON_DELIVERY: ["PLACED", "PARTIALLY_FULFILLED"],
  PARTIALLY_FULFILLED: ["ON_DELIVERY"],
};
export const COMPLETABLE: OrderStatus[] = ["PLACED", "ON_DELIVERY", "PARTIALLY_FULFILLED"];
export const OPEN: OrderStatus[] = ["DRAFT", "PLACED", "ON_DELIVERY", "PARTIALLY_FULFILLED"];
/** Items, party and expected date can change only before dispatch. */
const EDITABLE: OrderStatus[] = ["DRAFT", "PLACED"];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const orderLine = z.object({
  variationId: z.string().min(1),
  // Whole for counted items (checked per line once the item is known, and by 0022); a length for
  // Measured items. A Measured purchase-order line may omit it: the line is the sum of its rolls.
  quantity: lineQuantity.optional(),
  price: money,
  discount: money.optional(),
  note: text(300),
  // Measured sale-order lines: the piece chosen in the drawer (else the first in DM-5 order).
  pieceId: z
    .string()
    .min(1)
    .nullish()
    .transform((v) => v ?? null),
  // Measured purchase-order lines: one entry per roll expected, each length typed.
  rolls: z.array(rollInput).min(1).max(500).optional(),
  linkedOrderId: z.string().min(1).nullish().transform((v) => v ?? null),
  linkedOrderLineId: z.string().min(1).nullish().transform((v) => v ?? null),
  // V3.1 (WH-13): sale-order counted lines — the Take-from split chosen when the line was added;
  // omitted / null = "Decide at delivery". Re-checked against live stock on delivery.
  splits: splitsInput.nullish(),
  // V3.1 grouped lines (0037). Purchase order: the sets expected (optional — they may be entered
  // when received); sale order: the sets picked from stock, held by the order (D23), with the part
  // changes planned for delivery.
  sets: z.array(setInput.extend({ rate: money.optional() })).min(1).max(100).optional(),
  saleSets: z.array(saleSetInput).min(1).max(100).optional(),
});
const lines = z.array(orderLine).min(1, "Add at least one item").max(200, "At most 200 lines per order");

export const createOrderBody = z.object({
  kind: z.enum(["SALE", "PURCHASE"]),
  status: z.enum(["DRAFT", "PLACED"]).default("DRAFT"),
  partyId: z.string().min(1).nullish().transform((v) => v ?? null),
  notes: text(500),
  expectedDate: day.nullish().transform((v) => v ?? null),
  deliveryAddress: text(300),
  deliveryNote: text(300),
  // V3.1 (WH-13): purchase order — preferred warehouse; pre-fills "Receive into".
  warehouseId: z.string().min(1).nullish().transform((v) => v ?? null),
  lines,
  // Client-generated per save; a repeated submit returns the same order.
  clientRef: z.string().uuid().optional(),
});

export const updateOrderBody = z.object({
  partyId: z.string().min(1).nullable().optional(),
  notes: text(500).optional(),
  expectedDate: day.nullable().optional(),
  deliveryAddress: text(300).optional(),
  deliveryNote: text(300).optional(),
  warehouseId: z.string().min(1).nullable().optional(),
  lines: lines.optional(),
  version: versionField,
});

export const statusBody = z.object({
  to: z.enum(["DRAFT", "PLACED", "ON_DELIVERY", "PARTIALLY_FULFILLED"]),
  note: text(300),
  // Dispatch usually records how it goes out (vehicle, transporter, tracking).
  deliveryNote: text(300).optional(),
  version: versionField,
});

export const completeBody = z.object({
  paymentMode: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CREDIT"]).nullish(),
  amountPaid: money.nullish(),
  allowNegative: z.boolean().optional().default(false),
  version: versionField,
});

export const fulfillOrderBody = z.object({
  paymentMode: z.enum(["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CREDIT"]).nullish(),
  amountPaid: money.nullish(),
  allowNegative: z.boolean().optional().default(false),
  version: versionField,
  lines: z
    .array(
      z.object({
        orderLineId: z.string().min(1),
        quantity: lineQuantity.optional(),
        pieceId: z.string().min(1).nullish(),
        // V3.1: Take-from split for this delivery (counted sale lines); else the saved one or auto.
        splits: splitsInput.optional(),
        // V3.1: purchase-order set line — the sets received now (else the sets entered on the order).
        sets: z.array(setInput.extend({ rate: money.optional() })).min(1).max(100).optional(),
      }),
    )
    .optional(),
  // V3.1: purchase receipt "Receive into"; default = the order's preferred warehouse.
  warehouseId: z.string().min(1).nullish(),
});

export const arrangePurchaseBody = z.object({
  partyId: z.string().min(1, "Select a supplier"),
  expectedDate: day.nullish().transform((v) => v ?? null),
  deliveryAddress: text(300),
  deliveryNote: text(300),
  notes: text(500),
  lines: z
    .array(
      z.object({
        orderLineId: z.string().min(1),
        price: money,
        discount: money.optional(),
        rolls: z.array(rollInput).min(1, "Enter at least one roll"),
      }),
    )
    .min(1, "At least one item required"),
  version: versionField,
});

export const cancelBody = z.object({
  reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(300),
  version: versionField,
});

export interface OrderContext extends DocContext {
  role: Role;
}

const cfgFor = (kind: OrderKind) => (kind === "SALE" ? SALE : PURCHASE);

/** Per-kind permission: sale orders follow sale.*, purchase orders purchase.* (plan §3). */
export function orderPermission(kind: OrderKind, action: "view" | "create" | "void"): Permission {
  return `${kind === "SALE" ? "sale" : "purchase"}.${action}` as Permission;
}

export function assertCan(role: Role, kind: OrderKind, action: "view" | "create" | "void") {
  if (!can(role, orderPermission(kind, action))) throw new AppError(403, "FORBIDDEN", "You do not have permission for this action");
}

/** Validates lines against the live catalog and computes totals (whole paise). */
async function priceLines(tx: Tx, companyId: string, kind: OrderKind, input: z.infer<typeof orderLine>[]) {
  const ids = [...new Set(input.map((l) => l.variationId))];
  const variations = await tx.productVariation.findMany({
    where: { companyId, id: { in: ids } },
    select: { id: true, active: true, shortName: true, groupId: true, group: { select: { name: true, active: true, productType: true, lengthUnit: true } } },
  });
  const byId = new Map(variations.map((v) => [v.id, v]));
  // A counted item appears once per order; a Measured variation may repeat (0022, like 0021), and
  // so may a grouped product (one line per set price, 0037).
  const counted = input.map((l) => l.variationId).filter((id) => !["measured", "grouped"].includes(byId.get(id)?.group.productType ?? ""));
  // V3.1 grouped lines: what goes into order_lines.sets, and the sets a sale order holds.
  const setLines: { lineNo: number; groupId: string; json: unknown[] | null; saleSets: SaleSetInput[] | null }[] = [];
  if (new Set(counted).size !== counted.length) throw new AppError(400, "DUPLICATE_LINE", "The same item appears twice; change its quantity instead");
  const pieceIds = [...new Set(input.flatMap((l) => (l.pieceId ? [l.pieceId] : [])))];
  const pieces = pieceIds.length
    ? await tx.measurementPiece.findMany({ where: { companyId, id: { in: pieceIds } }, select: { id: true, variationId: true, status: true } })
    : [];
  const pieceById = new Map(pieces.map((p) => [p.id, p]));
  // V3.1 (WH-13): saved splits need warehousing on and warehouses of this company.
  if (input.some((l) => l.splits)) {
    if (!(await isWarehousingOn(tx, companyId))) throw new AppError(400, "WAREHOUSING_OFF", "Warehousing is not set up yet");
    for (const w of new Set(input.flatMap((l) => (l.splits ?? []).map((s) => s.warehouseId)))) await requireWarehouse(tx, companyId, w);
  }
  // Purchase-order lines bought for a customer order (its shortages, from the purchase cart): the
  // sale-order line must be one of this company's sale orders.
  if (input.some((l) => l.linkedOrderId || l.linkedOrderLineId)) {
    if (kind !== "PURCHASE") throw new AppError(400, "BAD_LINK", "Only purchase-order lines can be bought for a customer order");
    const linkIds = [...new Set(input.flatMap((l) => (l.linkedOrderLineId ? [l.linkedOrderLineId] : [])))];
    const linked = await tx.orderLine.findMany({ where: { id: { in: linkIds }, order: { companyId, kind: "SALE" } }, select: { id: true, orderId: true } });
    const orderOf = new Map(linked.map((x) => [x.id, x.orderId]));
    for (const l of input) {
      if ((l.linkedOrderId || l.linkedOrderLineId) && (!l.linkedOrderLineId || orderOf.get(l.linkedOrderLineId) !== l.linkedOrderId)) {
        throw new AppError(400, "BAD_LINK", "The customer order line this item is bought for was not found");
      }
    }
  }
  // Purchase-order sets entered now are checked now; the sets themselves are created on receipt.
  for (const l of input) {
    const v = byId.get(l.variationId);
    if (kind === "PURCHASE" && l.sets && v?.group.productType === "grouped") await checkSetRows(tx, companyId, v.groupId, l.sets.map((s) => ({ ...s, rate: l.price })));
  }
  let subtotal = 0n;
  const rows = input.map((l, i) => {
    const v = byId.get(l.variationId);
    if (!v) throw new AppError(400, "UNKNOWN_ITEM", `Line ${i + 1}: item not found`);
    if (!v.active || !v.group.active) throw new AppError(400, "INACTIVE_ITEM", `${v.group.name} ${v.shortName} is archived`);
    const measured = v.group.productType === "measured";
    const grouped = v.group.productType === "grouped";
    const name = `${v.group.name} ${v.shortName}`;
    let qtyMilli = l.quantity === undefined ? 0 : toMilli(l.quantity);
    let rolls: Prisma.InputJsonValue | undefined;
    if (!grouped && (l.sets || l.saleSets)) throw new AppError(400, "NOT_GROUPED", `${name} is not a grouped product`);
    if (grouped) {
      if (l.splits || l.pieceId || l.rolls) throw new AppError(400, "BAD_LINE", `${v.group.name}: a set line carries sets only`);
      if (kind === "SALE") {
        // D23: the sets are picked when the order is taken and held by it.
        if (l.sets) throw new AppError(400, "BAD_LINE", `${v.group.name}: a sale order picks sets from stock`);
        if (!l.saleSets?.length) throw new AppError(400, "SETS_REQUIRED", `${v.group.name}: pick the sets for this order`);
        if (l.quantity !== undefined && qtyMilli !== l.saleSets.length * 1000) throw new AppError(400, "SETS_TOTAL", `${v.group.name}: ${l.saleSets.length} set${l.saleSets.length === 1 ? "" : "s"} picked, not ${l.quantity}`);
        qtyMilli = l.saleSets.length * 1000;
        // Stored as entered (lengths in base units, not milli): delivery and the order page read it
        // back through saleSetInput, which converts again.
        setLines.push({ lineNo: i + 1, groupId: v.groupId, json: l.saleSets.map((s) => ({ setId: s.setId, changes: s.changes.map((c) => (c.length !== undefined ? { ...c, length: c.length / 1000 } : c)) })), saleSets: l.saleSets });
      } else {
        if (l.saleSets) throw new AppError(400, "BAD_LINE", `${v.group.name}: a purchase order expects new sets`);
        if (l.sets) {
          if (l.quantity !== undefined && qtyMilli !== l.sets.length * 1000) throw new AppError(400, "SETS_TOTAL", `${v.group.name}: ${l.sets.length} set${l.sets.length === 1 ? "" : "s"} entered, not ${l.quantity}`);
          if (l.sets.some((s) => s.rate !== undefined && toPaise(s.rate) !== toPaise(l.price))) {
            throw new AppError(400, "SET_RATE_MISMATCH", `${v.group.name}: sets on one line share its rate; put sets at another rate on another line`);
          }
          qtyMilli = l.sets.length * 1000;
          setLines.push({ lineNo: i + 1, groupId: v.groupId, json: l.sets.map(({ rate: _, ...s }) => s), saleSets: null });
        } else if (l.quantity === undefined) {
          throw new AppError(400, "QUANTITY_REQUIRED", `${v.group.name}: enter the number of sets, or the sets expected`);
        }
      }
    }
    if (l.splits) {
      if (kind !== "SALE" || measured) throw new AppError(400, "BAD_LINE", `${name}: a warehouse split is for counted items on sale orders`);
      if (l.quantity !== undefined) validateSplits(name, l.quantity, l.splits);
    }
    if (!measured) {
      // A set line's quantity is the number of sets it carries (above).
      if (l.quantity === undefined && !(grouped && qtyMilli > 0)) throw new AppError(400, "QUANTITY_REQUIRED", `Line ${i + 1}: enter a quantity`);
      if (qtyMilli % 1000 !== 0) throw new AppError(400, "WHOLE_QUANTITY", `${name}: quantity must be a whole number`);
      if (l.pieceId || l.rolls) throw new AppError(400, "NOT_MEASURED", `${name} is not sold by length`);
    } else if (kind === "PURCHASE") {
      if (!l.rolls?.length) throw new AppError(400, "ROLLS_REQUIRED", `${name}: enter the length of each roll expected`);
      if (l.pieceId) throw new AppError(400, "BAD_LINE", `${name}: a purchase order receives rolls, it does not cut them`);
      const sum = l.rolls.reduce((t, r) => t + r.length, 0);
      if (l.quantity !== undefined && qtyMilli !== sum) {
        const unit = v.group.lengthUnit ?? "m";
        throw new AppError(400, "ROLLS_TOTAL", `${name}: the rolls add up to ${formatLength(sum, unit)}, not ${formatLength(qtyMilli, unit)}`);
      }
      qtyMilli = sum;
      // Stored as typed (length in base units) and parsed again by rollInput at completion.
      rolls = l.rolls.map((r) => ({
        length: num(r.length),
        kind: r.kind,
        ...(r.supplierRollNo ? { supplierRollNo: r.supplierRollNo } : {}),
        ...(r.rack ? { rack: r.rack } : {}),
        ...(r.notes ? { notes: r.notes } : {}),
      }));
    } else {
      if (l.quantity === undefined) throw new AppError(400, "QUANTITY_REQUIRED", `Line ${i + 1}: enter the length`);
      if (l.rolls) throw new AppError(400, "BAD_LINE", `${name}: rolls are entered on purchase orders`);
      if (l.pieceId) {
        const p = pieceById.get(l.pieceId);
        if (!p || p.variationId !== v.id) throw new AppError(400, "UNKNOWN_PIECE", `${name}: the chosen piece was not found`);
        if (p.status !== "ACTIVE") throw new AppError(409, "PIECE_CHANGED", `${name}: the chosen piece is used up. Choose the piece again.`);
      }
    }
    // Measured rates are per rate unit (per ft on a feet + inches product, 0028).
    const ratePer = measured ? ratePerOf(v.group.lengthUnit) : 1;
    const gross = lineGrossPaise(qtyMilli, toPaise(l.price), ratePer);
    if (gross > MAX_PAISE) throw new AppError(400, "AMOUNT_TOO_LARGE", `Line ${i + 1}: amount is too large`);
    const discount = l.discount ? toPaise(l.discount) : 0n;
    if (discount > gross) throw new AppError(400, "DISCOUNT_TOO_LARGE", `Line ${i + 1}: discount is more than the line amount`);
    subtotal += gross - discount;
    return {
      lineNo: i + 1,
      variationId: l.variationId,
      quantity: dec(qtyMilli),
      price: fromPaise(toPaise(l.price)),
      ratePer,
      discount: fromPaise(discount),
      note: l.note,
      lineTotal: fromPaise(gross - discount),
      pieceId: measured && kind === "SALE" ? l.pieceId : null,
      ...(rolls ? { rolls } : {}),
      ...(l.splits ? { splits: l.splits as unknown as Prisma.InputJsonValue } : {}),
      ...(l.linkedOrderId ? { linkedOrderId: l.linkedOrderId } : {}),
      ...(l.linkedOrderLineId ? { linkedOrderLineId: l.linkedOrderLineId } : {}),
    };
  });
  if (subtotal > MAX_PAISE) throw new AppError(400, "AMOUNT_TOO_LARGE", "Order total is too large");
  return { rows, subtotal: fromPaise(subtotal), lineCount: rows.length, setLines };
}

/**
 * V3.1 (0037): writes order_lines.sets and, for a sale order, holds the picked sets (D23). The
 * column is written with SQL so this works with a Prisma client generated before 0037.
 */
async function saveOrderSets(tx: Tx, ctx: OrderContext, order: { id: string; number: string; kind: OrderKind }, priced: Awaited<ReturnType<typeof priceLines>>, previouslyHeld: string[] = []) {
  for (const s of priced.setLines) {
    if (s.json) await tx.$executeRaw`UPDATE order_lines SET sets = ${JSON.stringify(s.json)}::jsonb WHERE order_id = ${order.id} AND line_no = ${s.lineNo}`;
  }
  if (order.kind === "SALE") {
    await holdOrderSets(
      tx,
      ctx,
      order,
      priced.setLines.flatMap((s) => (s.saleSets ? [{ lineNo: s.lineNo, groupId: s.groupId, sets: s.saleSets }] : [])),
      previouslyHeld,
    );
  }
}

/** order_lines.sets by line id (0037; read with SQL, see saveOrderSets). */
export async function orderLineSets(db: Pick<Tx, "$queryRaw">, orderId: string) {
  const rows = await db.$queryRaw<{ id: string; sets: unknown }[]>`SELECT id, sets FROM order_lines WHERE order_id = ${orderId} AND sets IS NOT NULL`;
  return new Map(rows.map((r) => [r.id, r.sets as unknown[]]));
}

/**
 * Sale orders: the piece chosen when the order was taken is a preference, not a reservation (an
 * open order holds no stock, plan O4). At completion a preferred piece that can no longer give its
 * line's length, after the lines before it, is dropped so the cut plan picks the next piece in
 * DM-5 order. Returns the piece per line (by index) and the line numbers re-planned.
 */
async function preferredPieces(tx: Tx, companyId: string, lines: { variationId: string; quantity: Prisma.Decimal; pieceId: string | null; measured: boolean }[]) {
  const requests: PlanRequest[] = lines.flatMap((l, i) =>
    l.measured ? [{ key: String(i + 1), variationId: l.variationId, lengthMilli: milliOf(l.quantity), pieceId: l.pieceId }] : [],
  );
  const replanned: number[] = [];
  if (requests.some((r) => r.pieceId)) {
    const ids = [...new Set(requests.map((r) => r.variationId))];
    await lockVariations(tx, companyId, ids);
    const pieces = await activePieces(tx, companyId, ids);
    for (;;) {
      const bad = planCuts(requests, pieces).problems.filter((p) => requests.find((r) => r.key === p.key)!.pieceId);
      if (!bad.length) break;
      for (const p of bad) {
        requests.find((r) => r.key === p.key)!.pieceId = null;
        replanned.push(Number(p.key));
      }
    }
  }
  const byKey = new Map(requests.map((r) => [r.key, r.pieceId ?? null]));
  return { pieceFor: (index: number) => byKey.get(String(index + 1)) ?? null, replanned: replanned.sort((a, b) => a - b) };
}

async function lockOrder(tx: Tx, companyId: string, id: string, version: number | undefined) {
  const rows = await tx.$queryRaw<{ id: string; kind: OrderKind; status: OrderStatus; number: string; version: number; document_id: string | null }[]>`
    SELECT id, kind, status, number, version, document_id FROM orders WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`;
  const o = rows[0];
  if (!o) throw new AppError(404, "NOT_FOUND", "Order not found");
  return {
    ...o,
    checkVersion() {
      if (version !== undefined && o.version !== version) {
        throw new AppError(409, "VERSION_CONFLICT", `${o.number} was changed by someone else. Reload to see the latest, then try again.`, { currentVersion: o.version });
      }
    },
  };
}

/** True once any line has been delivered / received through a fulfilment. */
async function hasFulfilled(tx: Tx, orderId: string) {
  return (await tx.orderLine.count({ where: { orderId, fulfilledQuantity: { gt: 0 } } })) > 0;
}

const closedError = (number: string, status: OrderStatus) =>
  new AppError(409, "ORDER_CLOSED", `${number} is ${status === "COMPLETED" ? "already completed" : "cancelled"}`);

export async function createOrder(ctx: OrderContext, body: z.infer<typeof createOrderBody>) {
  const { companyId, actorId, requestId, role } = ctx;
  assertCan(role, body.kind, "create");
  if (body.clientRef) {
    const existing = await prisma.order.findUnique({ where: { companyId_clientRef: { companyId, clientRef: body.clientRef } }, select: { id: true } });
    if (existing) return { id: existing.id, created: false };
  }
  try {
    const id = await prisma.$transaction(async (tx) => {
      const party = await loadParty(tx, cfgFor(body.kind), companyId, body.partyId);
      const priced = await priceLines(tx, companyId, body.kind, body.lines);
      if (body.warehouseId) await requireWarehouse(tx, companyId, body.warehouseId, { active: true });
      const number = await nextDocNumber(tx, companyId, body.kind === "SALE" ? "saleOrder" : "purchaseOrder", new Date());
      const o = await tx.order.create({
        data: {
          companyId,
          kind: body.kind,
          number,
          status: body.status,
          partyId: party?.id ?? null,
          partyName: party?.name ?? null,
          expectedDate: body.expectedDate,
          deliveryAddress: body.deliveryAddress,
          deliveryNote: body.deliveryNote,
          notes: body.notes,
          warehouseId: body.kind === "PURCHASE" ? body.warehouseId : null,
          subtotal: priced.subtotal,
          lineCount: priced.lineCount,
          clientRef: body.clientRef ?? null,
          createdById: actorId,
          updatedById: actorId,
          lines: { create: priced.rows },
          events: { create: { fromStatus: null, toStatus: body.status, createdById: actorId } },
        },
        select: { id: true },
      });
      await saveOrderSets(tx, ctx, { id: o.id, number, kind: body.kind }, priced);
      await audit(tx, {
        companyId,
        actorId,
        action: "ORDER_CREATE",
        entityType: "Order",
        entityId: o.id,
        after: { number, kind: body.kind, status: body.status, party: party?.name ?? null, total: priced.subtotal, lines: priced.lineCount },
        requestId,
      });
      return o.id;
    }, WRITE_TX);
    return { id, created: true };
  } catch (e) {
    if (body.clientRef && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await prisma.order.findUnique({ where: { companyId_clientRef: { companyId, clientRef: body.clientRef } }, select: { id: true } });
      if (winner) return { id: winner.id, created: false };
    }
    throw e;
  }
}

export async function updateOrder(ctx: OrderContext, id: string, body: z.infer<typeof updateOrderBody>) {
  const { companyId, actorId, requestId, role } = ctx;
  return prisma.$transaction(async (tx) => {
    const o = await lockOrder(tx, companyId, id, body.version);
    assertCan(role, o.kind, "create");
    if (!OPEN.includes(o.status)) throw closedError(o.number, o.status);
    o.checkVersion();
    const editsItems = body.lines !== undefined || body.partyId !== undefined || body.expectedDate !== undefined;
    if (editsItems && !EDITABLE.includes(o.status)) {
      throw new AppError(409, "ORDER_LOCKED", `${o.number} is on delivery: move it back to Placed to change items, party or date`);
    }
    // Replacing the lines would reset what was already delivered / received.
    if (body.lines && (await hasFulfilled(tx, id))) {
      throw new AppError(409, "ORDER_LOCKED", `${o.number} is partly fulfilled: its items can no longer be changed`);
    }
    const data: Prisma.OrderUncheckedUpdateInput = { updatedById: actorId, ...bumpVersion };
    if (body.partyId !== undefined) {
      const party = await loadParty(tx, cfgFor(o.kind), companyId, body.partyId);
      data.partyId = party?.id ?? null;
      data.partyName = party?.name ?? null;
    }
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.expectedDate !== undefined) data.expectedDate = body.expectedDate;
    if (body.deliveryAddress !== undefined) data.deliveryAddress = body.deliveryAddress;
    if (body.deliveryNote !== undefined) data.deliveryNote = body.deliveryNote;
    if (body.warehouseId !== undefined && o.kind === "PURCHASE") {
      if (body.warehouseId) await requireWarehouse(tx, companyId, body.warehouseId, { active: true });
      data.warehouseId = body.warehouseId;
    }
    if (body.lines) {
      const priced = await priceLines(tx, companyId, o.kind, body.lines);
      // V3.1: the sets held so far are released, then the edited picks are held again.
      const previouslyHeld = o.kind === "SALE" ? await releaseOrderSets(tx, ctx, id) : [];
      await tx.orderLine.deleteMany({ where: { orderId: id } });
      await tx.orderLine.createMany({ data: priced.rows.map((r) => ({ ...r, orderId: id })) });
      await saveOrderSets(tx, ctx, { id, number: o.number, kind: o.kind }, priced, previouslyHeld);
      data.subtotal = priced.subtotal;
      data.lineCount = priced.lineCount;
    }
    const after = await tx.order.update({ where: { id }, data, select: { version: true, subtotal: true, lineCount: true, partyName: true } });
    await audit(tx, {
      companyId,
      actorId,
      action: "ORDER_UPDATE",
      entityType: "Order",
      entityId: id,
      after: { number: o.number, party: after.partyName, total: after.subtotal.toFixed(2), lines: after.lineCount, changed: Object.keys(body).filter((k) => k !== "version") },
      requestId,
    });
    return { id, version: after.version };
  }, WRITE_TX);
}

export async function moveOrder(ctx: OrderContext, id: string, body: z.infer<typeof statusBody>) {
  const { companyId, actorId, requestId, role } = ctx;
  return prisma.$transaction(async (tx) => {
    const o = await lockOrder(tx, companyId, id, body.version);
    assertCan(role, o.kind, "create");
    if (!OPEN.includes(o.status)) throw closedError(o.number, o.status);
    o.checkVersion();
    if (!(MOVES[o.status] ?? []).includes(body.to)) {
      throw new AppError(409, "BAD_TRANSITION", `${o.number} cannot go from ${o.status.replace(/_/g, " ").toLowerCase()} to ${body.to.replace(/_/g, " ").toLowerCase()}`);
    }
    const fulfilled = await hasFulfilled(tx, id);
    if (fulfilled && (body.to === "DRAFT" || body.to === "PLACED")) {
      throw new AppError(409, "BAD_TRANSITION", `${o.number} is partly fulfilled: move it back to Partially fulfilled instead`);
    }
    if (!fulfilled && body.to === "PARTIALLY_FULFILLED") {
      throw new AppError(409, "BAD_TRANSITION", `${o.number} has nothing fulfilled yet: move it back to Placed instead`);
    }
    const after = await tx.order.update({
      where: { id },
      data: { status: body.to, ...(body.deliveryNote !== undefined ? { deliveryNote: body.deliveryNote } : {}), updatedById: actorId, ...bumpVersion },
      select: { version: true },
    });
    await tx.orderEvent.create({ data: { orderId: id, fromStatus: o.status, toStatus: body.to, note: body.note, createdById: actorId } });
    await audit(tx, { companyId, actorId, action: "ORDER_STATUS", entityType: "Order", entityId: id, before: { status: o.status }, after: { number: o.number, status: body.to }, reason: body.note, requestId });
    return { id, status: body.to, version: after.version };
  }, WRITE_TX);
}

/**
 * Fulfills an order either partially or completely by creating the corresponding Sale / Purchase document.
 * If all lines are fulfilled, transitions order to COMPLETED.
 * If partially fulfilled, transitions order to PARTIALLY_FULFILLED.
 */
export async function fulfillOrder(ctx: OrderContext, id: string, body: z.infer<typeof fulfillOrderBody>) {
  const { companyId, actorId, requestId, role } = ctx;
  return prisma.$transaction(async (tx) => {
    const o = await lockOrder(tx, companyId, id, body.version);
    assertCan(role, o.kind, "create");
    if (o.status === "COMPLETED" && o.document_id) return { id, documentId: o.document_id, status: "COMPLETED" as OrderStatus, allCompleted: true, created: false };
    if (o.status === "CANCELLED") throw closedError(o.number, o.status);
    o.checkVersion();
    if (!COMPLETABLE.includes(o.status)) throw new AppError(409, "BAD_TRANSITION", `Order ${o.number} is not ready to fulfill`);

    const order = await tx.order.findUniqueOrThrow({
      where: { id },
      include: {
        lines: {
          orderBy: { lineNo: "asc" },
          include: {
            variation: {
              select: {
                id: true,
                shortName: true,
                group: { select: { name: true, productType: true, lengthUnit: true } },
              },
            },
          },
        },
      },
    });

    const reqLines = body.lines;
    const reqByLineId = reqLines ? new Map(reqLines.map((r) => [r.orderLineId, r])) : null;
    if (reqLines) {
      const known = new Set(order.lines.map((l) => l.id));
      if (reqByLineId!.size !== reqLines.length) throw new AppError(400, "DUPLICATE_LINE", "The same order line is listed twice");
      const unknown = reqLines.find((r) => !known.has(r.orderLineId));
      if (unknown) throw new AppError(400, "UNKNOWN_LINE", `Order line ${unknown.orderLineId} is not on ${o.number}`);
    }

    type FulfillItem = {
      line: (typeof order.lines)[0];
      fulfillMilli: number;
      pieceId?: string | null;
    };
    const itemsToFulfill: FulfillItem[] = [];

    for (const l of order.lines) {
      const orderedMilli = milliOf(l.quantity);
      const fulfilledMilli = milliOf(l.fulfilledQuantity);
      const outstandingMilli = Math.max(0, orderedMilli - fulfilledMilli);

      if (reqByLineId) {
        const req = reqByLineId.get(l.id);
        if (!req) continue;
        const requestedQtyMilli = req.quantity !== undefined ? toMilli(req.quantity) : req.sets ? req.sets.length * 1000 : outstandingMilli;
        if (requestedQtyMilli <= 0) continue;
        if (requestedQtyMilli > outstandingMilli) {
          throw new AppError(
            400,
            "AMOUNT_TOO_LARGE",
            `Line ${l.lineNo} (${l.variation.group.name} ${l.variation.shortName}): cannot fulfill ${formatLength(requestedQtyMilli, l.variation.group.lengthUnit ?? "m")} when outstanding is ${formatLength(outstandingMilli, l.variation.group.lengthUnit ?? "m")}`,
          );
        }
        itemsToFulfill.push({
          line: l,
          fulfillMilli: requestedQtyMilli,
          pieceId: req.pieceId ?? l.pieceId,
        });
      } else {
        if (outstandingMilli > 0) {
          itemsToFulfill.push({
            line: l,
            fulfillMilli: outstandingMilli,
            pieceId: l.pieceId,
          });
        }
      }
    }

    if (!itemsToFulfill.length) {
      throw new AppError(400, "NOTHING_TO_FULFILL", "All requested items are already fulfilled");
    }

    // A Measured purchase-order line lists the exact rolls expected; they are received together,
    // so the receipt's rolls always add up to its quantity (writeDocument checks ROLLS_TOTAL).
    if (o.kind === "PURCHASE") {
      for (const item of itemsToFulfill) {
        const l = item.line;
        if (l.variation.group.productType === "measured" && item.fulfillMilli !== milliOf(l.quantity)) {
          throw new AppError(400, "WHOLE_ROLLS", `Line ${l.lineNo} (${l.variation.group.name} ${l.variation.shortName}): receive all its rolls at once`);
        }
      }
    }

    // V3.1 set lines (0037). Sale order: the held sets are delivered together, with the part
    // changes planned on the order; purchase order: the sets received now, else those entered on
    // the order (only when the whole line arrives at once).
    const storedSets = await orderLineSets(tx, id);
    const setsFor = new Map<string, { saleSets?: SaleSetInput[]; sets?: Omit<z.infer<typeof setInput>, "rate">[] }>();
    for (const item of itemsToFulfill) {
      const l = item.line;
      if (l.variation.group.productType !== "grouped") continue;
      const name = `Line ${l.lineNo} (${l.variation.group.name})`;
      if (o.kind === "SALE") {
        if (item.fulfillMilli !== milliOf(l.quantity) - milliOf(l.fulfilledQuantity)) throw new AppError(400, "WHOLE_SETS", `${name}: deliver all its sets at once`);
        const saleSets = z.array(saleSetInput).parse(storedSets.get(l.id) ?? []);
        if (saleSets.length * 1000 !== item.fulfillMilli) throw new AppError(409, "SETS_REQUIRED", `${name}: edit the order and pick its sets again`);
        setsFor.set(l.id, { saleSets });
      } else {
        const typed = reqByLineId?.get(l.id)?.sets;
        const whole = milliOf(l.fulfilledQuantity) === 0 && item.fulfillMilli === milliOf(l.quantity);
        const sets = typed ?? (whole && storedSets.has(l.id) ? z.array(setInput.extend({ rate: money.optional() })).parse(storedSets.get(l.id)) : null);
        if (!sets) throw new AppError(400, "SETS_REQUIRED", `${name}: enter each set received (its parts)`);
        if (sets.length * 1000 !== item.fulfillMilli) throw new AppError(400, "SETS_TOTAL", `${name}: ${sets.length} set${sets.length === 1 ? "" : "s"} entered, receiving ${num(item.fulfillMilli)}`);
        setsFor.set(l.id, { sets: sets.map(({ rate: _, ...s }) => s) });
      }
    }
    if (o.kind === "SALE") {
      await unholdForDelivery(tx, companyId, id, [...setsFor.values()].flatMap((s) => (s.saleSets ?? []).map((x) => x.setId)));
    }

    const planItems = itemsToFulfill.map((item) => ({
      variationId: item.line.variationId,
      quantity: new Prisma.Decimal(dec(item.fulfillMilli)),
      pieceId: item.pieceId ?? null,
      measured: item.line.variation.group.productType === "measured",
    }));

    const { pieceFor, replanned } = o.kind === "SALE"
      ? await preferredPieces(tx, companyId, planItems)
      : { pieceFor: () => null, replanned: [] as number[] };

    // A line's discount is shared across its deliveries in proportion to quantity; taking the
    // difference of cumulative shares makes the parts add up to the line discount exactly.
    const discountShare = (line: (typeof order.lines)[0], addMilli: number) => {
      const d = toPaise(line.discount.toFixed(2));
      if (d === 0n) return 0n;
      const ordered = BigInt(milliOf(line.quantity));
      const before = BigInt(milliOf(line.fulfilledQuantity));
      return (d * (before + BigInt(addMilli))) / ordered - (d * before) / ordered;
    };

    const docLines = itemsToFulfill.map((item, idx) => {
      const share = discountShare(item.line, item.fulfillMilli);
      return {
      variationId: item.line.variationId,
      quantity: num(item.fulfillMilli),
      price: item.line.price.toFixed(2),
      ...(share === 0n ? {} : { discount: fromPaise(share) }),
      note: item.line.note,
      ...(item.line.variation.group.productType === "measured" && o.kind === "SALE"
        ? { pieceId: pieceFor(idx) }
        : {}),
      ...(item.line.variation.group.productType === "measured" && o.kind === "PURCHASE" && item.line.rolls
        ? { rolls: z.array(rollInput).parse(item.line.rolls) }
        : {}),
      ...(o.kind === "SALE" && !["measured", "grouped"].includes(item.line.variation.group.productType) ? deliverySplits(item.line, item.fulfillMilli) : {}),
      ...(setsFor.get(item.line.id) ?? {}),
      };
    });
    // V3.1 (WH-13): the split typed at delivery wins; a saved split is used when this delivery
    // takes the whole line; otherwise the automatic pick. writeDocument re-checks live stock.
    function deliverySplits(line: (typeof order.lines)[0], milli: number): { splits?: Split[] } {
      const typed = reqByLineId?.get(line.id)?.splits;
      if (typed) return { splits: typed };
      const saved = Array.isArray(line.splits) ? (line.splits as unknown as Split[]) : null;
      return saved && milliOf(line.fulfilledQuantity) === 0 && milli === milliOf(line.quantity) ? { splits: saved } : {};
    }

    const documentId = await writeDocument(
      tx,
      cfgFor(o.kind),
      ctx,
      {
        partyId: order.partyId,
        notes: (order.notes ? `${o.number} · ${order.notes}` : o.number).slice(0, 500),
        allowNegative: o.kind === "SALE" && body.allowNegative,
        date: undefined,
        clientRef: undefined,
        paymentMode: body.paymentMode,
        amountPaid: body.amountPaid,
        warehouseId: o.kind === "PURCHASE" ? (body.warehouseId ?? order.warehouseId) : null,
        lines: docLines,
      },
      { orderId: id, orderLineIds: itemsToFulfill.map((item) => item.line.id) },
    );

    // Delivered quantities, status and document link follow the order's live documents (0027).
    const synced = await syncOrderFromDocuments(tx, companyId, id, actorId, { afterDelivery: true });
    const nextStatus = synced.to;
    const allCompleted = nextStatus === "COMPLETED";

    const note = allCompleted
      ? `Order fully fulfilled via ${o.kind.toLowerCase()} document`
      : `Order partially fulfilled (${itemsToFulfill.length} line${itemsToFulfill.length > 1 ? "s" : ""})`;

    await tx.orderEvent.create({
      data: {
        orderId: id,
        fromStatus: o.status,
        toStatus: nextStatus,
        note,
        createdById: actorId,
      },
    });

    if (o.kind === "PURCHASE" && allCompleted) {
      const linkedLines = await tx.orderLine.findMany({
        where: { orderId: id, linkedOrderId: { not: null } },
        select: { linkedOrderId: true },
      });
      const uniqueLinkedOrderIds = [...new Set(linkedLines.map((l) => l.linkedOrderId!))];
      for (const linkedId of uniqueLinkedOrderIds) {
        const targetOrder = await tx.order.findUnique({
          where: { id: linkedId },
          select: { id: true, number: true, status: true },
        });
        if (targetOrder && OPEN.includes(targetOrder.status)) {
          await tx.orderEvent.create({
            data: {
              orderId: linkedId,
              fromStatus: targetOrder.status,
              toStatus: targetOrder.status,
              note: `Procurement received via purchase ${o.number}. Ready to fulfill.`,
              createdById: actorId,
            },
          });
        }
      }
    }

    await audit(tx, {
      companyId,
      actorId,
      action: "ORDER_FULFILL",
      entityType: "Order",
      entityId: id,
      before: { status: o.status },
      after: {
        number: o.number,
        status: nextStatus,
        documentId,
        allCompleted,
        ...(replanned.length ? { piecesReplanned: replanned } : {}),
      },
      requestId,
    });

    return { id, documentId, status: nextStatus, allCompleted, created: true };
  }, WRITE_TX);
}

/**
 * Completes an order: creates its Sale / Purchase (stock moves now, with every checkout check)
 * and marks the order COMPLETED in one transaction. A repeated click returns the same document.
 */
export async function completeOrder(ctx: OrderContext, id: string, body: z.infer<typeof completeBody>) {
  const res = await fulfillOrder(ctx, id, { ...body, lines: undefined });
  return { id: res.id, documentId: res.documentId, created: res.created };
}

/**
 * Arranges a purchase order with a supplier to cover customer order shortages.
 * Links the resulting purchase order lines directly to the customer sale order lines.
 */
export async function arrangePurchaseForOrder(
  ctx: OrderContext,
  orderId: string,
  body: z.infer<typeof arrangePurchaseBody>,
) {
  const { companyId, actorId, requestId, role } = ctx;
  assertCan(role, "PURCHASE", "create");
  return prisma.$transaction(async (tx) => {
    const o = await lockOrder(tx, companyId, orderId, body.version);
    if (o.kind !== "SALE") throw new AppError(400, "BAD_ORDER", "Can only arrange purchase for customer sale orders");
    if (!OPEN.includes(o.status)) throw closedError(o.number, o.status);
    o.checkVersion();

    const party = await loadParty(tx, PURCHASE, companyId, body.partyId);
    if (!party) throw new AppError(400, "UNKNOWN_PARTY", "Supplier not found");

    const requestedLineIds = body.lines.map((l) => l.orderLineId);
    const soLines = await tx.orderLine.findMany({
      where: { orderId, id: { in: requestedLineIds } },
      include: { variation: { select: { id: true, shortName: true, group: { select: { name: true, productType: true } } } } },
    });
    const soLineById = new Map(soLines.map((l) => [l.id, l]));

    const poLinesInput: z.infer<typeof orderLine>[] = [];
    for (let i = 0; i < body.lines.length; i++) {
      const item = body.lines[i]!;
      const soLine = soLineById.get(item.orderLineId);
      if (!soLine) throw new AppError(400, "UNKNOWN_LINE", `Order line ${item.orderLineId} not found in this sale order`);
      if (soLine.variation.group.productType !== "measured") {
        throw new AppError(400, "NOT_MEASURED", `${soLine.variation.group.name} ${soLine.variation.shortName} is not a measured product`);
      }
      poLinesInput.push({
        variationId: soLine.variationId,
        price: item.price,
        discount: item.discount,
        rolls: item.rolls,
        note: null,
        pieceId: null,
        linkedOrderId: orderId,
        linkedOrderLineId: soLine.id,
      });
    }

    const priced = await priceLines(tx, companyId, "PURCHASE", poLinesInput);
    const poNumber = await nextDocNumber(tx, companyId, "purchaseOrder", new Date());

    const po = await tx.order.create({
      data: {
        companyId,
        kind: "PURCHASE",
        number: poNumber,
        status: "PLACED",
        partyId: party.id,
        partyName: party.name,
        expectedDate: body.expectedDate,
        deliveryAddress: body.deliveryAddress,
        deliveryNote: body.deliveryNote,
        notes: body.notes ? `For ${o.number}: ${body.notes}` : `Arranged for customer order ${o.number}`,
        subtotal: priced.subtotal,
        lineCount: priced.lineCount,
        createdById: actorId,
        updatedById: actorId,
        lines: { create: priced.rows },
        events: {
          create: {
            fromStatus: null,
            toStatus: "PLACED",
            note: `Arranged for customer order ${o.number}`,
            createdById: actorId,
          },
        },
      },
      select: { id: true, number: true },
    });

    const totalRollsLength = poLinesInput.reduce(
      (sum, l) => sum + (l.rolls?.reduce((s, r) => s + r.length, 0) ?? 0),
      0,
    );
    await tx.orderEvent.create({
      data: {
        orderId,
        fromStatus: o.status,
        toStatus: o.status,
        note: `Arranged Purchase Order ${po.number} (${formatLength(totalRollsLength, "m")}) from ${party.name}`,
        createdById: actorId,
      },
    });

    await audit(tx, {
      companyId,
      actorId,
      action: "ORDER_ARRANGE_PURCHASE",
      entityType: "Order",
      entityId: orderId,
      after: { saleOrder: o.number, purchaseOrder: po.number, supplier: party.name, lines: priced.lineCount },
      requestId,
    });

    return { id: po.id, number: po.number };
  }, WRITE_TX);
}

export async function cancelOrder(ctx: OrderContext, id: string, body: z.infer<typeof cancelBody>) {
  const { companyId, actorId, requestId, role } = ctx;
  return prisma.$transaction(async (tx) => {
    const o = await lockOrder(tx, companyId, id, body.version);
    // A draft is still the creator's working copy; a placed order is a commitment (plan §3).
    assertCan(role, o.kind, o.status === "DRAFT" ? "create" : "void");
    if (!OPEN.includes(o.status)) throw closedError(o.number, o.status);
    o.checkVersion();
    // V3.1 (D23): the sets this order holds go back on sale.
    const released = await releaseOrderSets(tx, ctx, id);
    await tx.order.update({ where: { id }, data: { status: "CANCELLED", cancelReason: body.reason, updatedById: actorId, ...bumpVersion } });
    await tx.orderEvent.create({ data: { orderId: id, fromStatus: o.status, toStatus: "CANCELLED", note: body.reason, createdById: actorId } });
    await audit(tx, { companyId, actorId, action: "ORDER_CANCEL", entityType: "Order", entityId: id, before: { status: o.status }, after: { number: o.number, status: "CANCELLED", ...(released.length ? { setsReleased: released.length } : {}) }, reason: body.reason, requestId });
    return { id, status: "CANCELLED" as const };
  }, WRITE_TX);
}
