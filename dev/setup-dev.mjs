// One-command developer setup for a fresh clone (Windows, macOS, Linux). Run from app\:
//   npm run dev:setup              Docker PostgreSQL (docker-compose.dev.yml) + install + migrate + demo
//   npm run dev:setup -- --no-docker   use your own PostgreSQL (edit app\api\.env first)
// Safe to run again: keeps an existing app\api\.env and an already seeded Demo company.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
const app = resolve(repo, "app");
const api = resolve(app, "api");
const envFile = resolve(api, ".env");
const useDocker = !process.argv.includes("--no-docker");
const DOCKER_DB = "postgresql://rs_v3:rs_dev_only@127.0.0.1:5433";

function step(title) {
  console.log(`\n=== ${title}`);
}

function fail(message) {
  console.error(`\nSETUP STOPPED: ${message}`);
  process.exit(1);
}

function run(cmd, args, cwd, { capture = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, shell: process.platform === "win32", stdio: capture ? "pipe" : "inherit", encoding: "utf8" });
  if (capture) {
    process.stdout.write(r.stdout ?? "");
    process.stderr.write(r.stderr ?? "");
  }
  return r;
}

function has(cmd, args = ["--version"]) {
  return spawnSync(cmd, args, { shell: process.platform === "win32", stdio: "ignore" }).status === 0;
}

step("Checking tools");
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 22) fail(`Node.js 22 or newer is needed (this is ${process.versions.node}).`);
if (!has("pnpm")) fail("pnpm is missing. Install it with:  npm install -g pnpm@9.15.4");
if (useDocker && !has("docker", ["info"])) fail("Docker is not running. Start Docker Desktop, or use --no-docker with your own PostgreSQL.");
console.log("OK");

step("Settings file app/api/.env");
if (existsSync(envFile)) {
  console.log("Kept the existing app/api/.env");
} else {
  let text = readFileSync(resolve(api, ".env.example"), "utf8");
  text = text.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${randomBytes(48).toString("base64url")}`);
  if (useDocker) {
    text = text
      .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${DOCKER_DB}/rs_v31_demo?connection_limit=5&pool_timeout=10`)
      .replace(/^TEST_DATABASE_URL=.*$/m, `TEST_DATABASE_URL=${DOCKER_DB}/rs_v31_test`);
  }
  writeFileSync(envFile, text);
  console.log("Created app/api/.env (git-ignored, keep it private)");
  if (!useDocker) {
    fail("Set DATABASE_URL and TEST_DATABASE_URL in app/api/.env to your PostgreSQL (see DEVELOPER-SETUP.md), then run this again.");
  }
}
if (/CHANGE_ME@/.test(readFileSync(envFile, "utf8"))) fail("app/api/.env still has CHANGE_ME in a database URL.");

if (useDocker) {
  step("PostgreSQL in Docker (port 5433)");
  if (run("docker", ["compose", "-f", "docker-compose.dev.yml", "up", "-d", "--wait"], repo).status !== 0) {
    fail("docker compose could not start the database.");
  }
}

step("Installing packages (pnpm)");
if (run("pnpm", ["install", "--frozen-lockfile"], app).status !== 0) fail("pnpm install failed.");

step("Database migrations (Demo database)");
if (run("pnpm", ["exec", "prisma", "migrate", "deploy"], api).status !== 0) fail("prisma migrate deploy failed.");

step("Demo company data");
const seed = run("pnpm", ["run", "demo:seed"], api, { capture: true });
if (seed.status !== 0) {
  if (/already has users/.test(`${seed.stdout}${seed.stderr}`)) console.log("Demo data is already there (kept).");
  else fail("The demo seed failed (see the output above).");
}

console.log(`
=== Ready
Start the app:   npm run dev        (in app/)
Then open:       http://localhost:3000
Sign in:         see "Demo sign-in" in DEVELOPER-SETUP.md`);
