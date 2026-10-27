import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// Catalog browse step 1 (v2/docs/catalog-browse/ARCHITECTURE.md §3): category rail stats and
// order, product cards with sort and paging, uncategorized filter, product movement history.

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const put = (a: Agent, url: string, body: unknown) => a.put(url).set("Origin", ORIGIN).send(body as object);
const patch = (a: Agent, url: string, body: unknown) => a.patch(url).set("Origin", ORIGIN).send(body as object);

interface Card {
  id: string;
  name: string;
  productType: string;
  variationId: string | null;
  activeVariations: number;
  quantity: number;
  state: string;
  lowVariations: number;
  outVariations: number;
  priceMin: string | null;
  priceMax: string | null;
  minSalePrice: string | null;
  costMin?: string | null;
  stockValue?: string;
  category: { id: string; name: string } | null;
}

async function setup() {
  const co = await makeCompany();
  const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
  const staff = await signIn((await makeUser(co.id, "sales_staff")).email);

  const cat = async (name: string) => (await post(manager, "/api/categories", { name })).body.category.id as string;
  const rigging = await cat("Rigging");
  const ropes = await cat("Ropes");

  const simple = async (name: string, shortName: string, categoryId: string | null) =>
    (await post(manager, "/api/products", { productType: "simple", name, unit: "Nos", shortName, ...(categoryId ? { categoryId } : {}) })).body.product;
  const configure = (variationId: string, body: object) => patch(manager, `/api/inventory/variations/${variationId}`, body);
  const opening = (variationId: string, quantity: number) => post(manager, "/api/inventory/adjustments", { variationId, type: "OPENING", quantity });

  // Rigging: a full simple product, a variable product with one empty variation, an archived one.
  const hook = await simple("Hook", "HK", rigging);
  await configure(hook.variations[0].id, { minSalePrice: "40", salePrice: "50", purchaseCost: "30", lowStockThreshold: 5 });
  await opening(hook.variations[0].id, 20);

  const shackle = (
    await post(manager, "/api/products", {
      productType: "variable",
      name: "Bow Shackle",
      unit: "Nos",
      baseShortName: "BS",
      categoryId: rigging,
      attributes: [{ name: "Capacity", unit: "ton", values: ["2", "5"] }],
      variations: [{ attributes: { Capacity: "2" } }, { attributes: { Capacity: "5" } }],
    })
  ).body.product;
  const [s2, s5] = shackle.variations as { id: string }[];
  await configure(s2!.id, { salePrice: "160", purchaseCost: "100", lowStockThreshold: 2 });
  await configure(s5!.id, { salePrice: "900", purchaseCost: "600", lowStockThreshold: 2 });
  await opening(s2!.id, 10);

  const old = await simple("Anchor", "AN", rigging);
  await prisma.productGroup.update({ where: { id: old.id }, data: { active: false } });

  // Ropes: one low product. Uncategorized: one product.
  const rope = await simple("Rope Clip", "RC", ropes);
  await configure(rope.variations[0].id, { salePrice: "40", purchaseCost: "25", lowStockThreshold: 10 });
  await opening(rope.variations[0].id, 3);
  const loose = await simple("Zip Tie", "ZT", null);
  await configure(loose.variations[0].id, { salePrice: "5" });
  await opening(loose.variations[0].id, 100);

  return { co, manager, staff, rigging, ropes, hook, shackle, s2: s2!.id, s5: s5!.id, rope, loose };
}

const cards = async (a: Agent, query: string) => {
  const r = await a.get(`/api/catalog/products?${query}`);
  expect(r.status).toBe(200);
  return r.body as { products: Card[]; total: number; page: number; pageSize: number; summary: Record<string, unknown> };
};

describe("catalog browse: categories", () => {
  it("stats=1 adds low / out / below-zero counts per category, uncategorized and all", async () => {
    const { manager, rigging, ropes } = await setup();
    const r = await manager.get("/api/categories?stats=1");
    expect(r.status).toBe(200);
    const byId = new Map(r.body.categories.map((c: { id: string }) => [c.id, c]));
    // Rigging: Hook (ok) + Bow Shackle (5 t variation empty → low and out); Anchor is archived.
    expect(byId.get(rigging)).toMatchObject({ productCount: 2, lowCount: 1, outCount: 1, negativeCount: 0, coverImageUrl: null });
    expect(byId.get(ropes)).toMatchObject({ productCount: 1, lowCount: 1, outCount: 0 });
    expect(r.body.uncategorized).toEqual({ productCount: 1, lowCount: 0, outCount: 0, negativeCount: 0 });
    expect(r.body.all).toEqual({ productCount: 4, lowCount: 2, outCount: 1, negativeCount: 0 });

    // Without stats the response keeps its old shape.
    const plain = await manager.get("/api/categories");
    expect(plain.body.categories[0]).not.toHaveProperty("lowCount");
    expect(plain.body).not.toHaveProperty("all");
    expect(plain.body).toMatchObject({ uncategorizedCount: 1, totalCount: 4 });
  });

  it("lists categories in rail order; new ones go last; PUT /order reorders and is audited", async () => {
    const { manager, staff, co, rigging, ropes } = await setup();
    const chain = (await post(manager, "/api/categories", { name: "Chain" })).body.category;
    expect(chain.sortOrder).toBe(3);
    const names = async () => (await manager.get("/api/categories")).body.categories.map((c: { name: string }) => c.name);
    expect(await names()).toEqual(["Rigging", "Ropes", "Chain"]);

    const r = await put(manager, "/api/categories/order", { ids: [chain.id, ropes, rigging] });
    expect(r.status).toBe(200);
    expect(r.body.categories.map((c: { name: string; sortOrder: number }) => [c.name, c.sortOrder])).toEqual([
      ["Chain", 1],
      ["Ropes", 2],
      ["Rigging", 3],
    ]);
    expect(await names()).toEqual(["Chain", "Ropes", "Rigging"]);
    expect(await prisma.auditEvent.count({ where: { companyId: co.id, action: "CATEGORY_REORDER" } })).toBe(1);

    // Same order again changes nothing and writes no audit row.
    await put(manager, "/api/categories/order", { ids: [chain.id, ropes, rigging] });
    expect(await prisma.auditEvent.count({ where: { companyId: co.id, action: "CATEGORY_REORDER" } })).toBe(1);

    expect((await put(staff, "/api/categories/order", { ids: [rigging] })).status).toBe(403);
    expect((await put(manager, "/api/categories/order", { ids: [rigging, rigging] })).status).toBe(400);
    expect((await put(manager, "/api/categories/order", { ids: [rigging, "missing"] })).status).toBe(404);
  });

  it("never reorders or counts another company's categories", async () => {
    const a = await setup();
    const b = await setup();
    expect((await put(a.manager, "/api/categories/order", { ids: [b.rigging] })).status).toBe(404);
    const stats = await a.manager.get("/api/categories?stats=1");
    expect(stats.body.all.productCount).toBe(4);
  });
});

describe("catalog browse: product cards", () => {
  it("returns one summary card per product, no variation rows; simple cards carry their variation", async () => {
    const { manager, rigging, hook, shackle } = await setup();
    const { products, total, page, pageSize } = await cards(manager, `categoryId=${rigging}`);
    expect({ total, page, pageSize }).toEqual({ total: 2, page: 1, pageSize: 48 });
    const [shk, hk] = products;
    expect(shk).not.toHaveProperty("variations");
    expect(shk).toMatchObject({
      id: shackle.id,
      name: "Bow Shackle",
      productType: "variable",
      variationId: null,
      activeVariations: 2,
      quantity: 10,
      lowVariations: 1,
      outVariations: 1,
      priceMin: "160.00",
      priceMax: "900.00",
      minSalePrice: null,
      costMin: "100.00",
      stockValue: "1000.00",
      category: { id: rigging, name: "Rigging" },
    });
    expect(hk).toMatchObject({ id: hook.id, productType: "simple", variationId: hook.variations[0].id, quantity: 20, state: "ok", priceMin: "50.00", minSalePrice: "40.00" });
  });

  it("hides cost from roles that may not see it", async () => {
    const { staff, rigging } = await setup();
    const { products, summary } = await cards(staff, `categoryId=${rigging}`);
    expect(products[0]).not.toHaveProperty("costMin");
    expect(products[0]).not.toHaveProperty("stockValue");
    expect(summary).not.toHaveProperty("stockValue");
  });

  it("categoryId=none lists uncategorized products, in cards and in the Stock In list", async () => {
    const { manager, loose } = await setup();
    expect((await cards(manager, "categoryId=none")).products.map((p) => p.id)).toEqual([loose.id]);
    const inv = await manager.get("/api/inventory?categoryId=none");
    expect(inv.body.products.map((p: { id: string }) => p.id)).toEqual([loose.id]);
  });

  it("sorts by name, price, stock and newest; paging is stable", async () => {
    const { manager } = await setup();
    const order = async (sort: string) => (await cards(manager, `sort=${sort}`)).products.map((p) => p.name);
    expect(await order("name")).toEqual(["Bow Shackle", "Hook", "Rope Clip", "Zip Tie"]);
    expect(await order("price_asc")).toEqual(["Zip Tie", "Rope Clip", "Hook", "Bow Shackle"]);
    expect(await order("price_desc")).toEqual(["Bow Shackle", "Hook", "Rope Clip", "Zip Tie"]);
    expect(await order("stock")).toEqual(["Zip Tie", "Hook", "Bow Shackle", "Rope Clip"]);
    expect(await order("stock_low")).toEqual(["Rope Clip", "Bow Shackle", "Hook", "Zip Tie"]);
    expect(await order("newest")).toEqual(["Zip Tie", "Rope Clip", "Bow Shackle", "Hook"]);
    expect((await manager.get("/api/catalog/products?sort=random")).status).toBe(400);

    const p1 = await cards(manager, "pageSize=3&page=1");
    const p2 = await cards(manager, "pageSize=3&page=2");
    expect(p1.total).toBe(4);
    expect([...p1.products, ...p2.products].map((p) => p.name)).toEqual(["Bow Shackle", "Hook", "Rope Clip", "Zip Tie"]);
  });

  it("stock chips, search across categories and archived products follow the inventory rules", async () => {
    const { manager } = await setup();
    expect((await cards(manager, "state=low")).products.map((p) => p.name)).toEqual(["Bow Shackle", "Rope Clip"]);
    expect((await cards(manager, "state=out")).products.map((p) => p.name)).toEqual(["Bow Shackle"]);
    expect((await cards(manager, "q=shack")).products.map((p) => p.name)).toEqual(["Bow Shackle"]);
    expect((await cards(manager, "status=archived")).products.map((p) => p.name)).toEqual(["Anchor"]);
    const summary = (await cards(manager, "")).summary as { tabs: Record<string, number> };
    expect(summary.tabs).toEqual({ all: 4, in_stock: 4, low: 2, out: 1, negative: 0 });
    expect((await cards(manager, "state=in_stock")).total).toBe(4);
  });

  it("/inventory accepts the same sort", async () => {
    const { manager } = await setup();
    const r = await manager.get("/api/inventory?sort=price_asc");
    expect(r.body.products.map((p: { name: string }) => p.name)).toEqual(["Zip Tie", "Rope Clip", "Hook", "Bow Shackle"]);
  });
});

describe("catalog browse: product movements", () => {
  it("lists every variation's movements newest first with a per-variation running balance", async () => {
    const { manager, shackle, s2, s5 } = await setup();
    await post(manager, "/api/inventory/adjustments", { variationId: s5, type: "OPENING", quantity: 4 });
    await post(manager, "/api/inventory/adjustments", { variationId: s2, quantity: -3, reason: "Damaged" });
    const sale = await post(manager, "/api/sales", { lines: [{ variationId: s5, quantity: 1, price: 900 }] });
    expect(sale.status).toBe(201);

    const r = await manager.get(`/api/inventory/products/${shackle.id}/movements`);
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(4);
    const rows = r.body.movements as { type: string; quantity: number; balanceAfter: number; variation: { id: string }; document: { kind: string; number: string } | null }[];
    expect(rows.map((m) => [m.type, m.variation.id, m.quantity, m.balanceAfter])).toEqual([
      ["SALE", s5, -1, 3],
      ["ADJUSTMENT", s2, -3, 7],
      ["OPENING", s5, 4, 4],
      ["OPENING", s2, 10, 10],
    ]);
    expect(rows[0]!.document).toMatchObject({ kind: "sale", number: expect.stringMatching(/^SAL\//) });
    expect(rows[1]!.document).toBeNull();

    const one = await manager.get(`/api/inventory/products/${shackle.id}/movements?variationId=${s2}&pageSize=1`);
    expect(one.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(one.body.movements[0]).toMatchObject({ type: "ADJUSTMENT", balanceAfter: 7 });
  });

  it("refuses a variation from another product and products of another company", async () => {
    const a = await setup();
    const b = await setup();
    expect((await a.manager.get(`/api/inventory/products/${a.shackle.id}/movements?variationId=${a.hook.variations[0].id}`)).status).toBe(404);
    expect((await a.manager.get(`/api/inventory/products/${b.shackle.id}/movements`)).status).toBe(404);
  });

  it("hides purchase cost from roles that may not see it", async () => {
    const { manager, staff, hook } = await setup();
    const v = hook.variations[0].id;
    expect((await post(manager, "/api/purchases", { lines: [{ variationId: v, quantity: 5, price: 31 }] })).status).toBe(201);
    const seen = async (a: Agent) => (await a.get(`/api/inventory/products/${hook.id}/movements`)).body.movements[0];
    expect(await seen(manager)).toMatchObject({ type: "PURCHASE", rate: "31.00", document: { kind: "purchase" } });
    expect((await seen(staff)).rate).toBeNull();
  });
});
