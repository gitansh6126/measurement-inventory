-- 0028 Measured rate unit (owner decision 2026-10-16).
--
-- Every rate of a Measured product is stored per its rate unit: per metre for metric products,
-- per FOOT for feet + inches products, whose lengths stay in inches. A line's amount is then
-- quantity (base units) ÷ rate_per × price, rounded half-up to the whole rupee.
--
-- rate_per = base units per rate unit: 1 (per m, per in, counted items) or 12 (per ft on inches).
-- Posted documents, stock movements and price history are append-only, so their existing rows
-- keep rate_per = 1 (their price stays per inch and is shown so). Editable rows that hold a
-- current rate — variation prices, supplier rates, roll costs, order lines, parked drafts — are
-- converted to per foot here.

CREATE OR REPLACE FUNCTION measure_rate_per(unit "LengthUnit") RETURNS integer
  LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN unit = 'ft_in' THEN 12 ELSE 1 END $$;

ALTER TABLE "sale_lines" ADD COLUMN "rate_per" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "purchase_lines" ADD COLUMN "rate_per" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "order_lines" ADD COLUMN "rate_per" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "stock_movements" ADD COLUMN "rate_per" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "vendor_price_history" ADD COLUMN "rate_per" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_rate_per" CHECK ("rate_per" IN (1, 12));
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_rate_per" CHECK ("rate_per" IN (1, 12));
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_rate_per" CHECK ("rate_per" IN (1, 12));
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_rate_per" CHECK ("rate_per" IN (1, 12));
ALTER TABLE "vendor_price_history" ADD CONSTRAINT "vendor_price_history_rate_per" CHECK ("rate_per" IN (1, 12));

-- Line amounts (0021 / 0023 rule, now per rate unit): a whole quantity at rate_per 1 keeps the
-- exact product; anything else is rounded half-up to the whole rupee.
ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_amounts";
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_amounts" CHECK (
  "line_no" > 0 AND "quantity" > 0 AND "unit_price" >= 0 AND "discount" >= 0
  AND "discount" <= CASE WHEN "rate_per" = 1 AND "quantity" = trunc("quantity") THEN "quantity" * "unit_price" ELSE round("quantity" * "unit_price" / "rate_per", 0) END
  AND "line_total" = CASE WHEN "rate_per" = 1 AND "quantity" = trunc("quantity") THEN "quantity" * "unit_price" ELSE round("quantity" * "unit_price" / "rate_per", 0) END - "discount");

ALTER TABLE "purchase_lines" DROP CONSTRAINT "purchase_lines_amounts";
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_amounts" CHECK (
  "line_no" > 0 AND "quantity" > 0 AND "unit_cost" >= 0 AND "discount" >= 0
  AND "discount" <= CASE WHEN "rate_per" = 1 AND "quantity" = trunc("quantity") THEN "quantity" * "unit_cost" ELSE round("quantity" * "unit_cost" / "rate_per", 0) END
  AND "line_total" = CASE WHEN "rate_per" = 1 AND "quantity" = trunc("quantity") THEN "quantity" * "unit_cost" ELSE round("quantity" * "unit_cost" / "rate_per", 0) END - "discount");

ALTER TABLE "order_lines" DROP CONSTRAINT "order_lines_amounts";
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_amounts" CHECK (
  "line_no" > 0 AND "quantity" > 0 AND "price" >= 0 AND "discount" >= 0
  AND "discount" <= CASE WHEN "rate_per" = 1 AND "quantity" = trunc("quantity") THEN "quantity" * "price" ELSE round("quantity" * "price" / "rate_per", 0) END
  AND "line_total" = CASE WHEN "rate_per" = 1 AND "quantity" = trunc("quantity") THEN "quantity" * "price" ELSE round("quantity" * "price" / "rate_per", 0) END - "discount");

-- Current rates of feet + inches products: per inch → per foot (× 12, exact for whole rupees).
UPDATE "product_variations" v
SET "sale_price" = v."sale_price" * 12, "min_sale_price" = v."min_sale_price" * 12, "purchase_cost" = v."purchase_cost" * 12
FROM "product_groups" g
WHERE g."id" = v."group_id" AND g."length_unit" = 'ft_in';

UPDATE "vendor_prices" vp
SET "rate" = vp."rate" * 12
FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id"
WHERE v."id" = vp."variation_id" AND g."length_unit" = 'ft_in';

UPDATE "measurement_pieces" p
SET "unit_cost" = p."unit_cost" * 12
FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id"
WHERE v."id" = p."variation_id" AND g."length_unit" = 'ft_in' AND p."unit_cost" IS NOT NULL;

-- Order lines are editable: price × 12 at rate_per 12 keeps every amount (whole-rupee prices).
UPDATE "order_lines" ol
SET "price" = ol."price" * 12, "rate_per" = 12
FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id"
WHERE v."id" = ol."variation_id" AND g."length_unit" = 'ft_in';

-- Parked drafts: each feet + inches line's typed price becomes per foot.
UPDATE "draft_orders" d
SET "lines" = (
  SELECT jsonb_agg(
    CASE WHEN EXISTS (
      SELECT 1 FROM "product_variations" v JOIN "product_groups" g ON g."id" = v."group_id"
      WHERE v."id" = e ->> 'variationId' AND g."length_unit" = 'ft_in'
    ) AND (e ->> 'price') ~ '^\d{1,9}$'
    THEN jsonb_set(e, '{price}', to_jsonb(((e ->> 'price')::numeric * 12)::bigint::text))
    ELSE e END
    ORDER BY ord)
  FROM jsonb_array_elements(d."lines") WITH ORDINALITY AS t(e, ord)
)
WHERE jsonb_typeof(d."lines") = 'array' AND jsonb_array_length(d."lines") > 0;
