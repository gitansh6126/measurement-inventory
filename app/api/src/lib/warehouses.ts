import { Prisma } from "@prisma/client";
import { toMilli } from "@rs-v31/shared/measure";
import { z } from "zod";
import type { Db, Tx } from "../db.js";
import { audit } from "./audit.js";
import { AppError } from "./errors.js";

// V3.1 basic warehousing (docs\WAREHOUSE-V3-PLAN.md). Off until the first warehouse is created
// (WH-0); creating it puts all existing stock, rolls and sets in it (WH-1). Company stock stays
// in stock_balances; warehouse_stock_balances holds each warehouse's part (0035 triggers).

export interface Ctx {
  companyId: string;
  actorId: string;
  requestId: string;
}

export interface WarehouseQty {
  warehouseId: string;
  code: string;
  quantity: number;
}

export interface Split {
  warehouseId: string;
  quantity: number;
}

export const splitInput = z.object({ warehouseId: z.string().min(1), quantity: z.number().positive().max(1_000_000) });
export const splitsInput = z.array(splitInput).min(1).max(20);

const code = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z0-9][A-Z0-9-]{0,9}$/.test(v), "Code: up to 10 letters, digits or dashes (e.g. W1)");

export const warehouseBody = z.object({
  code,
  name: z.string().trim().min(1, "Enter a name").max(60),
  address: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
});

export const warehouseUpdate = warehouseBody.partial().extend({ version: z.number().int().positive() });

export async function isWarehousingOn(db: Db, companyId: string): Promise<boolean> {
  const c = await db.company.findUnique({ where: { id: companyId }, select: { warehousingEnabled: true } });
  return !!c?.warehousingEnabled;
}

export async function defaultWarehouse(db: Db, companyId: string) {
  const w = await db.warehouse.findFirst({ where: { companyId, isDefault: true }, select: { id: true, code: true, name: true } });
  if (!w) throw new AppError(409, "NO_DEFAULT_WAREHOUSE", "Choose a default warehouse first");
  return w;
}

/** A warehouse of this company; `active` refuses inactive ones (new receipts, shifts). */
export async function requireWarehouse(db: Db, companyId: string, id: string, opts: { active?: boolean } = {}) {
  const map = await requireWarehouses(db, companyId, [id], opts);
  return map.get(id)!;
}

/**
 * Validates warehouses of this company in one batch; `active` refuses inactive ones.
 * Returns a Map from warehouse ID to the warehouse record.
 * Throws UNKNOWN_WAREHOUSE if any requested ID is missing or belongs to another company.
 * Throws WAREHOUSE_INACTIVE if active is requested and any warehouse is inactive.
 */
export async function requireWarehouses(
  db: Db,
  companyId: string,
  ids: readonly string[],
  opts: { active?: boolean } = {}
): Promise<Map<string, { id: string; code: string; name: string; active: boolean; isDefault: boolean }>> {
  const uniqueIds = [...new Set(ids)];
  const out = new Map<string, { id: string; code: string; name: string; active: boolean; isDefault: boolean }>();
  if (!uniqueIds.length) return out;
  const rows = await db.warehouse.findMany({
    where: { id: { in: uniqueIds }, companyId },
    select: { id: true, code: true, name: true, active: true, isDefault: true },
  });
  for (const r of rows) out.set(r.id, r);
  for (const id of uniqueIds) {
    const w = out.get(id);
    if (!w) throw new AppError(400, "UNKNOWN_WAREHOUSE", "That warehouse was not found");
    if (opts.active && !w.active) throw new AppError(400, "WAREHOUSE_INACTIVE", `${w.code} ${w.name} is inactive`);
  }
  return out;
}

/**
 * The warehouse a new receipt goes to: undefined while warehousing is off (naming one then is a
 * 400), else the chosen active warehouse or the default.
 */
export async function resolveWarehouse(db: Db, companyId: string, id?: string | null): Promise<string | undefined> {
  if (!(await isWarehousingOn(db, companyId))) {
    if (id) throw new AppError(400, "WAREHOUSING_OFF", "Warehousing is not set up yet");
    return undefined;
  }
  return id ? (await requireWarehouse(db, companyId, id, { active: true })).id : (await defaultWarehouse(db, companyId)).id;
}

/** Per-warehouse stock of each variation (rows with a zero balance are left out), code order. */
export async function balancesByWarehouse(db: Db, companyId: string, variationIds: readonly string[]): Promise<Map<string, WarehouseQty[]>> {
  const out = new Map<string, WarehouseQty[]>(variationIds.map((id) => [id, []]));
  if (!variationIds.length) return out;
  const rows = await db.$queryRaw<{ variation_id: string; warehouse_id: string; code: string; quantity: unknown }[]>`
    SELECT b.variation_id, b.warehouse_id, w.code, b.quantity
    FROM warehouse_stock_balances b JOIN warehouses w ON w.id = b.warehouse_id
    WHERE b.company_id = ${companyId} AND b.variation_id = ANY(${[...variationIds]}::text[]) AND b.quantity <> 0
    ORDER BY w.is_default DESC, w.sort_order, w.code`;
  for (const r of rows) out.get(r.variation_id)?.push({ warehouseId: r.warehouse_id, code: r.code, quantity: Number(r.quantity) });
  return out;
}

/** Quantity fitted in sets per (variation, warehouse) — not free to sell or shift loose (GW-4). */
export async function inSetsByWarehouse(db: Db, companyId: string, variationIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!variationIds.length) return out;
  const rows = await db.$queryRaw<{ variation_id: string; warehouse_id: string; q: unknown }[]>`
    SELECT p.variation_id, s.warehouse_id, SUM(p.quantity) AS q
    FROM group_set_parts p JOIN group_sets s ON s.id = p.set_id
    WHERE p.company_id = ${companyId} AND p.status = 'ALLOCATED' AND s.warehouse_id IS NOT NULL
      AND p.variation_id = ANY(${[...variationIds]}::text[])
    GROUP BY p.variation_id, s.warehouse_id`;
  for (const r of rows) out.set(`${r.variation_id}|${r.warehouse_id}`, Number(r.q));
  return out;
}

/**
 * Take-from suggestion (plan §3.1): the default warehouse first, then the others by largest
 * stock. What no warehouse covers stays on the default warehouse (company-wide shortage, WH-6a).
 */
export function suggestSaleSplits(stock: readonly WarehouseQty[], quantity: number, defaultId: string): Split[] {
  const need = toMilli(quantity);
  const ordered = [...stock].filter((s) => s.quantity > 0).sort((a, b) => (a.warehouseId === defaultId ? -1 : b.warehouseId === defaultId ? 1 : b.quantity - a.quantity));
  const out = new Map<string, number>();
  let left = need;
  for (const s of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, toMilli(s.quantity));
    out.set(s.warehouseId, take);
    left -= take;
  }
  if (left > 0) {
    const target = ordered.length ? ordered[0]!.warehouseId : defaultId;
    out.set(target, (out.get(target) ?? 0) + left);
  }
  return [...out].map(([warehouseId, q]) => ({ warehouseId, quantity: q / 1000 }));
}

/** A line's split must add up to its quantity, name each warehouse once, and use positive parts. */
export function validateSplits(label: string, quantity: number, splits: readonly Split[]) {
  const seen = new Set<string>();
  let sum = 0;
  for (const s of splits) {
    if (seen.has(s.warehouseId)) throw new AppError(400, "SPLIT_DUPLICATE", `${label}: a warehouse appears twice in the split`);
    seen.add(s.warehouseId);
    if (!(s.quantity > 0)) throw new AppError(400, "SPLIT_QUANTITY", `${label}: each warehouse part must be more than 0`);
    sum += toMilli(s.quantity);
  }
  if (sum !== toMilli(quantity)) {
    throw new AppError(400, "SPLIT_TOTAL", `${label}: the warehouse split adds up to ${sum / 1000}, not ${quantity}`);
  }
}

/** Warehouses with item counts and stock value (at purchase cost) for the Warehouses page. */
export async function listWarehouses(db: Db, companyId: string) {
  const rows = await db.$queryRaw<
    { id: string; code: string; name: string; address: string | null; is_default: boolean; active: boolean; sort_order: number; version: number; items: bigint; value: unknown; rolls: bigint; sets: bigint }[]
  >`
    SELECT w.id, w.code, w.name, w.address, w.is_default, w.active, w.sort_order, w.version,
      (SELECT COUNT(*) FROM warehouse_stock_balances b WHERE b.warehouse_id = w.id AND b.quantity <> 0) AS items,
      (SELECT COALESCE(SUM(b.quantity * v.purchase_cost), 0) FROM warehouse_stock_balances b
         JOIN product_variations v ON v.id = b.variation_id WHERE b.warehouse_id = w.id AND b.quantity > 0) AS value,
      (SELECT COUNT(*) FROM measurement_pieces p WHERE p.warehouse_id = w.id AND p.status = 'ACTIVE') AS rolls,
      (SELECT COUNT(*) FROM group_sets s WHERE s.warehouse_id = w.id AND s.status IN ('IN_STOCK', 'HELD')) AS sets
    FROM warehouses w WHERE w.company_id = ${companyId}
    ORDER BY w.is_default DESC, w.active DESC, w.sort_order, w.code`;
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    address: r.address,
    isDefault: r.is_default,
    active: r.active,
    sortOrder: r.sort_order,
    version: r.version,
    items: Number(r.items),
    stockValue: Number(r.value).toFixed(2),
    rolls: Number(r.rolls),
    sets: Number(r.sets),
  }));
}

/** Translates the unique-index errors of 0035 into a field message. */
function duplicate(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new AppError(409, "DUPLICATE_WAREHOUSE", "Another warehouse already uses that code or name");
  }
  if (e instanceof Prisma.PrismaClientUnknownRequestError && /warehouses_company_name_ci_key/.test(e.message)) {
    throw new AppError(409, "DUPLICATE_WAREHOUSE", "Another warehouse already uses that name");
  }
  throw e;
}

async function lockCompany(tx: Tx, companyId: string) {
  const rows = await tx.$queryRaw<{ warehousing_enabled: boolean }[]>`SELECT warehousing_enabled FROM companies WHERE id = ${companyId} FOR UPDATE`;
  if (!rows[0]) throw new AppError(404, "NOT_FOUND", "Company not found");
  return rows[0].warehousing_enabled;
}

/**
 * Adds a warehouse. The company's first one turns warehousing on (WH-1) in the same transaction:
 * every existing movement, roll and set is placed in it, its balances are built from the ledger,
 * and both drift views must come back empty. Later warehouses start empty.
 */
export async function createWarehouse(tx: Tx, ctx: Ctx, body: z.infer<typeof warehouseBody>) {
  const { companyId, actorId, requestId } = ctx;
  const enabled = await lockCompany(tx, companyId);
  const count = await tx.warehouse.count({ where: { companyId } });
  let w;
  try {
    w = await tx.warehouse.create({
      data: { companyId, code: body.code, name: body.name, address: body.address, isDefault: !enabled, sortOrder: count, createdById: actorId, updatedById: actorId },
    });
  } catch (e) {
    duplicate(e);
  }
  if (enabled) {
    await audit(tx, { companyId, actorId, action: "WAREHOUSE_CREATE", entityType: "Warehouse", entityId: w.id, after: { code: w.code, name: w.name }, requestId });
    return { warehouse: w, enabled: false };
  }

  // WH-1: switch on, then name the first warehouse everywhere. The 0035 append-only trigger
  // allows exactly this one change on stock_movements (warehouse NULL → this warehouse).
  await tx.company.update({ where: { id: companyId }, data: { warehousingEnabled: true } });
  const moved = await tx.$executeRaw`UPDATE stock_movements SET warehouse_id = ${w.id} WHERE company_id = ${companyId} AND warehouse_id IS NULL`;
  await tx.$executeRaw`
    INSERT INTO warehouse_stock_balances (variation_id, warehouse_id, company_id, quantity, updated_at)
    SELECT variation_id, ${w.id}, company_id, SUM(quantity), CURRENT_TIMESTAMP
    FROM stock_movements WHERE company_id = ${companyId} GROUP BY variation_id, company_id`;
  const rolls = await tx.$executeRaw`UPDATE measurement_pieces SET warehouse_id = ${w.id} WHERE company_id = ${companyId} AND warehouse_id IS NULL`;
  const sets = await tx.$executeRaw`UPDATE group_sets SET warehouse_id = ${w.id} WHERE company_id = ${companyId} AND warehouse_id IS NULL`;
  const drift = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT (SELECT COUNT(*) FROM warehouse_total_drift WHERE company_id = ${companyId})
         + (SELECT COUNT(*) FROM warehouse_balance_drift d JOIN warehouses x ON x.id = d.warehouse_id WHERE x.company_id = ${companyId}) AS n`;
  if (Number(drift[0]?.n ?? 0) > 0) throw new AppError(500, "WAREHOUSE_DRIFT", "Stock did not add up after placing it in the first warehouse; nothing was changed");
  await audit(tx, {
    companyId,
    actorId,
    action: "WAREHOUSING_ENABLED",
    entityType: "Warehouse",
    entityId: w.id,
    after: { code: w.code, name: w.name, movements: moved, rolls, sets },
    requestId,
  });
  return { warehouse: w, enabled: true };
}

async function lockWarehouse(tx: Tx, companyId: string, id: string, version?: number) {
  const rows = await tx.$queryRaw<{ id: string; code: string; name: string; is_default: boolean; active: boolean; version: number }[]>`
    SELECT id, code, name, is_default, active, version FROM warehouses WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`;
  const w = rows[0];
  if (!w) throw new AppError(404, "NOT_FOUND", "Warehouse not found");
  if (version !== undefined && w.version !== version) throw new AppError(409, "STALE", "This warehouse was changed by someone else; reload and try again");
  return w;
}

export async function updateWarehouse(tx: Tx, ctx: Ctx, id: string, body: z.infer<typeof warehouseUpdate>) {
  const before = await lockWarehouse(tx, ctx.companyId, id, body.version);
  try {
    const w = await tx.warehouse.update({
      where: { id },
      data: {
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        version: { increment: 1 },
        updatedById: ctx.actorId,
      },
    });
    await audit(tx, { ...ctx, action: "WAREHOUSE_UPDATE", entityType: "Warehouse", entityId: id, before: { code: before.code, name: before.name }, after: { code: w.code, name: w.name, address: w.address } });
    return w;
  } catch (e) {
    duplicate(e);
  }
}

export async function makeDefault(tx: Tx, ctx: Ctx, id: string) {
  await lockCompany(tx, ctx.companyId);
  const w = await lockWarehouse(tx, ctx.companyId, id);
  if (!w.active) throw new AppError(400, "WAREHOUSE_INACTIVE", "Activate the warehouse before making it the default");
  if (w.is_default) return;
  await tx.warehouse.updateMany({ where: { companyId: ctx.companyId, isDefault: true }, data: { isDefault: false, version: { increment: 1 }, updatedById: ctx.actorId } });
  await tx.warehouse.update({ where: { id }, data: { isDefault: true, version: { increment: 1 }, updatedById: ctx.actorId } });
  await audit(tx, { ...ctx, action: "WAREHOUSE_DEFAULT", entityType: "Warehouse", entityId: id, after: { code: w.code } });
}

/** WH-2 / GW-5: only an empty, non-default warehouse can be deactivated. */
export async function setActive(tx: Tx, ctx: Ctx, id: string, active: boolean) {
  const w = await lockWarehouse(tx, ctx.companyId, id);
  if (w.active === active) return;
  if (!active) {
    if (w.is_default) throw new AppError(409, "WAREHOUSE_DEFAULT", "Make another warehouse the default first");
    const held = await tx.$queryRaw<{ stock: bigint; rolls: bigint; sets: bigint }[]>`
      SELECT (SELECT COUNT(*) FROM warehouse_stock_balances WHERE warehouse_id = ${id} AND quantity <> 0) AS stock,
             (SELECT COUNT(*) FROM measurement_pieces WHERE warehouse_id = ${id} AND status = 'ACTIVE') AS rolls,
             (SELECT COUNT(*) FROM group_sets WHERE warehouse_id = ${id} AND status IN ('IN_STOCK', 'HELD')) AS sets`;
    const h = held[0]!;
    if (Number(h.stock) || Number(h.rolls) || Number(h.sets)) {
      throw new AppError(409, "WAREHOUSE_NOT_EMPTY", `${w.code} still holds stock (${Number(h.stock)} items, ${Number(h.rolls)} rolls, ${Number(h.sets)} sets); shift it out first`);
    }
  }
  await tx.warehouse.update({ where: { id }, data: { active, version: { increment: 1 }, updatedById: ctx.actorId } });
  await audit(tx, { ...ctx, action: active ? "WAREHOUSE_ACTIVATE" : "WAREHOUSE_DEACTIVATE", entityType: "Warehouse", entityId: id, after: { code: w.code } });
}
