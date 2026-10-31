import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../src/lib/errors.js";
import { requireWarehouse, requireWarehouses, suggestSaleSplits, validateSplits } from "../../src/lib/warehouses.js";

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

describe("requireWarehouses & requireWarehouse (batching and validation)", () => {
  const mockDb = (records: { id: string; code: string; name: string; active: boolean; isDefault: boolean }[]) => {
    const findMany = vi.fn().mockImplementation(async ({ where }: { where: { id: { in: string[] }; companyId: string } }) => {
      // simulate company isolation: only return if matching companyId
      if (where.companyId !== "c1") return [];
      return records.filter((r) => where.id.in.includes(r.id));
    });
    return { db: { warehouse: { findMany } } as any, findMany };
  };

  const w1 = { id: "w1", code: "WH-1", name: "Main Godown", active: true, isDefault: true };
  const w2 = { id: "w2", code: "WH-2", name: "Shop Floor", active: true, isDefault: false };
  const w3Inactive = { id: "w3", code: "WH-3", name: "Old Yard", active: false, isDefault: false };

  it("batches multiple warehouse lookups into a single findMany call", async () => {
    const { db, findMany } = mockDb([w1, w2]);
    const res = await requireWarehouses(db, "c1", ["w1", "w2"]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ["w1", "w2"] }, companyId: "c1" },
      select: { id: true, code: true, name: true, active: true, isDefault: true },
    });
    expect(res.size).toBe(2);
    expect(res.get("w1")).toEqual(w1);
    expect(res.get("w2")).toEqual(w2);
  });

  it("deduplicates warehouse IDs before issuing query", async () => {
    const { db, findMany } = mockDb([w1, w2]);
    const res = await requireWarehouses(db, "c1", ["w1", "w2", "w1", "w2", "w1"]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: ["w1", "w2"] }, companyId: "c1" },
      select: { id: true, code: true, name: true, active: true, isDefault: true },
    });
    expect(res.size).toBe(2);
  });

  it("throws UNKNOWN_WAREHOUSE (400) if any requested warehouse is missing", async () => {
    const { db } = mockDb([w1]);
    await expect(requireWarehouses(db, "c1", ["w1", "w_nonexistent"])).rejects.toMatchObject({
      status: 400,
      code: "UNKNOWN_WAREHOUSE",
    });
  });

  it("enforces tenant isolation (cross-company access treated as missing)", async () => {
    const { db } = mockDb([w1]);
    // queried with company "c2" where records belong to "c1"
    await expect(requireWarehouses(db, "c2", ["w1"])).rejects.toMatchObject({
      status: 400,
      code: "UNKNOWN_WAREHOUSE",
    });
  });

  it("throws WAREHOUSE_INACTIVE (400) when active: true is requested for inactive warehouse", async () => {
    const { db } = mockDb([w1, w3Inactive]);
    await expect(requireWarehouses(db, "c1", ["w1", "w3"], { active: true })).rejects.toMatchObject({
      status: 400,
      code: "WAREHOUSE_INACTIVE",
      message: "WH-3 Old Yard is inactive",
    });
  });

  it("allows inactive warehouse when active option is omitted or false", async () => {
    const { db } = mockDb([w1, w3Inactive]);
    const res = await requireWarehouses(db, "c1", ["w1", "w3"]);
    expect(res.size).toBe(2);
    expect(res.get("w3")?.active).toBe(false);
  });

  it("returns an empty map immediately on empty input without querying database", async () => {
    const { db, findMany } = mockDb([]);
    const res = await requireWarehouses(db, "c1", []);
    expect(findMany).not.toHaveBeenCalled();
    expect(res.size).toBe(0);
  });

  it("requireWarehouse delegates correctly to requireWarehouses for single lookups", async () => {
    const { db, findMany } = mockDb([w1]);
    const res = await requireWarehouse(db, "c1", "w1");
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(res).toEqual(w1);

    await expect(requireWarehouse(db, "c1", "w_missing")).rejects.toMatchObject({
      status: 400,
      code: "UNKNOWN_WAREHOUSE",
    });
  });
});
