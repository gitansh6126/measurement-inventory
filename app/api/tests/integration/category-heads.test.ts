import { describe, expect, it } from "vitest";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// V3.1 category heads (0033): Product Type is built in (one per product); other heads such as
// Industry hold categories a product may be in any number of.

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const patch = (a: Agent, url: string, body: unknown) => a.patch(url).set("Origin", ORIGIN).send(body as object);
const del = (a: Agent, url: string) => a.delete(url).set("Origin", ORIGIN);

async function setup() {
  const co = await makeCompany();
  const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
  const staff = await signIn((await makeUser(co.id, "sales_staff")).email);
  const product = async (name: string, shortName: string, extra: object = {}) =>
    (await post(manager, "/api/products", { productType: "simple", name, unit: "Nos", shortName, ...extra })).body.product;
  return { manager, staff, product };
}

describe("category heads", () => {
  it("lists Product Type first and adds, renames, retires heads", async () => {
    const { manager, staff } = await setup();
    let res = await manager.get("/api/category-heads");
    expect(res.status).toBe(200);
    expect(res.body.heads).toEqual([expect.objectContaining({ id: null, name: "Product Type", builtIn: true })]);

    res = await post(manager, "/api/category-heads", { name: "Industry" });
    expect(res.status).toBe(201);
    const industry = res.body.head.id as string;
    expect((await post(manager, "/api/category-heads", { name: "industry" })).status).toBe(409);
    expect((await post(manager, "/api/category-heads", { name: "Product Type" })).status).toBe(400);
    expect((await post(staff, "/api/category-heads", { name: "Material" })).status).toBe(403);

    expect((await patch(manager, `/api/category-heads/${industry}`, { name: "Industries" })).body.head.name).toBe("Industries");
    await patch(manager, `/api/category-heads/${industry}`, { active: false });
    expect((await manager.get("/api/category-heads")).body.heads).toHaveLength(1);
    expect((await manager.get("/api/category-heads?status=all")).body.heads).toHaveLength(2);
    expect((await post(manager, "/api/categories", { name: "Gym", headId: industry })).body.error?.code).toBe("INACTIVE_HEAD");
  });

  it("keeps category lists per head and allows the same name in two heads", async () => {
    const { manager } = await setup();
    const industry = (await post(manager, "/api/category-heads", { name: "Industry" })).body.head.id;
    expect((await post(manager, "/api/categories", { name: "General" })).status).toBe(201);
    expect((await post(manager, "/api/categories", { name: "General", headId: industry })).status).toBe(201);
    expect((await post(manager, "/api/categories", { name: "general", headId: industry })).status).toBe(409);
    await post(manager, "/api/categories", { name: "Agriculture", headId: industry });

    const productType = (await manager.get("/api/categories")).body.categories.map((c: { name: string }) => c.name);
    const ofIndustry = (await manager.get(`/api/categories?headId=${industry}`)).body.categories.map((c: { name: string }) => c.name);
    expect(productType).toEqual(["General"]);
    expect(ofIndustry).toEqual(["General", "Agriculture"]);
    expect((await manager.get("/api/categories?headId=all")).body.categories).toHaveLength(3);
  });

  it("puts one product in many categories of other heads, alongside its Product Type", async () => {
    const { manager, product } = await setup();
    const hoists = (await post(manager, "/api/categories", { name: "Hoists" })).body.category.id;
    const industry = (await post(manager, "/api/category-heads", { name: "Industry" })).body.head.id;
    const cat = async (name: string) => (await post(manager, "/api/categories", { name, headId: industry })).body.category.id as string;
    const agri = await cat("Agriculture");
    const gym = await cat("Gym");

    // The product's one category must be a Product Type; other heads go in categoryIds.
    expect((await post(manager, "/api/products", { productType: "simple", name: "X", unit: "Nos", shortName: "X1", categoryId: agri })).body.error?.code).toBe("NOT_PRODUCT_TYPE");
    expect((await post(manager, "/api/products", { productType: "simple", name: "X", unit: "Nos", shortName: "X1", categoryIds: [hoists] })).body.error?.code).toBe("PRODUCT_TYPE_CATEGORY");

    const hoist = await product("Chain Hoist", "CH1", { categoryId: hoists, categoryIds: [agri, gym] });
    expect(hoist.category.id).toBe(hoists);
    expect(hoist.categories.map((c: { name: string; headName: string }) => `${c.headName}:${c.name}`)).toEqual(["Industry:Agriculture", "Industry:Gym"]);

    // Edit replaces the set of other-head categories.
    const edited = (await patch(manager, `/api/products/${hoist.id}`, { categoryIds: [gym], version: hoist.version })).body.product;
    expect(edited.categories.map((c: { id: string }) => c.id)).toEqual([gym]);
    expect(edited.category.id).toBe(hoists);

    // Category page attach (bulk) and detach for a non-Product-Type head.
    const clamp = await product("Beam Clamp", "BC1", { categoryId: hoists });
    expect((await post(manager, `/api/categories/${agri}/products`, { productIds: [hoist.id, clamp.id] })).status).toBe(200);
    let detail = (await manager.get(`/api/categories/${agri}`)).body;
    expect(detail.category.productCount).toBe(2);
    expect(detail.products.map((p: { name: string }) => p.name)).toEqual(["Beam Clamp", "Chain Hoist"]);
    // Attaching to another head never moves the Product Type.
    expect((await manager.get(`/api/products/${clamp.id}`)).body.product.category.id).toBe(hoists);

    expect((await del(manager, `/api/categories/${agri}/products/${clamp.id}`)).status).toBe(200);
    expect((await del(manager, `/api/categories/${agri}/products/${clamp.id}`)).status).toBe(404);
    detail = (await manager.get(`/api/categories/${agri}`)).body;
    expect(detail.products.map((p: { name: string }) => p.name)).toEqual(["Chain Hoist"]);

    // Product list and inventory filter by a category of any head.
    expect((await manager.get(`/api/products?categoryId=${gym}`)).body.products.map((p: { name: string }) => p.name)).toEqual(["Chain Hoist"]);
    expect((await manager.get(`/api/products?categoryId=${hoists}`)).body.total).toBe(2);
    expect((await manager.get(`/api/inventory?categoryId=${agri}`)).body.products.map((p: { name: string }) => p.name)).toEqual(["Chain Hoist"]);

    // Counts per head use the head's rule.
    const counts = (await manager.get(`/api/categories?headId=${industry}`)).body.categories.map((c: { name: string; productCount: number }) => [c.name, c.productCount]);
    expect(counts).toEqual([["Agriculture", 1], ["Gym", 1]]);
  });

  it("refuses an inactive category on a new link", async () => {
    const { manager, product } = await setup();
    const industry = (await post(manager, "/api/category-heads", { name: "Industry" })).body.head.id;
    const marine = (await post(manager, "/api/categories", { name: "Marine", headId: industry })).body.category.id;
    await patch(manager, `/api/categories/${marine}`, { active: false });
    const res = await post(manager, "/api/products", { productType: "simple", name: "Rope", unit: "m", shortName: "R1", categoryIds: [marine] });
    expect(res.body.error?.code).toBe("INACTIVE_CATEGORY");
    const p = await product("Rope", "R1");
    expect((await post(manager, `/api/categories/${marine}/products`, { productId: p.id })).body.error?.code).toBe("INACTIVE_CATEGORY");
  });
});
