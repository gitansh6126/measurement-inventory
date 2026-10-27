import { describe, expect, it } from "vitest";
import { can } from "../../src/lib/permissions.js";

describe("V1 permission matrix", () => {
  it("only admins archive products, manage users and read the audit log", () => {
    for (const p of ["product.archive", "user.manage", "audit.view", "backup.manage"] as const) {
      expect(can("admin", p)).toBe(true);
      expect(can("sales_manager", p)).toBe(false);
      expect(can("sales_staff", p)).toBe(false);
    }
  });

  it("managers edit products and adjust stock; staff cannot (main v2 BR-24)", () => {
    for (const p of ["product.write", "category.write", "stock.adjust", "inventory.configure"] as const) {
      expect(can("sales_manager", p)).toBe(true);
      expect(can("sales_staff", p)).toBe(false);
    }
  });

  it("every role records sales (decision D2)", () => {
    for (const role of ["admin", "sales_manager", "sales_staff"] as const) {
      expect(can(role, "sale.create")).toBe(true);
      expect(can(role, "catalog.view")).toBe(true);
    }
  });

  it("only admins and managers record purchases (decision D12, matches main v2)", () => {
    expect(can("admin", "purchase.create")).toBe(true);
    expect(can("sales_manager", "purchase.create")).toBe(true);
    expect(can("sales_staff", "purchase.create")).toBe(false);
  });

  it("only admins and managers edit sales and purchases", () => {
    for (const p of ["sale.edit", "purchase.edit"] as const) {
      expect(can("admin", p)).toBe(true);
      expect(can("sales_manager", p)).toBe(true);
      expect(can("sales_staff", p)).toBe(false);
    }
  });
});
