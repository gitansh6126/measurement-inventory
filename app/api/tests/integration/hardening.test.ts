import AdmZip from "adm-zip";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/db.js";
import { getEnv } from "../../src/env.js";
import { log } from "../../src/lib/logger.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// Regression tests for v3.1\PRODUCTION_READINESS_AUDIT.md: H1 (restore validation), H2 (snapshot
// export), M1 (no reset codes in Client Ready), M5 (access log), L1 (unique races are 409).

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const restore = (a: Agent, payload: Buffer, type = "application/octet-stream") =>
  a.post("/api/backup/restore?confirm=true").set("Origin", ORIGIN).set("Content-Type", type).send(payload);
const inspect = (a: Agent, payload: Buffer) => a.post("/api/backup/inspect").set("Origin", ORIGIN).set("Content-Type", "application/octet-stream").send(payload);
const exportZip = async (a: Agent) => {
  const res = await a.get("/api/backup").buffer(true).parse((r, cb) => {
    const chunks: Buffer[] = [];
    r.on("data", (c: Buffer) => chunks.push(c));
    r.on("end", () => cb(null, Buffer.concat(chunks)));
  });
  return { status: res.status, zip: res.body as Buffer };
};

/** A company with one stocked product, so a wrongly accepted restore would visibly wipe it. */
async function stocked() {
  const co = await makeCompany();
  const admin = await signIn((await makeUser(co.id, "admin")).email);
  const tag = co.id.slice(-5).toUpperCase();
  const p = (await post(admin, "/api/products", { productType: "simple", name: "Winch", unit: "Nos", shortName: `W-${tag}`, officialSku: null })).body.product;
  const v = p.variations[0].id as string;
  await post(admin, "/api/inventory/adjustments", { variationId: v, type: "OPENING", quantity: 50 });
  return { co, admin, v };
}

const counts = async (companyId: string) => ({
  products: await prisma.productGroup.count({ where: { companyId } }),
  movements: await prisma.stockMovement.count({ where: { companyId } }),
});

function zipOf(manifest: string, inventory: string) {
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(manifest, "utf8"));
  zip.addFile("inventory.json", Buffer.from(inventory, "utf8"));
  return zip.toBuffer();
}

afterEach(() => vi.restoreAllMocks());

describe("H1: restore refuses anything that is not a real backup, before deleting", () => {
  it("rejects bare JSON, an error body, a wrong format and malformed tables, and keeps the data", async () => {
    const { co, admin } = await stocked();
    const before = await counts(co.id);
    expect(before.products).toBe(1);

    const bad: [string, Buffer][] = [
      ["empty object", Buffer.from("{}")],
      ["API error body", Buffer.from(JSON.stringify({ error: { code: "INTERNAL", message: "Something went wrong" } }))],
      ["raw data without wrapper", Buffer.from(JSON.stringify({ categories: [], parties: [] }))],
      ["wrong format tag", Buffer.from(JSON.stringify({ format: "OTHER", data: {} }))],
      ["table not a list", Buffer.from(JSON.stringify({ format: "RS_INVENTORY_BACKUP", version: "2.0", data: { categories: {}, parties: [] } }))],
    ];
    for (const [label, payload] of bad) {
      const res = await restore(admin, payload);
      expect(res.status, label).toBe(400);
      expect(res.body.error.code, label).toBe("INVALID_FORMAT");
      expect((await inspect(admin, payload)).status, `inspect: ${label}`).toBe(400);
    }

    // ZIP: invalid JSON, a foreign manifest, and inventory.json missing required tables.
    const okManifest = JSON.stringify({ format: "RS_INVENTORY_ZIP_BACKUP", backupVersion: "2.0", imageMappings: [] });
    const zips: [string, Buffer, string][] = [
      ["inventory not JSON", zipOf(okManifest, "{not json"), "INVALID_METADATA"],
      ["foreign manifest", zipOf(JSON.stringify({ format: "SOMETHING_ELSE" }), "{}"), "INVALID_FORMAT"],
      ["missing tables", zipOf(okManifest, JSON.stringify({ categories: [] })), "INVALID_FORMAT"],
    ];
    for (const [label, payload, code] of zips) {
      const res = await restore(admin, payload);
      expect(res.status, label).toBe(400);
      expect(res.body.error.code, label).toBe(code);
      expect((await inspect(admin, payload)).status, `inspect: ${label}`).toBe(400);
    }

    expect(await counts(co.id)).toEqual(before);
  });

  it("still restores a genuine JSON backup", async () => {
    const { admin } = await stocked();
    const json = (await admin.get("/api/backup?format=json")).body;
    const target = await makeCompany();
    const tAdmin = await signIn((await makeUser(target.id, "admin")).email);
    const payload = Buffer.from(JSON.stringify(json));
    expect((await inspect(tAdmin, payload)).status).toBe(200);
    expect((await restore(tAdmin, payload)).status).toBe(200);
    expect((await counts(target.id)).products).toBe(1);
  });
});

describe("H2: backup export is one consistent snapshot", () => {
  it("exports while sales are being saved and the archive restores without drift", async () => {
    const { admin, v } = await stocked();
    const sales = Array.from({ length: 6 }, () => post(admin, "/api/sales", { lines: [{ variationId: v, quantity: 1, price: 10 }] }));
    const [first, second, ...done] = await Promise.all([exportZip(admin), exportZip(admin), ...sales]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    for (const s of done) expect(s.status).toBe(201);

    for (const { zip } of [first, second]) {
      const target = await makeCompany();
      const tAdmin = await signIn((await makeUser(target.id, "admin")).email);
      const res = await restore(tAdmin, zip);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      // Every sale in the archive has its movement and vice versa: stock = 50 − sales in the archive.
      const saleCount = await prisma.sale.count({ where: { companyId: target.id } });
      const bal = await prisma.stockBalance.aggregate({ where: { companyId: target.id }, _sum: { quantity: true } });
      expect(Number(bal._sum.quantity)).toBe(50 - saleCount);
    }
  });
});

describe("L1: a lost unique-index race is a 409, not a 500", () => {
  it("answers two simultaneous user creates with one email as 201 and 409", async () => {
    const co = await makeCompany();
    const admin = await signIn((await makeUser(co.id, "admin")).email);
    const body = { name: "Twin", email: `twin-${co.id}@test.local`, role: "sales_staff", password: "a-long-password" };
    const statuses = (await Promise.all([post(admin, "/api/users", body), post(admin, "/api/users", body)])).map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
  });
});

describe("M1: Client Ready never puts a reset code in the log", () => {
  it("refuses a reset request with 503 when email is not configured", async () => {
    const warn = vi.spyOn(log, "warn");
    const env = { ...getEnv(), APP_ENV: "CLIENT_READY" as const, SMTP_USER: undefined, SMTP_PASS: undefined };
    const co = await makeCompany();
    const user = await makeUser(co.id, "admin");
    const res = await request(createApp(env)).post("/api/auth/password-reset/request").set("Origin", ORIGIN).send({ email: user.email });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("EMAIL_NOT_CONFIGURED");
    // Unknown addresses get the same answer, so the 503 reveals nothing about accounts.
    const unknown = await request(createApp(env)).post("/api/auth/password-reset/request").set("Origin", ORIGIN).send({ email: `nobody-${co.id}@test.local` });
    expect(unknown.status).toBe(503);
    expect(warn.mock.calls.filter(([msg]) => msg === "password_reset_code_logged")).toHaveLength(0);
    expect(await prisma.passwordResetCode.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("M5: access log", () => {
  it("writes one line per request with the requestId the client sees", async () => {
    const info = vi.spyOn(log, "info");
    const co = await makeCompany();
    const admin = await signIn((await makeUser(co.id, "admin")).email);
    info.mockClear();
    const res = await admin.get("/api/products?search=secret-text");
    const line = info.mock.calls.find(([msg, f]) => msg === "request" && (f as { requestId?: string }).requestId === res.headers["x-request-id"]);
    expect(line).toBeDefined();
    expect(line![1]).toMatchObject({ method: "GET", path: "/api/products", status: 200, companyId: co.id });
    expect(JSON.stringify(line![1])).not.toContain("secret-text");
  });
});
