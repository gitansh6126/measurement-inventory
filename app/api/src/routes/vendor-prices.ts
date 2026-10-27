import { Prisma } from "@prisma/client";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, WRITE_TX } from "../db.js";
import { requirePermission } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { money } from "../lib/stock.js";
import { upsertRate, vendorPriceSelect, type VendorPriceRow } from "../lib/vendor-prices.js";

// Supplier rate cards (V2 plan §4). Revives the paused V1 attempt with its defects fixed:
// a real migration (0010), explicit permissions, positive money schema (no rate 0), the
// supplier taken from the payload with a unique (company, variation, supplier) key, back-
// relations in the schema, and — most important — rates only PREFILL the purchase cart: the
// typed price on a purchase is never overwritten (BR-01 / D19).

const positiveMoney = money.refine((v) => Number(v) > 0, "Rate must be greater than 0");

const upsertBody = z.object({
  variationId: z.string().min(1),
  supplierId: z.string().min(1),
  rate: positiveMoney,
  active: z.boolean().optional().default(true),
  notes: z.string().trim().max(300).nullish().transform((v) => v || null),
});

const batchBody = z.object({
  records: z.array(
    z.object({
      variationId: z.string().min(1),
      supplierId: z.string().min(1),
      rate: positiveMoney,
      active: z.boolean().optional().default(true),
      notes: z.string().trim().max(300).nullish().transform((v) => v || null),
    })
  ).min(1).max(500),
});

const listQuery = z.object({
  variationId: z.string().min(1).optional(),
  supplierId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
});

const sheetQuery = z.object({
  supplierId: z.string().min(1),
  q: z.string().trim().max(100).optional(),
  categoryId: z.string().min(1).optional(),
  scope: z.enum(["priced", "all"]).default("priced"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const bestQuery = z.object({
  variationIds: z
    .string()
    .transform((s) => [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))])
    .refine((a) => a.length > 0 && a.length <= 200, "Give 1 to 200 variation ids"),
  supplierId: z.string().min(1).optional(),
});

const historyQuery = z.object({ variationId: z.string().min(1), supplierId: z.string().min(1).optional() });

const ctx = (req: Request) => ({ companyId: req.auth!.companyId, actorId: req.auth!.userId, requestId: req.requestId });

const view = (r: VendorPriceRow) => ({
  id: r.id,
  variationId: r.variationId,
  supplierId: r.supplierId,
  supplierName: r.supplier.name,
  productId: r.variation.group.id,
  productName: r.variation.group.name,
  unit: r.variation.group.unit,
  shortName: r.variation.shortName,
  attributes: (r.variation.attributes || {}) as Record<string, string>,
  rate: r.rate.toFixed(2),
  active: r.active,
  notes: r.notes,
  effectiveAt: r.effectiveAt,
  updatedAt: r.updatedAt,
});

export function vendorPriceRoutes() {
  const r = Router();

  r.get("/", requirePermission("vendor_pricing.view"), async (req, res) => {
    const q = listQuery.parse(req.query);
    const rows = await prisma.vendorPrice.findMany({
      where: {
        companyId: req.auth!.companyId,
        ...(q.variationId ? { variationId: q.variationId } : {}),
        ...(q.supplierId ? { supplierId: q.supplierId } : {}),
        ...(q.productId ? { variation: { groupId: q.productId } } : {}),
      },
      select: vendorPriceSelect,
      orderBy: [{ rate: "asc" }, { supplier: { name: "asc" } }],
      take: 1000,
    });
    res.json({ prices: rows.map(view) });
  });

  // Supplier sheet grouped by product (paged by product, not variation).
  r.get("/sheet", requirePermission("vendor_pricing.view"), async (req, res) => {
    const q = sheetQuery.parse(req.query);
    const companyId = req.auth!.companyId;

    const where: Prisma.ProductGroupWhereInput = {
      companyId,
      active: true,
      ...(q.categoryId === "none" ? { categoryId: null } : q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.scope === "priced"
        ? {
            variations: {
              some: {
                vendorPrices: {
                  some: {
                    supplierId: q.supplierId,
                    companyId,
                  },
                },
              },
            },
          }
        : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: "insensitive" } },
              { variations: { some: { shortName: { contains: q.q, mode: "insensitive" } } } },
              { variations: { some: { officialSku: { contains: q.q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    };

    const [total, products] = await Promise.all([
      prisma.productGroup.count({ where }),
      prisma.productGroup.findMany({
        where,
        select: {
          id: true,
          name: true,
          unit: true,
          productType: true,
          lengthUnit: true,
          attributeDefinitions: true,
          category: { select: { id: true, name: true } },
          variations: {
            select: {
              id: true,
              shortName: true,
              attributes: true,
              active: true,
              purchaseCost: true,
              sortOrder: true,
              vendorPrices: {
                where: { supplierId: q.supplierId, companyId },
                select: { id: true, rate: true, active: true, notes: true, effectiveAt: true },
                take: 1,
              },
            },
            orderBy: [{ sortOrder: "asc" }, { shortName: "asc" }, { id: "asc" }],
          },
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    const sheetProducts = products.map((p) => {
      const variations = p.variations.map((v) => {
        const vp = v.vendorPrices[0] ?? null;
        return {
          id: v.id,
          shortName: v.shortName,
          attributes: (v.attributes || {}) as Record<string, string>,
          active: v.active,
          purchaseCost: v.purchaseCost.toFixed(2),
          rate: vp
            ? {
                id: vp.id,
                rate: vp.rate.toFixed(2),
                active: vp.active,
                notes: vp.notes,
                effectiveAt: vp.effectiveAt,
              }
            : null,
        };
      });

      const priced = variations.filter((v) => v.rate !== null);
      const pricedRates = priced.map((v) => Number(v.rate!.rate));

      return {
        id: p.id,
        name: p.name,
        unit: p.unit,
        productType: p.productType,
        // Measured rates are per m, or per ft on a feet + inches product (0028).
        lengthUnit: p.lengthUnit,
        category: p.category ? { id: p.category.id, name: p.category.name } : null,
        attributes: (p.attributeDefinitions || []) as unknown[],
        variations,
        pricedCount: priced.length,
        minRate: pricedRates.length > 0 ? Math.min(...pricedRates).toFixed(2) : null,
        maxRate: pricedRates.length > 0 ? Math.max(...pricedRates).toFixed(2) : null,
      };
    });

    res.json({
      products: sheetProducts,
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  });

  // Purchase cart prefill: per variation, the chosen supplier's active rate (if any), the
  // cheapest active rate across suppliers (BR-20), and the effective cost (cheapest, else the
  // variation's default purchase cost). Advisory only. Inactive variations are ignored (F11).
  r.get("/best", requirePermission("vendor_pricing.view"), async (req, res) => {
    const q = bestQuery.parse(req.query);
    const companyId = req.auth!.companyId;
    const [rows, variations] = await Promise.all([
      prisma.vendorPrice.findMany({
        where: {
          companyId,
          variationId: { in: q.variationIds },
          active: true,
          variation: { active: true },
        },
        select: vendorPriceSelect,
      }),
      prisma.productVariation.findMany({
        where: { companyId, id: { in: q.variationIds }, active: true },
        select: { id: true, purchaseCost: true },
      }),
    ]);
    const suggestions = variations.map((v) => {
      const mine = rows.filter((x) => x.variationId === v.id);
      const cheapest = mine.reduce<VendorPriceRow | null>((best, x) => (!best || x.rate.lessThan(best.rate) ? x : best), null);
      const forSupplier = q.supplierId ? mine.find((x) => x.supplierId === q.supplierId) ?? null : null;
      return {
        variationId: v.id,
        supplierRate: forSupplier ? forSupplier.rate.toFixed(2) : null,
        cheapest: cheapest ? { rate: cheapest.rate.toFixed(2), supplierId: cheapest.supplierId, supplierName: cheapest.supplier.name } : null,
        effectiveCost: (cheapest ? cheapest.rate : v.purchaseCost).toFixed(2),
        // What the cart should prefill: this supplier's rate, else the cheapest, else default cost.
        suggested: (forSupplier?.rate ?? cheapest?.rate ?? v.purchaseCost).toFixed(2),
        // Every active supplier rate, cheapest first, for the cart's vendor comparison.
        rates: [...mine]
          .sort((a, b) => a.rate.comparedTo(b.rate) || a.supplier.name.localeCompare(b.supplier.name))
          .map((x) => ({ supplierId: x.supplierId, supplierName: x.supplier.name, rate: x.rate.toFixed(2), effectiveAt: x.effectiveAt })),
      };
    });
    res.json({ suggestions });
  });

  r.get("/history", requirePermission("vendor_pricing.view"), async (req, res) => {
    const q = historyQuery.parse(req.query);
    const companyId = req.auth!.companyId;
    const rows = await prisma.vendorPriceHistory.findMany({
      where: { companyId, variationId: q.variationId, ...(q.supplierId ? { supplierId: q.supplierId } : {}) },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      take: 500,
    });
    const ids = [...new Set(rows.flatMap((x) => [x.supplierId, ...(x.recordedById ? [x.recordedById] : [])]))];
    const [parties, users] = await Promise.all([
      prisma.party.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true } }),
      prisma.user.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, name: true } }),
    ]);
    const name = new Map([...parties, ...users].map((x) => [x.id, x.name]));
    res.json({
      history: rows.map((x) => ({
        id: x.id,
        supplierId: x.supplierId,
        supplierName: name.get(x.supplierId) ?? null,
        rate: x.rate.toFixed(2),
        // 12 = per ft on a feet + inches product; older rows of it (1) are per inch (0028).
        ratePer: x.ratePer,
        active: x.active,
        notes: x.notes,
        recordedAt: x.recordedAt,
        recordedBy: x.recordedById ? name.get(x.recordedById) ?? null : null,
      })),
    });
  });

  // Create or change one supplier's rate for one variation; always appends history.
  r.put("/", requirePermission("vendor_pricing.manage"), async (req, res) => {
    const body = upsertBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    const result = await prisma.$transaction(async (tx) => {
      return upsertRate(tx, { companyId, actorId, requestId }, body);
    }, WRITE_TX);
    res.json({ price: view(result.row) });
  });

  // Batch update supplier rates across multiple products/variations (Inline table Save All).
  // Validates all records first; rejects whole batch on any invalid record or duplicate pair (F2).
  // Skips no-op records and audits only changed records (F3, F4).
  r.put("/batch", requirePermission("vendor_pricing.manage"), async (req, res) => {
    const { records } = batchBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);

    // 1. Check duplicate pairs in payload
    const seenPairs = new Set<string>();
    const details: Array<{ variationId: string; supplierId: string; code: string }> = [];

    for (const rec of records) {
      const pairKey = `${rec.variationId}:${rec.supplierId}`;
      if (seenPairs.has(pairKey)) {
        details.push({ variationId: rec.variationId, supplierId: rec.supplierId, code: "DUPLICATE_RECORD" });
      }
      seenPairs.add(pairKey);
    }

    const suppIds = [...new Set(records.map((rec) => rec.supplierId))];
    const varIds = [...new Set(records.map((rec) => rec.variationId))];

    const [suppliers, variations] = await Promise.all([
      prisma.party.findMany({ where: { id: { in: suppIds }, companyId }, select: { id: true, name: true, active: true, type: true } }),
      prisma.productVariation.findMany({ where: { id: { in: varIds }, companyId }, select: { id: true } }),
    ]);

    const validSuppliers = new Map(suppliers.map((s) => [s.id, s]));
    const validVariations = new Set(variations.map((v) => v.id));

    // 2. Validate all records
    for (const rec of records) {
      if (!validVariations.has(rec.variationId)) {
        details.push({ variationId: rec.variationId, supplierId: rec.supplierId, code: "NOT_FOUND" });
      }
      const supp = validSuppliers.get(rec.supplierId);
      if (!supp || supp.type === "CUSTOMER") {
        details.push({ variationId: rec.variationId, supplierId: rec.supplierId, code: "UNKNOWN_SUPPLIER" });
      } else if (!supp.active && (rec.active ?? true)) {
        details.push({ variationId: rec.variationId, supplierId: rec.supplierId, code: "INACTIVE_PARTY" });
      }
    }

    if (details.length > 0) {
      throw new AppError(400, "INVALID_RECORDS", "Some records in the batch are invalid", details);
    }

    // 3. Apply updates in transaction
    const result = await prisma.$transaction(async (tx) => {
      const updatedRows: VendorPriceRow[] = [];
      let changedCount = 0;
      let unchangedCount = 0;

      for (const rec of records) {
        const supp = validSuppliers.get(rec.supplierId)!;
        const upsertRes = await upsertRate(
          tx,
          {
            companyId,
            actorId,
            requestId,
            supplierName: supp.name,
            skipValidation: true,
          },
          rec
        );

        if (upsertRes.changed) {
          changedCount++;
        } else {
          unchangedCount++;
        }
        updatedRows.push(upsertRes.row);
      }

      return { updatedRows, changedCount, unchangedCount };
    }, WRITE_TX);

    res.json({
      count: result.changedCount,
      unchanged: result.unchangedCount,
      prices: result.updatedRows.map(view),
    });
  });

  return r;
}
