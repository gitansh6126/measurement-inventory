import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// V3.1 set by-product backorder (owner 2026-10-24): a set whose chain no free bundle has is held on
// a customer order with the chain on backorder; the order's shortage report lists the bundle to
// buy; a purchase order from the purchase cart (lines linked to the sale-order line) covers it; the
// set is delivered once the bundle is received.

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);

describe("grouped set by-product backorder", () => {
  it("holds the set, reports the bundle to buy, links the purchase order and delivers after receipt", async () => {
    const co = await makeCompany();
    const admin = await signIn((await makeUser(co.id, "admin")).email);
    const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
    const tag = co.id.slice(-4).toUpperCase();
    const chain = await post(admin, "/api/products", {
      productType: "measured",
      name: "Load Chain",
      baseShortName: `LC${tag}`,
      attributes: [{ name: "Size", unit: "", values: ["3 mm", "8 mm"] }],
      variations: [{ attributes: { Size: "3 mm" } }, { attributes: { Size: "8 mm" } }],
      measure: { lengthUnit: "m", rollName: "Bundle" },
    });
    expect(chain.status).toBe(201);
    const g = await post(admin, "/api/products", {
      productType: "grouped",
      name: "Chain Hoist",
      shortName: `CH${tag}`,
      main: { name: "Hoist Body", shortName: `HB${tag}`, unit: "Nos" },
      byproducts: [{ productId: chain.body.product.id, required: true }],
    });
    expect(g.status).toBe(201);
    const [linkChain] = g.body.product.grouped.byproducts;
    const c3 = linkChain.variations[0].id as string;
    const c8 = linkChain.variations[1].id as string;
    const setV = g.body.product.variations[0].id as string;
    const opening = await post(admin, "/api/sets/opening", { groupId: g.body.product.id, sets: [{ rate: 6200, parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }] }] });
    expect(opening.status).toBe(201);
    const setId = opening.body.sets[0].id as string;
    // Only a 50 m bundle of 8 mm chain: too short for 232 m.
    expect((await post(admin, `/api/measure/variations/${c8}/rolls`, { rolls: [{ length: 50 }] })).status).toBe(201);
    const supplier = (await post(admin, "/api/parties", { type: "SUPPLIER", name: `Chain Supplier ${tag}`, phone: "9876543210" })).body.party.id as string;
    const pick = { setId, changes: [{ byproductId: linkChain.id, action: "REPLACE", variationId: c8, length: 232, backorder: true }] };

    // A direct sale cannot cut it.
    expect((await post(manager, "/api/sales", { lines: [{ variationId: setV, price: 9000, saleSets: [pick] }] })).body.error.code).toBe("NO_PIECE_LONG_ENOUGH");

    // Customer order: the set is held with the chain on backorder.
    const order = await post(manager, "/api/orders", { kind: "SALE", status: "PLACED", lines: [{ variationId: setV, price: 9000, saleSets: [pick] }] });
    expect(order.status).toBe(201);
    const oid = order.body.id as string;
    expect((await prisma.groupSet.findUniqueOrThrow({ where: { id: setId } })).status).toBe("HELD");
    const soLineId = (await manager.get(`/api/orders/${oid}`)).body.order.lines[0].id as string;
    const report = async () => (await manager.get(`/api/orders/${oid}/shortages`)).body.shortages as { forSet: string | null; variationId: string; status: string; shortageQuantity: number; uncoveredShortageQuantity: number; orderLineId: string; linkedPOs: unknown[] }[];
    let rows = await report();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ forSet: "Chain Hoist", variationId: c8, orderLineId: soLineId, shortageQuantity: 232, uncoveredShortageQuantity: 232, status: "SHORTAGE" });

    // Delivering now fails: no bundle has 232 m yet.
    expect((await post(manager, `/api/orders/${oid}/complete`, {})).body.error.code).toBe("NO_PIECE_LONG_ENOUGH");

    // Links are checked: an unknown sale-order line, or a link on a sale order, is refused.
    expect((await post(manager, "/api/orders", { kind: "PURCHASE", partyId: supplier, lines: [{ variationId: c8, price: 120, rolls: [{ length: 250 }], linkedOrderId: oid, linkedOrderLineId: "nope" }] })).body.error.code).toBe("BAD_LINK");
    expect((await post(manager, "/api/orders", { kind: "SALE", lines: [{ variationId: c8, quantity: 1, price: 120, linkedOrderId: oid, linkedOrderLineId: soLineId }] })).body.error.code).toBe("BAD_LINK");

    // Purchase order from the purchase cart: one 250 m bundle, linked to the set line.
    const po = await post(manager, "/api/orders", { kind: "PURCHASE", status: "PLACED", partyId: supplier, lines: [{ variationId: c8, price: 120, rolls: [{ length: 250 }], linkedOrderId: oid, linkedOrderLineId: soLineId }] });
    expect(po.status).toBe(201);
    const poView = (await manager.get(`/api/orders/${po.body.id}`)).body.order;
    expect(poView.lines[0].linked).toMatchObject({ orderId: oid, orderLineId: soLineId });
    rows = await report();
    expect(rows[1]).toMatchObject({ status: "PURCHASE_PENDING", uncoveredShortageQuantity: 0 });
    expect(rows[1]!.linkedPOs).toHaveLength(1);

    // Receive the bundle: ready; deliver: the chain is cut from it and the set sold.
    expect((await post(manager, `/api/orders/${po.body.id}/complete`, {})).status).toBe(201);
    rows = await report();
    expect(rows[1]!.status).toBe("READY_TO_FULFILL");
    expect((await post(manager, `/api/orders/${oid}/complete`, {})).status).toBe(201);
    expect((await prisma.groupSet.findUniqueOrThrow({ where: { id: setId } })).status).toBe("SOLD");
    const part = await prisma.groupSetPart.findFirstOrThrow({ where: { setId, variationId: c8, status: "SOLD" } });
    expect(Number(part.quantity)).toBe(232);
  });
});
