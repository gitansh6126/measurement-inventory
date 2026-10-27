-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('OPENING', 'PURCHASE', 'SALE', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "variation_id" TEXT NOT NULL,
    "movement_type" "MovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "rate" DECIMAL(14,2),
    "reason" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_movements_variation_id_occurred_at_idx" ON "stock_movements"("variation_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_movements_company_id_occurred_at_idx" ON "stock_movements"("company_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "product_variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written invariants (not expressible in schema.prisma)
-- ---------------------------------------------------------------------------

-- Direction and meaning per type; an adjustment always carries a reason (main v2 adjustStock).
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_nonzero" CHECK ("quantity" <> 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_direction" CHECK (
  ("movement_type" IN ('OPENING', 'PURCHASE') AND "quantity" > 0)
  OR ("movement_type" = 'SALE' AND "quantity" < 0)
  OR ("movement_type" = 'ADJUSTMENT')
);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_adjustment_reason" CHECK (
  "movement_type" <> 'ADJUSTMENT' OR ("reason" IS NOT NULL AND btrim("reason") <> '')
);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_rate_nonneg" CHECK ("rate" IS NULL OR "rate" >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unit_present" CHECK (btrim("unit") <> '');

-- Company boundary: a movement and its variation always share a company.
CREATE UNIQUE INDEX "product_variations_id_company_key" ON "product_variations" ("id", "company_id");
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variation_same_company_fkey"
  FOREIGN KEY ("variation_id", "company_id") REFERENCES "product_variations" ("id", "company_id") ON DELETE RESTRICT;

-- No negative stock, ever (contract: overselling is rejected, never clamped).
-- Locking the variation row serialises concurrent movements for the same item, so two
-- simultaneous sales cannot both pass the check. The API checks first for a friendly
-- message; this trigger is the guarantee for every path.
CREATE FUNCTION stock_movements_no_negative() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  balance bigint;
BEGIN
  PERFORM 1 FROM "product_variations" WHERE "id" = NEW."variation_id" FOR UPDATE;
  SELECT COALESCE(SUM("quantity"), 0) INTO balance FROM "stock_movements" WHERE "variation_id" = NEW."variation_id";
  IF balance + NEW."quantity" < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: % available, % requested', balance, -NEW."quantity";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stock_movements_check_balance
  BEFORE INSERT ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_movements_no_negative();

-- Append-only: corrections are new movements, never edits.
CREATE FUNCTION stock_movements_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements is append-only (% blocked)', TG_OP;
END;
$$;

CREATE TRIGGER stock_movements_no_update_delete
  BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_movements_append_only();

CREATE TRIGGER stock_movements_no_truncate
  BEFORE TRUNCATE ON "stock_movements"
  FOR EACH STATEMENT EXECUTE FUNCTION stock_movements_append_only();
