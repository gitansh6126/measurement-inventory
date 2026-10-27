// Read-only smoke test of a running V3.1 server, used after upgrading a V2 database
// (local-server\UPGRADE-FROM-V2.bat) and for the V3.1 production test. Nothing is saved:
// it signs in, opens every main list, every order's shortage / backorder report, every
// product page, and runs the import *check* (never commit) on each sheet in a folder.
//
//   SMOKE_PASSWORD=... node <tsx> scripts/upgrade-smoke.ts --url http://127.0.0.1:3210 --email admin@shop.in [--sheets <folder>]
//
// Exit code 0 = every request answered as expected, 1 = something failed (listed in red).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { IMPORT_KINDS, importFields, suggestMapping, type ImportKind } from "@rs-v31/shared/import";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const base = (arg("url") ?? "http://127.0.0.1:3210").replace(/\/$/, "");
const email = arg("email");
const password = process.env.SMOKE_PASSWORD;
const sheetsDir = arg("sheets");
if (!email || !password) {
  console.error("Usage: SMOKE_PASSWORD=... upgrade-smoke.ts --url <web or api address> --email <admin email> [--sheets <folder>]");
  process.exit(2);
}

let cookie = "";
let failures = 0;
const ok = (text: string) => console.log(`  [OK]   ${text}`);
const bad = (text: string) => {
  failures++;
  console.log(`\x1b[31m  [FAIL] ${text}\x1b[0m`);
};

async function call<T = any>(method: string, url: string, body?: unknown, raw?: Buffer): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = { cookie };
  if (raw) headers["content-type"] = "application/octet-stream";
  else if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(base + url, { method, headers, body: raw ? new Uint8Array(raw) : body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  let json: any = text;
  try { json = JSON.parse(text); } catch { /* not JSON (xlsx etc.) */ }
  return { status: res.status, json };
}

async function expectOk(label: string, url: string) {
  const r = await call("GET", url);
  if (r.status === 200) ok(`${label} (${url})`);
  else bad(`${label} (${url}) -> ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return r.json;
}

const list = (j: any): any[] => (Array.isArray(j) ? j : (j?.items ?? j?.rows ?? j?.products ?? j?.orders ?? j?.parties ?? j?.shortages ?? []));

console.log(`Smoke test of ${base} as ${email}`);
const version = await expectOk("version", "/api/version");
if (version?.environment) console.log(`         environment ${version.environment}, release ${version.releaseVersion}, database at ${version.migrationVersion}`);
const login = await call("POST", "/api/auth/login", { email, password });
if (login.status !== 200) {
  bad(`sign in -> ${login.status} ${JSON.stringify(login.json).slice(0, 200)}`);
  process.exit(1);
}
ok("sign in");
await expectOk("me", "/api/auth/me");

console.log("Lists");
for (const [label, url] of [
  ["company settings", "/api/company/settings"],
  ["users", "/api/users"],
  ["categories", "/api/categories?headId=all"],
  ["category heads", "/api/category-heads"],
  ["catalog", "/api/catalog/products"],
  ["stock in", "/api/inventory"],
  ["sets", "/api/sets"],
  ["warehouses", "/api/warehouses"],
  ["parties", "/api/parties"],
  ["sales", "/api/sales"],
  ["purchases", "/api/purchases"],
  ["held sale carts", "/api/drafts?mode=SALE"],
  ["held purchase carts", "/api/drafts?mode=PURCHASE"],
  ["vendor prices", "/api/vendor-prices"],
  ["backup summary", "/api/backup/summary"],
] as const) await expectOk(label, url);

const suppliers = list(await expectOk("suppliers", "/api/parties?type=SUPPLIER")).slice(0, 3);
for (const s of suppliers) await expectOk(`vendor price sheet for ${s.name}`, `/api/vendor-prices/sheet?supplierId=${s.id}`);

console.log("Products (every product page and its stock)");
const products: any[] = [];
for (let page = 1; ; page++) {
  const rows = list(await expectOk(`products page ${page}`, `/api/products?pageSize=200&page=${page}`));
  products.push(...rows);
  if (rows.length < 200) break;
}
let productFails = 0;
for (const p of products) {
  for (const url of [`/api/products/${p.id}`, `/api/inventory/products/${p.id}`]) {
    const r = await call("GET", url);
    if (r.status !== 200) { productFails++; bad(`${p.name ?? p.id}: ${url} -> ${r.status}`); }
  }
}
if (products.length && !productFails) ok(`${products.length} products open`);

console.log("Orders (every order page + shortage / backorder report)");
let orderCount = 0;
let shortLines = 0;
for (const kind of ["SALE", "PURCHASE"] as const) {
  for (let page = 1; ; page++) {
    const r = await call<any>("GET", `/api/orders?kind=${kind}&pageSize=200&page=${page}`);
    if (r.status !== 200) { bad(`${kind} orders -> ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`); break; }
    const rows = list(r.json);
    for (const o of rows) {
      orderCount++;
      const d = await call("GET", `/api/orders/${o.id}`);
      if (d.status !== 200) { bad(`order ${o.number ?? o.id} -> ${d.status}`); continue; }
      if (kind === "SALE") {
        const s = await call<any>("GET", `/api/orders/${o.id}/shortages`);
        if (s.status !== 200) bad(`order ${o.number ?? o.id} shortages -> ${s.status} ${JSON.stringify(s.json).slice(0, 200)}`);
        else shortLines += list(s.json?.shortages).length;
      }
    }
    if (rows.length < 200) break;
  }
}
ok(`${orderCount} orders open; ${shortLines} shortage / backorder lines reported`);

console.log("Import templates");
for (const kind of IMPORT_KINDS) {
  const r = await call("GET", `/api/import/templates/${kind}`);
  r.status === 200 ? ok(`${kind} template`) : bad(`${kind} template -> ${r.status}`);
}

if (sheetsDir) {
  console.log(`Import checks (nothing is saved) for sheets in ${sheetsDir}`);
  const kindOf = (file: string): ImportKind | undefined => IMPORT_KINDS.find((k) => file.toLowerCase().includes(k) || file.toLowerCase().includes(k.replace(/s$/, "")));
  for (const file of (await readdir(sheetsDir)).filter((f) => /\.(xlsx|csv)$/i.test(f))) {
    const kind = kindOf(file);
    if (!kind) { console.log(`  [SKIP] ${file}: name does not say products / stock / purchases / sales`); continue; }
    const read = await call<any>("POST", "/api/import/read", undefined, await readFile(path.join(sheetsDir, file)));
    if (read.status !== 200) { bad(`${file}: read -> ${read.status} ${JSON.stringify(read.json).slice(0, 200)}`); continue; }
    for (const sheet of read.json.sheets as { name: string; rows: string[][] }[]) {
      const headers = sheet.rows[0] ?? [];
      const map = suggestMapping(kind, headers);
      const fields = importFields(kind);
      const rows = [];
      for (let i = 1; i < sheet.rows.length; i++) {
        const r = sheet.rows[i] ?? [];
        const values: Record<string, string> = {};
        const options: { name: string; value: string }[] = [];
        let any = false;
        for (const f of fields) {
          const col = map[f.key];
          if (col === undefined) continue;
          const value = (r[col] ?? "").trim();
          if (value) any = true;
          if (f.option) options.push({ name: (headers[col] ?? f.label).trim(), value });
          else values[f.key] = value;
        }
        if (any) rows.push({ rowNo: i + 1, values, options });
      }
      if (!rows.length) { console.log(`  [SKIP] ${file} / ${sheet.name}: no matched rows`); continue; }
      const check = await call<any>("POST", `/api/import/${kind}/check`, { rows, options: { createProducts: true, createParties: true, createWarehouses: false } });
      if (check.status !== 200) { bad(`${file} / ${sheet.name}: check -> ${check.status} ${JSON.stringify(check.json).slice(0, 300)}`); continue; }
      const c = check.json.counts ?? {};
      console.log(`  [CHECKED] ${file} / ${sheet.name}: ${kind}, ${check.json.rows.length} rows - ready ${c.ok ?? 0}, check ${c.warning ?? 0}, error ${c.error ?? 0}; documents ${check.json.documents ?? 0}`);
      for (const x of check.json.rows.filter((x: any) => x.status === "error").slice(0, 10)) console.log(`           row ${x.rowNo}: ${x.messages.join("; ")}`);
    }
  }
}

console.log("");
if (failures) {
  console.log(`\x1b[31m${failures} check(s) FAILED\x1b[0m`);
  process.exit(1);
}
console.log("\x1b[32mAll smoke checks passed (nothing was saved).\x1b[0m");
