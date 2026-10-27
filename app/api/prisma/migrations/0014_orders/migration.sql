-- V2 sale and purchase orders (v2/docs/orders/ORDER-LIFECYCLE-PLAN.md).
-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('SALE', 'PURCHASE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PLACED', 'ON_DELIVERY', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "kind" "OrderKind" NOT NULL,
    "number" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "order_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "party_id" TEXT,
    "party_name" TEXT,
    "expected_date" TEXT,
    "delivery_address" TEXT,
    "delivery_note" TEXT,
    "notes" TEXT,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_count" INTEGER NOT NULL DEFAULT 0,
    "client_ref" TEXT,
    "document_id" TEXT,
    "cancel_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_lines" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "variation_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "line_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- CreateIndex
CREATE INDEX "orders_company_id_kind_status_order_date_idx" ON "orders"("company_id", "kind", "status", "order_date");

-- CreateIndex
CREATE INDEX "orders_number_trgm_idx" ON "orders" USING GIN ("number" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "orders_company_id_number_key" ON "orders"("company_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_company_id_client_ref_key" ON "orders"("company_id", "client_ref");

-- CreateIndex
CREATE INDEX "order_lines_variation_id_idx" ON "order_lines"("variation_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_order_id_line_no_key" ON "order_lines"("order_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "order_lines_order_id_variation_id_key" ON "order_lines"("order_id", "variation_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "product_variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written invariants
-- ---------------------------------------------------------------------------

-- Same-company references (party and every line's item).
ALTER TABLE "orders" ADD CONSTRAINT "orders_party_same_company_fkey"
  FOREIGN KEY ("party_id", "company_id") REFERENCES "parties" ("id", "company_id") ON DELETE RESTRICT;

-- SO/ numbers for sale orders, PO/ for purchase orders.
ALTER TABLE "orders" ADD CONSTRAINT "orders_number_format" CHECK (
  ("kind" = 'SALE' AND "number" ~ '^SO/[0-9]{4}-[0-9]{2}/[0-9]{4,}$')
  OR ("kind" = 'PURCHASE' AND "number" ~ '^PO/[0-9]{4}-[0-9]{2}/[0-9]{4,}$'));

-- A completed order always points at its document; a cancelled one always has a reason.
ALTER TABLE "orders" ADD CONSTRAINT "orders_completed_document" CHECK (("status" = 'COMPLETED') = ("document_id" IS NOT NULL));
ALTER TABLE "orders" ADD CONSTRAINT "orders_cancel_reason" CHECK (("status" = 'CANCELLED') = ("cancel_reason" IS NOT NULL));
ALTER TABLE "orders" ADD CONSTRAINT "orders_money" CHECK ("subtotal" >= 0 AND "line_count" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_expected_date_format" CHECK ("expected_date" IS NULL OR "expected_date" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

-- Lines: positive whole quantity, non-negative price, discount within the line, exact total.
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_amounts" CHECK (
  "line_no" > 0 AND "quantity" > 0 AND "price" >= 0 AND "discount" >= 0
  AND "discount" <= "quantity" * "price" AND "line_total" = "quantity" * "price" - "discount");
