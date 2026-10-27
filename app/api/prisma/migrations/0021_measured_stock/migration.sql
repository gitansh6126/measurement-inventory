-- V2 plan §2: Measured products (rolls sold by length). Owner decisions 2026-10-14, DM-1…DM-8:
-- a third product type with variations; length only (m, or ft + in stored in inches); one row per
-- physical roll; decimal quantities (NUMERIC 14,3); pieces never joined; measured stock never
-- negative. Merged into v2.1 as 0019–0021 (were 0011–0013 on branch v2-measurement).

-- CreateEnum
CREATE TYPE "LengthUnit" AS ENUM ('m', 'ft_in');
CREATE TYPE "PieceKind" AS ENUM ('CLOSED', 'OPEN', 'CUT');
CREATE TYPE "PieceStatus" AS ENUM ('ACTIVE', 'USED_UP');
CREATE TYPE "PieceAction" AS ENUM ('RECEIVE', 'ADD', 'OPEN', 'CUT', 'SALE', 'SALE_VOID', 'PURCHASE_VOID', 'WRITE_OFF', 'CORRECTION', 'EDIT');

-- AlterTable: measured settings (null for Simple / Variable)
ALTER TABLE "product_groups" ADD COLUMN "length_unit" "LengthUnit",
  ADD COLUMN "roll_name" TEXT,
  ADD COLUMN "default_roll_length" DECIMAL(14,3),
  ADD COLUMN "length_decimals" INTEGER,
  ADD COLUMN "scrap_below" DECIMAL(14,3);
ALTER TABLE "product_variations" ADD COLUMN "default_roll_length" DECIMAL(14,3);

-- AlterTable: decimal quantities (DM-2). The drift view depends on the column, so it is rebuilt.
DROP VIEW "stock_balance_drift";
ALTER TABLE "stock_movements" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(14,3);
ALTER TABLE "stock_balances" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(14,3);
ALTER TABLE "sale_lines" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(14,3);
ALTER TABLE "purchase_lines" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(14,3);

-- CreateTable
CREATE TABLE "measurement_pieces" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "variation_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "PieceKind" NOT NULL,
    "status" "PieceStatus" NOT NULL DEFAULT 'ACTIVE',
    "original_length" DECIMAL(14,3) NOT NULL,
    "remaining_length" DECIMAL(14,3) NOT NULL,
    "parent_id" TEXT,
    "purchase_id" TEXT,
    "supplier_id" TEXT,
    "unit_cost" DECIMAL(14,2),
    "supplier_roll_no" TEXT,
    "rack" TEXT,
    "notes" TEXT,
    "opened_at" TIMESTAMP(3),
    "opened_by" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_by" TEXT,

    CONSTRAINT "measurement_pieces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "measurement_piece_ledger" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "piece_id" TEXT NOT NULL,
    "variation_id" TEXT NOT NULL,
    "action" "PieceAction" NOT NULL,
    "change" DECIMAL(14,3) NOT NULL,
    "before_length" DECIMAL(14,3) NOT NULL,
    "after_length" DECIMAL(14,3) NOT NULL,
    "related_piece_id" TEXT,
    "sale_id" TEXT,
    "purchase_id" TEXT,
    "reason" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "measurement_piece_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "measurement_pieces_company_id_code_key" ON "measurement_pieces"("company_id", "code");
CREATE INDEX "measurement_pieces_company_id_variation_id_status_kind_idx" ON "measurement_pieces"("company_id", "variation_id", "status", "kind");
CREATE INDEX "measurement_pieces_parent_id_idx" ON "measurement_pieces"("parent_id");
CREATE INDEX "measurement_pieces_purchase_id_idx" ON "measurement_pieces"("purchase_id");
CREATE INDEX "measurement_piece_ledger_piece_id_occurred_at_idx" ON "measurement_piece_ledger"("piece_id", "occurred_at");
CREATE INDEX "measurement_piece_ledger_sale_id_idx" ON "measurement_piece_ledger"("sale_id");
CREATE INDEX "measurement_piece_ledger_purchase_id_idx" ON "measurement_piece_ledger"("purchase_id");

-- AddForeignKey
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "product_variations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "measurement_pieces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "measurement_piece_ledger" ADD CONSTRAINT "measurement_piece_ledger_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "measurement_piece_ledger" ADD CONSTRAINT "measurement_piece_ledger_piece_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "measurement_pieces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "measurement_piece_ledger" ADD CONSTRAINT "measurement_piece_ledger_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "measurement_piece_ledger" ADD CONSTRAINT "measurement_piece_ledger_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written invariants
-- ---------------------------------------------------------------------------

-- Measured settings exist exactly for Measured products (DM-1, DM-7).
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_measured_settings" CHECK (
  ("product_type" = 'measured') = ("length_unit" IS NOT NULL)
  AND ("product_type" = 'measured' OR ("roll_name" IS NULL AND "default_roll_length" IS NULL AND "length_decimals" IS NULL AND "scrap_below" IS NULL))
  AND ("default_roll_length" IS NULL OR "default_roll_length" > 0)
  AND ("length_decimals" IS NULL OR "length_decimals" BETWEEN 0 AND 3)
  AND ("scrap_below" IS NULL OR "scrap_below" >= 0)
  AND ("roll_name" IS NULL OR (btrim("roll_name") <> '' AND length("roll_name") <= 30)));
ALTER TABLE "product_variations" ADD CONSTRAINT "product_variations_default_roll_positive" CHECK ("default_roll_length" IS NULL OR "default_roll_length" > 0);

-- Line amounts: whole quantities keep the exact product as before; a fractional length is
-- rounded to the whole rupee (owner decision: V2 prices are whole rupees, no paise).
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_amounts";
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_amounts" CHECK (
  "line_no" > 0 AND "quantity" > 0 AND "unit_price" >= 0 AND "discount" >= 0
  AND "discount" <= CASE WHEN "quantity" = trunc("quantity") THEN "quantity" * "unit_price" ELSE round("quantity" * "unit_price", 0) END
  AND "line_total" = CASE WHEN "quantity" = trunc("quantity") THEN "quantity" * "unit_price" ELSE round("quantity" * "unit_price", 0) END - "discount");
ALTER TABLE "purchase_lines" DROP CONSTRAINT "purchase_lines_amounts";
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_amounts" CHECK (
  "line_no" > 0 AND "quantity" > 0 AND "unit_cost" >= 0 AND "discount" >= 0
  AND "discount" <= CASE WHEN "quantity" = trunc("quantity") THEN "quantity" * "unit_cost" ELSE round("quantity" * "unit_cost", 0) END
  AND "line_total" = CASE WHEN "quantity" = trunc("quantity") THEN "quantity" * "unit_cost" ELSE round("quantity" * "unit_cost", 0) END - "discount");

-- Counted (Simple / Variable) items stay whole; only Measured items may carry a fraction.
CREATE FUNCTION quantity_whole_unless_measured() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."quantity" <> trunc(NEW."quantity") AND NOT EXISTS (
    SELECT 1 FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id"
    WHERE v."id" = NEW."variation_id" AND g."product_type" = 'measured'
  ) THEN
    RAISE EXCEPTION 'WHOLE_QUANTITY: % is not a whole number for a counted item', NEW."quantity";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_movements_whole_quantity BEFORE INSERT ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION quantity_whole_unless_measured();
CREATE TRIGGER sale_lines_whole_quantity BEFORE INSERT ON "sale_lines" FOR EACH ROW EXECUTE FUNCTION quantity_whole_unless_measured();
CREATE TRIGGER purchase_lines_whole_quantity BEFORE INSERT ON "purchase_lines" FOR EACH ROW EXECUTE FUNCTION quantity_whole_unless_measured();

-- Stock check with a NUMERIC balance. Counted items keep 0015's rule (a SALE may go below zero
-- after the seller confirms; every other movement stays non-negative); Measured stock never goes
-- below zero (DM-6: strict until the owner decides later in V2). Same trigger name as 0007.
CREATE OR REPLACE FUNCTION stock_movements_no_negative() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  balance numeric;
  measured boolean;
BEGIN
  PERFORM 1 FROM "product_variations" WHERE "id" = NEW."variation_id" FOR UPDATE;
  IF NEW."quantity" >= 0 THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE((SELECT "quantity" FROM "stock_balances" WHERE "variation_id" = NEW."variation_id"), 0) INTO balance;
  IF balance + NEW."quantity" < 0 THEN
    SELECT g."product_type" = 'measured' INTO measured
      FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id" WHERE v."id" = NEW."variation_id";
    IF NEW."movement_type" <> 'SALE' OR measured THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: % available, % requested', balance, -NEW."quantity";
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE VIEW "stock_balance_drift" AS
SELECT v."id" AS "variation_id", v."company_id",
       COALESCE(b."quantity", 0) AS "stored_balance",
       COALESCE(s."total", 0) AS "calculated_sum"
FROM "product_variations" v
LEFT JOIN "stock_balances" b ON b."variation_id" = v."id"
LEFT JOIN (SELECT "variation_id", SUM("quantity") AS "total" FROM "stock_movements" GROUP BY "variation_id") s
  ON s."variation_id" = v."id"
WHERE COALESCE(b."quantity", 0) <> COALESCE(s."total", 0);

-- Pieces: lengths, state and lineage (DM-3).
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_lengths" CHECK (
  "original_length" > 0 AND "remaining_length" >= 0 AND "remaining_length" <= "original_length");
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_status_matches_length" CHECK (
  ("status" = 'USED_UP') = ("remaining_length" = 0));
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_cut_has_parent" CHECK (
  ("kind" = 'CUT') = ("parent_id" IS NOT NULL));
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_code_present" CHECK (btrim("code") <> '' AND length("code") <= 120);
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_text_lengths" CHECK (
  ("supplier_roll_no" IS NULL OR length("supplier_roll_no") <= 60)
  AND ("rack" IS NULL OR length("rack") <= 40)
  AND ("notes" IS NULL OR length("notes") <= 300));
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_cost_nonneg" CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);

-- Company boundary for every reference.
CREATE UNIQUE INDEX "measurement_pieces_id_company_key" ON "measurement_pieces" ("id", "company_id");
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_variation_same_company_fkey"
  FOREIGN KEY ("variation_id", "company_id") REFERENCES "product_variations" ("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_parent_same_company_fkey"
  FOREIGN KEY ("parent_id", "company_id") REFERENCES "measurement_pieces" ("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_purchase_same_company_fkey"
  FOREIGN KEY ("purchase_id", "company_id") REFERENCES "purchases" ("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "measurement_pieces" ADD CONSTRAINT "measurement_pieces_supplier_same_company_fkey"
  FOREIGN KEY ("supplier_id", "company_id") REFERENCES "parties" ("id", "company_id") ON DELETE RESTRICT;
ALTER TABLE "measurement_piece_ledger" ADD CONSTRAINT "measurement_piece_ledger_piece_same_company_fkey"
  FOREIGN KEY ("piece_id", "company_id") REFERENCES "measurement_pieces" ("id", "company_id") ON DELETE RESTRICT;

-- Ledger rows: before/after agree with the change; sale / purchase links match the action.
ALTER TABLE "measurement_piece_ledger" ADD CONSTRAINT "measurement_piece_ledger_math" CHECK (
  "after_length" = "before_length" + "change" AND "before_length" >= 0 AND "after_length" >= 0);
ALTER TABLE "measurement_piece_ledger" ADD CONSTRAINT "measurement_piece_ledger_links" CHECK (
  ("action" IN ('SALE', 'SALE_VOID') AND "sale_id" IS NOT NULL AND "purchase_id" IS NULL)
  OR ("action" IN ('RECEIVE', 'PURCHASE_VOID') AND "purchase_id" IS NOT NULL AND "sale_id" IS NULL)
  OR ("action" IN ('ADD', 'OPEN', 'CUT', 'WRITE_OFF', 'CORRECTION', 'EDIT') AND "sale_id" IS NULL AND "purchase_id" IS NULL));
ALTER TABLE "measurement_piece_ledger" ADD CONSTRAINT "measurement_piece_ledger_reason_length" CHECK ("reason" IS NULL OR length("reason") <= 300);

-- Pieces only for Measured variations.
CREATE FUNCTION measurement_pieces_measured_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id"
    WHERE v."id" = NEW."variation_id" AND g."product_type" = 'measured'
  ) THEN
    RAISE EXCEPTION 'NOT_MEASURED: rolls belong to Measured products only';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER measurement_pieces_measured_only BEFORE INSERT OR UPDATE OF "variation_id" ON "measurement_pieces"
  FOR EACH ROW EXECUTE FUNCTION measurement_pieces_measured_only();

-- Commit-time: for a Measured variation, the length of its active pieces equals its stock.
-- Fired by any piece write and any movement, so neither can drift from the other.
CREATE FUNCTION measured_stock_consistent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pieces numeric;
  stock numeric;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id"
    WHERE v."id" = NEW."variation_id" AND g."product_type" = 'measured'
  ) THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(SUM("remaining_length"), 0) INTO pieces FROM "measurement_pieces"
    WHERE "variation_id" = NEW."variation_id" AND "status" = 'ACTIVE';
  SELECT COALESCE((SELECT "quantity" FROM "stock_balances" WHERE "variation_id" = NEW."variation_id"), 0) INTO stock;
  IF pieces <> stock THEN
    RAISE EXCEPTION 'MEASURED_MISMATCH: rolls hold % but stock is % for variation %', pieces, stock, NEW."variation_id";
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER measurement_pieces_stock_consistent AFTER INSERT OR UPDATE ON "measurement_pieces"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION measured_stock_consistent();
CREATE CONSTRAINT TRIGGER stock_movements_measured_consistent AFTER INSERT ON "stock_movements"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION measured_stock_consistent();

-- Pieces are never deleted (a used-up piece stays for audit); the ledger is append-only.
CREATE FUNCTION measurement_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never deleted (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$;
CREATE TRIGGER measurement_pieces_no_delete BEFORE DELETE ON "measurement_pieces" FOR EACH ROW EXECUTE FUNCTION measurement_no_delete();
CREATE TRIGGER measurement_pieces_no_truncate BEFORE TRUNCATE ON "measurement_pieces" FOR EACH STATEMENT EXECUTE FUNCTION measurement_no_delete();
CREATE TRIGGER measurement_piece_ledger_no_update_delete BEFORE UPDATE OR DELETE ON "measurement_piece_ledger" FOR EACH ROW EXECUTE FUNCTION measurement_no_delete();
CREATE TRIGGER measurement_piece_ledger_no_truncate BEFORE TRUNCATE ON "measurement_piece_ledger" FOR EACH STATEMENT EXECUTE FUNCTION measurement_no_delete();
