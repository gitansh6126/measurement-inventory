// Hosted single-process entry (Hostinger Node.js web app, branch hosting/hostinger-business).
// The host gives one port, so the Express API and the Next.js web app share one HTTP server:
// /api/* goes to the API, everything else to Next. Same origin, so cookies, the sameOrigin()
// guard and the CSP behave as behind the shop's reverse proxy. The shop build is unchanged.
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextModule from "next";
import { createApp } from "../api/src/app.js";
import { prisma } from "../api/src/db.js";
import { getEnv } from "../api/src/env.js";
import { bootstrapAdmin } from "../api/src/lib/bootstrap-admin.js";
import { log } from "../api/src/lib/logger.js";
import { isApiPath } from "./route.js";

const env = getEnv(); // throws (and exits non-zero) on invalid configuration
await bootstrapAdmin(env);
const api = createApp(env);

// next is CommonJS: from ESM the default import is module.exports, whose .default is createServer.
const createNext = nextModule.default;
const web = createNext({ dev: false, dir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web") });
await web.prepare();
const handleWeb = web.getRequestHandler();

const host = process.env.LISTEN_HOST || "0.0.0.0";
const server = http.createServer((req, res) => {
  if (isApiPath(req.url)) {
    api(req, res);
    return;
  }
  handleWeb(req, res).catch((err: unknown) => {
    log.error("web_request_failed", { path: (req.url ?? "").split("?")[0], error: String(err) });
    if (!res.headersSent) res.statusCode = 500;
    res.end();
  });
});
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.listen(env.PORT, host, () => {
  log.info("hosted_started", { host, port: env.PORT, release: env.RELEASE_VERSION, database: env.databaseName });
});

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info("hosted_stopping", { signal });
  const force = setTimeout(() => {
    log.error("hosted_forced_exit", { signal });
    process.exit(1);
  }, 10_000);
  force.unref();
  server.close(async () => {
    await prisma.$disconnect();
    log.info("hosted_stopped", { signal });
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
