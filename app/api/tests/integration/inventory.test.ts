import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const patch = (a: Agent, url: string, body: unknown) => a.patch(url).set("Origin", ORIGIN).send(body as object);

async function setup() {
  const co = await makeCompany();
  const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
  const staff = await signIn((await makeUser(co.id, "sales_staff")).email);
  const product = (
    await post(manager, "/api/products", {
      productType: "variable",
      name: "Chain",
      unit: "Nos",
      baseShortName: "CH",
      attributes: [{ name: "Size", values: ["6", "8"] }],
      variations: [{ attributes: { Size: "6" } }, { attributes: { Size: "8" } }],
    })
  ).body.product;
  const [v6, v8] = product.variations as { id: string }[];
  return { co, manager, staff, product, v6: v6!.id, v8: v8!.id };
}

const stockOf = async (a: Agent, productId: string) => (await a.get(`/api/inventory/products/${productId}`)).body.product;

describe("inventory", () => {
  it("starts every variation at zero and out of stock", async () => {
    const { manager, product } = await setup();
    const p = await stockOf(manager, product.id);
    expect(p.variations.map((v: { quantity: number; state: string }) => [v.quantity, v.state])).toEqual([[0, "out"], [0, "out"]]);
  });

  it("records opening stock once, then adjustments with a reason; stock = sum of movements", async () => {
    const { manager, product, v6 } = await setup();
    expect((await post(manager, "/api/inventory/adjustments", { variationId: v6, type: "OPENING", quantity: 10 })).status).toBe(201);
    expect((await post(manager, "/api/inventory/adjustments", { variationId: v6, type: "OPENING", quantity: 5 })).body.error.code).toBe("OPENING_EXISTS");
    expect((await post(manager, "/api/inventory/adjustments", { variationId: v6, quantity: -3 })).body.error.code).toBe("REASON_REQUIRED");
    const adj = await post(manager, "/api/inventory/adjustments", { variationId: v6, quantity: -3, reason: "Damaged" });
    expect(adj.body).toMatchObject({ before: 10, after: 7 });
    const sum = await prisma.stockMovement.aggregate({ where: { variationId: v6 }, _sum: { quantity: true } });
    expect(Number(sum._sum.quantity)).toBe(7);
    expect((await stockOf(manager, product.id)).variations[0].quantity).toBe(7);
  });

  it("rejects going below zero, fractions and zero, and names the item (main v2 message style)", async () => {
    const { manager, v6 } = await setup();
    await post(manager, "/api/inventory/adjustments", { variationId: v6, type: "OPENING", quantity: 2 });
    const r = await post(manager, "/api/inventory/adjustments", { variationId: v6, quantity: -3, reason: "x" });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe("Insufficient stock: Chain 6-CH (need 3, have 2)");
    expect((await post(manager, "/api/inventory/adjustments", { variationId: v6, quantity: 1.5, reason: "x" })).status).toBe(400);
    expect((await post(manager, "/api/inventory/adjustments", { variationId: v6, quantity: 0, reason: "x" })).status).toBe(400);
  });

  it("never oversells under concurrency: 10 parallel removals of 1 against stock 5", async () => {
    const { manager, v6 } = await setup();
    await post(manager, "/api/inventory/adjustments", { variationId: v6, type: "OPENING", quantity: 5 });
    const results = await Promise.all(
      Array.from({ length: 10 }, () => post(manager, "/api/inventory/adjustments", { variationId: v6, quantity: -1, reason: "race" })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    const sum = await prisma.stockMovement.aggregate({ where: { variationId: v6 }, _sum: { quantity: true } });
    expect(Number(sum._sum.quantity)).toBe(0);
  });

  it("the database itself refuses negative stock and edits to history", async () => {
    const { co, v8 } = await setup();
    await expect(
      prisma.stockMovement.create({ data: { companyId: co.id, variationId: v8, movementType: "ADJUSTMENT", quantity: -1, unit: "Nos", reason: "bypass" } }),
    ).rejects.toThrow(/INSUFFICIENT_STOCK/);
    const m = await prisma.stockMovement.create({ data: { companyId: co.id, variationId: v8, movementType: "OPENING", quantity: 4, unit: "Nos" } });
    await expect(prisma.stockMovement.update({ where: { id: m.id }, data: { quantity: 400 } })).rejects.toThrow(/append-only/);
    await expect(prisma.stockMovement.delete({ where: { id: m.id } })).rejects.toThrow(/append-only/);
    await expect(
      prisma.stockMovement.create({ data: { companyId: co.id, variationId: v8, movementType: "SALE", quantity: 2, unit: "Nos" } }),
    ).rejects.toThrow(/stock_movements_direction/);
  });

  it("configures minimum/selling price, cost and threshold (manager), with audit; blank fields are left alone (BR-08a)", async () => {
    const { manager, staff, product, v6, co } = await setup();
    expect((await patch(staff, `/api/inventory/variations/${v6}`, { salePrice: "10" })).status).toBe(403);
    const r = await patch(manager, `/api/inventory/variations/${v6}`, { minSalePrice: "300", salePrice: "450", lowStockThreshold: 3 });
    expect(r.body.variation).toMatchObject({ minSalePrice: "300.00", salePrice: "450.00", purchaseCost: "0.00", lowStockThreshold: 3 });
    const r2 = await patch(manager, `/api/inventory/variations/${v6}`, { purchaseCost: 380 });
    expect(r2.body.variation).toMatchObject({ minSalePrice: "300.00", salePrice: "450.00", purchaseCost: "380.00", lowStockThreshold: 3 });
    expect((await patch(manager, `/api/inventory/variations/${v6}`, { salePrice: "1.5" })).status).toBe(400);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { companyId: co.id, entityId: v6, action: "INVENTORY_CONFIGURE" }, orderBy: { createdAt: "asc" } });
    expect(ev.before).toMatchObject({ minSalePrice: "0.00", salePrice: "0.00" });
    expect(ev.after).toMatchObject({ minSalePrice: "300.00", salePrice: "450.00" });
    await post(manager, "/api/inventory/adjustments", { variationId: v6, type: "OPENING", quantity: 3 });
    expect((await stockOf(manager, product.id)).variations[0]).toMatchObject({ quantity: 3, state: "low", stockValue: "1140.00" });
  });

  it("staff can view stock but cannot adjust it (main v2 BR-24)", async () => {
    const { staff, v6, product } = await setup();
    expect((await staff.get(`/api/inventory/products/${product.id}`)).status).toBe(200);
    expect((await post(staff, "/api/inventory/adjustments", { variationId: v6, type: "OPENING", quantity: 1 })).status).toBe(403);
  });

  it("lists running balances newest first, with the actor", async () => {
    const { manager, v6 } = await setup();
    await post(manager, "/api/inventory/adjustments", { variationId: v6, type: "OPENING", quantity: 10 });
    await post(manager, "/api/inventory/adjustments", { variationId: v6, quantity: -4, reason: "Damaged" });
    await post(manager, "/api/inventory/adjustments", { variationId: v6, quantity: 2, reason: "Found" });
    const h = (await manager.get(`/api/inventory/variations/${v6}/movements`)).body;
    expect(h.total).toBe(3);
    expect(h.movements.map((m: { type: string; quantity: number; balanceAfter: number }) => [m.type, m.quantity, m.balanceAfter])).toEqual([
      ["ADJUSTMENT", 2, 8],
      ["ADJUSTMENT", -4, 6],
      ["OPENING", 10, 10],
    ]);
    expect(h.movements[0].actor).toBe("sales_manager user");
  });

  it("summarises per product (BR-06a) and per variation, and filters low/out at either level", async () => {
    const { manager, product, v6, v8 } = await setup();
    await post(manager, "/api/inventory/adjustments", { variationId: v6, type: "OPENING", quantity: 9 });
    await patch(manager, `/api/inventory/variations/${v8}`, { lowStockThreshold: 2 });
    const all = (await manager.get("/api/inventory")).body;
    // Group: 9 in stock against the lowest threshold (0) is "ok", but variation 8 is empty.
    expect(all.summary).toMatchObject({ products: 1, low: 0, out: 0, variationsLow: 1, variationsOut: 1 });
    expect((await manager.get("/api/inventory?state=out")).body.products.map((p: { id: string }) => p.id)).toEqual([product.id]);
  });

  it("isolates companies", async () => {
    const one = await setup();
    const two = await setup();
    expect((await two.manager.get(`/api/inventory/products/${one.product.id}`)).status).toBe(404);
    expect((await post(two.manager, "/api/inventory/adjustments", { variationId: one.v6, type: "OPENING", quantity: 1 })).status).toBe(404);
    expect((await two.manager.get(`/api/inventory/variations/${one.v6}/movements`)).status).toBe(404);
  });
});
