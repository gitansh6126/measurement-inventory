ALTER TABLE "product_groups"
  ADD COLUMN "last_sale_at" TIMESTAMP(3);

CREATE INDEX "product_groups_company_id_last_sale_at_idx"
  ON "product_groups"("company_id", "last_sale_at");

-- Preserve all existing records and initialize the derived cache from valid sale history.
UPDATE "product_groups" g
SET "last_sale_at" = sales."last_sale_at"
FROM (
  SELECT v."group_id", MAX(s."sale_date") AS "last_sale_at"
  FROM "product_variations" v
  JOIN "sale_lines" sl ON sl."variation_id" = v."id"
  JOIN "sales" s ON s."id" = sl."sale_id" AND s."company_id" = v."company_id"
  LEFT JOIN "document_voids" dv ON dv."sale_id" = s."id" AND dv."company_id" = s."company_id"
  WHERE s."status" = 'COMPLETED'
    AND dv."id" IS NULL
  GROUP BY v."group_id"
) sales
WHERE g."id" = sales."group_id";
