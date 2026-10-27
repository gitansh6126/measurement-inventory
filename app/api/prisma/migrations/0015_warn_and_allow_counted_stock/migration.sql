-- Counted-stock sales use the owner's fixed Warn & Allow policy. Preserve the
-- legacy column for V2 backup compatibility, but normalize existing rows and defaults.
UPDATE "companies"
SET "negative_stock_policy" = 'WARN_AND_ALLOW'
WHERE "negative_stock_policy" <> 'WARN_AND_ALLOW';

ALTER TABLE "companies"
  ALTER COLUMN "negative_stock_policy" SET DEFAULT 'WARN_AND_ALLOW';

-- Sales may take counted stock below zero; the API requires an explicit confirmation
-- and writes the corresponding audit event in the same transaction. Non-sale movements
-- remain strictly non-negative at the database layer.
CREATE OR REPLACE FUNCTION stock_movements_no_negative() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  balance bigint;
BEGIN
  PERFORM 1 FROM "product_variations" WHERE "id" = NEW."variation_id" FOR UPDATE;
  IF NEW."quantity" >= 0 THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE((SELECT "quantity" FROM "stock_balances" WHERE "variation_id" = NEW."variation_id"), 0) INTO balance;
  IF balance + NEW."quantity" < 0 AND NEW."movement_type" <> 'SALE' THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: % available, % requested', balance, -NEW."quantity";
  END IF;
  RETURN NEW;
END;
$$;
