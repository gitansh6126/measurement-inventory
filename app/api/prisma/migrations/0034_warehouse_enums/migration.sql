-- 0034 Warehouses, part 1 (docs\WAREHOUSE-V3-PLAN.md §2.2): new enum values only. A value added
-- with ADD VALUE cannot be used in the transaction that adds it, so 0035 uses them.
ALTER TYPE "MovementType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "MovementType" ADD VALUE 'TRANSFER_IN';
ALTER TYPE "MovementType" ADD VALUE 'TRANSFER_VOID';
ALTER TYPE "PieceAction" ADD VALUE 'TRANSFER';
ALTER TYPE "PieceAction" ADD VALUE 'TRANSFER_VOID';
