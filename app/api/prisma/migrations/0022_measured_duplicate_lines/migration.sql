-- V2 plan §2.8 / wireframe W16: one sale or purchase may hold several lines of the same Measured
-- variation (two 10 mm lines cut from different pieces). Counted (Simple / Variable) items keep
-- one line per variation, as 0004 enforced with a unique index. Merged into v2.1 as 0021 (was
-- 0013 on branch v2-measurement).

-- 0004's unique indexes become a trigger that only counted items trip. Lines of a document are
-- inserted in the document's own transaction (documents are append-only), so no race exists.
DROP INDEX "sale_lines_sale_variation_key";
DROP INDEX "purchase_lines_purchase_variation_key";

CREATE FUNCTION document_lines_one_per_counted_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  dup boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id"
    WHERE v."id" = NEW."variation_id" AND g."product_type" = 'measured'
  ) THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'sale_lines' THEN
    SELECT EXISTS (SELECT 1 FROM "sale_lines" WHERE "sale_id" = NEW."sale_id" AND "variation_id" = NEW."variation_id") INTO dup;
  ELSE
    SELECT EXISTS (SELECT 1 FROM "purchase_lines" WHERE "purchase_id" = NEW."purchase_id" AND "variation_id" = NEW."variation_id") INTO dup;
  END IF;
  IF dup THEN
    RAISE EXCEPTION 'DUPLICATE_LINE: variation % appears twice in one document', NEW."variation_id";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sale_lines_one_per_counted_item BEFORE INSERT ON "sale_lines"
  FOR EACH ROW EXECUTE FUNCTION document_lines_one_per_counted_item();
CREATE TRIGGER purchase_lines_one_per_counted_item BEFORE INSERT ON "purchase_lines"
  FOR EACH ROW EXECUTE FUNCTION document_lines_one_per_counted_item();

-- The piece ledger names the document line a SALE / RECEIVE / SALE_VOID / PURCHASE_VOID row
-- belongs to, so the document view shows each line's own pieces when a variation repeats.
ALTER TABLE "measurement_piece_ledger" ADD COLUMN "line_no" INTEGER;
ALTER TABLE "measurement_piece_ledger" ADD CONSTRAINT "measurement_piece_ledger_line_no" CHECK (
  "line_no" IS NULL OR ("line_no" > 0 AND ("sale_id" IS NOT NULL OR "purchase_id" IS NOT NULL)));

-- Backfill: before this migration a variation appeared at most once per document, so the line is
-- the one with the row's variation. The ledger is append-only; its guard is lifted for this only.
ALTER TABLE "measurement_piece_ledger" DISABLE TRIGGER "measurement_piece_ledger_no_update_delete";
UPDATE "measurement_piece_ledger" h SET "line_no" = l."line_no"
  FROM "sale_lines" l WHERE h."sale_id" IS NOT NULL AND l."sale_id" = h."sale_id" AND l."variation_id" = h."variation_id";
UPDATE "measurement_piece_ledger" h SET "line_no" = l."line_no"
  FROM "purchase_lines" l WHERE h."purchase_id" IS NOT NULL AND l."purchase_id" = h."purchase_id" AND l."variation_id" = h."variation_id";
ALTER TABLE "measurement_piece_ledger" ENABLE TRIGGER "measurement_piece_ledger_no_update_delete";
