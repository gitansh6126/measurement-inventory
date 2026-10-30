import { Prisma } from "@prisma/client";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, WRITE_TX, type Db } from "../db.js";
import { audit, auditMany } from "../lib/audit.js";
import { requirePermission } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { categoryMatches, inventoryQuery, queryInventory, UNCATEGORIZED, type InventorySummary } from "../lib/inventory-query.js";
import { costFor, customerModeScrub, groupInclude, seesCost, serializeGroup, type SerializedGroup } from "../lib/products.js";
import { can } from "../lib/permissions.js";
import { balances, freeBalances, lockVariations, money, recordMovements, stockState, type StockState } from "../lib/stock.js";
import { ratePerOf, toMilli } from "@rs-v31/shared/measure";
import { balancesByWarehouse, inSetsByWarehouse, isWarehousingOn, resolveWarehouse } from "../lib/warehouses.js";

const adjustBody = z.object({
  variationId: z.string().min(1),
  type: z.enum(["ADJUSTMENT", "OPENING"]).default("ADJUSTMENT"),
  // Signed whole units; positive adds stock, negative removes it.
  quantity: z.number().int("Quantity must be a whole number").min(-1_000_000).max(1_000_000).refine((v) => v !== 0, "Quantity cannot be 0"),
  reason: z.string().trim().max(300).optional(),
  occurredAt: z
    .string()
    .nullish()
    .transform((v) => (v ? new Date(v) : undefined)),
  // V3.1: the warehouse adjusted (default warehouse when omitted; must be omitted while off).
  warehouseId: z.string().min(1).optional(),
});

// BR-08a: an omitted field means "leave alone"; only an explicit value (including 0) is written.
const configureBody = z
  .object({
    salePrice: money.optional(),
    minSalePrice: money.optional(),
    purchaseCost: money.optional(),
    lowStockThreshold: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Nothing to update");

// main v2 StockInPanel + bulkUpdateProductStock (D-21): many variations, new stock level and
// commercial fields, one transaction. Min selling price and supplier purchase rate are not
// in V1 (D5, vendor pricing deferred).
const stockInBody = z.object({
  reason: z.string().trim().min(1).max(100),
  notes: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .transform((v) => v || null),
  rows: z
    .array(
      z.object({
        variationId: z.string().min(1),
        // V3.1 (WH-12): the warehouse this row's stock belongs to; one item may have one row per
        // warehouse. Omitted = the default warehouse. While warehousing is off it must be omitted.
        warehouseId: z.string().min(1).optional(),
        // The stock the user saw; if it moved meanwhile the save is refused (no silent overwrite).
        // A Measured item's stock may be fractional; its stock is never set here (BR-18).
        expectedQuantity: z.number(),
        // New stock level (absolute, as in main v2). Omit to leave stock alone.
        quantity: z.number().int("Quantity must be a whole number").min(0).max(1_000_000).optional(),
        salePrice: money.optional(),
        minSalePrice: money.optional(),
        lowStockThreshold: z.number().int().min(0).max(1_000_000).optional(),
      }),
    )
    .min(1, "Select at least one product")
    .max(500),
});

const movementsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const productMovementsQuery = movementsQuery.extend({ variationId: z.string().min(1).optional() });

const ctx = (req: Request) => ({ companyId: req.auth!.companyId, actorId: req.auth!.userId, requestId: req.requestId });

// BR-18 (main v2): a Measured item's stock changes only through its rolls (add, cut, write off,
// correct length) and documents — never by typing a number.
const measuredByRolls = () =>
  new AppError(409, "USE_ROLLS", "This product is measured: change its stock through its rolls (add rolls, cut, write off or correct a length)");

/** V3.1: each variation's stock per warehouse (`inSets` = fitted in sets there), code order. */
type ByWarehouse = Map<string, { warehouseId: string; code: string; quantity: number; inSets: number }[]>;

async function byWarehouseOf(db: Db, companyId: string, ids: readonly string[]): Promise<ByWarehouse | null> {
  if (!(await isWarehousingOn(db, companyId))) return null;
  const [stock, held] = await Promise.all([balancesByWarehouse(db, companyId, ids), inSetsByWarehouse(db, companyId, ids)]);
  return new Map([...stock].map(([id, rows]) => [id, rows.map((w) => ({ ...w, inSets: held.get(`${id}|${w.warehouseId}`) ?? 0 }))]));
}

type Matches = Awaited<ReturnType<typeof categoryMatches>>;

/**
 * Adds quantity/state per variation and the group roll-up. V3.1 (0038, VC8): under a category of
 * another head, `match` limits the roll-up to the variations in it (`categoryMatch` lists them when
 * not all are) and a grouped product to its sets with a part in it.
 */
function withStock(g: SerializedGroup, qty: Map<string, number>, inSets: Map<string, number> = new Map(), byWh: ByWarehouse | null = null, match: Matches | null = null) {
  // A Measured cost is per rate unit: per ft on a feet + inches product, its stock in inches (0028).
  const ratePer = ratePerOf(g.measure?.lengthUnit);
  // V3.1: quantity = free stock (sets in stock for a grouped product); inSets = fitted in sets.
  // Stock value still counts every unit on hand (parts carry no cost of their own, D11).
  const variations = g.variations.map((v) => {
    const quantity = g.productType === "grouped" && match && !match.variations.has(v.id) ? (match.sets.get(g.id) ?? 0) : (qty.get(v.id) ?? 0);
    const held = inSets.get(v.id) ?? 0;
    const value = g.productType === "grouped" ? 0 : ((quantity + held) * Number(v.purchaseCost)) / ratePer;
    // byWarehouse: null while warehousing is off (WH-0: no warehouse fields anywhere).
    return { ...v, quantity, inSets: held, state: stockState(quantity, v.lowStockThreshold), stockValue: value.toFixed(2), byWarehouse: byWh ? (byWh.get(v.id) ?? []) : null };
  });
  const inCategory = match && g.productType !== "grouped" ? variations.filter((v) => match.variations.has(v.id)) : variations;
  const categoryMatch = inCategory.length < variations.length ? inCategory.map((v) => v.id) : null;
  const pool = inCategory.length ? inCategory : variations;
  const active = pool.filter((v) => v.active);
  const counted = active.length ? active : pool;
  // Thousandths keep a Measured group total exact (no 0.1 + 0.2 drift).
  const quantity = counted.reduce((s, v) => s + Math.round(v.quantity * 1000), 0) / 1000;
  const threshold = Math.min(...counted.map((v) => v.lowStockThreshold));
  const value = counted.reduce((s, v) => s + Number(v.stockValue), 0);
  return { ...g, variations, categoryMatch, quantity, lowStockThreshold: threshold, state: stockState(quantity, threshold) as StockState, stockValue: value.toFixed(2) };
}

/** Loads products by id with stock, keeping the given order (the SQL page order). */
export async function loadStocked(companyId: string, ids: readonly string[], categoryId?: string) {
  if (!ids.length) return [];
  const groups = await prisma.productGroup.findMany({ where: { companyId, id: { in: [...ids] } }, include: groupInclude });
  const vids = groups.flatMap((g) => g.variations.map((v) => v.id));
  const [{ free, inSets }, byWh, match] = await Promise.all([
    freeBalances(prisma, companyId, vids),
    byWarehouseOf(prisma, companyId, vids),
    categoryId && categoryId !== UNCATEGORIZED ? categoryMatches(companyId, vids, categoryId) : null,
  ]);
  const byId = new Map(groups.map((g) => [g.id, withStock(serializeGroup(g), free, inSets, byWh, match)]));
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}

export function inventoryRoutes() {
  const r = Router();

  r.use((req, res, next) => {
    if (req.auth?.isCustomerMode) {
      if (req.method !== "GET") {
        return next(new AppError(403, "CUSTOMER_MODE_RESTRICTED", "Inventory modifications are not allowed in customer mode"));
      }
      const p = req.path;
      const isAllowed = p === "/" || p === "" || /^\/products\/[^/]+$/.test(p);
      if (!isAllowed) {
        return next(new AppError(403, "CUSTOMER_MODE_RESTRICTED", "This inventory data is not available in customer mode"));
      }
    }
    next();
  });

  r.get("/", requirePermission("catalog.view"), async (req, res) => {
    const q = inventoryQuery.parse(req.query);
    const companyId = req.auth!.companyId;
    // Filters, KPIs and paging run in SQL (lib/inventory-query.ts); only the page is loaded here.
    const { ids, total, summary } = await queryInventory(companyId, q);
    const products = await loadStocked(companyId, ids, q.categoryId);
    const out: Partial<InventorySummary> = { ...summary };
    if (!seesCost(req.auth!.role)) delete out.stockValue;
    const sanitize = (p: any) => (req.auth?.isCustomerMode ? customerModeScrub(p) : costFor(req.auth!.role, p));
    res.json({
      products: products.map(sanitize),
      summary: req.auth?.isCustomerMode ? null : out,
      total,
      page: q.page ?? 1,
      pageSize: q.page ? q.pageSize : total,
    });
  });

  r.get("/products/:id", requirePermission("catalog.view"), async (req, res) => {
    const companyId = req.auth!.companyId;
    const g = await prisma.productGroup.findFirst({ where: { id: String(req.params.id), companyId }, include: groupInclude });
    if (!g) throw new AppError(404, "NOT_FOUND", "Product not found");
    const vids = g.variations.map((v) => v.id);
    const [{ free, inSets }, byWh] = await Promise.all([freeBalances(prisma, companyId, vids), byWarehouseOf(prisma, companyId, vids)]);
    const stocked = withStock(serializeGroup(g), free, inSets, byWh);
    const product = req.auth?.isCustomerMode ? customerModeScrub(stocked) : costFor(req.auth!.role, stocked);
    res.json({ product });
  });

  r.get("/variations/:id/movements", requirePermission("catalog.view"), async (req, res) => {
    const { page, pageSize } = movementsQuery.parse(req.query);
    const companyId = req.auth!.companyId;
    const id = String(req.params.id);
    const exists = await prisma.productVariation.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!exists) throw new AppError(404, "NOT_FOUND", "Variation not found");
    // The running balance is computed over all movements before paging.
    const rows = await prisma.$queryRaw<
      {
        id: string;
        movement_type: string;
        quantity: Prisma.Decimal;
        unit: string;
        rate: Prisma.Decimal | null;
        rate_per: number;
        reason: string | null;
        occurred_at: Date;
        actor: string | null;
        sale_id: string | null;
        purchase_id: string | null;
        doc_number: string | null;
        transfer_id: string | null;
        warehouse_code: string | null;
        balance_after: Prisma.Decimal;
      }[]
    >`
      SELECT * FROM (
        SELECT m.id, m.movement_type::text, m.quantity, m.unit, m.rate, m.rate_per, m.reason, m.occurred_at, u.name AS actor,
               m.sale_id, m.purchase_id, COALESCE(s.number, p.number, tr.number) AS doc_number,
               m.transfer_id, w.code AS warehouse_code,
               SUM(m.quantity) OVER (ORDER BY m.occurred_at, m.created_at, m.id) AS balance_after,
               m.created_at
        FROM stock_movements m
        LEFT JOIN users u ON u.id = m.created_by
        LEFT JOIN sales s ON s.id = m.sale_id
        LEFT JOIN purchases p ON p.id = m.purchase_id
        LEFT JOIN stock_transfers tr ON tr.id = m.transfer_id
        LEFT JOIN warehouses w ON w.id = m.warehouse_id
        WHERE m.company_id = ${companyId} AND m.variation_id = ${id}
      ) t
      ORDER BY occurred_at DESC, created_at DESC, id DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    const total = await prisma.stockMovement.count({ where: { companyId, variationId: id } });
    // A PURCHASE movement's rate is the unit cost (audit B05).
    const showCost = seesCost(req.auth!.role);
    res.json({
      movements: rows.map((m) => ({
        id: m.id,
        type: m.movement_type,
        quantity: Number(m.quantity),
        unit: m.unit,
        rate: m.rate === null || (!showCost && m.movement_type === "PURCHASE") ? null : m.rate.toFixed(2),
        // The unit the rate is per: "ft" on a feet + inches line priced per foot (0028).
        rateUnit: m.rate_per === 12 ? "ft" : m.unit,
        reason: m.reason,
        occurredAt: m.occurred_at,
        actor: m.actor,
        balanceAfter: Number(m.balance_after),
        // V3.1: which warehouse the movement was in (null while warehousing is off).
        warehouseCode: m.warehouse_code,
        document: m.sale_id
          ? { kind: "sale" as const, id: m.sale_id, number: m.doc_number ?? m.reason }
          : m.purchase_id
            ? { kind: "purchase" as const, id: m.purchase_id, number: m.doc_number ?? m.reason }
            : m.transfer_id
              ? { kind: "transfer" as const, id: m.transfer_id, number: m.doc_number ?? m.reason }
              : null,
      })),
      total,
      page,
      pageSize,
    });
  });

  // Product page history (catalog browse §2.2): movements of every variation of one product,
  // newest first, optionally one variation. balanceAfter is that variation's running stock.
  r.get("/products/:id/movements", requirePermission("catalog.view"), async (req, res) => {
    const { page, pageSize, variationId } = productMovementsQuery.parse(req.query);
    const companyId = req.auth!.companyId;
    const groupId = String(req.params.id);
    const group = await prisma.productGroup.findFirst({
      where: { id: groupId, companyId },
      select: { id: true, variations: { select: { id: true, shortName: true, attributes: true } } },
    });
    if (!group) throw new AppError(404, "NOT_FOUND", "Product not found");
    if (variationId && !group.variations.some((v) => v.id === variationId)) throw new AppError(404, "NOT_FOUND", "Variation not found in this product");
    const ids = variationId ? [variationId] : group.variations.map((v) => v.id);
    const rows = await prisma.$queryRaw<
      {
        id: string;
        variation_id: string;
        movement_type: string;
        quantity: Prisma.Decimal;
        unit: string;
        rate: Prisma.Decimal | null;
        rate_per: number;
        reason: string | null;
        occurred_at: Date;
        actor: string | null;
        balance_after: Prisma.Decimal;
        sale_id: string | null;
        purchase_id: string | null;
        doc_number: string | null;
        transfer_id: string | null;
        warehouse_code: string | null;
      }[]
    >`
      SELECT * FROM (
        SELECT m.id, m.variation_id, m.movement_type::text, m.quantity, m.unit, m.rate, m.rate_per, m.reason, m.occurred_at,
               u.name AS actor, m.sale_id, m.purchase_id, COALESCE(s.number, p.number, tr.number) AS doc_number,
               m.transfer_id, w.code AS warehouse_code,
               SUM(m.quantity) OVER (PARTITION BY m.variation_id ORDER BY m.occurred_at, m.created_at, m.id) AS balance_after,
               m.created_at
        FROM stock_movements m
        LEFT JOIN users u ON u.id = m.created_by
        LEFT JOIN sales s ON s.id = m.sale_id
        LEFT JOIN purchases p ON p.id = m.purchase_id
        LEFT JOIN stock_transfers tr ON tr.id = m.transfer_id
        LEFT JOIN warehouses w ON w.id = m.warehouse_id
        WHERE m.company_id = ${companyId} AND m.variation_id IN (${Prisma.join(ids)})
      ) t
      ORDER BY occurred_at DESC, created_at DESC, id DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    const total = await prisma.stockMovement.count({ where: { companyId, variationId: { in: ids } } });
    const byVariation = new Map(group.variations.map((v) => [v.id, v]));
    const showCost = seesCost(req.auth!.role);
    res.json({
      movements: rows.map((m) => {
        const v = byVariation.get(m.variation_id)!;
        return {
          id: m.id,
          variation: { id: v.id, shortName: v.shortName, attributes: v.attributes },
          type: m.movement_type,
          quantity: Number(m.quantity),
          unit: m.unit,
          // A PURCHASE movement's rate is the unit cost (audit B05).
          rate: m.rate === null || (!showCost && m.movement_type === "PURCHASE") ? null : m.rate.toFixed(2),
          // The unit the rate is per: "ft" on a feet + inches line priced per foot (0028).
          rateUnit: m.rate_per === 12 ? "ft" : m.unit,
          reason: m.reason,
          occurredAt: m.occurred_at,
          actor: m.actor,
          balanceAfter: Number(m.balance_after),
          warehouseCode: m.warehouse_code,
          document: m.sale_id
            ? { kind: "sale", id: m.sale_id, number: m.doc_number }
            : m.purchase_id
              ? { kind: "purchase", id: m.purchase_id, number: m.doc_number }
              : m.transfer_id
                ? { kind: "transfer", id: m.transfer_id, number: m.doc_number }
                : null,
        };
      }),
      total,
      page,
      pageSize,
    });
  });

  r.post("/adjustments", requirePermission("stock.adjust"), async (req, res) => {
    const body = adjustBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    if (body.type === "ADJUSTMENT" && !body.reason) throw new AppError(400, "REASON_REQUIRED", "Enter a reason for the adjustment");
    if (body.type === "OPENING" && body.quantity < 0) throw new AppError(400, "OPENING_POSITIVE", "Opening stock must be positive");
    const result = await prisma.$transaction(async (tx) => {
      const locked = await lockVariations(tx, companyId, [body.variationId]);
      if (locked.get(body.variationId)!.product_type === "measured") throw measuredByRolls();
      // V3.1: opening stock once per item per warehouse (WH-12).
      const warehouseId = await resolveWarehouse(tx, companyId, body.warehouseId);
      if (body.type === "OPENING") {
        // Lock first, so a concurrent OPENING waits and then sees this one (audit B04).
        await lockVariations(tx, companyId, [body.variationId]);
        const any = await tx.stockMovement.count({ where: { companyId, variationId: body.variationId, ...(warehouseId ? { warehouseId } : {}) } });
        if (any > 0) throw new AppError(409, "OPENING_EXISTS", "This item already has stock history; use an adjustment instead");
      }
      const reason = body.reason || (body.type === "OPENING" ? "Opening stock" : null);
      const change = await recordMovements(tx, companyId, actorId, [{ variationId: body.variationId, type: body.type, quantity: body.quantity, reason, occurredAt: body.occurredAt, warehouseId }]);
      const c = change[body.variationId]!;
      await audit(tx, {
        companyId,
        actorId,
        action: body.type === "OPENING" ? "STOCK_OPENING" : "STOCK_ADJUST",
        entityType: "ProductVariation",
        entityId: body.variationId,
        before: { quantity: c.before },
        after: { quantity: c.after },
        reason,
        requestId,
      });
      return { variationId: body.variationId, ...c };
    }, WRITE_TX).catch((e: unknown) => {
      // The one-OPENING-per-variation index (0006) is the final guard.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new AppError(409, "OPENING_EXISTS", "This item already has stock history; use an adjustment instead");
      }
      throw e;
    });
    res.status(201).json(result);
  });

  r.post("/stock-in", requirePermission("stock.adjust"), async (req, res) => {
    const body = stockInBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    const configures = body.rows.some((r) => r.salePrice !== undefined || r.minSalePrice !== undefined || r.lowStockThreshold !== undefined);
    if (configures && !can(req.auth!.role, "inventory.configure")) throw new AppError(403, "FORBIDDEN", "You cannot change prices");
    const keys = body.rows.map((r) => `${r.variationId}|${r.warehouseId ?? ""}`);
    if (new Set(keys).size !== keys.length) throw new AppError(400, "DUPLICATE_LINE", "A product appears twice for the same warehouse");
    const ids = [...new Set(body.rows.map((r) => r.variationId))];

    const result = await prisma.$transaction(async (tx) => {
      const info = await lockVariations(tx, companyId, ids);
      // V3.1 (WH-12): with warehousing on each row is one warehouse's free stock (balance minus
      // what sits in sets there); off, the company's free stock as before.
      const rowWh = new Map<string, string | undefined>();
      for (const r of body.rows) if (!rowWh.has(r.warehouseId ?? "")) rowWh.set(r.warehouseId ?? "", await resolveWarehouse(tx, companyId, r.warehouseId));
      const whOf = (r: (typeof body.rows)[number]) => rowWh.get(r.warehouseId ?? "");
      if (new Set(body.rows.map((r) => `${r.variationId}|${whOf(r)}`)).size !== body.rows.length) throw new AppError(400, "DUPLICATE_LINE", "A product appears twice for the same warehouse");
      const free = (await freeBalances(tx, companyId, ids)).free;
      const byWh = await byWarehouseOf(tx, companyId, ids);
      const currentOf = (r: (typeof body.rows)[number]) => {
        if (!byWh) return free.get(r.variationId) ?? 0;
        const w = (byWh.get(r.variationId) ?? []).find((x) => x.warehouseId === whOf(r));
        return w ? (toMilli(w.quantity) - toMilli(w.inSets)) / 1000 : 0;
      };
      const current = new Map(body.rows.map((r) => [r, currentOf(r)]));
      const moved = body.rows.filter((r) => r.quantity !== undefined && r.quantity !== current.get(r));
      // Prices and thresholds of a Measured item may be set here (per unit length); its stock may not.
      if (moved.some((r) => info.get(r.variationId)!.product_type === "measured")) throw measuredByRolls();
      if (moved.some((r) => info.get(r.variationId)!.product_type === "grouped")) {
        throw new AppError(409, "USE_SETS", "A grouped product's stock is its sets: add sets by purchase or Add opening sets");
      }
      const stale = body.rows.filter((r) => current.get(r) !== r.expectedQuantity);
      if (stale.length) {
        const list = stale.map((r) => `${info.get(r.variationId)!.short_name} (now ${current.get(r)})`).join(", ");
        throw new AppError(409, "STOCK_CHANGED", `Stock changed since you opened Stock In: ${list}. Refresh and try again.`);
      }
      // Prices and thresholds are company-wide: one setting per item, whichever row carries it.
      const pricedRows = body.rows.filter((r) => r.salePrice !== undefined || r.minSalePrice !== undefined || r.lowStockThreshold !== undefined);
      const priced = [...new Map(pricedRows.map((r) => [r.variationId, r])).values()];
      if (!moved.length && !priced.length) throw new AppError(400, "NO_CHANGES", "No changes to save");

      // Opening stock: first stock ever for an item (in that warehouse), when the reason says so (main v2 "Opening Stock").
      const histories = await tx.stockMovement.groupBy({ by: ["variationId", "warehouseId"], where: { companyId, variationId: { in: ids } }, _count: true });
      const hasHistory = new Set(histories.map((h) => `${h.variationId}|${byWh ? h.warehouseId : ""}`));
      const opening = /^opening stock$/i.test(body.reason);
      const reason = body.notes ? `${body.reason} — ${body.notes}` : body.reason;
      await recordMovements(
        tx,
        companyId,
        actorId,
        moved.map((r) => {
          const delta = r.quantity! - current.get(r)!;
          const type = opening && delta > 0 && !hasHistory.has(`${r.variationId}|${byWh ? whOf(r) : ""}`) ? "OPENING" : "ADJUSTMENT";
          return { variationId: r.variationId, type, quantity: delta, reason, warehouseId: whOf(r) };
        }),
      );

      // One read and one audit insert for the whole batch (audit B02); updates stay per row
      // because each row carries its own values.
      const beforeRows = await tx.productVariation.findMany({ where: { companyId, id: { in: priced.map((r) => r.variationId) } }, select: { id: true, salePrice: true, minSalePrice: true, lowStockThreshold: true } });
      const before = new Map(beforeRows.map((b) => [b.id, b]));
      for (const r of priced) {
        const b = before.get(r.variationId);
        if (b) {
          const effectiveSalePrice = r.salePrice !== undefined ? Number(r.salePrice) : Number(b.salePrice);
          const effectiveMinSalePrice = r.minSalePrice !== undefined ? Number(r.minSalePrice) : Number(b.minSalePrice);
          if (effectiveMinSalePrice > effectiveSalePrice) {
            const name = info.get(r.variationId)?.short_name ?? "Product";
            throw new AppError(400, "INVALID_PRICE", `${name}: minimum selling price (${effectiveMinSalePrice}) cannot be higher than selling price (${effectiveSalePrice})`);
          }
        }
        await tx.productVariation.update({ where: { id: r.variationId }, data: { salePrice: r.salePrice, minSalePrice: r.minSalePrice, lowStockThreshold: r.lowStockThreshold, updatedById: actorId } });
      }
      await auditMany(tx, [
        ...priced.map((r) => {
          const b = before.get(r.variationId)!;
          return {
            companyId,
            actorId,
            action: "INVENTORY_CONFIGURE",
            entityType: "ProductVariation",
            entityId: r.variationId,
            before: { salePrice: b.salePrice.toFixed(2), minSalePrice: b.minSalePrice.toFixed(2), lowStockThreshold: b.lowStockThreshold },
            after: { salePrice: r.salePrice ?? b.salePrice.toFixed(2), minSalePrice: r.minSalePrice ?? b.minSalePrice.toFixed(2), lowStockThreshold: r.lowStockThreshold ?? b.lowStockThreshold },
            requestId,
          };
        }),
        ...moved.map((r) => ({
          companyId,
          actorId,
          action: "STOCK_IN",
          entityType: "ProductVariation",
          entityId: r.variationId,
          before: { quantity: current.get(r) },
          after: { quantity: r.quantity, ...(whOf(r) ? { warehouseId: whOf(r) } : {}) },
          reason,
          requestId,
        })),
      ]);
      return { stockChanged: moved.length, priced: priced.length };
    }, WRITE_TX);
    const parts = [result.stockChanged && `${result.stockChanged} stock level${result.stockChanged > 1 ? "s" : ""} updated`, result.priced && `${result.priced} price setting${result.priced > 1 ? "s" : ""} saved`].filter(Boolean);
    res.json({ ...result, message: parts.join(" · ") });
  });

  r.patch("/variations/:id", requirePermission("inventory.configure"), async (req, res) => {
    const body = configureBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    const select = { id: true, salePrice: true, minSalePrice: true, purchaseCost: true, lowStockThreshold: true } as const;
    const view = (v: { id: string; salePrice: Prisma.Decimal; minSalePrice: Prisma.Decimal; purchaseCost: Prisma.Decimal; lowStockThreshold: number }) => ({
      id: v.id,
      salePrice: v.salePrice.toFixed(2),
      minSalePrice: v.minSalePrice.toFixed(2),
      purchaseCost: v.purchaseCost.toFixed(2),
      lowStockThreshold: v.lowStockThreshold,
    });
    const variation = await prisma.$transaction(async (tx) => {
      const before = await tx.productVariation.findFirst({ where: { id: String(req.params.id), companyId }, select });
      if (!before) throw new AppError(404, "NOT_FOUND", "Variation not found");
      const effectiveSalePrice = body.salePrice !== undefined ? Number(body.salePrice) : Number(before.salePrice);
      const effectiveMinSalePrice = body.minSalePrice !== undefined ? Number(body.minSalePrice) : Number(before.minSalePrice);
      if (effectiveMinSalePrice > effectiveSalePrice) {
        throw new AppError(400, "INVALID_PRICE", `Minimum selling price (${effectiveMinSalePrice}) cannot be higher than selling price (${effectiveSalePrice})`);
      }
      const after = await tx.productVariation.update({ where: { id: before.id }, data: { ...body, updatedById: actorId }, select });
      await audit(tx, { companyId, actorId, action: "INVENTORY_CONFIGURE", entityType: "ProductVariation", entityId: before.id, before: view(before), after: view(after), requestId });
      return view(after);
    });
    res.json({ variation });
  });

  return r;
}
