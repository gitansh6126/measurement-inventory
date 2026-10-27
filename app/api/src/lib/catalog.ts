import { Prisma, type Role } from "@prisma/client";
import { prisma } from "../db.js";
import { rollup, stateCond, type ProductRollup } from "./inventory-query.js";
import { can } from "./permissions.js";
import { seesCost } from "./products.js";
import { stockState } from "./stock.js";

// Catalog browse (v2/docs/catalog-browse/ARCHITECTURE.md §3.2): category rail counts and
// product cards. Both read the inventory roll-up SQL, so a card, a rail count and the
// Stock In tab badges always agree on what "low" or "out" means.

export interface StockCounts {
  productCount: number;
  lowCount: number;
  outCount: number;
  negativeCount: number;
}

const ZERO: StockCounts = { productCount: 0, lowCount: 0, outCount: 0, negativeCount: 0 };

/**
 * Stock counts of ACTIVE products per category (null key = uncategorized) and a cover image per
 * category (its first active product with an image, by name). Low includes out and out includes
 * below zero, as on the Stock In tabs.
 */
export async function categoryStats(companyId: string) {
  const [rows, covers] = await Promise.all([
    prisma.$queryRaw<{ category_id: string | null; products: bigint; low: bigint; out: bigint; negative: bigint }[]>`
      ${rollup(companyId, { status: "active", activity: "all" })}
      SELECT category_id,
        COUNT(*) AS products,
        COUNT(*) FILTER (WHERE ${stateCond("low")}) AS low,
        COUNT(*) FILTER (WHERE ${stateCond("out")}) AS out,
        COUNT(*) FILTER (WHERE ${stateCond("negative")}) AS negative
      FROM gs GROUP BY category_id`,
    prisma.$queryRaw<{ category_id: string; image_url: string }[]>`
      SELECT DISTINCT ON (category_id) category_id, image_url
      FROM product_groups
      WHERE company_id = ${companyId} AND active AND category_id IS NOT NULL AND image_url IS NOT NULL
      ORDER BY category_id, name, id`,
  ]);
  const byCategory = new Map<string | null, StockCounts>();
  const all = { ...ZERO };
  for (const r of rows) {
    const c = { productCount: Number(r.products), lowCount: Number(r.low), outCount: Number(r.out), negativeCount: Number(r.negative) };
    byCategory.set(r.category_id, c);
    all.productCount += c.productCount;
    all.lowCount += c.lowCount;
    all.outCount += c.outCount;
    all.negativeCount += c.negativeCount;
  }
  return {
    counts: (categoryId: string | null) => byCategory.get(categoryId) ?? { ...ZERO },
    covers: new Map(covers.map((c) => [c.category_id, c.image_url])),
    all,
  };
}

const money = (d: Prisma.Decimal | null) => (d === null ? null : new Prisma.Decimal(d).toFixed(2));

/**
 * Product cards for rows from queryInventory, in the same order. A Simple product carries its
 * one variation id so the card can add it to the cart without loading the product.
 */
export async function productCards(companyId: string, role: Role, rows: readonly ProductRollup[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const vendor = can(role, "vendor_pricing.view");
  const [groups, simple, vendorRows] = await Promise.all([
    prisma.productGroup.findMany({
      where: { companyId, id: { in: ids } },
      select: {
        id: true,
        name: true,
        productType: true,
        lengthUnit: true,
        baseShortName: true,
        unit: true,
        imageUrl: true,
        active: true,
        createdAt: true,
        category: { select: { id: true, name: true } },
      },
    }),
    prisma.productVariation.findMany({
      where: { companyId, groupId: { in: ids }, group: { productType: "simple" } },
      select: { id: true, groupId: true },
    }),
    // Vendor pricing roles: lowest / highest active supplier rate and how many suppliers quote
    // it, over the product's active variations (purchase cards show it before the drawer opens).
    vendor
      ? prisma.$queryRaw<{ group_id: string; v_min: Prisma.Decimal; v_max: Prisma.Decimal; suppliers: bigint }[]>`
          SELECT v.group_id, MIN(vp.rate) AS v_min, MAX(vp.rate) AS v_max, COUNT(DISTINCT vp.supplier_id) AS suppliers
          FROM vendor_prices vp
          JOIN product_variations v ON v.id = vp.variation_id
          WHERE vp.company_id = ${companyId} AND vp.active AND v.active AND v.group_id IN (${Prisma.join(ids)})
          GROUP BY v.group_id`
      : Promise.resolve([]),
  ]);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const vendorById = new Map(vendorRows.map((v) => [v.group_id, v]));
  const simpleVariation = new Map(simple.map((v) => [v.groupId, v.id]));
  const cost = seesCost(role);
  return rows.flatMap((r) => {
    const g = byId.get(r.id);
    if (!g) return [];
    return [
      {
        id: g.id,
        name: g.name,
        productType: g.productType,
        // Measured: prices are per m, or per ft on a feet + inches product (0028).
        lengthUnit: g.lengthUnit,
        shortName: g.baseShortName,
        unit: g.unit,
        imageUrl: g.imageUrl,
        active: g.active,
        createdAt: g.createdAt,
        category: g.category,
        variationId: simpleVariation.get(g.id) ?? null,
        activeVariations: r.activeVariations,
        quantity: r.quantity,
        lowStockThreshold: r.threshold,
        state: stockState(r.quantity, r.threshold),
        lowVariations: r.lowVariations,
        outVariations: r.outVariations,
        negativeVariations: r.negativeVariations,
        priceMin: money(r.priceMin),
        priceMax: money(r.priceMax),
        minSalePrice: money(r.minSalePrice),
        ...(cost ? { costMin: money(r.costMin), costMax: money(r.costMax), stockValue: money(r.stockValue) ?? "0.00" } : {}),
        ...(vendor
          ? (() => {
              const v = vendorById.get(g.id);
              return { vendor: v ? { min: money(v.v_min)!, max: money(v.v_max)!, suppliers: Number(v.suppliers) } : null };
            })()
          : {}),
      },
    ];
  });
}
