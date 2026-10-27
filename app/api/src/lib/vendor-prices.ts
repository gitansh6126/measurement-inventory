import { Prisma } from "@prisma/client";
import type { Db } from "../db.js";
import { audit } from "./audit.js";
import { AppError } from "./errors.js";
import { ratePerOf } from "@rs-v31/shared/measure";

export const vendorPriceSelect = {
  id: true,
  variationId: true,
  supplierId: true,
  rate: true,
  active: true,
  notes: true,
  effectiveAt: true,
  updatedAt: true,
  supplier: { select: { id: true, name: true } },
  variation: { select: { id: true, shortName: true, attributes: true, group: { select: { id: true, name: true, unit: true } } } },
} satisfies Prisma.VendorPriceSelect;

export type VendorPriceRow = Prisma.VendorPriceGetPayload<{ select: typeof vendorPriceSelect }>;

export interface UpsertRateInput {
  variationId: string;
  supplierId: string;
  rate: string | number | Prisma.Decimal;
  active?: boolean;
  notes?: string | null;
  effectiveAt?: Date;
}

export interface UpsertRateContext {
  companyId: string;
  actorId: string | null;
  requestId?: string | null;
  fromPurchase?: boolean;
  supplierName?: string;
  skipValidation?: boolean;
}

export interface UpsertRateResult {
  row: VendorPriceRow;
  changed: boolean;
  action: "CREATE" | "UPDATE" | "NOOP" | "BACKDATED_PURCHASE";
}

/**
 * Shared upsert helper for vendor rates.
 * Handles validation, no-op skipping, back-dated purchases, status retention, history, and audits.
 */
export async function upsertRate(
  tx: Db,
  ctx: UpsertRateContext,
  input: UpsertRateInput
): Promise<UpsertRateResult> {
  const { companyId, actorId, requestId } = ctx;
  let supplierName = ctx.supplierName;

  if (!ctx.skipValidation) {
    const [variation, supplier] = await Promise.all([
      tx.productVariation.findFirst({ where: { id: input.variationId, companyId }, select: { id: true } }),
      tx.party.findFirst({ where: { id: input.supplierId, companyId }, select: { type: true, active: true, name: true } }),
    ]);
    if (!variation) throw new AppError(404, "NOT_FOUND", "Product variation not found");
    if (!supplier || supplier.type === "CUSTOMER") throw new AppError(400, "UNKNOWN_SUPPLIER", "That supplier was not found");
    if (!supplier.active && (input.active ?? true)) throw new AppError(400, "INACTIVE_PARTY", `${supplier.name} is inactive`);
    supplierName = supplier.name;
  }

  const key = {
    companyId_variationId_supplierId: {
      companyId,
      variationId: input.variationId,
      supplierId: input.supplierId,
    },
  };

  const existing = await tx.vendorPrice.findUnique({
    where: key,
    select: vendorPriceSelect,
  });

  const newRate = new Prisma.Decimal(input.rate);
  // History rows record the unit their rate is per (per ft on feet + inches products, 0028).
  const unitRow = await tx.productVariation.findFirst({ where: { id: input.variationId, companyId }, select: { group: { select: { lengthUnit: true } } } });
  const ratePer = ratePerOf(unitRow?.group.lengthUnit);
  const effectiveAt = input.effectiveAt ?? new Date();

  if (ctx.fromPurchase) {
    if (existing) {
      // (a) Back-dated purchase: do not overwrite current rate if existing rate is newer
      if (effectiveAt < existing.effectiveAt) {
        await tx.vendorPriceHistory.create({
          data: {
            companyId,
            variationId: input.variationId,
            supplierId: input.supplierId,
            rate: newRate,
            ratePer,
            active: existing.active,
            notes: input.notes ?? null,
            recordedById: actorId,
            recordedAt: effectiveAt,
          },
        });
        return { row: existing, changed: false, action: "BACKDATED_PURCHASE" };
      }

      // (b) Purchase auto-update keeps existing active flag on update
      const row = await tx.vendorPrice.update({
        where: key,
        data: {
          rate: newRate,
          // keep existing.active
          notes: input.notes ?? null,
          effectiveAt,
          updatedById: actorId,
        },
        select: vendorPriceSelect,
      });

      await tx.vendorPriceHistory.create({
        data: {
          companyId,
          variationId: input.variationId,
          supplierId: input.supplierId,
          rate: newRate,
          ratePer,
          active: existing.active,
          notes: input.notes ?? null,
          recordedById: actorId,
          recordedAt: effectiveAt,
        },
      });

      await audit(tx, {
        companyId,
        actorId,
        action: "VENDOR_PRICE_UPDATE",
        entityType: "VendorPrice",
        entityId: row.id,
        before: { rate: existing.rate.toFixed(2), active: existing.active },
        after: { rate: row.rate.toFixed(2), active: row.active, supplier: supplierName ?? row.supplier.name },
        requestId,
      });

      return { row, changed: true, action: "UPDATE" };
    } else {
      // First purchase with this supplier: create rate card
      const row = await tx.vendorPrice.create({
        data: {
          companyId,
          variationId: input.variationId,
          supplierId: input.supplierId,
          rate: newRate,
          active: true,
          notes: input.notes ?? null,
          effectiveAt,
          createdById: actorId,
          updatedById: actorId,
        },
        select: vendorPriceSelect,
      });

      await tx.vendorPriceHistory.create({
        data: {
          companyId,
          variationId: input.variationId,
          supplierId: input.supplierId,
          rate: newRate,
          ratePer,
          active: true,
          notes: input.notes ?? null,
          recordedById: actorId,
          recordedAt: effectiveAt,
        },
      });

      await audit(tx, {
        companyId,
        actorId,
        action: "VENDOR_PRICE_CREATE",
        entityType: "VendorPrice",
        entityId: row.id,
        before: null,
        after: { rate: row.rate.toFixed(2), active: row.active, supplier: supplierName ?? row.supplier.name },
        requestId,
      });

      return { row, changed: true, action: "CREATE" };
    }
  }

  // Explicit save (PUT / or PUT /batch)
  const targetActive = input.active ?? true;
  const targetNotes = input.notes ?? null;

  if (existing) {
    // Check no-op (F4): skip write if identical
    const isNoop =
      existing.rate.equals(newRate) &&
      existing.active === targetActive &&
      (existing.notes ?? null) === targetNotes;

    if (isNoop) {
      return { row: existing, changed: false, action: "NOOP" };
    }

    const row = await tx.vendorPrice.update({
      where: key,
      data: {
        rate: newRate,
        active: targetActive,
        notes: targetNotes,
        effectiveAt,
        updatedById: actorId,
      },
      select: vendorPriceSelect,
    });

    await tx.vendorPriceHistory.create({
      data: {
        companyId,
        variationId: input.variationId,
        supplierId: input.supplierId,
        rate: newRate,
        ratePer,
        active: targetActive,
        notes: targetNotes,
        recordedById: actorId,
        recordedAt: effectiveAt,
      },
    });

    await audit(tx, {
      companyId,
      actorId,
      action: "VENDOR_PRICE_UPDATE",
      entityType: "VendorPrice",
      entityId: row.id,
      before: { rate: existing.rate.toFixed(2), active: existing.active },
      after: { rate: row.rate.toFixed(2), active: row.active, supplier: supplierName ?? row.supplier.name },
      requestId,
    });

    return { row, changed: true, action: "UPDATE" };
  } else {
    const row = await tx.vendorPrice.create({
      data: {
        companyId,
        variationId: input.variationId,
        supplierId: input.supplierId,
        rate: newRate,
        active: targetActive,
        notes: targetNotes,
        effectiveAt,
        createdById: actorId,
        updatedById: actorId,
      },
      select: vendorPriceSelect,
    });

    await tx.vendorPriceHistory.create({
      data: {
        companyId,
        variationId: input.variationId,
        supplierId: input.supplierId,
        rate: newRate,
        ratePer,
        active: targetActive,
        notes: targetNotes,
        recordedById: actorId,
        recordedAt: effectiveAt,
      },
    });

    await audit(tx, {
      companyId,
      actorId,
      action: "VENDOR_PRICE_CREATE",
      entityType: "VendorPrice",
      entityId: row.id,
      before: null,
      after: { rate: row.rate.toFixed(2), active: row.active, supplier: supplierName ?? row.supplier.name },
      requestId,
    });

    return { row, changed: true, action: "CREATE" };
  }
}
