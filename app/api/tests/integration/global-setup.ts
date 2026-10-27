import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { configureTestEnv } from "./test-env.js";

// Rebuilds the TEST database from the checked-in migrations once per run.
// This also proves the migrations apply cleanly to an empty database.
export default function setup() {
  configureTestEnv();
  execSync("npx prisma migrate reset --force --skip-seed --skip-generate", {
    cwd: resolve(import.meta.dirname, "../.."),
    env: process.env,
    stdio: "pipe",
  });
}
