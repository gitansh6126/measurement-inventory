import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { audit } from "./audit.js";
import { hashPassword } from "./auth.js";
import { log } from "./logger.js";

export async function bootstrapAdmin(env: Env): Promise<void> {
  const adminEmail = env.ADMIN_EMAIL;
  const adminPassword = env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) return;

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`WITH startup_lock AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(21282, 16664)
    )
    SELECT 1::int AS acquired FROM startup_lock`;

    const configuredUser = await tx.user.findUnique({ where: { email: adminEmail } });
    if (configuredUser) {
      if (configuredUser.role !== "admin") {
        throw new Error(`ADMIN_EMAIL "${adminEmail}" already belongs to a non-admin user`);
      }
      return "configured_admin_exists" as const;
    }

    const existingAdmin = await tx.user.findFirst({
      where: { role: "admin" },
      orderBy: { createdAt: "asc" },
      select: { companyId: true },
    });
    const company =
      (existingAdmin
        ? await tx.company.findUnique({ where: { id: existingAdmin.companyId } })
        : await tx.company.findFirst({ orderBy: { createdAt: "asc" } })) ??
      (await tx.company.create({ data: { name: env.ADMIN_COMPANY_NAME } }));
    const user = await tx.user.create({
      data: {
        companyId: company.id,
        name: env.ADMIN_NAME,
        email: adminEmail,
        passwordHash: await hashPassword(adminPassword),
        role: "admin",
      },
      select: { id: true, email: true },
    });
    await audit(tx, {
      companyId: company.id,
      actorId: null,
      action: "BOOTSTRAP",
      entityType: "User",
      entityId: user.id,
      after: { company: company.name, email: user.email, role: "admin" },
    });
    return "created" as const;
  });

  if (outcome === "created") {
    log.info("admin_bootstrap_created", { email: adminEmail, database: env.databaseName });
  }
}
