-- V2 plan §2 (owner decision DM-1): Measured is a third product type. New enum values must be
-- committed before a constraint or row can use them, so they get their own migration (as 0009).
ALTER TYPE "ProductType" ADD VALUE 'measured';
