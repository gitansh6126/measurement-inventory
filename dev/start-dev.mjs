// Starts the API (port 4000) and the web app (port 3000) together with hot reload. Run from app\:
//   npm run dev        then open http://localhost:3000     Ctrl+C stops both.
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const app = resolve(import.meta.dirname, "..", "app");
const win = process.platform === "win32";
const children = [];

function start(name, dir) {
  const child = spawn("pnpm", ["run", "dev"], { cwd: resolve(app, dir), shell: win, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = (chunk) =>
    chunk
      .toString()
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => `[${name}] ${line}`)
      .join("\n") + "\n";
  child.stdout.on("data", (c) => process.stdout.write(prefix(c)));
  child.stderr.on("data", (c) => process.stderr.write(prefix(c)));
  child.on("exit", (code) => {
    console.log(`[${name}] stopped (${code ?? "signal"})`);
    stopAll();
  });
  children.push(child);
}

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode !== null) continue;
    // On Windows the shell wraps pnpm, so the whole process tree has to go.
    if (win) spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
    else c.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 500);
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

start("api", "api");
start("web", "web");
console.log("Starting API on http://localhost:4000 and web on http://localhost:3000 (Ctrl+C stops both)");
