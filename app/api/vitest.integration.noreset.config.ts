import { defineConfig } from "vitest/config";
import base from "./vitest.integration.config";

// Same suite as vitest.integration.config.ts but WITHOUT the globalSetup that runs
// `prisma migrate reset` on the TEST database. Use when the test database is already migrated
// (`prisma migrate status`) and a reset is not wanted; tests create their own uniquely named rows.
export default defineConfig({
  ...base,
  test: { ...base.test, globalSetup: [] },
});
