import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// V3.1 basic warehousing (docs\WAREHOUSE-V3-PLAN.md §5 tests 1–9, GW-1…GW-6): warehousing off,
// the first warehouse, line splits, Stock In per warehouse, shifts and cancels, sets and rolls.

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);

async function setup() {
  const co = await makeCompany();
  const admin = await signIn((await makeUser(co.id, "admin")).email);
  const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
  const staff = await signIn((await makeUser(co.id, "sales_staff")).email);
  const tag = co.id.slice(-4).toUpperCase();
  const bolt = (await post(admin, "/api/products", { productType: "simple", name: "Bolt", unit: "Nos", shortName: `BT${tag}` })).body.product;
  const chain = (
    await post(admin, "/api/products", {
      productType: "measured",
      name: "Load Chain",
      baseShortName: `LC${tag}`,
      attributes: [{ name: "Size", unit: "", values: ["6 mm"] }],
      variations: [{ attributes: { Size: "6 mm" } }],
      measure: { lengthUnit: "m", rollName: "Roll" },
    })
  ).body.product;
  return { co, admin, manager, staff, tag, bolt: bolt.variations[0].id as string, chain: chain.variations[0].id as string };
}

const wh = async (variationId: string) =>
  Object.fromEntries(
    (await prisma.warehouseStockBalance.findMany({ where: { variationId } })).map((b) => [b.warehouseId, Number(b.quantity)]),
  );
const total = async (variationId: string) => Number((await prisma.stockBalance.findUnique({ where: { variationId } }))?.quantity ?? 0);
const drift = async (companyId: string) => {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT (SELECT COUNT(*) FROM warehouse_total_drift WHERE company_id = ${companyId})
         + (SELECT COUNT(*) FROM warehouse_balance_drift d JOIN warehouses x ON x.id = d.warehouse_id WHERE x.company_id = ${companyId}) AS n`;
  return Number(rows[0]!.n);
};

/** Stock before warehousing, then W1 (takes it all) and an empty W2. */
async function twoWarehouses(s: Awaited<ReturnType<typeof setup>>) {
  await post(s.admin, "/api/inventory/adjustments", { variationId: s.bolt, type: "OPENING", quantity: 10 });
  await post(s.manager, `/api/measure/variations/${s.chain}/rolls`, { rolls: [{ length: 50 }, { length: 30 }] });
  const w1 = await post(s.admin, "/api/warehouses", { code: "w1", name: "Main Godown" });
  expect(w1.status).toBe(201);
  expect(w1.body.warehousingEnabled).toBe(true);
  const w2 = await post(s.admin, "/api/warehouses", { code: "W2", name: "Shop" });
  expect(w2.status).toBe(201);
  expect(w2.body.warehousingEnabled).toBe(false);
  return { w1: w1.body.warehouse.id as string, w2: w2.body.warehouse.id as string };
}

describe("warehouses", () => {
  it("off: nothing about warehouses; stock works as before (WH-0)", async () => {
    const s = await setup();
    const list = await s.staff.get("/api/warehouses");
    expect(list.body).toEqual({ enabled: false, warehouses: [] });
    await post(s.admin, "/api/inventory/adjustments", { variationId: s.bolt, type: "OPENING", quantity: 5 });
    expect((await post(s.manager, "/api/sales", { lines: [{ variationId: s.bolt, quantity: 2, price: 10 }] })).status).toBe(201);
    expect(await total(s.bolt)).toBe(3);
    const inv = (await s.staff.get(`/api/inventory/products/${(await prisma.productVariation.findUniqueOrThrow({ where: { id: s.bolt } })).groupId}`)).body.product;
    expect(inv.variations[0].byWarehouse).toBeNull();
    // Naming a warehouse while off is refused; a movement with one is refused by the database.
    expect((await post(s.manager, "/api/sales", { lines: [{ variationId: s.bolt, quantity: 1, price: 10, splits: [{ warehouseId: "x", quantity: 1 }] }] })).body.error.code).toBe("WAREHOUSING_OFF");
    expect((await post(s.manager, "/api/transfers", { fromWarehouseId: "a", toWarehouseId: "b", lines: [{ variationId: s.bolt, quantity: 1 }] })).body.error.code).toBe("WAREHOUSING_OFF");
  });

  it("the first warehouse takes all stock, rolls and sets; later ones start empty (WH-1, GW-6)", async () => {
    const s = await setup();
    expect((await post(s.manager, "/api/warehouses", { code: "W1", name: "Main" })).status).toBe(403);
    const { w1, w2 } = await twoWarehouses(s);
    expect(await wh(s.bolt)).toEqual({ [w1]: 10 });
    expect(await wh(s.chain)).toEqual({ [w1]: 80 });
    expect(await prisma.measurementPiece.count({ where: { variationId: s.chain, warehouseId: w1 } })).toBe(2);
    expect(await prisma.stockMovement.count({ where: { companyId: s.co.id, warehouseId: null } })).toBe(0);
    expect(await drift(s.co.id)).toBe(0);
    const list = (await s.staff.get("/api/warehouses")).body;
    expect(list.enabled).toBe(true);
    expect(list.warehouses.map((w: { code: string; isDefault: boolean; items: number }) => [w.code, w.isDefault, w.items])).toEqual([
      ["W1", true, 2],
      ["W2", false, 0],
    ]);
    // Code and name are unique (name ignoring case).
    expect((await post(s.admin, "/api/warehouses", { code: "W3", name: "shop" })).body.error.code).toBe("DUPLICATE_WAREHOUSE");
    expect((await post(s.admin, "/api/warehouses", { code: "w2", name: "Other" })).body.error.code).toBe("DUPLICATE_WAREHOUSE");
    expect(w2).toBeTruthy();
    // Movements are still append-only, and now must name a warehouse (trigger).
    await expect(prisma.stockMovement.updateMany({ where: { companyId: s.co.id }, data: { reason: "x" } })).rejects.toThrow(/append-only/);
    await expect(
      prisma.stockMovement.create({ data: { companyId: s.co.id, variationId: s.bolt, movementType: "ADJUSTMENT", quantity: 1, unit: "Nos", reason: "raw" } }),
    ).rejects.toThrow(/WAREHOUSE_REQUIRED/);
  });

  it("purchase split, sale auto-pick and splits, warehouse shortage, void per warehouse (WH-5…WH-7)", async () => {
    const s = await setup();
    const { w1, w2 } = await twoWarehouses(s);
    // Purchase: 3 → W1, 2 → W2; a split that does not add up is refused.
    expect(
      (await post(s.manager, "/api/purchases", { lines: [{ variationId: s.bolt, quantity: 5, price: 7, splits: [{ warehouseId: w1, quantity: 3 }, { warehouseId: w2, quantity: 1 }] }] })).body.error.code,
    ).toBe("SPLIT_TOTAL");
    const pur = await post(s.manager, "/api/purchases", { lines: [{ variationId: s.bolt, quantity: 5, price: 7, splits: [{ warehouseId: w1, quantity: 3 }, { warehouseId: w2, quantity: 2 }] }] });
    expect(pur.status).toBe(201);
    expect(await wh(s.bolt)).toEqual({ [w1]: 13, [w2]: 2 });
    // "Receive into" W2 for a whole purchase.
    await post(s.manager, "/api/purchases", { warehouseId: w2, lines: [{ variationId: s.bolt, quantity: 4, price: 7 }] });
    expect(await wh(s.bolt)).toEqual({ [w1]: 13, [w2]: 6 });

    // Sale without a split: the default warehouse first, then the rest by stock.
    const sale = await post(s.staff, "/api/sales", { lines: [{ variationId: s.bolt, quantity: 15, price: 10 }] });
    expect(sale.status).toBe(201);
    expect(await wh(s.bolt)).toEqual({ [w1]: 0, [w2]: 4 });
    // W1 is empty while the company still has 4: a split taking from W1 is refused (WH-6a).
    const short = await post(s.staff, "/api/sales", { allowNegative: true, lines: [{ variationId: s.bolt, quantity: 2, price: 10, splits: [{ warehouseId: w1, quantity: 2 }] }] });
    expect(short.status).toBe(409);
    expect(short.body.error.code).toBe("WAREHOUSE_SHORT");
    expect(short.body.error.details[0]).toMatchObject({ warehouseCode: "W1", available: 0, requested: 2, otherWarehouses: [{ code: "W2", quantity: 4 }] });
    // Company short too: Warn & Allow, the uncovered part goes below zero in the picked warehouse.
    const over = await post(s.staff, "/api/sales", { allowNegative: true, lines: [{ variationId: s.bolt, quantity: 6, price: 10 }] });
    expect(over.status).toBe(201);
    expect(await wh(s.bolt)).toEqual({ [w1]: 0, [w2]: -2 });
    expect(await total(s.bolt)).toBe(-2);

    // Void reverses each warehouse's part where it was taken.
    expect((await post(s.manager, `/api/sales/${sale.body.id}/void`, { reason: "Wrong customer" })).status).toBe(200);
    expect(await wh(s.bolt)).toEqual({ [w1]: 13, [w2]: 0 });
    expect(await drift(s.co.id)).toBe(0);
  });

  it("measured rolls keep their warehouse: per-roll receipt, sale from the piece, void back (WH-5, WH-11)", async () => {
    const s = await setup();
    const { w1, w2 } = await twoWarehouses(s);
    const pur = await post(s.manager, "/api/purchases", { warehouseId: w2, lines: [{ variationId: s.chain, price: 100, rolls: [{ length: 20 }, { length: 10, warehouseId: w1 }] }] });
    expect(pur.status).toBe(201);
    expect(await wh(s.chain)).toEqual({ [w1]: 90, [w2]: 20 });
    const w2Roll = await prisma.measurementPiece.findFirstOrThrow({ where: { variationId: s.chain, warehouseId: w2 } });
    const sale = await post(s.staff, "/api/sales", { lines: [{ variationId: s.chain, quantity: 5, price: 120, pieceId: w2Roll.id }] });
    expect(sale.status).toBe(201);
    expect(await wh(s.chain)).toEqual({ [w1]: 90, [w2]: 15 });
    await post(s.manager, `/api/sales/${sale.body.id}/void`, { reason: "Returned" });
    expect(await wh(s.chain)).toEqual({ [w1]: 90, [w2]: 20 });
    expect(await drift(s.co.id)).toBe(0);
  });

  it("Stock In edits one warehouse per row; opening once per warehouse (WH-12)", async () => {
    const s = await setup();
    const { w1, w2 } = await twoWarehouses(s);
    const res = await post(s.manager, "/api/inventory/stock-in", {
      reason: "Opening Stock",
      rows: [
        { variationId: s.bolt, warehouseId: w1, expectedQuantity: 10, quantity: 12 },
        { variationId: s.bolt, warehouseId: w2, expectedQuantity: 0, quantity: 4 },
      ],
    });
    expect(res.status).toBe(200);
    expect(await wh(s.bolt)).toEqual({ [w1]: 12, [w2]: 4 });
    expect(await prisma.stockMovement.count({ where: { variationId: s.bolt, warehouseId: w2, movementType: "OPENING" } })).toBe(1);
    const again = await post(s.admin, "/api/inventory/adjustments", { variationId: s.bolt, type: "OPENING", quantity: 1, warehouseId: w2 });
    expect(again.body.error.code).toBe("OPENING_EXISTS");
    // The row's expected stock is that warehouse's.
    const stale = await post(s.manager, "/api/inventory/stock-in", { reason: "Count", rows: [{ variationId: s.bolt, warehouseId: w2, expectedQuantity: 10, quantity: 1 }] });
    expect(stale.body.error.code).toBe("STOCK_CHANGED");
    const inv = (await s.staff.get(`/api/inventory/products/${(await prisma.productVariation.findUniqueOrThrow({ where: { id: s.bolt } })).groupId}`)).body.product;
    expect(inv.variations[0].byWarehouse.map((w: { code: string; quantity: number }) => [w.code, w.quantity])).toEqual([
      ["W1", 12],
      ["W2", 4],
    ]);
  });

  it("shifts counted stock and whole rolls; refuses over-quantity, same or inactive warehouse; cancels (WH-9…WH-11)", async () => {
    const s = await setup();
    const { w1, w2 } = await twoWarehouses(s);
    const roll = await prisma.measurementPiece.findFirstOrThrow({ where: { variationId: s.chain, originalLength: 50 } });
    expect((await post(s.staff, "/api/transfers", { fromWarehouseId: w1, toWarehouseId: w2, lines: [{ variationId: s.bolt, quantity: 1 }] })).status).toBe(403);
    expect((await post(s.manager, "/api/transfers", { fromWarehouseId: w1, toWarehouseId: w1, lines: [{ variationId: s.bolt, quantity: 1 }] })).body.error.code).toBe("SAME_WAREHOUSE");
    const tooMuch = await post(s.manager, "/api/transfers", { fromWarehouseId: w1, toWarehouseId: w2, lines: [{ variationId: s.bolt, quantity: 11 }] });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe("WAREHOUSE_SHORT");
    expect((await post(s.manager, "/api/transfers", { fromWarehouseId: w1, toWarehouseId: w2, lines: [{ variationId: s.chain, quantity: 5 }] })).body.error.code).toBe("MEASURED_BY_PIECE");

    const t = await post(s.manager, "/api/transfers", {
      fromWarehouseId: w1,
      toWarehouseId: w2,
      notes: "Shop restock",
      lines: [{ variationId: s.bolt, quantity: 4 }, { pieceId: roll.id }],
    });
    expect(t.status).toBe(201);
    expect(t.body.transfer).toMatchObject({ number: expect.stringMatching(/^TRF-\d{8}-001$/), status: "DONE", from: { code: "W1" }, to: { code: "W2" } });
    expect(await wh(s.bolt)).toEqual({ [w1]: 6, [w2]: 4 });
    expect(await wh(s.chain)).toEqual({ [w1]: 30, [w2]: 50 });
    expect(await total(s.bolt)).toBe(10);
    expect((await prisma.measurementPiece.findUniqueOrThrow({ where: { id: roll.id } })).warehouseId).toBe(w2);
    expect(await drift(s.co.id)).toBe(0);

    // A roll already shifted is not in W1 any more.
    expect((await post(s.manager, "/api/transfers", { fromWarehouseId: w1, toWarehouseId: w2, lines: [{ pieceId: roll.id }] })).body.error.code).toBe("PIECE_NOT_IN_WAREHOUSE");

    // Cancel: back to W1. Twice → 409.
    const c = await post(s.manager, `/api/transfers/${t.body.transfer.id}/cancel`, { reason: "Wrong shop" });
    expect(c.status).toBe(200);
    expect(c.body.transfer.status).toBe("CANCELLED");
    expect(await wh(s.bolt)).toEqual({ [w1]: 10, [w2]: 0 });
    expect(await wh(s.chain)).toEqual({ [w1]: 80, [w2]: 0 });
    expect((await post(s.manager, `/api/transfers/${t.body.transfer.id}/cancel`, { reason: "again" })).body.error.code).toBe("ALREADY_VOID");

    // Cancel after the stock was sold from W2 → 409.
    const t2 = await post(s.manager, "/api/transfers", { fromWarehouseId: w1, toWarehouseId: w2, lines: [{ variationId: s.bolt, quantity: 3 }] });
    await post(s.staff, "/api/sales", { lines: [{ variationId: s.bolt, quantity: 2, price: 10, splits: [{ warehouseId: w2, quantity: 2 }] }] });
    const late = await post(s.manager, `/api/transfers/${t2.body.transfer.id}/cancel`, { reason: "Too late" });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("TRANSFER_STOCK_USED");

    // Deactivate: refused while it holds stock or is the default; allowed when empty.
    expect((await post(s.admin, `/api/warehouses/${w2}/deactivate`, {})).body.error.code).toBe("WAREHOUSE_NOT_EMPTY");
    expect((await post(s.admin, `/api/warehouses/${w1}/deactivate`, {})).body.error.code).toBe("WAREHOUSE_DEFAULT");
    await post(s.manager, "/api/transfers", { fromWarehouseId: w2, toWarehouseId: w1, lines: [{ variationId: s.bolt, quantity: 1 }] });
    expect((await post(s.admin, `/api/warehouses/${w2}/deactivate`, {})).status).toBe(200);
    expect((await post(s.manager, "/api/transfers", { fromWarehouseId: w1, toWarehouseId: w2, lines: [{ variationId: s.bolt, quantity: 1 }] })).body.error.code).toBe("WAREHOUSE_INACTIVE");
    const list = (await s.staff.get("/api/transfers")).body;
    expect(list.total).toBe(3);
    expect(await drift(s.co.id)).toBe(0);
  });

  it("sets live in one warehouse; a shift moves the set with its parts; free stock is per warehouse (GW-1…GW-5)", async () => {
    const s = await setup();
    const { w1, w2 } = await twoWarehouses(s);
    const g = (
      await post(s.admin, "/api/products", {
        productType: "grouped",
        name: "Chain Hoist",
        shortName: `CH${s.tag}`,
        main: { name: "Hoist Body", shortName: `HB${s.tag}`, unit: "Nos" },
        byproducts: [{ productId: (await prisma.productVariation.findUniqueOrThrow({ where: { id: s.chain } })).groupId, required: true }],
      })
    ).body.product;
    const link = g.grouped.byproducts[0];
    const opened = await post(s.admin, "/api/sets/opening", { groupId: g.id, warehouseId: w2, sets: [{ rate: 6000, parts: [{ byproductId: link.id, variationId: s.chain, length: 3 }] }] });
    expect(opened.status).toBe(201);
    const set = await prisma.groupSet.findUniqueOrThrow({ where: { id: opened.body.sets[0].id } });
    expect(set.warehouseId).toBe(w2);
    const mainV = g.grouped.main.variationId as string;
    expect(await wh(mainV)).toEqual({ [w2]: 1 });
    expect(await wh(s.chain)).toEqual({ [w1]: 80, [w2]: 3 });

    // The 3 m in the set is not free in W2: a loose shift of it is refused.
    const setPiece = await prisma.measurementPiece.findFirstOrThrow({ where: { setId: set.id } });
    expect((await post(s.manager, "/api/transfers", { fromWarehouseId: w2, toWarehouseId: w1, lines: [{ pieceId: setPiece.id }] })).body.error.code).toBe("PIECE_IN_SET");

    // Shift the whole set to W1: set, piece and every part move together.
    const t = await post(s.manager, "/api/transfers", { fromWarehouseId: w2, toWarehouseId: w1, lines: [{ setId: set.id }] });
    expect(t.status).toBe(201);
    expect((await prisma.groupSet.findUniqueOrThrow({ where: { id: set.id } })).warehouseId).toBe(w1);
    expect((await prisma.measurementPiece.findUniqueOrThrow({ where: { id: setPiece.id } })).warehouseId).toBe(w1);
    expect(await wh(mainV)).toEqual({ [w1]: 1, [w2]: 0 });
    expect(await wh(s.chain)).toEqual({ [w1]: 83, [w2]: 0 });
    expect(await drift(s.co.id)).toBe(0);
    // Cancel brings the set back to W2.
    expect((await post(s.manager, `/api/transfers/${t.body.transfer.id}/cancel`, { reason: "Back" })).status).toBe(200);
    expect((await prisma.groupSet.findUniqueOrThrow({ where: { id: set.id } })).warehouseId).toBe(w2);
    // A warehouse holding a set cannot be deactivated (GW-5).
    expect((await post(s.admin, `/api/warehouses/${w2}/deactivate`, {})).body.error.code).toBe("WAREHOUSE_NOT_EMPTY");
  });

  it("orders: a sale order keeps its Take-from split or decides at delivery; a PO receives into its warehouse (WH-13)", async () => {
    const s = await setup();
    const { w1, w2 } = await twoWarehouses(s);
    await post(s.manager, "/api/transfers", { fromWarehouseId: w1, toWarehouseId: w2, lines: [{ variationId: s.bolt, quantity: 4 }] });
    // Saved split 1 → W1, 2 → W2: orders never move stock.
    const so = await post(s.manager, "/api/orders", { kind: "SALE", status: "PLACED", lines: [{ variationId: s.bolt, quantity: 3, price: 10, splits: [{ warehouseId: w1, quantity: 1 }, { warehouseId: w2, quantity: 2 }] }] });
    expect(so.status).toBe(201);
    expect(await wh(s.bolt)).toEqual({ [w1]: 6, [w2]: 4 });
    expect((await s.manager.get(`/api/orders/${so.body.id}`)).body.order.lines[0].splits).toEqual([{ warehouseId: w1, quantity: 1 }, { warehouseId: w2, quantity: 2 }]);
    expect((await post(s.manager, `/api/orders/${so.body.id}/fulfill`, {})).status).toBe(201);
    expect(await wh(s.bolt)).toEqual({ [w1]: 5, [w2]: 2 });
    // Decide at delivery: the delivery's own split.
    const later = await post(s.manager, "/api/orders", { kind: "SALE", status: "PLACED", lines: [{ variationId: s.bolt, quantity: 2, price: 10 }] });
    const line = (await s.manager.get(`/api/orders/${later.body.id}`)).body.order.lines[0];
    expect(line.splits).toBeNull();
    expect((await post(s.manager, `/api/orders/${later.body.id}/fulfill`, { lines: [{ orderLineId: line.id, splits: [{ warehouseId: w2, quantity: 2 }] }] })).status).toBe(201);
    expect(await wh(s.bolt)).toEqual({ [w1]: 5, [w2]: 0 });
    // Purchase order with a preferred warehouse.
    const po = await post(s.manager, "/api/orders", { kind: "PURCHASE", status: "PLACED", warehouseId: w2, lines: [{ variationId: s.bolt, quantity: 7, price: 6 }] });
    expect((await s.manager.get(`/api/orders/${po.body.id}`)).body.order.warehouseId).toBe(w2);
    expect((await post(s.manager, `/api/orders/${po.body.id}/fulfill`, {})).status).toBe(201);
    expect(await wh(s.bolt)).toEqual({ [w1]: 5, [w2]: 7 });
    expect(await drift(s.co.id)).toBe(0);
  });

  it("backup round trip keeps warehouses, per-warehouse stock, rolls and shifts (plan §5 test 10)", async () => {
    const s = await setup();
    const { w1, w2 } = await twoWarehouses(s);
    const roll = await prisma.measurementPiece.findFirstOrThrow({ where: { variationId: s.chain, originalLength: 30 } });
    await post(s.manager, "/api/transfers", { fromWarehouseId: w1, toWarehouseId: w2, lines: [{ variationId: s.bolt, quantity: 4 }, { pieceId: roll.id }] });
    const t2 = await post(s.manager, "/api/transfers", { fromWarehouseId: w1, toWarehouseId: w2, lines: [{ variationId: s.bolt, quantity: 1 }] });
    await post(s.manager, `/api/transfers/${t2.body.transfer.id}/cancel`, { reason: "Not needed" });

    const zip = (await s.admin.get("/api/backup").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    })).body as Buffer;
    const target = await makeCompany();
    const tAdmin = await signIn((await makeUser(target.id, "admin")).email);
    const res = await tAdmin.post("/api/backup/restore?confirm=true").set("Origin", ORIGIN).set("Content-Type", "application/octet-stream").send(zip);
    expect(res.status).toBe(200);

    const list = (await tAdmin.get("/api/warehouses")).body;
    expect(list.enabled).toBe(true);
    expect(list.warehouses.map((w: { code: string; isDefault: boolean }) => [w.code, w.isDefault])).toEqual([
      ["W1", true],
      ["W2", false],
    ]);
    const code = new Map(list.warehouses.map((w: { id: string; code: string }) => [w.id, w.code]));
    const bolt = await prisma.productVariation.findFirstOrThrow({ where: { companyId: target.id, shortName: `BT${s.tag}` } });
    const byCode = async (variationId: string) =>
      Object.fromEntries(Object.entries(await wh(variationId)).map(([id, q]) => [code.get(id), q]));
    expect(await byCode(bolt.id)).toEqual({ W1: 6, W2: 4 });
    const chain = await prisma.productVariation.findFirstOrThrow({ where: { companyId: target.id, shortName: { endsWith: `LC${s.tag}` } } });
    expect(await byCode(chain.id)).toEqual({ W1: 50, W2: 30 });
    const shifts = (await tAdmin.get("/api/transfers")).body.transfers;
    expect(shifts.map((t: { status: string }) => t.status).sort()).toEqual(["CANCELLED", "DONE"]);
    expect(await drift(target.id)).toBe(0);
  });
});
