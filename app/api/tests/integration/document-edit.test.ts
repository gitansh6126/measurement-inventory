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
      variations: [
        { attributes: { Size: "S" }, officialSku: "OFF-S" },
        { attributes: { Size: "L" }, officialSku: null },
      ],
    })
  ).body.product;
  const [s, l] = p.variations.map((v: { id: string }) => v.id) as [string, string];
  for (const id of [s, l]) {
    await post(manager, "/api/inventory/adjustments", { variationId: id, type: "OPENING", quantity: stock });
  }
  return { co, admin, manager, staff, product: p, s, l };
}

const stock = async (variationId: string) =>
  Number((await prisma.stockMovement.aggregate({ where: { variationId }, _sum: { quantity: true } }))._sum.quantity ?? 0);

describe("document editing (sales and purchases)", () => {
  it("edits a sale: produces revision -R1, updates stock by delta, voids original as REPLACED", async () => {
    const { manager, s, l } = await setup(10);

    // Initial sale: 3 of s, 2 of l (stock becomes 7 and 8)
    const r1 = await post(manager, "/api/sales", {
      lines: [
        { variationId: s, quantity: 3, price: "400" },
        { variationId: l, quantity: 2, price: "100" },
      ],
    });
    expect(r1.status).toBe(201);
    const originalSaleId = r1.body.id;
    expect(await stock(s)).toBe(7);
    expect(await stock(l)).toBe(8);

    // Preview edit: increase s to 5, remove l, add notes
    const preview = await post(manager, `/api/sales/${originalSaleId}/edit/preview`, {
      reason: "Customer changed order at counter",
      lines: [{ variationId: s, quantity: 5, price: "400" }],
    });
    expect(preview.status).toBe(200);
    expect(preview.body.lines.find((l: any) => l.change === "changed")).toBeDefined();
    expect(preview.body.lines.find((l: any) => l.change === "removed")).toBeDefined();
    expect(preview.body.totals.after.total).toBe("2000.00");
    expect(preview.body.totals.before.total).toBe("1400.00");
    expect(preview.body.stock).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ variationId: s, delta: -2 }), // Sale takes 2 more
        expect.objectContaining({ variationId: l, delta: 2 }), // Sale returns 2
      ]),
    );

    // Submit edit
    const editRes = await post(manager, `/api/sales/${originalSaleId}/edit`, {
      reason: "Customer changed order at counter",
      lines: [{ variationId: s, quantity: 5, price: "400" }],
    });
    expect(editRes.status).toBe(201);
    const newSaleId = editRes.body.id;
    const newSaleNumber = editRes.body.number;
    expect(newSaleNumber).toMatch(/^SAL-\d{8}-001-R1$/);

    // Stock check: s should be 10 - 5 = 5; l should be 10
    expect(await stock(s)).toBe(5);
    expect(await stock(l)).toBe(10);

    // Verify original void state
    const originalVoid = await prisma.documentVoid.findUnique({
      where: { saleId: originalSaleId },
    });
    expect(originalVoid?.kind).toBe("REPLACED");
    expect(originalVoid?.replacedBySaleId).toBe(newSaleId);
    expect(originalVoid?.reason).toBe("Customer changed order at counter");

    // Verify revision chain in GET /api/sales/:id
    const getNew = await manager.get(`/api/sales/${newSaleId}`);
    expect(getNew.status).toBe(200);
    const doc = getNew.body.document;
    expect(doc.revision).toBe(1);
    expect(doc.replaces.id).toBe(originalSaleId);
    expect(doc.revisions).toHaveLength(2);
    expect(doc.revisions[0]).toMatchObject({ id: originalSaleId, revision: 0, status: "REPLACED" });
    expect(doc.revisions[1]).toMatchObject({ id: newSaleId, revision: 1, status: "COMPLETED" });

    // Editing again produces -R2
    const editRes2 = await post(manager, `/api/sales/${newSaleId}/edit`, {
      reason: "Small quantity reduction",
      lines: [{ variationId: s, quantity: 4, price: "400" }],
    });
    expect(editRes2.status).toBe(201);
    expect(editRes2.body.number).toMatch(/^SAL-\d{8}-001-R2$/);
    expect(await stock(s)).toBe(6);
  });

  it("purchase edit: allows price edit when inventory is already sold", async () => {
    const { manager, s } = await setup(0);

    // 1. Purchase 10 items @ 100
    const pur = await post(manager, "/api/purchases", {
      lines: [{ variationId: s, quantity: 10, price: "100" }],
    });
    expect(pur.status).toBe(201);
    const purId = pur.body.id;
    expect(await stock(s)).toBe(10);

    // 2. Sell 8 items
    const sale = await post(manager, "/api/sales", {
      lines: [{ variationId: s, quantity: 8, price: "200" }],
    });
    expect(sale.status).toBe(201);
    expect(await stock(s)).toBe(2);

    // 3. Edit purchase: only change price from 100 to 110, keep quantity = 10
    // Because purchase order adds stock (+10) before void removes (-10),
    // intermediate stock never goes below 0!
    const editPur = await post(manager, `/api/purchases/${purId}/edit`, {
      reason: "Supplier bill correction",
      lines: [{ variationId: s, quantity: 10, price: "110" }],
    });
    expect(editPur.status).toBe(201);
    expect(editPur.body.number).toMatch(/^PUR-\d{8}-001-R1$/);
    expect(await stock(s)).toBe(2);

    const updatedDoc = (await manager.get(`/api/purchases/${editPur.body.id}`)).body.document;
    expect(updatedDoc.total).toBe("1100.00");
  });

  it("purchase edit: fails with STOCK_ALREADY_USED when reducing quantity below stock on hand", async () => {
    const { manager, s } = await setup(0);

    // Purchase 10
    const pur = await post(manager, "/api/purchases", {
      lines: [{ variationId: s, quantity: 10, price: "100" }],
    });
    expect(pur.status).toBe(201);
    const purId = pur.body.id;

    // Sell 8 (remaining stock = 2)
    await post(manager, "/api/sales", {
      lines: [{ variationId: s, quantity: 8, price: "200" }],
    });
    expect(await stock(s)).toBe(2);

    // Try to reduce purchase quantity to 5 (requires net reduction of 5, but only 2 remain!)
    const editPur = await post(manager, `/api/purchases/${purId}/edit`, {
      reason: "Supplier short-shipped",
      lines: [{ variationId: s, quantity: 5, price: "100" }],
    });
    expect(editPur.status).toBe(409);
    expect(editPur.body.error.code).toBe("STOCK_ALREADY_USED");
    // Stock remains unchanged at 2
    expect(await stock(s)).toBe(2);
  });

  it("refuses to edit an already-replaced or cancelled document", async () => {
    const { manager, s } = await setup(10);
    const r = await post(manager, "/api/sales", {
      lines: [{ variationId: s, quantity: 1, price: "100" }],
    });
    const saleId = r.body.id;

    // Edit once
    await post(manager, `/api/sales/${saleId}/edit`, {
      reason: "Initial fix",
      lines: [{ variationId: s, quantity: 2, price: "100" }],
    });

    // Attempt to edit original again
    const editAgain = await post(manager, `/api/sales/${saleId}/edit`, {
      reason: "Trying to edit replaced again",
      lines: [{ variationId: s, quantity: 3, price: "100" }],
    });
    expect(editAgain.status).toBe(409);
    expect(editAgain.body.error.code).toBe("ALREADY_REPLACED");

    // Cancel a separate sale and try editing it
    const r2 = await post(manager, "/api/sales", {
      lines: [{ variationId: s, quantity: 1, price: "100" }],
    });
    const sale2Id = r2.body.id;
    const voidRes = await post(manager, `/api/sales/${sale2Id}/void`, { reason: "Customer cancelled" });
    expect(voidRes.status).toBe(200);

    const editCancelled = await post(manager, `/api/sales/${sale2Id}/edit`, {
      reason: "Trying to edit cancelled",
      lines: [{ variationId: s, quantity: 1, price: "100" }],
    });
    expect(editCancelled.status).toBe(409);
    expect(editCancelled.body.error.code).toBe("ALREADY_CANCELLED");
  });

  it("enforces permissions: sales_staff cannot edit sales or purchases", async () => {
    const { manager, staff, s } = await setup(10);
    const sale = (
      await post(manager, "/api/sales", {
        lines: [{ variationId: s, quantity: 1, price: "100" }],
      })
    ).body.id;

    const pur = (
      await post(manager, "/api/purchases", {
        lines: [{ variationId: s, quantity: 1, price: "100" }],
      })
    ).body.id;

    const editSale = await post(staff, `/api/sales/${sale}/edit`, {
      reason: "Unauthorized staff edit",
      lines: [{ variationId: s, quantity: 2, price: "100" }],
    });
    expect(editSale.status).toBe(403);

    const editPur = await post(staff, `/api/purchases/${pur}/edit`, {
      reason: "Unauthorized staff edit",
      lines: [{ variationId: s, quantity: 2, price: "100" }],
    });
    expect(editPur.status).toBe(403);
  });

  it("list endpoint hides replaced documents by default", async () => {
    const { manager, s } = await setup(10);
    const r1 = await post(manager, "/api/sales", {
      lines: [{ variationId: s, quantity: 1, price: "100" }],
    });
    const originalSaleId = r1.body.id;

    const r2 = await post(manager, `/api/sales/${originalSaleId}/edit`, {
      reason: "Replace sale",
      lines: [{ variationId: s, quantity: 2, price: "100" }],
    });
    const newSaleId = r2.body.id;

    // Default listing: should contain newSaleId, but NOT originalSaleId
    const defaultList = (await manager.get("/api/sales")).body.documents;
    const defaultIds = defaultList.map((d: { id: string }) => d.id);
    expect(defaultIds).toContain(newSaleId);
    expect(defaultIds).not.toContain(originalSaleId);

    // Listing with includeReplaced=1: should contain BOTH
    const withReplaced = (await manager.get("/api/sales?includeReplaced=1")).body.documents;
    const withReplacedIds = withReplaced.map((d: { id: string }) => d.id);
    expect(withReplacedIds).toContain(newSaleId);
    expect(withReplacedIds).toContain(originalSaleId);

    // Listing with status=replaced: should contain only originalSaleId
    const onlyReplaced = (await manager.get("/api/sales?status=replaced")).body.documents;
    const onlyReplacedIds = onlyReplaced.map((d: { id: string }) => d.id);
    expect(onlyReplacedIds).toContain(originalSaleId);
    expect(onlyReplacedIds).not.toContain(newSaleId);
  });
});
