// Bootstrap: creates the company and its first admin. Refuses to run once any user exists,
// so it cannot be used to add accounts later (admins do that in the app).
//
// Usage (password via environment so it never appears in shell history or process lists):
//   BOOTSTRAP_ADMIN_PASSWORD=... npm run create-admin -- --company "RS Machinery" --name "Owner" --email owner@example.com
import { parseArgs } from "node:util";
import { prisma } from "../src/db.js";
import { getEnv } from "../src/env.js";
import { audit } from "../src/lib/audit.js";
import { hashPassword } from "../src/lib/auth.js";
import { passwordRule } from "../src/routes/auth.js";

const { values } = parseArgs({
  options: { company: { type: "string" }, name: { type: "string" }, email: { type: "string" } },
});

async function main() {
  const env = getEnv();
  const { company, name, email } = values;
  if (!company || !name || !email) throw new Error("--company, --name and --email are required");
  const password = passwordRule.parse(process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "");

  if ((await prisma.user.count()) > 0) throw new Error("Users already exist; bootstrap is disabled. Use the admin screen.");

  const passwordHash = await hashPassword(password);
  const result = await prisma.$transaction(async (tx) => {
    const c = await tx.company.create({ data: { name: company } });
    const u = await tx.user.create({
      data: { companyId: c.id, name, email: email.trim().toLowerCase(), role: "admin", passwordHash },
      select: { id: true, email: true, role: true },
    });
    await audit(tx, { companyId: c.id, actorId: null, action: "BOOTSTRAP", entityType: "User", entityId: u.id, after: { company: c.name, ...u } });
    return { company: c, user: u };
  });
  console.log(`Created company "${result.company.name}" and admin ${result.user.email} in ${env.APP_ENV} (${env.databaseName}).`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
