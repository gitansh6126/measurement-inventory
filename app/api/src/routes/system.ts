import { Router } from "express";
import type { Env } from "../env.js";
import { prisma } from "../db.js";

/** Latest applied Prisma migration name, or null if none/unreachable. */
export async function currentMigration(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY finished_at DESC LIMIT 1`;
  return rows[0]?.migration_name ?? null;
}

export function systemRoutes(env: Env) {
  const r = Router();

  // Liveness: the process is up. No database call, safe for frequent probes.
  r.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // Readiness: the database answers.
  r.get("/health/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });

  // Environment identity required by v1/ENVIRONMENTS.md. Contains no secrets.
  r.get("/version", async (_req, res) => {
    let migrationVersion: string | null = null;
    try {
      migrationVersion = await currentMigration();
    } catch {
      migrationVersion = null;
    }
    res.json({
      environment: env.APP_ENV,
      releaseVersion: env.RELEASE_VERSION,
      deploymentTimestamp: env.DEPLOYED_AT,
      migrationVersion,
      // Address of the paired environment (Client Ready ↔ Demo), or null.
      switchUrl: env.SWITCH_APP_URL ?? null,
    });
  });

  return r;
}
