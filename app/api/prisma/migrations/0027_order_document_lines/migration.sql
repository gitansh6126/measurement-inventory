-- Migration 0027: link sale / purchase lines to the order line they deliver or receive
-- (v2/docs/orders/ORDER-EDIT-AFTER-DELIVERY-PLAN.md §2).
-- A document line carries order_line_id; an order line's delivered quantity is the sum over the
-- order's live documents (not cancelled, not replaced). Document lines stay append-only: the
-- column is written on insert; the backfill below runs with the append-only triggers paused.

-- AlterTable sale_lines / purchase_lines
ALTER TABLE "sale_lines" ADD COLUMN "order_line_id" TEXT;
ALTER TABLE "purchase_lines" ADD COLUMN "order_line_id" TEXT;

-- RESTRICT: an order line that a document delivered can never be deleted (SET NULL would have to
-- update the append-only document line).
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_order_line_id_fkey"
  FOREIGN KEY ("order_line_id") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_order_line_id_fkey"
  FOREIGN KEY ("order_line_id") REFERENCES "order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "sale_lines_order_line_id_idx" ON "sale_lines"("order_line_id");
CREATE INDEX "purchase_lines_order_line_id_idx" ON "purchase_lines"("order_line_id");

-- A document line may only point to a line of the order its document belongs to, of the same item.
CREATE FUNCTION document_line_order_line_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  doc_order TEXT;
  ol_order TEXT;
  ol_variation TEXT;
BEGIN
  IF NEW.order_line_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'sale_lines' THEN
    SELECT order_id INTO doc_order FROM sales WHERE id = NEW.sale_id;
  ELSE
    SELECT order_id INTO doc_order FROM purchases WHERE id = NEW.purchase_id;
  END IF;
  SELECT order_id, variation_id INTO ol_order, ol_variation FROM order_lines WHERE id = NEW.order_line_id;
  IF doc_order IS NULL OR ol_order IS DISTINCT FROM doc_order OR ol_variation IS DISTINCT FROM NEW.variation_id THEN
    RAISE EXCEPTION '%: order line % does not belong to this document''s order and item', TG_TABLE_NAME, NEW.order_line_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER sale_lines_order_line_check BEFORE INSERT ON "sale_lines"
  FOR EACH ROW EXECUTE FUNCTION document_line_order_line_check();
CREATE TRIGGER purchase_lines_order_line_check BEFORE INSERT ON "purchase_lines"
  FOR EACH ROW EXECUTE FUNCTION document_line_order_line_check();

-- Backfill ---------------------------------------------------------------------------------------
ALTER TABLE "sales" DISABLE TRIGGER "sales_no_update_delete";
ALTER TABLE "purchases" DISABLE TRIGGER "purchases_no_update_delete";
ALTER TABLE "sale_lines" DISABLE TRIGGER "sale_lines_no_update_delete";
ALTER TABLE "purchase_lines" DISABLE TRIGGER "purchase_lines_no_update_delete";

-- 1. Orders completed before 0026 only had orders.document_id.
UPDATE "sales" s SET "order_id" = o."id"
  FROM "orders" o
  WHERE o."kind" = 'SALE' AND o."document_id" = s."id" AND o."company_id" = s."company_id" AND s."order_id" IS NULL;
UPDATE "purchases" p SET "order_id" = o."id"
  FROM "orders" o
  WHERE o."kind" = 'PURCHASE' AND o."document_id" = p."id" AND o."company_id" = p."company_id" AND p."order_id" IS NULL;

-- 2. Revisions (document edit, 0024) of an order's document were written without order_id.
WITH RECURSIVE chain AS (
  SELECT s."id", s."order_id" FROM "sales" s WHERE s."order_id" IS NOT NULL
  UNION ALL
  SELECT r."id", c."order_id" FROM "sales" r JOIN chain c ON r."replaces_id" = c."id" WHERE r."order_id" IS NULL
)
UPDATE "sales" s SET "order_id" = chain."order_id" FROM chain WHERE s."id" = chain."id" AND s."order_id" IS NULL;
WITH RECURSIVE chain AS (
  SELECT p."id", p."order_id" FROM "purchases" p WHERE p."order_id" IS NOT NULL
  UNION ALL
  SELECT r."id", c."order_id" FROM "purchases" r JOIN chain c ON r."replaces_id" = c."id" WHERE r."order_id" IS NULL
)
UPDATE "purchases" p SET "order_id" = chain."order_id" FROM chain WHERE p."id" = chain."id" AND p."order_id" IS NULL;

-- 3. Document line → order line: same order and item; several lines of one Measured item are
--    paired in line order. Lines with no partner stay NULL.
WITH dl AS (
  SELECT l."id", s."order_id", l."variation_id",
         row_number() OVER (PARTITION BY l."sale_id", l."variation_id" ORDER BY l."line_no") AS rn
  FROM "sale_lines" l JOIN "sales" s ON s."id" = l."sale_id"
  WHERE s."order_id" IS NOT NULL
), ol AS (
  SELECT "id", "order_id", "variation_id",
         row_number() OVER (PARTITION BY "order_id", "variation_id" ORDER BY "line_no") AS rn
  FROM "order_lines"
)
UPDATE "sale_lines" t SET "order_line_id" = ol."id"
  FROM dl JOIN ol ON ol."order_id" = dl."order_id" AND ol."variation_id" = dl."variation_id" AND ol."rn" = dl."rn"
  WHERE t."id" = dl."id";

WITH dl AS (
  SELECT l."id", p."order_id", l."variation_id",
         row_number() OVER (PARTITION BY l."purchase_id", l."variation_id" ORDER BY l."line_no") AS rn
  FROM "purchase_lines" l JOIN "purchases" p ON p."id" = l."purchase_id"
  WHERE p."order_id" IS NOT NULL
), ol AS (
  SELECT "id", "order_id", "variation_id",
         row_number() OVER (PARTITION BY "order_id", "variation_id" ORDER BY "line_no") AS rn
  FROM "order_lines"
)
UPDATE "purchase_lines" t SET "order_line_id" = ol."id"
  FROM dl JOIN ol ON ol."order_id" = dl."order_id" AND ol."variation_id" = dl."variation_id" AND ol."rn" = dl."rn"
  WHERE t."id" = dl."id";

ALTER TABLE "sales" ENABLE TRIGGER "sales_no_update_delete";
ALTER TABLE "purchases" ENABLE TRIGGER "purchases_no_update_delete";
ALTER TABLE "sale_lines" ENABLE TRIGGER "sale_lines_no_update_delete";
ALTER TABLE "purchase_lines" ENABLE TRIGGER "purchase_lines_no_update_delete";

-- 4. Delivered quantity = sum over the order's live documents (orders completed before 0026 had 0).
UPDATE "order_lines" ol SET "fulfilled_quantity" = LEAST(ol."quantity", d."qty")
  FROM (
    SELECT l."order_line_id", SUM(l."quantity") AS qty
    FROM "sale_lines" l
    WHERE l."order_line_id" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "document_voids" v WHERE v."sale_id" = l."sale_id")
    GROUP BY l."order_line_id"
    UNION ALL
    SELECT l."order_line_id", SUM(l."quantity") AS qty
    FROM "purchase_lines" l
    WHERE l."order_line_id" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "document_voids" v WHERE v."purchase_id" = l."purchase_id")
    GROUP BY l."order_line_id"
  ) d
  WHERE ol."id" = d."order_line_id" AND ol."fulfilled_quantity" <> LEAST(ol."quantity", d."qty");
