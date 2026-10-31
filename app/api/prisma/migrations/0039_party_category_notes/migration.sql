-- 0039 Customer category and notes (owner 2026-10-27).
--
-- category: free text; the form offers the company's existing categories in a dropdown and
-- creates a new one by typing it, so no separate table is needed.
-- notes: free-form remarks about the customer or supplier.

ALTER TABLE "parties" ADD COLUMN "category" TEXT;
ALTER TABLE "parties" ADD COLUMN "notes" TEXT;
CREATE INDEX "parties_company_id_category_idx" ON "parties"("company_id", "category");
