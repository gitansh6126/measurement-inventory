import { describe, expect, it } from "vitest";
import { alternatives, planSets, setStatus, wantComplete, type PlanLink, type PlanSet, type PlanStock, type SetWant } from "@rs-v31/shared/sets";

// docs\SET-BUILD-IN-SALE-PLAN.md §3.1: Ready sets first, else the set needing the fewest changes
// whose new parts are in free stock; two sets never count on the same piece.

const links: PlanLink[] = [
  { id: "chain", required: true, measured: true },
  { id: "hook", required: false, measured: false },
];
const m = (metres: number) => Math.round(metres * 1000);
const sets: PlanSet[] = [
  { id: "A", warehouseId: null, parts: [{ byproductId: "chain", variationId: "6mm", lengthMilli: m(3) }, { byproductId: "hook", variationId: "1T", lengthMilli: null }] },
  { id: "B", warehouseId: null, parts: [{ byproductId: "chain", variationId: "8mm", lengthMilli: m(3) }] },
  { id: "C", warehouseId: null, parts: [{ byproductId: "chain", variationId: "6mm", lengthMilli: m(5) }, { byproductId: "hook", variationId: "1T", lengthMilli: null }] },
];
const stock = (): PlanStock => ({
  pieces: [
    { id: "p8cut", variationId: "8mm", kind: "CUT", remainingMilli: m(5.2), warehouseId: null },
    { id: "p8open", variationId: "8mm", kind: "OPEN", remainingMilli: m(42), warehouseId: null },
    { id: "p10open", variationId: "10mm", kind: "OPEN", remainingMilli: m(50), warehouseId: null },
  ],
  counted: { "1T|": 2, "2T|": 0 },
});
const want = (chain: string, metres: number, hook: string | null): SetWant => ({ chain: { variationId: chain, lengthMilli: m(metres) }, hook: hook ? { variationId: hook, lengthMilli: null } : null });

describe("planSets", () => {
  it("uses a set that already matches, without changes", () => {
    const r = planSets(links, sets, want("8mm", 3, null), 1, stock());
    expect(r).toEqual({ picks: [{ setId: "B", ready: true, changes: [] }], problems: [], backorders: 0 });
  });

  it("changes the set needing the fewest changes when none matches", () => {
    const r = planSets(links, sets, want("8mm", 3, "1T"), 1, stock());
    expect(r.picks[0]).toMatchObject({ setId: "B", ready: false, changes: [{ byproductId: "hook", action: "ADD", variationId: "1T", from: null }] });
  });

  it("treats a different length as a chain change and cuts from a cut piece before a roll", () => {
    const r = planSets(links, sets, want("8mm", 4, null), 1, stock());
    expect(r.picks[0]!.setId).toBe("B");
    expect(r.picks[0]!.changes).toEqual([
      { byproductId: "chain", action: "REPLACE", variationId: "8mm", lengthMilli: m(4), pieceId: "p8cut", from: { byproductId: "chain", variationId: "8mm", lengthMilli: m(3) } },
    ]);
  });

  it("never counts two sets on the same piece and reports why the rest cannot be made", () => {
    const s = stock();
    s.pieces = s.pieces.filter((p) => p.id === "p8cut");
    const r = planSets(links, sets, want("8mm", 3, "1T"), 3, s);
    // A and B need one change each; B (a hook, no cut) first, then A gets a 3 m 8 mm chain from the
    // cut piece (5.2 m → 2.2 m left); C would need another 3 m and cannot.
    expect(r.picks.map((p) => p.setId)).toEqual(["B", "A"]);
    expect(r.picks[1]!.changes[0]).toMatchObject({ action: "REPLACE", pieceId: "p8cut" });
    expect(r.problems).toEqual([{ kind: "NO_PIECE", byproductId: "chain", variationId: "8mm", lengthMilli: m(3) }]);
    expect(s.pieces[0]!.remainingMilli).toBe(m(5.2));
  });

  it("removes an optional part that is not wanted and refuses a part with no free stock", () => {
    expect(planSets(links, sets, want("6mm", 3, null), 1, stock()).picks[0]!.changes).toMatchObject([{ byproductId: "hook", action: "REMOVE" }]);
    const r = planSets(links, sets, want("6mm", 3, "2T"), 1, stock());
    expect(r.picks).toEqual([]);
    expect(r.problems).toEqual([{ kind: "NO_FREE", byproductId: "hook", variationId: "2T" }]);
  });

  it("uses the bundle and the set the seller chose", () => {
    const r = planSets(links, sets, want("8mm", 4, null), 1, stock(), { preferred: { 0: "C" }, chosenPieces: { C: { chain: "p8open" } } });
    expect(r.picks[0]).toMatchObject({ setId: "C", changes: [{ byproductId: "chain", pieceId: "p8open" }, { byproductId: "hook", action: "REMOVE" }] });
  });

  it("takes new parts only from the set's warehouse", () => {
    const inW2: PlanSet[] = [{ ...sets[1]!, warehouseId: "W2" }];
    const r = planSets(links, inW2, want("10mm", 3, null), 1, stock());
    expect(r.problems).toEqual([{ kind: "NO_PIECE", byproductId: "chain", variationId: "10mm", lengthMilli: m(3) }]);
  });

  it("backorder: marks a chain no bundle has, keeping sets that can be made from stock first", () => {
    const strict = planSets(links, sets, want("8mm", 232, null), 2, stock());
    expect(strict.picks).toEqual([]);
    expect(strict.problems).toEqual([{ kind: "NO_PIECE", byproductId: "chain", variationId: "8mm", lengthMilli: m(232) }]);
    const r = planSets(links, sets, want("8mm", 232, null), 2, stock(), { backorder: true });
    expect(r.backorders).toBe(2);
    // B needs only the chain change; A then (chain + hook removed).
    expect(r.picks.map((p) => p.setId)).toEqual(["B", "A"]);
    expect(r.picks[0]!.changes).toEqual([{ byproductId: "chain", action: "REPLACE", variationId: "8mm", lengthMilli: m(232), backorder: true, from: { byproductId: "chain", variationId: "8mm", lengthMilli: m(3) } }]);
    expect(r.picks[0]!.changes[0]!.pieceId).toBeUndefined();
    expect(r.problems).toEqual([{ kind: "NO_PIECE", byproductId: "chain", variationId: "8mm", lengthMilli: m(232) }]);
  });

  it("backorder: a counted part with no free stock, while a set from stock is used without one", () => {
    const r = planSets(links, sets, want("6mm", 3, "2T"), 1, stock(), { backorder: true });
    expect(r.picks[0]).toMatchObject({ setId: "A", changes: [{ byproductId: "hook", action: "REPLACE", variationId: "2T", backorder: true }] });
    const fine = planSets(links, sets, want("8mm", 4, null), 1, stock(), { backorder: true });
    expect(fine.backorders).toBe(0);
    expect(fine.picks[0]!.changes[0]).toMatchObject({ pieceId: "p8cut" });
    expect(fine.picks[0]!.changes[0]!.backorder).toBeUndefined();
  });

  it("says when there are no sets at all", () => {
    expect(planSets(links, [], want("8mm", 3, null), 1, stock()).problems).toEqual([{ kind: "NO_SETS" }]);
  });
});

describe("setStatus / alternatives / wantComplete", () => {
  it("labels each set Ready, Needs change or Can't make", () => {
    const w = want("8mm", 3, null);
    expect(sets.map((s) => setStatus(links, s, w, stock()).status)).toEqual(["CHANGE", "READY", "CHANGE"]);
    expect(setStatus(links, sets[0]!, want("8mm", 3, "2T"), stock()).status).toBe("CANNOT");
    expect(alternatives(links, sets, w, stock(), ["B"]).map((a) => a.setId)).toEqual(["A", "C"]);
  });

  it("needs every required part, measured lengths, and an explicit choice for optional parts", () => {
    expect(wantComplete(links, want("8mm", 3, null))).toBe(true);
    expect(wantComplete(links, { chain: { variationId: "8mm", lengthMilli: 0 }, hook: null })).toBe(false);
    expect(wantComplete(links, { chain: { variationId: "8mm", lengthMilli: m(3) } })).toBe(false);
  });
});
