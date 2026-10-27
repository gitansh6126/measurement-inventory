import {
  buildPieceCode,
  buildPiecePrefixKey,
  formatCopyNumber,
  formatPieceDate,
  formatPieceLength,
  milliToDecimal,
  toBaseMilli,
  toMilli,
  trimDecimal,
} from "@rs-v31/shared/measure";
import { describe, expect, it } from "vitest";

describe("New Physical Bundle Stock ID Format — RS Machinery V2", () => {
  // -------------------------------------------------------------------------
  // 1. Formatting tests
  // -------------------------------------------------------------------------
  describe("Date formatting rules (unpadded day/month, 2-digit year in Asia/Kolkata)", () => {
    it("formats 2 January 2026 as 2-1-26", () => {
      const d = new Date("2026-01-02T10:00:00+05:30");
      expect(formatPieceDate(d)).toBe("2-1-26");
    });

    it("formats 9 October 2026 as 9-10-26", () => {
      const d = new Date("2026-10-09T14:30:00+05:30");
      expect(formatPieceDate(d)).toBe("9-10-26");
    });

    it("formats 15 December 2026 as 15-12-26", () => {
      const d = new Date("2026-12-15T09:15:00+05:30");
      expect(formatPieceDate(d)).toBe("15-12-26");
    });

    it("formats 5 February 2027 as 5-2-27", () => {
      const d = new Date("2027-02-05T18:00:00+05:30");
      expect(formatPieceDate(d)).toBe("5-2-27");
    });

    it("confirms day and month have no leading zeros", () => {
      for (let month = 1; month <= 9; month++) {
        const d = new Date(`2026-0${month}-05T12:00:00+05:30`);
        const formatted = formatPieceDate(d);
        const [dayStr, monthStr] = formatted.split("-");
        expect(dayStr).toBe("5");
        expect(monthStr).toBe(String(month));
        expect(dayStr).not.toMatch(/^0/);
        expect(monthStr).not.toMatch(/^0/);
      }
    });

    it("confirms the year strictly uses two digits", () => {
      const d26 = new Date("2026-06-15T12:00:00+05:30");
      expect(formatPieceDate(d26).endsWith("-26")).toBe(true);
      const d27 = new Date("2027-01-01T12:00:00+05:30");
      expect(formatPieceDate(d27).endsWith("-27")).toBe(true);
      const d99 = new Date("2099-12-31T12:00:00+05:30");
      expect(formatPieceDate(d99).endsWith("-99")).toBe(true);
    });

    it("confirms time-zone boundaries in Asia/Kolkata (UTC+5:30) do not shift calendar dates", () => {
      // 2026-01-02 01:00 UTC is 2026-01-02 06:30 IST
      const dEarly = new Date("2026-01-02T01:00:00Z");
      expect(formatPieceDate(dEarly)).toBe("2-1-26");

      // 2026-01-01 20:00 UTC is 2026-01-02 01:30 IST
      const dLateUtc = new Date("2026-01-01T20:00:00Z");
      expect(formatPieceDate(dLateUtc)).toBe("2-1-26");
    });
  });

  describe("Length formatting and canonical unit representation", () => {
    it("confirms lengths have no unnecessary trailing zeros", () => {
      expect(formatPieceLength(toMilli(500))).toBe("500");
      expect(formatPieceLength(toMilli(25.5))).toBe("25.5");
      expect(formatPieceLength(toMilli(4.25))).toBe("4.25");
      expect(formatPieceLength(toMilli(100))).toBe("100");
    });

    it("confirms fractional lengths are represented consistently without floating point drift", () => {
      expect(formatPieceLength(toMilli(0.5))).toBe("0.5");
      expect(formatPieceLength(toMilli(18.375))).toBe("18.375");
      expect(formatPieceLength(toMilli(0.125))).toBe("0.125");
      expect(formatPieceLength(toMilli(22.5))).toBe("22.5");
      expect(formatPieceLength(toMilli(4.2))).toBe("4.2");
      // Floating-point sum check: 0.1 + 0.2
      expect(formatPieceLength(toMilli(0.1 + 0.2))).toBe("0.3");
    });

    it("canonical-unit conversion produces the expected length segment", () => {
      // 250 cm typed for a metre product → 2.5 m
      const milliFromCm = toBaseMilli(250, "cm", "m");
      expect(formatPieceLength(milliFromCm)).toBe("2.5");

      // 2500 mm typed for a metre product → 2.5 m
      const milliFromMm = toBaseMilli(2500, "mm", "m");
      expect(formatPieceLength(milliFromMm)).toBe("2.5");

      // 10 ft typed for a feet/inch product → 120 in
      const milliFromFt = toBaseMilli(10, "ft", "ft_in");
      expect(formatPieceLength(milliFromFt)).toBe("120");
    });

    it("equivalent measurements in supported input units normalize consistently", () => {
      const fromMetres = toBaseMilli(2.5, "m", "m");
      const fromCm = toBaseMilli(250, "cm", "m");
      const fromMm = toBaseMilli(2500, "mm", "m");
      expect(formatPieceLength(fromMetres)).toBe("2.5");
      expect(formatPieceLength(fromCm)).toBe("2.5");
      expect(formatPieceLength(fromMm)).toBe("2.5");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Full stock ID generation and uniqueness rules
  // -------------------------------------------------------------------------
  describe("Stock ID structure and copy number rules", () => {
    const sku = "WR619FC-10MM";
    const dateJan2 = new Date("2026-01-02T10:00:00+05:30");
    const dateOct9 = new Date("2026-10-09T10:00:00+05:30");

    it("generates correct bundle IDs for the prompt examples", () => {
      expect(buildPieceCode(sku, toMilli(500), dateJan2, 1)).toBe("WR619FC-10MM-500-2-1-26-01");
      expect(buildPieceCode(sku, toMilli(500), dateJan2, 2)).toBe("WR619FC-10MM-500-2-1-26-02");
      expect(buildPieceCode(sku, toMilli(500), dateJan2, 3)).toBe("WR619FC-10MM-500-2-1-26-03");
    });

    it("scopes sequence to length: 250m on the same date uses an independent sequence", () => {
      expect(buildPieceCode(sku, toMilli(250), dateJan2, 1)).toBe("WR619FC-10MM-250-2-1-26-01");
      expect(buildPieceCode(sku, toMilli(250), dateJan2, 2)).toBe("WR619FC-10MM-250-2-1-26-02");
    });

    it("scopes sequence to date: same length on a different date uses an independent sequence", () => {
      expect(buildPieceCode(sku, toMilli(500), dateOct9, 1)).toBe("WR619FC-10MM-500-9-10-26-01");
      expect(buildPieceCode(sku, toMilli(500), dateOct9, 2)).toBe("WR619FC-10MM-500-9-10-26-02");
    });

    it("formats copy numbers correctly across 1, 99, 100, 101 without wrapping or truncating", () => {
      expect(formatCopyNumber(1)).toBe("01");
      expect(formatCopyNumber(2)).toBe("02");
      expect(formatCopyNumber(9)).toBe("09");
      expect(formatCopyNumber(10)).toBe("10");
      expect(formatCopyNumber(99)).toBe("99");
      expect(formatCopyNumber(100)).toBe("100");
      expect(formatCopyNumber(101)).toBe("101");
      expect(formatCopyNumber(999)).toBe("999");
      expect(formatCopyNumber(1000)).toBe("1000");

      expect(buildPieceCode(sku, toMilli(500), dateJan2, 100)).toBe("WR619FC-10MM-500-2-1-26-100");
      expect(buildPieceCode(sku, toMilli(500), dateJan2, 101)).toBe("WR619FC-10MM-500-2-1-26-101");
    });
  });

  // -------------------------------------------------------------------------
  // 3. Child cut piece identity and collision avoidance
  // -------------------------------------------------------------------------
  describe("Child cut piece identity", () => {
    const sku = "WR619FC-10MM";
    const cutDate = new Date("2026-10-09T14:00:00+05:30");

    it("uses the child's own original cut length, not the parent bundle length", () => {
      // Child cut piece of 22.5m cut on 9 Oct 2026
      const childCode = buildPieceCode(sku, toMilli(22.5), cutDate, 1, "CUT");
      expect(childCode).toBe("WR619FC-10MM-22.5-9-10-26-C01");
      expect(childCode).not.toContain("500");
    });

    it("avoids collisions between newly received full bundles and cut pieces of identical length and date", () => {
      const fullBundle = buildPieceCode(sku, toMilli(22.5), cutDate, 1, "CLOSED");
      const cutPiece = buildPieceCode(sku, toMilli(22.5), cutDate, 1, "CUT");

      expect(fullBundle).toBe("WR619FC-10MM-22.5-9-10-26-01");
      expect(cutPiece).toBe("WR619FC-10MM-22.5-9-10-26-C01");
      expect(fullBundle).not.toBe(cutPiece);
    });

    it("increments copy numbers independently for cut pieces", () => {
      expect(buildPieceCode(sku, toMilli(22.5), cutDate, 1, "CUT")).toBe("WR619FC-10MM-22.5-9-10-26-C01");
      expect(buildPieceCode(sku, toMilli(22.5), cutDate, 2, "CUT")).toBe("WR619FC-10MM-22.5-9-10-26-C02");
    });
  });

  // -------------------------------------------------------------------------
  // 4. Prefix key generation
  // -------------------------------------------------------------------------
  describe("Prefix key generation for atomic counter allocation", () => {
    const sku = "WR619FC-10MM";
    const date = new Date("2026-01-02T10:00:00+05:30");

    it("generates correct prefix keys for bundles and cut pieces", () => {
      expect(buildPiecePrefixKey(sku, toMilli(500), date, "CLOSED")).toBe("WR619FC-10MM-500-2-1-26");
      expect(buildPiecePrefixKey(sku, toMilli(500), date, "OPEN")).toBe("WR619FC-10MM-500-2-1-26");
      expect(buildPiecePrefixKey(sku, toMilli(22.5), date, "CUT")).toBe("WR619FC-10MM-22.5-2-1-26-C");
    });
  });
});
