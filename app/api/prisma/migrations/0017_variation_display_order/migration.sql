ALTER TABLE "product_variations"
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "group_id" ORDER BY "created_at", "id") - 1 AS position
  FROM "product_variations"
)
UPDATE "product_variations" AS v
SET "sort_order" = ranked.position
FROM ranked
WHERE ranked."id" = v."id";
