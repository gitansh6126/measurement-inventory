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

  it("standard sets keep their own technical specifications and image (0044)", async () => {
    const s = await setup();
    const g = await makeHoist(s);
    const [linkChain] = g.grouped.byproducts;
    const c3 = linkChain.variations[0].id;
    const save = (sets: object[]) => s.admin.put(`/api/sets/types/${g.id}/standard`).set("Origin", ORIGIN).send({ sets });
    const r = await save([
      {
        name: "Plain 3 m",
        parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }],
        specs: [{ name: "Lifting height", value: "3 m" }, { name: "", value: "" }],
        imageUrl: "https://example.com/plain-3m.png",
      },
    ]);
    expect(r.status).toBe(200);
    expect(r.body.types[0]).toMatchObject({ name: "Plain 3 m", specs: [{ name: "Lifting height", value: "3 m" }], imageUrl: "https://example.com/plain-3m.png" });
    // Saving again without them clears them; an image that is neither uploaded nor http(s) is refused.
    expect((await save([{ name: "Plain 3 m", parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }] }])).body.types[0]).toMatchObject({ specs: [], imageUrl: null });
    expect((await save([{ parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }], imageUrl: "ftp://x/y.png" }])).status).toBe(400);
  });

  it("standard sets: prices per set type, Stock In builds and undoes sets, sale price from the type (0041)", async () => {
    const s = await setup();
    const g = await makeHoist(s);
    const [linkChain, linkHook] = g.grouped.byproducts;
    const c3 = linkChain.variations[0].id;
    const hookV = linkHook.variations[0].id;
    const std = await s.admin
      .put(`/api/sets/types/${g.id}/standard`)
      .set("Origin", ORIGIN)
      .send({
        sets: [
          { name: "3 m + hook", parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }, { byproductId: linkHook.id, variationId: hookV }], salePrice: "8500", minSalePrice: "7800", lowStockThreshold: 1 },
          { name: "Plain 3 m", parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }], salePrice: "8000" },
        ],
      });
    expect(std.status).toBe(200);
    expect(std.body.types.map((t: { name: string; count: number; salePrice: string }) => [t.name, t.count, Number(t.salePrice)])).toEqual([
      ["3 m + hook", 0, 8500],
      ["Plain 3 m", 0, 8000],
    ]);
    // Same parts twice is refused; a missing required part too.
    const dup = await s.admin.put(`/api/sets/types/${g.id}/standard`).set("Origin", ORIGIN).send({ sets: [std.body.types[1], std.body.types[1]].map((t) => ({ parts: t.parts.map((p: { byproductId: string; variationId: string; length: number | null }) => ({ ...p, length: p.length ?? undefined })) })) });
    expect(dup.status).toBe(400);
    const key = std.body.types[0].typeKey;

    // Stock In: 0 → 2 builds two sets (parts come in as new stock), and sets the price.
    const up = await post(s.admin, `/api/sets/types/${g.id}/stock-in`, { reason: "Opening Stock", rows: [{ typeKey: key, expectedCount: 0, count: 2, salePrice: "8600" }] });
    expect(up.status).toBe(200);
    expect(up.body).toEqual({ added: 2, removed: 0 });
    let types = (await s.admin.get(`/api/sets/types/${g.id}`)).body.types;
    expect(types[0]).toMatchObject({ typeKey: key, count: 2, openingCount: 2, salePrice: "8600" });
    expect(Number((await prisma.stockBalance.findUniqueOrThrow({ where: { variationId: hookV } })).quantity)).toBe(2);
    // The sets carry the key; the sale drawer reads the type price.
    const listed = (await s.admin.get(`/api/sets?groupId=${g.id}`)).body;
    expect(listed.sets.every((x: { typeKey: string }) => x.typeKey === key)).toBe(true);
    expect(listed.typePrices[key].salePrice).toBe("8600.00");

    // Stale count refused; 2 → 1 undoes one opening set.
    expect((await post(s.admin, `/api/sets/types/${g.id}/stock-in`, { rows: [{ typeKey: key, expectedCount: 5, count: 1 }] })).status).toBe(409);
    const down = await post(s.admin, `/api/sets/types/${g.id}/stock-in`, { reason: "Correction", rows: [{ typeKey: key, expectedCount: 2, count: 1 }] });
    expect(down.body).toEqual({ added: 0, removed: 1 });
    types = (await s.admin.get(`/api/sets/types/${g.id}`)).body.types;
    expect(types[0].count).toBe(1);
    expect(Number((await prisma.stockBalance.findUniqueOrThrow({ where: { variationId: hookV } })).quantity)).toBe(1);
    // Stock In tabs follow each set type's own minimum stock: "3 m + hook" (1 ≤ 1) is low,
    // "Plain 3 m" (standard, 0 in stock) is out.
    const tab = async (state: string) => (await s.admin.get(`/api/inventory?state=${state}&q=Chain%20Hoist`)).body.products.map((p: { id: string }) => p.id);
    expect(await tab("low")).toContain(g.id);
    expect(await tab("out")).toContain(g.id);

    // Add sets sheet: prices for a new (not standard) set type.
    const open = await post(s.admin, "/api/sets/opening", { groupId: g.id, sets: [{ rate: 0, parts: [{ byproductId: linkChain.id, variationId: c3, length: 4 }], salePrice: "9100", lowStockThreshold: 2 }] });
    expect(open.status).toBe(201);
    types = (await s.admin.get(`/api/sets/types/${g.id}`)).body.types;
    expect(types.find((t: { standard: boolean; count: number }) => !t.standard && t.count === 1)).toMatchObject({ salePrice: "9100", lowStockThreshold: 2, priced: true });

    // A sales manager may change set prices (like any item's) but not add or remove sets (admin, D20).
    expect((await post(s.manager, `/api/sets/types/${g.id}/stock-in`, { rows: [{ typeKey: key, salePrice: "8700" }] })).status).toBe(200);
    expect((await post(s.manager, `/api/sets/types/${g.id}/stock-in`, { rows: [{ typeKey: key, expectedCount: 1, count: 2 }] })).status).toBe(403);
  });

  it("child-row order: set types and measured variations keep the saved order everywhere (V3.2 A2)", async () => {
    const s = await setup();
    const g = await makeHoist(s);
    const [linkChain, linkHook] = g.grouped.byproducts;
    const [c3, c4] = linkChain.variations.map((v: { id: string }) => v.id);
    const put = (url: string, body: unknown) => s.admin.put(url).set("Origin", ORIGIN).send(body as object);
    await put(`/api/sets/types/${g.id}/standard`, {
      sets: [
        { name: "A", parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }] },
        { name: "B", parts: [{ byproductId: linkChain.id, variationId: c4, length: 3 }] },
      ],
    });
    // A set type in stock that was never placed or priced comes last.
    await post(s.admin, "/api/sets/opening", { groupId: g.id, sets: [{ rate: 0, parts: [{ byproductId: linkChain.id, variationId: c3, length: 5 }, { byproductId: linkHook.id, variationId: linkHook.variations[0].id }] }] });
    const names = async () => (await s.admin.get(`/api/sets/types/${g.id}`)).body.types.map((t: { name: string | null }) => t.name ?? "C");
    expect(await names()).toEqual(["A", "B", "C"]);
    const keys = (await s.admin.get(`/api/sets/types/${g.id}`)).body.types.map((t: { typeKey: string }) => t.typeKey);
    const res = await put(`/api/sets/types/${g.id}/order`, { typeKeys: [keys[2], keys[0], keys[1]] });
    expect(res.status).toBe(200);
    expect(await names()).toEqual(["C", "A", "B"]);
    // The unplaced type got a row that keeps its shown price (no price change from ordering).
    expect((await s.admin.get(`/api/sets/types/${g.id}`)).body.types[0]).toMatchObject({ priced: true, salePrice: "0" });
    expect((await put(`/api/sets/types/${g.id}/order`, { typeKeys: [keys[0], keys[0]] })).status).toBe(400);
    expect((await put(`/api/sets/types/${g.id}/order`, { typeKeys: ["nope"] })).status).toBe(409);
    // Only product editors reorder.
    const staff = await signIn((await makeUser(s.co.id, "sales_staff")).email);
    expect((await staff.put(`/api/sets/types/${g.id}/order`).set("Origin", ORIGIN).send({ typeKeys: keys })).status).toBe(403);

    // Measured variations: the pieces list (Stock In / Products rows) follows the saved order.
    expect((await put(`/api/products/${s.chain.id}/variations/order`, { variationIds: [c4, c3] })).status).toBe(200);
    const pieces = (await s.admin.get(`/api/measure/products/${s.chain.id}/pieces?status=active`)).body;
    expect(pieces.variations.map((v: { id: string }) => v.id)).toEqual([c4, c3]);
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

  it("buys sets on a purchase: one line per rate, parts received into sets, supplier set rate saved (phase 2, V3.2 A3)", async () => {
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
    // V3.2 A3: buying sets saves the supplier's set rate on the grouped product (the last line's
    // rate wins, both are in the history); the loose hook gets its own rate as before.
    expect(await prisma.vendorPrice.findMany({ where: { variationId: setV }, select: { supplierId: true } })).toEqual([{ supplierId: supplier }]);
    expect((await prisma.vendorPrice.findFirstOrThrow({ where: { variationId: setV } })).rate.toFixed(2)).toBe("7400.00");
    expect((await prisma.vendorPriceHistory.findMany({ where: { variationId: setV } })).map((h) => h.rate.toFixed(2)).sort()).toEqual(["6200.00", "7400.00"]);
    expect(await prisma.vendorPrice.count({ where: { variationId: hookV } })).toBe(1);
    const best = (await s.manager.get(`/api/vendor-prices/best?variationIds=${setV}&supplierId=${supplier}`)).body.suggestions[0];
    expect(best).toMatchObject({ supplierRate: "7400.00", suggested: "7400.00" });
    const piece = await prisma.measurementPiece.findFirstOrThrow({ where: { variationId: c4 } });
    expect(piece).toMatchObject({ purchaseId: doc.id, kind: "CUT", setOrigin: true });
    // Owner 2026-10-30: every custom set bought became a standard set (3 kinds, in purchase order).
    const types = (await s.manager.get(`/api/sets/types/${g.id}`)).body.types as { standard: boolean; count: number }[];
    expect(types.map((t) => [t.standard, t.count])).toEqual([[true, 1], [true, 1], [true, 1]]);

    // Sets are not edited on a purchase: cancel and enter again.
    const edit = await post(s.manager, `/api/purchases/${doc.id}/edit`, { partyId: supplier, reason: "Fix quantity", lines: [{ variationId: hookV, quantity: 2, price: 300 }] });
    expect(edit.body.error.code).toBe("SETS_NOT_EDITABLE");

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

  it("edits a sale with sets: keep, swap, change parts, reprice, renamed names; stock follows (V3.2)", async () => {
    const s = await setup();
    const g = await makeHoist(s);
    const [linkChain, linkHook] = g.grouped.byproducts;
    const c3 = linkChain.variations[0].id;
    const c4 = linkChain.variations[1].id;
    const hookV = linkHook.variations[0].id;
    const mainV = g.grouped.main.variationId;
    const setV = g.variations[0].id;
    const withHook = { rate: 6200, parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }, { byproductId: linkHook.id, variationId: hookV }] };
    const opening = await post(s.admin, "/api/sets/opening", { groupId: g.id, sets: [withHook, withHook, { rate: 6200, parts: [{ byproductId: linkChain.id, variationId: c3, length: 3 }] }] });
    expect(opening.status).toBe(201);
    const [a, b, c] = opening.body.sets as { id: string; code: string }[];
    expect((await post(s.admin, `/api/measure/variations/${c4}/rolls`, { rolls: [{ length: 50 }] })).status).toBe(201);
    expect((await post(s.admin, "/api/inventory/adjustments", { variationId: hookV, quantity: 2, reason: "Found" })).status).toBe(201);
    const balance = async (id: string) => Number((await prisma.stockBalance.findUnique({ where: { variationId: id } }))?.quantity ?? 0);
    const stock = async () => [await balance(mainV), await balance(c3), await balance(c4), await balance(hookV)];
    const set = (id: string) => prisma.groupSet.findUniqueOrThrow({ where: { id }, include: { parts: { where: { status: { in: ["ALLOCATED", "SOLD"] } } } } });
    const partsOf = async (id: string) => (await set(id)).parts.map((p) => p.variationId).sort();
    const drift = async () => Number((await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM set_allocation_drift WHERE company_id = ${s.co.id}`)[0]!.n);
    const oldChainA = (await prisma.measurementPiece.findFirstOrThrow({ where: { setId: a!.id } })).id;

    // The sale: A with its chain changed 3 mm → 4 mm, B as it is, and a loose hook.
    const res = await post(s.manager, "/api/sales", {
      lines: [
        { variationId: setV, price: 8920, saleSets: [{ setId: a!.id, changes: [{ byproductId: linkChain.id, action: "REPLACE", variationId: c4, length: 3 }] }] },
        { variationId: setV, price: 8500, saleSets: [{ setId: b!.id }] },
        { variationId: hookV, quantity: 1, price: 300 },
      ],
    });
    expect(res.status).toBe(201);
    const sale1 = await prisma.sale.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(await stock()).toEqual([1, 6, 47, 1]);

    // Product and variation renamed after the sale: the revision takes today's names.
    await prisma.productGroup.update({ where: { id: g.id }, data: { name: "Chain Hoist Pro" } });
    await prisma.productVariation.update({ where: { id: hookV }, data: { shortName: `HKN${s.tag}` } });

    // The edit picker lists the sets sold on this sale.
    const soldList = (await s.manager.get(`/api/sets?groupId=${g.id}&status=SOLD&saleId=${sale1.id}`)).body.sets as { id: string; version: number }[];
    expect(soldList.map((x) => x.id).sort()).toEqual([a!.id, b!.id].sort());

    // Revision: A kept as sold (price 9000), B swapped for C with a hook added, loose hook kept.
    // A carries the version it was listed with; coming back in stock moves it on (not refused).
    const lines = [
      { variationId: setV, price: 9000, saleSets: [{ setId: a!.id, version: soldList.find((x) => x.id === a!.id)!.version }] },
      { variationId: setV, price: 8800, saleSets: [{ setId: c!.id, changes: [{ byproductId: linkHook.id, action: "ADD", variationId: hookV }] }] },
      { variationId: hookV, quantity: 1, price: 300 },
    ];
    const preview = await post(s.manager, `/api/sales/${sale1.id}/edit/preview`, { lines });
    expect(preview.status).toBe(200);
    expect(preview.body.sets).toEqual({ kept: 1, backInStock: [b!.code], newlySold: [c!.code], partChanges: 1 });
    expect(preview.body.stock.map((x: { variationId: string }) => x.variationId)).toEqual([hookV]);
    const setRow = preview.body.lines.find((l: { variationId: string }) => l.variationId === setV);
    expect(setRow).toMatchObject({ change: "changed", before: { quantity: 2, price: "8710.00" }, after: { quantity: 2, price: "8900.00" } });
    expect(preview.body.totals.after.total).toBe("18100.00");
    // A refused revision changes nothing.
    const bad = await post(s.manager, `/api/sales/${sale1.id}/edit`, { reason: "Fix", lines: [{ variationId: setV, price: 9000, saleSets: [{ setId: a!.id, changes: [{ byproductId: linkChain.id, action: "REMOVE" }] }] }] });
    expect(bad.body.error.code).toBe("PART_REQUIRED");
    expect((await set(a!.id)).status).toBe("SOLD");
    expect(await stock()).toEqual([1, 6, 47, 1]);

    const edit = await post(s.manager, `/api/sales/${sale1.id}/edit`, { reason: "Customer took set C", expectedNumber: sale1.number, lines });
    expect(edit.status).toBe(201);
    const sale2 = await prisma.sale.findUniqueOrThrow({ where: { id: edit.body.id }, include: { lines: { orderBy: { lineNo: "asc" } } } });
    expect(sale2.number).toBe(`${sale1.number}-R1`);
    expect(sale2.total.toFixed(2)).toBe("18100.00");
    expect(sale2.lines.map((l) => l.productNameSnapshot)).toEqual(["Chain Hoist Pro", "Chain Hoist Pro", "Hook"]);
    expect(sale2.lines[2]!.shortNameSnapshot).toBe(`HKN${s.tag}`);
    expect((await prisma.documentVoid.findFirstOrThrow({ where: { saleId: sale1.id } })).kind).toBe("REPLACED");
    // A sold again with the parts it was sold with; B back in stock as sold; C sold with a hook.
    const [sa, sb, sc] = [await set(a!.id), await set(b!.id), await set(c!.id)];
    expect([sa.status, sa.saleId, sa.saleLineNo]).toEqual(["SOLD", sale2.id, 1]);
    expect([sb.status, sb.saleId]).toEqual(["IN_STOCK", null]);
    expect([sc.status, sc.saleId, sc.saleLineNo]).toEqual(["SOLD", sale2.id, 2]);
    expect(await partsOf(a!.id)).toEqual([c4, hookV, mainV].sort());
    expect(await partsOf(b!.id)).toEqual([c3, hookV, mainV].sort());
    expect(await partsOf(c!.id)).toEqual([c3, hookV, mainV].sort());
    // Stock: main 3 − 2 sold; 3 mm = A's freed piece + B's chain; 4 mm unchanged (A still has it);
    // hooks: B's back in its set, C's taken from the last free one.
    expect(await stock()).toEqual([1, 6, 47, 1]);
    expect((await s.admin.get(`/api/inventory/products/${s.hook.id}`)).body.product.variations[0]).toMatchObject({ quantity: 0, inSets: 1 });
    const freed = await prisma.measurementPiece.findUniqueOrThrow({ where: { id: oldChainA } });
    expect([freed.setId, freed.status, Number(freed.remainingLength)]).toEqual([null, "ACTIVE", 3]);
    // The sale page names the sets by contents; the original cannot be edited again.
    const view = (await s.manager.get(`/api/sales/${sale2.id}`)).body.document;
    expect(view.lines.slice(0, 2).map((l: { sets: { name: string }[] }) => l.sets[0]!.name)).toEqual(["Chain Hoist Pro · 4 mm 3 m · Hook", "Chain Hoist Pro · 3 mm 3 m · Hook"]);
    expect((await post(s.manager, `/api/sales/${sale1.id}/edit`, { reason: "Again", lines })).body.error.code).toBe("ALREADY_REPLACED");
    expect(await drift()).toBe(0);

    // Second edit: A's chain back to 3 mm (cut from its old freed piece), C and the loose hook dropped.
    const edit2 = await post(s.manager, `/api/sales/${sale2.id}/edit`, {
      reason: "Chain size corrected",
      lines: [{ variationId: setV, price: 8500, saleSets: [{ setId: a!.id, changes: [{ byproductId: linkChain.id, action: "REPLACE", variationId: c3, length: 3, pieceId: oldChainA }] }] }],
    });
    expect(edit2.status).toBe(201);
    const sale3 = await prisma.sale.findUniqueOrThrow({ where: { id: edit2.body.id } });
    expect(sale3.number).toBe(`${sale1.number}-R2`);
    expect(await partsOf(a!.id)).toEqual([c3, hookV, mainV].sort());
    expect((await set(c!.id)).status).toBe("IN_STOCK");
    // 4 mm chain back as a free 3 m piece; C back with the hook it was sold with; loose hook back.
    expect(await stock()).toEqual([2, 6, 50, 3]);
    expect(await drift()).toBe(0);

    // Cancelling the latest revision brings A back in stock as sold.
    expect((await post(s.manager, `/api/sales/${sale3.id}/void`, { reason: "Returned" })).status).toBe(200);
    expect((await set(a!.id)).status).toBe("IN_STOCK");
    expect(await stock()).toEqual([3, 9, 50, 4]);
    expect(await drift()).toBe(0);
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

    // V3.2 edit of the delivery: the delivered sets cannot be swapped; a price fix keeps them.
    const swap = [{ variationId: setV, price: 8800, saleSets: [{ setId: a!.id }] }, { variationId: setV, price: 8500, saleSets: [{ setId: b!.id }] }];
    expect((await post(s.manager, `/api/sales/${sale.id}/edit/preview`, { lines: swap })).body.error.code).toBe("ORDER_SETS_LOCKED");
    expect((await post(s.manager, `/api/sales/${sale.id}/edit`, { reason: "Swap", lines: swap })).body.error.code).toBe("ORDER_SETS_LOCKED");
    const rev = await post(s.manager, `/api/sales/${sale.id}/edit`, {
      reason: "Price corrected",
      lines: [{ variationId: setV, price: 8700, saleSets: [{ setId: a!.id }] }, { variationId: setV, price: 8500, saleSets: [{ setId: c!.id }] }],
    });
    expect(rev.status).toBe(201);
    expect([await status(a!.id), await status(b!.id), await status(c!.id)]).toEqual(["SOLD", "IN_STOCK", "SOLD"]);
    expect((await prisma.groupSet.findUniqueOrThrow({ where: { id: a!.id } })).saleId).toBe(rev.body.id);
    expect(await prisma.groupSetPart.count({ where: { setId: a!.id, variationId: hookV, status: "SOLD" } })).toBe(1);
    expect((await s.manager.get(`/api/orders/${oid}`)).body.order.status).toBe("COMPLETED");

    // Cancel the delivery: the order reopens and holds its sets again.
    expect((await post(s.manager, `/api/sales/${rev.body.id}/void`, { reason: "Customer returned" })).status).toBe(200);
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
    expect((await prisma.vendorPrice.findFirstOrThrow({ where: { variationId: setV } })).rate.toFixed(2)).toBe("6200.00"); // A3

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

  it("holds the same by-product twice (two chains), each with its own size and length per set (0040)", async () => {
    const s = await setup();
    const res = await post(s.admin, "/api/products", {
      productType: "grouped",
      name: "Twin Chain Hoist",
      shortName: `TC${s.tag}`,
      main: { name: "Twin Body", shortName: `TB${s.tag}`, unit: "Nos" },
      byproducts: [
        { productId: s.chain.id, required: true, label: "Load chain" },
        { productId: s.chain.id, required: true, label: "Hand chain" },
        { productId: s.hook.id, required: false },
      ],
    });
    expect(res.status).toBe(201);
    const g = res.body.product;
    expect(g.grouped.byproducts.map((b: { name: string }) => b.name)).toEqual(["Load Chain · Load chain", "Load Chain · Hand chain", "Hook"]);
    const [load, hand] = g.grouped.byproducts;
    expect(load.id).not.toBe(hand.id);

    // Both chains are required; each gets its own cut piece with its own size and length.
    const missing = await post(s.admin, "/api/sets/opening", { groupId: g.id, sets: [{ rate: 6000, parts: [{ byproductId: load.id, variationId: load.variations[1].id, length: 3 }] }] });
    expect(missing.body.error).toMatchObject({ code: "BYPRODUCT_REQUIRED", message: expect.stringContaining("Hand chain") });
    const sets = await post(s.admin, "/api/sets/opening", {
      groupId: g.id,
      sets: [{ rate: 6500, parts: [{ byproductId: load.id, variationId: load.variations[1].id, length: 3 }, { byproductId: hand.id, variationId: hand.variations[0].id, length: 6 }] }],
    });
    expect(sets.status).toBe(201);
    const set = (await s.admin.get(`/api/sets?groupId=${g.id}`)).body.sets[0];
    expect(set.contents).toEqual([
      { name: "Load Chain · Load chain", value: expect.stringContaining("4 mm") },
      { name: "Load Chain · Hand chain", value: expect.stringContaining("3 mm") },
    ]);
    expect(await prisma.measurementPiece.count({ where: { setId: set.id } })).toBe(2);

    // Unlabelled repeats are numbered; editing by link keeps each repeat apart.
    const put = (body: unknown) => s.admin.put(`/api/sets/definition/${g.id}`).set("Origin", ORIGIN).send(body as object);
    expect(
      (await put({ byproducts: [{ linkId: load.id, productId: s.chain.id, required: true, label: null }, { linkId: hand.id, productId: s.chain.id, required: false }, { productId: s.chain.id, required: false }] })).status,
    ).toBe(200);
    const p = (await s.admin.get(`/api/products/${g.id}`)).body.product;
    expect(p.grouped.byproducts.map((b: { id: string; name: string; required: boolean }) => [b.name, b.required])).toEqual([
      ["Load Chain · #1", true],
      ["Load Chain · #2", false],
      ["Load Chain · #3", false],
    ]);
    expect(p.grouped.byproducts.slice(0, 2).map((b: { id: string }) => b.id)).toEqual([load.id, hand.id]);
  });
});
