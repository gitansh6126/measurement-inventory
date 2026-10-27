import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

async function setup() {
  const co = await makeCompany();
  const admin = await makeUser(co.id, "admin");
  const manager = await makeUser(co.id, "sales_manager");
  const staff = await makeUser(co.id, "sales_staff");
  return { co, admin: await signIn(admin.email), manager: await signIn(manager.email), staff: await signIn(staff.email), adminId: admin.id };
}

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const patch = (a: Agent, url: string, body: unknown) => a.patch(url).set("Origin", ORIGIN).send(body as object);
const put = (a: Agent, url: string, body: unknown) => a.put(url).set("Origin", ORIGIN).send(body as object);

const rope = (extra: object = {}) => ({
  productType: "variable",
  name: "Wire Rope",
  unit: "Mtr",
  baseShortName: "rope",
  attributes: [
    { name: "Size", unit: "mm", values: ["6", "8", "10"] },
    { name: "Brand", values: ["Crossbee", "Halfen"], abbrMap: { Crossbee: "CB" } },
  ],
  variations: [{ attributes: { Size: "8", Brand: "Crossbee" } }, { attributes: { Size: "6", Brand: "Halfen" }, officialSku: null }],
  ...extra,
});

describe("categories", () => {
  it("creates, renames, deactivates and counts active products; names are unique case-insensitively", async () => {
    const { manager, staff } = await setup();
    const created = await post(manager, "/api/categories", { name: "Lifting Gear" });
    expect(created.status).toBe(201);
    const id = created.body.category.id;
    expect((await post(manager, "/api/categories", { name: "lifting gear" })).status).toBe(409);
    expect((await post(staff, "/api/categories", { name: "Tools" })).status).toBe(403);

    await post(manager, "/api/products", { productType: "simple", name: "D-Shackle", unit: "Nos", shortName: "dsh", categoryId: id });
    const list = await manager.get("/api/categories");
    expect(list.body.categories.find((c: { id: string }) => c.id === id).productCount).toBe(1);
    expect(list.body.totalCount).toBe(1);

    expect((await patch(manager, `/api/categories/${id}`, { active: false })).body.category.active).toBe(false);
    expect((await manager.get("/api/categories")).body.categories.some((c: { id: string }) => c.id === id)).toBe(false);
    expect((await manager.get("/api/categories?status=all")).body.categories.some((c: { id: string }) => c.id === id)).toBe(true);
    // An inactive category cannot receive new products.
    const r = await post(manager, "/api/products", { productType: "simple", name: "Hook", unit: "Nos", shortName: "hook", categoryId: id });
    expect(r.body.error.code).toBe("INACTIVE_CATEGORY");
  });

  it("attaches an existing product, moves it, and detaches it — all audited", async () => {
    const { manager, co } = await setup();
    const a = (await post(manager, "/api/categories", { name: "A" })).body.category.id;
    const b = (await post(manager, "/api/categories", { name: "B" })).body.category.id;
    const p = (await post(manager, "/api/products", { productType: "simple", name: "Sling", unit: "Nos", shortName: "sl" })).body.product.id;

    expect((await post(manager, `/api/categories/${a}/products`, { productId: p })).status).toBe(200);
    expect((await post(manager, `/api/categories/${b}/products`, { productId: p })).status).toBe(200);
    const detail = await manager.get(`/api/categories/${b}`);
    expect(detail.body.products.map((x: { id: string }) => x.id)).toEqual([p]);
    expect((await manager.delete(`/api/categories/${a}/products/${p}`).set("Origin", ORIGIN)).status).toBe(404);
    expect((await manager.delete(`/api/categories/${b}/products/${p}`).set("Origin", ORIGIN)).status).toBe(200);
    expect((await manager.get(`/api/products/${p}`)).body.product.category).toBeNull();

    const actions = await prisma.auditEvent.findMany({ where: { companyId: co.id, entityId: p }, orderBy: { createdAt: "asc" }, select: { action: true } });
    expect(actions.map((x) => x.action)).toEqual(["PRODUCT_CREATE", "CATEGORY_ATTACH", "CATEGORY_ATTACH", "CATEGORY_DETACH"]);
  });
});

describe("products", () => {
  it("creates a Simple product with one variation, zero commercial values (BR-08a) and an audit event", async () => {
    const { manager, co } = await setup();
    const res = await post(manager, "/api/products", { productType: "simple", name: "D-Shackle", unit: "Nos", shortName: " dsh-10 ", officialSku: "RS-1001" });
    expect(res.status).toBe(201);
    const p = res.body.product;
    expect(p.variations).toHaveLength(1);
    expect(p.variations[0]).toMatchObject({ shortName: "DSH-10", officialSku: "RS-1001", attributes: {}, salePrice: "0.00", purchaseCost: "0.00", lowStockThreshold: 0 });
    expect(await prisma.auditEvent.count({ where: { companyId: co.id, entityId: p.id, action: "PRODUCT_CREATE" } })).toBe(1);
  });

  it("creates a Variable product with generated codes and keeps unused declared values", async () => {
    const { manager } = await setup();
    const res = await post(manager, "/api/products", rope());
    expect(res.status).toBe(201);
    const p = res.body.product;
    expect(p.baseShortName).toBe("ROPE");
    expect(p.attributes[0].values).toEqual(["6", "8", "10"]); // "10" is declared but not instantiated
    expect(p.variations.map((v: { shortName: string; officialSku: string | null }) => [v.shortName, v.officialSku])).toEqual([
      ["8MM-CB-ROPE", "8-CB-ROPE"],
      ["6MM-HALFEN-ROPE", null],
    ]);
  });

  it("persists child variation order for the company and audits the reorder", async () => {
    const { manager, staff, co } = await setup();
    const product = (await post(manager, "/api/products", rope())).body.product;
    const original = product.variations.map((v: { id: string }) => v.id);
    const reordered = [...original].reverse();

    expect((await put(staff, `/api/products/${product.id}/variations/order`, { variationIds: reordered })).status).toBe(403);
    expect((await put(manager, `/api/products/${product.id}/variations/order`, { variationIds: [original[0], original[0]] })).status).toBe(400);
    expect((await put(manager, `/api/products/${product.id}/variations/order`, { variationIds: [original[0]] })).body.error.code).toBe("VARIATIONS_CHANGED");

    const response = await put(manager, `/api/products/${product.id}/variations/order`, { variationIds: reordered });
    expect(response.status).toBe(200);
    const detail = await staff.get(`/api/products/${product.id}`);
    expect(detail.body.product.variations.map((v: { id: string }) => v.id)).toEqual(reordered);
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { companyId: co.id, entityId: product.id, action: "VARIATION_REORDER" } });
    expect(event.after).toMatchObject({ order: reordered.map((id: string, sortOrder: number) => ({ id, sortOrder })) });

    const added = await post(manager, `/api/products/${product.id}/variations`, {
      variations: [{ attributes: { Size: "10", Brand: "Crossbee" } }],
    });
    expect(added.status).toBe(201);
    const afterAdd = await staff.get(`/api/products/${product.id}`);
    const addedId = added.body.product.variations.find((v: { id: string }) => !reordered.includes(v.id)).id;
    expect(afterAdd.body.product.variations.map((v: { id: string }) => v.id)).toEqual([...reordered, addedId]);
  });

  it("enforces Short Name and case-insensitive Official SKU uniqueness; blank SKUs never collide", async () => {
    const { manager } = await setup();
    await post(manager, "/api/products", { productType: "simple", name: "A", unit: "Nos", shortName: "AAA", officialSku: "Sku-1" });
    expect((await post(manager, "/api/products", { productType: "simple", name: "B", unit: "Nos", shortName: "aaa" })).body.error.code).toBe("SHORT_NAME_TAKEN");
    expect((await post(manager, "/api/products", { productType: "simple", name: "B", unit: "Nos", shortName: "BBB", officialSku: "SKU-1" })).body.error.code).toBe("OFFICIAL_SKU_TAKEN");
    for (const s of ["C1", "C2", "C3"]) {
      expect((await post(manager, "/api/products", { productType: "simple", name: s, unit: "Nos", shortName: s, officialSku: "" })).status).toBe(201);
    }
  });

  it("lets the database decide a concurrent Short Name race (one 201, the rest 409)", async () => {
    const { manager } = await setup();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => post(manager, "/api/products", { productType: "simple", name: `Race ${i}`, unit: "Nos", shortName: "RACE" })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
  });

  it("isolates companies: same codes are allowed in another company, and other companies' products are invisible", async () => {
    const one = await setup();
    const two = await setup();
    const p = (await post(one.manager, "/api/products", { productType: "simple", name: "X", unit: "Nos", shortName: "SAME", officialSku: "SAME" })).body.product.id;
    expect((await post(two.manager, "/api/products", { productType: "simple", name: "X", unit: "Nos", shortName: "SAME", officialSku: "SAME" })).status).toBe(201);
    expect((await two.manager.get(`/api/products/${p}`)).status).toBe(404);
    expect((await patch(two.manager, `/api/products/${p}`, { name: "Hacked" })).status).toBe(404);
    const cat = (await post(one.manager, "/api/categories", { name: "Mine" })).body.category.id;
    const r = await post(two.manager, "/api/products", { productType: "simple", name: "Y", unit: "Nos", shortName: "Y", categoryId: cat });
    expect(r.body.error.code).toBe("UNKNOWN_CATEGORY");
  });

  it("searches by name, Short Name and Official SKU, and filters by category and status", async () => {
    const { manager, admin } = await setup();
    const cat = (await post(manager, "/api/categories", { name: "Ropes" })).body.category.id;
    const r = (await post(manager, "/api/products", rope({ categoryId: cat }))).body.product;
    await post(manager, "/api/products", { productType: "simple", name: "Hook", unit: "Nos", shortName: "HK" });
    const ids = async (qs: string) => (await manager.get(`/api/products?${qs}`)).body.products.map((p: { id: string }) => p.id);
    expect(await ids("q=wire")).toEqual([r.id]);
    expect(await ids("q=8mm-cb")).toEqual([r.id]);
    expect(await ids("q=8-CB-ROPE")).toEqual([r.id]);
    expect(await ids(`categoryId=${cat}`)).toEqual([r.id]);
    expect((await ids("uncategorized=true")).length).toBe(1);
    await patch(admin, `/api/products/${r.id}`, { active: false });
    expect(await ids("q=wire")).toEqual([]);
    expect(await ids("q=wire&status=archived")).toEqual([r.id]);
  });

  it("archives instead of deleting, and only admins archive (main v2 BR-24)", async () => {
    const { manager, admin, staff, co } = await setup();
    const p = (await post(manager, "/api/products", { productType: "simple", name: "Hook", unit: "Nos", shortName: "HK" })).body.product.id;
    expect((await patch(staff, `/api/products/${p}`, { name: "Nope" })).status).toBe(403);
    expect((await patch(manager, `/api/products/${p}`, { active: false })).status).toBe(403);
    expect((await patch(admin, `/api/products/${p}`, { active: false })).body.product.active).toBe(false);
    expect((await patch(admin, `/api/products/${p}`, { active: true })).body.product.active).toBe(true);
    expect((await manager.delete(`/api/products/${p}`).set("Origin", ORIGIN)).status).toBe(404); // no delete route exists
    const actions = (await prisma.auditEvent.findMany({ where: { companyId: co.id, entityId: p }, orderBy: { createdAt: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(["PRODUCT_CREATE", "PRODUCT_ARCHIVE", "PRODUCT_RESTORE"]);
  });

  it("edits a Simple product's codes; a Variable product's codes are edited per variation", async () => {
    const { manager } = await setup();
    const s = (await post(manager, "/api/products", { productType: "simple", name: "Hook", unit: "Nos", shortName: "HK" })).body.product;
    const edited = await patch(manager, `/api/products/${s.id}`, { shortName: "hk-2", officialSku: "OFF-9" });
    expect(edited.body.product).toMatchObject({ baseShortName: "HK-2", variations: [{ shortName: "HK-2", officialSku: "OFF-9" }] });

    const v = (await post(manager, "/api/products", rope())).body.product;
    expect((await patch(manager, `/api/products/${v.id}`, { shortName: "X" })).body.error.code).toBe("USE_VARIATION");
    const vr = await patch(manager, `/api/products/${v.id}/variations/${v.variations[1].id}`, { officialSku: "HAL-6" });
    expect(vr.body.variation.officialSku).toBe("HAL-6");
    expect((await patch(manager, `/api/products/${v.id}/variations/${v.variations[0].id}`, { officialSku: "hal-6" })).body.error.code).toBe("OFFICIAL_SKU_TAKEN");
  });

  it("adds variations from declared values and refuses existing combinations", async () => {
    const { manager } = await setup();
    const p = (await post(manager, "/api/products", rope())).body.product;
    const added = await post(manager, `/api/products/${p.id}/variations`, { variations: [{ attributes: { Size: "10", Brand: "Crossbee" } }] });
    expect(added.status).toBe(201);
    expect(added.body.product.variations).toHaveLength(3);
    const dup = await post(manager, `/api/products/${p.id}/variations`, { variations: [{ attributes: { Brand: "Crossbee", Size: "8" } }] });
    expect(dup.body.error.code).toBe("DUPLICATE_COMBINATION");
    const undeclared = await post(manager, `/api/products/${p.id}/variations`, { variations: [{ attributes: { Size: "12", Brand: "Crossbee" } }] });
    expect(undeclared.body.error.code).toBe("UNDECLARED_VALUE");
  });

  it("extends attributes safely and never lets an edit orphan a variation", async () => {
    const { manager } = await setup();
    const p = (await post(manager, "/api/products", rope())).body.product;
    const extended = await patch(manager, `/api/products/${p.id}`, {
      attributes: [
        { name: "Size", unit: "mm", values: ["6", "8", "10", "12"] },
        { name: "Brand", values: ["Crossbee", "Halfen"], abbrMap: { Crossbee: "CB" } },
      ],
    });
    expect(extended.status).toBe(200);
    const removeUsed = await patch(manager, `/api/products/${p.id}`, {
      attributes: [{ name: "Size", values: ["6", "10"] }, { name: "Brand", values: ["Crossbee", "Halfen"] }],
    });
    expect(removeUsed.body.error.code).toBe("VALUE_IN_USE");
    const rename = await patch(manager, `/api/products/${p.id}`, {
      attributes: [{ name: "Diameter", values: ["6", "8"] }, { name: "Brand", values: ["Crossbee", "Halfen"] }],
    });
    expect(rename.body.error.code).toBe("ATTRIBUTES_LOCKED");
  });

  it("archives variations (admin only) but never the last active one", async () => {
    const { manager, admin } = await setup();
    const p = (await post(manager, "/api/products", rope())).body.product;
    const [v1, v2] = p.variations;
    expect((await patch(manager, `/api/products/${p.id}/variations/${v1.id}`, { active: false })).status).toBe(403);
    expect((await patch(admin, `/api/products/${p.id}/variations/${v1.id}`, { active: false })).body.variation.active).toBe(false);
    expect((await patch(admin, `/api/products/${p.id}/variations/${v2.id}`, { active: false })).body.error.code).toBe("LAST_VARIATION");
  });

  it("rejects invalid input with field details", async () => {
    const { manager } = await setup();
    const r = await post(manager, "/api/products", { productType: "variable", name: "", unit: "Nos", baseShortName: "X", attributes: [], variations: [] });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("VALIDATION");
    expect(r.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(["name", "attributes", "variations"]));
  });
});
