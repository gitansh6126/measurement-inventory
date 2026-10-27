import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// Corrections of daily mistakes (docs\CORRECTIONS-AUDIT-2026-10-27.md): S1 header edit of
// documents with Measured items or sets, P1 attribute / value rename, P2 delete what was never used.

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const del = (a: Agent, url: string) => a.delete(url).set("Origin", ORIGIN);

async function setup() {
  const co = await makeCompany();
  await prisma.company.update({ where: { id: co.id }, data: { lengthDecimalsM: 1, scrapBelowM: 0.5 } });
  const admin = await signIn((await makeUser(co.id, "admin")).email);
  const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
  const tag = co.id.slice(-5).toUpperCase();
  const rope = await post(manager, "/api/products", {
    productType: "measured",
    name: "Wire Rope",
    baseShortName: `WR${tag}`,
    attributes: [{ name: "Diameter", unit: "mm", values: ["8", "10"] }],
    variations: [{ attributes: { Diameter: "8" } }, { attributes: { Diameter: "10" } }],
    measure: { lengthUnit: "m", rollName: "Roll", defaultRollLength: 500 },
  });
  expect(rope.status).toBe(201);
  const v = (d: string) => rope.body.product.variations.find((x: { attributes: Record<string, string> }) => x.attributes.Diameter === d).id as string;
  const supplier = (await post(manager, "/api/parties", { type: "SUPPLIER", name: `Alpha ${tag}` })).body.party.id as string;
  const customer = (await post(manager, "/api/parties", { type: "CUSTOMER", name: `Beta ${tag}` })).body.party.id as string;
  return { co, admin, manager, tag, rope: rope.body.product, v8: v("8"), v10: v("10"), supplier, customer };
}

const stock = async (variationId: string) => Number((await prisma.stockBalance.findUnique({ where: { variationId } }))?.quantity ?? 0);

describe("S1: header edit of documents with measured items or sets", () => {
  it("re-prices a measured purchase and sale; rolls and stock move to the revision; cancelling the revision still works", async () => {
    const s = await setup();
    const pur = await post(s.manager, "/api/purchases", { partyId: s.supplier, lines: [{ variationId: s.v10, price: 58, rolls: [{ length: 500 }, { length: 300 }] }] });
    expect(pur.status).toBe(201);
    expect(await stock(s.v10)).toBe(800);

    // Items or quantities cannot change on such a document.
    const wrongQty = await post(s.manager, `/api/purchases/${pur.body.id}/edit`, { partyId: s.supplier, reason: "Fix", lines: [{ variationId: s.v10, quantity: 700, price: 60 }] });
    expect(wrongQty.body.error.code).toBe("HEADER_EDIT_ONLY");

    const pEdit = await post(s.manager, `/api/purchases/${pur.body.id}/edit`, { partyId: s.supplier, reason: "Wrong rate", lines: [{ variationId: s.v10, quantity: 800, price: 61, note: "rate fixed" }] });
    expect(pEdit.status).toBe(201);
    const rev = await prisma.purchase.findUniqueOrThrow({ where: { id: pEdit.body.id }, include: { lines: true } });
    expect(rev.total.toFixed(2)).toBe("48800.00");
    expect(rev.lines[0]).toMatchObject({ note: "rate fixed" });
    expect(await stock(s.v10)).toBe(800);
    const rolls = await prisma.measurementPiece.findMany({ where: { variationId: s.v10 }, orderBy: { code: "asc" } });
    expect(rolls.every((r) => r.purchaseId === rev.id && r.unitCost?.toFixed(2) === "61.00")).toBe(true);
    // The bill page shows the rolls on the revision.
    const view = await s.manager.get(`/api/purchases/${rev.id}`);
    expect(view.body.document.lines[0].pieces).toHaveLength(2);

    // Sale cut from the first roll, then re-priced.
    const sale = await post(s.manager, "/api/sales", { partyId: s.customer, lines: [{ variationId: s.v10, quantity: 120, price: 72, pieceId: rolls[0]!.id }] });
    expect(sale.status).toBe(201);
    expect(await stock(s.v10)).toBe(680);
    const sEdit = await post(s.manager, `/api/sales/${sale.body.id}/edit`, { partyId: s.customer, reason: "Discount agreed", paymentMode: "CASH", lines: [{ variationId: s.v10, price: 70, discount: 100 }] });
    expect(sEdit.status).toBe(201);
    const sRev = await prisma.sale.findUniqueOrThrow({ where: { id: sEdit.body.id } });
    expect(sRev.total.toFixed(2)).toBe("8300.00");
    expect(sRev.saleDate.getTime()).toBe((await prisma.sale.findUniqueOrThrow({ where: { id: sale.body.id } })).saleDate.getTime());
    expect(await stock(s.v10)).toBe(680);
    expect((await s.manager.get(`/api/sales/${sRev.id}`)).body.document.lines[0].pieces).toHaveLength(1);

    // Edit again (R2), then cancel it: the cut length comes back (as a new cut piece of that roll).
    const sEdit2 = await post(s.manager, `/api/sales/${sRev.id}/edit`, { partyId: s.customer, reason: "Rate again", lines: [{ variationId: s.v10, quantity: 120, price: 71 }] });
    expect(sEdit2.status).toBe(201);
    expect((await post(s.manager, `/api/sales/${sEdit2.body.id}/void`, { reason: "Returned" })).status).toBe(200);
    expect(await stock(s.v10)).toBe(800);
    const back = await prisma.measurementPiece.findFirstOrThrow({ where: { parentId: rolls[0]!.id, status: "ACTIVE" } });
    expect(Number(back.remainingLength)).toBe(120);

    const drift = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM stock_balance_drift WHERE company_id = ${s.co.id}`;
    expect(Number(drift[0]!.n)).toBe(0);
  });

  it("re-prices a set sale; the sets follow the revision and come back when it is cancelled", async () => {
    const s = await setup();
    const hook = await post(s.admin, "/api/products", { productType: "simple", name: "Hook", unit: "Nos", shortName: `HK${s.tag}` });
    const g = await post(s.admin, "/api/products", {
      productType: "grouped",
      name: "Rope Sling",
      shortName: `RS${s.tag}`,
      main: { name: "Sling Eye", shortName: `SE${s.tag}`, unit: "Nos" },
      byproducts: [{ productId: s.rope.id, required: true }, { productId: hook.body.product.id, required: false }],
    });
    expect(g.status).toBe(201);
    const [linkRope] = g.body.product.grouped.byproducts;
    const setV = g.body.product.variations[0].id as string;
    const opening = await post(s.admin, "/api/sets/opening", { groupId: g.body.product.id, sets: [{ rate: 5000, parts: [{ byproductId: linkRope.id, variationId: s.v8, length: 4 }] }] });
    expect(opening.status).toBe(201);
    const set = opening.body.sets[0] as { id: string };
    const sale = await post(s.manager, "/api/sales", { partyId: s.customer, lines: [{ variationId: setV, price: 9000, saleSets: [{ setId: set.id }] }] });
    expect(sale.status).toBe(201);

    const edit = await post(s.manager, `/api/sales/${sale.body.id}/edit`, { partyId: s.customer, reason: "Wrong price", lines: [{ variationId: setV, quantity: 1, price: 8500 }] });
    expect(edit.status).toBe(201);
    expect((await prisma.groupSet.findUniqueOrThrow({ where: { id: set.id } })).saleId).toBe(edit.body.id);
    expect((await s.manager.get(`/api/sales/${edit.body.id}`)).body.document.lines[0].sets).toHaveLength(1);

    expect((await post(s.manager, `/api/sales/${edit.body.id}/void`, { reason: "Returned" })).status).toBe(200);
    expect((await prisma.groupSet.findUniqueOrThrow({ where: { id: set.id } })).status).toBe("IN_STOCK");
    expect(await stock(s.v8)).toBe(4);
  });

  it("re-prices a purchase of sets and rolls; sets and rolls take the new cost; the revision cancels cleanly", async () => {
    const s = await setup();
    const g = await post(s.admin, "/api/products", {
      productType: "grouped",
      name: "Rope Sling",
      shortName: `RS${s.tag}`,
      main: { name: "Sling Eye", shortName: `SE${s.tag}`, unit: "Nos" },
      byproducts: [{ productId: s.rope.id, required: true }],
    });
    const [linkRope] = g.body.product.grouped.byproducts;
    const setV = g.body.product.variations[0].id as string;
    const pur = await post(s.manager, "/api/purchases", {
      partyId: s.supplier,
      lines: [
        { variationId: setV, price: 6000, sets: [{ parts: [{ byproductId: linkRope.id, variationId: s.v8, length: 4 }] }] },
        { variationId: s.v10, price: 58, rolls: [{ length: 200 }] },
      ],
    });
    expect(pur.status).toBe(201);
    const edit = await post(s.manager, `/api/purchases/${pur.body.id}/edit`, {
      partyId: s.supplier,
      reason: "Bill rates",
      lines: [{ variationId: setV, quantity: 1, price: 6500 }, { variationId: s.v10, quantity: 200, price: 60 }],
    });
    expect(edit.status).toBe(201);
    const set = await prisma.groupSet.findFirstOrThrow({ where: { groupId: g.body.product.id } });
    expect([set.purchaseId, set.rate.toFixed(2)]).toEqual([edit.body.id, "6500.00"]);
    const roll = await prisma.measurementPiece.findFirstOrThrow({ where: { variationId: s.v10 } });
    expect([roll.purchaseId, roll.unitCost?.toFixed(2)]).toEqual([edit.body.id, "60.00"]);
    expect(await stock(s.v10)).toBe(200);

    expect((await post(s.manager, `/api/purchases/${edit.body.id}/void`, { reason: "Wrong supplier" })).status).toBe(200);
    expect(await stock(s.v10)).toBe(0);
    expect(await stock(s.v8)).toBe(0);
    expect((await prisma.groupSet.findUniqueOrThrow({ where: { id: set.id } })).status).toBe("CANCELLED");
  });

  it("refuses to bring measured items into a Simple / Variable document by editing", async () => {
    const s = await setup();
    const nut = await post(s.admin, "/api/products", { productType: "simple", name: "Nut", unit: "Nos", shortName: `NT${s.tag}` });
    const nv = nut.body.product.variations[0].id as string;
    await post(s.manager, "/api/purchases", { partyId: s.supplier, lines: [{ variationId: nv, quantity: 10, price: 5 }] });
    const sale = await post(s.manager, "/api/sales", { lines: [{ variationId: nv, quantity: 2, price: 9 }] });
    const res = await post(s.manager, `/api/sales/${sale.body.id}/edit`, { reason: "Add rope", lines: [{ variationId: nv, quantity: 2, price: 9 }, { variationId: s.v8, quantity: 1, price: 70 }] });
    expect(res.body.error.code).toBe("ITEM_NEEDS_NEW_DOCUMENT");
  });
});

describe("P1: rename an attribute or a value", () => {
  it("renames a value and an attribute everywhere, regenerating only generated codes; bills keep their snapshot", async () => {
    const s = await setup();
    const p = await post(s.manager, "/api/products", {
      productType: "variable",
      name: "Shackle",
      unit: "Nos",
      baseShortName: `SH${s.tag}`,
      attributes: [{ name: "Colur", values: ["Redd", "Blue"] }],
      variations: [{ attributes: { Colur: "Redd" } }, { attributes: { Colur: "Blue" }, shortName: `MYCODE${s.tag}` }],
    });
    expect(p.status).toBe(201);
    const red = p.body.product.variations.find((v: { attributes: Record<string, string> }) => v.attributes.Colur === "Redd");
    const blue = p.body.product.variations.find((v: { attributes: Record<string, string> }) => v.attributes.Colur === "Blue");
    await post(s.manager, "/api/purchases", { partyId: s.supplier, lines: [{ variationId: red.id, quantity: 5, price: 10 }] });
    const sale = await post(s.manager, "/api/sales", { lines: [{ variationId: red.id, quantity: 1, price: 20 }] });

    const value = await post(s.manager, `/api/products/${p.body.product.id}/attributes/rename`, { attribute: "Colur", value: "Redd", newValue: "Red" });
    expect(value.status).toBe(200);
    expect(value.body.variationsChanged).toBe(1);
    expect(await post(s.manager, `/api/products/${p.body.product.id}/attributes/rename`, { attribute: "Colur", value: "Red", newValue: "blue" }).then((r) => r.body.error.code)).toBe("VALUE_EXISTS");

    const name = await post(s.manager, `/api/products/${p.body.product.id}/attributes/rename`, { attribute: "Colur", newName: "Colour" });
    expect(name.status).toBe(200);
    expect(name.body.variationsChanged).toBe(2);
    const after = await prisma.productVariation.findMany({ where: { groupId: p.body.product.id }, orderBy: { sortOrder: "asc" } });
    expect(after.map((v) => v.attributes)).toEqual([{ Colour: "Red" }, { Colour: "Blue" }]);
    expect(after.map((v) => v.attributeKey)).toEqual(["Colour=Red", "Colour=Blue"]);
    expect(after[0]!.shortName).not.toBe(red.shortName);
    expect(after[0]!.shortName).toContain("RED");
    expect(after[1]!.shortName).toBe(blue.shortName); // typed by hand: kept
    const group = await prisma.productGroup.findUniqueOrThrow({ where: { id: p.body.product.id } });
    expect(group.attributeDefinitions).toMatchObject([{ name: "Colour", values: ["Red", "Blue"] }]);

    const line = await prisma.saleLine.findFirstOrThrow({ where: { saleId: sale.body.id } });
    expect(line.attributesSnapshot).toEqual({ Colur: "Redd" });
    expect(line.shortNameSnapshot).toBe(red.shortName);
    // The old name is gone: new variations use the new one.
    const add = await post(s.manager, `/api/products/${p.body.product.id}/variations`, { variations: [{ attributes: { Colur: "Blue" } }] });
    expect(add.body.error?.code).toBe("UNKNOWN_ATTRIBUTE");
  });
});

describe("P2: delete what was never used", () => {
  it("deletes an unused variation and product; refuses used ones with what uses them", async () => {
    const s = await setup();
    const usage = await s.manager.get(`/api/products/${s.rope.id}/usage`);
    expect(usage.body.product.unused).toBe(true);

    await post(s.manager, `/api/measure/variations/${s.v10}/rolls`, { rolls: [{ length: 100 }] });
    const used = await del(s.manager, `/api/products/${s.rope.id}/variations/${s.v10}`);
    expect(used.status).toBe(409);
    expect(used.body.error.code).toBe("IN_USE");
    expect(used.body.error.message).toContain("1 roll");

    const ok = await del(s.manager, `/api/products/${s.rope.id}/variations/${s.v8}`);
    expect(ok.status).toBe(200);
    expect(await prisma.productVariation.count({ where: { id: s.v8 } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { action: "VARIATION_DELETE", entityId: s.v8 } })).toBe(1);
    // The last variation goes with the product, which is used.
    expect((await del(s.manager, `/api/products/${s.rope.id}/variations/${s.v10}`)).body.error.code).toBe("LAST_VARIATION");
    expect((await del(s.manager, `/api/products/${s.rope.id}`)).body.error.code).toBe("IN_USE");

    const extra = await post(s.manager, "/api/products", { productType: "simple", name: "Typo Product", unit: "Nos", shortName: `TP${s.tag}` });
    const staff = await signIn((await makeUser(s.co.id, "sales_staff")).email);
    expect((await del(staff, `/api/products/${extra.body.product.id}`)).status).toBe(403);
    expect((await del(s.manager, `/api/products/${extra.body.product.id}`)).status).toBe(200);
    expect(await prisma.productGroup.count({ where: { id: extra.body.product.id } })).toBe(0);
  });

  it("deletes an unused grouped product with its main component; refuses a by-product of a set", async () => {
    const s = await setup();
    const g = await post(s.admin, "/api/products", {
      productType: "grouped",
      name: "Sling",
      shortName: `SL${s.tag}`,
      main: { name: "Eye", shortName: `EY${s.tag}`, unit: "Nos" },
      byproducts: [{ productId: s.rope.id, required: true }],
    });
    expect(g.status).toBe(201);
    expect((await del(s.manager, `/api/products/${s.rope.id}`)).body.error.code).toBe("IN_SET");
    expect((await del(s.manager, `/api/products/${g.body.product.id}`)).status).toBe(200);
    expect(await prisma.productGroup.count({ where: { id: { in: [g.body.product.id, g.body.product.grouped.main.productId] } } })).toBe(0);
    expect((await del(s.manager, `/api/products/${s.rope.id}`)).status).toBe(200);
  });
});
