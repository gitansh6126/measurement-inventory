-- 0040 A grouped product may hold the same by-product more than once (owner 2026-10-28),
-- e.g. a chain hoist with two steel chains, each with its own variation and length per set.
--
-- label: optional name that tells the repeats apart ("Load chain" / "Hand chain"); repeats
-- saved without one are numbered "#1", "#2".

DROP INDEX "group_byproducts_group_id_product_id_key";
ALTER TABLE "group_byproducts" ADD COLUMN "label" TEXT;
CREATE INDEX "group_byproducts_group_id_idx" ON "group_byproducts"("group_id");
