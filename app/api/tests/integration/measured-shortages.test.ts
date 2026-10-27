import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);

async function setup() {
  const co = await makeCompany();
  const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
  const tag = co.id.slice(-5).toUpperCase();

  // Create a supplier
  const suppRes = await post(manager, "/api/parties", {
    type: "SUPPLIER",
    name: `Steel Supplier ${tag}`,
    contactPerson: "Mr. Sharma",
    phone: "9876543210",
  });
  const supplierId = suppRes.body.party.id as string;

  // Create a customer
  const custRes = await post(manager, "/api/parties", {
    type: "CUSTOMER",
    name: `Builder Babu ${tag}`,
    phone: "9123456780",
  });
  const customerId = custRes.body.party.id as string;

  // Create a measured product (Steel Wire Rope)
  const prodRes = await post(manager, "/api/products", {
    productType: "measured",
    name: `Steel Wire Rope ${tag}`,
    baseShortName: `SWR-${tag}`,
    attributes: [{ name: "Diameter", values: ["10mm"] }],
    variations: [{ attributes: { Diameter: "10mm" } }],
    measure: { lengthUnit: "m", rollName: "Roll", defaultRollLength: 500, decimals: 3 },
  });
  const product = prodRes.body.product;
  const variationId = product.variations[0].id as string;

  return { co, manager, supplierId, customerId, variationId };
}

describe("measured-shortages-and-procurement", () => {
  it("enforces continuous cut, detects shortage without going negative, arranges PO, receives bundle, and fulfills order", async () => {
    const { manager, supplierId, customerId, variationId } = await setup();

    // 1. Initial stock: 1 roll of 10m
    const addRollRes = await post(manager, `/api/measure/variations/${variationId}/rolls`, {
      rolls: [{ length: 10, kind: "CLOSED" }],
    });
    expect(addRollRes.status).toBe(201);
    const piece10mId = addRollRes.body.pieces[0].id as string;

    // Check balance is exactly 10m
    const bal1 = await prisma.stockBalance.findUnique({ where: { variationId } });
    expect(Number(bal1?.quantity)).toBe(10);

    // 2. Customer needs 20m. Direct sale of 20m MUST fail (pieces cannot be joined, stock cannot be negative)
    const directSale = await post(manager, "/api/sales", {
      partyId: customerId,
      lines: [{ variationId, quantity: 20, price: 100 }],
    });
    expect(directSale.status).toBe(409);
    expect(directSale.body.error.code).toBe("NO_PIECE_LONG_ENOUGH");

    // Stock MUST still be untouched at 10m
    const balAfterFailed = await prisma.stockBalance.findUnique({ where: { variationId } });
    expect(Number(balAfterFailed?.quantity)).toBe(10);

    // 3. Customer order is placed for 20m
    const orderRes = await post(manager, "/api/orders", {
      kind: "SALE",
      status: "PLACED",
      partyId: customerId,
      lines: [{ variationId, quantity: 20, price: 100 }],
    });
    expect(orderRes.status).toBe(201);
    const saleOrderId = orderRes.body.id as string;

    // 4. Check Shortage Report for this order
    const shortageRes = await manager.get(`/api/orders/${saleOrderId}/shortages`);
    expect(shortageRes.status).toBe(200);
    const lineShortage = shortageRes.body.shortages[0];
    expect(lineShortage).toMatchObject({
      lineNo: 1,
      orderedQuantity: 20,
      fulfilledQuantity: 0,
      outstandingQuantity: 20,
      physicalStock: 10,
      availableToPromise: 10,
      shortageQuantity: 10,
      canFulfillContinuous: false,
      status: "SHORTAGE",
      coveredByPOQuantity: 0,
      uncoveredShortageQuantity: 10,
    });
    expect(lineShortage.linkedPOs).toHaveLength(0);

    // 5. Arrange Purchase Order for new bundle (500m roll) from supplier
    const saleOrderLineId = (await manager.get(`/api/orders/${saleOrderId}`)).body.order.lines[0].id as string;
    const arrangeRes = await post(manager, `/api/orders/${saleOrderId}/arrange-purchase`, {
      partyId: supplierId,
      version: 1,
      lines: [
        {
          orderLineId: saleOrderLineId,
          price: 60,
          rolls: [{ length: 500, kind: "CLOSED" }],
        },
      ],
    });
    expect(arrangeRes.status).toBe(201);
    const poId = arrangeRes.body.id as string;
    const poNumber = arrangeRes.body.number as string;

    // Verify PO was created with link to customer order
    const po = (await manager.get(`/api/orders/${poId}`)).body.order;
    expect(po.kind).toBe("PURCHASE");
    expect(po.status).toBe("PLACED");
    expect(po.lines[0].rolls).toEqual([{ length: 500, kind: "CLOSED" }]);

    // Check customer sale order has procurement event
    const soAfterPO = (await manager.get(`/api/orders/${saleOrderId}`)).body.order;
    expect(soAfterPO.events.some((e: { note: string | null }) => e.note?.includes(poNumber))).toBe(true);

    // 6. Check Shortage Report now reflects open PO coverage
    const shortageResAfterPO = await manager.get(`/api/orders/${saleOrderId}/shortages`);
    const lineShortageAfterPO = shortageResAfterPO.body.shortages[0];
    expect(lineShortageAfterPO.status).toBe("PURCHASE_PENDING");
    expect(lineShortageAfterPO.coveredByPOQuantity).toBe(500);
    expect(lineShortageAfterPO.uncoveredShortageQuantity).toBe(0);
    expect(lineShortageAfterPO.linkedPOs).toHaveLength(1);
    expect(lineShortageAfterPO.linkedPOs[0].id).toBe(poId);

    // 7. Receive supplier bundle by completing the Purchase Order
    const completePORes = await post(manager, `/api/orders/${poId}/complete`, {});
    expect(completePORes.status).toBe(201);

    // Verify physical stock increased by 500m (total now 510m)
    const balAfterPO = await prisma.stockBalance.findUnique({ where: { variationId } });
    expect(Number(balAfterPO?.quantity)).toBe(510);

    // Verify customer sale order was notified via event that procurement arrived
    const soAfterArrival = (await manager.get(`/api/orders/${saleOrderId}`)).body.order;
    expect(soAfterArrival.events.some((e: { note: string | null }) => e.note?.includes("Ready to fulfill"))).toBe(true);

    // Check Shortage Report now shows READY_TO_FULFILL
    const shortageResReady = await manager.get(`/api/orders/${saleOrderId}/shortages`);
    expect(shortageResReady.body.shortages[0].status).toBe("READY_TO_FULFILL");
    expect(shortageResReady.body.shortages[0].canFulfillContinuous).toBe(true);

    // 8. Fulfill the customer sale order (now that 500m roll is in stock!)
    const fulfillRes = await post(manager, `/api/orders/${saleOrderId}/complete`, { paymentMode: "CASH" });
    expect(fulfillRes.status).toBe(201);

    // Verify customer order is COMPLETED
    const soFinal = (await manager.get(`/api/orders/${saleOrderId}`)).body.order;
    expect(soFinal.status).toBe("COMPLETED");
    expect(soFinal.document).toBeDefined();

    // Verify final physical stock: 510m - 20m = 490m!
    const balFinal = await prisma.stockBalance.findUnique({ where: { variationId } });
    expect(Number(balFinal?.quantity)).toBe(490);

    // Verify active physical pieces:
    // Original 10m roll is untouched (ACTIVE, remaining 10m).
    // The 500m roll was cut: now remaining 480m (OPEN).
    const pieces = await prisma.measurementPiece.findMany({
      where: { variationId, status: "ACTIVE" },
      orderBy: { remainingLength: "asc" },
    });
    expect(pieces).toHaveLength(2);
    expect(Number(pieces[0]!.remainingLength)).toBe(10);
    expect(Number(pieces[1]!.remainingLength)).toBe(480);
    expect(pieces[1]!.kind).toBe("OPEN");
  });

  it("supports partial fulfillment of order lines with PARTIALLY_FULFILLED status", async () => {
    const { manager, customerId, variationId } = await setup();

    // Add 1 roll of 30m
    await post(manager, `/api/measure/variations/${variationId}/rolls`, {
      rolls: [{ length: 30, kind: "CLOSED" }],
    });

    // Customer places order for 25m
    const orderRes = await post(manager, "/api/orders", {
      kind: "SALE",
      status: "PLACED",
      partyId: customerId,
      lines: [{ variationId, quantity: 25, price: 100 }],
    });
    const orderId = orderRes.body.id as string;
    const lineId = (await manager.get(`/api/orders/${orderId}`)).body.order.lines[0].id as string;

    // Customer takes 10m first (partial fulfillment)
    const partialRes = await post(manager, `/api/orders/${orderId}/fulfill`, {
      version: 1,
      paymentMode: "CASH",
      lines: [{ orderLineId: lineId, quantity: 10 }],
    });
    expect(partialRes.status).toBe(201);
    expect(partialRes.body.status).toBe("PARTIALLY_FULFILLED");
    expect(partialRes.body.allCompleted).toBe(false);

    // Check order state
    const orderPartial = (await manager.get(`/api/orders/${orderId}`)).body.order;
    expect(orderPartial.status).toBe("PARTIALLY_FULFILLED");
    expect(orderPartial.lines[0].fulfilledQuantity).toBe(10);
    expect(orderPartial.lines[0].outstandingQuantity).toBe(15);
    // document_id is NULL while partially fulfilled (per check constraint)
    expect(orderPartial.document).toBeNull();

    // Check stock: 30 - 10 = 20m remaining
    const balPartial = await prisma.stockBalance.findUnique({ where: { variationId } });
    expect(Number(balPartial?.quantity)).toBe(20);

    // Customer comes back for the remaining 15m
    const finalRes = await post(manager, `/api/orders/${orderId}/fulfill`, {
      version: 2,
      paymentMode: "CASH",
      lines: [{ orderLineId: lineId, quantity: 15 }],
    });
    expect(finalRes.status).toBe(201);
    expect(finalRes.body.status).toBe("COMPLETED");
    expect(finalRes.body.allCompleted).toBe(true);

    const orderFinal = (await manager.get(`/api/orders/${orderId}`)).body.order;
    expect(orderFinal.status).toBe("COMPLETED");
    expect(orderFinal.document).toBeDefined();
    expect(orderFinal.lines[0].fulfilledQuantity).toBe(25);
    expect(orderFinal.lines[0].outstandingQuantity).toBe(0);

    // Check final stock: 20 - 15 = 5m remaining
    const balFinal = await prisma.stockBalance.findUnique({ where: { variationId } });
    expect(Number(balFinal?.quantity)).toBe(5);
  });

  it("prevents double-allocation across multiple customer orders on the same piece", async () => {
    const { manager, customerId, variationId } = await setup();

    // Add 1 roll of 15m
    const addRollRes = await post(manager, `/api/measure/variations/${variationId}/rolls`, {
      rolls: [{ length: 15, kind: "CLOSED" }],
    });
    const pieceId = addRollRes.body.pieces[0].id as string;

    // Order 1 claims 10m on pieceId
    const order1 = await post(manager, "/api/orders", {
      kind: "SALE",
      status: "PLACED",
      partyId: customerId,
      lines: [{ variationId, quantity: 10, price: 100, pieceId }],
    });
    expect(order1.status).toBe(201);

    // Order 2 needs 10m of the same variation
    const order2 = await post(manager, "/api/orders", {
      kind: "SALE",
      status: "PLACED",
      partyId: customerId,
      lines: [{ variationId, quantity: 10, price: 100 }],
    });
    expect(order2.status).toBe(201);
    const order2Id = order2.body.id as string;

    // Check shortage report for Order 2:
    // Physical stock is 15m, but 10m is allocated to Order 1.
    // ATP is 5m. Order 2 needs 10m -> Shortage is 5m, canFulfillContinuous = false!
    const sh2 = await manager.get(`/api/orders/${order2Id}/shortages`);
    expect(sh2.body.shortages[0]).toMatchObject({
      physicalStock: 15,
      allocatedQuantity: 10,
      availableToPromise: 5,
      shortageQuantity: 5,
      canFulfillContinuous: false,
      status: "SHORTAGE",
    });
  });
});
