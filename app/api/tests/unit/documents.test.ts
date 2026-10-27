import { describe, expect, it } from "vitest";
import { documentBody, fromPaise, toPaise } from "../../src/lib/documents.js";

describe("paise arithmetic (exact, no float drift)", () => {
  it("converts rupee strings both ways", () => {
    expect(toPaise("450.5")).toBe(45050n);
    expect(toPaise("450.50")).toBe(45050n);
    expect(toPaise("0")).toBe(0n);
    expect(toPaise("12")).toBe(1200n);
    expect(toPaise("0.07")).toBe(7n);
    expect(fromPaise(45050n)).toBe("450.50");
    expect(fromPaise(7n)).toBe("0.07");
    expect(fromPaise(0n)).toBe("0.00");
  });

  it("keeps cases that floats get wrong", () => {
    // 0.1 + 0.2 and 3 × 1.15 are the classic float traps.
    expect(fromPaise(toPaise("0.1") + toPaise("0.2"))).toBe("0.30");
    expect(fromPaise(3n * toPaise("1.15"))).toBe("3.45");
    expect(fromPaise(1_000_000n * toPaise("9999999.99"))).toBe("9999999990000.00");
  });
});

describe("documentBody", () => {
  const line = { variationId: "v1", quantity: 2, price: "10" };
  it("accepts a minimal walk-in document", () => {
    expect(documentBody.parse({ lines: [line] })).toMatchObject({ partyId: null, notes: null, lines: [line] });
  });
  it("rejects empty documents, over-precise or zero quantities, bad prices and bad keys", () => {
    expect(documentBody.safeParse({ lines: [] }).success).toBe(false);
    // V2 measured lengths (DM-2): up to 3 decimals parse; a counted item with a fraction is
    // refused per line once the item is known (createDocument) and by the 0012 trigger.
    expect(documentBody.safeParse({ lines: [{ ...line, quantity: 1.5 }] }).success).toBe(true);
    expect(documentBody.safeParse({ lines: [{ ...line, quantity: 1.0005 }] }).success).toBe(false);
    expect(documentBody.safeParse({ lines: [{ ...line, quantity: 0 }] }).success).toBe(false);
    expect(documentBody.safeParse({ lines: [{ ...line, price: "-1" }] }).success).toBe(false);
    expect(documentBody.safeParse({ lines: [{ ...line, price: "10.50" }] }).success).toBe(false);
    expect(documentBody.safeParse({ lines: [{ ...line, price: "1.005" }] }).success).toBe(false);
    expect(documentBody.safeParse({ lines: [line], clientRef: "not-a-uuid" }).success).toBe(false);
  });
});
