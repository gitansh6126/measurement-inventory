import path from "node:path";
import { z } from "zod";

export const APP_ENVS = ["CLIENT_READY", "DEMO", "TEST"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const bool = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const schema = z.object({
  APP_ENV: z.enum(APP_ENVS),
  RELEASE_VERSION: z.string().min(1),
  // ISO timestamp written by the release process; identifies this deployment.
  DEPLOYED_AT: z.string().datetime({ offset: true }),
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  // HMAC key for session tokens. No default: startup fails without a strong value.
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  // Sliding sign-in: a device stays signed in while it is used and is signed out after this
  // many days without use. SESSION_MAX_DAYS caps a session's total life (password again after).
  SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(90).default(5),
  SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  PUBLIC_APP_URL: z.string().url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  TRUST_PROXY: bool,
  DEMO_RESET_ENABLED: bool,
  // Uploaded images live here, one folder per environment. Required for CLIENT_READY.
  STORAGE_ROOT: z.string().optional(),
  // Extra browser origins allowed besides PUBLIC_APP_URL (comma-separated), for a local
  // server reached as http://localhost:3200 on the PC and http://192.168.x.x:3200 on the LAN.
  ALLOWED_ORIGINS: z.string().optional(),
  ADMIN_EMAIL: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim().toLowerCase() : undefined),
    z.string().email().max(200).optional()
  ),
  ADMIN_PASSWORD: z.preprocess(
    (value) => (typeof value === "string" && value.length ? value : undefined),
    z.string().min(10).max(200).optional()
  ),
  ADMIN_NAME: z.string().trim().min(1).max(100).default("Admin"),
  ADMIN_COMPANY_NAME: z.string().trim().min(1).max(200).default("RS Machinery"),
  SMTP_HOST: z.string().trim().min(1).default("smtp.gmail.com"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_USER: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined),
    z.string().email().max(200).optional()
  ),
  SMTP_PASS: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined),
    z.string().min(1).optional()
  ),
  SMTP_FROM: z.preprocess(
    (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined),
    z.string().email().max(200).optional()
  ),
  // Status files of the local server's nightly backup and weekly restore test (set by
  // local-server\start.ps1). Unset on hosted installs: the Backup page then shows no status.
  BACKUP_STATUS_FILE: z.string().trim().min(1).optional(),
  RESTORE_TEST_STATUS_FILE: z.string().trim().min(1).optional(),
  // The other environment's address (Client Ready ↔ Demo) for the top-bar switch button.
  // Blank = no button. Only a link: the two environments never share data or sessions.
  SWITCH_APP_URL: z.preprocess((v) => (typeof v === "string" && v.trim() && !v.startsWith("CHANGE_ME") ? v.trim() : undefined), z.string().url().optional()),
}).superRefine((env, ctx) => {
  if (env.SESSION_MAX_DAYS < env.SESSION_IDLE_DAYS) {
    ctx.addIssue({
      code: "custom",
      path: ["SESSION_MAX_DAYS"],
      message: "SESSION_MAX_DAYS must be at least SESSION_IDLE_DAYS",
    });
  }
  if (Boolean(env.ADMIN_EMAIL) !== Boolean(env.ADMIN_PASSWORD)) {
    ctx.addIssue({
      code: "custom",
      path: ["ADMIN_EMAIL"],
      message: "ADMIN_EMAIL and ADMIN_PASSWORD must be configured together",
    });
  }
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASS)) {
    ctx.addIssue({
      code: "custom",
      path: ["SMTP_USER"],
      message: "SMTP_USER and SMTP_PASS must be configured together",
    });
  }
  if (env.SMTP_FROM && !env.SMTP_USER) {
    ctx.addIssue({
      code: "custom",
      path: ["SMTP_FROM"],
      message: "SMTP_FROM requires SMTP_USER and SMTP_PASS",
    });
  }
});

export type Env = Omit<z.infer<typeof schema>, "STORAGE_ROOT" | "ALLOWED_ORIGINS"> & {
  databaseName: string;
  storageRoot: string;
  /** PUBLIC_APP_URL's origin first, then ALLOWED_ORIGINS. */
  allowedOrigins: string[];
};

/** Database name taken from a postgresql:// URL (path without the leading slash). */
export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/**
 * Validates configuration and enforces environment isolation:
 * the database name must carry its environment tag so a DEMO or TEST process
 * can never be pointed at Client Ready data by a copy-paste mistake.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = result.data;
  const databaseName = databaseNameOf(env.DATABASE_URL).toLowerCase();

  const tagged = { DEMO: "demo", TEST: "test" } as const;
  if (env.APP_ENV === "CLIENT_READY") {
    if (databaseName.includes("demo") || databaseName.includes("test")) {
      throw new Error(`CLIENT_READY refuses database "${databaseName}": name looks like a demo/test database`);
    }
    if (env.DEMO_RESET_ENABLED) throw new Error("DEMO_RESET_ENABLED must be false for CLIENT_READY");
    if (!env.PUBLIC_APP_URL.startsWith("https://") && process.env.ALLOW_INSECURE_HTTP !== "true") {
      throw new Error("CLIENT_READY requires an https PUBLIC_APP_URL (or set ALLOW_INSECURE_HTTP=true for plain-IP testing)");
    }
    if (env.SWITCH_APP_URL && !env.SWITCH_APP_URL.startsWith("https://") && process.env.ALLOW_INSECURE_HTTP !== "true") {
      throw new Error("CLIENT_READY requires an https SWITCH_APP_URL (or set ALLOW_INSECURE_HTTP=true for plain-IP testing)");
    }
    // Prisma's default pool is CPU count × 2 + 1, which is wrong for a small VPS shared with
    // Demo. Client Ready must size its pool on purpose (see v1\ops\README.md).
    if (!new URL(env.DATABASE_URL).searchParams.get("connection_limit")) {
      throw new Error("CLIENT_READY requires connection_limit in DATABASE_URL (for example ?connection_limit=5&pool_timeout=10)");
    }
  } else if (!databaseName.includes(tagged[env.APP_ENV])) {
    throw new Error(`${env.APP_ENV} requires a database whose name contains "${tagged[env.APP_ENV]}" (got "${databaseName}")`);
  }
  if (env.SWITCH_APP_URL && new URL(env.SWITCH_APP_URL).origin === new URL(env.PUBLIC_APP_URL).origin) {
    throw new Error("SWITCH_APP_URL must be the other environment's address, not this one");
  }

  // Storage isolation mirrors the database rule: CLIENT_READY names its folder explicitly;
  // DEMO/TEST default to a folder named after their own database, never a shared one.
  const given = env.STORAGE_ROOT?.trim();
  const raw = given && !given.startsWith("CHANGE_ME") ? given : undefined; // example-file placeholders count as unset
  if (env.APP_ENV === "CLIENT_READY" && !raw) throw new Error("CLIENT_READY requires STORAGE_ROOT");
  if (raw && !path.isAbsolute(raw)) throw new Error("STORAGE_ROOT must be an absolute path");
  const storageRoot = raw ?? path.resolve(process.cwd(), "storage", databaseName);

  const allowedOrigins = [new URL(env.PUBLIC_APP_URL).origin];
  for (const item of (env.ALLOWED_ORIGINS ?? "").split(",").map((v) => v.trim()).filter(Boolean)) {
    let origin: string;
    try {
      origin = new URL(item).origin;
    } catch {
      throw new Error(`ALLOWED_ORIGINS: "${item}" is not a URL`);
    }
    if (origin === "null" || origin !== item.replace(/\/$/, "")) throw new Error(`ALLOWED_ORIGINS: "${item}" must be an origin only (scheme://host[:port])`);
    if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
  }
  const { ALLOWED_ORIGINS: _a, ...rest } = env;
  return { ...rest, databaseName, storageRoot, allowedOrigins };
}

let cached: Env | undefined;

export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
