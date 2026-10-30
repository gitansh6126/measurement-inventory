import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const put = (a: Agent, url: string, body: unknown) => a.put(url).set("Origin", ORIGIN).send(body as object);

async function setup() {
  const co = await makeCompany();
  const admin = await signIn((await makeUser(co.id, "admin")).email);
  const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
  const staff = await signIn((await makeUser(co.id, "sales_staff")).email);
  const tag = co.id.slice(-5).toUpperCase();

  const mkProduct = async (name: string, short: string) => {
    const p = (await post(manager, "/api/products", {
      productType: "simple",
      name,
      unit: "Nos",
      shortName: `${short}-${tag}`,
      officialSku: null,
    })).body.product;
    return { group: p.id as string, v: p.variations[0].id as string };
  };

  const mkVariableProduct = async (name: string, baseShort: string) => {
    const res = await post(manager, "/api/products", {
      productType: "variable",
      name,
      unit: "Nos",
      baseShortName: `${baseShort}-${tag}`,
      attributes: [{ name: "Size", values: ["Small", "Large"], isQuality: false }],
      variations: [
        { attributes: { Size: "Small" }, shortName: `${baseShort}-S-${tag}`, officialSku: null },
        { attributes: { Size: "Large" }, shortName: `${baseShort}-L-${tag}`, officialSku: null },
      ],
    });
    const p = res.body.product;
    return { group: p.id as string, variations: p.variations as Array<{ id: string; shortName: string }> };
  };

  const mkSupplier = async (name: string, active = true) => {
    const party = (await post(manager, "/api/parties", { type: "SUPPLIER", name: `${name} ${tag}` })).body.party;
    if (!active) {
      await manager.patch(`/api/parties/${party.id}`).set("Origin", ORIGIN).send({ active: false, version: party.version });
    }
    return party.id as string;
  };

  const mkCustomer = async (name: string) => {
    const party = (await post(manager, "/api/parties", { type: "CUSTOMER", name: `${name} ${tag}` })).body.party;
    return party.id as string;
  };

  return { co, admin, manager, staff, tag, mkProduct, mkVariableProduct, mkSupplier, mkCustomer };
}

describe("vendor-prices sheet & listing", () => {
  it("pages sheet, respects scope=priced vs all, filters by q and category", async () => {
    const { manager, mkProduct, mkVariableProduct, mkSupplier } = await setup();
    const s1 = await mkSupplier("Apex Supplies");
    const s2 = await mkSupplier("Beta Traders");

    const p1 = await mkProduct("Anchor Bolt", "AB");
    const p2 = await mkVariableProduct("Steel Cable", "SC");
    const p3 = await mkProduct("Wire Mesh", "WM");

    // Price p1 and one variation of p2 for s1
    await put(manager, "/api/vendor-prices", { variationId: p1.v, supplierId: s1, rate: 45 });
    await put(manager, "/api/vendor-prices", { variationId: p2.variations[0]!.id, supplierId: s1, rate: 120 });
    await put(manager, "/api/vendor-prices", { variationId: p2.variations[1]!.id, supplierId: s1, rate: 180 });

    // 1. scope=priced (default): only p1 and p2 appear for s1, p3 is omitted
    const sheetPriced = (await manager.get(`/api/vendor-prices/sheet?supplierId=${s1}`)).body;
    expect(sheetPriced.total).toBe(2);
    expect(sheetPriced.products.map((p: { name: string }) => p.name)).toEqual(["Anchor Bolt", "Steel Cable"]);
    const cable = sheetPriced.products.find((p: { name: string }) => p.name === "Steel Cable");
    expect(cable.pricedCount).toBe(2);
    expect(cable.minRate).toBe("120.00");
    expect(cable.maxRate).toBe("180.00");

    // For s2 (no prices yet), scope=priced returns empty
    const s2Priced = (await manager.get(`/api/vendor-prices/sheet?supplierId=${s2}`)).body;
    expect(s2Priced.total).toBe(0);

    // 2. scope=all: all 3 products appear for s1
    const sheetAll = (await manager.get(`/api/vendor-prices/sheet?supplierId=${s1}&scope=all`)).body;
    expect(sheetAll.total).toBe(3);

    // 3. Search q matches variation shortName
    const searchRes = (await manager.get(`/api/vendor-prices/sheet?supplierId=${s1}&scope=all&q=SC-S`)).body;
    expect(searchRes.total).toBe(1);
    expect(searchRes.products[0].name).toBe("Steel Cable");

    // 4. productId filter on GET /api/vendor-prices
    const productPrices = (await manager.get(`/api/vendor-prices?productId=${p2.group}`)).body.prices;
    expect(productPrices.length).toBe(2);
    expect(productPrices.map((r: { rate: string }) => r.rate)).toEqual(["120.00", "180.00"]);
  });

  it("rejects rate of 0 in API", async () => {
    const { manager, mkProduct, mkSupplier } = await setup();
    const s = await mkSupplier("Test Supp");
    const p = await mkProduct("Hook", "HK");

    const singleRes = await put(manager, "/api/vendor-prices", { variationId: p.v, supplierId: s, rate: 0 });
    expect(singleRes.status).toBe(400);

    const batchRes = await put(manager, "/api/vendor-prices/batch", { records: [{ variationId: p.v, supplierId: s, rate: 0 }] });
    expect(batchRes.status).toBe(400);
  });
});

describe("batch validation and audit", () => {
  it("rejects the entire batch on invalid records or duplicate pairs (F2)", async () => {
    const { manager, mkProduct, mkSupplier, mkCustomer } = await setup();
    const s1 = await mkSupplier("Good Supplier");
    const sInactive = await mkSupplier("Inactive Supp", false);
    const customer = await mkCustomer("Walk-in Customer");
    const p1 = await mkProduct("Nail", "NL");
    const p2 = await mkProduct("Screw", "SCW");

    // 1. Customer as supplier
    const r1 = await put(manager, "/api/vendor-prices/batch", {
      records: [
        { variationId: p1.v, supplierId: s1, rate: 10 },
        { variationId: p2.v, supplierId: customer, rate: 15 },
      ],
    });
    expect(r1.status).toBe(400);
    expect(r1.body.error.code).toBe("INVALID_RECORDS");
    expect(r1.body.error.details).toContainEqual(expect.objectContaining({ code: "UNKNOWN_SUPPLIER" }));

    // 2. Unknown variation
    const r2 = await put(manager, "/api/vendor-prices/batch", {
      records: [{ variationId: "nonexistent-var", supplierId: s1, rate: 10 }],
    });
    expect(r2.status).toBe(400);
    expect(r2.body.error.details).toContainEqual(expect.objectContaining({ code: "NOT_FOUND" }));

    // 3. Inactive supplier when active: true
    const r3 = await put(manager, "/api/vendor-prices/batch", {
      records: [{ variationId: p1.v, supplierId: sInactive, rate: 10, active: true }],
    });
    expect(r3.status).toBe(400);
    expect(r3.body.error.details).toContainEqual(expect.objectContaining({ code: "INACTIVE_PARTY" }));

    // 4. Duplicate (variation, supplier) pair in same batch
    const r4 = await put(manager, "/api/vendor-prices/batch", {
      records: [
        { variationId: p1.v, supplierId: s1, rate: 10 },
        { variationId: p1.v, supplierId: s1, rate: 20 },
      ],
    });
    expect(r4.status).toBe(400);
    expect(r4.body.error.details).toContainEqual(expect.objectContaining({ code: "DUPLICATE_RECORD" }));

    // Verify nothing was saved
    const prices = (await manager.get(`/api/vendor-prices?supplierId=${s1}`)).body.prices;
    expect(prices.length).toBe(0);
  });

  it("creates one audit row per changed record and skips no-op saves (F3, F4)", async () => {
    const { co, manager, mkProduct, mkSupplier } = await setup();
    const s = await mkSupplier("Audit Supplier");
    const p1 = await mkProduct("Item 1", "I1");
    const p2 = await mkProduct("Item 2", "I2");

    // Save batch with 2 new records
    const save1 = await put(manager, "/api/vendor-prices/batch", {
      records: [
        { variationId: p1.v, supplierId: s, rate: 50 },
        { variationId: p2.v, supplierId: s, rate: 70 },
      ],
    });
    expect(save1.status).toBe(200);
    expect(save1.body.count).toBe(2);
    expect(save1.body.unchanged).toBe(0);

    const audits1 = await prisma.auditEvent.findMany({
      where: { companyId: co.id, entityType: "VendorPrice" },
      orderBy: { createdAt: "asc" },
    });
    expect(audits1.length).toBe(2);
    expect(audits1.map((a) => a.action)).toEqual(["VENDOR_PRICE_CREATE", "VENDOR_PRICE_CREATE"]);

    // Save same records again (no-op save)
    const save2 = await put(manager, "/api/vendor-prices/batch", {
      records: [
        { variationId: p1.v, supplierId: s, rate: 50 },
        { variationId: p2.v, supplierId: s, rate: 70 },
      ],
    });
    expect(save2.status).toBe(200);
    expect(save2.body.count).toBe(0);
    expect(save2.body.unchanged).toBe(2);

    // No new audit rows written on no-op
    const audits2 = await prisma.auditEvent.findMany({
      where: { companyId: co.id, entityType: "VendorPrice" },
    });
    expect(audits2.length).toBe(2);
  });
});

describe("purchase auto-update and rate card rules (F5)", () => {
  it("back-dated purchase does not overwrite newer rate and does not re-activate paused rate", async () => {
    const { manager, mkProduct, mkSupplier } = await setup();
    const s = await mkSupplier("Reliable Mills");
    const p = await mkProduct("Brass Fitting", "BF");

    // Manager sets rate to 100 now
    await put(manager, "/api/vendor-prices", { variationId: p.v, supplierId: s, rate: 100 });

    // Manually pause the rate
    await put(manager, "/api/vendor-prices", { variationId: p.v, supplierId: s, rate: 100, active: false });
    const initialPrice = (await manager.get(`/api/vendor-prices?variationId=${p.v}&supplierId=${s}`)).body.prices[0];
    expect(initialPrice.rate).toBe("100.00");
    expect(initialPrice.active).toBe(false);

    // Back-dated purchase (yesterday): price = 80
    const pastDate = new Date(Date.now() - 86400000);
    await post(manager, "/api/purchases", {
      partyId: s,
      date: pastDate.toISOString(),
      lines: [{ variationId: p.v, quantity: 5, price: 80 }],
    });

    // The current rate card MUST NOT be overwritten by the back-dated purchase!
    const afterBackdated = (await manager.get(`/api/vendor-prices?variationId=${p.v}&supplierId=${s}`)).body.prices[0];
    expect(afterBackdated.rate).toBe("100.00");
    expect(afterBackdated.active).toBe(false);

    // History DOES contain the back-dated purchase
    const history = (await manager.get(`/api/vendor-prices/history?variationId=${p.v}&supplierId=${s}`)).body.history;
    expect(history.map((h: { rate: string }) => h.rate)).toContain("80.00");

    // Newer purchase (tomorrow): price = 110
    const futureDate = new Date(Date.now() + 86400000);
    await post(manager, "/api/purchases", {
      partyId: s,
      date: futureDate.toISOString(),
      lines: [{ variationId: p.v, quantity: 2, price: 110 }],
    });

    // Current rate is updated to 110, BUT active remains FALSE (purchase keeps paused status!)
    const afterNewer = (await manager.get(`/api/vendor-prices?variationId=${p.v}&supplierId=${s}`)).body.prices[0];
    expect(afterNewer.rate).toBe("110.00");
    expect(afterNewer.active).toBe(false);

    // Variation default purchaseCost is also updated to the latest purchase rate
    const varRow = await prisma.productVariation.findUniqueOrThrow({ where: { id: p.v } });
    expect(varRow.purchaseCost.toFixed(2)).toBe("110.00");

    // Creating a Purchase Order also records the agreed vendor price & updates purchaseCost
    const s2 = await mkSupplier("Order Supplier");
    await post(manager, "/api/orders", {
      kind: "PURCHASE",
      status: "PLACED",
      partyId: s2,
      lines: [{ variationId: p.v, quantity: 4, price: 105 }],
    });
    const s2Price = (await manager.get(`/api/vendor-prices?variationId=${p.v}&supplierId=${s2}`)).body.prices[0];
    expect(s2Price.rate).toBe("105.00");
    const varRowAfterOrder = await prisma.productVariation.findUniqueOrThrow({ where: { id: p.v } });
    expect(varRowAfterOrder.purchaseCost.toFixed(2)).toBe("105.00");
  });
});

describe("compare suppliers", () => {
  it("lines up each variation's rates across suppliers, marks the cheapest and the spread", async () => {
    const { manager, staff, mkProduct, mkVariableProduct, mkSupplier, tag } = await setup();
    const s1 = await mkSupplier("Apex Supplies");
    const s2 = await mkSupplier("Beta Traders");
    const s3 = await mkSupplier("Core Metals");

    const bolt = await mkProduct("Anchor Bolt", "AB");
    const cable = await mkVariableProduct("Steel Cable", "SC");
    const [small, large] = cable.variations;

    await put(manager, "/api/vendor-prices", { variationId: bolt.v, supplierId: s1, rate: 50 });
    await put(manager, "/api/vendor-prices", { variationId: bolt.v, supplierId: s2, rate: 40 });
    // Paused and cheapest: never the best price, hidden unless asked for.
    await put(manager, "/api/vendor-prices", { variationId: bolt.v, supplierId: s3, rate: 30, active: false });
    await put(manager, "/api/vendor-prices", { variationId: small!.id, supplierId: s1, rate: 120 });
    await put(manager, "/api/vendor-prices", { variationId: large!.id, supplierId: s1, rate: 180 });
    await put(manager, "/api/vendor-prices", { variationId: large!.id, supplierId: s3, rate: 150 });

    // Default: only variations two or more active suppliers quote.
    const two = (await manager.get(`/api/vendor-prices/compare?minSuppliers=2&q=${tag}`)).body;
    expect(two.total).toBe(2);
    const boltRow = two.rows.find((r: { variationId: string }) => r.variationId === bolt.v);
    expect(boltRow.rates.map((x: { rate: string }) => x.rate)).toEqual(["40.00", "50.00"]);
    expect(boltRow.best).toMatchObject({ supplierId: s2, rate: "40.00" });
    expect(boltRow.spreadPct).toBe(25);
    const largeRow = two.rows.find((r: { variationId: string }) => r.variationId === large!.id);
    expect(largeRow.best.supplierId).toBe(s3);
    expect(two.suppliers.map((s: { id: string }) => s.id)).toEqual([s1, s2, s3]);

    // Any priced variation, with paused rates shown but not counted as best.
    const all = (await manager.get(`/api/vendor-prices/compare?minSuppliers=1&includePaused=1&q=${tag}`)).body;
    expect(all.total).toBe(3);
    const boltAll = all.rows.find((r: { variationId: string }) => r.variationId === bolt.v);
    expect(boltAll.rates).toHaveLength(3);
    expect(boltAll.best.supplierId).toBe(s2);
    expect(all.rows.find((r: { variationId: string }) => r.variationId === small!.id).spreadPct).toBeNull();

    // Only the suppliers picked, in the order picked; one product only.
    const picked = (await manager.get(`/api/vendor-prices/compare?minSuppliers=1&supplierIds=${s3},${s1}&productId=${cable.group}`)).body;
    expect(picked.suppliers.map((s: { id: string }) => s.id)).toEqual([s3, s1]);
    expect(picked.rows.map((r: { variationId: string }) => r.variationId).sort()).toEqual([small!.id, large!.id].sort());

    // Whole catalogue: unpriced variations too, so a first rate can be entered.
    const plain = await mkProduct("Plain Washer", "PW");
    const every = (await manager.get(`/api/vendor-prices/compare?minSuppliers=0&q=${tag}`)).body;
    expect(every.total).toBe(4);
    expect(every.rows.find((r: { variationId: string }) => r.variationId === plain.v).rates).toEqual([]);

    expect((await staff.get("/api/vendor-prices/compare")).status).toBe(403);
  });
});

describe("permissions", () => {
  it("forbids staff from reading or writing vendor prices", async () => {
    const { staff, manager, mkProduct, mkSupplier } = await setup();
    const s = await mkSupplier("Any Supplier");
    const p = await mkProduct("Widget", "WDG");

    expect((await staff.get("/api/vendor-prices")).status).toBe(403);
    expect((await staff.get(`/api/vendor-prices/sheet?supplierId=${s}`)).status).toBe(403);
    expect((await staff.get(`/api/vendor-prices/best?variationIds=${p.v}`)).status).toBe(403);
    expect((await staff.get(`/api/vendor-prices/history?variationId=${p.v}`)).status).toBe(403);
    expect((await put(staff, "/api/vendor-prices", { variationId: p.v, supplierId: s, rate: 50 })).status).toBe(403);
    expect((await put(staff, "/api/vendor-prices/batch", { records: [{ variationId: p.v, supplierId: s, rate: 50 }] })).status).toBe(403);
  });
});
