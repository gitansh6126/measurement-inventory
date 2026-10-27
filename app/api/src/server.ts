import { createApp } from "./app.js";
import { prisma } from "./db.js";
import { getEnv } from "./env.js";
import { bootstrapAdmin } from "./lib/bootstrap-admin.js";
import { log } from "./lib/logger.js";

const env = getEnv(); // throws (and exits non-zero) on invalid configuration
await bootstrapAdmin(env);
const app = createApp(env);

const server = app.listen(env.PORT, "127.0.0.1", () => {
  log.info("api_started", { port: env.PORT, release: env.RELEASE_VERSION, database: env.databaseName });
});
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;

let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info("api_stopping", { signal });
  const force = setTimeout(() => {
    log.error("api_forced_exit", { signal });
    process.exit(1);
  }, 10_000);
  force.unref();
  server.close(async () => {
    await prisma.$disconnect();
    log.info("api_stopped", { signal });
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
