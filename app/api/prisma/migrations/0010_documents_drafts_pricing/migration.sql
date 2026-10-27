-- V2 Step 4/5 schema: payment info, line discount + note, document void (D3), held carts (drafts),
-- party profile fields (no GST, owner decision 4), supplier prices + history, per-user screen settings.

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PAID', 'PARTIAL', 'PENDING');

-- CreateEnum
CREATE TYPE "DraftMode" AS ENUM ('SALE', 'PURCHASE');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'DISCARDED');

-- AlterTable
ALTER TABLE "parties" ADD COLUMN     "alt_phone" TEXT,
ADD COLUMN     "contact_person" TEXT,
ADD COLUMN     "shipping_address" TEXT;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "amount_paid" DECIMAL(14,2),
ADD COLUMN     "payment_mode" "PaymentMode",
ADD COLUMN     "payment_status" "PaymentStatus";

-- AlterTable
ALTER TABLE "sale_lines" ADD COLUMN     "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "note" TEXT;

-- AlterTable
ALTER TABLE "purchases" ADD COLUMN     "amount_paid" DECIMAL(14,2),
ADD COLUMN     "payment_mode" "PaymentMode",
ADD COLUMN     "payment_status" "PaymentStatus";

-- AlterTable
ALTER TABLE "purchase_lines" ADD COLUMN     "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "note" TEXT;

-- CreateTable
CREATE TABLE "document_voids" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "sale_id" TEXT,
    "purchase_id" TEXT,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "document_voids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_orders" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "mode" "DraftMode" NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT NOT NULL,
    "party_id" TEXT,
    "notes" TEXT,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "estimated_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_count" INTEGER NOT NULL DEFAULT 0,
    "document_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "draft_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_prices" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "variation_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "effective_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "vendor_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_price_history" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "variation_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "active" BOOLEAN NOT NULL,
    "notes" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" TEXT,

    CONSTRAINT "vendor_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "user_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("user_id","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_voids_sale_id_key" ON "document_voids"("sale_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_voids_purchase_id_key" ON "document_voids"("purchase_id");

-- CreateIndex
CREATE INDEX "document_voids_company_id_created_at_idx" ON "document_voids"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "draft_orders_company_id_mode_status_updated_at_idx" ON "draft_orders"("company_id", "mode", "status", "updated_at");

-- CreateIndex
CREATE INDEX "vendor_prices_company_id_supplier_id_idx" ON "vendor_prices"("company_id", "supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_prices_company_id_variation_id_supplier_id_key" ON "vendor_prices"("company_id", "variation_id", "supplier_id");

-- CreateIndex
CREATE INDEX "vendor_price_history_company_id_variation_id_supplier_id_re_idx" ON "vendor_price_history"("company_id", "variation_id", "supplier_id", "recorded_at");

-- AddForeignKey
ALTER TABLE "document_voids" ADD CONSTRAINT "document_voids_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_voids" ADD CONSTRAINT "document_voids_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_voids" ADD CONSTRAINT "document_voids_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_orders" ADD CONSTRAINT "draft_orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_orders" ADD CONSTRAINT "draft_orders_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_prices" ADD CONSTRAINT "vendor_prices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_prices" ADD CONSTRAINT "vendor_prices_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "product_variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_prices" ADD CONSTRAINT "vendor_prices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_price_history" ADD CONSTRAINT "vendor_price_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written invariants
-- ---------------------------------------------------------------------------

-- Stock movements: void types reverse their document's direction and keep its link.
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_direction";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_direction" CHECK (
  ("movement_type" IN ('OPENING', 'PURCHASE', 'SALE_VOID') AND "quantity" > 0)
  OR ("movement_type" IN ('SALE', 'PURCHASE_VOID') AND "quantity" < 0)
  OR ("movement_type" = 'ADJUSTMENT')
);
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_document_link";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_document_link" CHECK (
  ("movement_type" IN ('SALE', 'SALE_VOID') AND "sale_id" IS NOT NULL AND "purchase_id" IS NULL)
  OR ("movement_type" IN ('PURCHASE', 'PURCHASE_VOID') AND "purchase_id" IS NOT NULL AND "sale_id" IS NULL)
  OR ("movement_type" IN ('OPENING', 'ADJUSTMENT') AND "sale_id" IS NULL AND "purchase_id" IS NULL)
);

-- Lines: an optional flat discount, never more than the line's gross amount.
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_amounts";
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_amounts" CHECK (
  "line_no" > 0 AND "quantity" > 0 AND "unit_price" >= 0
  AND "discount" >= 0 AND "discount" <= "quantity" * "unit_price"
  AND "line_total" = "quantity" * "unit_price" - "discount");
ALTER TABLE "purchase_lines" DROP CONSTRAINT "purchase_lines_amounts";
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_amounts" CHECK (
  "line_no" > 0 AND "quantity" > 0 AND "unit_cost" >= 0
  AND "discount" >= 0 AND "discount" <= "quantity" * "unit_cost"
  AND "line_total" = "quantity" * "unit_cost" - "discount");
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_note_length" CHECK ("note" IS NULL OR length("note") <= 300);
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_note_length" CHECK ("note" IS NULL OR length("note") <= 300);

-- Payment information agrees with the amount paid (no ledger in V2; settlement is V3).
ALTER TABLE "sales" ADD CONSTRAINT "sales_payment_consistent" CHECK (
  ("payment_status" IS NULL AND "amount_paid" IS NULL)
  OR ("payment_status" = 'PAID' AND "amount_paid" = "total")
  OR ("payment_status" = 'PENDING' AND "amount_paid" = 0)
  OR ("payment_status" = 'PARTIAL' AND "amount_paid" > 0 AND "amount_paid" < "total"));
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_payment_consistent" CHECK (
  ("payment_status" IS NULL AND "amount_paid" IS NULL)
  OR ("payment_status" = 'PAID' AND "amount_paid" = "total")
  OR ("payment_status" = 'PENDING' AND "amount_paid" = 0)
  OR ("payment_status" = 'PARTIAL' AND "amount_paid" > 0 AND "amount_paid" < "total"));

-- Voids: exactly one document, a reason, same company, append-only.
ALTER TABLE "document_voids" ADD CONSTRAINT "document_voids_one_document" CHECK (num_nonnulls("sale_id", "purchase_id") = 1);
ALTER TABLE "document_voids" ADD CONSTRAINT "document_voids_reason_present" CHECK (btrim("reason") <> '' AND length("reason") <= 300);
CREATE UNIQUE INDEX "sales_id_company_key" ON "sales" ("id", "company_id");
CREATE UNIQUE INDEX "purchases_id_company_key" ON "purchases" ("id", "company_id");
ALTER TABLE "document_voids" ADD CONSTRAINT "document_voids_sale_same_company_fkey"
  FOREIGN KEY ("sale_id", "company_id") REFERENCES "sales" ("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "document_voids" ADD CONSTRAINT "document_voids_purchase_same_company_fkey"
  FOREIGN KEY ("purchase_id", "company_id") REFERENCES "purchases" ("id", "company_id") ON DELETE RESTRICT;

-- Commit-time: a void's movements exactly reverse the document's own movements, per variation.
CREATE FUNCTION document_voids_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bad int;
BEGIN
  IF NEW."sale_id" IS NOT NULL THEN
    SELECT count(*) INTO bad FROM (
      SELECT "variation_id",
             SUM("quantity") FILTER (WHERE "movement_type" = 'SALE') AS d,
             SUM("quantity") FILTER (WHERE "movement_type" = 'SALE_VOID') AS v
      FROM "stock_movements" WHERE "sale_id" = NEW."sale_id" GROUP BY "variation_id"
    ) t WHERE COALESCE(t.d, 0) + COALESCE(t.v, 0) <> 0 OR t.v IS NULL;
  ELSE
    SELECT count(*) INTO bad FROM (
      SELECT "variation_id",
             SUM("quantity") FILTER (WHERE "movement_type" = 'PURCHASE') AS d,
             SUM("quantity") FILTER (WHERE "movement_type" = 'PURCHASE_VOID') AS v
      FROM "stock_movements" WHERE "purchase_id" = NEW."purchase_id" GROUP BY "variation_id"
    ) t WHERE COALESCE(t.d, 0) + COALESCE(t.v, 0) <> 0 OR t.v IS NULL;
  END IF;
  IF bad > 0 THEN
    RAISE EXCEPTION 'void % does not exactly reverse the document stock movements', NEW."id";
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER document_voids_consistent AFTER INSERT ON "document_voids"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION document_voids_consistent();

-- A void movement only exists together with its void row (checked at commit).
CREATE FUNCTION stock_movements_void_has_void() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."movement_type" = 'SALE_VOID' AND NOT EXISTS (SELECT 1 FROM "document_voids" WHERE "sale_id" = NEW."sale_id") THEN
    RAISE EXCEPTION 'SALE_VOID movement without a void record';
  END IF;
  IF NEW."movement_type" = 'PURCHASE_VOID' AND NOT EXISTS (SELECT 1 FROM "document_voids" WHERE "purchase_id" = NEW."purchase_id") THEN
    RAISE EXCEPTION 'PURCHASE_VOID movement without a void record';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER stock_movements_void_link AFTER INSERT ON "stock_movements"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW."movement_type" IN ('SALE_VOID', 'PURCHASE_VOID'))
  EXECUTE FUNCTION stock_movements_void_has_void();

CREATE TRIGGER document_voids_no_update_delete BEFORE UPDATE OR DELETE ON "document_voids" FOR EACH ROW EXECUTE FUNCTION documents_append_only();
CREATE TRIGGER document_voids_no_truncate BEFORE TRUNCATE ON "document_voids" FOR EACH STATEMENT EXECUTE FUNCTION documents_append_only();

-- Drafts: named, same-company party.
ALTER TABLE "draft_orders" ADD CONSTRAINT "draft_orders_title_present" CHECK (btrim("title") <> '' AND length("title") <= 120);
ALTER TABLE "draft_orders" ADD CONSTRAINT "draft_orders_counts" CHECK ("line_count" >= 0 AND "estimated_total" >= 0 AND "version" >= 1);
ALTER TABLE "draft_orders" ADD CONSTRAINT "draft_orders_party_same_company_fkey"
  FOREIGN KEY ("party_id", "company_id") REFERENCES "parties" ("id", "company_id") ON DELETE RESTRICT;

-- Supplier prices: non-negative rate, same-company variation and supplier; history append-only.
ALTER TABLE "vendor_prices" ADD CONSTRAINT "vendor_prices_rate_nonneg" CHECK ("rate" >= 0);
ALTER TABLE "vendor_prices" ADD CONSTRAINT "vendor_prices_variation_same_company_fkey"
  FOREIGN KEY ("variation_id", "company_id") REFERENCES "product_variations" ("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "vendor_prices" ADD CONSTRAINT "vendor_prices_supplier_same_company_fkey"
  FOREIGN KEY ("supplier_id", "company_id") REFERENCES "parties" ("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "vendor_price_history" ADD CONSTRAINT "vendor_price_history_rate_nonneg" CHECK ("rate" >= 0);
CREATE FUNCTION vendor_price_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'vendor_price_history is append-only (% blocked)', TG_OP;
END;
$$;
CREATE TRIGGER vendor_price_history_no_update_delete BEFORE UPDATE OR DELETE ON "vendor_price_history"
  FOR EACH ROW EXECUTE FUNCTION vendor_price_history_append_only();

-- Preferences: bounded keys and payloads.
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_key_format" CHECK ("key" ~ '^[a-z0-9][a-z0-9._-]{0,63}$');
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_value_size" CHECK (length("value"::text) <= 8000);
