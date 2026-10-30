-- 0043 Date-based document numbering (DDMMYYYY day-wise sequence)
--
-- Updates check constraints to support the date-based format:
--   SAL-DDMMYYYY-001 (Sales)
--   PUR-DDMMYYYY-001 (Purchases)
--   SO-DDMMYYYY-001  (Sale Orders)
--   PO-DDMMYYYY-001  (Purchase Orders)
--   TRF-DDMMYYYY-001 (Stock Transfers)
-- while preserving backward-compatibility with legacy financial-year formats (e.g. SAL/2026-27/0001).

-- 1. document_counters: allow both legacy fiscal year (YYYY-YY) and day date key (DDMMYYYY)
ALTER TABLE "document_counters" DROP CONSTRAINT IF EXISTS "document_counters_fiscal_year_format";
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_fiscal_year_format"
  CHECK ("fiscal_year" ~ '^[0-9]{4}-[0-9]{2}$' OR "fiscal_year" ~ '^[0-9]{8}$');

-- 2. sales: allow SAL/YYYY-YY/XXXX(-R<n>) and SAL-DDMMYYYY-XXX(-R<n>)
ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_number_format";
ALTER TABLE "sales" ADD CONSTRAINT "sales_number_format"
  CHECK (
    "number" ~ '^SAL/[0-9]{4}-[0-9]{2}/[0-9]{4,}(-R[1-9][0-9]*)?$'
    OR "number" ~ '^SAL-[0-9]{8}-[0-9]{3,}(-R[1-9][0-9]*)?$'
  );

-- 3. purchases: allow PUR/YYYY-YY/XXXX(-R<n>) and PUR-DDMMYYYY-XXX(-R<n>)
ALTER TABLE "purchases" DROP CONSTRAINT IF EXISTS "purchases_number_format";
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_number_format"
  CHECK (
    "number" ~ '^PUR/[0-9]{4}-[0-9]{2}/[0-9]{4,}(-R[1-9][0-9]*)?$'
    OR "number" ~ '^PUR-[0-9]{8}-[0-9]{3,}(-R[1-9][0-9]*)?$'
  );

-- 4. orders: allow SO/ and PO/ legacy formats as well as SO-DDMMYYYY-XXX and PO-DDMMYYYY-XXX
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_number_format";
ALTER TABLE "orders" ADD CONSTRAINT "orders_number_format"
  CHECK (
    ("kind" = 'SALE' AND ("number" ~ '^SO/[0-9]{4}-[0-9]{2}/[0-9]{4,}$' OR "number" ~ '^SO-[0-9]{8}-[0-9]{3,}$'))
    OR ("kind" = 'PURCHASE' AND ("number" ~ '^PO/[0-9]{4}-[0-9]{2}/[0-9]{4,}$' OR "number" ~ '^PO-[0-9]{8}-[0-9]{3,}$'))
  );

-- 5. stock_transfers: allow TRF/ legacy format as well as TRF-DDMMYYYY-XXX
ALTER TABLE "stock_transfers" DROP CONSTRAINT IF EXISTS "stock_transfers_number_format";
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_number_format"
  CHECK (
    "number" ~ '^TRF/[0-9]{4}-[0-9]{2}/[0-9]{4,}$'
    OR "number" ~ '^TRF-[0-9]{8}-[0-9]{3,}$'
  );
