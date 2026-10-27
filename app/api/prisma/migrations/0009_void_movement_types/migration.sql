-- V2 document void (D3, plan §3.1). New enum values must be committed before any constraint or
-- row can use them, so they get their own migration; 0010 adds the rules that use them.
ALTER TYPE "MovementType" ADD VALUE 'SALE_VOID';
ALTER TYPE "MovementType" ADD VALUE 'PURCHASE_VOID';
