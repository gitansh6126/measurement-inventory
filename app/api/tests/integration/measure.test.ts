import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// V2 plan §2 — Measured products (owner decisions DM-1…DM-8, wireframes W1–W19): a third product
// type with variations, one record per roll, typed roll lengths on purchase, one piece per sale
// line (never joined), Cut → Open → Closed order, strict stock, void: a whole piece comes back
// as itself (a roll the sale opened is sealed again), a part as a new cut piece (2026-10-24),
// and the commit-time rule "active rolls = stock".

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const put = (a: Agent, url: string, body: unknown) => a.put(url).set("Origin", ORIGIN).send(body as object);
const patch = (a: Agent, url: string, body: unknown) => a.patch(url).set("Origin", ORIGIN).send(body as object);

async function setup() {
  const co = await makeCompany();
  // Decimal places and scrap-below are company settings per length unit (0029).
  await prisma.company.update({ where: { id: co.id }, data: { lengthDecimalsM: 1, scrapBelowM: 0.5 } });
  const admin = await signIn((await makeUser(co.id, "admin")).email);
  const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
  const staff = await signIn((await makeUser(co.id, "sales_staff")).email);
  const tag = co.id.slice(-5).toUpperCase();
  const res = await post(manager, "/api/products", {
    productType: "measured",
    name: "Steel Wire Rope 6x19 FC",
    baseShortName: `WR${tag}`,
    attributes: [{ name: "Diameter", unit: "mm", values: ["8", "10", "12"] }],
    variations: [{ attributes: { Diameter: "8" } }, { attributes: { Diameter: "10" }, defaultRollLength: 500 }, { attributes: { Diameter: "12" } }],
    measure: { lengthUnit: "m", rollName: "Roll", defaultRollLength: 500 },
  });
  if (res.status !== 201) throw new Error(`create failed: ${JSON.stringify(res.body)}`);
  const product = res.body.product;
  const byDia = (d: string) => product.variations.find((v: { attributes: Record<string, string> }) => v.attributes.Diameter === d).id as string;
  const supplier = (await post(manager, "/api/parties", { type: "SUPPLIER", name: `Alpha ${tag}` })).body.party.id as string;
  return { co, admin, manager, staff, product, v8: byDia("8"), v10: byDia("10"), v12: byDia("12"), supplier };
}

const stock = async (variationId: string) => Number((await prisma.stockBalance.findUnique({ where: { variationId } }))?.quantity ?? 0);
const activeSum = async (variationId: string) =>
  Number((await prisma.measurementPiece.aggregate({ where: { variationId, status: "ACTIVE" }, _sum: { remainingLength: true } }))._sum.remainingLength ?? 0);
const piecesOf = (variationId: string) => prisma.measurementPiece.findMany({ where: { variationId }, orderBy: [{ createdAt: "asc" }, { code: "asc" }] });
const drift = async (companyId: string) => Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM stock_balance_drift WHERE company_id = ${companyId}`)[0]!.n);

/** Wireframe W8 state for 10 mm: open roll 310 m, cut pieces 22.5 m and 4.2 m, two closed 500 m rolls. */
async function wireframeStock(s: Awaited<ReturnType<typeof setup>>) {
  const add = await post(s.manager, `/api/measure/variations/${s.v10}/rolls`, { rolls: [{ length: 500 }] });
  expect(add.status).toBe(201);
  const roll = add.body.pieces[0].id as string;
  // 500 → sell 150 → cut 22.5 and 4.2 → sell 13.3 = 310 left.
  expect((await post(s.manager, "/api/sales", { lines: [{ variationId: s.v10, quantity: 150, price: 72, pieceId: roll }] })).status).toBe(201);
  const cut = await post(s.manager, `/api/measure/pieces/${roll}/cut`, { lengths: [22.5, 4.2] });
  expect(cut.status).toBe(201);
  expect((await post(s.manager, "/api/sales", { lines: [{ variationId: s.v10, quantity: 13.3, price: 72, pieceId: roll }] })).status).toBe(201);
  const pur = await post(s.manager, "/api/purchases", {
    partyId: s.supplier,
    lines: [{ variationId: s.v10, price: 58, rolls: [{ length: 500, supplierRollNo: "AS-9101", rack: "R1-B" }, { length: 500, rack: "R1-B" }] }],
  });
  expect(pur.status).toBe(201);
  return { roll, cuts: cut.body.pieces as { id: string; code: string; length: number }[], purchaseId: pur.body.id as string };
}

describe("Measured product type (DM-1)", () => {
  it("is created with variations and a length unit; the unit follows the length unit", async () => {
    const s = await setup();
    expect(s.product).toMatchObject({ productType: "measured", unit: "m", measure: { lengthUnit: "m", rollName: "Roll", defaultRollLength: 500, decimals: 1, scrapBelow: 0.5 } });
    expect(s.product.variations).toHaveLength(3);
    expect(s.product.variations.find((v: { id: string }) => v.id === s.v10).defaultRollLength).toBe(500);
  });

  it("takes decimals and scrap-below from Settings, and saving Settings updates every measured product", async () => {
    const s = await setup();
    // Per-product values sent by an old client are ignored.
    const res = await post(s.manager, "/api/products", {
      productType: "measured",
      name: "Rope FT",
      baseShortName: `RF${s.co.id.slice(-5).toUpperCase()}`,
      attributes: [{ name: "Size", values: ["6"] }],
      variations: [{ attributes: { Size: "6" } }],
      measure: { lengthUnit: "ft_in", decimals: 3, scrapBelow: 99 },
    });
    expect(res.status).toBe(201);
    expect(res.body.product.measure).toMatchObject({ decimals: 1, scrapBelow: null });

    expect((await put(s.manager, "/api/company/length-settings", { m: { decimals: 2, scrapBelow: 1 }, ft_in: { decimals: 0, scrapBelow: 12 } })).status).toBe(403);
    const saved = await put(s.admin, "/api/company/length-settings", { m: { decimals: 2, scrapBelow: 1 }, ft_in: { decimals: 0, scrapBelow: 12 } });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ productsUpdated: 2, lengthSettings: { m: { decimals: 2, scrapBelow: 1 }, ft_in: { decimals: 0, scrapBelow: 12 } } });
    expect((await s.admin.get("/api/company/settings")).body.lengthSettings).toEqual({ m: { decimals: 2, scrapBelow: 1 }, ft_in: { decimals: 0, scrapBelow: 12 } });
    const groups = await prisma.productGroup.findMany({ where: { companyId: s.co.id, productType: "measured" }, select: { lengthUnit: true, lengthDecimals: true, scrapBelow: true } });
    expect(groups.map((g) => [g.lengthUnit, g.lengthDecimals, Number(g.scrapBelow)]).sort()).toEqual([["ft_in", 0, 12], ["m", 2, 1]]);
  });

  it("refuses a measured product without variations, and roll lengths on other types", async () => {
    const s = await setup();
    const none = await post(s.manager, "/api/products", { productType: "measured", name: "Chain", baseShortName: "CH-X", attributes: [{ name: "Size", values: ["6"] }], variations: [], measure: { lengthUnit: "m" } });
    expect(none.status).toBe(400);
    const variable = await post(s.manager, "/api/products", {
      productType: "variable",
      name: "Shackle",
      unit: "Nos",
      baseShortName: `SH${s.co.id.slice(-4)}`,
      attributes: [{ name: "Size", values: ["6"] }],
      variations: [{ attributes: { Size: "6" }, defaultRollLength: 50 }],
    });
    expect(variable.status).toBe(400);
    expect(variable.body.error.code).toBe("NOT_MEASURED");
  });

  it("keeps the length unit fixed once stock exists (conversion not built yet)", async () => {
    const s = await setup();
    expect((await patch(s.manager, `/api/products/${s.product.id}`, { measure: { lengthUnit: "ft_in" } })).status).toBe(200);
    expect((await patch(s.manager, `/api/products/${s.product.id}`, { measure: { lengthUnit: "m" } })).status).toBe(200);
    await post(s.manager, `/api/measure/variations/${s.v8}/rolls`, { rolls: [{ length: 100 }] });
    const r = await patch(s.manager, `/api/products/${s.product.id}`, { measure: { lengthUnit: "ft_in" } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("UNIT_CHANGE_NOT_AVAILABLE");
  });
});

describe("rolls: add, open, cut, write off, correct (W9–W11)", () => {
  it("adds one record per roll with codes, opening stock and a ledger", async () => {
    const s = await setup();
    const r = await post(s.manager, `/api/measure/variations/${s.v8}/rolls`, { rolls: [{ length: 500, rack: "R1-B" }, { length: 496 }, { length: 312.5, kind: "OPEN" }] });
    expect(r.status).toBe(201);
    expect(r.body.pieces.map((p: { code: string }) => p.code)).toEqual([
      expect.stringMatching(/-500-\d{1,2}-\d{1,2}-\d{2}-01$/),
      expect.stringMatching(/-496-\d{1,2}-\d{1,2}-\d{2}-01$/),
      expect.stringMatching(/-312.5-\d{1,2}-\d{1,2}-\d{2}-01$/),
    ]);
    expect(await stock(s.v8)).toBe(1308.5);
    expect(await activeSum(s.v8)).toBe(1308.5);
    const mv = await prisma.stockMovement.findMany({ where: { variationId: s.v8 } });
    expect(mv.map((m) => [m.movementType, Number(m.quantity)])).toEqual([["OPENING", 1308.5]]);
    // A second batch is an adjustment (opening stock happens once).
    await post(s.manager, `/api/measure/variations/${s.v8}/rolls`, { rolls: [{ length: 10 }] });
    expect((await prisma.stockMovement.findMany({ where: { variationId: s.v8 }, orderBy: { createdAt: "asc" } })).map((m) => m.movementType)).toEqual(["OPENING", "ADJUSTMENT"]);
  });

  it("records an open roll's full length apart from what is left; stock counts what is left", async () => {
    const s = await setup();
    const r = await post(s.manager, `/api/measure/variations/${s.v8}/rolls`, { rolls: [{ length: 120, kind: "OPEN", originalLength: 500 }, { length: 500 }] });
    expect(r.status).toBe(201);
    expect(r.body.pieces.map((p: { length: number; originalLength: number }) => [p.length, p.originalLength])).toEqual([
      [120, 500],
      [500, 500],
    ]);
    expect(await stock(s.v8)).toBe(620);
    expect(await activeSum(s.v8)).toBe(620);
    expect(await drift(s.co.id)).toBe(0);
    const ledger = await prisma.measurementPieceLedger.findMany({ where: { variationId: s.v8 }, orderBy: { afterLength: "asc" } });
    expect(ledger.map((l) => Number(l.afterLength))).toEqual([120, 500]);

    const less = await post(s.manager, `/api/measure/variations/${s.v8}/rolls`, { rolls: [{ length: 200, kind: "OPEN", originalLength: 150 }] });
    expect(less.status).toBe(400);
    expect(less.body.error.code).toBe("BAD_ORIGINAL");
    const sealed = await post(s.manager, `/api/measure/variations/${s.v8}/rolls`, { rolls: [{ length: 200, originalLength: 500 }] });
    expect(sealed.status).toBe(400);
    expect(sealed.body.error.code).toBe("BAD_ORIGINAL");
  });

  it("never changes measured stock by typing a number (BR-18)", async () => {
    const s = await setup();
    await post(s.manager, `/api/measure/variations/${s.v8}/rolls`, { rolls: [{ length: 100 }] });
    const adj = await post(s.manager, "/api/inventory/adjustments", { variationId: s.v8, quantity: -5, reason: "count" });
    expect(adj.status).toBe(409);
    expect(adj.body.error.code).toBe("USE_ROLLS");
    const si = await post(s.manager, "/api/inventory/stock-in", { reason: "Recount", rows: [{ variationId: s.v8, expectedQuantity: 100, quantity: 90 }] });
    expect(si.status).toBe(409);
    // Prices per metre may still be set there.
    expect((await post(s.manager, "/api/inventory/stock-in", { reason: "Prices", rows: [{ variationId: s.v8, expectedQuantity: 100, salePrice: "48" }] })).status).toBe(200);
    expect(await stock(s.v8)).toBe(100);
  });

  it("opens, cuts (closed roll opens), writes off and corrects with exact stock", async () => {
    const s = await setup();
    const [roll] = (await post(s.manager, `/api/measure/variations/${s.v8}/rolls`, { rolls: [{ length: 500 }] })).body.pieces;
    const cut = await post(s.manager, `/api/measure/pieces/${roll.id}/cut`, { lengths: [10, 10, 40] });
    expect(cut.status).toBe(201);
    expect(cut.body.pieces).toHaveLength(3);
    const parent = await prisma.measurementPiece.findUniqueOrThrow({ where: { id: roll.id } });
    expect([parent.kind, Number(parent.remainingLength)]).toEqual(["OPEN", 440]);
    expect(await stock(s.v8)).toBe(500);
    expect(await activeSum(s.v8)).toBe(500);

    expect((await post(s.manager, `/api/measure/pieces/${roll.id}/cut`, { lengths: [441] })).body.error.code).toBe("CUT_TOO_LONG");

    const wo = await post(s.manager, `/api/measure/pieces/${cut.body.pieces[0].id}/write-off`, { reason: "Damaged - kinked" });
    expect(wo.status).toBe(200);
    expect(await stock(s.v8)).toBe(490);
    const corr = await post(s.manager, `/api/measure/pieces/${roll.id}/correct`, { length: 439.4, note: "Stock count 14 Oct" });
    expect(corr.status).toBe(200);
    expect(await stock(s.v8)).toBe(489.4);
    expect(await activeSum(s.v8)).toBe(489.4);
    expect((await post(s.manager, `/api/measure/pieces/${roll.id}/correct`, { length: 600, note: "too long" })).body.error.code).toBe("BAD_LENGTH");

    const edit = await patch(s.manager, `/api/measure/pieces/${roll.id}`, { rack: "R2-C", notes: "Check end" });
    expect(edit.status).toBe(200);
    const rec = (await s.manager.get(`/api/measure/pieces/${roll.id}`)).body;
    expect(rec.piece).toMatchObject({ rack: "R2-C", notes: "Check end", remainingLength: 439.4, originalLength: 500, used: { cutIntoPieces: 60, corrected: -0.6 } });
    expect(rec.history.map((h: { action: string }) => h.action)).toEqual(["ADD", "CUT", "CUT", "CUT", "CORRECTION", "EDIT"]);
    expect(await drift(s.co.id)).toBe(0);
  });

  it("lets only stock.adjust roles change rolls", async () => {
    const s = await setup();
    expect((await post(s.staff, `/api/measure/variations/${s.v8}/rolls`, { rolls: [{ length: 5 }] })).status).toBe(403);
    expect((await s.staff.get(`/api/measure/products/${s.product.id}/pieces`)).status).toBe(200);
  });
});

describe("purchases receive typed roll lengths (W12–W13)", () => {
  it("creates one closed piece per roll linked to the purchase and supplier", async () => {
    const s = await setup();
    const r = await post(s.manager, "/api/purchases", {
      partyId: s.supplier,
      lines: [{ variationId: s.v10, price: 58, rolls: [{ length: 500, supplierRollNo: "AS-9101" }, { length: 500 }, { length: 486 }] }],
    });
    expect(r.status).toBe(201);
    const pieces = await piecesOf(s.v10);
    expect(pieces.map((p) => [p.kind, Number(p.originalLength), p.purchaseId, p.supplierId])).toEqual([
      ["CLOSED", 486, r.body.id, s.supplier],
      ["CLOSED", 500, r.body.id, s.supplier],
      ["CLOSED", 500, r.body.id, s.supplier],
    ]);
    expect(pieces.find((p) => Number(p.originalLength) === 500 && p.supplierRollNo === "AS-9101")).toBeDefined();
    const doc = (await s.manager.get(`/api/purchases/${r.body.id}`)).body.document;
    expect(doc.lines[0]).toMatchObject({ quantity: 1486, lineTotal: "86188.00" });
    expect(doc.lines[0].pieces).toHaveLength(3);
    expect(await stock(s.v10)).toBe(1486);
  });

  it("requires rolls for a measured line and checks their total", async () => {
    const s = await setup();
    expect((await post(s.manager, "/api/purchases", { lines: [{ variationId: s.v10, quantity: 100, price: 58 }] })).body.error.code).toBe("ROLLS_REQUIRED");
    const mismatch = await post(s.manager, "/api/purchases", { lines: [{ variationId: s.v10, quantity: 100, price: 58, rolls: [{ length: 60 }, { length: 30 }] }] });
    expect(mismatch.body.error.code).toBe("ROLLS_TOTAL");
  });

  it("keeps counted items whole", async () => {
    const s = await setup();
    const p = (await post(s.manager, "/api/products", { productType: "simple", name: "Clip", unit: "Nos", shortName: `CL${s.co.id.slice(-5)}`, officialSku: null })).body.product;
    const r = await post(s.manager, "/api/purchases", { lines: [{ variationId: p.variations[0].id, quantity: 1.5, price: 10 }] });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("WHOLE_QUANTITY");
  });
});

describe("sales cut one piece per line (W14–W17, DM-4/DM-5/DM-6)", () => {
  it("cuts the smallest cut piece that fits and rounds the amount to the rupee", async () => {
    const s = await setup();
    const { cuts } = await wireframeStock(s);
    const before = await stock(s.v10);
    expect(before).toBe(1336.7);
    const r = await post(s.staff, "/api/sales", { lines: [{ variationId: s.v10, quantity: 18, price: 72 }] });
    expect(r.status).toBe(201);
    const c225 = await prisma.measurementPiece.findUniqueOrThrow({ where: { id: cuts[0]!.id } });
    expect(Number(c225.remainingLength)).toBe(4.5);
    expect(await stock(s.v10)).toBe(1318.7);
    expect(await activeSum(s.v10)).toBe(1318.7);
    const doc = (await s.staff.get(`/api/sales/${r.body.id}`)).body.document;
    expect(doc.lines[0]).toMatchObject({ quantity: 18, lineTotal: "1296.00" });
    expect(doc.lines[0].pieces[0]).toMatchObject({ code: cuts[0]!.code, action: "SALE", before: 22.5, after: 4.5 });

    const frac = await post(s.staff, "/api/sales", { lines: [{ variationId: s.v10, quantity: 2.375, price: 73 }] });
    expect(frac.status).toBe(201);
    // 2.375 × 73 = 173.375 → ₹173 (whole rupees).
    expect((await s.staff.get(`/api/sales/${frac.body.id}`)).body.document.total).toBe("173.00");
  });

  it("opens a closed roll when it is the only piece long enough", async () => {
    const s = await setup();
    await wireframeStock(s);
    const r = await post(s.staff, "/api/sales", { lines: [{ variationId: s.v10, quantity: 400, price: 72 }] });
    expect(r.status).toBe(201);
    const opened = (await piecesOf(s.v10)).filter((p) => p.purchaseId && p.kind === "OPEN");
    expect(opened).toHaveLength(1);
    expect(Number(opened[0]!.remainingLength)).toBe(100);
  });

  it("never joins pieces and names the longest piece", async () => {
    const s = await setup();
    await wireframeStock(s);
    const r = await post(s.staff, "/api/sales", { lines: [{ variationId: s.v10, quantity: 600, price: 72 }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("NO_PIECE_LONG_ENOUGH");
    expect(r.body.error.message).toContain("the longest is 500 m");
    expect(r.body.error.details[0]).toMatchObject({ length: 600, longest: 500 });
    const none = await post(s.staff, "/api/sales", { lines: [{ variationId: s.v12, quantity: 25, price: 98 }] });
    expect(none.body.error.code).toBe("NO_PIECE_LONG_ENOUGH");
    expect(none.body.error.message).toContain("no rolls in stock");
  });

  it("refuses a chosen piece that is too short with PIECE_CHANGED", async () => {
    const s = await setup();
    const { cuts } = await wireframeStock(s);
    const r = await post(s.staff, "/api/sales", { lines: [{ variationId: s.v10, quantity: 18, price: 72, pieceId: cuts[1]!.id }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("PIECE_CHANGED");
  });

  it("writes off a scrap leftover when asked (DM-7)", async () => {
    const s = await setup();
    const { cuts } = await wireframeStock(s);
    const r = await post(s.staff, "/api/sales", { lines: [{ variationId: s.v10, quantity: 22.2, price: 72, pieceId: cuts[0]!.id, writeOffLeftover: true }] });
    expect(r.status).toBe(201);
    const p = await prisma.measurementPiece.findUniqueOrThrow({ where: { id: cuts[0]!.id } });
    expect([p.status, Number(p.remainingLength)]).toEqual(["USED_UP", 0]);
    expect(await activeSum(s.v10)).toBe(await stock(s.v10));
  });

  it("stays strict even when the company allows overselling counted stock", async () => {
    const s = await setup();
    await prisma.company.update({ where: { id: s.co.id }, data: { negativeStockPolicy: "WARN_AND_ALLOW" } });
    const r = await post(s.admin, "/api/sales", { lines: [{ variationId: s.v12, quantity: 5, price: 98 }], allowNegative: true });
    expect(r.status).toBe(409);
    expect(await stock(s.v12)).toBe(0);
  });

  it("serialises concurrent sales on the same piece without over-cutting", async () => {
    const s = await setup();
    const [roll] = (await post(s.manager, `/api/measure/variations/${s.v8}/rolls`, { rolls: [{ length: 50, kind: "OPEN" }] })).body.pieces;
    const results = await Promise.all(Array.from({ length: 8 }, () => post(s.staff, "/api/sales", { lines: [{ variationId: s.v8, quantity: 10, price: 48, pieceId: roll.id }] })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 409).every((r) => ["PIECE_CHANGED", "NO_PIECE_LONG_ENOUGH"].includes(r.body.error.code))).toBe(true);
    expect(await stock(s.v8)).toBe(0);
    expect(await activeSum(s.v8)).toBe(0);
  });
});

describe("voids (W18)", () => {
  it("returns a length cut off a piece as a new cut piece; the piece keeps what was left", async () => {
    const s = await setup();
    const { cuts } = await wireframeStock(s);
    const sale = (await post(s.staff, "/api/sales", { lines: [{ variationId: s.v10, quantity: 18, price: 72 }] })).body.id;
    const v = await post(s.manager, `/api/sales/${sale}/void`, { reason: "Customer cancelled" });
    expect(v.status).toBe(200);
    expect(Number((await prisma.measurementPiece.findUniqueOrThrow({ where: { id: cuts[0]!.id } })).remainingLength)).toBe(4.5);
    const back = await prisma.measurementPiece.findFirstOrThrow({ where: { parentId: cuts[0]!.id, notes: { contains: "Returned by void" } } });
    expect([back.kind, back.status, Number(back.remainingLength)]).toEqual(["CUT", "ACTIVE", 18]);
    expect(await stock(s.v10)).toBe(1336.7);
    expect(await activeSum(s.v10)).toBe(1336.7);
    expect(await drift(s.co.id)).toBe(0);
  });

  it("returns a whole piece as itself, and a sealed roll the sale opened is sealed again", async () => {
    const s = await setup();
    const { cuts } = await wireframeStock(s);
    // Whole 4.2 m cut piece sold, then cancelled: the same cut piece comes back.
    const one = (await post(s.staff, "/api/sales", { lines: [{ variationId: s.v10, quantity: 4.2, price: 72, pieceId: cuts[1]!.id }] })).body.id;
    expect((await post(s.manager, `/api/sales/${one}/void`, { reason: "Returned" })).status).toBe(200);
    expect(await prisma.measurementPiece.findUniqueOrThrow({ where: { id: cuts[1]!.id } })).toMatchObject({ kind: "CUT", status: "ACTIVE" });
    expect(Number((await prisma.measurementPiece.findUniqueOrThrow({ where: { id: cuts[1]!.id } })).remainingLength)).toBe(4.2);
    expect(await prisma.measurementPiece.count({ where: { parentId: cuts[1]!.id } })).toBe(0);

    // Whole sealed 500 m roll sold, then cancelled: the same roll comes back sealed.
    const sealed = (await piecesOf(s.v10)).find((p) => p.kind === "CLOSED")!;
    const two = (await post(s.staff, "/api/sales", { lines: [{ variationId: s.v10, quantity: 500, price: 72, pieceId: sealed.id }] })).body.id;
    expect((await prisma.measurementPiece.findUniqueOrThrow({ where: { id: sealed.id } })).kind).toBe("OPEN");
    expect((await post(s.manager, `/api/sales/${two}/void`, { reason: "Returned" })).status).toBe(200);
    const roll = await prisma.measurementPiece.findUniqueOrThrow({ where: { id: sealed.id } });
    expect([roll.kind, roll.status, Number(roll.remainingLength), roll.openedAt]).toEqual(["CLOSED", "ACTIVE", 500, null]);
    expect(await activeSum(s.v10)).toBe(await stock(s.v10));

    // The per-bundle history replays it: Sealed → Open on the sale, Open → Sealed on the cancel.
    const h = (await s.staff.get(`/api/measure/products/${s.product.id}/bundles?status=all&variationId=${s.v10}&pageSize=50`)).body;
    const b = h.bundles.find((x: { id: string }) => x.id === sealed.id);
    expect(b.timeline.map((r: { action: string; stateBefore: string; stateAfter: string }) => [r.action, r.stateBefore, r.stateAfter])).toEqual([
      ["RECEIVE", "CLOSED", "CLOSED"],
      ["SALE", "CLOSED", "OPEN"],
      ["SALE_VOID", "OPEN", "CLOSED"],
    ]);
    // The cut pieces of the first roll are nested under it.
    const first = h.bundles.find((x: { children: { id: string }[] }) => x.children.some((c) => c.id === cuts[1]!.id));
    expect(first.children.map((c: { id: string }) => c.id).sort()).toEqual(cuts.map((c) => c.id).sort());
    expect(h.summary).toMatchObject({ onHand: await stock(s.v10) });
  });

  it("returns length as a new cut piece when the piece was written off since", async () => {
    const s = await setup();
    const { cuts } = await wireframeStock(s);
    const sale = (await post(s.staff, "/api/sales", { lines: [{ variationId: s.v10, quantity: 18, price: 72, pieceId: cuts[0]!.id }] })).body.id;
    await post(s.manager, `/api/measure/pieces/${cuts[0]!.id}/write-off`, { reason: "Scrap" });
    expect((await post(s.manager, `/api/sales/${sale}/void`, { reason: "Returned" })).status).toBe(200);
    const child = await prisma.measurementPiece.findFirstOrThrow({ where: { parentId: cuts[0]!.id, notes: { contains: "Returned by void" } } });
    expect([child.kind, Number(child.remainingLength)]).toEqual(["CUT", 18]);
    expect(await activeSum(s.v10)).toBe(await stock(s.v10));
  });

  it("cancels a purchase only while its rolls are untouched", async () => {
    const s = await setup();
    const { purchaseId } = await wireframeStock(s);
    const untouched = (await post(s.manager, "/api/purchases", { partyId: s.supplier, lines: [{ variationId: s.v8, price: 40, rolls: [{ length: 200 }] }] })).body.id;
    expect((await post(s.manager, `/api/purchases/${untouched}/void`, { reason: "Wrong supplier" })).status).toBe(200);
    expect(await stock(s.v8)).toBe(0);
    // Cut one of the received 10 mm rolls, then the purchase can no longer be cancelled.
    const received = (await piecesOf(s.v10)).filter((p) => p.purchaseId === purchaseId);
    await post(s.manager, `/api/measure/pieces/${received[0]!.id}/open`, {});
    const r = await post(s.manager, `/api/purchases/${purchaseId}/void`, { reason: "Wrong rate" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("STOCK_ALREADY_USED");
  });
});

describe("backup round trip keeps every roll", () => {
  it("exports and restores pieces and their history with exact stock", async () => {
    const s = await setup();
    await wireframeStock(s);
    const json = (await s.admin.get("/api/backup?format=json")).body;
    expect(json.data.measurementPieces.length).toBeGreaterThan(0);
    const target = await makeCompany();
    const tAdmin = await signIn((await makeUser(target.id, "admin")).email);
    const r = await tAdmin.post("/api/backup/restore?confirm=true").set("Origin", ORIGIN).set("Content-Type", "application/octet-stream").send(Buffer.from(JSON.stringify(json)));
    expect(r.status).toBe(200);
    const tv = await prisma.productVariation.findFirstOrThrow({ where: { companyId: target.id, attributes: { equals: { Diameter: "10" } } } });
    expect(await stock(tv.id)).toBe(1336.7);
    expect(await activeSum(tv.id)).toBe(1336.7);
    expect(await prisma.measurementPieceLedger.count({ where: { companyId: target.id } })).toBe(await prisma.measurementPieceLedger.count({ where: { companyId: s.co.id } }));
  });
});

describe("several lines of one measured variation (W16, migration 0021)", () => {
  type DocPiece = { id: string; code: string; action: string; before: number; after: number };
  const doc = async (a: Agent, kind: "sales" | "purchases", id: string) => (await a.get(`/api/${kind}/${id}`)).body.document as { lines: { lineNo: number; quantity: number; pieces: DocPiece[] }[]; total: string };

  it("cuts each line from its own piece, shows each line's pieces, and the void returns each as a new cut piece", async () => {
    const s = await setup();
    const { cuts } = await wireframeStock(s);
    // Two 10 mm lines (W16): 18 m from the 22.5 m cut piece, 4 m from the 4.2 m cut piece.
    const r = await post(s.staff, "/api/sales", {
      lines: [
        { variationId: s.v10, quantity: 18, price: 72, pieceId: cuts[0]!.id },
        { variationId: s.v10, quantity: 4, price: 70, pieceId: cuts[1]!.id },
      ],
    });
    expect(r.status).toBe(201);
    expect(await stock(s.v10)).toBe(1314.7);
    expect(await activeSum(s.v10)).toBe(1314.7);
    let d = await doc(s.staff, "sales", r.body.id);
    expect(d.total).toBe("1576.00");
    expect(d.lines.map((l) => l.pieces.map((p) => [p.code, p.action, p.before, p.after]))).toEqual([
      [[cuts[0]!.code, "SALE", 22.5, 4.5]],
      [[cuts[1]!.code, "SALE", 4.2, 0.2]],
    ]);
    const ledger = await prisma.measurementPieceLedger.findMany({ where: { saleId: r.body.id }, orderBy: { lineNo: "asc" } });
    expect(ledger.map((h) => [h.lineNo, h.pieceId])).toEqual([[1, cuts[0]!.id], [2, cuts[1]!.id]]);

    expect((await post(s.manager, `/api/sales/${r.body.id}/void`, { reason: "Customer cancelled" })).status).toBe(200);
    expect(Number((await prisma.measurementPiece.findUniqueOrThrow({ where: { id: cuts[0]!.id } })).remainingLength)).toBe(4.5);
    expect(Number((await prisma.measurementPiece.findUniqueOrThrow({ where: { id: cuts[1]!.id } })).remainingLength)).toBe(0.2);
    const backs = await prisma.measurementPiece.findMany({ where: { parentId: { in: [cuts[0]!.id, cuts[1]!.id] }, notes: { contains: "Returned by void" } }, orderBy: { remainingLength: "desc" } });
    expect(backs.map((b) => [b.parentId, b.kind, Number(b.remainingLength)])).toEqual([
      [cuts[0]!.id, "CUT", 18],
      [cuts[1]!.id, "CUT", 4],
    ]);
    expect(await stock(s.v10)).toBe(1336.7);
    expect(await activeSum(s.v10)).toBe(1336.7);
    expect(await drift(s.co.id)).toBe(0);
    d = await doc(s.staff, "sales", r.body.id);
    expect(d.lines.map((l) => l.pieces.map((p) => [p.code, p.action]))).toEqual([
      [[cuts[0]!.code, "SALE"], [backs[0]!.code, "SALE_VOID"]],
      [[cuts[1]!.code, "SALE"], [backs[1]!.code, "SALE_VOID"]],
    ]);
  });

  it("cuts two lines from one piece in order and returns both on void", async () => {
    const s = await setup();
    const { cuts } = await wireframeStock(s);
    const r = await post(s.staff, "/api/sales", {
      lines: [
        { variationId: s.v10, quantity: 10, price: 72, pieceId: cuts[0]!.id },
        { variationId: s.v10, quantity: 10, price: 72, pieceId: cuts[0]!.id },
      ],
    });
    expect(r.status).toBe(201);
    const d = await doc(s.staff, "sales", r.body.id);
    expect(d.lines.map((l) => l.pieces.map((p) => [p.before, p.after]))).toEqual([[[22.5, 12.5]], [[12.5, 2.5]]]);
    // A third line that no longer fits on the chosen piece is refused as a whole.
    const over = await post(s.staff, "/api/sales", {
      lines: [
        { variationId: s.v10, quantity: 2, price: 72, pieceId: cuts[0]!.id },
        { variationId: s.v10, quantity: 2, price: 72, pieceId: cuts[0]!.id },
      ],
    });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("PIECE_CHANGED");
    expect((await post(s.manager, `/api/sales/${r.body.id}/void`, { reason: "Wrong size" })).status).toBe(200);
    expect(Number((await prisma.measurementPiece.findUniqueOrThrow({ where: { id: cuts[0]!.id } })).remainingLength)).toBe(2.5);
    const backs = await prisma.measurementPiece.findMany({ where: { parentId: cuts[0]!.id, notes: { contains: "Returned by void" } } });
    expect(backs.map((b) => Number(b.remainingLength))).toEqual([10, 10]);
    expect(await activeSum(s.v10)).toBe(await stock(s.v10));
  });

  it("receives two purchase lines of one variation at different rates and voids them", async () => {
    const s = await setup();
    const r = await post(s.manager, "/api/purchases", {
      partyId: s.supplier,
      lines: [
        { variationId: s.v8, price: 40, rolls: [{ length: 200 }, { length: 150 }] },
        { variationId: s.v8, price: 42, rolls: [{ length: 100 }] },
      ],
    });
    expect(r.status).toBe(201);
    expect(await stock(s.v8)).toBe(450);
    const d = await doc(s.manager, "purchases", r.body.id);
    expect(d.lines.map((l) => [l.quantity, l.pieces.map((p) => p.after)])).toEqual([[350, [200, 150]], [100, [100]]]);
    const rolls = await prisma.measurementPiece.findMany({ where: { purchaseId: r.body.id }, orderBy: { code: "asc" } });
    expect(rolls.map((p) => Number(p.unitCost))).toEqual([42, 40, 40]);
    expect((await post(s.manager, `/api/purchases/${r.body.id}/void`, { reason: "Wrong supplier" })).status).toBe(200);
    expect(await stock(s.v8)).toBe(0);
    const voided = await doc(s.manager, "purchases", r.body.id);
    expect(voided.lines.map((l) => l.pieces.filter((p) => p.action === "PURCHASE_VOID").length)).toEqual([2, 1]);
  });

  it("still refuses a counted item twice, also at the database", async () => {
    const s = await setup();
    const counted = await post(s.manager, "/api/products", {
      productType: "variable",
      name: "Shackle",
      unit: "Nos",
      baseShortName: `SK${s.co.id.slice(-4)}`,
      attributes: [{ name: "Size", values: ["6"] }],
      variations: [{ attributes: { Size: "6" } }],
    });
    expect(counted.status).toBe(201);
    const v = counted.body.product.variations[0].id as string;
    await post(s.manager, "/api/inventory/adjustments", { variationId: v, type: "OPENING", quantity: 10 });
    const r = await post(s.manager, "/api/sales", { lines: [{ variationId: v, quantity: 1, price: 5 }, { variationId: v, quantity: 1, price: 5 }] });
    expect(r.body.error.code).toBe("DUPLICATE_LINE");
    const ok = (await post(s.manager, "/api/sales", { lines: [{ variationId: v, quantity: 1, price: 5 }] })).body.id as string;
    const line = await prisma.saleLine.findFirstOrThrow({ where: { saleId: ok } });
    const { id: _id, ...copy } = line;
    await expect(prisma.saleLine.create({ data: { ...copy, lineNo: 2, attributesSnapshot: copy.attributesSnapshot ?? {} } })).rejects.toThrow(/DUPLICATE_LINE/);
  });

  it("keeps a two-line draft and checks it out; backup keeps each ledger row's line", async () => {
    const s = await setup();
    const { cuts } = await wireframeStock(s);
    const lines = [
      { variationId: s.v10, quantity: 18, price: 72, pieceId: cuts[0]!.id },
      { variationId: s.v10, quantity: 4, price: 72, pieceId: cuts[1]!.id },
    ];
    const draft = await post(s.staff, "/api/drafts", { mode: "SALE", title: "Two cuts", lines });
    expect(draft.status).toBe(201);
    const resumed = (await s.staff.get(`/api/drafts/${draft.body.draft.id}`)).body.draft;
    expect(resumed.lines.map((l: { pieceId: string }) => l.pieceId)).toEqual([cuts[0]!.id, cuts[1]!.id]);
    const sale = await post(s.staff, "/api/sales", { draftId: draft.body.draft.id, lines });
    expect(sale.status).toBe(201);

    const json = (await s.admin.get("/api/backup?format=json")).body;
    const target = await makeCompany();
    const tAdmin = await signIn((await makeUser(target.id, "admin")).email);
    const rs = await tAdmin.post("/api/backup/restore?confirm=true").set("Origin", ORIGIN).set("Content-Type", "application/octet-stream").send(Buffer.from(JSON.stringify(json)));
    expect(rs.status).toBe(200);
    const restoredSale = await prisma.sale.findFirstOrThrow({ where: { companyId: target.id, lines: { some: {} }, pieceLedger: { some: {} } }, orderBy: { createdAt: "desc" } });
    const d = await doc(tAdmin, "sales", restoredSale.id);
    expect(d.lines.map((l) => l.pieces.map((p) => [p.action, p.before, p.after]))).toEqual([[["SALE", 22.5, 4.5]], [["SALE", 4.2, 0.2]]]);
  });
});

describe("rate unit: feet + inches products are priced per foot (0028)", () => {
  async function imperial() {
    const s = await setup();
    const tag = s.co.id.slice(-5).toUpperCase();
    const res = await post(s.manager, "/api/products", {
      productType: "measured",
      name: "SS Wire Rope Imperial",
      baseShortName: `IMP${tag}`,
      attributes: [{ name: "Diameter", unit: "in", values: ["1/2"] }],
      variations: [{ attributes: { Diameter: "1/2" } }],
      measure: { lengthUnit: "ft_in", rollName: "Reel", decimals: 0 },
    });
    expect(res.status).toBe(201);
    return { ...s, vi: res.body.product.variations[0].id as string, productId: res.body.product.id as string };
  }

  it("amounts a length in inches at a per-foot rate and records rate_per on the line and movement", async () => {
    const s = await imperial();
    const pur = await post(s.manager, "/api/purchases", { partyId: s.supplier, lines: [{ variationId: s.vi, price: 36, rolls: [{ length: 1200 }] }] });
    expect(pur.status).toBe(201);
    expect(pur.body.id).toBeDefined();
    const pl = await prisma.purchaseLine.findFirstOrThrow({ where: { purchaseId: pur.body.id } });
    expect(pl.ratePer).toBe(12);
    expect(Number(pl.lineTotal)).toBe(3600); // 1,200 in = 100 ft × ₹36
    const piece = await prisma.measurementPiece.findFirstOrThrow({ where: { variationId: s.vi } });
    expect(Number(piece.unitCost)).toBe(36);

    // 7 in at ₹100 / ft = ₹58.33 → ₹58.
    const sale = await post(s.manager, "/api/sales", { lines: [{ variationId: s.vi, quantity: 7, price: 100 }] });
    expect(sale.status).toBe(201);
    const sl = await prisma.saleLine.findFirstOrThrow({ where: { saleId: sale.body.id } });
    expect(sl.ratePer).toBe(12);
    expect(Number(sl.lineTotal)).toBe(58);
    const doc = (await s.manager.get(`/api/sales/${sale.body.id}`)).body.document;
    expect(doc.lines[0]).toMatchObject({ price: "100.00", rateUnit: "ft", unit: "in" });
    const mv = await prisma.stockMovement.findFirstOrThrow({ where: { saleId: sale.body.id } });
    expect(mv.ratePer).toBe(12);

    // Stock value: 1,193 in ÷ 12 × ₹36 / ft.
    await patch(s.manager, `/api/inventory/variations/${s.vi}`, { salePrice: "120", purchaseCost: "36" });
    const inv = (await s.admin.get(`/api/inventory/products/${s.productId}`)).body.product;
    expect(Number(inv.variations[0].stockValue)).toBeCloseTo((1193 / 12) * 36, 2);
  });

  it("refuses a line total that ignores rate_per at the database", async () => {
    const s = await imperial();
    await post(s.manager, "/api/purchases", { partyId: s.supplier, lines: [{ variationId: s.vi, price: 36, rolls: [{ length: 1200 }] }] });
    const sale = await post(s.manager, "/api/sales", { lines: [{ variationId: s.vi, quantity: 24, price: 100 }] });
    expect(sale.status).toBe(201);
    const sl = await prisma.saleLine.findFirstOrThrow({ where: { saleId: sale.body.id } });
    expect(Number(sl.lineTotal)).toBe(200); // 2 ft
    await expect(
      prisma.$executeRaw`INSERT INTO sale_lines (id, sale_id, line_no, variation_id, product_name_snapshot, short_name_snapshot, attributes_snapshot, unit, quantity, unit_price, discount, line_total, rate_per)
        VALUES (${`x${Date.now()}`}, ${sale.body.id}, 9, ${s.vi}, 'x', 'x', '{}'::jsonb, 'in', 24, 100, 0, 2400, 12)`,
    ).rejects.toThrow();
  });

  it("converts rates when the length unit changes before any stock", async () => {
    const s = await imperial();
    await patch(s.manager, `/api/inventory/variations/${s.vi}`, { salePrice: "100" });
    expect((await patch(s.manager, `/api/products/${s.productId}`, { measure: { lengthUnit: "m" } })).status).toBe(200);
    expect(Number((await prisma.productVariation.findUniqueOrThrow({ where: { id: s.vi } })).salePrice)).toBe(328); // ₹100 / ft = ₹328.08 / m
  });

  it("restores a pre-0028 archive with feet + inches rates converted to per foot", async () => {
    const s = await imperial();
    await patch(s.manager, `/api/inventory/variations/${s.vi}`, { salePrice: "120", purchaseCost: "36" });
    const json = (await s.admin.get("/api/backup?format=json")).body;
    // An archive from before 0028 has no rateUnits mark and its imperial rates are per inch.
    delete json.rateUnits;
    for (const v of json.data.productVariations) if (v.id === s.vi) Object.assign(v, { salePrice: "10.00", purchaseCost: "3.00" });
    const target = await makeCompany();
    const tAdmin = await signIn((await makeUser(target.id, "admin")).email);
    const r = await tAdmin.post("/api/backup/restore?confirm=true").set("Origin", ORIGIN).set("Content-Type", "application/octet-stream").send(Buffer.from(JSON.stringify(json)));
    expect(r.status).toBe(200);
    const tv = await prisma.productVariation.findFirstOrThrow({ where: { companyId: target.id, group: { lengthUnit: "ft_in" } } });
    expect(Number(tv.salePrice)).toBe(120);
    expect(Number(tv.purchaseCost)).toBe(36);
  });
});
