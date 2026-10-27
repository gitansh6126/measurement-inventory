import { Prisma } from "@prisma/client";
import type { Tx } from "../db.js";
import { BUSINESS_TIME_ZONE } from "./numbering.js";

export const PRODUCT_ACTIVITY_FILTERS = ["all", "active", "min-active", "inactive", "never-sold"] as const;
export type ProductActivityFilter = (typeof PRODUCT_ACTIVITY_FILTERS)[number];
export type ProductActivityStatus = "Active" | "Min-Active" | "Inactive" | "Never Sold";

const dateParts = new Intl.DateTimeFormat("en", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function businessDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new RangeError("Product sale date is invalid");
  const parts = dateParts.formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("Could not determine the business-local sale date");
  return `${year}-${month}-${day}`;
}

function monthsBefore(date: Date, months: number): string {
  const [year, month, day] = businessDate(date).split("-").map(Number) as [number, number, number];
  const monthIndex = year * 12 + month - 1 - months;
  const targetYear = Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12 + 1;
  const targetDay = Math.min(day, new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate());
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}

export function productActivity(lastSaleAt: Date | null, now = new Date()): ProductActivityStatus {
  if (lastSaleAt === null) return "Never Sold";
  const lastSale = businessDate(lastSaleAt);
  if (lastSale > monthsBefore(now, 6)) return "Active";
  if (lastSale > monthsBefore(now, 12)) return "Min-Active";
  return "Inactive";
}

/** SQL counterpart to productActivity; used by the indexed, tenant-scoped inventory query. */
export function productActivityCondition(filter: ProductActivityFilter): Prisma.Sql {
  if (filter === "all") return Prisma.sql`TRUE`;
  if (filter === "never-sold") return Prisma.sql`g.last_sale_at IS NULL`;

  const today = Prisma.sql`(CURRENT_TIMESTAMP AT TIME ZONE ${BUSINESS_TIME_ZONE})::date`;
  const sixMonthBoundary = Prisma.sql`(((((${today} - INTERVAL '6 months')::date + 1)::timestamp) AT TIME ZONE ${BUSINESS_TIME_ZONE}) AT TIME ZONE 'UTC')`;
  const twelveMonthBoundary = Prisma.sql`(((((${today} - INTERVAL '12 months')::date + 1)::timestamp) AT TIME ZONE ${BUSINESS_TIME_ZONE}) AT TIME ZONE 'UTC')`;

  if (filter === "active") return Prisma.sql`g.last_sale_at >= ${sixMonthBoundary}`;
  if (filter === "min-active") return Prisma.sql`g.last_sale_at < ${sixMonthBoundary} AND g.last_sale_at >= ${twelveMonthBoundary}`;
  return Prisma.sql`g.last_sale_at < ${twelveMonthBoundary}`;
}

/** Incrementally records a completed sale without replacing a newer sale date. */
export async function recordProductSale(tx: Tx, companyId: string, variationIds: readonly string[], saleDate: Date) {
  if (variationIds.length === 0) return;
  const variations = await tx.productVariation.findMany({
    where: { companyId, id: { in: [...new Set(variationIds)] } },
    select: { groupId: true },
  });
  const groupIds = [...new Set(variations.map((variation) => variation.groupId))];
  if (groupIds.length === 0) return;
  await tx.productGroup.updateMany({
    where: {
      companyId,
      id: { in: groupIds },
      OR: [{ lastSaleAt: null }, { lastSaleAt: { lt: saleDate } }],
    },
    data: { lastSaleAt: saleDate },
  });
}

/** Recalculates products touched by a sale after it is voided. */
export async function recalculateProductActivityForSale(tx: Tx, companyId: string, saleId: string) {
  await tx.$executeRaw`
    WITH affected_groups AS (
      SELECT DISTINCT v.group_id
      FROM sale_lines sl
      JOIN product_variations v ON v.id = sl.variation_id AND v.company_id = ${companyId}
      WHERE sl.sale_id = ${saleId}
    ),
    latest_sales AS (
      SELECT ag.group_id, MAX(s.sale_date) AS last_sale_at
      FROM affected_groups ag
      LEFT JOIN product_variations v ON v.group_id = ag.group_id AND v.company_id = ${companyId}
      LEFT JOIN sale_lines sl ON sl.variation_id = v.id
      LEFT JOIN sales s ON s.id = sl.sale_id AND s.company_id = ${companyId}
      LEFT JOIN document_voids dv ON dv.sale_id = s.id AND dv.company_id = ${companyId}
      WHERE s.id IS NULL OR (s.status = 'COMPLETED' AND dv.id IS NULL)
      GROUP BY ag.group_id
    )
    UPDATE product_groups g
    SET last_sale_at = latest_sales.last_sale_at
    FROM latest_sales
    WHERE g.id = latest_sales.group_id AND g.company_id = ${companyId}`;
}

/** Rebuilds the derived dates after restoring any compatible backup format. */
export async function recalculateAllProductActivity(tx: Tx, companyId: string) {
  await tx.$executeRaw`
    UPDATE product_groups g
    SET last_sale_at = (
      SELECT MAX(s.sale_date)
      FROM product_variations v
      JOIN sale_lines sl ON sl.variation_id = v.id
      JOIN sales s ON s.id = sl.sale_id AND s.company_id = ${companyId}
      LEFT JOIN document_voids dv ON dv.sale_id = s.id AND dv.company_id = ${companyId}
      WHERE v.group_id = g.id
        AND v.company_id = ${companyId}
        AND s.status = 'COMPLETED'
        AND dv.id IS NULL
    )
    WHERE g.company_id = ${companyId}`;
}
