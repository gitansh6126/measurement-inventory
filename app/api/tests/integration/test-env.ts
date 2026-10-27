import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Points this process at the TEST database. Called from globalSetup and from each
 * worker's setup file so both see the same configuration.
 */
export function configureTestEnv() {
  const envFile = resolve(import.meta.dirname, "../../.env");
  if (!process.env.TEST_DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Add it to v1/app/api/.env (see .env.example) to run integration tests.");
  }
  if (!new URL(url).pathname.toLowerCase().includes("test")) {
    throw new Error("TEST_DATABASE_URL must name a database containing 'test'; refusing to reset anything else.");
  }
  Object.assign(process.env, {
    APP_ENV: "TEST",
    DATABASE_URL: url,
    RELEASE_VERSION: "0.0.0-test",
    DEPLOYED_AT: "2026-10-13T00:00:00+05:30",
    SESSION_SECRET: "test-only-session-secret-0123456789abcdef",
    PUBLIC_APP_URL: "http://localhost:3000",
    DEMO_RESET_ENABLED: "false",
    TRUST_PROXY: "false",
  });
}
