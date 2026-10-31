-- 0041 Price, minimum selling price and minimum stock per set type (owner 2026-10-28).
--
-- A set type is the sets of one grouped product with the same parts (same by-product, variation
-- and fitted length). type_key is built by the API from the parts ("<byproductId>:<variationId>:
-- <milli>" joined by "|"; "" = main part only). The grouped product's own variation keeps no
-- standard price any more: Stock In and the Add sets sheet set these per set type, and the sale
-- set drawer prices a set from its type (falling back to the old product price while unset).
-- standard: a standard set defined on the grouped product form (owner 2026-10-28): name + parts
-- ([{ byproductId, variationId, length? (milli) }]); typing a set count in Stock In or a purchase
-- builds the sets from it (parts come in as new stock with the set, like opening sets).
-- sort_order is kept for the child-row order (V3.2 backlog A2).

CREATE TABLE "group_set_types" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "type_key" TEXT NOT NULL,
    "standard" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "parts" JSONB NOT NULL DEFAULT '[]',
    "sale_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "min_sale_price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,
    CONSTRAINT "group_set_types_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "group_set_types_low_stock_check" CHECK ("low_stock_threshold" >= 0),
    CONSTRAINT "group_set_types_prices_check" CHECK ("sale_price" >= 0 AND "min_sale_price" >= 0)
);

CREATE UNIQUE INDEX "group_set_types_company_id_group_id_type_key_key" ON "group_set_types"("company_id", "group_id", "type_key");
CREATE INDEX "group_set_types_group_id_idx" ON "group_set_types"("group_id");

ALTER TABLE "group_set_types" ADD CONSTRAINT "group_set_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "group_set_types" ADD CONSTRAINT "group_set_types_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "product_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
