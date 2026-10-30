import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { nextDocNumber } from "../../src/lib/numbering.js";
import { ORIGIN, PASSWORD, app, makeCompany, makeUser, signIn } from "./helpers.js";

describe("system", () => {
  it("exposes liveness, readiness and environment identity", async () => {
    expect((await request(app()).get("/api/health")).body).toEqual({ status: "ok" });
    expect((await request(app()).get("/api/health/ready")).body).toEqual({ status: "ready" });
    const v = await request(app()).get("/api/version");
    expect(v.body).toEqual({
      environment: "TEST",
      releaseVersion: "0.0.0-test",
      deploymentTimestamp: "2026-10-13T00:00:00+05:30",
      // D24: no paired environment configured in TEST.
      switchUrl: null,
      // The newest checked-in migration (the suite applies all of them from empty).
      migrationVersion: readdirSync(resolve(import.meta.dirname, "../../prisma/migrations"), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
        .at(-1),
    });
  });

  it("returns JSON errors with a request id and never leaks internals", async () => {
    const res = await request(app()).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.requestId).toBe(res.headers["x-request-id"]);
    const bad = await request(app()).post("/api/auth/login").set("Content-Type", "application/json").send("{bad json");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("BAD_REQUEST");
  });

  it("sets security headers and no-store on API responses", async () => {
    const res = await request(app()).get("/api/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("authentication", () => {
  it("signs in with an HttpOnly, SameSite=Strict session cookie and audits it", async () => {
    const co = await makeCompany();
    const user = await makeUser(co.id, "sales_staff");
    const res = await request(app()).post("/api/auth/login").set("Origin", ORIGIN).send({ email: user.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/rs_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const events = await prisma.auditEvent.findMany({ where: { actorId: user.id, action: "LOGIN" } });
    expect(events).toHaveLength(1);
    expect(events[0]?.environment).toBe("TEST");
  });

  it("rejects a wrong password with a generic message and records the failure", async () => {
    const co = await makeCompany();
    const user = await makeUser(co.id, "admin");
    const res = await request(app()).post("/api/auth/login").set("Origin", ORIGIN).send({ email: user.email, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Email or password is incorrect");
    expect(await prisma.auditEvent.count({ where: { entityId: user.id, action: "LOGIN_FAILED" } })).toBe(1);
  });

  it("rejects unknown emails and inactive users identically", async () => {
    const co = await makeCompany();
    const inactive = await makeUser(co.id, "admin", { active: false });
    const a = await request(app()).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "nobody@test.local", password: PASSWORD });
    const b = await request(app()).post("/api/auth/login").set("Origin", ORIGIN).send({ email: inactive.email, password: PASSWORD });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it("reports the signed-in user and their permissions", async () => {
    const co = await makeCompany();
    const user = await makeUser(co.id, "sales_staff");
    const me = await (await signIn(user.email)).get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(user.email);
    expect(me.body.permissions).toContain("sale.create");
    expect(me.body.permissions).not.toContain("stock.adjust");
  });

  it("logout revokes the session server-side", async () => {
    const co = await makeCompany();
    const user = await makeUser(co.id, "admin");
    const agent = await signIn(user.email);
    expect((await agent.post("/api/auth/logout").set("Origin", ORIGIN)).status).toBe(200);
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.revokedAt).not.toBeNull();
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("refuses cross-origin state-changing requests", async () => {
    const res = await request(app()).post("/api/auth/login").set("Origin", "https://evil.example").send({ email: "a@b.co", password: "x" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("BAD_ORIGIN");
  });

  it("changing password signs out other sessions", async () => {
    const co = await makeCompany();
    const user = await makeUser(co.id, "sales_manager");
    const first = await signIn(user.email);
    const second = await signIn(user.email);
    const res = await first.post("/api/auth/password").set("Origin", ORIGIN).send({ currentPassword: PASSWORD, newPassword: "a-brand-new-password" });
    expect(res.status).toBe(200);
    expect((await first.get("/api/auth/me")).status).toBe(200);
    expect((await second.get("/api/auth/me")).status).toBe(401);
  });

  it("keeps a device signed in for 5 idle days and slides the window on use", async () => {
    const co = await makeCompany();
    const user = await makeUser(co.id, "sales_staff");
    const login = await request(app()).post("/api/auth/login").set("Origin", ORIGIN).send({ email: user.email, password: PASSWORD });
    expect(String(login.headers["set-cookie"])).toMatch(/Max-Age=432000/);
    const agent = await signIn(user.email);
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    const day = 86_400_000;
    expect(session.expiresAt.getTime() - session.createdAt.getTime()).toBeGreaterThan(5 * day - 60_000);

    // Last used 4 days ago: still signed in, and the use pushes expiry 5 days ahead again.
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(Date.now() - 4 * day), expiresAt: new Date(Date.now() + day) } });
    const me = await agent.get("/api/auth/me");
    expect(me.status).toBe(200);
    expect(String(me.headers["set-cookie"])).toMatch(/rs_session=.*Max-Age=43\d{4}/);
    const slid = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(slid.expiresAt.getTime()).toBeGreaterThan(Date.now() + 5 * day - 60_000);

    // Unused past the idle window: must sign in again.
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(Date.now() - 6 * day), expiresAt: new Date(Date.now() - day) } });
    expect((await agent.get("/api/auth/me")).status).toBe(401);
  });

  it("never slides a session past 30 days from sign-in", async () => {
    const co = await makeCompany();
    const user = await makeUser(co.id, "sales_staff");
    const agent = await signIn(user.email);
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    const day = 86_400_000;
    const createdAt = new Date(Date.now() - 29 * day);
    await prisma.session.update({ where: { id: session.id }, data: { createdAt, lastSeenAt: new Date(Date.now() - day) } });
    expect((await agent.get("/api/auth/me")).status).toBe(200);
    const capped = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(capped.expiresAt.getTime()).toBe(createdAt.getTime() + 30 * day);
  });
});

describe("user management", () => {
  it("is admin-only", async () => {
    const co = await makeCompany();
    for (const role of ["sales_manager", "sales_staff"] as const) {
      const u = await makeUser(co.id, role);
      expect((await (await signIn(u.email)).get("/api/users")).status).toBe(403);
    }
    expect((await request(app()).get("/api/users")).status).toBe(401);
  });

  it("creates users inside the admin's company, audited, with unique email", async () => {
    const co = await makeCompany();
    const admin = await makeUser(co.id, "admin");
    const agent = await signIn(admin.email);
    const body = { name: "New Staff", email: `Staff-${co.id}@Test.Local`, role: "sales_staff", password: "long-enough-pw" };
    const res = await agent.post("/api/users").set("Origin", ORIGIN).send(body);
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(body.email.toLowerCase());
    expect(res.body.user.passwordHash).toBeUndefined();
    const created = await prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id } });
    expect(created.companyId).toBe(co.id);
    expect(await prisma.auditEvent.count({ where: { entityId: created.id, action: "USER_CREATE", actorId: admin.id } })).toBe(1);
    expect((await agent.post("/api/users").set("Origin", ORIGIN).send(body)).status).toBe(409);
  });

  it("only lists and edits users of the admin's own company", async () => {
    const mine = await makeCompany();
    const other = await makeCompany();
    const admin = await makeUser(mine.id, "admin");
    const outsider = await makeUser(other.id, "sales_staff");
    const agent = await signIn(admin.email);
    const list = await agent.get("/api/users");
    expect(list.body.users.map((u: { id: string }) => u.id)).toEqual([admin.id]);
    expect((await agent.patch(`/api/users/${outsider.id}`).set("Origin", ORIGIN).send({ active: false })).status).toBe(404);
  });

  it("never removes the last active admin", async () => {
    const co = await makeCompany();
    const admin = await makeUser(co.id, "admin");
    const agent = await signIn(admin.email);
    const res = await agent.patch(`/api/users/${admin.id}`).set("Origin", ORIGIN).send({ role: "sales_staff" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("LAST_ADMIN");
  });

  it("deactivating a user ends their sessions immediately", async () => {
    const co = await makeCompany();
    const admin = await makeUser(co.id, "admin");
    const staff = await makeUser(co.id, "sales_staff");
    const staffAgent = await signIn(staff.email);
    const adminAgent = await signIn(admin.email);
    expect((await adminAgent.patch(`/api/users/${staff.id}`).set("Origin", ORIGIN).send({ active: false })).status).toBe(200);
    expect((await staffAgent.get("/api/auth/me")).status).toBe(401);
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: staff.id, action: "USER_UPDATE" } });
    expect(event.before).toMatchObject({ active: true });
    expect(event.after).toMatchObject({ active: false });
  });
});

describe("audit log", () => {
  it("is append-only at the database level", async () => {
    const co = await makeCompany();
    const e = await prisma.auditEvent.create({ data: { companyId: co.id, environment: "TEST", action: "PROBE", entityType: "Test" } });
    await expect(prisma.auditEvent.update({ where: { id: e.id }, data: { action: "TAMPERED" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.delete({ where: { id: e.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe("TRUNCATE audit_events CASCADE")).rejects.toThrow(/append-only/);
  });
});

describe("document numbering", () => {
  it("allocates unique, gap-free numbers under concurrency", async () => {
    const co = await makeCompany();
    const date = new Date("2026-10-13T12:00:00+05:30");
    const numbers = await Promise.all(
      Array.from({ length: 20 }, () => prisma.$transaction((tx) => nextDocNumber(tx, co.id, "sale", date), { timeout: 15000, maxWait: 10000 })),
    );
    const expected = Array.from({ length: 20 }, (_, i) => `SAL-13102026-${String(i + 1).padStart(3, "0")}`);
    expect([...numbers].sort()).toEqual(expected);
  });

  it("does not consume a number when the transaction rolls back", async () => {
    const co = await makeCompany();
    const date = new Date("2026-10-13T12:00:00+05:30");
    await expect(
      prisma.$transaction(async (tx) => {
        await nextDocNumber(tx, co.id, "purchase", date);
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await prisma.$transaction((tx) => nextDocNumber(tx, co.id, "purchase", date))).toBe("PUR-13102026-001");
  });

  it("keeps separate sequences per type and day", async () => {
    const co = await makeCompany();
    const sale = (d: string) => prisma.$transaction((tx) => nextDocNumber(tx, co.id, "sale", new Date(d)));
    expect(await sale("2027-03-31T12:00:00+05:30")).toBe("SAL-31032027-001");
    expect(await sale("2027-04-01T09:00:00+05:30")).toBe("SAL-01042027-001");
    expect(await prisma.$transaction((tx) => nextDocNumber(tx, co.id, "purchase", new Date("2027-04-01T09:00:00+05:30")))).toBe("PUR-01042027-001");
  });
});
