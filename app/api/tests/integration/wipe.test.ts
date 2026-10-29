import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { getEnv } from "../../src/env.js";
import { makeCompany, makeUser, signIn } from "./helpers.js";

describe("delete all data", () => {
  it("is admin-only and needs the typed phrase", async () => {
    const co = await makeCompany();
    const staff = await makeUser(co.id, "sales_staff");
    const admin = await makeUser(co.id, "admin");
    expect((await (await signIn(staff.email)).post("/api/backup/wipe").send({ confirm: "DELETE ALL DATA" })).status).toBe(403);
    const res = await (await signIn(admin.email)).post("/api/backup/wipe").send({ confirm: "yes" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("empties the company, keeps users, and leaves other companies alone", async () => {
    const storageRoot = path.resolve(getEnv().storageRoot);
    const co = await makeCompany();
    const other = await makeCompany();
    const admin = await makeUser(co.id, "admin");
    const client = await signIn(admin.email);

    const seed = async (companyId: string) => {
      const cat = await prisma.category.create({ data: { companyId, name: `Wire ${Date.now()}` } });
      await prisma.party.create({ data: { companyId, name: "Supplier", type: "BOTH" } });
      const group = await prisma.productGroup.create({
        data: { companyId, name: "Wire", productType: "simple", baseShortName: "W", unit: "kg", categoryId: cat.id },
      });
      const v = await prisma.productVariation.create({
        data: { companyId, groupId: group.id, shortName: "W-1", officialSku: `W-1-${companyId}`, attributeKey: "", salePrice: 10, purchaseCost: 5 },
      });
      await prisma.stockMovement.create({
        data: { companyId, variationId: v.id, movementType: "OPENING", quantity: 5, unit: "kg", reason: "Opening" },
      });
    };
    await seed(co.id);
    await seed(other.id);
    const imgFile = path.resolve(storageRoot, co.id, "2026-10", "x.jpg");
    await mkdir(path.dirname(imgFile), { recursive: true });
    await writeFile(imgFile, Buffer.from([0xff, 0xd8]));

    const res = await client.post("/api/backup/wipe").send({ confirm: "DELETE ALL DATA" });
    expect(res.status).toBe(200);

    const summary = (await client.get("/api/backup/summary")).body;
    expect(Object.values(summary).every((n) => n === 0)).toBe(true);
    expect(existsSync(imgFile)).toBe(false);
    expect(await prisma.user.count({ where: { companyId: co.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { companyId: co.id, action: "DATA_WIPE" } })).toBe(1);
    expect(await prisma.productVariation.count({ where: { companyId: other.id } })).toBe(1);
    expect(await prisma.stockMovement.count({ where: { companyId: other.id } })).toBe(1);

    // The empty company still works: a new product can be added.
    const cat = await prisma.category.create({ data: { companyId: co.id, name: "Fresh" } });
    expect(cat.id).toBeTruthy();
  });
});
