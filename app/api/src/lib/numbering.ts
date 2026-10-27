import type { Tx } from "../db.js";

export const BUSINESS_TIME_ZONE = "Asia/Kolkata";
// V2: SO / PO number sale and purchase orders (0014_orders); they share document_counters.
// V3.1: TRF numbers shifts between warehouses (0035).
export const DOC_PREFIXES = { sale: "SAL", purchase: "PUR", saleOrder: "SO", purchaseOrder: "PO", transfer: "TRF" } as const;
export type DocKind = keyof typeof DOC_PREFIXES;

const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "numeric" });

/** Indian financial year (1 April – 31 March) of an instant, evaluated in Asia/Kolkata. e.g. "2026-27". */
export function fiscalYearOf(date: Date): string {
  const p = parts.formatToParts(date);
  const year = Number(p.find((x) => x.type === "year")?.value);
  const month = Number(p.find((x) => x.type === "month")?.value);
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function formatDocNumber(kind: DocKind, fiscalYear: string, value: number): string {
  return `${DOC_PREFIXES[kind]}/${fiscalYear}/${String(value).padStart(4, "0")}`;
}

/**
 * Allocates the next number atomically inside the caller's transaction. The upsert row
 * lock serialises concurrent writers, and a rolled-back document releases nothing
 * because the counter increment rolls back with it (no gaps from failed saves).
 */
export async function nextDocNumber(tx: Tx, companyId: string, kind: DocKind, date: Date): Promise<string> {
  const fiscalYear = fiscalYearOf(date);
  const prefix = DOC_PREFIXES[kind];
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO document_counters (company_id, doc_type, fiscal_year, last_value)
    VALUES (${companyId}, ${prefix}, ${fiscalYear}, 1)
    ON CONFLICT (company_id, doc_type, fiscal_year)
    DO UPDATE SET last_value = document_counters.last_value + 1
    RETURNING last_value`;
  const value = rows[0]?.last_value;
  if (!value) throw new Error("Document counter allocation failed");
  return formatDocNumber(kind, fiscalYear, value);
}
