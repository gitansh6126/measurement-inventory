import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// Regression tests for the 2026-10-13 audit fixes (v1/docs/audit/BUG-REGISTER.md).

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const patch = (a: Agent, url: string, body: unknown) => a.patch(url).set("Origin", ORIGIN).send(body as object);

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function team() {
  const co = await makeCompany();
  const admin = await signIn((await makeUser(co.id, "admin")).email);
  const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
  const staff = await signIn((await makeUser(co.id, "sales_staff")).email);
  return { co, admin, manager, staff };
}

async function simple(a: Agent, extra: Record<string, unknown> = {}) {
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase();
  const r = await post(a, "/api/products", { productType: "simple", name: `Item ${tag}`, unit: "Nos", shortName: `S-${tag}`, ...extra });
  return r;
}

describe("B01 uploaded images", () => {
  it("accepts an uploaded image on a product and refuses another company's image", async () => {
    const { manager } = await team();
    const up = await manager.post("/api/images").set("Origin", ORIGIN).set("Content-Type", "image/png").send(PNG_1X1);
    expect(up.status).toBe(201);
    expect(up.body.url).toMatch(/^\/api\/images\/[a-z0-9]+$/);

    const p = await simple(manager, { imageUrl: up.body.url });
    expect(p.status).toBe(201);
    expect(p.body.product.imageUrl).toBe(up.body.url);
    expect((await manager.get(up.body.url)).status).toBe(200);

    const other = await team();
    expect((await other.manager.get(up.body.url)).status).toBe(404);
    const stolen = await simple(other.manager, { imageUrl: up.body.url });
    expect(stolen.status).toBe(400);
    expect(stolen.body.error.code).toBe("UNKNOWN_IMAGE");
    const cat = await post(other.manager, "/api/categories", { name: `Cat ${Date.now()}`, imageUrl: up.body.url });
    expect(cat.body.error.code).toBe("UNKNOWN_IMAGE");
  });

  it("still refuses data: URLs and other schemes", async () => {
    const { manager } = await team();
    expect((await simple(manager, { imageUrl: "data:image/png;base64,AAAA" })).status).toBe(400);
    expect((await simple(manager, { imageUrl: "javascript:alert(1)" })).status).toBe(400);
  });
});

describe("B02 large batches", () => {
  it("saves Stock In at the 500-row cap in one transaction", async () => {
    const { manager } = await team();
    const sizes = Array.from({ length: 200 }, (_, i) => String(i + 1));
    const grades = ["A", "B", "C"];
    const combos = grades.flatMap((g) => sizes.map((s) => ({ Size: s, Grade: g }))).slice(0, 500);
    const prod = await post(manager, "/api/products", {
      productType: "variable",
      name: `Bulk ${Date.now()}`,
      unit: "Nos",
      baseShortName: `BLK${Date.now() % 100000}`,
      attributes: [{ name: "Size", values: sizes }, { name: "Grade", values: grades }],
      variations: combos.map((a) => ({ attributes: a })),
    });
    expect(prod.status).toBe(201);
    const ids: string[] = prod.body.product.variations.map((v: { id: string }) => v.id);
    const r = await post(manager, "/api/inventory/stock-in", {
      reason: "Opening Stock",
      rows: ids.map((id) => ({ variationId: id, expectedQuantity: 0, quantity: 3, minSalePrice: "10", salePrice: "15" })),
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ stockChanged: 500, priced: 500 });
    const sum = await prisma.stockMovement.aggregate({ where: { variationId: { in: ids } }, _sum: { quantity: true }, _count: true });
    expect(Number(sum._sum.quantity)).toBe(1500);
    expect(sum._count).toBe(500);
    expect(await prisma.productVariation.count({ where: { id: { in: ids }, minSalePrice: 10 } })).toBe(500);
    const audits = await prisma.auditEvent.count({ where: { entityId: { in: ids }, action: { in: ["STOCK_IN", "INVENTORY_CONFIGURE"] } } });
    expect(audits).toBe(1000);
  }, 60_000);
});

describe("B04 opening stock once", () => {
  it("allows exactly one OPENING under concurrent requests", async () => {
    const { manager } = await team();
    const p = await simple(manager);
    const vid = p.body.product.variations[0].id;
    const rs = await Promise.all(Array.from({ length: 8 }, () => post(manager, "/api/inventory/adjustments", { variationId: vid, type: "OPENING", quantity: 10 })));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409).every((r) => r.body.error.code === "OPENING_EXISTS")).toBe(true);
    const n = await prisma.stockMovement.count({ where: { variationId: vid, movementType: "OPENING" } });
    expect(n).toBe(1);
  });

  it("the database refuses a second OPENING even without the API check", async () => {
    const { co, manager } = await team();
    const p = await simple(manager);
    const vid = p.body.product.variations[0].id;
    const row = { companyId: co.id, variationId: vid, movementType: "OPENING" as const, quantity: 1, unit: "Nos" };
    await prisma.stockMovement.create({ data: row });
    await expect(prisma.stockMovement.create({ data: row })).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("B05 cost hidden from sales staff", () => {
  it("omits purchase cost, stock value and purchase rates for staff only", async () => {
    const { manager, staff } = await team();
    const p = await simple(manager);
    const productId = p.body.product.id;
    const vid = p.body.product.variations[0].id;
    await patch(manager, `/api/inventory/variations/${vid}`, { purchaseCost: "123", salePrice: "200" });
    expect((await post(manager, "/api/purchases", { lines: [{ variationId: vid, quantity: 4, price: "120" }] })).status).toBe(201);

    const forStaff = [
      (await staff.get(`/api/products/${productId}`)).body.product,
      (await staff.get(`/api/inventory/products/${productId}`)).body.product,
      (await staff.get(`/api/products?q=${encodeURIComponent(p.body.product.name)}`)).body.products[0],
    ];
    for (const prod of forStaff) {
      expect(prod).not.toHaveProperty("stockValue");
      expect(prod.variations[0]).not.toHaveProperty("purchaseCost");
      expect(prod.variations[0]).not.toHaveProperty("stockValue");
      expect(prod.variations[0].salePrice).toBe("200.00");
    }
    const inv = (await staff.get("/api/inventory")).body;
    expect(inv.summary).not.toHaveProperty("stockValue");
    const mv = (await staff.get(`/api/inventory/variations/${vid}/movements`)).body.movements;
    expect(mv.find((m: { type: string }) => m.type === "PURCHASE").rate).toBeNull();

    const forManager = (await manager.get(`/api/products/${productId}`)).body.product;
    expect(forManager.variations[0].purchaseCost).toBe("123.00");
    const mvm = (await manager.get(`/api/inventory/variations/${vid}/movements`)).body.movements;
    expect(mvm.find((m: { type: string }) => m.type === "PURCHASE").rate).toBe("120.00");
  });
});
