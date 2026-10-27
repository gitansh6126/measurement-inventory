import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// V3.1 grouped products / sets, phase 1 (docs\GROUPED-PRODUCTS-V3-PLAN.md §2, §4, §8 tests 1, 3,
// 13, 14): create, opening sets, free-stock rule, set codes.

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);

async function setup() {
  const co = await makeCompany();
  const admin = await signIn((await makeUser(co.id, "admin")).email);
  const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
  const tag = co.id.slice(-4).toUpperCase();
  // Existing by-products: a measured chain (3 mm / 4 mm) and a simple hook.
  const chain = await post(admin, "/api/products", {
    productType: "measured",
    name: "Load Chain",
    baseShortName: `LC${tag}`,
    attributes: [{ name: "Size", unit: "", values: ["3 mm", "4 mm"] }],
    variations: [{ attributes: { Size: "3 mm" } }, { attributes: { Size: "4 mm" } }],
    measure: { lengthUnit: "m", rollName: "Roll" },
  });
  expect(chain.status).toBe(201);
  const hook = await post(admin, "/api/products", { productType: "simple", name: "Hook", unit: "Nos", shortName: `HK${tag}` });
  expect(hook.status).toBe(201);
  return { co, admin, manager, tag, chain: chain.body.product, hook: hook.body.product };
}

async function makeHoist(s: Awaited<ReturnType<typeof setup>>) {
  const res = await post(s.admin, "/api/products", {
    productType: "grouped",
    name: "Chain Hoist",
    shortName: `CH${s.tag}`,
    main: { name: "Hoist Body", shortName: `HB${s.tag}`, unit: "Nos" },
    byproducts: [
      { productId: s.chain.id, required: true },
      { productId: s.hook.id, required: false },
    ],
  });
  expect(res.status).toBe(201);
  return res.body.product;
}

describe("grouped products (sets)", () => {
  it("creates a grouped product with a new Simple main component and linked by-products", async () => {
    const s = await setup();
    const g = await makeHoist(s);
    expect(g.productType).toBe("grouped");
    expect(g.variations).toHaveLength(1);
    expect(g.grouped.main).toMatchObject({ name: "Hoist Body", shortName: `HB${s.tag}` });
    expect(g.grouped.byproducts.map((b: { name: string; required: boolean }) => [b.name, b.required])).toEqual([
      ["Load Chain", true],
      ["Hook", false],
    ]);
    const main = await prisma.productGroup.findUniqueOrThrow({ where: { id: g.grouped.main.productId } });
    expect(main).toMatchObject({ productType: "simple", ownerGroupId: g.id });
    // The main component is not listed on its own.
    const list = (await s.admin.get("/api/products?status=all")).body.products.map((p: { id: string }) => p.id);
    expect(list).toContain(g.id);
    expect(list).not.toContain(main.id);
  });

  it("creates a by-product inline and rejects bad definitions", async () => {
    const s = await setup();
    const inline = await post(s.admin, "/api/products", {
      productType: "grouped",
      name: "Lever Hoist",
      shortName: `LH${s.tag}`,
      main: { name: "Lever Body", shortName: `LB${s.tag}`, unit: "Nos" },
      byproducts: [{ newProduct: { productType: "simple", name: "Handle", unit: "Nos", shortName: `HD${s.tag}` }, required: true }],
    });
    expect(inline.status).toBe(201);
    expect(inline.body.product.grouped.byproducts[0].name).toBe("Handle");

    const g = await makeHoist(s);
    const nested = await post(s.admin, "/api/products", {
      productType: "grouped",
      name: "Bad",
      shortName: `BAD${s.tag}`,
      main: { name: "Bad Body", shortName: `BB${s.tag}`, unit: "Nos" },
      byproducts: [{ productId: g.id }],
    });
    expect(nested.status).toBe(400);
    expect(nested.body.error.code).toBe("BYPRODUCT_GROUPED");
    // Nothing of the failed product was kept (one transaction).
    expect(await prisma.productVariation.count({ where: { companyId: s.co.id, shortName: `BB${s.tag}` } })).toBe(0);
  });

  it("adds opening sets: parts in stock, fitted in sets, coded by contents; loose use refused", async () => {
    const s = await setup();
    const g = await makeHoist(s);
    const [linkChain, linkHook] = g.grouped.byproducts;
    const c3 = linkChain.variations[0].id;
    const c4 = linkChain.variations[1].id;
    const hookV = linkHook.variations[0].id;

    // Required chain missing → 400; measured without length → 400; staff/manager not allowed.
    expect((await post(s.admin, "/api/sets/opening", { groupId: g.id, sets: [{ rate: 6000, parts: [] }] })).body.error.code).toBe("BYPRODUCT_REQUIRED");
    expect((await post(s.admin, "/api/sets/opening", { groupId: g.id, sets: [{ rate: 6000, parts: [{ byproductId: linkChain.id, variationId: c3 }] }] })).body.error.code).toBe("LENGTH_REQUIRED");
    expect((await post(s.manager, "/api/sets/opening", { groupId: g.id, sets: [{ rate: 6000, parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }] }] })).status).toBe(403);

    const res = await post(s.admin, "/api/sets/opening", {
      groupId: g.id,
      date: "2026-10-20T06:30:00.000Z",
      sets: [
        { rate: 6200, parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }, { byproductId: linkHook.id, variationId: hookV }] },
        { rate: 7400, parts: [{ byproductId: linkChain.id, variationId: c4, length: 4.5 }] },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.sets.map((x: { code: string }) => x.code)).toEqual([`CH${s.tag}-3MM-3M-HK${s.tag}-20-10-26-01`, `CH${s.tag}-4MM-4.5M-20-10-26-01`]);

    const list = (await s.admin.get(`/api/sets?groupId=${g.id}`)).body;
    expect(list.counts.IN_STOCK).toBe(2);
    expect(list.sets.map((x: { name: string }) => x.name).sort()).toEqual(["Chain Hoist · 3 mm 3 m · Hook", "Chain Hoist · 4 mm 4.5 m"]);

    // Stock: parts are in their own products' stock, all of it fitted in sets.
    const balance = async (id: string) => Number((await prisma.stockBalance.findUnique({ where: { variationId: id } }))?.quantity ?? 0);
    expect(await balance(g.grouped.main.variationId)).toBe(2);
    expect(await balance(c3)).toBe(3);
    expect(await balance(hookV)).toBe(1);
    const piece = await prisma.measurementPiece.findFirstOrThrow({ where: { variationId: c3 } });
    expect(piece).toMatchObject({ kind: "CUT", status: "ACTIVE" });
    expect(piece.setId).toBeTruthy();

    // Stock In shows free stock (0) for the parts and the set count on the grouped product.
    const inv = (await s.admin.get(`/api/inventory/products/${g.id}`)).body.product;
    expect(inv.variations[0].quantity).toBe(2);
    const hookInv = (await s.admin.get(`/api/inventory/products/${s.hook.id}`)).body.product;
    expect(hookInv.variations[0]).toMatchObject({ quantity: 0, inSets: 1 });

    // Free-stock rule (§1.1): a loose sale cannot take the hook in a set, even with "sell anyway".
    const loose = await post(s.manager, "/api/sales", { allowNegative: true, lines: [{ variationId: hookV, quantity: 1, price: 100 }] });
    expect(loose.status).toBe(409);
    expect(loose.body.error.code).toBe("PARTS_IN_SETS");
    // The main component and the grouped product never move loose.
    expect((await post(s.manager, "/api/sales", { lines: [{ variationId: g.grouped.main.variationId, quantity: 1, price: 100 }] })).body.error.code).toBe("SETS_ONLY");
    expect((await post(s.admin, "/api/inventory/adjustments", { variationId: g.variations[0].id, quantity: 1, reason: "x" })).body.error.code).toBe("SETS_ONLY");
    // A measured piece in a set cannot be cut loose.
    expect((await post(s.admin, `/api/measure/pieces/${piece.id}/cut`, { lengths: [1] })).body.error?.code).toBe("PIECE_IN_SET");

    // Free stock above the sets can still be sold.
    await post(s.admin, "/api/inventory/adjustments", { variationId: hookV, quantity: 2, reason: "Found" });
    expect((await post(s.manager, "/api/sales", { lines: [{ variationId: hookV, quantity: 2, price: 100 }] })).status).toBe(201);
    expect((await post(s.manager, "/api/sales", { allowNegative: true, lines: [{ variationId: hookV, quantity: 1, price: 100 }] })).body.error.code).toBe("PARTS_IN_SETS");

    const drift = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM set_allocation_drift WHERE company_id = ${s.co.id}`;
    expect(Number(drift[0]!.n)).toBe(0);
  });

  it("cancels an untouched opening set and gives a unique code to the next one", async () => {
    const s = await setup();
    const g = await makeHoist(s);
    const [linkChain] = g.grouped.byproducts;
    const c3 = linkChain.variations[0].id;
    const one = { rate: 6000, parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }] };
    const body = { groupId: g.id, date: "2026-10-21T06:30:00.000Z", sets: [one, one] };
    const res = await post(s.admin, "/api/sets/opening", body);
    expect(res.body.sets.map((x: { code: string }) => x.code)).toEqual([`CH${s.tag}-3MM-3M-21-10-26-01`, `CH${s.tag}-3MM-3M-21-10-26-02`]);

    const cancel = await post(s.admin, `/api/sets/${res.body.sets[0].id}/cancel-opening`, { reason: "Entered twice" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.set.status).toBe("CANCELLED");
    expect(Number((await prisma.stockBalance.findUniqueOrThrow({ where: { variationId: c3 } })).quantity)).toBe(3);
    expect(Number((await prisma.stockBalance.findUniqueOrThrow({ where: { variationId: g.grouped.main.variationId } })).quantity)).toBe(1);
    expect((await post(s.admin, `/api/sets/${res.body.sets[0].id}/cancel-opening`, { reason: "again" })).status).toBe(409);

    const next = await post(s.admin, "/api/sets/opening", { ...body, sets: [one] });
    expect(next.body.sets[0].code).toBe(`CH${s.tag}-3MM-3M-21-10-26-03`);
  });

  it("backs up and restores grouped products, sets, parts and set pieces", async () => {
    const s = await setup();
    const g = await makeHoist(s);
    const [linkChain, linkHook] = g.grouped.byproducts;
    await post(s.admin, "/api/sets/opening", {
      groupId: g.id,
      date: "2026-10-20T06:30:00.000Z",
      sets: [
        { rate: 6200, parts: [{ byproductId: linkChain.id, variationId: linkChain.variations[0].id, length: 3 }, { byproductId: linkHook.id, variationId: linkHook.variations[0].id }] },
        { rate: 7400, parts: [{ byproductId: linkChain.id, variationId: linkChain.variations[1].id, length: 4.5 }] },
      ],
    });
    const zip = (await s.admin.get("/api/backup").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    })).body as Buffer;

    const target = await makeCompany();
    const tAdmin = await signIn((await makeUser(target.id, "admin")).email);
    const restore = () => tAdmin.post("/api/backup/restore?confirm=true").set("Origin", ORIGIN).set("Content-Type", "application/octet-stream").send(zip);
    expect((await restore()).status).toBe(200);
    // Restoring again over the same company deletes the set rows first.
    const again = await restore();
    expect(again.status).toBe(200);

    const tg = (await tAdmin.get("/api/products?status=all")).body.products.find((p: { productType: string }) => p.productType === "grouped");
    expect(tg.grouped.main.name).toBe("Hoist Body");
    expect(tg.grouped.byproducts.map((b: { name: string }) => b.name)).toEqual(["Load Chain", "Hook"]);
    const sets = (await tAdmin.get(`/api/sets?groupId=${tg.id}`)).body;
    expect(sets.counts.IN_STOCK).toBe(2);
    expect(sets.sets.map((x: { code: string }) => x.code).sort()).toEqual([`CH${s.tag}-3MM-3M-HK${s.tag}-20-10-26-01`, `CH${s.tag}-4MM-4.5M-20-10-26-01`]);
    expect(await prisma.measurementPiece.count({ where: { companyId: target.id, setId: { not: null }, setOrigin: true } })).toBe(2);
    const hookInv = (await tAdmin.get(`/api/inventory/products/${tg.grouped.byproducts[1].productId}`)).body.product;
    expect(hookInv.variations[0]).toMatchObject({ quantity: 0, inSets: 1 });
    const drift = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM set_allocation_drift WHERE company_id = ${target.id}`;
    expect(Number(drift[0]!.n)).toBe(0);
  });

  it("buys sets on a purchase: one line per rate, parts received into sets, no supplier rate (phase 2)", async () => {
    const s = await setup();
    const g = await makeHoist(s);
    const [linkChain, linkHook] = g.grouped.byproducts;
    const c3 = linkChain.variations[0].id;
    const c4 = linkChain.variations[1].id;
    const hookV = linkHook.variations[0].id;
    const setV = g.variations[0].id;
    const supplier = (await post(s.admin, "/api/parties", { type: "SUPPLIER", name: `Hoist Supp ${s.tag}` })).body.party.id;
    const set = (variationId: string, length: number, hook = false) => ({
      parts: [{ byproductId: linkChain.id, variationId, length }, ...(hook ? [{ byproductId: linkHook.id, variationId: hookV }] : [])],
    });

    // Validation: a missing required part, sets ≠ quantity, a set rate ≠ line rate, selling sets.
    const bad = (lines: unknown[]) => post(s.manager, "/api/purchases", { partyId: supplier, lines });
    expect((await bad([{ variationId: setV, price: 6200, sets: [{ parts: [] }] }])).body.error.code).toBe("BYPRODUCT_REQUIRED");
    expect((await bad([{ variationId: setV, quantity: 2, price: 6200, sets: [set(c3, 3)] }])).body.error.code).toBe("SETS_TOTAL");
    expect((await bad([{ variationId: setV, price: 6200, sets: [{ ...set(c3, 3), rate: 7000 }] }])).body.error.code).toBe("SET_RATE_MISMATCH");
    expect((await bad([{ variationId: setV, price: 6200 }])).body.error.code).toBe("SETS_REQUIRED");
    expect((await post(s.manager, "/api/sales", { lines: [{ variationId: setV, quantity: 1, price: 8500 }] })).body.error.code).toBe("SETS_REQUIRED");
    expect((await post(s.manager, "/api/orders", { kind: "PURCHASE", status: "PLACED", lines: [{ variationId: setV, price: 6200 }] })).body.error.code).toBe("QUANTITY_REQUIRED");

    const pur = await post(s.manager, "/api/purchases", {
      partyId: supplier,
      date: "2026-10-21T06:30:00.000Z",
      lines: [
        { variationId: setV, price: 6200, sets: [set(c3, 3, true), set(c3, 3)] },
        { variationId: setV, quantity: 1, price: 7400, sets: [set(c4, 4.5)] },
        { variationId: hookV, quantity: 2, price: 300 },
      ],
    });
    expect(pur.status).toBe(201);
    const doc = await prisma.purchase.findUniqueOrThrow({ where: { id: pur.body.id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    expect(doc.total.toFixed(2)).toBe("20400.00"); // 2 × 6,200 + 7,400 + 2 × 300
    expect(doc.lines.map((l) => [Number(l.quantity), l.unitCost.toFixed(2)])).toEqual([[2, "6200.00"], [1, "7400.00"], [2, "300.00"]]);

    const sets = await prisma.groupSet.findMany({ where: { purchaseId: doc.id }, orderBy: [{ purchaseLineNo: "asc" }, { code: "asc" }] });
    expect(sets.map((x) => [x.purchaseLineNo, x.rate.toFixed(2), x.source, x.status])).toEqual([
      [1, "6200.00", "PURCHASE", "IN_STOCK"],
      [1, "6200.00", "PURCHASE", "IN_STOCK"],
      [2, "7400.00", "PURCHASE", "IN_STOCK"],
    ]);
    const balance = async (id: string) => Number((await prisma.stockBalance.findUnique({ where: { variationId: id } }))?.quantity ?? 0);
    expect(await balance(g.grouped.main.variationId)).toBe(3);
    expect(await balance(c3)).toBe(6);
    expect(await balance(hookV)).toBe(3); // 1 in a set + 2 loose
    const hookInv = (await s.admin.get(`/api/inventory/products/${s.hook.id}`)).body.product.variations[0];
    expect(hookInv).toMatchObject({ quantity: 2, inSets: 1 });
    // D24: buying sets never writes a supplier rate for the grouped product; the loose hook does.
    expect(await prisma.vendorPrice.count({ where: { variationId: setV } })).toBe(0);
    expect(await prisma.vendorPrice.count({ where: { variationId: hookV } })).toBe(1);
    const piece = await prisma.measurementPiece.findFirstOrThrow({ where: { variationId: c4 } });
    expect(piece).toMatchObject({ purchaseId: doc.id, kind: "CUT", setOrigin: true });

    // Sets are not changed by an edit (2026-10-27: prices and details only): cancel and enter again.
    const edit = await post(s.manager, `/api/purchases/${doc.id}/edit`, { partyId: supplier, reason: "Fix quantity", lines: [{ variationId: hookV, quantity: 2, price: 300 }] });
    expect(edit.body.error.code).toBe("HEADER_EDIT_ONLY");

    // Void is refused once a set changed (D16)…
    const one = sets[2]!;
    await prisma.$transaction([
      prisma.$executeRaw`UPDATE group_set_parts SET status = 'RELEASED' WHERE set_id = ${one.id} AND role = 'BY'`,
      prisma.$executeRaw`UPDATE measurement_pieces SET set_id = NULL WHERE set_id = ${one.id}`,
    ]);
    const refused = await post(s.manager, `/api/purchases/${doc.id}/void`, { reason: "Wrong supplier" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("SET_CHANGED_OR_SOLD");
    await prisma.$transaction([
      prisma.$executeRaw`UPDATE group_set_parts SET status = 'ALLOCATED' WHERE set_id = ${one.id} AND role = 'BY'`,
      prisma.$executeRaw`UPDATE measurement_pieces SET set_id = ${one.id} WHERE id = ${piece.id}`,
    ]);

    // …and allowed while every set is untouched: sets cancelled, parts and pieces back out.
    const voided = await post(s.manager, `/api/purchases/${doc.id}/void`, { reason: "Wrong supplier" });
    expect(voided.status).toBe(200);
    expect((await prisma.groupSet.findMany({ where: { purchaseId: doc.id } })).every((x) => x.status === "CANCELLED")).toBe(true);
    expect(await balance(g.grouped.main.variationId)).toBe(0);
    expect(await balance(c3)).toBe(0);
    expect(await balance(hookV)).toBe(0);
    expect((await prisma.measurementPiece.findUniqueOrThrow({ where: { id: piece.id } })).status).toBe("USED_UP");
    const drift = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM set_allocation_drift WHERE company_id = ${s.co.id}`;
    expect(Number(drift[0]!.n)).toBe(0);
  });

  it("sells sets: unchanged, with a chain change and a hook removed; void brings them back (phase 3)", async () => {
    const s = await setup();
    const g = await makeHoist(s);
    const [linkChain, linkHook] = g.grouped.byproducts;
    const c3 = linkChain.variations[0].id;
    const c4 = linkChain.variations[1].id;
    const hookV = linkHook.variations[0].id;
    const mainV = g.grouped.main.variationId;
    const setV = g.variations[0].id;
    const opening = await post(s.admin, "/api/sets/opening", {
      groupId: g.id,
      sets: [
        { rate: 6200, parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }, { byproductId: linkHook.id, variationId: hookV }] },
        { rate: 6200, parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }, { byproductId: linkHook.id, variationId: hookV }] },
        { rate: 6200, parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }] },
      ],
    });
    expect(opening.status).toBe(201);
    const [a, b, c] = opening.body.sets as { id: string; code: string }[];
    // Loose 4 mm chain to change a set's chain from (one 50 m roll).
    expect((await post(s.admin, `/api/measure/variations/${c4}/rolls`, { rolls: [{ length: 50 }] })).status).toBe(201);
    const balance = async (id: string) => Number((await prisma.stockBalance.findUnique({ where: { variationId: id } }))?.quantity ?? 0);
    const sale = (lines: unknown[]) => post(s.manager, "/api/sales", { lines });
    const pieceOf = async (setId: string) => (await prisma.measurementPiece.findFirstOrThrow({ where: { setId } })).id;
    const oldChainA = await pieceOf(a!.id);

    // Validation: removing a required part, adding a fitted one, a set twice, wrong count.
    expect((await sale([{ variationId: setV, price: 8500, saleSets: [{ setId: a!.id, changes: [{ byproductId: linkChain.id, action: "REMOVE" }] }] }])).body.error.code).toBe("PART_REQUIRED");
    expect((await sale([{ variationId: setV, price: 8500, saleSets: [{ setId: a!.id, changes: [{ byproductId: linkHook.id, action: "ADD", variationId: hookV }] }] }])).body.error.code).toBe("PART_FITTED");
    expect((await sale([{ variationId: setV, price: 8500, saleSets: [{ setId: a!.id }, { setId: a!.id }] }])).body.error.code).toBe("SET_TWICE");
    expect((await sale([{ variationId: setV, quantity: 2, price: 8500, saleSets: [{ setId: a!.id }] }])).body.error.code).toBe("SETS_TOTAL");
    expect((await sale([{ variationId: setV, price: 8500, saleSets: [{ setId: a!.id, version: 99 }] }])).body.error.code).toBe("SET_CHANGED");
    // Nothing was kept by the refused sales.
    expect(await prisma.groupSetPartChange.count({ where: { setId: a!.id } })).toBe(0);

    // Set A: chain 3 mm → 4 mm 3 m (repriced line); set B unchanged on another line; set C stays.
    const res = await sale([
      { variationId: setV, price: 8920, saleSets: [{ setId: a!.id, version: 1, changes: [{ byproductId: linkChain.id, action: "REPLACE", variationId: c4, length: 3 }] }] },
      { variationId: setV, price: 8500, saleSets: [{ setId: b!.id, changes: [{ byproductId: linkHook.id, action: "REMOVE" }] }] },
    ]);
    expect(res.status).toBe(201);
    const doc = await prisma.sale.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(doc.total.toFixed(2)).toBe("17420.00");
    const sold = await prisma.groupSet.findMany({ where: { saleId: doc.id }, orderBy: { saleLineNo: "asc" } });
    expect(sold.map((x) => [x.id, x.saleLineNo, x.status])).toEqual([
      [a!.id, 1, "SOLD"],
      [b!.id, 2, "SOLD"],
    ]);
    // Stock: 2 hoists sold; the old 3 mm chain of A is a free Cut piece again (same length, D13);
    // 3 m cut from the 4 mm roll and sold; B's hook back to free stock; C untouched.
    expect(await balance(mainV)).toBe(1);
    expect(await balance(c3)).toBe(6); // A's old 3 m (free) + C's 3 m (in set); B's 3 m sold
    expect(await balance(c4)).toBe(47);
    expect(await balance(hookV)).toBe(1); // B's hook, now free
    const freed = await prisma.measurementPiece.findUniqueOrThrow({ where: { id: oldChainA } });
    expect(freed).toMatchObject({ setId: null, status: "ACTIVE" });
    expect(Number(freed.remainingLength)).toBe(3);
    const hookInv = (await s.admin.get(`/api/inventory/products/${s.hook.id}`)).body.product.variations[0];
    expect(hookInv).toMatchObject({ quantity: 1 });
    expect((await prisma.groupSetPartChange.findMany({ where: { saleId: doc.id } })).map((x) => x.changeType).sort()).toEqual(["REMOVE", "REPLACE"]);
    // The sale page names the sets by what was sold.
    const view = (await s.manager.get(`/api/sales/${doc.id}`)).body;
    const lines = view.document.lines;
    expect(lines[0].sets[0].name).toBe("Chain Hoist · 4 mm 3 m · Hook");
    expect(lines[1].sets[0].name).toBe("Chain Hoist · 3 mm 3 m");
    // A sold set cannot be sold again.
    expect((await sale([{ variationId: setV, price: 8500, saleSets: [{ setId: a!.id }] }])).body.error.code).toBe("SET_NOT_AVAILABLE");
    // The freed 3 mm piece can now be sold loose.
    expect((await sale([{ variationId: c3, quantity: 1, price: 300, pieceId: oldChainA }])).status).toBe(201);

    // Void (D15): sets back in stock with the parts they were sold with.
    const voided = await post(s.manager, `/api/sales/${doc.id}/void`, { reason: "Customer returned" });
    expect(voided.status).toBe(200);
    const back = await prisma.groupSet.findMany({ where: { id: { in: [a!.id, b!.id] } }, include: { parts: { where: { status: "ALLOCATED" } } } });
    expect(back.every((x) => x.status === "IN_STOCK" && x.saleId === null)).toBe(true);
    expect(back.find((x) => x.id === a!.id)!.parts.map((p) => p.variationId).sort()).toEqual([c4, hookV, mainV].sort());
    expect(back.find((x) => x.id === b!.id)!.parts.map((p) => p.variationId).sort()).toEqual([c3, mainV].sort());
    expect(await balance(mainV)).toBe(3);
    expect(await balance(c4)).toBe(50);
    const list = (await s.admin.get(`/api/sets?groupId=${g.id}`)).body;
    expect(list.counts.IN_STOCK).toBe(3);
    // Purchase void stays blocked for changed sets is covered above; the set can be sold again.
    expect((await sale([{ variationId: setV, price: 8920, saleSets: [{ setId: a!.id }] }])).status).toBe(201);
    expect(c).toBeTruthy();
    const drift = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM set_allocation_drift WHERE company_id = ${s.co.id}`;
    expect(Number(drift[0]!.n)).toBe(0);
  });

  it("cancel can release a set's measured part as a free cut piece; the set comes back without it", async () => {
    const s = await setup();
    const g = await makeHoist(s);
    const [linkChain, linkHook] = g.grouped.byproducts;
    const c3 = linkChain.variations[0].id;
    const hookV = linkHook.variations[0].id;
    const setV = g.variations[0].id;
    const opening = await post(s.admin, "/api/sets/opening", {
      groupId: g.id,
      sets: [
        { rate: 6200, parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }, { byproductId: linkHook.id, variationId: hookV }] },
        { rate: 6200, parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }, { byproductId: linkHook.id, variationId: hookV }] },
      ],
    });
    const [a, b] = opening.body.sets as { id: string; code: string }[];
    const chainA = (await prisma.measurementPiece.findFirstOrThrow({ where: { setId: a!.id } })).id;
    const chainB = (await prisma.measurementPiece.findFirstOrThrow({ where: { setId: b!.id } })).id;
    const res = await post(s.manager, "/api/sales", {
      lines: [{ variationId: setV, quantity: 2, price: 8500, saleSets: [{ setId: a!.id }, { setId: b!.id }] }],
    });
    expect(res.status).toBe(201);
    // The sale page lists each set's measured parts for the cancel dialog.
    const view = (await s.manager.get(`/api/sales/${res.body.id}`)).body.document;
    expect(view.lines[0].sets.map((x: { measuredParts: unknown[] }) => x.measuredParts.length)).toEqual([1, 1]);
    expect((await post(s.manager, `/api/sales/${res.body.id}/void`, { reason: "Returned", releaseSetIds: ["nope"] })).status).toBe(400);

    // Set A released, set B kept together.
    const v = await post(s.manager, `/api/sales/${res.body.id}/void`, { reason: "Returned", releaseSetIds: [a!.id] });
    expect(v.status).toBe(200);
    const pa = await prisma.measurementPiece.findUniqueOrThrow({ where: { id: chainA } });
    expect([pa.setId, pa.kind, pa.status, Number(pa.remainingLength)]).toEqual([null, "CUT", "ACTIVE", 3]);
    const pb = await prisma.measurementPiece.findUniqueOrThrow({ where: { id: chainB } });
    expect([pb.setId, pb.status]).toEqual([b!.id, "ACTIVE"]);
    const back = await prisma.groupSet.findMany({ where: { id: { in: [a!.id, b!.id] } }, include: { parts: { where: { status: "ALLOCATED" } } } });
    expect(back.every((x) => x.status === "IN_STOCK")).toBe(true);
    expect(back.find((x) => x.id === a!.id)!.parts.some((p) => p.variationId === c3)).toBe(false);
    expect(back.find((x) => x.id === b!.id)!.parts.some((p) => p.variationId === c3)).toBe(true);
    const drift = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM set_allocation_drift WHERE company_id = ${s.co.id}`;
    expect(Number(drift[0]!.n)).toBe(0);
  });

  it("sale orders hold sets until delivered or cancelled; void re-holds them (D23)", async () => {
    const s = await setup();
    const g = await makeHoist(s);
    const [linkChain, linkHook] = g.grouped.byproducts;
    const c3 = linkChain.variations[0].id;
    const hookV = linkHook.variations[0].id;
    const setV = g.variations[0].id;
    const one = { rate: 6200, parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }] };
    const opening = await post(s.admin, "/api/sets/opening", { groupId: g.id, sets: [one, one, one] });
    const [a, b, c] = opening.body.sets as { id: string; code: string }[];
    await post(s.admin, "/api/inventory/adjustments", { variationId: hookV, quantity: 2, reason: "Found" });
    const status = async (id: string) => (await prisma.groupSet.findUniqueOrThrow({ where: { id } })).status;

    // Take the order: A with a hook added (planned), B unchanged on another line.
    const order = await post(s.manager, "/api/orders", {
      kind: "SALE",
      status: "PLACED",
      lines: [
        { variationId: setV, price: 8800, saleSets: [{ setId: a!.id, changes: [{ byproductId: linkHook.id, action: "ADD", variationId: hookV }] }] },
        { variationId: setV, price: 8500, saleSets: [{ setId: b!.id }] },
      ],
    });
    expect(order.status).toBe(201);
    const oid = order.body.id;
    expect([await status(a!.id), await status(b!.id), await status(c!.id)]).toEqual(["HELD", "HELD", "IN_STOCK"]);
    // Held sets are hidden from other sales and other orders.
    expect((await post(s.manager, "/api/sales", { lines: [{ variationId: setV, price: 8500, saleSets: [{ setId: a!.id }] }] })).body.error.code).toBe("SET_NOT_AVAILABLE");
    expect((await post(s.manager, "/api/orders", { kind: "SALE", lines: [{ variationId: setV, price: 8500, saleSets: [{ setId: b!.id }] }] })).body.error.code).toBe("SET_NOT_AVAILABLE");
    expect((await s.admin.get(`/api/sets?groupId=${g.id}`)).body.counts).toMatchObject({ IN_STOCK: 1, HELD: 2 });
    // The order page shows the held sets per line.
    let view = (await s.manager.get(`/api/orders/${oid}`)).body.order;
    expect(view.lines.map((l: { heldSets: { id: string }[] }) => l.heldSets.map((x) => x.id))).toEqual([[a!.id], [b!.id]]);

    // Edit before dispatch: line 2 takes C instead of B — B is free again.
    const edit = await s.manager.put(`/api/orders/${oid}`).set("Origin", ORIGIN).send({
      version: view.version,
      lines: [
        { variationId: setV, price: 8800, saleSets: [{ setId: a!.id, changes: [{ byproductId: linkHook.id, action: "ADD", variationId: hookV }] }] },
        { variationId: setV, price: 8500, saleSets: [{ setId: c!.id }] },
      ],
    });
    expect(edit.status).toBe(200);
    expect([await status(a!.id), await status(b!.id), await status(c!.id)]).toEqual(["HELD", "IN_STOCK", "HELD"]);

    // Deliver: one sale, the planned hook fitted to A, both sets sold, order completed.
    const done = await post(s.manager, `/api/orders/${oid}/complete`, { version: edit.body.version });
    expect(done.status).toBe(201);
    expect([await status(a!.id), await status(c!.id)]).toEqual(["SOLD", "SOLD"]);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: done.body.documentId } });
    expect(sale.total.toFixed(2)).toBe("17300.00");
    expect(await prisma.groupSetPart.count({ where: { setId: a!.id, variationId: hookV, status: "SOLD" } })).toBe(1);
    view = (await s.manager.get(`/api/orders/${oid}`)).body.order;
    expect(view.status).toBe("COMPLETED");

    // Cancel the delivery: the order reopens and holds its sets again.
    expect((await post(s.manager, `/api/sales/${sale.id}/void`, { reason: "Customer returned" })).status).toBe(200);
    expect([await status(a!.id), await status(c!.id)]).toEqual(["HELD", "HELD"]);
    view = (await s.manager.get(`/api/orders/${oid}`)).body.order;
    expect(view.status).not.toBe("COMPLETED");

    // Cancel the order: its sets go back on sale.
    expect((await post(s.manager, `/api/orders/${oid}/cancel`, { reason: "Customer changed mind", version: view.version })).status).toBe(200);
    expect([await status(a!.id), await status(c!.id)]).toEqual(["IN_STOCK", "IN_STOCK"]);
    expect((await prisma.groupSet.findUniqueOrThrow({ where: { id: a!.id } })).orderId).toBeNull();
    const drift = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM set_allocation_drift WHERE company_id = ${s.co.id}`;
    expect(Number(drift[0]!.n)).toBe(0);
  });

  it("purchase orders receive sets: entered on the order, or at receipt", async () => {
    const s = await setup();
    const g = await makeHoist(s);
    const [linkChain] = g.grouped.byproducts;
    const c3 = linkChain.variations[0].id;
    const c4 = linkChain.variations[1].id;
    const setV = g.variations[0].id;
    const supplier = (await post(s.admin, "/api/parties", { type: "SUPPLIER", name: `PO Supp ${s.tag}` })).body.party.id;
    const set = (variationId: string, length: number) => ({ parts: [{ byproductId: linkChain.id, variationId, length }] });

    // 1. Sets entered on the order: completing receives exactly those.
    const po1 = await post(s.manager, "/api/orders", { kind: "PURCHASE", status: "PLACED", partyId: supplier, lines: [{ variationId: setV, price: 6200, sets: [set(c3, 3), set(c4, 4)] }] });
    expect(po1.status).toBe(201);
    expect((await post(s.manager, "/api/orders", { kind: "PURCHASE", partyId: supplier, lines: [{ variationId: setV, price: 6200, sets: [{ parts: [] }] }] })).body.error.code).toBe("BYPRODUCT_REQUIRED");
    const v1 = (await s.manager.get(`/api/orders/${po1.body.id}`)).body.order;
    expect(v1.lines[0].quantity).toBe(2);
    expect(v1.lines[0].sets).toHaveLength(2);
    const r1 = await post(s.manager, `/api/orders/${po1.body.id}/complete`, { version: v1.version });
    expect(r1.status).toBe(201);
    const sets1 = await prisma.groupSet.findMany({ where: { purchaseId: r1.body.documentId } });
    expect(sets1).toHaveLength(2);
    expect(sets1.every((x) => x.status === "IN_STOCK" && x.rate.toFixed(2) === "6200.00")).toBe(true);
    expect(await prisma.vendorPrice.count({ where: { variationId: setV } })).toBe(0); // D24

    // 2. Only the number of sets on the order: the sets are entered when they arrive, in parts.
    const po2 = await post(s.manager, "/api/orders", { kind: "PURCHASE", status: "PLACED", partyId: supplier, lines: [{ variationId: setV, quantity: 3, price: 6000 }] });
    expect(po2.status).toBe(201);
    let v2 = (await s.manager.get(`/api/orders/${po2.body.id}`)).body.order;
    expect((await post(s.manager, `/api/orders/${po2.body.id}/complete`, { version: v2.version })).body.error.code).toBe("SETS_REQUIRED");
    const lineId = v2.lines[0].id;
    const part = await post(s.manager, `/api/orders/${po2.body.id}/fulfill`, { version: v2.version, lines: [{ orderLineId: lineId, sets: [set(c3, 2), set(c3, 2.5)] }] });
    expect(part.status).toBe(201);
    v2 = (await s.manager.get(`/api/orders/${po2.body.id}`)).body.order;
    expect(v2.status).toBe("PARTIALLY_FULFILLED");
    expect(v2.lines[0].outstandingQuantity).toBe(1);
    const rest = await post(s.manager, `/api/orders/${po2.body.id}/fulfill`, { version: v2.version, lines: [{ orderLineId: lineId, sets: [set(c4, 3)] }] });
    expect(rest.status).toBe(201);
    expect((await s.manager.get(`/api/orders/${po2.body.id}`)).body.order.status).toBe("COMPLETED");
    expect((await s.admin.get(`/api/sets?groupId=${g.id}`)).body.counts.IN_STOCK).toBe(5);
  });

  it("edits the by-product links: removed links keep existing sets' parts", async () => {
    const s = await setup();
    const g = await makeHoist(s);
    const put = (body: unknown) => s.admin.put(`/api/sets/definition/${g.id}`).set("Origin", ORIGIN).send(body as object);
    expect((await put({ byproducts: [{ productId: s.chain.id, required: true }] })).status).toBe(200);
    let p = (await s.admin.get(`/api/products/${g.id}`)).body.product;
    expect(p.grouped.byproducts.map((b: { name: string }) => b.name)).toEqual(["Load Chain"]);
    expect((await put({ byproducts: [{ productId: s.chain.id, required: true }, { productId: s.hook.id, required: true }] })).status).toBe(200);
    p = (await s.admin.get(`/api/products/${g.id}`)).body.product;
    expect(p.grouped.byproducts.map((b: { name: string; required: boolean }) => [b.name, b.required])).toEqual([
      ["Load Chain", true],
      ["Hook", true],
    ]);
    expect((await put({ byproducts: [{ productId: g.grouped.main.productId, required: true }] })).body.error.code).toBe("BYPRODUCT_MAIN");
  });
});
