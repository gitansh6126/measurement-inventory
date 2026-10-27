import type { MovementType, Role } from "@prisma/client";
import { milliToDecimal, toMilli } from "@rs-v31/shared/measure";
import { z } from "zod";
import type { Db, Tx } from "../db.js";
import { auditMany } from "./audit.js";
import { AppError } from "./errors.js";
import { can } from "./permissions.js";
import { balancesByWarehouse, defaultWarehouse, inSetsByWarehouse, isWarehousingOn, suggestSaleSplits } from "./warehouses.js";

export type StockState = "ok" | "low" | "out" | "negative";

/**
 * main v2 rule: out when quantity ≤ 0; low when quantity ≤ the low-stock threshold
 * (so a new product with threshold 0 and no stock reads as out/low, BR-08a).
 * V2: below zero (an allowed oversell, plan §1.8) is its own state.
 */
export function stockState(quantity: number, threshold: number): StockState {
  if (quantity < 0) return "negative";
  if (quantity <= 0) return "out";
  if (quantity <= threshold) return "low";
  return "ok";
}

/**
 * Current counted stock per variation. V2 reads the stored balance (stock_balances), which
 * the 0007 trigger keeps equal to SUM(movement quantity) in the same statement (plan §1.1).
 */
export async function balances(db: Db, companyId: string, variationIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>(variationIds.map((id) => [id, 0]));
  if (variationIds.length === 0) return out;
  const rows = await db.stockBalance.findMany({
    where: { companyId, variationId: { in: [...variationIds] } },
    select: { variationId: true, quantity: true },
  });
  // NUMERIC(14,3) since 0020 (Measured lengths); whole for counted items.
  for (const r of rows) out.set(r.variationId, Number(r.quantity));
  return out;
}

/**
 * V3.1 sets (plan §1.1): what can be sold or adjusted loose. For a normal variation it is the
 * balance minus the quantity fitted in sets (`inSets`); for a grouped product's variation it is
 * the number of its sets in stock. Screens show this; recordMovements enforces it.
 */
export async function freeBalances(db: Db, companyId: string, variationIds: readonly string[]) {
  const free = new Map<string, number>(variationIds.map((id) => [id, 0]));
  const inSets = new Map<string, number>();
  if (variationIds.length === 0) return { free, inSets };
  const rows = await db.$queryRaw<{ id: string; grouped: boolean; stock: unknown; in_sets: unknown; sets: unknown }[]>`
    SELECT v.id, g.product_type = 'grouped' AS grouped,
      COALESCE(b.quantity, 0) AS stock,
      COALESCE((SELECT SUM(p.quantity) FROM group_set_parts p WHERE p.variation_id = v.id AND p.status = 'ALLOCATED'), 0) AS in_sets,
      (SELECT COUNT(*) FROM group_sets s WHERE s.group_id = g.id AND s.status = 'IN_STOCK') AS sets
    FROM product_variations v
    JOIN product_groups g ON g.id = v.group_id
    LEFT JOIN stock_balances b ON b.variation_id = v.id
    WHERE v.company_id = ${companyId} AND v.id = ANY(${[...variationIds]}::text[])`;
  for (const r of rows) {
    if (r.grouped) {
      free.set(r.id, Number(r.sets));
      continue;
    }
    const held = toMilli(Number(r.in_sets));
    free.set(r.id, (toMilli(Number(r.stock)) - held) / 1000);
    if (held) inSets.set(r.id, held / 1000);
  }
  return { free, inSets };
}

/** V2 counted-stock sales always use Warn & Allow; all sale roles may explicitly confirm. */
export function mayOversell(role: Role): boolean {
  return can(role, "sale.create");
}

export interface RecordOptions {
  // The seller confirmed selling below zero (checkout "sell anyway"). Without it a shortage is
  // still refused, so nothing goes negative by accident even when the policy would allow it.
  allowNegative?: boolean;
  requestId?: string;
  /** V3.1: movements of whole sets (lib/sets.ts) — may move main components and set parts. */
  sets?: boolean;
}

export interface MovementInput {
  variationId: string;
  type: MovementType;
  quantity: number;
  rate?: string | null;
  /** Base units per rate unit of `rate` (12 = per ft on a length in inches, 0028). */
  ratePer?: number;
  reason?: string | null;
  // Exactly one is set for SALE / PURCHASE movements (database check in 0004_documents).
  saleId?: string;
  purchaseId?: string;
  occurredAt?: Date;
  /**
   * V3.1 warehouses (0035): ignored while warehousing is off. On: a receipt or adjustment without
   * one goes to the default warehouse; a SALE without one is split by suggestSaleSplits (default
   * first, then largest free stock).
   */
  warehouseId?: string;
  transferId?: string;
}

/**
 * Locks variations in id order (a fixed order means concurrent writers cannot deadlock)
 * and returns their unit and names. Re-locking inside the same transaction is free.
 */
export async function lockVariations(tx: Tx, companyId: string, variationIds: readonly string[]) {
  const ids = [...new Set(variationIds)].sort();
  const locked = await tx.$queryRaw<{ id: string; unit: string; name: string; short_name: string; product_type: string; owner_group_id: string | null }[]>`
    SELECT v.id, g.unit, g.name, v.short_name, g.product_type::text AS product_type, g.owner_group_id
    FROM product_variations v JOIN product_groups g ON g.id = v.group_id
    WHERE v.company_id = ${companyId} AND v.id = ANY(${ids}::text[])
    ORDER BY v.id
    FOR UPDATE OF v`;
  const info = new Map(locked.map((r) => [r.id, r]));
  if (ids.some((id) => !info.has(id))) throw new AppError(404, "NOT_FOUND", "Product variation not found");
  return info;
}

/**
 * Writes stock movements inside the caller's transaction (so a document and its
 * movements commit together). Variations are locked in id order — a fixed order means
 * two documents touching the same items cannot deadlock — then each balance is checked.
 * The stock_movements trigger re-checks every insert as the final guarantee.
 */
export async function recordMovements(tx: Tx, companyId: string, actorId: string, requested: readonly MovementInput[], opts: RecordOptions = {}) {
  const ids = [...new Set(requested.map((m) => m.variationId))].sort();
  const info = await lockVariations(tx, companyId, ids);
  // V3.1: name a warehouse on every movement while warehousing is on (after the lock, so the
  // stock a sale's split is based on cannot change underneath it).
  const inputs = (await isWarehousingOn(tx, companyId)) ? await placeInWarehouses(tx, companyId, requested) : requested;

  const balance = await balances(tx, companyId, ids);
  // Net effect per variation, so two lines of the same item are checked together. Thousandths
  // (Measured lengths, 0020) keep the arithmetic exact.
  const net = new Map<string, number>();
  for (const m of inputs) net.set(m.variationId, (net.get(m.variationId) ?? 0) + toMilli(m.quantity));

  // V3.1 sets (plan §1.1, D4): a grouped product has no stock of its own and its main component
  // moves only with whole sets; loose movements may never use stock fitted in sets, whatever
  // the negative-stock policy (the deferred 0031 trigger is the final guard).
  if (!opts.sets) {
    const setOnly = ids.map((id) => info.get(id)!).filter((v) => v.product_type === "grouped" || v.owner_group_id);
    if (setOnly.length) {
      const names = setOnly.map((v) => `${v.name} ${v.short_name}`).join(", ");
      throw new AppError(409, "SETS_ONLY", `${names}: stock moves only as whole sets (purchase, opening sets or a set sale)`);
    }
    const out = [...net].filter(([, delta]) => delta < 0).map(([id]) => id);
    if (out.length) {
      const { inSets } = await freeBalances(tx, companyId, out);
      const short = out.filter((id) => inSets.has(id) && toMilli(balance.get(id) ?? 0) - toMilli(inSets.get(id)!) + net.get(id)! < 0);
      if (short.length) {
        const details = short.map((id) => {
          const v = info.get(id)!;
          return { variationId: id, name: v.name, shortName: v.short_name, free: ((toMilli(balance.get(id) ?? 0) - toMilli(inSets.get(id)!)) / 1000), inSets: inSets.get(id)!, requested: -net.get(id)! / 1000 };
        });
        const text = details.map((d) => `${d.name} ${d.shortName} (need ${d.requested}, free ${d.free}, ${d.inSets} in sets)`).join("; ");
        throw new AppError(409, "PARTS_IN_SETS", `Stock fitted in sets cannot be used: ${text}`, details);
      }
    }
  }
  if (inputs.some((m) => m.warehouseId)) await checkWarehouses(tx, companyId, info, inputs, balance, net, opts);
  // Only outgoing items can be short: a receipt into a negative balance always passes.
  const short = [...net].filter(([id, delta]) => delta < 0 && toMilli(balance.get(id) ?? 0) + delta < 0);
  if (short.length) {
    // Below zero is possible only when every short item is being sold (never adjustments).
    const onlySales = short.every(([id]) => inputs.every((m) => m.variationId !== id || m.type === "SALE"));
    let canOversell = false;
    // Measured stock never goes below zero (DM-6; also enforced in 0020).
    const anyMeasured = short.some(([id]) => info.get(id)!.product_type === "measured");
    if (onlySales && !anyMeasured) {
      const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } });
      canOversell = !!actor && mayOversell(actor.role);
    }
    const shortages = short.map(([id, delta]) => {
      const v = info.get(id)!;
      return { variationId: id, name: v.name, shortName: v.short_name, available: balance.get(id) ?? 0, requested: -delta / 1000, canOversell };
    });
    if (!canOversell || !opts.allowNegative) {
      // Message style follows main v2 completeSale: "Insufficient stock: X (need n, have m)".
      const text = shortages.map((s) => `${s.name} ${s.shortName} (need ${s.requested}, have ${s.available})`).join("; ");
      throw new AppError(409, "INSUFFICIENT_STOCK", `Insufficient stock: ${text}`, shortages);
    }
    // Confirmed oversell: one audit row per item taken below zero (plan §1.8).
    const saleId = inputs.find((m) => m.saleId)?.saleId ?? null;
    await auditMany(
      tx,
      shortages.map((s) => ({
        companyId,
        actorId,
        action: "STOCK_NEGATIVE_DISPATCH",
        entityType: "ProductVariation",
        entityId: s.variationId,
        after: { shortName: s.shortName, requestedQty: s.requested, priorBalance: s.available, newBalance: (toMilli(s.available) - toMilli(s.requested)) / 1000, saleId },
        requestId: opts.requestId ?? null,
      })),
    );
  }

  try {
    // One multi-row INSERT (audit B02). The row trigger still checks each row and sees the
    // rows inserted before it in the same statement.
    await tx.stockMovement.createMany({
      data: inputs.map((m) => ({
        companyId,
        variationId: m.variationId,
        movementType: m.type,
        quantity: milliToDecimal(toMilli(m.quantity)),
        unit: info.get(m.variationId)!.unit,
        rate: m.rate ?? null,
        ratePer: m.ratePer ?? 1,
        reason: m.reason ?? null,
        saleId: m.saleId ?? null,
        purchaseId: m.purchaseId ?? null,
        warehouseId: m.warehouseId ?? null,
        transferId: m.transferId ?? null,
        createdById: actorId,
        ...(m.occurredAt ? { occurredAt: m.occurredAt } : {}),
      })),
    });
  } catch (e) {
    if (e instanceof Error && e.message.includes("INSUFFICIENT_STOCK")) {
      throw new AppError(409, "INSUFFICIENT_STOCK", "Insufficient stock");
    }
    throw e;
  }
  return Object.fromEntries([...net].map(([id, delta]) => [id, { before: balance.get(id) ?? 0, after: (toMilli(balance.get(id) ?? 0) + delta) / 1000 }]));
}

/**
 * Fills in the warehouse of movements that name none (warehousing on). Sales are split across
 * warehouses by free stock (balance minus what sits in sets); everything else goes to the default.
 */
async function placeInWarehouses(tx: Tx, companyId: string, inputs: readonly MovementInput[]): Promise<MovementInput[]> {
  if (inputs.every((m) => m.warehouseId)) return [...inputs];
  const def = await defaultWarehouse(tx, companyId);
  const saleIds = [...new Set(inputs.filter((m) => !m.warehouseId && m.type === "SALE").map((m) => m.variationId))];
  const stock = await balancesByWarehouse(tx, companyId, saleIds);
  const inSets = await inSetsByWarehouse(tx, companyId, saleIds);
  // Change already made by earlier movements of this call, per variation|warehouse.
  const used = new Map<string, number>();
  const take = (key: string, milli: number) => used.set(key, (used.get(key) ?? 0) + milli);
  for (const m of inputs) if (m.warehouseId) take(`${m.variationId}|${m.warehouseId}`, toMilli(m.quantity));
  const out: MovementInput[] = [];
  for (const m of inputs) {
    if (m.warehouseId) {
      out.push(m);
    } else if (m.type !== "SALE") {
      out.push({ ...m, warehouseId: def.id });
    } else {
      const free = (stock.get(m.variationId) ?? []).map((w) => {
        const key = `${m.variationId}|${w.warehouseId}`;
        return { ...w, quantity: (toMilli(w.quantity) - toMilli(inSets.get(key) ?? 0) + (used.get(key) ?? 0)) / 1000 };
      });
      for (const s of suggestSaleSplits(free, -m.quantity, def.id)) {
        take(`${m.variationId}|${s.warehouseId}`, -toMilli(s.quantity));
        out.push({ ...m, quantity: -s.quantity, warehouseId: s.warehouseId });
      }
    }
  }
  return out;
}

/**
 * Per-warehouse checks (WH-6a, WH-9, GW-4), before the company-wide ones. A warehouse may not go
 * below zero while the company total covers the movement: the seller splits or shifts first
 * (409 WAREHOUSE_SHORT, listing the other warehouses' stock). Only when the company total itself
 * is short does a sale go on to the company-wide Warn & Allow path (stock in sets stays untouchable).
 */
async function checkWarehouses(
  tx: Tx,
  companyId: string,
  info: Awaited<ReturnType<typeof lockVariations>>,
  inputs: readonly MovementInput[],
  balance: Map<string, number>,
  net: Map<string, number>,
  opts: RecordOptions,
) {
  const ids = [...net.keys()];
  const stock = await balancesByWarehouse(tx, companyId, ids);
  const inSets = opts.sets ? new Map<string, number>() : await inSetsByWarehouse(tx, companyId, ids);
  const wnet = new Map<string, number>();
  for (const m of inputs) {
    const key = `${m.variationId}|${m.warehouseId}`;
    wnet.set(key, (wnet.get(key) ?? 0) + toMilli(m.quantity));
  }
  const codes = new Map((await tx.warehouse.findMany({ where: { companyId }, select: { id: true, code: true } })).map((w) => [w.id, w.code]));
  const short = [];
  for (const [key, delta] of wnet) {
    if (delta >= 0) continue;
    const [variationId, warehouseId] = key.split("|") as [string, string];
    const have = toMilli((stock.get(variationId) ?? []).find((w) => w.warehouseId === warehouseId)?.quantity ?? 0);
    const held = toMilli(inSets.get(key) ?? 0);
    if (have - held + delta >= 0) continue;
    const companyShort = toMilli(balance.get(variationId) ?? 0) + net.get(variationId)! < 0;
    const onlySales = inputs.every((m) => m.variationId !== variationId || m.type === "SALE");
    if (companyShort && onlySales && held === 0) continue;
    const v = info.get(variationId)!;
    short.push({
      variationId,
      name: v.name,
      shortName: v.short_name,
      warehouseId,
      warehouseCode: codes.get(warehouseId) ?? "?",
      available: (have - held) / 1000,
      inSets: held / 1000,
      requested: -delta / 1000,
      otherWarehouses: (stock.get(variationId) ?? [])
        .filter((w) => w.warehouseId !== warehouseId && w.quantity > 0)
        .map((w) => ({ warehouseId: w.warehouseId, code: w.code, quantity: w.quantity })),
    });
  }
  if (!short.length) return;
  const text = short
    .map((s) => {
      const others = s.otherWarehouses.map((o) => `${o.code} has ${o.quantity}`).join(", ");
      return `${s.name} ${s.shortName}: ${s.warehouseCode} has ${s.available}${s.inSets ? ` free (${s.inSets} in sets)` : ""}, need ${s.requested}${others ? ` (${others})` : ""}`;
    })
    .join("; ");
  throw new AppError(409, "WAREHOUSE_SHORT", `Not enough stock in that warehouse; split the line or shift stock first. ${text}`, short);
}

/** Whole, positive quantity of at most one million units (decision D4). */
export const quantity = z.number().int("Quantity must be a whole number").min(1).max(1_000_000);

/** Prices are whole rupees, 0 ≤ x < 10^10. */
export const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d{1,10}$/.test(v), "Enter a whole rupee amount");
