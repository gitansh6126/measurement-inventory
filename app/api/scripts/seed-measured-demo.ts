import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log("Seeding minimal demo dataset with all kinds...");
execSync("npx tsx scripts/seed-demo.ts --reset", {
  cwd: resolve(__dirname, ".."),
  stdio: "inherit",
  env: process.env,
});
