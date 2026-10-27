import { describe, expect, it } from "vitest";
import { fiscalYearOf, formatDocNumber } from "../../src/lib/numbering.js";

describe("fiscalYearOf (Indian FY, Asia/Kolkata)", () => {
  it("April starts a new financial year", () => {
    expect(fiscalYearOf(new Date("2026-04-01T00:00:00+05:30"))).toBe("2026-27");
    expect(fiscalYearOf(new Date("2026-10-13T12:00:00+05:30"))).toBe("2026-27");
  });

  it("January to March belong to the previous start year", () => {
    expect(fiscalYearOf(new Date("2027-03-31T23:59:59+05:30"))).toBe("2026-27");
    expect(fiscalYearOf(new Date("2027-01-01T00:00:00+05:30"))).toBe("2026-27");
  });

  it("uses India time, not UTC, at the 1 April boundary", () => {
    // 31 Mar 2027 19:00 UTC is already 1 Apr 2027 00:30 in India.
    expect(fiscalYearOf(new Date("2027-03-31T19:00:00Z"))).toBe("2027-28");
    // 31 Mar 2027 18:00 UTC is still 31 Mar 23:30 in India.
    expect(fiscalYearOf(new Date("2027-03-31T18:00:00Z"))).toBe("2026-27");
  });

  it("formats the century rollover", () => {
    expect(fiscalYearOf(new Date("2099-06-01T00:00:00+05:30"))).toBe("2099-00");
  });
});

describe("formatDocNumber", () => {
  it("formats sale and purchase numbers", () => {
    expect(formatDocNumber("sale", "2026-27", 1)).toBe("SAL/2026-27/0001");
    expect(formatDocNumber("purchase", "2026-27", 42)).toBe("PUR/2026-27/0042");
    expect(formatDocNumber("sale", "2026-27", 12345)).toBe("SAL/2026-27/12345");
  });
});
