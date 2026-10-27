import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const patch = (a: Agent, url: string, body: unknown) => a.patch(url).set("Origin", ORIGIN).send(body as object);

async function setup(stock = 10) {
  const co = await makeCompany();
  const admin = await signIn((await makeUser(co.id, "admin")).email);
  const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
  const staff = await signIn((await makeUser(co.id, "sales_staff")).email);
  const p = (
    await post(manager, "/api/products", {
      productType: "variable",
      name: "Hook",
      unit: "Nos",
      baseShortName: "HK",
      attributes: [{ name: "Size", values: ["S", "L"] }],
      variations: [{ attributes: { Size: "S" }, officialSku: "OFF-S" }, { attributes: { Size: "L" }, officialSku: null }],
    })
  ).body.product;
  const [s, l] = p.variations.map((v: { id: string }) => v.id) as [string, string];
  for (const id of [s, l]) await post(manager, "/api/inventory/adjustments", { variationId: id, type: "OPENING", quantity: stock });
  return { co, admin, manager, staff, product: p, s, l };
}

const stock = async (variationId: string) =>
  Number((await prisma.stockMovement.aggregate({ where: { variationId }, _sum: { quantity: true } }))._sum.quantity ?? 0);

describe("sales", () => {
  it("creates a numbered sale with server totals, snapshots, stock movements and an audit event", async () => {
    const { staff, co, s, l } = await setup();
    const r = await post(staff, "/api/sales", { lines: [{ variationId: s, quantity: 3, price: "450" }, { variationId: l, quantity: 2, price: 120 }] });
    expect(r.status).toBe(201);
    const d = (await staff.get(`/api/sales/${r.body.id}`)).body.document;
    expect(d.number).toMatch(/^SAL\/\d{4}-\d{2}\/0001$/);
    expect(d).toMatchObject({ partyName: null, subtotal: "1590.00", total: "1590.00", status: "COMPLETED" });
    expect(d.lines.map((x: { shortName: string; officialSku: string | null; quantity: number; price: string; lineTotal: string }) => [x.shortName, x.officialSku, x.quantity, x.price, x.lineTotal])).toEqual([
      ["S-HK", "OFF-S", 3, "450.00", "1350.00"],
      ["L-HK", null, 2, "120.00", "240.00"],
    ]);
    expect([await stock(s), await stock(l)]).toEqual([7, 8]);
    const mv = await prisma.stockMovement.findMany({ where: { saleId: r.body.id } });
    expect(mv.map((m) => [m.movementType, Number(m.quantity), m.reason])).toEqual(expect.arrayContaining([["SALE", -3, d.number], ["SALE", -2, d.number]]));
    expect(await prisma.auditEvent.count({ where: { companyId: co.id, entityId: r.body.id, action: "SALE_CREATE" } })).toBe(1);
  });

  it("is all-or-nothing: one short line rejects the whole sale and consumes no number", async () => {
    const { manager, s, l } = await setup(5);
    const r = await post(manager, "/api/sales", { lines: [{ variationId: s, quantity: 1, price: 1 }, { variationId: l, quantity: 6, price: 1 }] });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe("Insufficient stock: Hook L-HK (need 6, have 5)");
    expect([await stock(s), await stock(l)]).toEqual([5, 5]);
    const ok = await post(manager, "/api/sales", { lines: [{ variationId: s, quantity: 1, price: 1 }] });
    expect((await manager.get(`/api/sales/${ok.body.id}`)).body.document.number).toMatch(/\/0001$/);
  });

  it("never oversells under concurrency: 8 parallel sales of 2 against stock 10", async () => {
    const { manager, s } = await setup(10);
    const results = await Promise.all(Array.from({ length: 8 }, () => post(manager, "/api/sales", { lines: [{ variationId: s, quantity: 2, price: 5 }] })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await stock(s)).toBe(0);
    const numbers = (await prisma.sale.findMany({ where: { lines: { some: { variationId: s } } }, select: { number: true } })).map((x) => x.number.slice(-4)).sort();
    expect(numbers).toEqual(["0001", "0002", "0003", "0004", "0005"]);
  });

  it("returns the same sale for a repeated submit (double-click safe)", async () => {
    const { manager, s } = await setup();
    const body = { clientRef: randomUUID(), lines: [{ variationId: s, quantity: 1, price: 10 }] };
    const [a, b] = await Promise.all([post(manager, "/api/sales", body), post(manager, "/api/sales", body)]);
    expect(a.body.id).toBe(b.body.id);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await stock(s)).toBe(9);
  });

  it("keeps historical lines unchanged after product and price edits (BR-27)", async () => {
    const { manager, admin, product, s } = await setup();
    const sale = (await post(manager, "/api/sales", { lines: [{ variationId: s, quantity: 1, price: "99" }] })).body.id;
    await patch(manager, `/api/products/${product.id}`, { name: "Renamed Hook" });
    await patch(manager, `/api/products/${product.id}/variations/${s}`, { shortName: "NEW-CODE", officialSku: "NEW-SKU" });
    await patch(manager, `/api/inventory/variations/${s}`, { salePrice: "500" });
    await patch(admin, `/api/products/${product.id}`, { active: false });
    const line = (await manager.get(`/api/sales/${sale}`)).body.document.lines[0];
    expect(line).toMatchObject({ productName: "Hook", shortName: "S-HK", officialSku: "OFF-S", price: "99.00" });
  });

  it("refuses archived items, duplicates, other companies' items and a supplier as customer", async () => {
    const { manager, admin, product, s, l } = await setup();
    const other = await setup();
    expect((await post(manager, "/api/sales", { lines: [{ variationId: s, quantity: 1, price: 1 }, { variationId: s, quantity: 1, price: 1 }] })).body.error.code).toBe("DUPLICATE_LINE");
    expect((await post(manager, "/api/sales", { lines: [{ variationId: other.s, quantity: 1, price: 1 }] })).body.error.code).toBe("UNKNOWN_ITEM");
    const supplier = (await post(manager, "/api/parties", { type: "SUPPLIER", name: "Alpha Steel" })).body.party.id;
    expect((await post(manager, "/api/sales", { partyId: supplier, lines: [{ variationId: s, quantity: 1, price: 1 }] })).body.error.code).toBe("WRONG_PARTY_TYPE");
    await patch(admin, `/api/products/${product.id}/variations/${l}`, { active: false });
    expect((await post(manager, "/api/sales", { lines: [{ variationId: l, quantity: 1, price: 1 }] })).body.error.code).toBe("INACTIVE_ITEM");
  });

  it("records the customer name at the time of sale", async () => {
    const { staff, manager, s } = await setup();
    const cust = (await post(staff, "/api/parties", { type: "CUSTOMER", name: "Rahul Engineering", phone: "98000" })).body.party.id;
    const sale = (await post(staff, "/api/sales", { partyId: cust, lines: [{ variationId: s, quantity: 1, price: 1 }] })).body.id;
    await patch(manager, `/api/parties/${cust}`, { name: "Rahul Engg Pvt Ltd" });
    expect((await staff.get(`/api/sales/${sale}`)).body.document.partyName).toBe("Rahul Engineering");
    const list = (await staff.get("/api/sales?q=rahul")).body.documents;
    expect(list.map((d: { id: string }) => d.id)).toEqual([sale]);
  });
});

describe("purchases", () => {
  it("increases stock atomically and does not change the variation's price or cost (D19)", async () => {
    const { manager, s } = await setup(0);
    await patch(manager, `/api/inventory/variations/${s}`, { salePrice: "500", purchaseCost: "300" });
    const r = await post(manager, "/api/purchases", { notes: "GRN 12", lines: [{ variationId: s, quantity: 25, price: "275" }] });
    expect(r.status).toBe(201);
    const d = (await manager.get(`/api/purchases/${r.body.id}`)).body.document;
    expect(d).toMatchObject({ total: "6875.00", notes: "GRN 12" });
    expect(d.number).toMatch(/^PUR\//);
    expect(await stock(s)).toBe(25);
    const v = await prisma.productVariation.findUniqueOrThrow({ where: { id: s } });
    expect([v.salePrice.toFixed(2), v.purchaseCost.toFixed(2)]).toEqual(["500.00", "300.00"]);
  });

  it("is admin/manager only, as in main v2 (D12)", async () => {
    const { staff, s } = await setup();
    expect((await post(staff, "/api/purchases", { lines: [{ variationId: s, quantity: 1, price: 1 }] })).status).toBe(403);
    expect((await staff.get("/api/purchases")).status).toBe(403);
    expect((await post(staff, "/api/parties", { type: "SUPPLIER", name: "X" })).status).toBe(403);
  });
});

describe("database guarantees", () => {
  it("documents, lines and their movements are append-only", async () => {
    const { manager, s } = await setup();
    const id = (await post(manager, "/api/sales", { lines: [{ variationId: s, quantity: 1, price: 10 }] })).body.id;
    await expect(prisma.sale.update({ where: { id }, data: { notes: "x" } })).rejects.toThrow(/append-only/);
    await expect(prisma.saleLine.updateMany({ where: { saleId: id }, data: { quantity: 5 } })).rejects.toThrow(/append-only/);
    await expect(prisma.sale.delete({ where: { id } })).rejects.toThrow(/append-only/);
  });

  it("refuses at commit a document whose totals or stock do not match its lines", async () => {
    const { co, s } = await setup();
    const userId = (await prisma.user.findFirstOrThrow({ where: { companyId: co.id } })).id;
    const base = { companyId: co.id, createdById: userId, partyName: null };
    const line = { lineNo: 1, variationId: s, productNameSnapshot: "Hook", shortNameSnapshot: "S-HK", unit: "Nos", quantity: 1, unitPrice: "10.00", lineTotal: "10.00" };
    // Wrong total.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.sale.create({ data: { ...base, number: "SAL/2026-27/9001", subtotal: "11.00", total: "11.00", lines: { create: [line] } } });
      }),
    ).rejects.toThrow(/totals do not match/);
    // Right total but no stock movement.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.sale.create({ data: { ...base, number: "SAL/2026-27/9002", subtotal: "10.00", total: "10.00", lines: { create: [line] } } });
      }),
    ).rejects.toThrow(/stock movements do not match/);
    // A line total that is not quantity × price.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.sale.create({ data: { ...base, number: "SAL/2026-27/9003", subtotal: "9.00", total: "9.00", lines: { create: [{ ...line, lineTotal: "9.00" }] } } });
      }),
    ).rejects.toThrow(/sale_lines_amounts/);
    expect(await prisma.sale.count({ where: { companyId: co.id } })).toBe(0);
  });
});
