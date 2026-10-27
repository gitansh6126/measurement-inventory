import { describe, expect, it } from "vitest";
import { money, stockState } from "../../src/lib/stock.js";

describe("stockState (main v2: out ≤ 0, low ≤ threshold)", () => {
  it("is out at zero, including a new product with threshold 0 (BR-08a)", () => {
    expect(stockState(0, 0)).toBe("out");
    expect(stockState(0, 5)).toBe("out");
  });
  it("is low at or below the threshold", () => {
    expect(stockState(5, 5)).toBe("low");
    expect(stockState(4, 5)).toBe("low");
  });
  it("is ok above the threshold", () => {
    expect(stockState(6, 5)).toBe("ok");
    expect(stockState(1, 0)).toBe("ok");
  });
});

describe("money input", () => {
  it("accepts whole rupee amounts", () => {
    expect(money.parse("450")).toBe("450");
    expect(money.parse(380)).toBe("380");
    expect(money.parse("0")).toBe("0");
  });
  it("rejects decimals, negatives, exponents and text", () => {
    for (const bad of ["-1", "450.5", "1.005", "1e3", "abc", "", "12345678901"]) expect(money.safeParse(bad).success).toBe(false);
  });
});
