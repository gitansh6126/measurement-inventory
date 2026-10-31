import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// V2 plan §1.9 / Step 6 + PRE-HOSTING-CHECKLIST: V2 backups round-trip every V2 table, and a
// V1 archive (backupVersion 1.0, no V2 tables or columns) restores into V2 with safe defaults,
// exact stock balances, continued numbering and a BACKUP_MIGRATION_V1_TO_V2 audit event.

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const restore = (a: Agent, payload: Buffer) =>
  a.post("/api/backup/restore?confirm=true").set("Origin", ORIGIN).set("Content-Type", "application/octet-stream").send(payload);

// Fields and tables V1 never had; removing them turns a V2 export into a V1-shaped archive.
const V2_ROW_FIELDS = ["version", "contactPerson", "altPhone", "shippingAddress", "paymentMode", "paymentStatus", "amountPaid", "discount", "note", "negativeStockPolicy", "lastSaleAt", "minSalePrice", "lengthUnit", "rollName", "defaultRollLength", "lengthDecimals", "scrapBelow"];
const V2_TABLES = ["documentVoids", "draftOrders", "vendorPrices", "vendorPriceHistory", "measurementPieces", "measurementPieceLedger"];
function toV1(json: { version: string; data: Record<string, unknown[]> }) {
  const data: Record<string, unknown[]> = {};
  for (const [k, rows] of Object.entries(json.data)) {
    if (V2_TABLES.includes(k) || !Array.isArray(rows)) continue; // companySettings (V3.1) is not a table
    data[k] = rows.map((r) => Object.fromEntries(Object.entries(r as Record<string, unknown>).filter(([f]) => !V2_ROW_FIELDS.includes(f))));
  }
  return { ...json, version: "1.0", data };
}

async function source() {
  const co = await makeCompany();
  const admin = await signIn((await makeUser(co.id, "admin")).email);
  const tag = co.id.slice(-5).toUpperCase();
  const p = (await post(admin, "/api/products", { productType: "simple", name: "Winch", unit: "Nos", shortName: `W-${tag}`, officialSku: null })).body.product;
  const v = p.variations[0].id as string;
  await admin.patch(`/api/inventory/variations/${v}`).set("Origin", ORIGIN).send({ minSalePrice: "40", salePrice: "55" });
  await post(admin, "/api/inventory/adjustments", { variationId: v, type: "OPENING", quantity: 20 });
  const supplier = (await post(admin, "/api/parties", { type: "SUPPLIER", name: `Supp ${tag}`, contactPerson: "Ravi" })).body.party.id;
  await post(admin, "/api/purchases", { partyId: supplier, lines: [{ variationId: v, quantity: 5, price: 70 }] });
  return { co, admin, v, supplier, tag };
}

const sumBalances = async (companyId: string) => Number((await prisma.stockBalance.aggregate({ where: { companyId }, _sum: { quantity: true } }))._sum.quantity ?? 0);
const drift = async (companyId: string) => Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM stock_balance_drift WHERE company_id = ${companyId}`)[0]!.n);

describe("V2 backup round trip", () => {
  it("restores voids, drafts, discounts, payments and supplier prices into another company", async () => {
    const { co, admin, v, supplier } = await source();
    const keep = (await post(admin, "/api/sales", { date: "2020-01-15T06:30:00.000Z", lines: [{ variationId: v, quantity: 3, price: 100, discount: 20 }], paymentMode: "CASH" })).body.id;
    const cancelled = (await post(admin, "/api/sales", { lines: [{ variationId: v, quantity: 2, price: 100 }] })).body.id;
    await post(admin, `/api/sales/${cancelled}/void`, { reason: "Entered twice" });
    await post(admin, "/api/drafts", { mode: "SALE", title: "Hold for Kishan", lines: [{ variationId: v, quantity: 1, price: 100 }] });
    await admin.put("/api/vendor-prices").set("Origin", ORIGIN).send({ variationId: v, supplierId: supplier, rate: 68 });
    const sourceStock = await sumBalances(co.id);
    expect(sourceStock).toBe(22);

    const zip = (await admin.get("/api/backup").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    })).body as Buffer;

    const target = await makeCompany();
    const tAdmin = await signIn((await makeUser(target.id, "admin")).email);
    const inspect = await tAdmin.post("/api/backup/inspect").set("Origin", ORIGIN).set("Content-Type", "application/zip").send(zip);
    expect(inspect.body).toMatchObject({ valid: true, sourceVersion: "2.0", upgradesFromV1: false });
    const r = await restore(tAdmin, zip);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ sourceVersion: "2.0", upgradedFromV1: false, checks: { stockBalanceDrift: 0 } });

    expect(await sumBalances(target.id)).toBe(sourceStock);
    expect(await drift(target.id)).toBe(0);
    const restoredProduct = (await tAdmin.get("/api/products?status=all")).body.products[0];
    expect(restoredProduct.variations[0].minSalePrice).toBe("40.00");
    const sourceLastSaleAt = (await prisma.productGroup.findFirstOrThrow({ where: { companyId: co.id }, select: { lastSaleAt: true } })).lastSaleAt;
    expect(restoredProduct.activityStatus).toBe("Inactive");
    expect(new Date(restoredProduct.lastSaleAt).getTime()).toBe(sourceLastSaleAt?.getTime());
    const sales = (await tAdmin.get("/api/sales")).body.documents;
    expect(sales.map((s: { status: string }) => s.status).sort()).toEqual(["CANCELLED", "COMPLETED"]);
    const kept = sales.find((s: { status: string }) => s.status === "COMPLETED");
    const d = (await tAdmin.get(`/api/sales/${kept.id}`)).body.document;
    expect(d).toMatchObject({ total: "280.00", discount: "20.00", payment: { mode: "CASH", status: "PAID" } });
    expect((await tAdmin.get("/api/drafts?mode=SALE")).body.drafts[0]).toMatchObject({ title: "Hold for Kishan", lineCount: 1 });
    expect((await prisma.vendorPrice.findMany({ where: { companyId: target.id } })).map((x) => x.rate.toFixed(2))).toEqual(["68.00"]);
    expect(await prisma.party.findFirst({ where: { companyId: target.id, type: "SUPPLIER" }, select: { contactPerson: true } })).toEqual({ contactPerson: "Ravi" });
    expect(await prisma.auditEvent.count({ where: { companyId: target.id, action: "BACKUP_RESTORE" } })).toBe(1);
    expect(keep).toBeTruthy();
  });

  it("restores orders with their delivered quantities and document → order line links (0027)", async () => {
    const { admin, v } = await source();
    const created = await post(admin, "/api/orders", { kind: "SALE", status: "PLACED", lines: [{ variationId: v, quantity: 4, price: 100 }] });
    const lineId = (await admin.get(`/api/orders/${created.body.id}`)).body.order.lines[0].id;
    const part = await post(admin, `/api/orders/${created.body.id}/fulfill`, { lines: [{ orderLineId: lineId, quantity: 3 }] });
    expect(part.status).toBe(201);
    const srcLine = await prisma.saleLine.findFirstOrThrow({ where: { saleId: part.body.documentId } });
    expect(srcLine.orderLineId).toBe(lineId);

    const zip = (await admin.get("/api/backup").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    })).body as Buffer;
    const target = await makeCompany();
    const tAdmin = await signIn((await makeUser(target.id, "admin")).email);
    expect((await restore(tAdmin, zip)).status).toBe(200);
    // Restoring again over the same company also works (document lines are deleted before orders).
    expect((await restore(tAdmin, zip)).status).toBe(200);

    const order = await prisma.order.findFirstOrThrow({ where: { companyId: target.id }, include: { lines: true } });
    expect(order.status).toBe("PARTIALLY_FULFILLED");
    expect(Number(order.lines[0]!.fulfilledQuantity)).toBe(3);
    const sale = await prisma.sale.findFirstOrThrow({ where: { companyId: target.id, orderId: order.id }, include: { lines: true } });
    expect(sale.lines[0]!.orderLineId).toBe(order.lines[0]!.id);
    expect(await drift(target.id)).toBe(0);
  });

  it("restores company length settings, order version and procurement links (V3.1)", async () => {
    const { co, admin, v, supplier } = await source();
    await prisma.company.update({ where: { id: co.id }, data: { lengthDecimalsM: 2, scrapBelowM: "0.250", lengthDecimalsFtIn: 0, scrapBelowFtIn: "24.000" } });
    const so = (await post(admin, "/api/orders", { kind: "SALE", status: "PLACED", lines: [{ variationId: v, quantity: 4, price: 100 }] })).body.id as string;
    const po = (await post(admin, "/api/orders", { kind: "PURCHASE", status: "PLACED", partyId: supplier, lines: [{ variationId: v, quantity: 4, price: 70 }] })).body.id as string;
    const soLine = await prisma.orderLine.findFirstOrThrow({ where: { orderId: so } });
    const poLine = await prisma.orderLine.findFirstOrThrow({ where: { orderId: po } });
    await prisma.orderLine.update({ where: { id: poLine.id }, data: { linkedOrderId: so, linkedOrderLineId: soLine.id } });
    await prisma.order.update({ where: { id: so }, data: { version: 3 } });

    const zip = (await admin.get("/api/backup").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    })).body as Buffer;
    const target = await makeCompany();
    const tAdmin = await signIn((await makeUser(target.id, "admin")).email);
    expect((await restore(tAdmin, zip)).status).toBe(200);

    const t = await prisma.company.findUniqueOrThrow({ where: { id: target.id } });
    expect([t.lengthDecimalsM, t.scrapBelowM?.toFixed(3), t.lengthDecimalsFtIn, t.scrapBelowFtIn?.toFixed(3)]).toEqual([2, "0.250", 0, "24.000"]);
    const orders = await prisma.order.findMany({ where: { companyId: target.id }, include: { lines: true } });
    const rSo = orders.find((o) => o.kind === "SALE")!;
    const rPo = orders.find((o) => o.kind === "PURCHASE")!;
    expect(rSo.version).toBe(3);
    expect(rPo.lines[0]!.linkedOrderId).toBe(rSo.id);
    expect(rPo.lines[0]!.linkedOrderLineId).toBe(rSo.lines[0]!.id);
  });
});

describe("V1 archive into V2 (pre-hosting compatibility gate)", () => {
  it("uplifts a V1 backup with defaults, exact balances and continued numbering", async () => {
    const { co, admin, v } = await source();
    await post(admin, "/api/sales", { lines: [{ variationId: v, quantity: 4, price: 90 }] });
    const v2json = (await admin.get("/api/backup?format=json")).body;
    const v1 = toV1(v2json);
    expect(Object.keys(v1.data)).not.toContain("documentVoids");
    expect(JSON.stringify(v1.data)).not.toContain('"version"');

    const target = await makeCompany();
    const tAdmin = await signIn((await makeUser(target.id, "admin")).email);
    const payload = Buffer.from(JSON.stringify(v1));
    expect((await tAdmin.post("/api/backup/inspect").set("Origin", ORIGIN).set("Content-Type", "application/octet-stream").send(payload)).body).toMatchObject({
      sourceVersion: "1.0",
      upgradesFromV1: true,
    });
    const r = await restore(tAdmin, payload);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ upgradedFromV1: true, checks: { stockBalanceDrift: 0 } });

    // Balances seeded from the movement history, equal to the source company.
    expect(await sumBalances(target.id)).toBe(await sumBalances(co.id));
    expect(await drift(target.id)).toBe(0);
    // V2 defaults on V1 rows.
    const g = await prisma.productGroup.findFirstOrThrow({ where: { companyId: target.id } });
    expect(g.version).toBe(1);
    const restoredProduct = (await tAdmin.get("/api/products?status=all")).body.products[0];
    expect(restoredProduct.activityStatus).toBe("Active");
    expect(restoredProduct.variations[0].minSalePrice).toBe("0.00");
    const line = await prisma.saleLine.findFirstOrThrow({ where: { sale: { companyId: target.id } } });
    expect(line.discount.toFixed(2)).toBe("0.00");
    // Numbering continues after the restored V1 documents.
    const before = (await tAdmin.get("/api/sales")).body.documents[0].number as string;
    const newVar = (await prisma.productVariation.findFirstOrThrow({ where: { companyId: target.id } })).id;
    const next = (await post(tAdmin, "/api/sales", { lines: [{ variationId: newVar, quantity: 1, price: 90 }] })).body.id;
    const nextNumber = (await tAdmin.get(`/api/sales/${next}`)).body.document.number as string;
    // Date-based numbers (SAL-DDMMYYYY-001): same kind and day, sequence one higher.
    const parts = (n: string) => /^(.*-)(\d+)$/.exec(n)!.slice(1) as [string, string];
    const [beforePrefix, beforeSeq] = parts(before);
    const [nextPrefix, nextSeq] = parts(nextNumber);
    expect(nextPrefix).toBe(beforePrefix);
    expect(Number(nextSeq)).toBe(Number(beforeSeq) + 1);
    expect(await prisma.auditEvent.count({ where: { companyId: target.id, action: "BACKUP_MIGRATION_V1_TO_V2" } })).toBe(1);
  });
});
