import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// V2 counted-stock sales use the fixed Warn & Allow policy; only explicit sale confirmation
// may take stock below zero, and every such sale is audited.

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const put = (a: Agent, url: string, body: unknown) => a.put(url).set("Origin", ORIGIN).send(body as object);

async function setup(opening = 2) {
  const co = await makeCompany();
  const admin = await signIn((await makeUser(co.id, "admin")).email);
  const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
  const staff = await signIn((await makeUser(co.id, "sales_staff")).email);
  const p = (await post(manager, "/api/products", { productType: "simple", name: "Motor", unit: "Nos", shortName: `MTR-${co.id.slice(-6)}`, officialSku: null })).body.product;
  const v = p.variations[0].id as string;
  if (opening) await post(manager, "/api/inventory/adjustments", { variationId: v, type: "OPENING", quantity: opening });
  return { co, admin, manager, staff, v };
}

const stored = async (variationId: string) => Number((await prisma.stockBalance.findUnique({ where: { variationId } }))?.quantity ?? 0);
const ledger = async (variationId: string) => Number((await prisma.stockMovement.aggregate({ where: { variationId }, _sum: { quantity: true } }))._sum.quantity ?? 0);
const drift = async (companyId: string) =>
  prisma.$queryRaw<unknown[]>`SELECT * FROM stock_balance_drift WHERE company_id = ${companyId}`;
const sell = (a: Agent, v: string, quantity: number, allowNegative?: boolean) =>
  post(a, "/api/sales", { lines: [{ variationId: v, quantity, price: 10 }], ...(allowNegative === undefined ? {} : { allowNegative }) });

describe("stored stock balance", () => {
  it("stays equal to the movement ledger through opening, sale, purchase and adjustment", async () => {
    const { co, manager, v } = await setup(10);
    await sell(manager, v, 3);
    await post(manager, "/api/purchases", { lines: [{ variationId: v, quantity: 5, price: 4 }] });
    await post(manager, "/api/inventory/adjustments", { variationId: v, quantity: -2, reason: "Damaged" });
    expect(await stored(v)).toBe(10);
    expect(await ledger(v)).toBe(10);
    expect(await drift(co.id)).toEqual([]);
  });

  it("keeps the balance exact under 8 concurrent sales", async () => {
    const { co, manager, v } = await setup(10);
    const results = await Promise.all(Array.from({ length: 8 }, () => sell(manager, v, 2)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(await stored(v)).toBe(0);
    expect(await drift(co.id)).toEqual([]);
  });
});

describe("negative stock policy", () => {
  it("always warns regardless of legacy policy data, then audits a confirmed sale and reconciles a purchase", async () => {
    const { co, staff, manager, v } = await setup(2);
    await prisma.company.update({ where: { id: co.id }, data: { negativeStockPolicy: "STRICT" } });
    const unconfirmed = await sell(staff, v, 5);
    expect(unconfirmed.status).toBe(409);
    expect(unconfirmed.body.error.details[0]).toMatchObject({ canOversell: true });

    const ok = await sell(staff, v, 5, true);
    expect(ok.status).toBe(201);
    expect(await stored(v)).toBe(-3);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { companyId: co.id, action: "STOCK_NEGATIVE_DISPATCH", entityId: v } });
    expect(ev.after).toMatchObject({ requestedQty: 5, priorBalance: 2, newBalance: -3, saleId: ok.body.id });

    const inventory = (await manager.get(`/api/inventory/products/${(await prisma.productVariation.findUniqueOrThrow({ where: { id: v } })).groupId}`)).body;
    expect(JSON.stringify(inventory)).toContain('"state":"negative"');

    await post(manager, "/api/purchases", { lines: [{ variationId: v, quantity: 10, price: 4 }] });
    expect(await stored(v)).toBe(7);
    expect(await drift(co.id)).toEqual([]);
  });

  it("allows any sale role to confirm and audits every confirmed below-zero sale", async () => {
    const { co, admin, manager, staff, v } = await setup(1);
    for (const seller of [admin, manager, staff]) {
      expect((await sell(seller, v, 2, true)).status).toBe(201);
    }
    expect(await stored(v)).toBe(-5);
    expect(await prisma.auditEvent.count({ where: { companyId: co.id, action: "STOCK_NEGATIVE_DISPATCH", entityId: v } })).toBe(3);
  });

  it("never lets an adjustment take stock below zero", async () => {
    const { manager, v } = await setup(2);
    const r = await post(manager, "/api/inventory/adjustments", { variationId: v, quantity: -5, reason: "Count" });
    expect(r.status).toBe(409);
    expect(await stored(v)).toBe(2);
  });

  it("the database still refuses a non-sale movement below zero", async () => {
    const { co, v } = await setup(1);
    await expect(
      prisma.stockMovement.create({ data: { companyId: co.id, variationId: v, movementType: "ADJUSTMENT", quantity: -2, unit: "Nos", reason: "direct" } }),
    ).rejects.toThrow(/INSUFFICIENT_STOCK/);
    expect(await stored(v)).toBe(1);
  });
});

describe("company settings", () => {
  it("every role reads the fixed policy and no role can change it", async () => {
    const { co, admin, staff } = await setup(0);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: co.id } })).negativeStockPolicy).toBe("WARN_AND_ALLOW");
    await prisma.company.update({ where: { id: co.id }, data: { negativeStockPolicy: "MANAGER_OVERRIDE" } });
    const read = await staff.get("/api/company/settings");
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ negativeStockPolicy: "WARN_AND_ALLOW", canOversell: true });
    expect((await put(staff, "/api/company/settings", { negativeStockPolicy: "STRICT" })).status).toBe(403);
    const change = await put(admin, "/api/company/settings", { negativeStockPolicy: "MANAGER_OVERRIDE" });
    expect(change.status).toBe(409);
    expect(change.body.error.code).toBe("POLICY_FIXED");
    expect((await prisma.company.findUniqueOrThrow({ where: { id: co.id } })).negativeStockPolicy).toBe("MANAGER_OVERRIDE");
  });
});
