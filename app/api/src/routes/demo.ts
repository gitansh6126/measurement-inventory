import { Router } from "express";
import { rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { DEMO_ACCOUNTS, DEMO_COMPANY_NAME, DEMO_PASSWORD } from "@rs-v31/shared";
import { prisma } from "../db.js";
import type { Env } from "../env.js";
import { audit } from "../lib/audit.js";
import { hashPassword, requirePermission } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { client, seedThroughApi } from "../lib/demo-seed.js";
import { RESTORE_TRIGGERS, wipeCompanyData } from "./backup.js";

export function demoRoutes(env: Env) {
  const r = Router();
  // Protected for company settings permission (Admin only)
  r.use(requirePermission("company.settings"));

  function guardDemo() {
    if (env.APP_ENV === "CLIENT_READY" && !env.DEMO_RESET_ENABLED) {
      throw new AppError(403, "FORBIDDEN", "Demo data management is disabled in CLIENT_READY environment");
    }
  }

  // GET /api/demo/status - check status and current data counts
  r.get("/status", async (req, res) => {
    const companyId = req.auth!.companyId;
    const [products, variations, categories, sales, purchases, warehouses, sets, parties, stockMovements] = await Promise.all([
      prisma.productGroup.count({ where: { companyId } }),
      prisma.productVariation.count({ where: { companyId } }),
      prisma.category.count({ where: { companyId } }),
      prisma.sale.count({ where: { companyId } }),
      prisma.purchase.count({ where: { companyId } }),
      prisma.warehouse.count({ where: { companyId } }),
      prisma.groupSet.count({ where: { companyId } }),
      prisma.party.count({ where: { companyId } }),
      prisma.stockMovement.count({ where: { companyId } }),
    ]);

    const isEmpty = products === 0 && sales === 0 && purchases === 0;

    res.json({
      enabled: env.APP_ENV === "DEMO" || env.DEMO_RESET_ENABLED,
      environment: env.APP_ENV,
      demoResetEnabled: env.DEMO_RESET_ENABLED,
      isEmpty,
      counts: {
        products,
        variations,
        categories,
        sales,
        purchases,
        warehouses,
        sets,
        parties,
        stockMovements,
      },
    });
  });

  // POST /api/demo/clean - wipe all data for clean/empty state
  r.post("/clean", async (req, res) => {
    guardDemo();
    const auth = req.auth!;
    const companyId = auth.companyId;

    await prisma.$transaction(
      async (tx) => {
        for (const [table, trigger] of RESTORE_TRIGGERS) {
          await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
        }
        await wipeCompanyData(tx, companyId);
        await tx.company.update({ where: { id: companyId }, data: { warehousingEnabled: false } });
        await audit(tx, {
          companyId,
          actorId: auth.userId,
          action: "DEMO_CLEAN",
          entityType: "Company",
          entityId: companyId,
          requestId: req.requestId,
        });
        await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
        for (const [table, trigger] of RESTORE_TRIGGERS) {
          await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
        }
      },
      { timeout: 120_000, maxWait: 15_000 }
    );

    // Remove any uploaded media
    await rm(path.resolve(env.storageRoot, companyId), { recursive: true, force: true }).catch(() => undefined);

    res.json({
      success: true,
      message: "Workspace cleared to clean/empty state",
      isEmpty: true,
    });
  });

  // POST /api/demo/apply - wipe and apply full demo dataset
  r.post("/apply", async (req, res) => {
    guardDemo();
    const auth = req.auth!;
    const companyId = auth.companyId;

    // 1. Wipe existing data and reset length settings
    await prisma.$transaction(
      async (tx) => {
        for (const [table, trigger] of RESTORE_TRIGGERS) {
          await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
        }
        await wipeCompanyData(tx, companyId);
        await tx.company.update({
          where: { id: companyId },
          data: {
            name: DEMO_COMPANY_NAME,
            lengthDecimalsM: 1,
            scrapBelowM: 0.5,
            lengthDecimalsFtIn: 0,
            scrapBelowFtIn: 24,
            warehousingEnabled: false,
          },
        });
        await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
        for (const [table, trigger] of RESTORE_TRIGGERS) {
          await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
        }
      },
      { timeout: 120_000, maxWait: 15_000 }
    );

    // Remove old media files
    await rm(path.resolve(env.storageRoot, companyId), { recursive: true, force: true }).catch(() => undefined);

    // 2. Ensure bootstrap demo admin exists with DEMO_PASSWORD
    const admin = DEMO_ACCOUNTS[0]!;
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    const existingAdmin = await prisma.user.findFirst({ where: { companyId, email: admin.email } });
    if (!existingAdmin) {
      const otherUser = await prisma.user.findUnique({ where: { email: admin.email } });
      if (otherUser) {
        await prisma.user.update({
          where: { id: otherUser.id },
          data: { companyId, passwordHash, active: true },
        });
      } else {
        await prisma.user.create({
          data: { companyId, name: admin.name, email: admin.email, role: admin.role, passwordHash },
        });
      }
    } else {
      await prisma.user.update({
        where: { id: existingAdmin.id },
        data: { passwordHash, active: true },
      });
    }

    // 3. Run the demo seed through THIS app on a short-lived loopback listener. Never probe
    // env.PORT: another process may listen there (a developer's demo server while tests run, or
    // another environment) and would receive this company's seed requests.
    const origin = env.allowedOrigins[0] || env.PUBLIC_APP_URL || "http://localhost:3510";
    const transientServer: ReturnType<typeof req.app.listen> = req.app.listen(0, "127.0.0.1");
    await new Promise((resolve) => transientServer.once("listening", resolve));
    const { port: p } = transientServer.address() as AddressInfo;
    const seedClient = client(`http://127.0.0.1:${p}`, origin);

    let counts;
    try {
      counts = await seedThroughApi(seedClient);
    } finally {
      transientServer.close();
    }

    await audit(prisma, {
      companyId,
      actorId: auth.userId,
      action: "DEMO_APPLY",
      entityType: "Company",
      entityId: companyId,
      after: counts,
      requestId: req.requestId,
    });

    res.json({
      success: true,
      message: "Demo sample data applied successfully",
      counts,
    });
  });

  return r;
}
