import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// V3.1 categories on variations (0038, docs\VARIATION-CATEGORIES-V3-PLAN.md): a category of a head
// other than Product Type applies to the whole product or only to chosen variations (never both);
// a grouped product's sets are in a category through their parts (G-A).

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const patch = (a: Agent, url: string, body: unknown) => a.patch(url).set("Origin", ORIGIN).send(body as object);
const del = (a: Agent, url: string) => a.delete(url).set("Origin", ORIGIN);

type V = { id: string; attributes: Record<string, string>; categoryIds: string[] };
const byDia = (p: { variations: V[] }, d: string) => p.variations.find((v) => v.attributes.Diameter === d)!;

async function setup() {
  const co = await makeCompany();
  const admin = await signIn((await makeUser(co.id, "admin")).email);
  const tag = co.id.slice(-4).toUpperCase();
  const industry = (await post(admin, "/api/category-heads", { name: "Industry" })).body.head.id as string;
  const cat = async (name: string, headId: string | null = industry) =>
    (await post(admin, "/api/categories", { name, ...(headId ? { headId } : {}) })).body.category.id as string;
  const marine = await cat("Marine");
  const gym = await cat("Gym");
  const ropes = await cat("Wire Rope", null);
  const rope = await post(admin, "/api/products", {
    productType: "variable",
    name: "Wire Rope",
    unit: "m",
    baseShortName: `WR${tag}`,
    categoryId: ropes,
    attributes: [{ name: "Diameter", unit: "mm", values: ["6", "8", "12", "16"] }],
    variations: ["6", "8", "12", "16"].map((d) => ({ attributes: { Diameter: d }, ...(d === "12" || d === "16" ? { categoryIds: [marine] } : {}) })),
    categoryIds: [gym],
  });
  expect(rope.status).toBe(201);
  return { co, admin, tag, industry, marine, gym, ropes, cat, rope: rope.body.product };
}

describe("categories on variations", () => {
  it("creates a product with categories on some variations and lists only those under the category", async () => {
    const s = await setup();
    expect(s.rope.categories.map((c: { id: string }) => c.id)).toEqual([s.gym]);
    expect(s.rope.variationCategories).toEqual([expect.objectContaining({ id: s.marine, headName: "Industry" })]);
    expect([...s.rope.variationCategories[0].variationIds].sort()).toEqual([byDia(s.rope, "12").id, byDia(s.rope, "16").id].sort());
    expect(byDia(s.rope, "16").categoryIds).toEqual([s.marine]);
    expect(byDia(s.rope, "6").categoryIds).toEqual([]);

    // The product is in Marine (any level) and in its category's product count.
    const list = (await s.admin.get(`/api/products?categoryId=${s.marine}`)).body.products.map((p: { id: string }) => p.id);
    expect(list).toEqual([s.rope.id]);
    const counts = (await s.admin.get(`/api/categories?headId=${s.industry}`)).body.categories;
    expect(counts.find((c: { id: string }) => c.id === s.marine)).toMatchObject({ productCount: 1, partialCount: 1 });
    expect(counts.find((c: { id: string }) => c.id === s.gym)).toMatchObject({ productCount: 1, partialCount: 0 });

    // Stock In under Marine: only the 12 and 16 mm rows count (VC8); under Gym all of them.
    const marineInv = (await s.admin.get(`/api/inventory?categoryId=${s.marine}`)).body;
    expect(marineInv.products[0].categoryMatch.sort()).toEqual([byDia(s.rope, "12").id, byDia(s.rope, "16").id].sort());
    const gymInv = (await s.admin.get(`/api/inventory?categoryId=${s.gym}`)).body;
    expect(gymInv.products[0].categoryMatch).toBeNull();

    // Category page shows the scope.
    const detail = (await s.admin.get(`/api/categories/${s.marine}`)).body;
    expect(detail.products.map((p: { scope: string }) => p.scope)).toEqual(["variations"]);
  });

  it("refuses Product Type, other products' variations and a category already on the whole product", async () => {
    const s = await setup();
    const v6 = byDia(s.rope, "6").id;
    const res = await patch(s.admin, `/api/products/${s.rope.id}/variations/${v6}`, { categoryIds: [s.ropes] });
    expect(res.body.error.code).toBe("PRODUCT_TYPE_CATEGORY");
    expect((await patch(s.admin, `/api/products/${s.rope.id}/variations/${v6}`, { categoryIds: [s.gym] })).body.error.code).toBe("VARIATION_CATEGORY_WHOLE_PRODUCT");

    const simple = (await post(s.admin, "/api/products", { productType: "simple", name: "Clamp", unit: "Nos", shortName: `CL${s.tag}` })).body.product;
    expect((await post(s.admin, `/api/categories/${s.marine}/products`, { productId: simple.id, variationIds: [simple.variations[0].id] })).body.error.code).toBe("NOT_VARIABLE");
    expect((await post(s.admin, `/api/categories/${s.marine}/products`, { productId: s.rope.id, variationIds: [simple.variations[0].id] })).status).toBe(404);
    expect((await post(s.admin, `/api/categories/${s.ropes}/products`, { productId: s.rope.id, variationIds: [v6] })).body.error.code).toBe("PRODUCT_TYPE_WHOLE");

    // The database refuses both scopes at once even without the API (0038 triggers).
    await expect(
      prisma.variationCategory.create({ data: { variationId: v6, categoryId: s.gym, productId: s.rope.id, companyId: s.co.id } }),
    ).rejects.toThrow(/VARIATION_CATEGORY_WHOLE_PRODUCT/);
  });

  it("moves a category between all variations and some, from the product form and the category page", async () => {
    const s = await setup();
    const v8 = byDia(s.rope, "8").id;
    const v16 = byDia(s.rope, "16").id;

    // Form: Gym from all → only 8 mm; Marine from some → all.
    let res = await patch(s.admin, `/api/products/${s.rope.id}`, {
      categoryIds: [s.marine],
      variationCategories: [{ categoryId: s.gym, variationIds: [v8] }],
      version: s.rope.version,
    });
    expect(res.status).toBe(200);
    let p = res.body.product;
    expect(p.categories.map((c: { id: string }) => c.id)).toEqual([s.marine]);
    expect(p.variationCategories.map((c: { id: string; variationIds: string[] }) => [c.id, c.variationIds])).toEqual([[s.gym, [v8]]]);

    // Category page: Gym → 8 and 16 mm; then the whole product; then remove it.
    expect((await post(s.admin, `/api/categories/${s.gym}/products`, { productId: s.rope.id, variationIds: [v8, v16] })).status).toBe(200);
    p = (await s.admin.get(`/api/products/${s.rope.id}`)).body.product;
    expect(p.variationCategories[0].variationIds.sort()).toEqual([v8, v16].sort());
    expect((await del(s.admin, `/api/categories/${s.gym}/products/${s.rope.id}/variations/${v8}`)).status).toBe(200);
    expect((await post(s.admin, `/api/categories/${s.gym}/products`, { productId: s.rope.id })).status).toBe(200);
    p = (await s.admin.get(`/api/products/${s.rope.id}`)).body.product;
    expect(p.categories.map((c: { id: string }) => c.id).sort()).toEqual([s.gym, s.marine].sort());
    expect(p.variationCategories).toEqual([]);
    expect((await del(s.admin, `/api/categories/${s.gym}/products/${s.rope.id}`)).status).toBe(200);
    expect((await s.admin.get(`/api/products?categoryId=${s.gym}`)).body.products).toEqual([]);

    // A variation added later joins "All" categories only; it can bring its own (VC3).
    res = await post(s.admin, `/api/products/${s.rope.id}/variations`, { variations: [{ attributes: { Diameter: "20" }, categoryIds: [s.gym] }] });
    expect(res.status).toBe(400);
    await patch(s.admin, `/api/products/${s.rope.id}`, { attributes: [{ name: "Diameter", unit: "mm", values: ["6", "8", "12", "16", "20"] }] });
    res = await post(s.admin, `/api/products/${s.rope.id}/variations`, { variations: [{ attributes: { Diameter: "20" }, categoryIds: [s.gym] }] });
    expect(res.status).toBe(201);
    expect(byDia(res.body.product, "20").categoryIds).toEqual([s.gym]);
  });

  it("puts sets in a category through their fitted parts (G-A) and backs the links up", async () => {
    const s = await setup();
    const steel = await s.cat("Alloy Steel");
    const chain = (
      await post(s.admin, "/api/products", {
        productType: "measured",
        name: "Load Chain",
        baseShortName: `LC${s.tag}`,
        attributes: [{ name: "Size", unit: "", values: ["6 mm", "8 mm"] }],
        variations: [{ attributes: { Size: "6 mm" } }, { attributes: { Size: "8 mm" }, categoryIds: [steel] }],
        measure: { lengthUnit: "m", rollName: "Roll" },
      })
    ).body.product;
    const hoist = (
      await post(s.admin, "/api/products", {
        productType: "grouped",
        name: "Chain Hoist",
        shortName: `CH${s.tag}`,
        main: { name: "Hoist Body", shortName: `HB${s.tag}`, unit: "Nos" },
        byproducts: [{ productId: chain.id, required: true }],
      })
    ).body.product;
    const link = hoist.grouped.byproducts[0];
    const [c6, c8] = link.variations.map((v: { id: string }) => v.id);
    const opened = await post(s.admin, "/api/sets/opening", {
      groupId: hoist.id,
      sets: [
        { rate: 6000, parts: [{ byproductId: link.id, variationId: c6, length: 3 }] },
        { rate: 7000, parts: [{ byproductId: link.id, variationId: c8, length: 3 }] },
        { rate: 7000, parts: [{ byproductId: link.id, variationId: c8, length: 4 }] },
      ],
    });
    expect(opened.status).toBe(201);

    // The set product is listed under Alloy Steel; only the sets with an 8 mm chain count.
    expect((await s.admin.get(`/api/products?categoryId=${steel}`)).body.products.map((p: { id: string }) => p.id).sort()).toEqual([chain.id, hoist.id].sort());
    expect((await s.admin.get(`/api/sets?groupId=${hoist.id}&categoryId=${steel}`)).body.sets).toHaveLength(2);
    expect((await s.admin.get(`/api/sets?groupId=${hoist.id}`)).body.sets).toHaveLength(3);
    const inv = (await s.admin.get(`/api/inventory?categoryId=${steel}`)).body.products;
    expect(inv.find((p: { id: string }) => p.id === hoist.id).quantity).toBe(2);
    const detail = (await s.admin.get(`/api/categories/${steel}`)).body.products;
    expect(detail.find((p: { id: string }) => p.id === hoist.id).scope).toBe("parts");
    // Inherited: it cannot be removed from the category page.
    expect((await del(s.admin, `/api/categories/${steel}/products/${hoist.id}`)).status).toBe(404);

    // Backup round trip keeps the variation links.
    const zip = (await s.admin.get("/api/backup").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    })).body as Buffer;
    const target = await makeCompany();
    const tAdmin = await signIn((await makeUser(target.id, "admin")).email);
    const r = await tAdmin.post("/api/backup/restore?confirm=true").set("Origin", ORIGIN).set("Content-Type", "application/octet-stream").send(zip);
    expect(r.status).toBe(200);
    const links = await prisma.variationCategory.findMany({ where: { companyId: target.id }, include: { variation: true, category: true } });
    expect(links.map((l) => `${l.category.name}:${Object.values(l.variation.attributes as Record<string, string>).join("")}`).sort()).toEqual([
      "Alloy Steel:8 mm",
      "Marine:12",
      "Marine:16",
    ]);
  });
});
