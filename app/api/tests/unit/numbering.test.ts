import { describe, expect, it } from "vitest";
import { dateKeyOf, fiscalYearOf, formatDocNumber } from "../../src/lib/numbering.js";

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

describe("dateKeyOf (Asia/Kolkata DDMMYYYY)", () => {
  it("formats day, month and year with zero padding in Asia/Kolkata", () => {
    expect(dateKeyOf(new Date("2026-10-30T10:19:35+05:30"))).toBe("30102026");
    expect(dateKeyOf(new Date("2026-04-05T00:00:00+05:30"))).toBe("05042026");
    // Boundary check: 31 Oct 2026 18:30 UTC is 1 Nov 2026 00:00 in India
    expect(dateKeyOf(new Date("2026-10-31T18:30:00Z"))).toBe("01112026");
  });
});

describe("formatDocNumber", () => {
  it("formats document numbers with Indian DDMMYYYY date and 3-digit day sequence", () => {
    expect(formatDocNumber("sale", "30102026", 1)).toBe("SAL-30102026-001");
    expect(formatDocNumber("purchase", "30102026", 42)).toBe("PUR-30102026-042");
    expect(formatDocNumber("saleOrder", "30102026", 1)).toBe("SO-30102026-001");
    expect(formatDocNumber("purchaseOrder", "30102026", 2)).toBe("PO-30102026-002");
    expect(formatDocNumber("transfer", "30102026", 3)).toBe("TRF-30102026-003");
    expect(formatDocNumber("sale", "30102026", 12345)).toBe("SAL-30102026-12345");
  });
});
