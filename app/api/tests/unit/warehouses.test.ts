import { describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors.js";
import { suggestSaleSplits, validateSplits } from "../../src/lib/warehouses.js";

// V3.1 warehouses (docs\WAREHOUSE-V3-PLAN.md §5 test 11): Take-from suggestion and split checks.

const W = (warehouseId: string, quantity: number) => ({ warehouseId, code: warehouseId.toUpperCase(), quantity });

describe("suggestSaleSplits", () => {
  it("takes from the default warehouse first, then the largest", () => {
    expect(suggestSaleSplits([W("w2", 8), W("w1", 3), W("w3", 2)], 5, "w1")).toEqual([
      { warehouseId: "w1", quantity: 3 },
      { warehouseId: "w2", quantity: 2 },
    ]);
  });

  it("uses one warehouse when it covers the line", () => {
    expect(suggestSaleSplits([W("w1", 10), W("w2", 4)], 4, "w1")).toEqual([{ warehouseId: "w1", quantity: 4 }]);
  });

  it("puts what no warehouse covers on the first picked warehouse (company shortage, WH-6a)", () => {
    expect(suggestSaleSplits([W("w2", 3)], 5, "w1")).toEqual([{ warehouseId: "w2", quantity: 5 }]);
    expect(suggestSaleSplits([], 2, "w1")).toEqual([{ warehouseId: "w1", quantity: 2 }]);
  });

  it("ignores empty or negative warehouses and keeps lengths exact", () => {
    expect(suggestSaleSplits([W("w1", -2), W("w2", 0.3), W("w3", 0.2)], 0.4, "w1")).toEqual([
      { warehouseId: "w2", quantity: 0.3 },
      { warehouseId: "w3", quantity: 0.1 },
    ]);
  });
});

describe("validateSplits", () => {
  const code = (fn: () => void) => {
    try {
      fn();
      return null;
    } catch (e) {
      return e instanceof AppError ? e.code : "OTHER";
    }
  };
  it("accepts a split that adds up", () => {
    expect(code(() => validateSplits("Bolt", 5, [{ warehouseId: "a", quantity: 3 }, { warehouseId: "b", quantity: 2 }]))).toBeNull();
  });
  it("refuses wrong totals, duplicates and zero parts", () => {
    expect(code(() => validateSplits("Bolt", 5, [{ warehouseId: "a", quantity: 3 }]))).toBe("SPLIT_TOTAL");
    expect(code(() => validateSplits("Bolt", 4, [{ warehouseId: "a", quantity: 2 }, { warehouseId: "a", quantity: 2 }]))).toBe("SPLIT_DUPLICATE");
    expect(code(() => validateSplits("Bolt", 2, [{ warehouseId: "a", quantity: 2 }, { warehouseId: "b", quantity: 0 }]))).toBe("SPLIT_QUANTITY");
  });
});
