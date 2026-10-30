// Demo company seed: minimal, but covers ALL kinds:
// - Users: Admin, Sales Manager, Sales Staff
// - Categories: Lifting Equipment, Rigging Hardware, Wire Rope, Chains & Fittings (Product Type)
// - Category heads (V3.1): Industry (Construction, Warehousing, Marine, Agriculture, Gym & Fitness)
//   and Material (Alloy Steel, Galvanised, Stainless Steel); products sit in several of them.
//   0038: some only for chosen variations — Marine = Wire Rope 6x19 16 mm, Alloy Steel = Load
//   Chain 8 mm (so Chain Hoist Sets with an 8 mm chain are in Alloy Steel too, G-A)
// - Products:
//     * Simple Counted (In Stock, Out of Stock, Discontinued/Inactive)
//     * Variable Counted (2-attribute matrix, Quality rating stars)
//     * Measured Metric (Reel m, Drum m)
//     * Measured Imperial (Reel ft_in)
//     * 0044 technical specifications: Electric Hoist (product), Girder Clamp and the measured
//       wire rope (product + each variation's own), Chain Hoist Set (product + each standard set)
// - Rolls & Pieces: CLOSED, OPEN, CUT offcut, USED_UP scrap with ledger history
// - Stock KPIs: In Stock, Low Stock, Out of Stock, Inactive
// - Parties: Customer (with credit score & contact), Supplier, Both
// - Purchases: Counted items, Measured rolls
// - Sales: Counted sale, Measured cut sale, Counter walk-in cash sale, Cancelled/Voided sale
// - Orders: Placed SO, On-delivery SO, Measured Shortage SO, Linked Procurement PO, Draft PO
// - Supplier Rates: Active vendor price cards with price revision history
// - Drafts: Held sales cart, Held purchase cart
// - Warehouses (V3.1): W1 "Main Godown" (default, took all stock) + W2 "Shop"; a split purchase,
//   a split sale, a shift with items, a roll and a set, a cancelled shift, a sale order with a
//   saved Take-from split and one left to decide at delivery
//
// Usage:
//   npm run demo:seed      seed on an empty migrated demo database
//   npm run demo:reset     wipe and reseed demo database (needs DEMO_RESET_ENABLED=true)
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { DEMO_ACCOUNTS, DEMO_COMPANY_NAME, DEMO_PASSWORD } from "@rs-v31/shared";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { getEnv } from "../src/env.js";
import { audit } from "../src/lib/audit.js";
import { hashPassword } from "../src/lib/auth.js";
import { client, seedThroughApi } from "../src/lib/demo-seed.js";

export { seedThroughApi };

const env = getEnv();
const reset = process.argv.includes("--reset");

function guard() {
  if (env.APP_ENV !== "DEMO") throw new Error(`Demo seed runs only with APP_ENV=DEMO (this is ${env.APP_ENV}).`);
  if (reset && !env.DEMO_RESET_ENABLED) throw new Error("--reset needs DEMO_RESET_ENABLED=true.");
}

async function createCompanyAndAdmin() {
  const admin = DEMO_ACCOUNTS[0];
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  return prisma.$transaction(async (tx) => {
    const c = await tx.company.create({
      // Length settings for every Measured product (Settings → Measured products, 0029).
      data: { name: DEMO_COMPANY_NAME, lengthDecimalsM: 1, scrapBelowM: 0.5, lengthDecimalsFtIn: 0, scrapBelowFtIn: 24 },
    });
    const u = await tx.user.create({
      data: { companyId: c.id, name: admin.name, email: admin.email, role: admin.role, passwordHash },
      select: { id: true, email: true, role: true },
    });
    await audit(tx, { companyId: c.id, actorId: null, action: "DEMO_SEED", entityType: "User", entityId: u.id, after: { company: c.name, ...u } });
    return c;
  });
}

async function main() {
  guard();
  if (reset) {
    console.log(`Resetting demo database "${env.databaseName}"…`);
    execSync("npx prisma migrate reset --force --skip-seed --skip-generate", {
      cwd: resolve(import.meta.dirname, ".."),
      env: process.env,
      stdio: "inherit",
    });
  } else if ((await prisma.user.count()) > 0) {
    throw new Error("The demo database already has users. Run `npm run demo:reset` to wipe and reseed it.");
  }

  await createCompanyAndAdmin();
  const server = createApp(env).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const { port } = server.address() as AddressInfo;
    const counts = await seedThroughApi(client(`http://127.0.0.1:${port}`));
    console.log(`Seeded minimal "${DEMO_COMPANY_NAME}" in ${env.databaseName}:`, counts);
    console.log(`Sign in as ${DEMO_ACCOUNTS.map((a) => a.email).join(", ")} (password in @rs-v31/shared DEMO_PASSWORD).`);
  } finally {
    server.close();
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
