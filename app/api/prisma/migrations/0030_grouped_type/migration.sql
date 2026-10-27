-- 0030 Grouped products (sets), V3.1 plan docs\GROUPED-PRODUCTS-V3-PLAN.md.
-- New enum values only: PostgreSQL cannot use a value added in the same transaction, so the
-- tables and checks that use them follow in 0031_grouped_sets (same split as 0020 / 0021).

ALTER TYPE "ProductType" ADD VALUE 'grouped';
ALTER TYPE "PieceAction" ADD VALUE 'SET_ALLOCATE';
ALTER TYPE "PieceAction" ADD VALUE 'SET_RELEASE';
