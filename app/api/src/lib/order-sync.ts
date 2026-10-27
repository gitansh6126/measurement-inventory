import type { OrderKind, OrderStatus } from "@prisma/client";
import type { Tx } from "../db.js";
import { AppError } from "./errors.js";
import { dec, milliOf } from "./measure.js";
import { bumpVersion } from "./versions.js";

// An order follows its documents (v2/docs/orders/ORDER-EDIT-AFTER-DELIVERY-PLAN.md §1.1).
// Delivered / received quantity of an order line = sum over the order's LIVE sales / purchases
// (no document_voids row: neither cancelled nor replaced) of the document lines linked to it
// (0027 order_line_id). Stock itself only ever moves through those documents.
//
// Lock order everywhere: the order row first, then any document row, so a fulfilment and an
// edit / cancel of one of its deliveries serialise instead of deadlocking.

/** Locks the order a document belongs to (if any) and returns it; call before locking the document. */
export async function lockOrderOfDocument(tx: Tx, companyId: string, kind: "sale" | "purchase", documentId: string) {
  const doc =
    kind === "sale"
      ? await tx.sale.findFirst({ where: { id: documentId, companyId }, select: { orderId: true } })
      : await tx.purchase.findFirst({ where: { id: documentId, companyId }, select: { orderId: true } });
  if (!doc?.orderId) return null;
  const rows = await tx.$queryRaw<{ id: string; number: string; status: OrderStatus }[]>`
    SELECT id, number, status FROM orders WHERE id = ${doc.orderId} AND company_id = ${companyId} FOR UPDATE`;
  return rows[0] ?? null;
}

export interface OrderSyncResult {
  from: OrderStatus;
  to: OrderStatus;
  documentId: string | null;
  /** Lines whose delivered quantity changed: [lineNo, before, after] in item units. */
  changed: { lineNo: number; before: number; after: number }[];
  /** Delivered quantity above the ordered quantity (an edit raised it; step 3 raises the order). */
  overDelivered: { lineNo: number; ordered: number; delivered: number }[];
}

/**
 * Recalculates delivered quantities, the order's status and its document link from its live
 * documents. The caller must hold the order row lock. Writes nothing when nothing changed.
 *
 * Status: a cancelled order is left as it is. Otherwise all delivered → COMPLETED; part → stays
 * ON_DELIVERY if it is out for the next delivery (unless `afterDelivery`: this sync follows a
 * delivery just made), else PARTIALLY_FULFILLED; nothing → a Completed /
 * Partially fulfilled order goes back to PLACED (Draft / Placed / On delivery are kept).
 */
export async function syncOrderFromDocuments(
  tx: Tx,
  companyId: string,
  orderId: string,
  actorId: string,
  opts: { afterDelivery?: boolean } = {},
): Promise<OrderSyncResult> {
  const order = await tx.order.findFirst({
    where: { id: orderId, companyId },
    select: { kind: true, status: true, documentId: true, lines: { select: { id: true, lineNo: true, quantity: true, fulfilledQuantity: true }, orderBy: { lineNo: "asc" } } },
  });
  if (!order) throw new AppError(404, "NOT_FOUND", "Order not found");

  const delivered = await deliveredByLine(tx, order.kind, order.lines.map((l) => l.id));
  const changed: OrderSyncResult["changed"] = [];
  const overDelivered: OrderSyncResult["overDelivered"] = [];
  let all = order.lines.length > 0;
  let any = false;
  for (const l of order.lines) {
    const ordered = milliOf(l.quantity);
    const got = delivered.get(l.id) ?? 0;
    // order_lines_fulfilled_nonneg (0026): fulfilled ≤ ordered.
    const capped = Math.min(got, ordered);
    if (got > ordered) overDelivered.push({ lineNo: l.lineNo, ordered: ordered / 1000, delivered: got / 1000 });
    if (capped < ordered) all = false;
    if (capped > 0) any = true;
    const before = milliOf(l.fulfilledQuantity);
    if (before !== capped) {
      changed.push({ lineNo: l.lineNo, before: before / 1000, after: capped / 1000 });
      await tx.orderLine.update({ where: { id: l.id }, data: { fulfilledQuantity: dec(capped) } });
    }
  }

  let to: OrderStatus = order.status;
  if (order.status !== "CANCELLED") {
    if (all) to = "COMPLETED";
    // A delivery just made ends the trip; an edit / cancel elsewhere leaves a trip in progress.
    else if (any) to = order.status === "ON_DELIVERY" && !opts.afterDelivery ? "ON_DELIVERY" : "PARTIALLY_FULFILLED";
    else if (order.status === "COMPLETED" || order.status === "PARTIALLY_FULFILLED") to = "PLACED";
  }

  // The order points at its latest live document once it is complete (the list's link).
  const latest = to === "COMPLETED" ? await latestLiveDocument(tx, order.kind, orderId) : null;
  const documentId = latest ?? null;

  if (changed.length || to !== order.status || documentId !== order.documentId) {
    await tx.order.update({ where: { id: orderId }, data: { status: to, documentId, updatedById: actorId, ...bumpVersion } });
  }
  return { from: order.status, to, documentId, changed, overDelivered };
}

async function deliveredByLine(tx: Tx, kind: OrderKind, orderLineIds: string[]) {
  const out = new Map<string, number>();
  if (!orderLineIds.length) return out;
  const rows =
    kind === "SALE"
      ? await tx.saleLine.groupBy({ by: ["orderLineId"], where: { orderLineId: { in: orderLineIds }, sale: { void: { is: null } } }, _sum: { quantity: true } })
      : await tx.purchaseLine.groupBy({ by: ["orderLineId"], where: { orderLineId: { in: orderLineIds }, purchase: { void: { is: null } } }, _sum: { quantity: true } });
  for (const r of rows) if (r.orderLineId && r._sum.quantity) out.set(r.orderLineId, milliOf(r._sum.quantity));
  return out;
}

async function latestLiveDocument(tx: Tx, kind: OrderKind, orderId: string) {
  const where = { orderId, void: { is: null } } as const;
  const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
  const d =
    kind === "SALE"
      ? await tx.sale.findFirst({ where, orderBy, select: { id: true } })
      : await tx.purchase.findFirst({ where, orderBy, select: { id: true } });
  return d?.id ?? null;
}

/** Order event text for a sync caused by a document change ("SAL/…/0030 cancelled: line 1 3 → 0"). */
export function syncNote(prefix: string, r: OrderSyncResult) {
  const parts = r.changed.map((c) => `line ${c.lineNo} ${c.before} → ${c.after}`);
  return `${prefix}${parts.length ? `: delivered ${parts.join(", ")}` : ""}`.slice(0, 300);
}
