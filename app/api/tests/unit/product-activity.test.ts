import { describe, expect, it } from "vitest";
import { productActivity } from "../../src/lib/product-activity.js";

describe("product activity (Asia/Kolkata calendar dates)", () => {
  const now = new Date("2026-10-15T06:30:00.000Z");

  it("distinguishes never sold and a qualifying sale within six months", () => {
    expect(productActivity(null, now)).toBe("Never Sold");
    expect(productActivity(new Date("2026-10-14T06:30:00.000Z"), now)).toBe("Active");
  });

  it("makes the six-month boundary Min-Active and keeps seven- and eleven-month sales Min-Active", () => {
    expect(productActivity(new Date("2026-04-15T06:30:00.000Z"), now)).toBe("Min-Active");
    expect(productActivity(new Date("2026-03-15T06:30:00.000Z"), now)).toBe("Min-Active");
    expect(productActivity(new Date("2025-11-15T06:30:00.000Z"), now)).toBe("Min-Active");
  });

  it("makes the twelve-month boundary and older sales Inactive", () => {
    expect(productActivity(new Date("2025-10-15T06:30:00.000Z"), now)).toBe("Inactive");
    expect(productActivity(new Date("2025-09-15T06:30:00.000Z"), now)).toBe("Inactive");
  });

  it("uses the business date across UTC day boundaries and clamps month ends", () => {
    const boundaryNow = new Date("2026-10-15T00:30:00.000Z");
    expect(productActivity(new Date("2026-04-15T19:00:00.000Z"), boundaryNow)).toBe("Active");
    expect(productActivity(new Date("2026-04-14T19:00:00.000Z"), boundaryNow)).toBe("Min-Active");

    const monthEnd = new Date("2026-10-31T12:00:00+05:30");
    expect(productActivity(new Date("2026-04-30T12:00:00+05:30"), monthEnd)).toBe("Min-Active");
  });
});
