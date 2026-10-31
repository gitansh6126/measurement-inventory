import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { productInCategorySql, variationInCategorySql } from "./category-heads.js";
import { PRODUCT_ACTIVITY_FILTERS, productActivityCondition } from "./product-activity.js";

// Inventory list filters, totals and paging in SQL (V2 plan §1.3, backlog E2). V1 loaded up to
// 1000 products into Node and filtered there; this runs on stock_balances and scales with the
// page size, not the catalog. The list screen, the Negative Stock tab and both PDF exports use
// this one query, so an export always matches what the filters show.
//
// Roll-up rules are V1's (main v2 BR-06a): a product counts its ACTIVE variations (all of them
// if none is active); its quantity is their sum and its threshold the lowest one. A product
// matches a stock filter when either the product roll-up or any active variation matches, so
// one empty variation is never hidden by a full sibling.

// in_stock (catalog chips) = the product has something on hand.
export const STOCK_FILTERS = ["all", "in_stock", "low", "out", "negative"] as const;
export type StockFilter = (typeof STOCK_FILTERS)[number];

// Product order (catalog browse, v2/docs/catalog-browse §3.2). Every order ends on id so paging
// is stable. Prices are the active variations' selling prices.
const SORTS = {
  high_moving: Prisma.sql`sale_count_30d DESC, last_sale_at DESC NULLS LAST, name ASC, id ASC`,
  name: Prisma.sql`name ASC, id ASC`,
  price_asc: Prisma.sql`p_min ASC NULLS LAST, name ASC, id ASC`,
  price_desc: Prisma.sql`p_max DESC NULLS LAST, name ASC, id ASC`,
  stock: Prisma.sql`gq DESC, name ASC, id ASC`,
  stock_low: Prisma.sql`gq ASC, name ASC, id ASC`,
  newest: Prisma.sql`created_at DESC, id DESC`,
} as const;
export const SORT_KEYS = Object.keys(SORTS) as [keyof typeof SORTS, ...(keyof typeof SORTS)[]];
export type SortKey = keyof typeof SORTS;

/** `categoryId=none` selects products without a category. */
export const UNCATEGORIZED = "none";

export const inventoryQuery = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.string().min(1).optional(),
  sort: z.enum(SORT_KEYS).default("high_moving"),
  // low includes out (main v2); out includes negative (nothing on hand); negative = below zero.
  state: z.enum(STOCK_FILTERS).default("all"),
  // main v2 Products page lists active and inactive products together.
  status: z.enum(["active", "archived", "all"]).default("active"),
  activity: z.enum(PRODUCT_ACTIVITY_FILTERS).default("all"),
  // Paging is opt-in so the V1 screen (one full list) keeps working.
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type InventoryQuery = z.infer<typeof inventoryQuery>;

/** Largest unpaged result (full list / PDF export). Above it, callers must page or queue. */
export const MAX_UNPAGED = 10_000;

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Per-product roll-up for one company, filtered by search / category / status (not by stock). */
export function rollup(companyId: string, q: Pick<InventoryQuery, "q" | "categoryId" | "status" | "activity">) {
  // A grouped product's main component exists only inside its sets (V3.1 D4): never listed alone.
  const conds: Prisma.Sql[] = [Prisma.sql`g.company_id = ${companyId}`, Prisma.sql`g.owner_group_id IS NULL`];
  if (q.status !== "all") conds.push(Prisma.sql`g.active = ${q.status === "active"}`);
  if (q.activity !== "all") conds.push(productActivityCondition(q.activity));
  if (q.categoryId === UNCATEGORIZED) conds.push(Prisma.sql`g.category_id IS NULL`);
  // V3.1: a category of any head (Product Type column, a whole-product or variation link, or a
  // set through its parts — 0038, G-A).
  else if (q.categoryId) conds.push(productInCategorySql(Prisma.sql`g.id`, q.categoryId));
  // V3.1 (0038, VC8): under a category of another head only the variations in it (and only the
  // sets with a part in it) count toward the roll-up.
  const cat = q.categoryId && q.categoryId !== UNCATEGORIZED ? q.categoryId : null;
  const variationMatch = cat ? Prisma.sql`(g.product_type = 'grouped' OR ${variationInCategorySql(Prisma.sql`vs.vid`, cat)})` : Prisma.sql`TRUE`;
  const setMatch = cat
    ? Prisma.sql`(EXISTS (SELECT 1 FROM product_groups sg WHERE sg.id = s.group_id AND (sg.category_id = ${cat}
          OR EXISTS (SELECT 1 FROM product_categories spc WHERE spc.product_id = sg.id AND spc.category_id = ${cat})))
        OR EXISTS (SELECT 1 FROM group_set_parts sp WHERE sp.set_id = s.id AND sp.status = 'ALLOCATED'
          AND ${variationInCategorySql(Prisma.sql`sp.variation_id`, cat)}))`
    : Prisma.sql`TRUE`;
  if (q.q) {
    const like = `%${likeEscape(q.q)}%`;
    // Each ILIKE can use the 0008 trigram indexes.
    conds.push(Prisma.sql`(g.name ILIKE ${like} OR EXISTS (
      SELECT 1 FROM product_variations x
      WHERE x.group_id = g.id AND (
        x.short_name ILIKE ${like}
        OR x.official_sku ILIKE ${like}
        OR EXISTS (
          SELECT 1 FROM measurement_pieces mp
          WHERE mp.variation_id = x.id AND (
            mp.code ILIKE ${like}
            OR mp.supplier_roll_no ILIKE ${like}
          )
        )
      )))`);
  }
  return Prisma.sql`
    WITH insets AS (
      -- V3.1: stock fitted in sets is not free (plan §1.1); sets in stock per grouped product.
      SELECT variation_id, SUM(quantity) AS q FROM group_set_parts
      WHERE company_id = ${companyId} AND status = 'ALLOCATED' GROUP BY variation_id
    ),
    setcount AS (
      SELECT s.group_id, COUNT(*) AS n FROM group_sets s
      WHERE s.company_id = ${companyId} AND s.status = 'IN_STOCK' AND ${setMatch} GROUP BY s.group_id
    ),
    -- 0041: each in-stock set's type key, built like lib\set-types.ts setTypeKey (parts sorted
    -- byte-wise, "C" collation = JavaScript's default sort for these ASCII ids).
    setkeys AS (
      SELECT s.group_id, COALESCE(string_agg(
          sp.byproduct_id || ':' || sp.variation_id || ':' || CASE WHEN ppg.product_type = 'measured' THEN ROUND(sp.quantity * 1000)::bigint::text ELSE '' END,
          '|' ORDER BY (sp.byproduct_id || ':' || sp.variation_id || ':' || CASE WHEN ppg.product_type = 'measured' THEN ROUND(sp.quantity * 1000)::bigint::text ELSE '' END) COLLATE "C"
        ), '') AS k
      FROM group_sets s
      LEFT JOIN group_set_parts sp ON sp.set_id = s.id AND sp.role = 'BY' AND sp.status = 'ALLOCATED'
      LEFT JOIN product_variations pv ON pv.id = sp.variation_id
      LEFT JOIN product_groups ppg ON ppg.id = pv.group_id
      WHERE s.company_id = ${companyId} AND s.status = 'IN_STOCK' AND ${setMatch}
      GROUP BY s.group_id, s.id
    ),
    -- 0041: set types with their own minimum stock (standard or priced) that are at or below it.
    typelow AS (
      SELECT t.group_id,
        COUNT(*) FILTER (WHERE COALESCE(c.n, 0) <= t.low_stock_threshold) AS n_low,
        COUNT(*) FILTER (WHERE COALESCE(c.n, 0) <= 0) AS n_out
      FROM group_set_types t
      LEFT JOIN (SELECT group_id, k, COUNT(*) AS n FROM setkeys GROUP BY group_id, k) c ON c.group_id = t.group_id AND c.k = t.type_key
      WHERE t.company_id = ${companyId} AND (t.standard OR c.n IS NOT NULL OR t.low_stock_threshold > 0)
      GROUP BY t.group_id
    ),
    s30 AS (
      SELECT v.group_id,
        COUNT(DISTINCT sl.sale_id) AS sale_count_30d
      FROM sale_lines sl
      JOIN sales s ON s.id = sl.sale_id AND s.company_id = ${companyId}
      JOIN product_variations v ON v.id = sl.variation_id AND v.company_id = ${companyId}
      LEFT JOIN document_voids dv ON dv.sale_id = s.id AND dv.company_id = ${companyId}
      WHERE s.status = 'COMPLETED'
        AND dv.id IS NULL
        AND s.sale_date >= (CURRENT_TIMESTAMP - INTERVAL '30 days')
      GROUP BY v.group_id
    ),
    vs AS (
      SELECT v.id AS vid, v.group_id, v.active, v.low_stock_threshold AS t,
        CASE WHEN pg.product_type = 'grouped' THEN COALESCE(sc.n, 0)
             ELSE COALESCE(b.quantity, 0) - COALESCE(i.q, 0) END AS q,
        v.purchase_cost AS c, v.sale_price AS sp, v.min_sale_price AS msp,
        -- Value = stock ÷ rate_per × cost: a feet + inches cost is per ft, its stock in inches (0028).
        COALESCE(b.quantity, 0) * v.purchase_cost / measure_rate_per(pg.length_unit) AS val
      FROM product_variations v
      JOIN product_groups pg ON pg.id = v.group_id
      LEFT JOIN stock_balances b ON b.variation_id = v.id
      LEFT JOIN insets i ON i.variation_id = v.id
      LEFT JOIN setcount sc ON sc.group_id = pg.id
      WHERE v.company_id = ${companyId}
    ),
    gs AS (
      SELECT g.id, g.name, g.category_id, g.created_at, g.last_sale_at,
        COALESCE(MAX(s30.sale_count_30d), 0) AS sale_count_30d,
        CASE WHEN bool_or(vs.active) THEN SUM(vs.q) FILTER (WHERE vs.active) ELSE SUM(vs.q) END AS gq,
        CASE WHEN bool_or(vs.active) THEN MIN(vs.t) FILTER (WHERE vs.active) ELSE MIN(vs.t) END AS gt,
        CASE WHEN bool_or(vs.active) THEN SUM(vs.val) FILTER (WHERE vs.active) ELSE SUM(vs.val) END AS gv,
        COUNT(*) FILTER (WHERE vs.active AND vs.q <= vs.t) + COALESCE(MAX(tl.n_low), 0) AS v_low,
        COUNT(*) FILTER (WHERE vs.active AND vs.q <= 0) + COALESCE(MAX(tl.n_out), 0) AS v_out,
        COUNT(*) FILTER (WHERE vs.active AND vs.q < 0) AS v_neg,
        COUNT(*) FILTER (WHERE vs.active) AS v_active,
        MIN(vs.sp) FILTER (WHERE vs.active) AS p_min,
        MAX(vs.sp) FILTER (WHERE vs.active) AS p_max,
        MIN(NULLIF(vs.msp, 0)) FILTER (WHERE vs.active) AS min_sale_price,
        MIN(vs.c) FILTER (WHERE vs.active) AS c_min,
        MAX(vs.c) FILTER (WHERE vs.active) AS c_max
      FROM product_groups g
      JOIN vs ON vs.group_id = g.id AND ${variationMatch}
      LEFT JOIN typelow tl ON tl.group_id = g.id
      LEFT JOIN s30 ON s30.group_id = g.id
      WHERE ${Prisma.join(conds, " AND ")}
      GROUP BY g.id, g.name, g.category_id, g.created_at, g.last_sale_at
    )`;
}

export function stateCond(state: StockFilter) {
  if (state === "low") return Prisma.sql`(gq <= gt OR v_low > 0)`;
  if (state === "out") return Prisma.sql`(gq <= 0 OR v_out > 0)`;
  if (state === "negative") return Prisma.sql`(gq < 0 OR v_neg > 0)`;
  if (state === "in_stock") return Prisma.sql`(gq > 0)`;
  return Prisma.sql`TRUE`;
}

export interface InventorySummary {
  products: number;
  low: number;
  out: number;
  negative: number;
  variationsLow: number;
  variationsOut: number;
  variationsNegative: number;
  stockValue: string;
  // Rows each stock tab lists (product OR any active variation matches) — the tab badges.
  tabs: Record<StockFilter, number>;
}

/** One product's roll-up as the catalog cards need it (no variation rows). */
export interface ProductRollup {
  id: string;
  quantity: number;
  threshold: number;
  stockValue: Prisma.Decimal | null;
  lowVariations: number;
  outVariations: number;
  negativeVariations: number;
  activeVariations: number;
  priceMin: Prisma.Decimal | null;
  priceMax: Prisma.Decimal | null;
  minSalePrice: Prisma.Decimal | null;
  costMin: Prisma.Decimal | null;
  costMax: Prisma.Decimal | null;
  saleCount30d: number;
}

/**
 * Matching product ids in the requested order (default name, id) for the requested page (or all of them,
 * up to MAX_UNPAGED), the total match count, and KPIs over the search/category/status set.
 */
export async function queryInventory(companyId: string, q: InventoryQuery) {
  const base = rollup(companyId, q);
  const where = stateCond(q.state);
  const limit = q.page ? q.pageSize : MAX_UNPAGED;
  const offset = q.page ? (q.page - 1) * q.pageSize : 0;
  const [ids, counts] = await Promise.all([
    prisma.$queryRaw<
      {
        id: string;
        sale_count_30d: bigint;
        gq: bigint;
        gt: number;
        gv: Prisma.Decimal | null;
        v_low: bigint;
        v_out: bigint;
        v_neg: bigint;
        v_active: bigint;
        p_min: Prisma.Decimal | null;
        p_max: Prisma.Decimal | null;
        min_sale_price: Prisma.Decimal | null;
        c_min: Prisma.Decimal | null;
        c_max: Prisma.Decimal | null;
      }[]
    >`${base}
      SELECT id, sale_count_30d, gq, gt, gv, v_low, v_out, v_neg, v_active, p_min, p_max, min_sale_price, c_min, c_max
      FROM gs WHERE ${where} ORDER BY ${SORTS[q.sort]} LIMIT ${limit} OFFSET ${offset}`,
    prisma.$queryRaw<
      {
        matched: bigint;
        products: bigint;
        low: bigint;
        out: bigint;
        negative: bigint;
        v_low: bigint | null;
        v_out: bigint | null;
        v_neg: bigint | null;
        value: Prisma.Decimal | null;
        t_in: bigint;
        t_low: bigint;
        t_out: bigint;
        t_neg: bigint;
      }[]
    >`${base}
      SELECT
        COUNT(*) FILTER (WHERE ${where}) AS matched,
        COUNT(*) FILTER (WHERE ${stateCond("in_stock")}) AS t_in,
        COUNT(*) FILTER (WHERE ${stateCond("low")}) AS t_low,
        COUNT(*) FILTER (WHERE ${stateCond("out")}) AS t_out,
        COUNT(*) FILTER (WHERE ${stateCond("negative")}) AS t_neg,
        COUNT(*) AS products,
        COUNT(*) FILTER (WHERE gq <= gt) AS low,
        COUNT(*) FILTER (WHERE gq <= 0) AS out,
        COUNT(*) FILTER (WHERE gq < 0) AS negative,
        SUM(v_low) AS v_low, SUM(v_out) AS v_out, SUM(v_neg) AS v_neg,
        SUM(gv) AS value
      FROM gs`,
  ]);
  const c = counts[0]!;
  const summary: InventorySummary = {
    products: Number(c.products),
    low: Number(c.low),
    out: Number(c.out),
    negative: Number(c.negative),
    variationsLow: Number(c.v_low ?? 0),
    variationsOut: Number(c.v_out ?? 0),
    variationsNegative: Number(c.v_neg ?? 0),
    stockValue: new Prisma.Decimal(c.value ?? 0).toFixed(2),
    tabs: { all: Number(c.products), in_stock: Number(c.t_in), low: Number(c.t_low), out: Number(c.t_out), negative: Number(c.t_neg) },
  };
  const rows: ProductRollup[] = ids.map((r) => ({
    id: r.id,
    quantity: Number(r.gq),
    threshold: Number(r.gt),
    stockValue: r.gv,
    lowVariations: Number(r.v_low),
    outVariations: Number(r.v_out),
    negativeVariations: Number(r.v_neg),
    activeVariations: Number(r.v_active),
    priceMin: r.p_min,
    priceMax: r.p_max,
    minSalePrice: r.min_sale_price,
    costMin: r.c_min,
    costMax: r.c_max,
    saleCount30d: Number(r.sale_count_30d ?? 0),
  }));
  return { ids: rows.map((r) => r.id), rows, total: Number(c.matched), summary };
}

/**
 * V3.1 (0038, VC8): which of the given variations are in a category (either level), and per
 * grouped product how many sets in stock it holds there (the set itself, or a part in it).
 */
export async function categoryMatches(companyId: string, variationIds: readonly string[], categoryId: string) {
  if (!variationIds.length) return { variations: new Set<string>(), sets: new Map<string, number>() };
  const [vars, sets] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT v.id FROM product_variations v
      WHERE v.company_id = ${companyId} AND v.id = ANY(${[...variationIds]}::text[])
        AND ${variationInCategorySql(Prisma.sql`v.id`, categoryId)}`,
    prisma.$queryRaw<{ group_id: string; n: bigint }[]>`
      SELECT s.group_id, COUNT(*) AS n FROM group_sets s
      JOIN product_variations gv ON gv.group_id = s.group_id
      WHERE s.company_id = ${companyId} AND s.status = 'IN_STOCK' AND gv.id = ANY(${[...variationIds]}::text[])
        AND (${variationInCategorySql(Prisma.sql`gv.id`, categoryId)}
          OR EXISTS (SELECT 1 FROM group_set_parts sp WHERE sp.set_id = s.id AND sp.status = 'ALLOCATED'
            AND ${variationInCategorySql(Prisma.sql`sp.variation_id`, categoryId)}))
      GROUP BY s.group_id`,
  ]);
  return { variations: new Set(vars.map((v) => v.id)), sets: new Map(sets.map((s) => [s.group_id, Number(s.n)])) };
}
