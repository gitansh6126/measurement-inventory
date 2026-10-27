import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/env.js";
import { log } from "../../src/lib/logger.js";
import { sendPasswordResetCode } from "../../src/lib/password-reset-mailer.js";

// Audit M1: without SMTP only Demo / Test may fall back to logging the code.
const env = (APP_ENV: Env["APP_ENV"]) => ({ APP_ENV, SMTP_USER: undefined, SMTP_PASS: undefined }) as unknown as Env;

afterEach(() => vi.restoreAllMocks());

describe("sendPasswordResetCode without SMTP", () => {
  it("logs the code in DEMO", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    await sendPasswordResetCode(env("DEMO"), "a@b.test", "123456", "req-1");
    expect(warn).toHaveBeenCalledWith("password_reset_code_logged", expect.objectContaining({ code: "123456" }));
  });

  it("throws and logs nothing in CLIENT_READY", async () => {
    const warn = vi.spyOn(log, "warn");
    await expect(sendPasswordResetCode(env("CLIENT_READY"), "a@b.test", "123456", "req-1")).rejects.toThrow(/not configured/);
    expect(warn).not.toHaveBeenCalled();
  });
});
