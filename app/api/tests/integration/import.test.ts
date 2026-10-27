import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { ORIGIN, makeCompany, makeUser, signIn } from "./helpers.js";

// V3.1 import (docs\IMPORT-V3.1.md): check, then commit; missing products are created.

type Agent = Awaited<ReturnType<typeof signIn>>;
const post = (a: Agent, url: string, body: unknown) => a.post(url).set("Origin", ORIGIN).send(body as object);
const row = (rowNo: number, values: Record<string, string>, options: { name: string; value: string }[] = []) => ({ rowNo, values, options });

async function admin() {
  const co = await makeCompany();
  return { co, a: await signIn((await makeUser(co.id, "admin")).email) };
}

describe("import", () => {
  it("serves a template with headers and one demo line", async () => {
    const { a } = await admin();
    const r = await a.get("/api/import/templates/stock").buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    const read = await a.post("/api/import/read").set("Origin", ORIGIN).set("Content-Type", "application/octet-stream").send(r.body as Buffer);
    expect(read.status).toBe(200);
    const stock = read.body.sheets[0];
    expect(stock.rows).toHaveLength(2);
    expect(stock.rows[0]).toContain("Product name");
    expect(stock.rows[1]).toContain("Wire Rope");
    expect(read.body.sheets[1].name).toBe("How to fill");
  });

  it("imports wire rope rolls, creating the product and its items", async () => {
    const { co, a } = await admin();
    const rows = [
      row(2, { product: "Wire Rope", length: "1968.504", lengthIn: "ft", rollKind: "Yes", rollNo: "20-36-T1", category: "X36" }, [{ name: "Size", value: "20X36" }, { name: "Brand", value: "Tata" }]),
      row(3, { product: "Wire Rope", length: "1401.3124", lengthIn: "ft", rollKind: "", rollNo: "19-36-T1", category: "X36" }, [{ name: "Size", value: "19X36" }, { name: "Brand", value: "Tata" }]),
      row(4, { product: "Wire Rope", length: "927.42", lengthIn: "ft", rollKind: "", rollNo: "20-36-T2" }, [{ name: "Size", value: "20X36" }, { name: "Brand", value: "Tata" }]),
      row(5, { product: "Wire Rope", length: "", lengthIn: "ft", rollKind: "" }, [{ name: "Size", value: "8X36" }, { name: "Brand", value: "Tata" }]),
      row(6, { product: "Shackle 10mm", quantity: "25" }),
      row(7, { product: "Shackle 10mm", quantity: "2.5" }),
    ];
    const check = await post(a, "/api/import/stock/check", { rows });
    expect(check.status).toBe(200);
    expect(check.body.counts).toEqual({ ok: 4, warning: 0, error: 2 });
    expect(check.body.creates.products).toEqual(["Wire Rope (measured)", "Shackle 10mm (simple)"]);
    expect(check.body.creates.variations).toHaveLength(3);
    expect(check.body.rows[3].messages[0]).toMatch(/give the length/);
    // Nothing is written by a check.
    expect(await prisma.productGroup.count({ where: { companyId: co.id } })).toBe(0);

    const refused = await post(a, "/api/import/stock/commit", { rows });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe("ROWS_WITH_ERRORS");

    const done = await post(a, "/api/import/stock/commit", { rows, skipErrors: true });
    expect(done.status).toBe(201);
    expect(done.body.imported).toBe(4);
    const rope = await prisma.productGroup.findFirstOrThrow({ where: { companyId: co.id, name: "Wire Rope" }, include: { variations: true, category: true } });
    expect(rope.productType).toBe("measured");
    expect(rope.lengthUnit).toBe("ft_in");
    expect(rope.category?.name).toBe("X36");
    expect(rope.variations).toHaveLength(2);
    const pieces = await prisma.measurementPiece.findMany({ where: { companyId: co.id }, orderBy: { supplierRollNo: "asc" } });
    expect(pieces.map((p) => [p.supplierRollNo, p.kind, Number(p.originalLength)])).toEqual([
      ["19-36-T1", "OPEN", 16815.749],
      ["20-36-T1", "CLOSED", 23622.048],
      ["20-36-T2", "OPEN", 11129.04],
    ]);
    const shackle = await prisma.productVariation.findFirstOrThrow({ where: { companyId: co.id, group: { name: "Shackle 10mm" } }, include: { balance: true } });
    expect(Number(shackle.balance?.quantity)).toBe(25);

    // Importing again finds the same items: no new products, stock is added.
    const again = await post(a, "/api/import/stock/check", { rows: [rows[4]!, row(8, { product: "wire rope", length: "100", lengthIn: "m" }, [{ name: "size", value: "20x36" }, { name: "BRAND", value: "tata" }])] });
    expect(again.body.counts.error).toBe(0);
    expect(again.body.creates.products).toEqual([]);
    expect(again.body.creates.variations).toEqual([]);
  });

  it("ignores blank option cells on products without options, and totals rows", async () => {
    const { co, a } = await admin();
    const blank = [{ name: "Size", value: "" }, { name: "Brand", value: "" }];
    const rows = [
      row(2, { product: "Thimble 12mm", quantity: "40" }, blank),
      row(3, { product: "Rope", length: "100", lengthIn: "m" }, [{ name: "Size", value: "8mm" }, { name: "Brand", value: "" }]),
      row(4, { product: "Rope", length: "50", lengthIn: "m" }, [{ name: "Size", value: "8mm" }, { name: "Brand", value: "Tata" }]),
      row(5, { product: "Total", quantity: "190" }, blank),
    ];
    const check = await post(a, "/api/import/stock/check", { rows });
    expect(check.body.rows.map((r: { status: string }) => r.status)).toEqual(["ok", "warning", "ok", "error"]);
    expect(check.body.creates.products).toEqual(["Thimble 12mm (simple)", "Rope (measured)"]);
    expect(check.body.rows[1].messages).toEqual(['Brand is blank — used "None"']);
    await post(a, "/api/import/stock/commit", { rows, skipErrors: true }).expect(201);
    const rope = await prisma.productGroup.findFirstOrThrow({ where: { companyId: co.id, name: "Rope" }, include: { variations: true } });
    expect((rope.attributeDefinitions as { name: string }[]).map((d) => d.name)).toEqual(["Size", "Brand"]);
    expect(rope.variations.map((v) => Object.values(v.attributes as object).join("/")).sort()).toEqual(["8mm/None", "8mm/Tata"]);
  });

  it("records purchases and sales grouped by bill, creating parties", async () => {
    const { co, a } = await admin();
    const p = [
      row(2, { billNo: "PB-1", date: "01/10/2026", party: "Crossbee Ropes", product: "Bolt M8", quantity: "100", price: "5", paymentMode: "credit" }),
      row(3, { billNo: "PB-1", product: "Bolt M8", quantity: "50", price: "5" }),
      row(4, { billNo: "PB-1", product: "Sling Rope", length: "200", lengthIn: "m", price: "90", rollNo: "R1" }, [{ name: "Size", value: "12mm" }]),
      row(5, { billNo: "PB-2", date: "02/10/2026", party: "Crossbee Ropes", product: "Bolt M8", quantity: "10", price: "6" }),
    ];
    const pc = await post(a, "/api/import/purchases/check", { rows: p });
    expect(pc.body.counts.error).toBe(0);
    expect(pc.body.documents).toBe(2);
    expect(pc.body.creates.parties).toEqual(["Crossbee Ropes"]);
    const pd = await post(a, "/api/import/purchases/commit", { rows: p });
    expect(pd.status).toBe(201);
    expect(pd.body.documentNumbers).toHaveLength(2);
    const bill = await prisma.purchase.findFirstOrThrow({ where: { companyId: co.id, notes: { contains: "PB-1" } }, include: { lines: true, party: true } });
    expect(bill.party?.name).toBe("Crossbee Ropes");
    expect(bill.lines).toHaveLength(2);
    expect(bill.total.toFixed(2)).toBe("18750.00");

    const s = [
      row(2, { billNo: "SB-1", party: "Sharma Traders", product: "Bolt M8", quantity: "20", price: "9" }),
      row(3, { billNo: "SB-1", product: "Sling Rope", length: "25", price: "120" }, [{ name: "Size", value: "12mm" }]),
      row(4, { billNo: "SB-2", product: "Bolt M8", quantity: "500", price: "9" }),
      row(5, { billNo: "SB-3", product: "Nut M8", quantity: "1", price: "2" }),
    ];
    const sc = await post(a, "/api/import/sales/check", { rows: s });
    expect(sc.body.rows.map((r: { status: string }) => r.status)).toEqual(["ok", "ok", "error", "error"]);
    expect(sc.body.rows[2].messages[0]).toMatch(/Not enough stock/);
    expect(sc.body.rows[3].messages[0]).toMatch(/No product named "Nut M8"/);
    const sd = await post(a, "/api/import/sales/commit", { rows: s, skipErrors: true });
    expect(sd.status).toBe(201);
    expect(sd.body.documentNumbers).toHaveLength(1);
    const sale = await prisma.sale.findFirstOrThrow({ where: { companyId: co.id }, include: { party: true } });
    expect(sale.party?.name).toBe("Sharma Traders");
    expect(sale.total.toFixed(2)).toBe("3180.00");
  });
});
