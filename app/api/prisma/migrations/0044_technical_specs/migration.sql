-- 0044 Technical specifications (owner 2026-10-30): rows of { name, value } in the user's order,
-- e.g. "Breaking load" = "12 t". On every product, on each variation of a Variable / Measured
-- product (shown after the product's own rows on the product page), and on each standard set of
-- a grouped product. A standard set also gets its own image, shown when that set is picked
-- (like a variation's image).

ALTER TABLE "product_groups" ADD COLUMN "specs" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "product_variations" ADD COLUMN "specs" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "group_set_types" ADD COLUMN "specs" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "group_set_types" ADD COLUMN "image_url" TEXT;
