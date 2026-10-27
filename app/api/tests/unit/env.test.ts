import { describe, expect, it } from "vitest";
import { parseEnv } from "../../src/env.js";

const base = {
  RELEASE_VERSION: "0.1.0",
  DEPLOYED_AT: "2026-10-13T10:00:00+05:30",
  SESSION_SECRET: "x".repeat(40),
  PUBLIC_APP_URL: "https://demo.example.com",
};
const db = (name: string) => `postgresql://u:p@127.0.0.1:5432/${name}`;

describe("parseEnv", () => {
  it("accepts a valid DEMO configuration and applies defaults", () => {
    const env = parseEnv({ ...base, APP_ENV: "DEMO", DATABASE_URL: db("rs_v31_demo") });
    expect(env.PORT).toBe(4000);
    expect(env.SESSION_IDLE_DAYS).toBe(5);
    expect(env.SESSION_MAX_DAYS).toBe(30);
    expect(env.DEMO_RESET_ENABLED).toBe(false);
    expect(env.databaseName).toBe("rs_v31_demo");
    expect(env.allowedOrigins).toEqual(["https://demo.example.com"]);
    expect(env.ADMIN_NAME).toBe("Admin");
    expect(env.ADMIN_COMPANY_NAME).toBe("RS Machinery");
    expect(env.SMTP_HOST).toBe("smtp.gmail.com");
    expect(env.SMTP_PORT).toBe(465);
  });

  it("refuses to start without a session secret (no insecure fallback)", () => {
    const { SESSION_SECRET: _s, ...rest } = base;
    expect(() => parseEnv({ ...rest, APP_ENV: "DEMO", DATABASE_URL: db("rs_v31_demo") })).toThrow(/SESSION_SECRET/);
  });

  it("rejects a short session secret", () => {
    expect(() => parseEnv({ ...base, SESSION_SECRET: "short", APP_ENV: "DEMO", DATABASE_URL: db("rs_v31_demo") })).toThrow(/32/);
  });

  it("rejects an unknown APP_ENV", () => {
    expect(() => parseEnv({ ...base, APP_ENV: "PROD", DATABASE_URL: db("rs_v3") })).toThrow(/APP_ENV/);
  });

  it("DEMO cannot point at a non-demo database", () => {
    expect(() => parseEnv({ ...base, APP_ENV: "DEMO", DATABASE_URL: db("rs_v31_client") })).toThrow(/demo/);
  });

  it("TEST cannot point at a non-test database", () => {
    expect(() => parseEnv({ ...base, APP_ENV: "TEST", DATABASE_URL: db("rs_v31_demo") })).toThrow(/test/);
  });

  it("CLIENT_READY cannot point at a demo or test database", () => {
    expect(() => parseEnv({ ...base, APP_ENV: "CLIENT_READY", DATABASE_URL: db("rs_v31_demo") })).toThrow(/demo\/test/);
    expect(() => parseEnv({ ...base, APP_ENV: "CLIENT_READY", DATABASE_URL: db("rs_v31_test") })).toThrow(/demo\/test/);
  });

  const clientReady = {
    ...base,
    APP_ENV: "CLIENT_READY",
    DATABASE_URL: `${db("rs_v31_client")}?connection_limit=5&pool_timeout=10`,
    STORAGE_ROOT: "/srv/rs-v3/client/storage",
  };

  it("CLIENT_READY forbids demo reset and plain http", () => {
    expect(parseEnv(clientReady).APP_ENV).toBe("CLIENT_READY");
    expect(() => parseEnv({ ...clientReady, DEMO_RESET_ENABLED: "true" })).toThrow(/DEMO_RESET_ENABLED/);
    expect(() => parseEnv({ ...clientReady, PUBLIC_APP_URL: "http://client.example.com" })).toThrow(/https/);
  });

  it("CLIENT_READY requires a storage folder and a sized connection pool", () => {
    const { STORAGE_ROOT: _s, ...noStorage } = clientReady;
    expect(() => parseEnv(noStorage)).toThrow(/STORAGE_ROOT/);
    expect(() => parseEnv({ ...clientReady, DATABASE_URL: db("rs_v31_client") })).toThrow(/connection_limit/);
    expect(parseEnv(clientReady).databaseName).toBe("rs_v31_client");
  });

  it("allowed origins: PUBLIC_APP_URL first, then ALLOWED_ORIGINS (local server on the LAN)", () => {
    const demo = { ...base, APP_ENV: "DEMO", DATABASE_URL: db("rs_v31_demo") };
    expect(parseEnv(demo).allowedOrigins).toEqual(["https://demo.example.com"]);
    const lan = parseEnv({ ...demo, ALLOWED_ORIGINS: " http://192.168.1.20:3300, http://shop-pc:3300/,https://demo.example.com " });
    expect(lan.allowedOrigins).toEqual(["https://demo.example.com", "http://192.168.1.20:3300", "http://shop-pc:3300"]);
    expect(() => parseEnv({ ...demo, ALLOWED_ORIGINS: "not a url" })).toThrow(/ALLOWED_ORIGINS/);
    expect(() => parseEnv({ ...demo, ALLOWED_ORIGINS: "http://192.168.1.20:3300/login" })).toThrow(/origin only/);
  });

  it("requires paired admin and SMTP credentials", () => {
    const demo = { ...base, APP_ENV: "DEMO", DATABASE_URL: db("rs_v31_demo") };
    expect(parseEnv({ ...demo, ADMIN_EMAIL: "owner@example.com", ADMIN_PASSWORD: "long-initial-password" }).ADMIN_EMAIL)
      .toBe("owner@example.com");
    expect(() => parseEnv({ ...demo, ADMIN_EMAIL: "owner@example.com" })).toThrow(/ADMIN_EMAIL and ADMIN_PASSWORD/);
    expect(() => parseEnv({ ...demo, ADMIN_PASSWORD: "long-initial-password" })).toThrow(/ADMIN_EMAIL and ADMIN_PASSWORD/);
    expect(() => parseEnv({ ...demo, SMTP_USER: "owner@gmail.com" })).toThrow(/SMTP_USER and SMTP_PASS/);
    expect(() => parseEnv({ ...demo, SMTP_FROM: "owner@gmail.com" })).toThrow(/SMTP_FROM requires/);
  });

  it("switch button address: optional, never this environment, https for CLIENT_READY", () => {
    const demo = { ...base, APP_ENV: "DEMO", DATABASE_URL: db("rs_v31_demo") };
    expect(parseEnv(demo).SWITCH_APP_URL).toBeUndefined();
    expect(parseEnv({ ...demo, SWITCH_APP_URL: "" }).SWITCH_APP_URL).toBeUndefined();
    expect(parseEnv({ ...demo, SWITCH_APP_URL: "https://app.example.com" }).SWITCH_APP_URL).toBe("https://app.example.com");
    expect(() => parseEnv({ ...demo, SWITCH_APP_URL: "https://demo.example.com/x" })).toThrow(/other environment/);
    const live = { ...base, APP_ENV: "CLIENT_READY", PUBLIC_APP_URL: "https://app.example.com", DATABASE_URL: db("rs_v3"), STORAGE_ROOT: "/srv/rs-v3/client/storage" };
    expect(() => parseEnv({ ...live, SWITCH_APP_URL: "http://demo.example.com" })).toThrow(/https SWITCH_APP_URL/);
  });
});
