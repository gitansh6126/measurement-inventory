import {
  convertBaseMilli,
  feetInchesToMilli,
  formatLength,
  isScrapLeftover,
  lineAmountRupees,
  longEnough,
  milliToDecimal,
  planCuts,
  rateFromDefault,
  rateToDefault,
  shorterThan,
  sortPieces,
  toBaseMilli,
  toMilli,
  type PieceLite,
} from "@rs-v31/shared/measure";
import { describe, expect, it } from "vitest";
import { lineGrossPaise } from "../../src/lib/documents.js";

// Wireframe W8 example: Wire Rope 6×19 FC 10 mm (lengths in metres, thousandths).
const t = (d: string) => new Date(`2026-${d}T10:00:00+05:30`);
const pieces: PieceLite[] = [
  { id: "c12", code: "WR-0012", variationId: "v10", kind: "CUT", remainingMilli: 22_500, receivedAt: t("10-02") },
  { id: "c14", code: "WR-0014", variationId: "v10", kind: "CUT", remainingMilli: 4_200, receivedAt: t("10-09") },
  { id: "o07", code: "WR-0007", variationId: "v10", kind: "OPEN", remainingMilli: 310_000, receivedAt: t("09-18") },
  { id: "s16", code: "WR-0016", variationId: "v10", kind: "CLOSED", remainingMilli: 500_000, receivedAt: t("10-11") },
  { id: "s15", code: "WR-0015", variationId: "v10", kind: "CLOSED", remainingMilli: 500_000, receivedAt: t("10-11") },
  { id: "s03", code: "WR8-0003", variationId: "v8", kind: "CLOSED", remainingMilli: 500_000, receivedAt: t("09-01") },
];

describe("lengths", () => {
  it("keeps exact thousandths", () => {
    expect(toMilli("18.375")).toBe(18_375);
    expect(toMilli(0.1 + 0.2)).toBe(300);
    expect(milliToDecimal(18_375)).toBe("18.375");
    expect(milliToDecimal(500)).toBe("0.500");
    expect(milliToDecimal(-4_200)).toBe("-4.200");
  });
  it("converts typed units into the base unit", () => {
    expect(toBaseMilli(250, "cm", "m")).toBe(2_500);
    expect(toBaseMilli(10, "ft", "m")).toBe(3_048);
    expect(toBaseMilli(2, "ft", "ft_in")).toBe(24_000);
    expect(toBaseMilli(1, "m", "ft_in")).toBe(39_370);
    expect(Number.isNaN(toBaseMilli(1, "kg", "m"))).toBe(true);
    expect(feetInchesToMilli(41, 8)).toBe(500_000);
  });
  it("formats metres and feet + inches", () => {
    expect(formatLength(18_000, "m")).toBe("18 m");
    expect(formatLength(22_500, "m", 1)).toBe("22.5 m");
    expect(formatLength(500_000, "ft_in")).toBe("41 ft 8 in");
    expect(formatLength(6_500, "ft_in")).toBe("6.5 in");
    expect(formatLength(24_000, "ft_in")).toBe("2 ft");
  });
  it("converts stored lengths between base units", () => {
    expect(convertBaseMilli(25_400, "m", "ft_in")).toBe(1_000_000);
    expect(convertBaseMilli(1_000_000, "ft_in", "m")).toBe(25_400);
  });
});

describe("piece order (DM-5): Cut → Open → Closed, smallest first", () => {
  it("sorts by kind, then length, then receipt, then code", () => {
    expect(sortPieces(pieces.filter((p) => p.variationId === "v10")).map((p) => p.id)).toEqual(["c14", "c12", "o07", "s15", "s16"]);
  });
  it("lists only pieces long enough, and the rest as alternatives", () => {
    const own = pieces.filter((p) => p.variationId === "v10");
    expect(longEnough(own, 18_000).map((p) => p.id)).toEqual(["c12", "o07", "s15", "s16"]);
    expect(shorterThan(own, 18_000).map((p) => p.id)).toEqual(["c14"]);
  });
});

describe("planCuts (DM-4: one piece per line, never joined)", () => {
  it("takes the smallest Cut piece that fits (wireframe W14)", () => {
    const { cuts, problems } = planCuts([{ key: "1", variationId: "v10", lengthMilli: 18_000 }], pieces);
    expect(problems).toEqual([]);
    expect(cuts[0]).toMatchObject({ pieceId: "c12", beforeMilli: 22_500, afterMilli: 4_500 });
  });
  it("lets later lines see what earlier lines took", () => {
    const { cuts } = planCuts(
      [
        { key: "1", variationId: "v10", lengthMilli: 18_000 },
        { key: "2", variationId: "v10", lengthMilli: 4_500 },
        { key: "3", variationId: "v10", lengthMilli: 4_400 },
      ],
      pieces,
    );
    // Line 2 fits the 4.5 m left on c12 exactly (Cut pieces first); line 3 no longer fits there.
    expect(cuts.map((c) => [c.key, c.pieceId, c.afterMilli])).toEqual([
      ["1", "c12", 4_500],
      ["2", "c12", 0],
      ["3", "o07", 305_600],
    ]);
  });
  it("never joins pieces: reports the longest piece instead", () => {
    const { cuts, problems } = planCuts([{ key: "1", variationId: "v10", lengthMilli: 600_000 }], pieces);
    expect(cuts).toEqual([]);
    expect(problems[0]).toMatchObject({ code: "NO_PIECE_LONG_ENOUGH", longestMilli: 500_000 });
  });
  it("honours a chosen piece, and refuses one that is too short or unknown", () => {
    expect(planCuts([{ key: "1", variationId: "v10", lengthMilli: 18_000, pieceId: "s15" }], pieces).cuts[0]!.pieceId).toBe("s15");
    expect(planCuts([{ key: "1", variationId: "v10", lengthMilli: 18_000, pieceId: "c14" }], pieces).problems[0]!.code).toBe("PIECE_TOO_SHORT");
    expect(planCuts([{ key: "1", variationId: "v10", lengthMilli: 1_000, pieceId: "s03" }], pieces).problems[0]!.code).toBe("PIECE_NOT_AVAILABLE");
  });
  it("flags leftovers under the scrap length (DM-7)", () => {
    expect(isScrapLeftover(300, 500)).toBe(true);
    expect(isScrapLeftover(0, 500)).toBe(false);
    expect(isScrapLeftover(600, 500)).toBe(false);
    expect(isScrapLeftover(300, null)).toBe(false);
  });
});

describe("line amounts in whole rupees (owner decision: no paise)", () => {
  it("keeps whole quantities exact and rounds a fractional length half-up to the rupee", () => {
    expect(lineAmountRupees(18_000, 72)).toBe(1_296);
    expect(lineAmountRupees(18_375, 73)).toBe(1_341); // 1341.375
    expect(lineAmountRupees(10_500, 15)).toBe(158); // 157.5 → 158
    expect(lineGrossPaise(18_000, 7_200n)).toBe(129_600n);
    expect(lineGrossPaise(18_375, 7_300n)).toBe(134_100n);
    expect(lineGrossPaise(10_500, 1_500n)).toBe(15_800n);
    // Older paise prices on whole quantities stay exact.
    expect(lineGrossPaise(3_000, 33n)).toBe(99n);
  });
});

describe("rate unit (0028: per m, per ft on feet + inches)", () => {
  it("converts a typed rate to the default unit in whole rupees", () => {
    expect(rateToDefault(10, "in", "ft_in")).toBe(120);
    expect(rateToDefault(120, "ft", "ft_in")).toBe(120);
    expect(rateToDefault(500, "m", "ft_in")).toBe(152); // 152.4
    expect(rateToDefault(100, "ft", "m")).toBe(328); // 328.08
    expect(rateToDefault(100, "cm", "m")).toBeNaN();
  });
  it("shows a stored rate per another unit", () => {
    expect(rateFromDefault(120, "in", "ft_in")).toBeCloseTo(10);
    expect(rateFromDefault(100, "ft", "m")).toBeCloseTo(30.48);
  });
  it("amounts a length in inches at a per-foot rate", () => {
    expect(lineAmountRupees(24_000, 100, 12)).toBe(200); // 2 ft
    expect(lineAmountRupees(7_000, 100, 12)).toBe(58); // 58.33
    expect(lineAmountRupees(6_000, 100, 12)).toBe(50);
    expect(lineAmountRupees(7_500, 100, 1)).toBe(750);
  });
  it("matches the server line amount at a per-foot rate", () => {
    expect(lineGrossPaise(24_000, 10_000n, 12)).toBe(20_000n); // 24 in at ₹100 / ft
    expect(lineGrossPaise(7_000, 10_000n, 12)).toBe(5_800n); // 7 in → ₹58.33 → ₹58
    expect(lineGrossPaise(6_000, 10_000n, 12)).toBe(5_000n); // 6 in → ₹50
    expect(lineGrossPaise(14_400_000, 4_800n, 12)).toBe(5_760_000n); // 1,200 ft at ₹48 / ft = ₹57,600
  });
});
