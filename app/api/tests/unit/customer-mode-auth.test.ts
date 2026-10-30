import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/auth.js";

describe("Customer Mode staff verification", () => {
  it("verifies staff passwords correctly", async () => {
    const rawPassword = "StaffSecretPassword123!";
    const hash = await hashPassword(rawPassword);

    expect(await verifyPassword(rawPassword, hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });
});
