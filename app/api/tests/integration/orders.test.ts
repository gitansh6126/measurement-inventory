import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// Sale and purchase orders (v2/docs/orders/ORDER-LIFECYCLE-PLAN.md §8).

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const put = (a: Agent, url: string, body: unknown) => a.put(url).set("Origin", ORIGIN).send(body as object);

async function setup() {
  const co = await makeCompany();
  const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
  const staff = await signIn((await makeUser(co.id, "sales_staff")).email);
  const tag = co.id.slice(-5).toUpperCase();
  const mk = async (name: string, short: string, opening: number) => {
    const p = (await post(manager, "/api/products", { productType: "simple", name, unit: "Nos", shortName: `${short}-${tag}`, officialSku: null })).body.product;
    if (opening) await post(manager, "/api/inventory/adjustments", { variationId: p.variations[0].id, type: "OPENING", quantity: opening });
    return p.variations[0].id as string;
  };
  const mkMeasured = async (name: string, short: string, rollLength = 500) => {
    const res = await post(manager, "/api/products", {
      productType: "measured",
      name,
      baseShortName: `${short}-${tag}`,
      attributes: [{ name: "Size", values: ["Default"] }],
      variations: [{ attributes: { Size: "Default" } }],
      measure: { lengthUnit: "m", rollName: "Roll", ...(rollLength > 0 ? { defaultRollLength: rollLength } : {}), decimals: 3 },
    });
    const p = res.body.product;
    const vId = p.variations[0].id as string;
    let rollId: string | null = null;
    if (rollLength > 0) {
      const add = await post(manager, `/api/measure/variations/${vId}/rolls`, { rolls: [{ length: rollLength }] });
      rollId = add.body.pieces[0].id as string;
    }
    return { productId: p.id as string, variationId: vId, rollId };
  };
  return { co, manager, staff, mk, mkMeasured };
}
const stored = async (variationId: string) => Number((await prisma.stockBalance.findUnique({ where: { variationId } }))?.quantity ?? 0);
const get = async (a: Agent, id: string) => (await a.get(`/api/orders/${id}`)).body.order;

describe("orders", () => {
  it("runs a sale order Draft → Placed → On delivery → Completed and moves stock only at the end", async () => {
    const { manager, mk } = await setup();
    const v = await mk("Pump", "P", 10);
    const created = await post(manager, "/api/orders", { kind: "SALE", lines: [{ variationId: v, quantity: 3, price: 500, discount: 100 }], expectedDate: "2026-10-20" });
    expect(created.status).toBe(201);
    let o = await get(manager, created.body.id);
    expect(o).toMatchObject({ status: "DRAFT", total: "1400.00", expectedDate: "2026-10-20", version: 1 });
    expect(o.number).toMatch(/^SO-\d{8}-001$/);
    expect(await stored(v)).toBe(10);

    expect((await post(manager, `/api/orders/${o.id}/complete`, {})).body.error.code).toBe("BAD_TRANSITION");
    expect((await post(manager, `/api/orders/${o.id}/status`, { to: "ON_DELIVERY" })).body.error.code).toBe("BAD_TRANSITION");
    expect((await post(manager, `/api/orders/${o.id}/status`, { to: "PLACED", version: 1 })).status).toBe(200);
    // Stale screen: version 1 is gone.
    expect((await put(manager, `/api/orders/${o.id}`, { notes: "x", version: 1 })).status).toBe(409);
    expect((await put(manager, `/api/orders/${o.id}`, { lines: [{ variationId: v, quantity: 4, price: 500 }], version: 2 })).status).toBe(200);
    expect((await post(manager, `/api/orders/${o.id}/status`, { to: "ON_DELIVERY", deliveryNote: "Tempo MH12 AB 1234" })).status).toBe(200);
    // Items are locked while on delivery; delivery details are not.
    expect((await put(manager, `/api/orders/${o.id}`, { lines: [{ variationId: v, quantity: 1, price: 500 }] })).body.error.code).toBe("ORDER_LOCKED");
    expect((await put(manager, `/api/orders/${o.id}`, { notes: "Call before arriving" })).status).toBe(200);
    expect(await stored(v)).toBe(10);

    const done = await post(manager, `/api/orders/${o.id}/complete`, { paymentMode: "UPI" });
    expect(done.status).toBe(201);
    expect(await stored(v)).toBe(6);
    const sale = (await manager.get(`/api/sales/${done.body.documentId}`)).body.document;
    expect(sale).toMatchObject({ total: "2000.00", payment: { mode: "UPI", status: "PAID" } });
    expect(sale.notes).toContain(o.number);
    // A second click returns the same sale and does not sell again.
    const again = await post(manager, `/api/orders/${o.id}/complete`, {});
    expect(again.status).toBe(200);
    expect(again.body.documentId).toBe(done.body.documentId);
    expect(await stored(v)).toBe(6);

    o = await get(manager, o.id);
    expect(o.status).toBe("COMPLETED");
    expect(o.document).toMatchObject({ id: done.body.documentId, cancelled: false });
    expect(o.events.map((e: { to: string }) => e.to)).toEqual(["DRAFT", "PLACED", "ON_DELIVERY", "COMPLETED"]);
    expect((await post(manager, `/api/orders/${o.id}/cancel`, { reason: "too late" })).body.error.code).toBe("ORDER_CLOSED");
  });

  it("completes a placed purchase order (counter pick-up) and lists counts per status", async () => {
    const { manager, mk } = await setup();
    const v = await mk("Valve", "V", 0);
    const a = (await post(manager, "/api/orders", { kind: "PURCHASE", status: "PLACED", lines: [{ variationId: v, quantity: 5, price: 80 }] })).body.id;
    await post(manager, "/api/orders", { kind: "PURCHASE", lines: [{ variationId: v, quantity: 1, price: 80 }] });
    const list = (await manager.get("/api/orders?kind=PURCHASE")).body;
    expect(list.counts).toMatchObject({ ALL: 2, OPEN: 2, DRAFT: 1, PLACED: 1, COMPLETED: 0 });
    expect(list.orders[0].number).toMatch(/^PO-/);
    expect((await post(manager, `/api/orders/${a}/complete`, {})).status).toBe(201);
    expect(await stored(v)).toBe(5);
    expect((await manager.get("/api/orders?kind=PURCHASE&status=COMPLETED")).body.total).toBe(1);
  });

  it("refuses a short sale at completion unless the oversell is confirmed and allowed", async () => {
    const { manager, mk } = await setup();
    const v = await mk("Hose", "H", 2);
    const id = (await post(manager, "/api/orders", { kind: "SALE", status: "PLACED", lines: [{ variationId: v, quantity: 5, price: 10 }] })).body.id;
    expect((await get(manager, id)).lines[0]).toMatchObject({ available: 2, shortage: 3 });
    const short = await post(manager, `/api/orders/${id}/complete`, {});
    expect(short.status).toBe(409);
    expect(short.body.error.code).toBe("INSUFFICIENT_STOCK");
    expect((await get(manager, id)).status).toBe("PLACED");
    expect((await post(manager, `/api/orders/${id}/complete`, { allowNegative: true })).status).toBe(201);
    expect(await stored(v)).toBe(-3);
  });

  it("applies permissions per kind and needs void rights to cancel a placed order", async () => {
    const { manager, staff, mk } = await setup();
    const v = await mk("Belt", "B", 5);
    expect((await post(staff, "/api/orders", { kind: "PURCHASE", lines: [{ variationId: v, quantity: 1, price: 1 }] })).status).toBe(403);
    expect((await staff.get("/api/orders?kind=PURCHASE")).status).toBe(403);
    const draft = (await post(staff, "/api/orders", { kind: "SALE", lines: [{ variationId: v, quantity: 1, price: 1 }] })).body.id;
    expect((await post(staff, `/api/orders/${draft}/cancel`, { reason: "no" })).status).toBe(400);
    expect((await post(staff, `/api/orders/${draft}/cancel`, { reason: "customer changed mind" })).status).toBe(200);
    const placed = (await post(staff, "/api/orders", { kind: "SALE", status: "PLACED", lines: [{ variationId: v, quantity: 1, price: 1 }] })).body.id;
    expect((await post(staff, `/api/orders/${placed}/cancel`, { reason: "customer changed mind" })).status).toBe(403);
    expect((await post(manager, `/api/orders/${placed}/cancel`, { reason: "customer changed mind" })).status).toBe(200);
    expect((await get(manager, placed))).toMatchObject({ status: "CANCELLED", cancelReason: "customer changed mind" });
    expect(await stored(v)).toBe(5);
  });

  it("is idempotent on clientRef and rejects bad lines", async () => {
    const { manager, mk } = await setup();
    const v = await mk("Nut", "N", 1);
    const clientRef = crypto.randomUUID();
    const body = { kind: "SALE", clientRef, lines: [{ variationId: v, quantity: 1, price: 5 }] };
    const first = await post(manager, "/api/orders", body);
    const second = await post(manager, "/api/orders", body);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect((await post(manager, "/api/orders", { kind: "SALE", lines: [{ variationId: v, quantity: 1, price: 5 }, { variationId: v, quantity: 2, price: 5 }] })).body.error.code).toBe("DUPLICATE_LINE");
    expect((await post(manager, "/api/orders", { kind: "SALE", lines: [{ variationId: v, quantity: 1, price: 5, discount: 6 }] })).body.error.code).toBe("DISCOUNT_TOO_LARGE");
    expect((await post(manager, "/api/orders", { kind: "SALE", lines: [] })).status).toBe(400);
  });

  it("creates, retrieves, and completes a measured sale order with preferred pieceId", async () => {
    const { manager, mkMeasured } = await setup();
    const { variationId: v, rollId } = await mkMeasured("Steel Cable", "SC", 500);
    expect(rollId).toBeTruthy();

    // 1. Create a sale order containing a Measured product with preferred pieceId
    const created = await post(manager, "/api/orders", {
      kind: "SALE",
      status: "PLACED",
      lines: [{ variationId: v, quantity: 25.5, price: 100, pieceId: rollId }],
    });
    expect(created.status).toBe(201);
    const orderId = created.body.id;

    // 2. Retrieve the order and verify measurement-specific data
    let o = await get(manager, orderId);
    expect(o.lines[0]).toMatchObject({
      variationId: v,
      quantity: 25.5,
      price: "100.00",
      lineTotal: "2550.00",
      pieceId: rollId,
    });
    expect(o.lines[0].piece).toMatchObject({ id: rollId });
    expect(o.lines[0].measure).toMatchObject({
      lengthUnit: "m",
      decimals: 1, // company length setting for metres (0029), not per product
      pieceId: rollId,
    });

    // 3. Update order item (quantity)
    const updateRes = await put(manager, `/api/orders/${orderId}`, {
      lines: [{ variationId: v, quantity: 30.25, price: 100, pieceId: rollId }],
      version: o.version,
    });
    expect(updateRes.status).toBe(200);

    o = await get(manager, orderId);
    expect(o.lines[0].quantity).toBe(30.25);
    expect(o.lines[0].lineTotal).toBe("3025.00");
    expect(o.lines[0].pieceId).toBe(rollId);

    // 4. Complete the order into a sale document
    const comp = await post(manager, `/api/orders/${orderId}/complete`, {});
    expect(comp.status).toBe(201);
    const docId = comp.body.documentId;

    // 5. Verify the sale document and piece cuts
    const sale = (await manager.get(`/api/sales/${docId}`)).body.document;
    expect(sale.lines[0]).toMatchObject({
      variationId: v,
      quantity: 30.25,
      price: "100.00",
      lineTotal: "3025.00",
    });

    // Verify piece remaining length was reduced
    const piece = await prisma.measurementPiece.findUniqueOrThrow({ where: { id: rollId! } });
    expect(Number(piece.remainingLength)).toBeCloseTo(500 - 30.25, 3);
    expect(await stored(v)).toBeCloseTo(500 - 30.25, 3);
  });

  it("creates, retrieves, and completes a measured purchase order with typed rolls", async () => {
    const { manager, mkMeasured } = await setup();
    const { variationId: v } = await mkMeasured("Nylon Rope", "NR", 0);

    // 1. Create a purchase order containing a Measured product with typed rolls
    const created = await post(manager, "/api/orders", {
      kind: "PURCHASE",
      status: "PLACED",
      lines: [
        {
          variationId: v,
          price: 50,
          rolls: [
            { length: 120.5, supplierRollNo: "SUP-A1", rack: "RACK-1" },
            { length: 80.25, supplierRollNo: "SUP-A2", rack: "RACK-2" },
          ],
        },
      ],
    });
    expect(created.status).toBe(201);
    const orderId = created.body.id;

    // 2. Retrieve order: quantity should be sum of rolls (200.75) and rolls preserved
    const o = await get(manager, orderId);
    expect(o.lines[0].quantity).toBe(200.75);
    expect(o.lines[0].lineTotal).toBe(String(Math.round(200.75 * 50)) + ".00");
    expect(o.lines[0].rolls).toHaveLength(2);
    expect(o.lines[0].rolls[0]).toMatchObject({ length: 120.5, supplierRollNo: "SUP-A1", rack: "RACK-1" });
    expect(o.lines[0].rolls[1]).toMatchObject({ length: 80.25, supplierRollNo: "SUP-A2", rack: "RACK-2" });

    // 3. Complete the purchase order into a purchase document
    const comp = await post(manager, `/api/orders/${orderId}/complete`, {});
    expect(comp.status).toBe(201);
    const docId = comp.body.documentId;

    // 4. Verify purchase document and pieces created in inventory
    const pur = (await manager.get(`/api/purchases/${docId}`)).body.document;
    expect(pur.lines[0].quantity).toBe(200.75);

    const pieces = await prisma.measurementPiece.findMany({ where: { variationId: v }, orderBy: { code: "asc" } });
    expect(pieces).toHaveLength(2);
    expect(pieces.map((p) => Number(p.originalLength)).sort((a, b) => a - b)).toEqual([80.25, 120.5]);
    expect(await stored(v)).toBe(200.75);
  });

  it("supports multiple lines for the same Measured variation and rejects duplicate counted lines", async () => {
    const { manager, mk, mkMeasured } = await setup();
    const { variationId: vMeasured } = await mkMeasured("Copper Wire", "CW", 1000);
    const vCounted = await mk("Screw", "S", 100);

    // Multiple lines for same measured variation: allowed
    const multiMeasured = await post(manager, "/api/orders", {
      kind: "SALE",
      lines: [
        { variationId: vMeasured, quantity: 10.5, price: 40 },
        { variationId: vMeasured, quantity: 20.25, price: 40 },
      ],
    });
    expect(multiMeasured.status).toBe(201);

    const o = await get(manager, multiMeasured.body.id);
    expect(o.lines).toHaveLength(2);
    expect(o.lines[0].quantity).toBe(10.5);
    expect(o.lines[1].quantity).toBe(20.25);

    // Multiple lines for same counted item: rejected with DUPLICATE_LINE
    const multiCounted = await post(manager, "/api/orders", {
      kind: "SALE",
      lines: [
        { variationId: vCounted, quantity: 2, price: 5 },
        { variationId: vCounted, quantity: 3, price: 5 },
      ],
    });
    expect(multiCounted.status).toBe(400);
    expect(multiCounted.body.error.code).toBe("DUPLICATE_LINE");
  });

  it("validates quantities according to product type (fractional allowed for measured, rejected for counted)", async () => {
    const { manager, mk, mkMeasured } = await setup();
    const vCounted = await mk("Bolt", "B", 10);
    const { variationId: vMeasured } = await mkMeasured("Chain", "CH", 100);

    // Counted item with fractional quantity: rejected
    const fracCounted = await post(manager, "/api/orders", {
      kind: "SALE",
      lines: [{ variationId: vCounted, quantity: 2.5, price: 10 }],
    });
    expect(fracCounted.status).toBe(400);
    expect(fracCounted.body.error.code).toBe("WHOLE_QUANTITY");

    // Measured item with fractional quantity: allowed
    const fracMeasured = await post(manager, "/api/orders", {
      kind: "SALE",
      lines: [{ variationId: vMeasured, quantity: 2.5, price: 10 }],
    });
    expect(fracMeasured.status).toBe(201);
  });

  it("fulfils a sale order in parts: discount shared, items locked, status rules, payment per delivery", async () => {
    const { manager, mk } = await setup();
    const v = await mk("Valve", "V", 10);
    const created = await post(manager, "/api/orders", { kind: "SALE", status: "PLACED", lines: [{ variationId: v, quantity: 3, price: 500, discount: 100 }] });
    let o = await get(manager, created.body.id);
    const lineId = o.lines[0].id as string;

    expect((await post(manager, `/api/orders/${o.id}/fulfill`, { lines: [{ orderLineId: "nope", quantity: 1 }] })).body.error.code).toBe("UNKNOWN_LINE");
    expect((await post(manager, `/api/orders/${o.id}/fulfill`, { lines: [{ orderLineId: lineId, quantity: 4 }] })).body.error.code).toBe("AMOUNT_TOO_LARGE");

    const first = await post(manager, `/api/orders/${o.id}/fulfill`, { lines: [{ orderLineId: lineId, quantity: 1 }], paymentMode: "CASH" });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ status: "PARTIALLY_FULFILLED", allCompleted: false });
    expect(await stored(v)).toBe(9);
    // 1 of 3 → a third of the 100 discount (33.33), not all of it.
    const s1 = (await manager.get(`/api/sales/${first.body.documentId}`)).body.document;
    expect(s1).toMatchObject({ total: "466.67", payment: { mode: "CASH", status: "PAID" } });

    o = await get(manager, o.id);
    expect(o.lines[0]).toMatchObject({ fulfilledQuantity: 1, outstandingQuantity: 2 });
    expect(o.documents).toHaveLength(1);
    // Delivered quantities cannot be reset by editing items or going back to Placed / Draft.
    expect((await put(manager, `/api/orders/${o.id}`, { lines: [{ variationId: v, quantity: 5, price: 500 }] })).body.error.code).toBe("ORDER_LOCKED");
    expect((await post(manager, `/api/orders/${o.id}/status`, { to: "PLACED" })).body.error.code).toBe("BAD_TRANSITION");
    expect((await post(manager, `/api/orders/${o.id}/status`, { to: "ON_DELIVERY" })).status).toBe(200);
    expect((await post(manager, `/api/orders/${o.id}/status`, { to: "PLACED" })).body.error.code).toBe("BAD_TRANSITION");
    expect((await post(manager, `/api/orders/${o.id}/status`, { to: "PARTIALLY_FULFILLED" })).status).toBe(200);

    const rest = await post(manager, `/api/orders/${o.id}/complete`, { paymentMode: "CREDIT" });
    expect(rest.status).toBe(201);
    expect(await stored(v)).toBe(7);
    const s2 = (await manager.get(`/api/sales/${rest.body.documentId}`)).body.document;
    // The two deliveries add up to the order total exactly (1400).
    expect(s2).toMatchObject({ total: "933.33", payment: { mode: "CREDIT", status: "PENDING" } });
    o = await get(manager, o.id);
    expect(o.status).toBe("COMPLETED");
    expect(o.documents.map((d: { number: string }) => d.number)).toHaveLength(2);
    expect(o.document.id).toBe(rest.body.documentId);
  });

  it("does not let a placed order with nothing fulfilled jump to Partially fulfilled", async () => {
    const { manager, mk } = await setup();
    const v = await mk("Tap", "T", 5);
    const created = await post(manager, "/api/orders", { kind: "SALE", status: "PLACED", lines: [{ variationId: v, quantity: 1, price: 100 }] });
    expect((await post(manager, `/api/orders/${created.body.id}/status`, { to: "ON_DELIVERY" })).status).toBe(200);
    expect((await post(manager, `/api/orders/${created.body.id}/status`, { to: "PARTIALLY_FULFILLED" })).body.error.code).toBe("BAD_TRANSITION");
  });

  it("cancelling the delivery of a completed order puts the stock back and reopens the order", async () => {
    const { manager, mk } = await setup();
    const v = await mk("Hoist", "H", 10);
    const created = await post(manager, "/api/orders", { kind: "SALE", status: "PLACED", lines: [{ variationId: v, quantity: 3, price: 200 }] });
    const done = await post(manager, `/api/orders/${created.body.id}/complete`, {});
    expect(done.status).toBe(201);
    expect(await stored(v)).toBe(7);

    expect((await post(manager, `/api/sales/${done.body.documentId}/void`, { reason: "Customer returned everything" })).status).toBe(200);
    expect(await stored(v)).toBe(10);
    let o = await get(manager, created.body.id);
    expect(o.status).toBe("PLACED");
    expect(o.lines[0]).toMatchObject({ fulfilledQuantity: 0, outstandingQuantity: 3 });
    expect(o.document).toBeNull();
    expect(o.documents[0]).toMatchObject({ cancelled: true, voidKind: "CANCELLED" });
    expect(o.events.at(-1)).toMatchObject({ from: "COMPLETED", to: "PLACED" });
    expect(o.events.at(-1).note).toContain("cancelled");

    // It can be delivered again.
    const again = await post(manager, `/api/orders/${o.id}/complete`, {});
    expect(again.status).toBe(201);
    expect(again.body.documentId).not.toBe(done.body.documentId);
    o = await get(manager, o.id);
    expect(o.status).toBe("COMPLETED");
    expect(o.document.id).toBe(again.body.documentId);
    expect(await stored(v)).toBe(7);
  });

  it("cancelling one of two deliveries leaves the order partially fulfilled with that part to go", async () => {
    const { manager, mk } = await setup();
    const v = await mk("Shackle", "S", 10);
    const created = await post(manager, "/api/orders", { kind: "SALE", status: "PLACED", lines: [{ variationId: v, quantity: 3, price: 50 }] });
    const lineId = (await get(manager, created.body.id)).lines[0].id;
    const first = await post(manager, `/api/orders/${created.body.id}/fulfill`, { lines: [{ orderLineId: lineId, quantity: 1 }] });
    expect((await post(manager, `/api/orders/${created.body.id}/complete`, {})).status).toBe(201);
    expect((await get(manager, created.body.id)).status).toBe("COMPLETED");

    expect((await post(manager, `/api/sales/${first.body.documentId}/void`, { reason: "Wrong item sent" })).status).toBe(200);
    const o = await get(manager, created.body.id);
    expect(o.status).toBe("PARTIALLY_FULFILLED");
    expect(o.lines[0]).toMatchObject({ fulfilledQuantity: 2, outstandingQuantity: 1 });
    expect(await stored(v)).toBe(8);
  });

  it("cancelling a purchase-order receipt takes the stock back out and reopens the purchase order", async () => {
    const { manager, mk } = await setup();
    const v = await mk("Sling", "SL", 0);
    const created = await post(manager, "/api/orders", { kind: "PURCHASE", status: "PLACED", lines: [{ variationId: v, quantity: 5, price: 80 }] });
    const done = await post(manager, `/api/orders/${created.body.id}/complete`, {});
    expect(await stored(v)).toBe(5);
    expect((await post(manager, `/api/purchases/${done.body.documentId}/void`, { reason: "Supplier took it back" })).status).toBe(200);
    expect(await stored(v)).toBe(0);
    expect((await get(manager, created.body.id)).status).toBe("PLACED");
  });

  it("an edited delivery stays linked to its order (revision carries the order line)", async () => {
    const { manager, mk } = await setup();
    const v = await mk("Chain", "C", 10);
    const created = await post(manager, "/api/orders", { kind: "SALE", status: "PLACED", lines: [{ variationId: v, quantity: 3, price: 100 }] });
    const done = await post(manager, `/api/orders/${created.body.id}/complete`, {});
    // V2: what was delivered for an order cannot change through Edit (cancel and deliver again).
    for (const lines of [[{ variationId: v, quantity: 2, price: "100" }], [{ variationId: v, quantity: 4, price: "100" }]]) {
      expect((await post(manager, `/api/sales/${done.body.documentId}/edit/preview`, { reason: "Qty", lines })).body.error.code).toBe("ORDER_QTY_LOCKED");
      expect((await post(manager, `/api/sales/${done.body.documentId}/edit`, { reason: "Qty", lines })).body.error.code).toBe("ORDER_QTY_LOCKED");
    }
    expect(await stored(v)).toBe(7);
    const edit = await post(manager, `/api/sales/${done.body.documentId}/edit`, { reason: "Price corrected", lines: [{ variationId: v, quantity: 3, price: "90" }] });
    expect(edit.status).toBe(201);
    const revision = await prisma.sale.findUniqueOrThrow({ where: { id: edit.body.id }, include: { lines: true } });
    const o = await get(manager, created.body.id);
    expect(revision.orderId).toBe(o.id);
    expect(revision.lines[0]!.orderLineId).toBe(o.lines[0].id);
    expect(o.documents.map((d: { voidKind: string | null }) => d.voidKind)).toEqual(["REPLACED", null]);
    // Same quantity: the order is still completed by the revision.
    expect(o.status).toBe("COMPLETED");
    expect(o.lines[0].fulfilledQuantity).toBe(3);
    expect(o.document.id).toBe(edit.body.id);
  });
});
