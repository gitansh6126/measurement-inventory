import { describe, expect, it } from "vitest";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// Customer category (select an existing one or create by typing) and notes, owner 2026-10-27.

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const patch = (a: Agent, url: string, body: unknown) => a.patch(url).set("Origin", ORIGIN).send(body as object);

describe("customer category and notes", () => {
  it("creates, lists, reuses and filters categories per company", async () => {
    const co = await makeCompany();
    const staff = await signIn((await makeUser(co.id, "sales_staff")).email);

    const a = await post(staff, "/api/parties", { type: "CUSTOMER", name: "Asha Traders", category: "Retail", notes: "Pays by cheque" });
    expect(a.status).toBe(201);
    expect(a.body.party).toMatchObject({ category: "Retail", notes: "Pays by cheque" });

    // Typing an existing category in another case reuses its spelling.
    const b = await post(staff, "/api/parties", { type: "CUSTOMER", name: "Bharat Cranes", category: "retail" });
    expect(b.body.party.category).toBe("Retail");
    await post(staff, "/api/parties", { type: "CUSTOMER", name: "Coastal Ports", category: "Wholesale" });
    await post(staff, "/api/parties", { type: "CUSTOMER", name: "No Category" });

    expect((await staff.get("/api/parties/categories")).body.categories).toEqual(["Retail", "Wholesale"]);
    const retail = (await staff.get("/api/parties?role=customer&category=Retail")).body.parties.map((p: { name: string }) => p.name);
    expect(retail).toEqual(["Asha Traders", "Bharat Cranes"]);

    // Another company does not see these categories.
    const other = await signIn((await makeUser((await makeCompany()).id, "admin")).email);
    expect((await other.get("/api/parties/categories")).body.categories).toEqual([]);
  });

  it("edits and clears category and notes", async () => {
    const co = await makeCompany();
    const manager = await signIn((await makeUser(co.id, "sales_manager")).email);
    const p = (await post(manager, "/api/parties", { type: "CUSTOMER", name: "Delta Rigging", category: "Retail" })).body.party;

    const edited = await patch(manager, `/api/parties/${p.id}`, { category: "Project", notes: "Site at Hazira", version: p.version });
    expect(edited.status).toBe(200);
    expect(edited.body.party).toMatchObject({ category: "Project", notes: "Site at Hazira" });

    const cleared = await patch(manager, `/api/parties/${p.id}`, { category: null, notes: "", version: edited.body.party.version });
    expect(cleared.body.party).toMatchObject({ category: null, notes: null });
    expect((await manager.get(`/api/parties/${p.id}`)).body.party.category).toBeNull();
  });
});
