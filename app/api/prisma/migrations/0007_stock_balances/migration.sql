-- V2 plan §1.1 + §1.8 (backlog C1, C6): stored running balance and configurable negative stock.

-- CreateEnum
CREATE TYPE "NegativeStockPolicy" AS ENUM ('STRICT', 'WARN_AND_ALLOW', 'MANAGER_OVERRIDE');

-- AlterTable (owner decision 2026-10-14: STRICT stays the default, i.e. V1 behaviour)
ALTER TABLE "companies" ADD COLUMN     "negative_stock_policy" "NegativeStockPolicy" NOT NULL DEFAULT 'STRICT';

-- CreateTable
CREATE TABLE "stock_balances" (
    "variation_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("variation_id")
);

-- CreateIndex
CREATE INDEX "stock_balances_company_id_quantity_idx" ON "stock_balances"("company_id", "quantity");

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_variation_id_fkey" FOREIGN KEY ("variation_id") REFERENCES "product_variations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written invariants
-- ---------------------------------------------------------------------------

-- Company boundary: a balance and its variation always share a company.
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_variation_same_company_fkey"
  FOREIGN KEY ("variation_id", "company_id") REFERENCES "product_variations" ("id", "company_id") ON DELETE CASCADE;

-- Backfill from the ledger (V1 data, or a database that ran 0001–0006).
INSERT INTO "stock_balances" ("variation_id", "company_id", "quantity", "updated_at")
SELECT "variation_id", "company_id", SUM("quantity"), CURRENT_TIMESTAMP
FROM "stock_movements"
GROUP BY "variation_id", "company_id";

-- Balance maintenance. A BEFORE ROW trigger (not AFTER) so that, inside one multi-row INSERT,
-- each row's check already sees the rows before it. Triggers of the same timing fire in name
-- order: stock_movements_check_balance (checks) runs before stock_movements_maintain_balance
-- (adds). This trigger stays enabled during a backup restore, which disables only the check,
-- so restored ledgers keep their balances exact. DELETE only happens in a restore (the
-- append-only trigger blocks it otherwise; if that trigger aborts the statement, this change
-- is rolled back with it).
CREATE FUNCTION stock_balances_maintain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "stock_balances" ("variation_id", "company_id", "quantity", "updated_at")
    VALUES (NEW."variation_id", NEW."company_id", NEW."quantity", CURRENT_TIMESTAMP)
    ON CONFLICT ("variation_id") DO UPDATE
      SET "quantity" = "stock_balances"."quantity" + EXCLUDED."quantity", "updated_at" = CURRENT_TIMESTAMP;
    RETURN NEW;
  END IF;
  UPDATE "stock_balances" SET "quantity" = "quantity" - OLD."quantity", "updated_at" = CURRENT_TIMESTAMP
  WHERE "variation_id" = OLD."variation_id";
  RETURN OLD;
END;
$$;

CREATE TRIGGER stock_movements_maintain_balance
  BEFORE INSERT OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION stock_balances_maintain();

-- Stock check, now reading the stored balance (no SUM over history) and the company policy.
-- Same trigger name as 0003, so code that disables it during restore keeps working.
--   * Only an outgoing movement (quantity < 0) can be refused: a receipt into a negative
--     balance always passes and reduces the deficit (-3 + 10 = 7, plan §1.8).
--   * Below zero is allowed only for SALE movements when the policy is not STRICT. Who may
--     confirm it under MANAGER_OVERRIDE is an application rule (stock.oversell permission).
CREATE OR REPLACE FUNCTION stock_movements_no_negative() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  balance bigint;
  policy "NegativeStockPolicy";
BEGIN
  PERFORM 1 FROM "product_variations" WHERE "id" = NEW."variation_id" FOR UPDATE;
  IF NEW."quantity" >= 0 THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE((SELECT "quantity" FROM "stock_balances" WHERE "variation_id" = NEW."variation_id"), 0) INTO balance;
  IF balance + NEW."quantity" < 0 THEN
    SELECT "negative_stock_policy" INTO policy FROM "companies" WHERE "id" = NEW."company_id";
    IF policy = 'STRICT' OR NEW."movement_type" <> 'SALE' THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: % available, % requested', balance, -NEW."quantity";
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Nightly / pre-hosting check (PRE-HOSTING-CHECKLIST §3): must return 0 rows.
CREATE VIEW "stock_balance_drift" AS
SELECT v."id" AS "variation_id", v."company_id",
       COALESCE(b."quantity", 0) AS "stored_balance",
       COALESCE(s."total", 0) AS "calculated_sum"
FROM "product_variations" v
LEFT JOIN "stock_balances" b ON b."variation_id" = v."id"
LEFT JOIN (SELECT "variation_id", SUM("quantity") AS "total" FROM "stock_movements" GROUP BY "variation_id") s
  ON s."variation_id" = v."id"
WHERE COALESCE(b."quantity", 0) <> COALESCE(s."total", 0);
