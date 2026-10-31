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

const dateParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Day date key (DDMMYYYY) of an instant, evaluated in Asia/Kolkata. e.g. "30102026". */
export function dateKeyOf(date: Date): string {
  const p = dateParts.formatToParts(date);
  const day = p.find((x) => x.type === "day")?.value ?? "01";
  const month = p.find((x) => x.type === "month")?.value ?? "01";
  const year = p.find((x) => x.type === "year")?.value ?? "2026";
  return `${day}${month}${year}`;
}

/** Formats document number as {PREFIX}-{DDMMYYYY}-{001} */
export function formatDocNumber(kind: DocKind, dateKey: string, value: number): string {
  const seq = String(value).padStart(3, "0");
  return `${DOC_PREFIXES[kind]}-${dateKey}-${seq}`;
}

/**
 * Allocates the next day-wise number atomically inside the caller's transaction. The upsert row
 * lock serialises concurrent writers, and a rolled-back document releases nothing
 * because the counter increment rolls back with it (no gaps from failed saves).
 */
export async function nextDocNumber(tx: Tx, companyId: string, kind: DocKind, date: Date): Promise<string> {
  const dateKey = dateKeyOf(date);
  const prefix = DOC_PREFIXES[kind];
  const rows = await tx.$queryRaw<{ last_value: number }[]>`
    INSERT INTO document_counters (company_id, doc_type, fiscal_year, last_value)
    VALUES (${companyId}, ${prefix}, ${dateKey}, 1)
    ON CONFLICT (company_id, doc_type, fiscal_year)
    DO UPDATE SET last_value = document_counters.last_value + 1
    RETURNING last_value`;
  const value = rows[0]?.last_value;
  if (!value) throw new Error("Document counter allocation failed");
  return formatDocNumber(kind, dateKey, value);
}
