import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { getEnv } from "../../src/env.js";
import { bootstrapAdmin } from "../../src/lib/bootstrap-admin.js";

describe("environment-based admin bootstrap", () => {
  it("creates one admin under concurrent startup and preserves that account on later startup", async () => {
    const email = `bootstrap-${randomUUID()}@test.local`;
    const companyName = `Bootstrap ${randomUUID().slice(0, 8)}`;
    const companiesBefore = await prisma.company.count();
    const env = {
      ...getEnv(),
      ADMIN_EMAIL: email,
      ADMIN_PASSWORD: "initial-bootstrap-password",
      ADMIN_NAME: "Initial Owner",
      ADMIN_COMPANY_NAME: companyName,
    };

    await Promise.all([bootstrapAdmin(env), bootstrapAdmin(env)]);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const passwordHash = user.passwordHash;
    const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } });
    expect(user.name).toBe("Initial Owner");
    expect(user.role).toBe("admin");
    if (companiesBefore === 0) expect(company.name).toBe(companyName);
    expect(await prisma.auditEvent.count({ where: { entityId: user.id, action: "BOOTSTRAP" } })).toBe(1);

    await bootstrapAdmin({ ...env, ADMIN_PASSWORD: "a-different-password" });

    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash).toBe(passwordHash);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityId: user.id, action: "BOOTSTRAP" } })).toBe(1);
  });
});
