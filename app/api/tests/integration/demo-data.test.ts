import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { makeCompany, makeUser, signIn } from "./helpers.js";

describe("demo data management (/api/demo)", () => {
  it("status is admin-only", async () => {
    const co = await makeCompany();
    const staff = await makeUser(co.id, "sales_staff");
    const admin = await makeUser(co.id, "admin");

    const staffClient = await signIn(staff.email);
    expect((await staffClient.get("/api/demo/status")).status).toBe(403);

    const adminClient = await signIn(admin.email);
    const res = await adminClient.get("/api/demo/status");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBeDefined();
    expect(res.body.counts).toBeDefined();
    expect(typeof res.body.counts.products).toBe("number");
  }, 30_000);

  it("clean endpoint wipes all data for clean/empty state", async () => {
    const co = await makeCompany();
    const admin = await makeUser(co.id, "admin");
    const client = await signIn(admin.email);

    // Seed sample product
    const cat = await prisma.category.create({ data: { companyId: co.id, name: `Cat ${Date.now()}` } });
    const group = await prisma.productGroup.create({
      data: { companyId: co.id, name: "Sample Item", productType: "simple", baseShortName: "SI", unit: "pcs", categoryId: cat.id },
    });
    await prisma.productVariation.create({
      data: { companyId: co.id, groupId: group.id, shortName: "SI-1", officialSku: `SI-${co.id}`, attributeKey: "", salePrice: 100, purchaseCost: 60 },
    });

    const statusBefore = (await client.get("/api/demo/status")).body;
    expect(statusBefore.counts.products).toBeGreaterThan(0);
    expect(statusBefore.isEmpty).toBe(false);

    // Call clean
    const cleanRes = await client.post("/api/demo/clean");
    expect(cleanRes.status).toBe(200);
    expect(cleanRes.body.success).toBe(true);

    const statusAfter = (await client.get("/api/demo/status")).body;
    expect(statusAfter.isEmpty).toBe(true);
    expect(statusAfter.counts.products).toBe(0);
    expect(statusAfter.counts.categories).toBe(0);

    // Admin user remains intact
    expect(await prisma.user.count({ where: { companyId: co.id } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { companyId: co.id, action: "DEMO_CLEAN" } })).toBe(1);
  }, 30_000);

  it("apply endpoint wipes and applies full demo dataset", async () => {
    const co = await makeCompany();
    const admin = await makeUser(co.id, "admin");
    const client = await signIn(admin.email);

    // Call apply
    const applyRes = await client.post("/api/demo/apply");
    expect(applyRes.status).toBe(200);
    expect(applyRes.body.success).toBe(true);
    expect(applyRes.body.counts.products).toBeGreaterThan(0);
    expect(applyRes.body.counts.categories).toBeGreaterThan(0);

    const status = (await client.get("/api/demo/status")).body;
    expect(status.isEmpty).toBe(false);
    expect(status.counts.products).toBeGreaterThan(5);
    expect(status.counts.categories).toBeGreaterThan(3);
    expect(status.counts.sales).toBeGreaterThan(0);
    expect(status.counts.warehouses).toBe(2);
  }, 90_000);
});
