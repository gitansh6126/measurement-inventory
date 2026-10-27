-- 0037 Sets on orders (V3.1 grouped products, docs\GROUPED-PRODUCTS-V3-PLAN.md §3, §3.1).
--
-- A sale-order line of a grouped product holds the sets picked when the order was taken (D23):
-- group_sets.status = 'HELD' with order_id / order_line_no, and order_lines.sets keeps the part
-- changes planned for each set, [{ setId, changes }], applied at delivery. A purchase-order line
-- may carry the sets expected, [{ parts, notes, warehouseId }] (as a purchase line's sets), or
-- leave them to be entered when the sets are received. Sets at another price go on another line,
-- so a grouped product may repeat on an order, as on documents (0032).

ALTER TABLE "order_lines" ADD COLUMN "sets" JSONB;
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_sets_array" CHECK (
  "sets" IS NULL OR (jsonb_typeof("sets") = 'array' AND jsonb_array_length("sets") > 0));

CREATE OR REPLACE FUNCTION order_lines_one_per_counted_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id"
    WHERE v."id" = NEW."variation_id" AND g."product_type"::text IN ('measured', 'grouped')
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
