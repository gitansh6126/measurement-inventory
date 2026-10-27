-- 0029 Company-wide length settings for Measured products (owner request 2026-10-20).
--
-- "Decimal places shown" and "Scrap below" move from each product's create/edit form to
-- Settings, one pair per length unit (metres; feet + inches, stored in inches). Saving them in
-- Settings writes the pair onto every Measured product of that unit, so product_groups keeps
-- its length_decimals / scrap_below columns and every reader stays unchanged.

ALTER TABLE "companies"
  ADD COLUMN "length_decimals_m" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "scrap_below_m" DECIMAL(14,3),
  ADD COLUMN "length_decimals_ft_in" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "scrap_below_ft_in" DECIMAL(14,3);

ALTER TABLE "companies" ADD CONSTRAINT "companies_measure_settings" CHECK (
  "length_decimals_m" BETWEEN 0 AND 3 AND "length_decimals_ft_in" BETWEEN 0 AND 3
  AND ("scrap_below_m" IS NULL OR "scrap_below_m" >= 0)
  AND ("scrap_below_ft_in" IS NULL OR "scrap_below_ft_in" >= 0)
);

-- Seed each company's settings from its most common existing values per unit.
UPDATE "companies" c SET
  "length_decimals_m" = COALESCE((SELECT g."length_decimals" FROM "product_groups" g
      WHERE g."company_id" = c."id" AND g."product_type" = 'measured' AND g."length_unit" = 'm' AND g."length_decimals" IS NOT NULL
      GROUP BY g."length_decimals" ORDER BY count(*) DESC, g."length_decimals" LIMIT 1), 1),
  "scrap_below_m" = (SELECT g."scrap_below" FROM "product_groups" g
      WHERE g."company_id" = c."id" AND g."product_type" = 'measured' AND g."length_unit" = 'm' AND g."scrap_below" IS NOT NULL
      GROUP BY g."scrap_below" ORDER BY count(*) DESC, g."scrap_below" LIMIT 1),
  "length_decimals_ft_in" = COALESCE((SELECT g."length_decimals" FROM "product_groups" g
      WHERE g."company_id" = c."id" AND g."product_type" = 'measured' AND g."length_unit" = 'ft_in' AND g."length_decimals" IS NOT NULL
      GROUP BY g."length_decimals" ORDER BY count(*) DESC, g."length_decimals" LIMIT 1), 1),
  "scrap_below_ft_in" = (SELECT g."scrap_below" FROM "product_groups" g
      WHERE g."company_id" = c."id" AND g."product_type" = 'measured' AND g."length_unit" = 'ft_in' AND g."scrap_below" IS NOT NULL
      GROUP BY g."scrap_below" ORDER BY count(*) DESC, g."scrap_below" LIMIT 1);

-- Apply the company setting to every existing Measured product.
UPDATE "product_groups" g SET
  "length_decimals" = CASE WHEN g."length_unit" = 'ft_in' THEN c."length_decimals_ft_in" ELSE c."length_decimals_m" END,
  "scrap_below" = CASE WHEN g."length_unit" = 'ft_in' THEN c."scrap_below_ft_in" ELSE c."scrap_below_m" END
FROM "companies" c
WHERE g."company_id" = c."id" AND g."product_type" = 'measured';
