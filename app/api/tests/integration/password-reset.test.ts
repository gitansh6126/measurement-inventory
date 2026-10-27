import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/db.js";
import { getEnv } from "../../src/env.js";
import { log } from "../../src/lib/logger.js";
import { ORIGIN, app, makeCompany, makeUser, signIn } from "./helpers.js";

describe("self-service password reset", () => {
  afterEach(() => vi.restoreAllMocks());

  it("keeps requests generic, consumes a six-digit code once, and revokes all sessions", async () => {
    const company = await makeCompany();
    const user = await makeUser(company.id, "admin");
    const existingSession = await signIn(user.email);
    const warnings = vi.spyOn(log, "warn");
    const env = { ...getEnv(), SMTP_USER: undefined, SMTP_PASS: undefined, SMTP_FROM: undefined };
    const client = request.agent(createApp(env));

    const unknown = await client
      .post("/api/auth/password-reset/request")
      .set("Origin", ORIGIN)
      .send({ email: "not-registered@test.local" });
    const requested = await client
      .post("/api/auth/password-reset/request")
      .set("Origin", ORIGIN)
      .send({ email: user.email });

    expect(unknown.status).toBe(202);
    expect(requested.status).toBe(202);
    expect(unknown.body).toEqual(requested.body);
    const code = warnings.mock.calls.find(([message]) => message === "password_reset_code_logged")?.[1]?.code;
    expect(typeof code).toBe("string");
    if (typeof code !== "string") throw new Error("Expected the reset code to be logged without SMTP credentials");
    expect(code).toMatch(/^\d{6}$/);

    const changed = await client
      .post("/api/auth/password-reset/confirm")
      .set("Origin", ORIGIN)
      .send({
        email: user.email,
        code,
        newPassword: "updated-reset-password",
        confirmPassword: "updated-reset-password",
      });
    expect(changed.status).toBe(200);
    expect(await prisma.auditEvent.count({ where: { entityId: user.id, action: "AUDIT_PASSWORD_RESET_VIA_EMAIL" } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect((await existingSession.get("/api/auth/me")).status).toBe(401);
    const newLogin = await client
      .post("/api/auth/login")
      .set("Origin", ORIGIN)
      .send({ email: user.email, password: "updated-reset-password" });
    expect(newLogin.status).toBe(200);

    const replay = await client
      .post("/api/auth/password-reset/confirm")
      .set("Origin", ORIGIN)
      .send({
        email: user.email,
        code,
        newPassword: "another-reset-password",
        confirmPassword: "another-reset-password",
      });
    expect(replay.status).toBe(400);
    expect(replay.body.error.code).toBe("INVALID_RESET_CODE");
    expect(await prisma.passwordResetCode.count({ where: { userId: user.id, consumedAt: { not: null } } })).toBe(1);
  });

  it("rejects password confirmation mismatches", async () => {
    const response = await request(app())
      .post("/api/auth/password-reset/confirm")
      .set("Origin", ORIGIN)
      .send({
        email: "someone@test.local",
        code: "123456",
        newPassword: "a-long-enough-password",
        confirmPassword: "a-different-password",
      });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION");
  });
});
