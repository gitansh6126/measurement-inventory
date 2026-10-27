import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { BUSINESS_TIME_ZONE } from "../../src/lib/numbering.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// V2 Step 4/5 API: SQL inventory list, line discount + payment, void (D3), drafts, supplier
// prices, per-user preferences, party profiles.

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const put = (a: Agent, url: string, body: unknown) => a.put(url).set("Origin", ORIGIN).send(body as object);

function businessDateMonthsAgo(months: number, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")!.value);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  const day = Number(parts.find((part) => part.type === "day")!.value);
  const targetIndex = year * 12 + month - 1 - months;
  const targetYear = Math.floor(targetIndex / 12);
  const targetMonth = ((targetIndex % 12) + 12) % 12;
  const targetDay = Math.min(day, new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate());
  // 06:30 UTC is noon in the configured business timezone.
  return new Date(Date.UTC(targetYear, targetMonth, targetDay, 6, 30));
}

async function setup() {
  const co = await makeCompany();
  const admin = await signIn((await makeUser(co.id, "admin")).email);
  const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
  const staff = await signIn((await makeUser(co.id, "sales_staff")).email);
  const tag = co.id.slice(-5).toUpperCase();
  const mk = async (name: string, short: string, opening: number) => {
    const p = (await post(manager, "/api/products", { productType: "simple", name, unit: "Nos", shortName: `${short}-${tag}`, officialSku: null })).body.product;
    if (opening) await post(manager, "/api/inventory/adjustments", { variationId: p.variations[0].id, type: "OPENING", quantity: opening });
    return { group: p.id as string, v: p.variations[0].id as string };
  };
  return { co, admin, manager, staff, mk, tag };
}
const stored = async (variationId: string) => Number((await prisma.stockBalance.findUnique({ where: { variationId } }))?.quantity ?? 0);

describe("inventory list in SQL", () => {
  it("pages, filters low / out / negative and reports KPIs over the whole set", async () => {
    const { manager, mk } = await setup();
    const a = await mk("Alpha", "A", 10);
    await mk("Bravo", "B", 0);
    const c = await mk("Charlie", "C", 1);
    await mk("Delta", "D", 5);
    await post(manager, "/api/sales", { lines: [{ variationId: c.v, quantity: 3, price: 1 }], allowNegative: true });
    await manager.patch(`/api/inventory/variations/${a.v}`).set("Origin", ORIGIN).send({ lowStockThreshold: 20 });

    const page1 = (await manager.get("/api/inventory?page=1&pageSize=2")).body;
    expect(page1.products.map((p: { name: string }) => p.name)).toEqual(["Alpha", "Bravo"]);
    expect(page1).toMatchObject({ total: 4, page: 1, pageSize: 2 });
    expect(page1.summary).toMatchObject({ products: 4, low: 3, out: 2, negative: 1, variationsNegative: 1, tabs: { all: 4, low: 3, out: 2, negative: 1 } });
    expect((await manager.get("/api/inventory?page=2&pageSize=2")).body.products.map((p: { name: string }) => p.name)).toEqual(["Charlie", "Delta"]);

    const names = async (state: string) => (await manager.get(`/api/inventory?state=${state}`)).body.products.map((p: { name: string }) => p.name);
    expect(await names("low")).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(await names("out")).toEqual(["Bravo", "Charlie"]);
    expect(await names("negative")).toEqual(["Charlie"]);
    expect(await names("all")).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    // Search uses the same query (and the trigram indexes).
    expect((await manager.get("/api/inventory?q=har")).body.products.map((p: { name: string }) => p.name)).toEqual(["Charlie"]);
  });
});

describe("product sales activity", () => {
  it("updates on completed sales and voids without changing product availability", async () => {
    const { manager, mk } = await setup();
    const { group, v } = await mk("Slow Rope", "SR", 20);
    const detail = async () => (await manager.get(`/api/inventory/products/${group}`)).body.product;

    expect(await detail()).toMatchObject({ active: true, activityStatus: "Never Sold", lastSaleAt: null });
    expect((await manager.get("/api/inventory?status=all&activity=never-sold")).body.products.map((p: { id: string }) => p.id)).toContain(group);

    const oldSale = await post(manager, "/api/sales", {
      date: "2020-01-15T06:30:00.000Z",
      lines: [{ variationId: v, quantity: 1, price: 10 }],
    });
    expect(oldSale.status).toBe(201);
    expect(await detail()).toMatchObject({ active: true, activityStatus: "Inactive" });
    expect((await manager.get("/api/inventory?status=all&activity=inactive")).body.products.map((p: { id: string }) => p.id)).toContain(group);

    const recentSale = await post(manager, "/api/sales", { lines: [{ variationId: v, quantity: 1, price: 10 }] });
    expect(recentSale.status).toBe(201);
    expect(await detail()).toMatchObject({ active: true, activityStatus: "Active" });
    expect((await manager.get("/api/inventory?status=all&activity=active")).body.products.map((p: { id: string }) => p.id)).toContain(group);

    expect((await post(manager, `/api/sales/${recentSale.body.id}/void`, { reason: "Entered in error" })).status).toBe(200);
    expect(await detail()).toMatchObject({ active: true, activityStatus: "Inactive" });
    expect((await manager.get("/api/inventory?status=all&activity=inactive")).body.products.map((p: { id: string }) => p.id)).toContain(group);

    const saleWhileInactive = await post(manager, "/api/sales", { lines: [{ variationId: v, quantity: 1, price: 10 }] });
    expect(saleWhileInactive.status).toBe(201);
    expect(await detail()).toMatchObject({ active: true, activityStatus: "Active" });

    const sixMonths = await mk("Six month boundary", "S6", 1);
    const twelveMonths = await mk("Twelve month boundary", "S12", 1);
    for (const [item, months] of [[sixMonths, 6], [twelveMonths, 12]] as const) {
      const sale = await post(manager, "/api/sales", {
        date: businessDateMonthsAgo(months).toISOString(),
        lines: [{ variationId: item.v, quantity: 1, price: 10 }],
      });
      expect(sale.status).toBe(201);
      const product = (await manager.get(`/api/inventory/products/${item.group}`)).body.product;
      expect(product.activityStatus).toBe(months === 6 ? "Min-Active" : "Inactive");
    }
    const minActiveIds = (await manager.get("/api/inventory?status=all&activity=min-active")).body.products.map((p: { id: string }) => p.id);
    const inactiveIds = (await manager.get("/api/inventory?status=all&activity=inactive")).body.products.map((p: { id: string }) => p.id);
    expect(minActiveIds).toContain(sixMonths.group);
    expect(inactiveIds).toContain(twelveMonths.group);
  });
});

describe("line discount and payment", () => {
  it("stores flat line discounts, derives payment status, and refuses impossible amounts", async () => {
    const { manager, mk } = await setup();
    const { v } = await mk("Pump", "P", 10);
    const r = await post(manager, "/api/sales", {
      lines: [{ variationId: v, quantity: 2, price: 500, discount: 50, note: "Old customer" }],
      paymentMode: "UPI",
      amountPaid: 400,
    });
    expect(r.status).toBe(201);
    const d = (await manager.get(`/api/sales/${r.body.id}`)).body.document;
    expect(d).toMatchObject({ total: "950.00", gross: "1000.00", discount: "50.00", payment: { mode: "UPI", status: "PARTIAL", amountPaid: "400.00" } });
    expect(d.lines[0]).toMatchObject({ price: "500.00", discount: "50.00", note: "Old customer", lineTotal: "950.00" });

    const full = (await manager.get(`/api/sales/${(await post(manager, "/api/sales", { lines: [{ variationId: v, quantity: 1, price: 10 }], paymentMode: "CASH" })).body.id}`)).body.document;
    expect(full.payment).toMatchObject({ status: "PAID", amountPaid: "10.00" });
    const credit = (await manager.get(`/api/sales/${(await post(manager, "/api/sales", { lines: [{ variationId: v, quantity: 1, price: 10 }], paymentMode: "CREDIT" })).body.id}`)).body.document;
    expect(credit.payment).toMatchObject({ status: "PENDING", amountPaid: "0.00" });

    expect((await post(manager, "/api/sales", { lines: [{ variationId: v, quantity: 1, price: 10, discount: 11 }] })).body.error.code).toBe("DISCOUNT_TOO_LARGE");
    expect((await post(manager, "/api/sales", { lines: [{ variationId: v, quantity: 1, price: 10 }], paymentMode: "CASH", amountPaid: 11 })).body.error.code).toBe("OVERPAID");
  });
});

describe("void (cancel) documents", () => {
  it("cancels a sale with a reason, returns its stock, and keeps the document unchanged", async () => {
    const { co, manager, staff, mk } = await setup();
    const { v } = await mk("Valve", "V", 10);
    const sale = (await post(staff, "/api/sales", { lines: [{ variationId: v, quantity: 4, price: 100 }] })).body.id;
    expect(await stored(v)).toBe(6);
    expect((await post(staff, `/api/sales/${sale}/void`, { reason: "Customer returned" })).status).toBe(403);
    expect((await post(manager, `/api/sales/${sale}/void`, { reason: "" })).status).toBe(400);
    const r = await post(manager, `/api/sales/${sale}/void`, { reason: "Customer returned" });
    expect(r.status).toBe(200);
    expect(await stored(v)).toBe(10);
    const d = (await manager.get(`/api/sales/${sale}`)).body.document;
    expect(d).toMatchObject({ status: "CANCELLED", total: "400.00", void: { reason: "Customer returned" } });
    expect((await post(manager, `/api/sales/${sale}/void`, { reason: "again" })).body.error.code).toBe("ALREADY_VOID");
    expect((await manager.get("/api/sales?status=cancelled")).body.documents.map((x: { id: string }) => x.id)).toEqual([sale]);
    expect(await prisma.auditEvent.count({ where: { companyId: co.id, action: "SALE_VOID", entityId: sale } })).toBe(1);
  });

  it("refuses to cancel a purchase whose stock was already sold", async () => {
    const { manager, mk } = await setup();
    const { v } = await mk("Belt", "BT", 0);
    const pur = (await post(manager, "/api/purchases", { lines: [{ variationId: v, quantity: 5, price: 20 }] })).body.id;
    await post(manager, "/api/sales", { lines: [{ variationId: v, quantity: 3, price: 30 }] });
    const r = await post(manager, `/api/purchases/${pur}/void`, { reason: "Wrong supplier" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("STOCK_ALREADY_USED");
    expect(await stored(v)).toBe(2);
  });

  it("the database refuses a void movement without its void record", async () => {
    const { co, manager, mk } = await setup();
    const { v } = await mk("Gear", "G", 5);
    const sale = (await post(manager, "/api/sales", { lines: [{ variationId: v, quantity: 1, price: 1 }] })).body.id;
    await expect(
      prisma.stockMovement.create({ data: { companyId: co.id, variationId: v, movementType: "SALE_VOID", quantity: 1, unit: "Nos", saleId: sale } }),
    ).rejects.toThrow(/without a void record/);
  });
});

describe("drafts (held carts)", () => {
  it("parks a cart without touching stock, re-validates on resume, and completes with checkout", async () => {
    const { co, staff, manager, mk } = await setup();
    const { v } = await mk("Cable", "CB", 5);
    const created = await post(staff, "/api/drafts", { mode: "SALE", title: "Walk-in 2", lines: [{ variationId: v, quantity: 3, price: 40 }] });
    expect(created.status).toBe(201);
    const draft = created.body.draft;
    expect(draft).toMatchObject({ title: "Walk-in 2", lineCount: 1, estimatedTotal: "120.00", version: 1 });
    expect(await stored(v)).toBe(5);

    // Another counter sells meanwhile and the price changes.
    await post(manager, "/api/sales", { lines: [{ variationId: v, quantity: 4, price: 40 }] });
    await manager.patch(`/api/inventory/variations/${v}`).set("Origin", ORIGIN).send({ salePrice: 45 });
    expect((await manager.get("/api/drafts?mode=SALE")).body).toMatchObject({ count: 1 });
    const resumed = (await manager.get(`/api/drafts/${draft.id}`)).body.draft;
    expect(resumed.lines[0]).toMatchObject({ available: 1, shortage: 2, currentPrice: "45.00", priceChanged: true });

    const stale = await put(staff, `/api/drafts/${draft.id}`, { title: "x", version: 1 });
    expect(stale.status).toBe(200);
    expect((await put(staff, `/api/drafts/${draft.id}`, { title: "y", version: 1 })).body.error.code).toBe("VERSION_CONFLICT");

    const sale = await post(manager, "/api/sales", { draftId: draft.id, lines: [{ variationId: v, quantity: 1, price: 45 }] });
    expect(sale.status).toBe(201);
    const done = await prisma.draftOrder.findUniqueOrThrow({ where: { id: draft.id } });
    expect(done).toMatchObject({ status: "COMPLETED", documentId: sale.body.id });
    expect((await manager.get("/api/drafts?mode=SALE")).body.count).toBe(0);
    expect((await post(manager, "/api/sales", { draftId: draft.id, lines: [{ variationId: v, quantity: 1, price: 45 }] })).body.error.code).toBe("DRAFT_CLOSED");
    expect(await prisma.auditEvent.count({ where: { companyId: co.id, action: "DRAFT_CREATE" } })).toBe(1);
  });

  it("keeps purchase drafts away from sales staff and supports discard", async () => {
    const { staff, manager, mk } = await setup();
    const { v } = await mk("Bolt", "BL", 0);
    expect((await post(staff, "/api/drafts", { mode: "PURCHASE", title: "PO", lines: [] })).status).toBe(403);
    const d = (await post(manager, "/api/drafts", { mode: "PURCHASE", title: "PO 7", lines: [{ variationId: v, quantity: 10, price: 3 }] })).body.draft;
    expect((await staff.get("/api/drafts?mode=PURCHASE")).status).toBe(403);
    expect((await post(manager, `/api/drafts/${d.id}/discard`, {})).status).toBe(200);
    expect((await manager.get("/api/drafts?mode=PURCHASE")).body.count).toBe(0);
  });
});

describe("supplier prices", () => {
  it("keeps one rate per supplier with history, suggests the cheapest, and never overrides the typed price", async () => {
    const { co, staff, manager, mk } = await setup();
    const { group, v } = await mk("Rope", "RP", 0);
    const s1 = (await post(manager, "/api/parties", { type: "SUPPLIER", name: `Shah ${co.id.slice(-4)}` })).body.party.id;
    const s2 = (await post(manager, "/api/parties", { type: "SUPPLIER", name: `Mehta ${co.id.slice(-4)}` })).body.party.id;
    expect((await put(staff, "/api/vendor-prices", { variationId: v, supplierId: s1, rate: 90 })).status).toBe(403);
    await put(manager, "/api/vendor-prices", { variationId: v, supplierId: s1, rate: 90 });
    await put(manager, "/api/vendor-prices", { variationId: v, supplierId: s1, rate: 85, notes: "March rate" });
    await put(manager, "/api/vendor-prices", { variationId: v, supplierId: s2, rate: 88 });

    expect((await manager.get(`/api/vendor-prices?variationId=${v}`)).body.prices.map((p: { rate: string }) => p.rate)).toEqual(["85.00", "88.00"]);
    const hist = (await manager.get(`/api/vendor-prices/history?variationId=${v}&supplierId=${s1}`)).body.history;
    expect(hist.map((h: { rate: string }) => h.rate)).toEqual(["85.00", "90.00"]);
    const best = (await manager.get(`/api/vendor-prices/best?variationIds=${v}&supplierId=${s2}`)).body.suggestions[0];
    expect(best).toMatchObject({ supplierRate: "88.00", cheapest: { rate: "85.00", supplierId: s1 }, effectiveCost: "85.00", suggested: "88.00" });
    // V3.1: every active supplier rate, cheapest first, and the vendor range on the purchase card.
    expect(best.rates.map((r: { supplierId: string; rate: string }) => [r.supplierId, r.rate])).toEqual([[s1, "85.00"], [s2, "88.00"]]);
    const card = (await manager.get(`/api/catalog/products?pageSize=200`)).body.products.find((p: { id: string }) => p.id === group);
    expect(card.vendor).toEqual({ min: "85.00", max: "88.00", suppliers: 2 });
    const staffCard = (await staff.get(`/api/catalog/products?pageSize=200`)).body.products.find((p: { id: string }) => p.id === group);
    expect(staffCard.vendor).toBeUndefined();

    const pur = (await post(manager, "/api/purchases", { partyId: s2, lines: [{ variationId: v, quantity: 2, price: 99 }] })).body.id;
    expect((await manager.get(`/api/purchases/${pur}`)).body.document.lines[0].price).toBe("99.00");
    expect((await staff.get(`/api/vendor-prices?variationId=${v}`)).status).toBe(403);
  });
});

describe("preferences and party profile", () => {
  it("stores screen settings per user only", async () => {
    const { co, admin, manager } = await setup();
    await put(admin, "/api/me/preferences/inventory.columns", { value: { hidden: ["sku"] } });
    expect((await admin.get("/api/me/preferences/inventory.columns")).body.value).toEqual({ hidden: ["sku"] });
    expect((await manager.get("/api/me/preferences/inventory.columns")).body.value).toBeNull();
    expect((await put(admin, "/api/me/preferences/Bad Key", { value: 1 })).status).toBe(400);
    expect(co.id).toBeTruthy();
  });

  it("shows profile fields and lifetime totals without cancelled documents", async () => {
    const { manager, staff, mk, co } = await setup();
    const { v } = await mk("Hose", "HS", 10);
    const cust = (await post(manager, "/api/parties", { type: "CUSTOMER", name: `Patel ${co.id.slice(-4)}`, contactPerson: "Kishan", altPhone: "99999" })).body.party;
    expect(cust).toMatchObject({ contactPerson: "Kishan", altPhone: "99999" });
    await post(manager, "/api/sales", { partyId: cust.id, lines: [{ variationId: v, quantity: 1, price: 100 }] });
    const cancelled = (await post(manager, "/api/sales", { partyId: cust.id, lines: [{ variationId: v, quantity: 1, price: 50 }] })).body.id;
    await post(manager, `/api/sales/${cancelled}/void`, { reason: "Duplicate" });
    const prof = (await staff.get(`/api/parties/${cust.id}`)).body;
    expect(prof.metrics.sales).toMatchObject({ count: 1, total: "100.00" });
    expect(prof.metrics.purchases).toBeNull();
    expect((await manager.get(`/api/sales?partyId=${cust.id}`)).body.documents).toHaveLength(2);
  });
});
