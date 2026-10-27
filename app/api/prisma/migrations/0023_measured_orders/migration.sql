-- v2.1: sale and purchase orders hold Measured items (v2.1/MERGE-V2.1.md, "Orders × measured").
-- 0014 was written before Measured products: whole quantities, one line per variation. Orders now
-- follow the documents (0020 / 0021): a length with 3 decimals, several lines of one Measured
-- variation, the preferred piece of a sale-order line and the typed rolls of a purchase-order
-- line, carried into writeDocument when the order completes.

ALTER TABLE "order_lines" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(14,3);

-- Sale orders: the piece the seller chose (a preference: if it no longer has the length when
-- the order completes, the cut plan picks the next piece in DM-5 order).
ALTER TABLE "order_lines" ADD COLUMN "piece_id" TEXT;
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_piece_id_fkey"
  FOREIGN KEY ("piece_id") REFERENCES "measurement_pieces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "order_lines_piece_id_idx" ON "order_lines"("piece_id");

-- Purchase orders: one entry per roll expected, [{ length, kind, supplierRollNo, rack, notes }]
-- with length in the product's base unit; the line quantity is their sum.
ALTER TABLE "order_lines" ADD COLUMN "rolls" JSONB;
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_measure_fields" CHECK (
  ("piece_id" IS NULL OR "rolls" IS NULL)
  AND ("rolls" IS NULL OR (jsonb_typeof("rolls") = 'array' AND jsonb_array_length("rolls") > 0)));

-- Line amounts as 0020 has them for documents: a whole quantity keeps the exact product; a
-- fractional length is rounded to the whole rupee (owner decision: no paise on measured lines).
ALTER TABLE "order_lines" DROP CONSTRAINT "order_lines_amounts";
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_amounts" CHECK (
  "line_no" > 0 AND "quantity" > 0 AND "price" >= 0 AND "discount" >= 0
  AND "discount" <= CASE WHEN "quantity" = trunc("quantity") THEN "quantity" * "price" ELSE round("quantity" * "price", 0) END
  AND "line_total" = CASE WHEN "quantity" = trunc("quantity") THEN "quantity" * "price" ELSE round("quantity" * "price", 0) END - "discount");

-- Counted (Simple / Variable) items stay whole (0020's function). Order lines are replaced as a
-- set on every edit, so INSERT covers them; UPDATE is checked too for safety.
CREATE TRIGGER order_lines_whole_quantity BEFORE INSERT OR UPDATE OF "quantity", "variation_id" ON "order_lines"
  FOR EACH ROW EXECUTE FUNCTION quantity_whole_unless_measured();

-- One line per counted item, several per Measured variation (as 0021 did for documents). Edits
-- lock the order row first (orders.ts lockOrder), so concurrent inserts into one order serialise.
DROP INDEX "order_lines_order_id_variation_id_key";
CREATE INDEX "order_lines_order_id_variation_id_idx" ON "order_lines"("order_id", "variation_id");

CREATE FUNCTION order_lines_one_per_counted_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id"
    WHERE v."id" = NEW."variation_id" AND g."product_type" = 'measured'
  ) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "order_lines"
    WHERE "order_id" = NEW."order_id" AND "variation_id" = NEW."variation_id" AND "id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_LINE: variation % appears twice in one order', NEW."variation_id";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_lines_one_per_counted_item BEFORE INSERT OR UPDATE OF "variation_id", "order_id" ON "order_lines"
  FOR EACH ROW EXECUTE FUNCTION order_lines_one_per_counted_item();
