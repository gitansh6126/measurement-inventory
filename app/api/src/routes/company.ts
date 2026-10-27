import { Router } from "express";
import { z } from "zod";
import { prisma, WRITE_TX } from "../db.js";
import { audit } from "../lib/audit.js";
import { requirePermission } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { mayOversell } from "../lib/stock.js";

const NEGATIVE_STOCK_POLICY = "WARN_AND_ALLOW" as const;

const lengthSettingsSelect = { lengthDecimalsM: true, scrapBelowM: true, lengthDecimalsFtIn: true, scrapBelowFtIn: true } as const;
type LengthSettingsRow = {
  lengthDecimalsM: number;
  scrapBelowM: { toString(): string } | null;
  lengthDecimalsFtIn: number;
  scrapBelowFtIn: { toString(): string } | null;
};

/** Company length settings for Measured products, per length unit (scrap-below in base units). */
const lengthSettingsOf = (c: LengthSettingsRow) => ({
  m: { decimals: c.lengthDecimalsM, scrapBelow: c.scrapBelowM === null ? null : Number(c.scrapBelowM) },
  ft_in: { decimals: c.lengthDecimalsFtIn, scrapBelow: c.scrapBelowFtIn === null ? null : Number(c.scrapBelowFtIn) },
});

const unitSetting = z.object({
  decimals: z.number().int().min(0).max(3),
  scrapBelow: z
    .number()
    .min(0)
    .max(1_000_000)
    .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, "Use at most 3 decimal places")
    .nullable(),
});
const lengthSettingsBody = z.object({ m: unitSetting, ft_in: unitSetting });

export function companyRoutes() {
  const r = Router();

  // Keep the policy in the response for existing clients; it is fixed for all V2 companies.
  r.get("/settings", requirePermission("catalog.view"), async (req, res) => {
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: req.auth!.companyId },
      select: { name: true, ...lengthSettingsSelect },
    });
    res.json({
      name: company.name,
      negativeStockPolicy: NEGATIVE_STOCK_POLICY,
      canOversell: mayOversell(req.auth!.role),
      lengthSettings: lengthSettingsOf(company),
    });
  });

  r.put("/settings", requirePermission("company.settings"), () => {
    throw new AppError(409, "POLICY_FIXED", "Counted-stock policy is fixed to Warn & Allow in V2");
  });

  // Decimal places shown and scrap-below length for every Measured product (0029). Saving
  // copies each unit's pair onto all Measured products of that unit.
  r.put("/length-settings", requirePermission("company.settings"), async (req, res) => {
    const body = lengthSettingsBody.parse(req.body);
    const companyId = req.auth!.companyId;
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.company.findUniqueOrThrow({ where: { id: companyId }, select: lengthSettingsSelect });
      const after = await tx.company.update({
        where: { id: companyId },
        data: {
          lengthDecimalsM: body.m.decimals,
          scrapBelowM: body.m.scrapBelow,
          lengthDecimalsFtIn: body.ft_in.decimals,
          scrapBelowFtIn: body.ft_in.scrapBelow,
        },
        select: lengthSettingsSelect,
      });
      let products = 0;
      for (const unit of ["m", "ft_in"] as const) {
        const { count } = await tx.productGroup.updateMany({
          where: { companyId, productType: "measured", lengthUnit: unit },
          data: { lengthDecimals: body[unit].decimals, scrapBelow: body[unit].scrapBelow },
        });
        products += count;
      }
      await audit(tx, {
        companyId,
        actorId: req.auth!.userId,
        action: "COMPANY_LENGTH_SETTINGS",
        entityType: "Company",
        entityId: companyId,
        before: lengthSettingsOf(before),
        after: lengthSettingsOf(after),
        requestId: req.requestId,
      });
      return { lengthSettings: lengthSettingsOf(after), productsUpdated: products };
    }, WRITE_TX);
    res.json(result);
  });

  return r;
}
