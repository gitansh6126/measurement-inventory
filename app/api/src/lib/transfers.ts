import { Prisma } from "@prisma/client";
import { toMilli } from "@rs-v31/shared/measure";
import { z } from "zod";
import { prisma, WRITE_TX, type Db, type Tx } from "../db.js";
import { audit } from "./audit.js";
import { AppError } from "./errors.js";
import { dec, ledger, milliOf, num } from "./measure.js";
import { nextDocNumber } from "./numbering.js";
import { setContentsByIds } from "./sets.js";
import { lockVariations, recordMovements, type MovementInput } from "./stock.js";
import { isWarehousingOn, requireWarehouse, type Ctx } from "./warehouses.js";

// Shifts between warehouses (docs\WAREHOUSE-V3-PLAN.md WH-9…WH-11, GW-3). A shift is an
// append-only document TRF/2026-27/0001: TRANSFER_OUT from From and TRANSFER_IN to To, net 0 per
// item (checked by 0035 at commit). Counted items move by quantity, measured pieces whole, sets
// with all their parts. Fixed by cancelling (reason) while To still holds that stock, or a shift back.

export const transferBody = z.object({
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  date: z
    .string()
    .nullish()
    .transform((v) => (v ? new Date(v) : undefined)),
  notes: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => v || null),
  clientRef: z.string().uuid().optional(),
  lines: z
    .array(
      z
        .object({
          variationId: z.string().min(1).optional(),
          quantity: z.number().int("Quantity must be a whole number").positive().max(1_000_000).optional(),
          pieceId: z.string().min(1).optional(),
          setId: z.string().min(1).optional(),
          note: z
            .string()
            .trim()
            .max(300)
            .nullish()
            .transform((v) => v || null),
        })
        .refine((l) => [l.variationId && l.quantity, l.pieceId, l.setId].filter(Boolean).length === 1, "Each line is an item with a quantity, a roll or a set"),
    )
    .min(1, "Add at least one item")
    .max(200),
});
export type TransferBody = z.infer<typeof transferBody>;

export const cancelBody = z.object({ reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(300) });

export const transfersQuery = z.object({
  warehouseId: z.string().optional(),
  q: z.string().trim().max(100).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

interface LineRow {
  lineNo: number;
  variationId: string;
  productNameSnapshot: string;
  shortNameSnapshot: string;
  unit: string;
  quantity: string;
  pieceId: string | null;
  setId: string | null;
  note: string | null;
}

export async function createTransfer(ctx: Ctx, body: TransferBody): Promise<{ id: string; created: boolean }> {
  const existing = body.clientRef ? await prisma.stockTransfer.findUnique({ where: { companyId_clientRef: { companyId: ctx.companyId, clientRef: body.clientRef } }, select: { id: true } }) : null;
  if (existing) return { id: existing.id, created: false };
  try {
    const id = await prisma.$transaction((tx) => writeTransfer(tx, ctx, body), WRITE_TX);
    return { id, created: true };
  } catch (e) {
    if (body.clientRef && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await prisma.stockTransfer.findUnique({ where: { companyId_clientRef: { companyId: ctx.companyId, clientRef: body.clientRef } }, select: { id: true } });
      if (winner) return { id: winner.id, created: false };
    }
    throw e;
  }
}

async function writeTransfer(tx: Tx, ctx: Ctx, body: TransferBody): Promise<string> {
  const { companyId, actorId, requestId } = ctx;
  if (!(await isWarehousingOn(tx, companyId))) throw new AppError(409, "WAREHOUSING_OFF", "Create a warehouse first");
  if (body.fromWarehouseId === body.toWarehouseId) throw new AppError(400, "SAME_WAREHOUSE", "Choose two different warehouses");
  const from = await requireWarehouse(tx, companyId, body.fromWarehouseId, { active: true });
  const to = await requireWarehouse(tx, companyId, body.toWarehouseId, { active: true });

  // Rolls and sets first, to know every variation to lock.
  const pieceIds = body.lines.flatMap((l) => (l.pieceId ? [l.pieceId] : []));
  const setIds = body.lines.flatMap((l) => (l.setId ? [l.setId] : []));
  if (new Set(pieceIds).size !== pieceIds.length) throw new AppError(400, "DUPLICATE_LINE", "A roll appears twice");
  if (new Set(setIds).size !== setIds.length) throw new AppError(400, "DUPLICATE_LINE", "A set appears twice");
  const counted = body.lines.flatMap((l) => (l.variationId ? [l.variationId] : []));
  if (new Set(counted).size !== counted.length) throw new AppError(400, "DUPLICATE_LINE", "The same item appears twice; change its quantity instead");
  const pieceHeads = await tx.measurementPiece.findMany({ where: { companyId, id: { in: pieceIds } }, select: { id: true, variationId: true } });
  if (pieceHeads.length !== pieceIds.length) throw new AppError(400, "UNKNOWN_PIECE", "A roll was not found");
  const setHeads = await tx.groupSet.findMany({ where: { companyId, id: { in: setIds } }, select: { id: true, group: { select: { variations: { select: { id: true } } } }, parts: { where: { status: "ALLOCATED" }, select: { variationId: true } } } });
  if (setHeads.length !== setIds.length) throw new AppError(400, "UNKNOWN_SET", "A set was not found");
  const info = await lockVariations(tx, companyId, [
    ...counted,
    ...pieceHeads.map((p) => p.variationId),
    ...setHeads.flatMap((s) => [...s.group.variations.map((v) => v.id), ...s.parts.map((p) => p.variationId)]),
  ]);

  // Under the locks: the current state of each roll and set.
  const pieces = new Map((await tx.measurementPiece.findMany({ where: { id: { in: pieceIds } } })).map((p) => [p.id, p]));
  const sets = new Map(
    (await tx.groupSet.findMany({ where: { id: { in: setIds } }, include: { group: { select: { name: true, unit: true, variations: { select: { id: true, shortName: true } } } }, parts: { where: { status: "ALLOCATED" } } } })).map((s) => [s.id, s]),
  );

  const lines: LineRow[] = [];
  const loose: MovementInput[] = [];
  const setMoves: MovementInput[] = [];
  const movedPieces: { id: string; variationId: string; lengthMilli: number }[] = [];
  const movedSets: string[] = [];
  const out = (variationId: string, milli: number) => ({ variationId, type: "TRANSFER_OUT" as const, quantity: -milli / 1000, warehouseId: from.id });
  const inn = (variationId: string, milli: number) => ({ variationId, type: "TRANSFER_IN" as const, quantity: milli / 1000, warehouseId: to.id });

  for (const [i, l] of body.lines.entries()) {
    const lineNo = i + 1;
    if (l.variationId) {
      const v = info.get(l.variationId)!;
      if (v.product_type === "measured") throw new AppError(400, "MEASURED_BY_PIECE", `${v.name} ${v.short_name}: shift whole rolls (cut first to shift part of one)`);
      if (v.product_type === "grouped") throw new AppError(400, "GROUPED_BY_SET", `${v.name}: shift whole sets`);
      lines.push({ lineNo, variationId: l.variationId, productNameSnapshot: v.name, shortNameSnapshot: v.short_name, unit: v.unit, quantity: String(l.quantity), pieceId: null, setId: null, note: l.note });
      loose.push(out(l.variationId, l.quantity! * 1000), inn(l.variationId, l.quantity! * 1000));
    } else if (l.pieceId) {
      const p = pieces.get(l.pieceId)!;
      const v = info.get(p.variationId)!;
      if (p.status !== "ACTIVE") throw new AppError(409, "PIECE_USED_UP", `${p.code} is used up`);
      if (p.setId) throw new AppError(409, "PIECE_IN_SET", `${p.code} is fitted in a set; shift the set`);
      if (p.warehouseId !== from.id) throw new AppError(409, "PIECE_NOT_IN_WAREHOUSE", `${p.code} is not in ${from.code}`);
      const len = milliOf(p.remainingLength);
      lines.push({ lineNo, variationId: p.variationId, productNameSnapshot: v.name, shortNameSnapshot: v.short_name, unit: v.unit, quantity: dec(len), pieceId: p.id, setId: null, note: l.note });
      loose.push(out(p.variationId, len), inn(p.variationId, len));
      movedPieces.push({ id: p.id, variationId: p.variationId, lengthMilli: len });
    } else {
      const s = sets.get(l.setId!)!;
      if (s.status !== "IN_STOCK") throw new AppError(409, "SET_NOT_IN_STOCK", `A set (${s.group.name}) is ${s.status.toLowerCase().replace("_", " ")}`);
      if (s.warehouseId !== from.id) throw new AppError(409, "SET_NOT_IN_WAREHOUSE", `A set (${s.group.name}) is not in ${from.code}`);
      const gv = s.group.variations[0]!;
      lines.push({ lineNo, variationId: gv.id, productNameSnapshot: s.group.name, shortNameSnapshot: s.code, unit: s.group.unit, quantity: "1", pieceId: null, setId: s.id, note: l.note });
      for (const part of s.parts) {
        const milli = milliOf(part.quantity);
        setMoves.push(out(part.variationId, milli), inn(part.variationId, milli));
      }
      movedSets.push(s.id);
    }
  }

  const date = body.date instanceof Date && !isNaN(body.date.getTime()) ? body.date : new Date();
  const number = await nextDocNumber(tx, companyId, "transfer", date);
  const t = await tx.stockTransfer.create({
    data: {
      companyId,
      number,
      transferDate: date,
      fromWarehouseId: from.id,
      toWarehouseId: to.id,
      notes: body.notes,
      clientRef: body.clientRef ?? null,
      createdById: actorId,
      lines: { create: lines },
    },
    select: { id: true },
  });
  const tag = (m: MovementInput): MovementInput => ({ ...m, transferId: t.id, reason: number, occurredAt: date });
  if (loose.length) await recordMovements(tx, companyId, actorId, loose.map(tag), { requestId });
  if (setMoves.length) await recordMovements(tx, companyId, actorId, setMoves.map(tag), { requestId, sets: true });

  // Rolls and sets follow their stock (the 0035 deferred checks compare them per warehouse).
  for (const p of movedPieces) await tx.measurementPiece.update({ where: { id: p.id }, data: { warehouseId: to.id, updatedById: actorId } });
  if (movedSets.length) {
    await tx.measurementPiece.updateMany({ where: { setId: { in: movedSets } }, data: { warehouseId: to.id, updatedById: actorId } });
    for (const id of movedSets) await tx.groupSet.update({ where: { id }, data: { warehouseId: to.id, version: { increment: 1 }, updatedById: actorId } });
  }
  const setPieces = movedSets.length ? await tx.measurementPiece.findMany({ where: { setId: { in: movedSets } }, select: { id: true, variationId: true, remainingLength: true } }) : [];
  await ledger(
    tx,
    ctx,
    [...movedPieces, ...setPieces.map((p) => ({ id: p.id, variationId: p.variationId, lengthMilli: milliOf(p.remainingLength) }))].map((p) => ({
      pieceId: p.id,
      variationId: p.variationId,
      action: "TRANSFER" as const,
      beforeMilli: p.lengthMilli,
      afterMilli: p.lengthMilli,
      reason: number,
      occurredAt: date,
      warehouseId: from.id,
      toWarehouseId: to.id,
      transferId: t.id,
    })),
  );
  await audit(tx, {
    companyId,
    actorId,
    action: "STOCK_TRANSFER",
    entityType: "StockTransfer",
    entityId: t.id,
    after: { number, from: from.code, to: to.code, lines: lines.map((l) => ({ shortName: l.shortNameSnapshot, quantity: Number(l.quantity), ...(l.setId ? { set: true } : {}), ...(l.pieceId ? { roll: true } : {}) })) },
    requestId,
  });
  return t.id;
}

/**
 * Cancels a shift (WH-10): everything goes back to From, only while To still holds it — the
 * counted quantity free in To, each roll unchanged in To, each set in stock in To.
 */
export async function cancelTransfer(ctx: Ctx, id: string, reason: string) {
  const { companyId, actorId, requestId } = ctx;
  try {
    return await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM stock_transfers WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`;
      if (!rows[0]) throw new AppError(404, "NOT_FOUND", "Shift not found");
      if (await tx.stockTransferVoid.findUnique({ where: { transferId: id }, select: { id: true } })) throw new AppError(409, "ALREADY_VOID", "This shift is already cancelled");
      const t = await tx.stockTransfer.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
      const moved = await tx.stockMovement.groupBy({ by: ["variationId", "warehouseId"], where: { transferId: id }, _sum: { quantity: true } });
      await lockVariations(tx, companyId, moved.map((m) => m.variationId));
      const codes = new Map((await tx.warehouse.findMany({ where: { companyId }, select: { id: true, code: true } })).map((w) => [w.id, w.code]));

      const pieceIds = t.lines.flatMap((l) => (l.pieceId ? [l.pieceId] : []));
      const setIds = t.lines.flatMap((l) => (l.setId ? [l.setId] : []));
      const pieces = await tx.measurementPiece.findMany({ where: { id: { in: pieceIds } } });
      for (const p of pieces) {
        const line = t.lines.find((l) => l.pieceId === p.id)!;
        if (p.status !== "ACTIVE" || p.warehouseId !== t.toWarehouseId || p.setId || !p.remainingLength.equals(line.quantity)) {
          throw new AppError(409, "TRANSFER_STOCK_USED", `${p.code} was cut, sold or moved after this shift; shift it back instead`);
        }
      }
      const sets = await tx.groupSet.findMany({ where: { id: { in: setIds } }, select: { id: true, code: true, status: true, warehouseId: true } });
      for (const s of sets) {
        if (s.status !== "IN_STOCK" || s.warehouseId !== t.toWarehouseId) throw new AppError(409, "TRANSFER_STOCK_USED", `${s.code} is no longer in stock in ${codes.get(t.toWarehouseId)}; shift it back instead`);
      }

      const v = await tx.stockTransferVoid.create({ data: { companyId, transferId: id, reason, createdById: actorId }, select: { createdAt: true } });
      const text = `CANCEL ${t.number}`;
      // Take back out of To first, then into From (a TRANSFER_VOID never goes below zero).
      const back = (sign: 1 | -1) =>
        moved.filter((m) => Math.sign(Number(m._sum.quantity ?? 0)) === sign).map((m) => ({ variationId: m.variationId, type: "TRANSFER_VOID" as const, quantity: -Number(m._sum.quantity ?? 0), warehouseId: m.warehouseId!, transferId: id, reason: text }));
      await recordMovements(tx, companyId, actorId, [...back(1), ...back(-1)], { requestId, sets: setIds.length > 0 });
      if (pieceIds.length) await tx.measurementPiece.updateMany({ where: { id: { in: pieceIds } }, data: { warehouseId: t.fromWarehouseId, updatedById: actorId } });
      if (setIds.length) {
        await tx.measurementPiece.updateMany({ where: { setId: { in: setIds } }, data: { warehouseId: t.fromWarehouseId, updatedById: actorId } });
        for (const s of sets) await tx.groupSet.update({ where: { id: s.id }, data: { warehouseId: t.fromWarehouseId, version: { increment: 1 }, updatedById: actorId } });
      }
      const all = await tx.measurementPiece.findMany({ where: { OR: [{ id: { in: pieceIds } }, { setId: { in: setIds } }] }, select: { id: true, variationId: true, remainingLength: true } });
      await ledger(
        tx,
        ctx,
        all.map((p) => ({ pieceId: p.id, variationId: p.variationId, action: "TRANSFER_VOID" as const, beforeMilli: milliOf(p.remainingLength), afterMilli: milliOf(p.remainingLength), reason, warehouseId: t.toWarehouseId, toWarehouseId: t.fromWarehouseId, transferId: id })),
      );
      await audit(tx, { companyId, actorId, action: "STOCK_TRANSFER_VOID", entityType: "StockTransfer", entityId: id, after: { number: t.number }, reason, requestId });
      return { id, number: t.number, voidedAt: v.createdAt };
    }, WRITE_TX);
  } catch (e) {
    if (e instanceof AppError && (e.code === "WAREHOUSE_SHORT" || e.code === "INSUFFICIENT_STOCK" || e.code === "PARTS_IN_SETS")) {
      throw new AppError(409, "TRANSFER_STOCK_USED", `Cannot cancel: the stock is no longer all in the destination warehouse. ${e.message}`, e.details);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function listTransfers(db: Db, companyId: string, q: z.infer<typeof transfersQuery>) {
  const where: Prisma.StockTransferWhereInput = {
    companyId,
    ...(q.warehouseId ? { OR: [{ fromWarehouseId: q.warehouseId }, { toWarehouseId: q.warehouseId }] } : {}),
    ...(q.q ? { OR: [{ number: { contains: q.q, mode: "insensitive" } }, { lines: { some: { shortNameSnapshot: { contains: q.q, mode: "insensitive" } } } }, { lines: { some: { productNameSnapshot: { contains: q.q, mode: "insensitive" } } } }] } : {}),
    ...(q.dateFrom || q.dateTo ? { transferDate: { ...(q.dateFrom ? { gte: new Date(q.dateFrom) } : {}), ...(q.dateTo ? { lte: new Date(`${q.dateTo}T23:59:59.999+05:30`) } : {}) } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.stockTransfer.findMany({
      where,
      orderBy: [{ transferDate: "desc" }, { number: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { _count: { select: { lines: true } } },
    }),
    db.stockTransfer.count({ where }),
  ]);
  const [warehouses, users, voids] = await Promise.all([
    db.warehouse.findMany({ where: { companyId }, select: { id: true, code: true, name: true } }),
    db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } }),
    db.stockTransferVoid.findMany({ where: { transferId: { in: rows.map((r) => r.id) } }, select: { transferId: true } }),
  ]);
  const wh = new Map(warehouses.map((w) => [w.id, w]));
  const who = new Map(users.map((u) => [u.id, u.name]));
  const cancelled = new Set(voids.map((v) => v.transferId));
  return {
    total,
    page: q.page,
    pageSize: q.pageSize,
    transfers: rows.map((r) => ({
      id: r.id,
      number: r.number,
      date: r.transferDate,
      from: wh.get(r.fromWarehouseId) ?? null,
      to: wh.get(r.toWarehouseId) ?? null,
      lineCount: r._count.lines,
      notes: r.notes,
      createdBy: who.get(r.createdById) ?? null,
      status: cancelled.has(r.id) ? ("CANCELLED" as const) : ("DONE" as const),
    })),
  };
}

export async function getTransfer(db: Db, companyId: string, id: string) {
  const t = await db.stockTransfer.findFirst({ where: { id, companyId }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  if (!t) throw new AppError(404, "NOT_FOUND", "Shift not found");
  const [warehouses, user, v, pieces, setContents] = await Promise.all([
    db.warehouse.findMany({ where: { id: { in: [t.fromWarehouseId, t.toWarehouseId] } }, select: { id: true, code: true, name: true } }),
    db.user.findUnique({ where: { id: t.createdById }, select: { name: true } }),
    db.stockTransferVoid.findUnique({ where: { transferId: id } }),
    db.measurementPiece.findMany({ where: { id: { in: t.lines.flatMap((l) => (l.pieceId ? [l.pieceId] : [])) } }, select: { id: true, code: true } }),
    setContentsByIds(db, companyId, t.lines.flatMap((l) => (l.setId ? [l.setId] : []))),
  ]);
  const wh = new Map(warehouses.map((w) => [w.id, w]));
  const pieceCode = new Map(pieces.map((p) => [p.id, p.code]));
  const voidUser = v ? await db.user.findUnique({ where: { id: v.createdById }, select: { name: true } }) : null;
  return {
    id: t.id,
    number: t.number,
    date: t.transferDate,
    from: wh.get(t.fromWarehouseId) ?? null,
    to: wh.get(t.toWarehouseId) ?? null,
    notes: t.notes,
    createdAt: t.createdAt,
    createdBy: user?.name ?? null,
    status: v ? ("CANCELLED" as const) : ("DONE" as const),
    cancel: v ? { reason: v.reason, at: v.createdAt, by: voidUser?.name ?? null } : null,
    lines: t.lines.map((l) => ({
      lineNo: l.lineNo,
      variationId: l.variationId,
      productName: l.productNameSnapshot,
      shortName: l.shortNameSnapshot,
      unit: l.unit,
      quantity: num(toMilli(l.quantity.toString())),
      pieceId: l.pieceId,
      pieceCode: l.pieceId ? (pieceCode.get(l.pieceId) ?? null) : null,
      setId: l.setId,
      // V3.1: a set line shows its parts, never its code.
      setContents: l.setId ? (setContents.get(l.setId) ?? []) : null,
      note: l.note,
    })),
  };
}
