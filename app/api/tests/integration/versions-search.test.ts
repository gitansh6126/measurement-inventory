import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// V2 plan §1.5 (optimistic concurrency) and §1.2 (trigram search indexes).

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const patch = (a: Agent, url: string, body: unknown) => a.patch(url).set("Origin", ORIGIN).send(body as object);

async function setup() {
  const co = await makeCompany();
  const admin = await signIn((await makeUser(co.id, "admin")).email);
  const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
  const product = (
    await post(manager, "/api/products", {
      productType: "variable",
      name: "Shackle",
      unit: "Nos",
      baseShortName: `SH${co.id.slice(-4).toUpperCase()}`,
      attributes: [{ name: "Size", values: ["S", "L"] }],
      variations: [{ attributes: { Size: "S" }, officialSku: null }, { attributes: { Size: "L" }, officialSku: null }],
    })
  ).body.product;
  return { co, admin, manager, product };
}

describe("optimistic concurrency (version)", () => {
  it("starts at 1, bumps on every edit, and refuses a stale product edit with 409", async () => {
    const { manager, product } = await setup();
    expect(product.version).toBe(1);
    const first = await patch(manager, `/api/products/${product.id}`, { name: "Shackle Bow", version: 1 });
    expect(first.status).toBe(200);
    expect(first.body.product.version).toBe(2);
    const stale = await patch(manager, `/api/products/${product.id}`, { name: "Shackle D", version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatchObject({ code: "VERSION_CONFLICT", details: { currentVersion: 2 } });
    expect((await prisma.productGroup.findUniqueOrThrow({ where: { id: product.id } })).name).toBe("Shackle Bow");
  });

  it("lets exactly one of two simultaneous edits with the same version win", async () => {
    const { manager, product } = await setup();
    const [a, b] = await Promise.all([
      patch(manager, `/api/products/${product.id}`, { description: "A", version: 1 }),
      patch(manager, `/api/products/${product.id}`, { description: "B", version: 1 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await prisma.productGroup.findUniqueOrThrow({ where: { id: product.id } })).version).toBe(2);
  });

  it("guards variations and parties the same way; omitting version keeps V1 behaviour", async () => {
    const { manager, product } = await setup();
    const v = product.variations[0];
    expect((await patch(manager, `/api/products/${product.id}/variations/${v.id}`, { description: "x", version: 1 })).status).toBe(200);
    expect((await patch(manager, `/api/products/${product.id}/variations/${v.id}`, { description: "y", version: 1 })).status).toBe(409);
    expect((await patch(manager, `/api/products/${product.id}/variations/${v.id}`, { description: "z" })).status).toBe(200);

    const party = (await post(manager, "/api/parties", { type: "CUSTOMER", name: `Ravi ${product.id.slice(-5)}` })).body.party;
    expect(party.version).toBe(1);
    expect((await patch(manager, `/api/parties/${party.id}`, { city: "Surat", version: 1 })).body.party.version).toBe(2);
    expect((await patch(manager, `/api/parties/${party.id}`, { city: "Pune", version: 1 })).status).toBe(409);
  });

  it("a version alone is not a change", async () => {
    const { manager, product } = await setup();
    expect((await patch(manager, `/api/products/${product.id}`, { version: 1 })).status).toBe(400);
  });
});

describe("trigram search indexes", () => {
  it("are installed and usable by ILIKE '%term%' searches", async () => {
    const names = (await prisma.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE indexname LIKE '%trgm_idx' ORDER BY indexname`).map((r) => r.indexname);
    expect(names).toEqual([
      "orders_number_trgm_idx",
      "parties_name_trgm_idx",
      "parties_phone_trgm_idx",
      "product_groups_name_trgm_idx",
      "product_variations_official_sku_trgm_idx",
      "product_variations_short_name_trgm_idx",
      "purchases_number_trgm_idx",
      "sales_number_trgm_idx",
    ]);
    // Test tables are tiny, so force the planner to show it can use the index.
    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN SELECT id FROM product_groups WHERE name ILIKE '%hack%'`);
    });
    expect(plan.map((r) => r["QUERY PLAN"]).join("\n")).toContain("product_groups_name_trgm_idx");
  });
});
