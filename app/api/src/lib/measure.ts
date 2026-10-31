import type { PieceAction, PieceKind, Prisma } from "@prisma/client";
import {
  ActiveAllocation,
  BASE_UNIT_LABEL,
  buildPieceCode,
  buildPiecePrefixKey,
  calculateATP,
  calculateShortage,
  formatCopyNumber,
  formatLength,
  formatPieceDate,
  formatPieceLength,
  MAX_MILLI,
  milliToDecimal,
  PieceATP,
  planCuts,
  toMilli,
  VariationATP,
  ratePerOf,
  type LengthUnit,
  type PieceLite,
  type PlanRequest,
} from "@rs-v31/shared/measure";
import { z } from "zod";
import type { Db, Tx } from "../db.js";
import { audit } from "./audit.js";
import { AppError } from "./errors.js";
import { freeBalances, lockVariations, recordMovements, type MovementInput } from "./stock.js";
import { resolveWarehouse } from "./warehouses.js";

// Measured stock engine (V2 plan §2, owner decisions DM-1…DM-8). Every function runs inside the
// caller's transaction and locks the variation rows first, so concurrent cuts of the same roll
// serialise. Lengths are thousandths of the base unit ("milli") in code and NUMERIC(14,3) in
// the database. Migration 0020 re-checks at commit that each Measured variation's active
// pieces add up to its stock balance.

export interface MeasureCtx {
  companyId: string;
  actorId: string;
  requestId?: string;
}

/** Decimal / number / string → thousandths. */
export const milliOf = (v: Prisma.Decimal | number | string) => toMilli(v.toString());
/** Thousandths → exact NUMERIC string for Prisma. */
export const dec = (m: number) => milliToDecimal(m);
/** Thousandths → plain number for JSON (3 decimals at most, exact in a double). */
export const num = (m: number) => Math.round(m) / 1000;

/** A positive length in base units, at most 3 decimals and 1,000,000 units. */
export const lengthInput = z
  .union([z.number(), z.string().trim().min(1)])
  .transform((v, ctx) => {
    const n = Number(v);
    const m = toMilli(n);
    if (!Number.isFinite(n) || Math.abs(n * 1000 - m) > 1e-6) {
      ctx.addIssue({ code: "custom", message: "Use at most 3 decimal places" });
      return z.NEVER;
    }
    if (m <= 0 || m > MAX_MILLI) {
      ctx.addIssue({ code: "custom", message: "Enter a length greater than 0 and at most 1,000,000" });
      return z.NEVER;
    }
    return m;
  });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const rollInput = z.object({
  length: lengthInput,
  kind: z.enum(["CLOSED", "OPEN"]).default("CLOSED"),
  // An open roll's full length when new (opening / found stock only); `length` is what is left.
  originalLength: lengthInput.nullish(),
  supplierRollNo: optionalText(60),
  rack: optionalText(40),
  notes: optionalText(300),
  // V3.1 warehouses (WH-5): each roll picks its warehouse; default = the receipt's header choice.
  warehouseId: z.string().min(1).nullish(),
});
export type RollInput = z.infer<typeof rollInput>;

// ---------------------------------------------------------------------------
// Variation info
// ---------------------------------------------------------------------------

export interface MeasuredInfo {
  id: string;
  shortName: string;
  groupName: string;
  measured: boolean;
  lengthUnit: LengthUnit | null;
  scrapBelowMilli: number | null;
  decimals: number;
}

/** Product type and length settings of the given variations (company-scoped). */
export async function variationInfo(db: Db, companyId: string, ids: readonly string[]): Promise<Map<string, MeasuredInfo>> {
  if (!ids.length) return new Map();
  const rows = await db.productVariation.findMany({
    where: { companyId, id: { in: [...new Set(ids)] } },
    select: { id: true, shortName: true, group: { select: { name: true, productType: true, lengthUnit: true, scrapBelow: true, lengthDecimals: true } } },
  });
  return new Map(
    rows.map((v) => [
      v.id,
      {
        id: v.id,
        shortName: v.shortName,
        groupName: v.group.name,
        measured: v.group.productType === "measured",
        lengthUnit: v.group.lengthUnit,
        scrapBelowMilli: v.group.scrapBelow ? milliOf(v.group.scrapBelow) : null,
        decimals: v.group.lengthDecimals ?? 3,
      },
    ]),
  );
}

const fmt = (m: number, info: MeasuredInfo) => formatLength(m, info.lengthUnit ?? "m", info.decimals);

async function requireMeasured(tx: Tx, companyId: string, variationId: string) {
  await lockVariations(tx, companyId, [variationId]);
  const info = (await variationInfo(tx, companyId, [variationId])).get(variationId);
  if (!info) throw new AppError(404, "NOT_FOUND", "Product variation not found");
  if (!info.measured) throw new AppError(400, "NOT_MEASURED", `${info.groupName} ${info.shortName} is not a Measured product`);
  return info;
}

/** Locks the piece's variation, then the piece. */
async function lockPiece(tx: Tx, companyId: string, pieceId: string) {
  const head = await tx.measurementPiece.findFirst({ where: { id: pieceId, companyId }, select: { variationId: true } });
  if (!head) throw new AppError(404, "NOT_FOUND", "Roll not found");
  const info = await requireMeasured(tx, companyId, head.variationId);
  const piece = await tx.measurementPiece.findUniqueOrThrow({ where: { id: pieceId } });
  // V3.1: a piece fitted in a set changes only with its set (sale part change, D10).
  if (piece.setId) throw new AppError(409, "PIECE_IN_SET", `${piece.code} is fitted in a set; change it from the set in a sale`);
  return { piece, info };
}

/**
 * Allocates `count` sequence numbers atomically inside the transaction, scoped to (companyId, prefixKey).
 * Rows are locked atomically via PostgreSQL INSERT ... ON CONFLICT DO UPDATE so concurrent requests
 * for identical bundles/variations receive strictly monotonic, non-overlapping sequences.
 * If no piece_counters row exists yet, checks historical measurement_pieces codes to initialize.
 */
export async function allocatePieceSequences(
  tx: Tx,
  companyId: string,
  prefixKey: string,
  count: number,
): Promise<number> {
  if (count <= 0) return 1;

  const existing = await tx.pieceCounter.findUnique({
    where: { companyId_prefixKey: { companyId, prefixKey } },
  });

  if (!existing) {
    const isCut = prefixKey.endsWith("-C");
    const pieces = await tx.measurementPiece.findMany({
      where: {
        companyId,
        code: { startsWith: prefixKey },
      },
      select: { code: true },
    });

    let maxSeq = 0;
    for (const p of pieces) {
      const suffix = isCut
        ? p.code.slice(prefixKey.length)
        : p.code.slice(prefixKey.length).replace(/^-/, "");
      const num = parseInt(suffix, 10);
      if (Number.isFinite(num) && num > maxSeq) {
        maxSeq = num;
      }
    }

    const initialLastValue = maxSeq + count;
    const rows = await tx.$queryRaw<{ last_value: number }[]>`
      INSERT INTO piece_counters (company_id, prefix_key, last_value)
      VALUES (${companyId}, ${prefixKey}, ${initialLastValue})
      ON CONFLICT (company_id, prefix_key)
      DO UPDATE SET last_value = piece_counters.last_value + ${count}
      RETURNING last_value
    `;
    const lastValue = rows[0]?.last_value ?? initialLastValue;
    return lastValue - count + 1;
  } else {
    const rows = await tx.$queryRaw<{ last_value: number }[]>`
      UPDATE piece_counters
      SET last_value = last_value + ${count}
      WHERE company_id = ${companyId} AND prefix_key = ${prefixKey}
      RETURNING last_value
    `;
    const lastValue = rows[0]?.last_value ?? (existing.lastValue + count);
    return lastValue - count + 1;
  }
}

interface LedgerRow {
  pieceId: string;
  variationId: string;
  action: PieceAction;
  beforeMilli: number;
  afterMilli: number;
  relatedPieceId?: string | null;
  saleId?: string | null;
  purchaseId?: string | null;
  /** The document line (sale / purchase rows). */
  lineNo?: number | null;
  reason?: string | null;
  occurredAt?: Date;
  /** V3.1: the piece's warehouse at the time (TRANSFER rows: From, with `toWarehouseId`). */
  warehouseId?: string | null;
  toWarehouseId?: string | null;
  transferId?: string | null;
}

export function ledger(tx: Tx, ctx: MeasureCtx, rows: readonly LedgerRow[]) {
  if (!rows.length) return Promise.resolve({ count: 0 });
  return tx.measurementPieceLedger.createMany({
    data: rows.map((r) => ({
      companyId: ctx.companyId,
      pieceId: r.pieceId,
      variationId: r.variationId,
      action: r.action,
      change: dec(r.afterMilli - r.beforeMilli),
      beforeLength: dec(r.beforeMilli),
      afterLength: dec(r.afterMilli),
      relatedPieceId: r.relatedPieceId ?? null,
      saleId: r.saleId ?? null,
      purchaseId: r.purchaseId ?? null,
      lineNo: r.lineNo ?? null,
      reason: r.reason ?? null,
      warehouseId: r.warehouseId ?? null,
      toWarehouseId: r.toWarehouseId ?? null,
      transferId: r.transferId ?? null,
      createdById: ctx.actorId,
      ...(r.occurredAt ? { occurredAt: r.occurredAt } : {}),
    })),
  });
}

/** New rows for physical pieces (one per roll). Returns them in input order. */
export async function createPieces(
  tx: Tx,
  ctx: MeasureCtx,
  info: MeasuredInfo,
  pieces: readonly {
    lengthMilli: number;
    /** Full length when new, for an open roll already in use; defaults to `lengthMilli`. */
    originalMilli?: number | null;
    kind: PieceKind;
    parentId?: string | null;
    purchaseId?: string | null;
    supplierId?: string | null;
    unitCost?: string | null;
    supplierRollNo?: string | null;
    rack?: string | null;
    notes?: string | null;
    receivedAt?: Date;
    /** V3.1: fitted in this set from the start (set purchase / opening sets). */
    setId?: string | null;
    /** V3.1 (0035): required while warehousing is on, except a cut piece (takes its parent's). */
    warehouseId?: string | null;
  }[],
) {
  if (!pieces.length) return [];
  const now = new Date();

  // Group indices by prefixKey to allocate sequence batches
  const byPrefix = new Map<string, number[]>();
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i]!;
    const date = p.receivedAt ?? now;
    const key = buildPiecePrefixKey(info.shortName, p.lengthMilli, date, p.kind);
    const list = byPrefix.get(key) ?? [];
    list.push(i);
    byPrefix.set(key, list);
  }

  // Allocate sequence blocks per prefixKey
  const codes = new Array<string>(pieces.length);
  for (const [prefixKey, indices] of byPrefix) {
    const startSeq = await allocatePieceSequences(tx, ctx.companyId, prefixKey, indices.length);
    for (let j = 0; j < indices.length; j++) {
      const idx = indices[j]!;
      const p = pieces[idx]!;
      const date = p.receivedAt ?? now;
      codes[idx] = buildPieceCode(info.shortName, p.lengthMilli, date, startSeq + j, p.kind);
    }
  }

  return tx.measurementPiece.createManyAndReturn({
    data: pieces.map((p, i) => ({
      companyId: ctx.companyId,
      variationId: info.id,
      code: codes[i]!,
      kind: p.kind,
      status: "ACTIVE" as const,
      originalLength: dec(p.originalMilli ?? p.lengthMilli),
      remainingLength: dec(p.lengthMilli),
      parentId: p.parentId ?? null,
      purchaseId: p.purchaseId ?? null,
      supplierId: p.supplierId ?? null,
      unitCost: p.unitCost ?? null,
      supplierRollNo: p.supplierRollNo ?? null,
      rack: p.rack ?? null,
      notes: p.notes ?? null,
      setId: p.setId ?? null,
      setOrigin: !!p.setId,
      warehouseId: p.warehouseId ?? null,
      ...(p.kind === "OPEN" ? { openedAt: now, openedById: ctx.actorId } : {}),
      receivedAt: p.receivedAt ?? now,
      createdById: ctx.actorId,
      updatedById: ctx.actorId,
    })),
  });
}

async function setRemaining(tx: Tx, ctx: MeasureCtx, pieceId: string, afterMilli: number, extra: Prisma.MeasurementPieceUpdateInput = {}) {
  await tx.measurementPiece.update({
    where: { id: pieceId },
    data: { remainingLength: dec(afterMilli), status: afterMilli === 0 ? "USED_UP" : "ACTIVE", updatedById: ctx.actorId, ...extra },
  });
}

const openNow = (ctx: MeasureCtx) => ({ kind: "OPEN" as const, openedAt: new Date(), openedById: ctx.actorId });

// ---------------------------------------------------------------------------
// Stock in: rolls already on the rack (W9) and purchase receipts (W12–W13)
// ---------------------------------------------------------------------------

/**
 * Records rolls that are physically present (go-live opening stock or found stock). One piece per
 * roll; one OPENING movement when the variation has no history yet, otherwise one ADJUSTMENT.
 */
export async function addRolls(
  tx: Tx,
  ctx: MeasureCtx,
  variationId: string,
  rolls: readonly RollInput[],
  opts: { unitCost?: string | null; note?: string | null; receivedAt?: Date; warehouseId?: string | null } = {},
) {
  const info = await requireMeasured(tx, ctx.companyId, variationId);
  const total = rolls.reduce((s, r) => s + r.length, 0);
  if (total > MAX_MILLI) throw new AppError(400, "TOO_LONG", "Total length is too large");
  for (const r of rolls) {
    if (r.originalLength == null) continue;
    if (r.kind !== "OPEN" && r.originalLength !== r.length) throw new AppError(400, "BAD_ORIGINAL", "A sealed roll is full: only an open roll has a different full length");
    if (r.originalLength < r.length) throw new AppError(400, "BAD_ORIGINAL", "The full length cannot be less than the length left");
  }
  // V3.1 (WH-12): each roll's warehouse, else the dialog's, else the default (undefined = off).
  const header = await resolveWarehouse(tx, ctx.companyId, opts.warehouseId);
  const whOf = new Map<string, string | undefined>();
  for (const r of rolls) {
    const key = r.warehouseId ?? "";
    if (!whOf.has(key)) whOf.set(key, r.warehouseId ? await resolveWarehouse(tx, ctx.companyId, r.warehouseId) : header);
  }
  const rollWh = (r: RollInput) => whOf.get(r.warehouseId ?? "");
  const created = await createPieces(
    tx,
    ctx,
    info,
    rolls.map((r) => ({
      lengthMilli: r.length,
      originalMilli: r.originalLength ?? null,
      kind: r.kind,
      unitCost: opts.unitCost ?? null,
      supplierRollNo: r.supplierRollNo,
      rack: r.rack,
      notes: r.notes,
      receivedAt: opts.receivedAt,
      warehouseId: rollWh(r) ?? null,
    })),
  );
  // One movement per warehouse: OPENING the first time that warehouse holds this item (0035).
  const perWh = new Map<string | undefined, { milli: number; count: number }>();
  for (const r of rolls) {
    const e = perWh.get(rollWh(r)) ?? { milli: 0, count: 0 };
    perWh.set(rollWh(r), { milli: e.milli + r.length, count: e.count + 1 });
  }
  const movements: MovementInput[] = [];
  let anyHistory = false;
  for (const [warehouseId, e] of perWh) {
    const history = await tx.stockMovement.count({ where: { companyId: ctx.companyId, variationId, ...(warehouseId ? { warehouseId } : {}) } });
    anyHistory ||= history > 0;
    const reason = `${history ? "Rolls added" : "Opening Stock"} (${e.count} roll${e.count > 1 ? "s" : ""})${opts.note ? ` — ${opts.note}` : ""}`;
    movements.push({ variationId, type: history ? "ADJUSTMENT" : "OPENING", quantity: num(e.milli), rate: opts.unitCost ?? null, ratePer: ratePerOf(info.lengthUnit), reason, warehouseId });
  }
  const reason = `${anyHistory ? "Rolls added" : "Opening Stock"} (${rolls.length} roll${rolls.length > 1 ? "s" : ""})${opts.note ? ` — ${opts.note}` : ""}`;
  const change = await recordMovements(tx, ctx.companyId, ctx.actorId, movements, { requestId: ctx.requestId });
  await ledger(
    tx,
    ctx,
    created.map((p) => ({ pieceId: p.id, variationId, action: "ADD" as const, beforeMilli: 0, afterMilli: milliOf(p.remainingLength), reason: opts.note ?? null, warehouseId: p.warehouseId })),
  );
  await audit(tx, {
    companyId: ctx.companyId,
    actorId: ctx.actorId,
    action: "MEASURE_ROLLS_ADD",
    entityType: "ProductVariation",
    entityId: variationId,
    before: { quantity: change[variationId]?.before },
    after: { quantity: change[variationId]?.after, rolls: created.map((p) => ({ code: p.code, length: p.remainingLength.toString(), original: p.originalLength.toString(), kind: p.kind })) },
    reason,
    requestId: ctx.requestId ?? null,
  });
  return created;
}

/**
 * Purchase receipt: one Closed piece per typed roll, linked to the purchase and supplier. The
 * purchase itself records the PURCHASE movement for the line total (createDocument).
 */
export async function receiveRolls(
  tx: Tx,
  ctx: MeasureCtx,
  purchase: { id: string; number: string; supplierId: string | null; date: Date },
  lines: readonly { lineNo: number; variationId: string; rolls: readonly RollInput[]; unitCost: string; warehouseId?: string | null }[],
) {
  // `byWarehouse`: the line's length per warehouse, for its PURCHASE movements (WH-5).
  const out: { lineNo: number; variationId: string; codes: string[]; byWarehouse: Map<string | undefined, number> }[] = [];
  for (const line of lines) {
    const info = await requireMeasured(tx, ctx.companyId, line.variationId);
    const header = await resolveWarehouse(tx, ctx.companyId, line.warehouseId);
    const whs: (string | undefined)[] = [];
    for (const r of line.rolls) whs.push(r.warehouseId ? await resolveWarehouse(tx, ctx.companyId, r.warehouseId) : header);
    const byWarehouse = new Map<string | undefined, number>();
    line.rolls.forEach((r, i) => byWarehouse.set(whs[i], (byWarehouse.get(whs[i]) ?? 0) + r.length));
    const created = await createPieces(
      tx,
      ctx,
      info,
      line.rolls.map((r, i) => ({
        lengthMilli: r.length,
        kind: "CLOSED" as const,
        purchaseId: purchase.id,
        supplierId: purchase.supplierId,
        unitCost: line.unitCost,
        supplierRollNo: r.supplierRollNo,
        rack: r.rack,
        notes: r.notes,
        receivedAt: purchase.date,
        warehouseId: whs[i] ?? null,
      })),
    );
    await ledger(
      tx,
      ctx,
      created.map((p) => ({
        pieceId: p.id,
        variationId: line.variationId,
        action: "RECEIVE" as const,
        beforeMilli: 0,
        afterMilli: milliOf(p.originalLength),
        purchaseId: purchase.id,
        lineNo: line.lineNo,
        reason: purchase.number,
        occurredAt: purchase.date,
        warehouseId: p.warehouseId,
      })),
    );
    out.push({ lineNo: line.lineNo, variationId: line.variationId, codes: created.map((p) => p.code), byWarehouse });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Roll operations (W10–W11)
// ---------------------------------------------------------------------------

function assertActive(piece: { status: string; code: string }) {
  if (piece.status !== "ACTIVE") throw new AppError(409, "PIECE_USED_UP", `${piece.code} is used up`);
}

/** Closed → Open. No length or stock change. */
export async function openPiece(tx: Tx, ctx: MeasureCtx, pieceId: string) {
  const { piece } = await lockPiece(tx, ctx.companyId, pieceId);
  assertActive(piece);
  if (piece.kind !== "CLOSED") throw new AppError(409, "NOT_CLOSED", `${piece.code} is already open`);
  const len = milliOf(piece.remainingLength);
  await tx.measurementPiece.update({ where: { id: piece.id }, data: { ...openNow(ctx), updatedById: ctx.actorId } });
  await ledger(tx, ctx, [{ pieceId: piece.id, variationId: piece.variationId, action: "OPEN", beforeMilli: len, afterMilli: len }]);
  return piece.id;
}

/**
 * Cuts one or more lengths off a piece for stock (no sale). Each length becomes a new Cut piece
 * whose parent is this one; a Closed roll is opened by its first cut. Stock does not change.
 * `writeOffLeftover` writes off whatever remains on the parent (the scrap prompt, DM-7).
 */
export async function cutPiece(
  tx: Tx,
  ctx: MeasureCtx,
  pieceId: string,
  lengths: readonly number[],
  opts: { writeOffLeftover?: boolean; reason?: string | null; date?: Date } = {},
) {
  const { piece, info } = await lockPiece(tx, ctx.companyId, pieceId);
  assertActive(piece);
  const before = milliOf(piece.remainingLength);
  const total = lengths.reduce((s, l) => s + l, 0);
  if (total > before) {
    throw new AppError(409, "CUT_TOO_LONG", `Cutting ${fmt(total, info)} needs more than the ${fmt(before, info)} left on ${piece.code}`);
  }
  const cutDate = opts.date ?? new Date();
  const children = await createPieces(
    tx,
    ctx,
    info,
    lengths.map((l) => ({
      lengthMilli: l,
      kind: "CUT" as const,
      parentId: piece.id,
      supplierId: piece.supplierId,
      unitCost: piece.unitCost?.toString() ?? null,
      rack: piece.rack,
      receivedAt: cutDate,
    })),
  );
  const after = before - total;
  await setRemaining(tx, ctx, piece.id, after, piece.kind === "CLOSED" ? openNow(ctx) : {});
  let running = before;
  const rows: LedgerRow[] = [];
  for (const c of children) {
    const l = milliOf(c.originalLength);
    rows.push({ pieceId: piece.id, variationId: piece.variationId, action: "CUT", beforeMilli: running, afterMilli: running - l, relatedPieceId: c.id, reason: opts.reason ?? null });
    rows.push({ pieceId: c.id, variationId: piece.variationId, action: "CUT", beforeMilli: 0, afterMilli: l, relatedPieceId: piece.id, reason: opts.reason ?? null });
    running -= l;
  }
  await ledger(tx, ctx, rows);
  if (opts.writeOffLeftover && after > 0) await writeOff(tx, ctx, piece.id, "Scrap leftover after cut");
  await audit(tx, {
    companyId: ctx.companyId,
    actorId: ctx.actorId,
    action: "MEASURE_CUT",
    entityType: "MeasurementPiece",
    entityId: piece.id,
    before: { code: piece.code, remaining: num(before) },
    after: { remaining: opts.writeOffLeftover ? 0 : num(after), cuts: children.map((c) => ({ code: c.code, length: num(milliOf(c.originalLength)) })) },
    reason: opts.reason ?? null,
    requestId: ctx.requestId ?? null,
  });
  return children;
}

/** Removes everything left on a piece from stock (damaged, scrap, sample, lost). */
export async function writeOff(tx: Tx, ctx: MeasureCtx, pieceId: string, reason: string) {
  const { piece, info } = await lockPiece(tx, ctx.companyId, pieceId);
  assertActive(piece);
  const before = milliOf(piece.remainingLength);
  const text = `Write off ${piece.code}: ${reason}`.slice(0, 300);
  await setRemaining(tx, ctx, piece.id, 0);
  const warehouseId = piece.warehouseId ?? undefined;
  await recordMovements(tx, ctx.companyId, ctx.actorId, [{ variationId: piece.variationId, type: "ADJUSTMENT", quantity: -num(before), reason: text, warehouseId }], { requestId: ctx.requestId });
  await ledger(tx, ctx, [{ pieceId: piece.id, variationId: piece.variationId, action: "WRITE_OFF", beforeMilli: before, afterMilli: 0, reason, warehouseId }]);
  await audit(tx, {
    companyId: ctx.companyId,
    actorId: ctx.actorId,
    action: "MEASURE_WRITE_OFF",
    entityType: "MeasurementPiece",
    entityId: piece.id,
    before: { code: piece.code, remaining: fmt(before, info) },
    after: { remaining: 0 },
    reason,
    requestId: ctx.requestId ?? null,
  });
}

/** Sets a re-measured length (never above the original). Stock moves by the difference. */
export async function correctLength(tx: Tx, ctx: MeasureCtx, pieceId: string, newMilli: number, note: string) {
  const { piece, info } = await lockPiece(tx, ctx.companyId, pieceId);
  assertActive(piece);
  const before = milliOf(piece.remainingLength);
  const original = milliOf(piece.originalLength);
  if (newMilli < 0 || newMilli > original) throw new AppError(400, "BAD_LENGTH", `The measured length must be between 0 and the original ${fmt(original, info)}`);
  if (newMilli === before) throw new AppError(400, "NO_CHANGES", "The length is unchanged");
  const text = `Length correction ${piece.code}: ${note}`.slice(0, 300);
  await setRemaining(tx, ctx, piece.id, newMilli);
  const warehouseId = piece.warehouseId ?? undefined;
  await recordMovements(tx, ctx.companyId, ctx.actorId, [{ variationId: piece.variationId, type: "ADJUSTMENT", quantity: num(newMilli - before), reason: text, warehouseId }], { requestId: ctx.requestId });
  await ledger(tx, ctx, [{ pieceId: piece.id, variationId: piece.variationId, action: "CORRECTION", beforeMilli: before, afterMilli: newMilli, reason: note, warehouseId }]);
  await audit(tx, {
    companyId: ctx.companyId,
    actorId: ctx.actorId,
    action: "MEASURE_CORRECT",
    entityType: "MeasurementPiece",
    entityId: piece.id,
    before: { code: piece.code, remaining: num(before) },
    after: { remaining: num(newMilli) },
    reason: note,
    requestId: ctx.requestId ?? null,
  });
}

export const pieceEditBody = z
  .object({ rack: optionalText(40).optional(), supplierRollNo: optionalText(60).optional(), notes: optionalText(300).optional() })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Nothing to update");

/** Rack, supplier roll no. and notes are edited directly; recorded in the piece history. */
export async function editPiece(tx: Tx, ctx: MeasureCtx, pieceId: string, body: z.infer<typeof pieceEditBody>) {
  const { piece } = await lockPiece(tx, ctx.companyId, pieceId);
  const changes: string[] = [];
  const data: Prisma.MeasurementPieceUpdateInput = { updatedById: ctx.actorId };
  for (const k of ["rack", "supplierRollNo", "notes"] as const) {
    if (body[k] !== undefined && body[k] !== piece[k]) {
      data[k] = body[k];
      changes.push(`${k}: ${piece[k] ?? "—"} → ${body[k] ?? "—"}`);
    }
  }
  if (!changes.length) throw new AppError(400, "NO_CHANGES", "Nothing changed");
  await tx.measurementPiece.update({ where: { id: piece.id }, data });
  const len = milliOf(piece.remainingLength);
  await ledger(tx, ctx, [{ pieceId: piece.id, variationId: piece.variationId, action: "EDIT", beforeMilli: len, afterMilli: len, reason: changes.join("; ").slice(0, 300) }]);
}

// ---------------------------------------------------------------------------
// Sales (W14–W17) and voids (W18)
// ---------------------------------------------------------------------------

/** Active pieces of the given variations, as the shared planner expects them. */
export async function activePieces(db: Db, companyId: string, variationIds: readonly string[]): Promise<PieceLite[]> {
  const rows = await db.measurementPiece.findMany({
    // V3.1: pieces fitted in sets are never picked for a loose cut or sale.
    where: { companyId, variationId: { in: [...variationIds] }, status: "ACTIVE", setId: null },
    select: { id: true, code: true, variationId: true, kind: true, remainingLength: true, receivedAt: true },
  });
  return rows.map((p) => ({ id: p.id, code: p.code, variationId: p.variationId, kind: p.kind, remainingMilli: milliOf(p.remainingLength), receivedAt: p.receivedAt }));
}

export interface SaleCutLine {
  /** The sale line number, as text (the planner's key). */
  key: string;
  variationId: string;
  lengthMilli: number;
  pieceId?: string | null;
  writeOffLeftover?: boolean;
}

/**
 * Cuts every measured sale line from exactly one piece (DM-4, DM-5). The browser's plan is a
 * preview: the plan is made again here under the variation locks, and a chosen piece that no
 * longer fits is refused with 409 PIECE_CHANGED so the seller can accept a new plan.
 */
export async function cutForSale(tx: Tx, ctx: MeasureCtx, sale: { id: string; number: string; date: Date }, lines: readonly SaleCutLine[]) {
  if (!lines.length) return [];
  const ids = [...new Set(lines.map((l) => l.variationId))];
  await lockVariations(tx, ctx.companyId, ids);
  const infos = await variationInfo(tx, ctx.companyId, ids);
  const pieces = await activePieces(tx, ctx.companyId, ids);
  const requests: PlanRequest[] = lines.map((l) => ({ key: l.key, variationId: l.variationId, lengthMilli: l.lengthMilli, pieceId: l.pieceId ?? null }));
  const { cuts, problems } = planCuts(requests, pieces);
  if (problems.length) {
    const details = problems.map((p) => {
      const info = infos.get(p.variationId)!;
      return { ...p, name: `${info.groupName} ${info.shortName}`, length: num(p.lengthMilli), longest: num(p.longestMilli), unit: BASE_UNIT_LABEL[info.lengthUnit ?? "m"] };
    });
    const first = problems[0]!;
    const info = infos.get(first.variationId)!;
    const name = `${info.groupName} ${info.shortName}`;
    if (first.code === "NO_PIECE_LONG_ENOUGH") {
      const longest = first.longestMilli ? `the longest is ${fmt(first.longestMilli, info)}` : "there are no rolls in stock";
      throw new AppError(409, "NO_PIECE_LONG_ENOUGH", `No ${name} roll is ${fmt(first.lengthMilli, info)} long; ${longest}. Pieces cannot be joined.`, details);
    }
    throw new AppError(409, "PIECE_CHANGED", `The chosen ${name} piece no longer has ${fmt(first.lengthMilli, info)}. Choose the piece again.`, details);
  }

  const byPiece = new Map(pieces.map((p) => [p.id, p]));
  // V3.1 (WH-6): the piece decides the warehouse the line's SALE movement comes from.
  const whRows = await tx.measurementPiece.findMany({ where: { id: { in: [...new Set(cuts.map((c) => c.pieceId))] } }, select: { id: true, warehouseId: true } });
  const whOf = new Map(whRows.map((p) => [p.id, p.warehouseId ?? undefined]));
  const rows: LedgerRow[] = [];
  const finalLeft = new Map<string, number>();
  for (const c of cuts) {
    rows.push({ pieceId: c.pieceId, variationId: c.variationId, action: "SALE", beforeMilli: c.beforeMilli, afterMilli: c.afterMilli, saleId: sale.id, lineNo: Number(c.key), reason: sale.number, occurredAt: sale.date, warehouseId: whOf.get(c.pieceId) });
    finalLeft.set(c.pieceId, c.afterMilli);
  }
  for (const [pieceId, left] of finalLeft) {
    await setRemaining(tx, ctx, pieceId, left, byPiece.get(pieceId)!.kind === "CLOSED" ? openNow(ctx) : {});
  }
  await ledger(tx, ctx, rows);
  // Scrap prompt answered "write off" (DM-7): only what is left after every line of this sale.
  const scrap = new Set(lines.filter((l) => l.writeOffLeftover).map((l) => cuts.find((c) => c.key === l.key)!.pieceId));
  for (const pieceId of scrap) {
    if ((finalLeft.get(pieceId) ?? 0) > 0) await writeOff(tx, ctx, pieceId, `Scrap leftover after ${sale.number}`);
  }
  return cuts.map((c) => ({ ...c, warehouseId: whOf.get(c.pieceId) }));
}

/** Ledger rows that open a Closed roll: Open itself, or a cut / sale taking length off it. */
export const OPENS_ROLL = (action: string, changeMilli: number) => action === "OPEN" || ((action === "CUT" || action === "SALE") && changeMilli < 0);

/** Written on a SALE_VOID row that sealed a roll again (history replays it). */
export const RESEALED = "(sealed again)";

/**
 * Void of a sale (owner rule 2026-10-24), per SALE ledger row:
 *  - the sale took the whole piece (nothing was left on it): that same bundle or cut piece comes
 *    back with its length, and a roll the sale opened is Sealed (Closed) again;
 *  - the sale cut only part of the piece: the length comes back as a NEW Cut piece under the
 *    piece it was cut from (the bundle keeps its reduced length).
 * A whole piece that cannot take its length back (written off or changed since, or moved to
 * another warehouse) also comes back as a new Cut piece. The SALE_VOID stock movement is
 * recorded by voidDocument; sets re-fit their pieces afterwards (restoreSaleSets).
 */
export async function restoreSaleCuts(tx: Tx, ctx: MeasureCtx, sale: { id: string; number: string }, label = `VOID ${sale.number}`) {
  const sold = await tx.measurementPieceLedger.findMany({ where: { companyId: ctx.companyId, saleId: sale.id, action: "SALE" }, orderBy: [{ occurredAt: "asc" }, { lineNo: "asc" }, { id: "asc" }] });
  if (!sold.length) return [];
  await lockVariations(tx, ctx.companyId, [...new Set(sold.map((s) => s.variationId))]);
  const out: { pieceId: string; returnedTo: string; length: number; as: "SAME_PIECE" | "NEW_CUT_PIECE" }[] = [];
  for (const row of sold) {
    const back = -milliOf(row.change);
    const piece = await tx.measurementPiece.findUniqueOrThrow({ where: { id: row.pieceId } });
    // V3.1: the length returns to the warehouse it was sold from (the SALE_VOID movement's).
    // A sale made before warehousing was on: its movement was placed in the first warehouse.
    const soldFrom =
      row.warehouseId ??
      (piece.warehouseId
        ? ((await tx.stockMovement.findFirst({ where: { saleId: sale.id, variationId: row.variationId, movementType: "SALE" }, select: { warehouseId: true } }))?.warehouseId ?? piece.warehouseId)
        : null);
    // The sale emptied the piece and it is still empty (nothing can change a used-up piece).
    const wholePiece = milliOf(row.afterLength) === 0;
    if (wholePiece && piece.status === "USED_UP" && milliOf(piece.remainingLength) === 0 && piece.warehouseId === soldFrom) {
      // Sealed again when this sale is the only thing that ever opened the roll. Ledger times are
      // not used: a sale may be dated earlier than the cuts recorded on the day.
      let reseal = false;
      if (piece.kind === "OPEN") {
        const rows = await tx.measurementPieceLedger.findMany({ where: { pieceId: piece.id }, select: { id: true, action: true, change: true } });
        // Opened while this sale was being saved (not added already open before it).
        const saleAt = (await tx.sale.findUniqueOrThrow({ where: { id: sale.id }, select: { createdAt: true } })).createdAt.getTime();
        const openedBySale = !!piece.openedAt && piece.openedAt.getTime() >= saleAt - 2000;
        reseal = openedBySale && rows.every((b) => b.id === row.id || !OPENS_ROLL(b.action, milliOf(b.change)));
      }
      await setRemaining(tx, ctx, piece.id, back, reseal ? { kind: "CLOSED", openedAt: null, openedById: null } : {});
      await ledger(tx, ctx, [{ pieceId: piece.id, variationId: piece.variationId, action: "SALE_VOID", beforeMilli: 0, afterMilli: back, saleId: sale.id, lineNo: row.lineNo, reason: `${label}${reseal ? ` ${RESEALED}` : ""}`, warehouseId: soldFrom }]);
      out.push({ pieceId: piece.id, returnedTo: piece.code, length: num(back), as: "SAME_PIECE" });
    } else {
      const info = (await variationInfo(tx, ctx.companyId, [piece.variationId])).get(piece.variationId)!;
      const [child] = await createPieces(tx, ctx, info, [{ lengthMilli: back, kind: "CUT", parentId: piece.id, supplierId: piece.supplierId, unitCost: piece.unitCost?.toString() ?? null, rack: piece.rack, notes: `Returned by void of ${sale.number}`, warehouseId: soldFrom }]);
      await ledger(tx, ctx, [{ pieceId: child!.id, variationId: piece.variationId, action: "SALE_VOID", beforeMilli: 0, afterMilli: back, relatedPieceId: piece.id, saleId: sale.id, lineNo: row.lineNo, reason: label, warehouseId: soldFrom }]);
      out.push({ pieceId: child!.id, returnedTo: child!.code, length: num(back), as: "NEW_CUT_PIECE" });
    }
  }
  return out;
}

/**
 * Void of a purchase: allowed only while every roll it created is untouched (still Closed, full
 * length, never cut, sold or corrected). Those rolls become Used up (PURCHASE_VOID ledger row);
 * the PURCHASE_VOID stock movement is recorded by voidDocument.
 */
export async function reversePurchaseRolls(tx: Tx, ctx: MeasureCtx, purchase: { id: string; number: string }) {
  // V3.1: chain pieces bought inside sets are retired with their sets (cancelPurchaseSets).
  const pieces = await tx.measurementPiece.findMany({ where: { companyId: ctx.companyId, purchaseId: purchase.id, setOrigin: false } });
  if (!pieces.length) return [];
  await lockVariations(tx, ctx.companyId, [...new Set(pieces.map((p) => p.variationId))]);
  const fresh = await tx.measurementPiece.findMany({ where: { id: { in: pieces.map((p) => p.id) } }, include: { _count: { select: { children: true } } } });
  const touched = await tx.measurementPieceLedger.groupBy({
    by: ["pieceId"],
    where: { pieceId: { in: pieces.map((p) => p.id) }, action: { notIn: ["RECEIVE", "EDIT"] } },
  });
  const used = new Set(touched.map((t) => t.pieceId));
  const blocked = fresh.filter((p) => used.has(p.id) || p._count.children > 0 || p.kind !== "CLOSED" || p.status !== "ACTIVE" || !p.remainingLength.equals(p.originalLength));
  if (blocked.length) {
    throw new AppError(
      409,
      "STOCK_ALREADY_USED",
      `Cannot cancel this purchase: roll${blocked.length > 1 ? "s" : ""} ${blocked.map((p) => p.code).join(", ")} ${blocked.length > 1 ? "have" : "has"} already been opened, cut, sold or corrected.`,
    );
  }
  for (const p of fresh) await setRemaining(tx, ctx, p.id, 0);
  // Each roll's PURCHASE_VOID row names the line its RECEIVE row did.
  const received = await tx.measurementPieceLedger.findMany({ where: { pieceId: { in: fresh.map((p) => p.id) }, action: "RECEIVE" }, select: { pieceId: true, lineNo: true } });
  const lineOf = new Map(received.map((r) => [r.pieceId, r.lineNo]));
  await ledger(
    tx,
    ctx,
    fresh.map((p) => ({ pieceId: p.id, variationId: p.variationId, action: "PURCHASE_VOID" as const, beforeMilli: milliOf(p.originalLength), afterMilli: 0, purchaseId: purchase.id, lineNo: lineOf.get(p.id) ?? null, reason: `VOID ${purchase.number}` })),
  );
  return fresh.map((p) => p.code);
}

// ---------------------------------------------------------------------------
// Shortage & Available-To-Promise (ATP) queries and Procurement tracking
// ---------------------------------------------------------------------------

/**
 * Returns all active allocations on physical pieces from open customer sale orders.
 */
export async function getActiveAllocations(
  db: Db,
  companyId: string,
  variationIds: readonly string[],
  excludeOrderId?: string,
): Promise<ActiveAllocation[]> {
  if (!variationIds.length) return [];
  const openOrders = await db.order.findMany({
    where: {
      companyId,
      kind: "SALE",
      status: { in: ["PLACED", "ON_DELIVERY", "PARTIALLY_FULFILLED"] },
      ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
    },
    select: {
      id: true,
      lines: {
        where: {
          variationId: { in: [...new Set(variationIds)] },
          pieceId: { not: null },
        },
        select: {
          id: true,
          pieceId: true,
          quantity: true,
          fulfilledQuantity: true,
        },
      },
    },
  });

  const allocations: ActiveAllocation[] = [];
  for (const o of openOrders) {
    for (const l of o.lines) {
      if (l.pieceId) {
        const remainingNeeded = Math.max(0, milliOf(l.quantity) - milliOf(l.fulfilledQuantity));
        if (remainingNeeded > 0) {
          allocations.push({
            pieceId: l.pieceId,
            orderId: o.id,
            orderLineId: l.id,
            lengthMilli: remainingNeeded,
          });
        }
      }
    }
  }
  return allocations;
}

/**
 * Calculates Available-To-Promise (ATP) quantities for the given variations across active pieces,
 * taking into account other open customer order allocations.
 */
export async function getVariationATP(
  db: Db,
  companyId: string,
  variationIds: readonly string[],
  excludeOrderId?: string,
): Promise<Map<string, VariationATP>> {
  if (!variationIds.length) return new Map();
  const pieces = await activePieces(db, companyId, variationIds);
  const allocations = await getActiveAllocations(db, companyId, variationIds, excludeOrderId);

  const byVar = new Map<string, PieceLite[]>();
  for (const vId of variationIds) byVar.set(vId, []);
  for (const p of pieces) byVar.get(p.variationId)?.push(p);

  const result = new Map<string, VariationATP>();
  for (const [vId, pList] of byVar) {
    result.set(vId, calculateATP(pList, allocations));
  }
  return result;
}

export interface LineShortageReport {
  lineNo: number;
  /** The sale-order line this row is for (a by-product row: the set line). */
  orderLineId: string;
  productId: string;
  variationId: string;
  name: string;
  unit: string;
  productType: string;
  /** V3.1 by-product backorder row: the set line it belongs to ("Chain Hoist"); null = the line itself. */
  forSet: string | null;
  orderedQuantity: number;
  fulfilledQuantity: number;
  outstandingQuantity: number;
  physicalStock: number;
  allocatedQuantity: number;
  availableToPromise: number;
  shortageQuantity: number;
  coveredByPOQuantity: number;
  uncoveredShortageQuantity: number;
  canFulfillContinuous: boolean;
  status: "IN_STOCK" | "SHORTAGE" | "PURCHASE_PENDING" | "PARTIALLY_COVERED" | "READY_TO_FULFILL" | "PARTIALLY_FULFILLED" | "FULFILLED" | "CANCELLED";
  linkedPOs: {
    id: string;
    number: string;
    status: string;
    quantity: number;
    expectedDate: string | null;
    supplierName: string | null;
  }[];
}

type ProcuringLine = { variationId: string; quantity: Prisma.Decimal; order: { id: string; number: string; status: string; expectedDate: string | null; partyName: string | null } };

/** Open purchase-order lines of one variation linked to a sale-order line, and what they cover. */
function coverage(procuring: readonly ProcuringLine[], variationId: string) {
  const open = procuring.filter((pl) => pl.variationId === variationId && ["DRAFT", "PLACED", "ON_DELIVERY"].includes(pl.order.status));
  return {
    milli: open.reduce((sum, pl) => sum + milliOf(pl.quantity), 0),
    linkedPOs: open.map((pl) => ({
      id: pl.order.id,
      number: pl.order.number,
      status: pl.order.status,
      quantity: num(milliOf(pl.quantity)),
      expectedDate: pl.order.expectedDate,
      supplierName: pl.order.partyName,
    })),
  };
}

function shortageStatus(orderCancelled: boolean, outstandingMilli: number, fulfilledMilli: number, canFulfill: boolean, shortageMilli: number, coveredMilli: number): LineShortageReport["status"] {
  const uncovered = Math.max(0, shortageMilli - coveredMilli);
  if (orderCancelled) return "CANCELLED";
  if (outstandingMilli === 0) return "FULFILLED";
  if (fulfilledMilli > 0) return "PARTIALLY_FULFILLED";
  if (canFulfill) return "READY_TO_FULFILL";
  if (coveredMilli > 0 && uncovered === 0) return "PURCHASE_PENDING";
  if (coveredMilli > 0) return "PARTIALLY_COVERED";
  if (shortageMilli > 0) return "SHORTAGE";
  return "IN_STOCK";
}

/** A planned set change stored on a sale-order line (order_lines.sets). */
type StoredChange = { byproductId?: string; action?: string; variationId?: string; length?: number; backorder?: boolean };

/**
 * Detailed shortage and procurement tracking for an order. V3.1: a set line whose sets wait for a
 * backordered by-product (no free bundle / stock when the order was taken) gets a row per
 * by-product variation after it, so the bundle to buy is listed and can be ordered.
 */
export async function getShortagesAndProcurement(
  db: Db,
  companyId: string,
  orderId: string,
): Promise<LineShortageReport[]> {
  const o = await db.order.findFirst({
    where: { id: orderId, companyId },
    include: {
      lines: {
        orderBy: { lineNo: "asc" },
        include: {
          variation: {
            select: {
              id: true,
              shortName: true,
              groupId: true,
              group: { select: { name: true, unit: true, productType: true, lengthUnit: true } },
            },
          },
          procuringLines: {
            include: {
              order: {
                select: { id: true, number: true, status: true, expectedDate: true, partyName: true },
              },
            },
          },
        },
      },
    },
  });

  if (!o) throw new AppError(404, "NOT_FOUND", "Order not found");
  const cancelled = o.status === "CANCELLED";

  // Backordered by-products of the set lines still to deliver: lengths (measured) or counts.
  const storedRows = await db.$queryRaw<{ id: string; sets: unknown }[]>`SELECT id, sets FROM order_lines WHERE order_id = ${orderId} AND sets IS NOT NULL`;
  interface StoredSetItem {
    changes?: StoredChange[];
    isWholeBackorder?: boolean;
    combination?: { byproductId: string; variationId: string; length?: number }[];
  }
  const stored = new Map(storedRows.map((r) => [r.id, Array.isArray(r.sets) ? (r.sets as StoredSetItem[]) : []]));
  const backorders = new Map<string, { variationId: string; lengths: number[] }[]>();
  if (o.kind === "SALE") {
    for (const l of o.lines) {
      if (l.variation.group.productType !== "grouped" || milliOf(l.quantity) <= milliOf(l.fulfilledQuantity)) continue;
      const rows: { variationId: string; lengths: number[] }[] = [];
      for (const s of stored.get(l.id) ?? []) {
        if (s.isWholeBackorder && s.combination) {
          for (const item of s.combination) {
            if (!item.variationId) continue;
            let row = rows.find((r) => r.variationId === item.variationId);
            if (!row) rows.push((row = { variationId: item.variationId, lengths: [] }));
            row.lengths.push(item.length ? toMilli(item.length) : 1000);
          }
        }
        for (const c of s.changes ?? []) {
        if (!c.backorder || c.action === "REMOVE" || !c.variationId) continue;
        let row = rows.find((r) => r.variationId === c.variationId);
        if (!row) rows.push((row = { variationId: c.variationId, lengths: [] }));
        // Stored as entered (base units); a counted part is one unit.
        row.lengths.push(c.length ? toMilli(c.length) : 1000);
        }
      }
      if (rows.length) backorders.set(l.id, rows);
    }
  }
  const byVariationIds = [...new Set([...backorders.values()].flat().map((r) => r.variationId))];
  const byVariations = byVariationIds.length
    ? await db.productVariation.findMany({
        where: { companyId, id: { in: byVariationIds } },
        select: { id: true, shortName: true, groupId: true, group: { select: { name: true, unit: true, productType: true } } },
      })
    : [];
  const byVariation = new Map(byVariations.map((v) => [v.id, v]));

  const measuredVariationIds = [
    ...o.lines.filter((l) => l.variation.group.productType === "measured").map((l) => l.variationId),
    ...byVariations.filter((v) => v.group.productType === "measured").map((v) => v.id),
  ];
  const atpMap = await getVariationATP(db, companyId, [...new Set(measuredVariationIds)], orderId);
  // Counted items (lines and backordered set parts): free stock, outside sets.
  const countedFree = await freeBalances(db, companyId, [
    ...new Set([
      ...o.lines.filter((l) => !["measured", "grouped"].includes(l.variation.group.productType)).map((l) => l.variationId),
      ...byVariations.filter((v) => v.group.productType !== "measured").map((v) => v.id),
    ]),
  ]);
  // V3.1 (D23): a sale order's set lines are covered by the sets it holds.
  const held = await db.groupSet.groupBy({ by: ["orderLineNo"], where: { companyId, orderId, status: "HELD" }, _count: true });
  const heldMilli = new Map(held.map((h) => [h.orderLineNo, h._count * 1000]));
  // Bundle length / units already promised to earlier by-product rows of this order (never counted twice).
  const promised = new Map<string, number>();
  const countedLeft = new Map([...countedFree.free].map(([id, q]) => [id, toMilli(q)]));

  return o.lines.flatMap((l): LineShortageReport[] => {
    const isMeasured = l.variation.group.productType === "measured";
    const orderedMilli = milliOf(l.quantity);
    const fulfilledMilli = milliOf(l.fulfilledQuantity);
    const outstandingMilli = Math.max(0, orderedMilli - fulfilledMilli);
    const varAtp = isMeasured ? atpMap.get(l.variationId) : undefined;
    const setsMilli = l.variation.group.productType === "grouped" ? (heldMilli.get(l.lineNo) ?? 0) : null;
    const countedMilli = !isMeasured && setsMilli === null ? Math.max(0, toMilli(countedFree.free.get(l.variationId) ?? 0)) : null;

    const physicalStockMilli = setsMilli ?? countedMilli ?? varAtp?.physicalStockMilli ?? 0;
    const allocatedMilli = varAtp?.allocatedMilli ?? 0;
    const atpMilli = setsMilli ?? countedMilli ?? varAtp?.atpMilli ?? 0;

    // Check if there is an active piece with atp >= outstanding for a continuous cut
    const canFulfillContinuous = isMeasured
      ? !!varAtp?.pieces.some((p) => p.atpMilli >= outstandingMilli)
      : atpMilli >= outstandingMilli;

    const shortageMilli = canFulfillContinuous ? 0 : calculateShortage(outstandingMilli, atpMilli);
    const cover = coverage(l.procuringLines, l.variationId);

    const main: LineShortageReport = {
      lineNo: l.lineNo,
      orderLineId: l.id,
      productId: l.variation.groupId,
      variationId: l.variationId,
      name: `${l.variation.group.name} ${l.variation.shortName}`,
      unit: l.variation.group.unit,
      productType: l.variation.group.productType,
      forSet: null,
      orderedQuantity: num(orderedMilli),
      fulfilledQuantity: num(fulfilledMilli),
      outstandingQuantity: num(outstandingMilli),
      physicalStock: num(physicalStockMilli),
      allocatedQuantity: num(allocatedMilli),
      availableToPromise: num(atpMilli),
      shortageQuantity: num(shortageMilli),
      coveredByPOQuantity: num(cover.milli),
      uncoveredShortageQuantity: num(Math.max(0, shortageMilli - cover.milli)),
      canFulfillContinuous,
      status: shortageStatus(cancelled, outstandingMilli, fulfilledMilli, canFulfillContinuous, shortageMilli, cover.milli),
      linkedPOs: cover.linkedPOs,
    };

    const parts = (backorders.get(l.id) ?? []).flatMap((r): LineShortageReport[] => {
      const v = byVariation.get(r.variationId);
      if (!v) return [];
      const needMilli = r.lengths.reduce((t, x) => t + x, 0);
      let shortMilli = 0;
      let stockMilli = 0;
      let freeMilli = 0;
      if (v.group.productType === "measured") {
        // Each set needs its length from one bundle (pieces are never joined): longest first,
        // each from the shortest bundle that still has it.
        const atp = atpMap.get(r.variationId);
        stockMilli = atp?.physicalStockMilli ?? 0;
        const left = (atp?.pieces ?? []).map((p) => ({ id: p.id, milli: p.atpMilli - (promised.get(p.id) ?? 0) }));
        freeMilli = left.reduce((t, p) => t + Math.max(0, p.milli), 0);
        for (const need of [...r.lengths].sort((a, b) => b - a)) {
          const piece = left.filter((p) => p.milli >= need).sort((a, b) => a.milli - b.milli)[0];
          if (!piece) {
            shortMilli += need;
            continue;
          }
          piece.milli -= need;
          promised.set(piece.id, (promised.get(piece.id) ?? 0) + need);
        }
      } else {
        const free = Math.max(0, countedLeft.get(r.variationId) ?? 0);
        stockMilli = free;
        freeMilli = free;
        shortMilli = Math.max(0, needMilli - free);
        countedLeft.set(r.variationId, Math.max(0, free - needMilli));
      }
      const c = coverage(l.procuringLines, r.variationId);
      return [
        {
          lineNo: l.lineNo,
          orderLineId: l.id,
          productId: v.groupId,
          variationId: v.id,
          name: `${v.group.name} ${v.shortName}`,
          unit: v.group.unit,
          productType: v.group.productType,
          forSet: l.variation.group.name,
          orderedQuantity: num(needMilli),
          fulfilledQuantity: 0,
          outstandingQuantity: num(needMilli),
          physicalStock: num(stockMilli),
          allocatedQuantity: 0,
          availableToPromise: num(freeMilli),
          shortageQuantity: num(shortMilli),
          coveredByPOQuantity: num(c.milli),
          uncoveredShortageQuantity: num(Math.max(0, shortMilli - c.milli)),
          canFulfillContinuous: shortMilli === 0,
          status: shortageStatus(cancelled, needMilli, 0, shortMilli === 0, shortMilli, c.milli),
          linkedPOs: c.linkedPOs,
        },
      ];
    });
    return [main, ...parts];
  });
}

