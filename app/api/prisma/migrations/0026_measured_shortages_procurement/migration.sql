-- Migration 0026: Measured-Product Shortages and Procurement Tracking
-- Adds PARTIALLY_FULFILLED to OrderStatus, fulfilled_quantity and procurement linkage to order_lines,
-- and order_id back-links on sales and purchases.

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_FULFILLED' AFTER 'ON_DELIVERY';

-- AlterTable order_lines
ALTER TABLE "order_lines" ADD COLUMN "fulfilled_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0;
ALTER TABLE "order_lines" ADD COLUMN "linked_order_line_id" TEXT;
ALTER TABLE "order_lines" ADD COLUMN "linked_order_id" TEXT;

ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_fulfilled_nonneg" CHECK (
  "fulfilled_quantity" >= 0 AND "fulfilled_quantity" <= "quantity"
);

ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_linked_order_line_fkey"
  FOREIGN KEY ("linked_order_line_id") REFERENCES "order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_linked_order_fkey"
  FOREIGN KEY ("linked_order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "order_lines_linked_order_line_id_idx" ON "order_lines"("linked_order_line_id");
CREATE INDEX "order_lines_linked_order_id_idx" ON "order_lines"("linked_order_id");

-- AlterTable sales
ALTER TABLE "sales" ADD COLUMN "order_id" TEXT;
ALTER TABLE "sales" ADD CONSTRAINT "sales_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "sales_order_id_idx" ON "sales"("order_id");

-- AlterTable purchases
ALTER TABLE "purchases" ADD COLUMN "order_id" TEXT;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "purchases_order_id_idx" ON "purchases"("order_id");
