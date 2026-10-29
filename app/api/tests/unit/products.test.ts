import { describe, expect, it } from "vitest";
import { AppError } from "../../src/lib/errors.js";
import {
  assertAttributeEditSafe,
  assertBatchUnique,
  attributeDefsSchema,
  createProductBody,
  resolveVariation,
} from "../../src/lib/products.js";

const defs = attributeDefsSchema.parse([
  { name: "Size", unit: "mm", values: ["6", "8", "10"] },
  { name: "Brand", values: ["Crossbee", "Halfen"], abbrMap: { Crossbee: "cb", Unused: "UU" } },
]);

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : String(e);
  }
  return "OK";
};

describe("attribute definitions", () => {
  it("normalises abbreviations to declared values, uppercased", () => {
    expect(defs[1]!.abbrMap).toEqual({ Crossbee: "CB" });
    expect(defs[0]!.unit).toBe("mm");
  });

  it("rejects duplicate attributes, duplicate values, separators and empty value lists", () => {
    expect(attributeDefsSchema.safeParse([{ name: "Size", values: ["1"] }, { name: "size", values: ["2"] }]).success).toBe(false);
    expect(attributeDefsSchema.safeParse([{ name: "Size", values: ["1", "1"] }]).success).toBe(false);
    expect(attributeDefsSchema.safeParse([{ name: "A|B", values: ["1"] }]).success).toBe(false);
    expect(attributeDefsSchema.safeParse([{ name: "A", values: ["1|2"] }]).success).toBe(false);
    expect(attributeDefsSchema.safeParse([{ name: "A", values: [] }]).success).toBe(false);
    expect(attributeDefsSchema.safeParse([]).success).toBe(false);
  });
});

describe("resolveVariation", () => {
  it("generates Short Name (with units) and Official SKU (without) in definition order", () => {
    const v = resolveVariation({ attributes: { Brand: "Crossbee", Size: "8" }, description: null, imageUrl: null }, defs, "ROPE");
    expect(v.attributes).toEqual({ Size: "8", Brand: "Crossbee" });
    expect(v.shortName).toBe("8MM-CB-ROPE");
    expect(v.officialSku).toBe("8-CB-ROPE");
    expect(v.attributeKey).toBe("Brand=Crossbee|Size=8");
  });

  it("keeps a typed Short Name and an explicitly blank Official SKU", () => {
    const v = resolveVariation({ attributes: { Size: "6", Brand: "Halfen" }, shortName: "MY-CODE", officialSku: null, description: null, imageUrl: null }, defs, "ROPE");
    expect(v.shortName).toBe("MY-CODE");
    expect(v.officialSku).toBeNull();
  });

  it("requires a declared value for every attribute and nothing else", () => {
    const base = { description: null, imageUrl: null };
    expect(code(() => resolveVariation({ ...base, attributes: { Size: "8" } }, defs, "R"))).toBe("MISSING_ATTRIBUTE");
    expect(code(() => resolveVariation({ ...base, attributes: { Size: "12", Brand: "Halfen" } }, defs, "R"))).toBe("UNDECLARED_VALUE");
    expect(code(() => resolveVariation({ ...base, attributes: { Size: "8", Brand: "Halfen", Color: "Red" } }, defs, "R"))).toBe("UNKNOWN_ATTRIBUTE");
  });
});

describe("assertBatchUnique", () => {
  const row = (shortName: string, officialSku: string | null, key: string) => ({ attributes: {}, attributeKey: key, shortName, officialSku, description: null, imageUrl: null });
  it("rejects repeated combinations, Short Names and case-insensitive SKUs", () => {
    expect(code(() => assertBatchUnique([row("A", null, "k1"), row("B", null, "k1")]))).toBe("DUPLICATE_COMBINATION");
    expect(code(() => assertBatchUnique([row("A", null, "k1"), row("A", null, "k2")]))).toBe("SHORT_NAME_TAKEN");
    expect(code(() => assertBatchUnique([row("A", "sku-1", "k1"), row("B", "SKU-1", "k2")]))).toBe("OFFICIAL_SKU_TAKEN");
    expect(code(() => assertBatchUnique([row("A", null, "k1"), row("B", null, "k2")]))).toBe("OK");
  });
});

describe("assertAttributeEditSafe (never destroys a variation's identity)", () => {
  const used = [{ attributes: { Size: "8", Brand: "Crossbee" } }];
  const edit = (next: unknown, variations = used) => code(() => assertAttributeEditSafe(defs, attributeDefsSchema.parse(next), variations));

  it("allows adding values and changing units/abbreviations", () => {
    expect(edit([{ name: "Size", unit: "cm", values: ["6", "8", "10", "12"] }, { name: "Brand", values: ["Crossbee", "Halfen", "PF"] }])).toBe("OK");
  });

  it("allows removing a value nobody uses", () => {
    expect(edit([{ name: "Size", values: ["8"] }, { name: "Brand", values: ["Crossbee"] }])).toBe("OK");
  });

  it("refuses removing a used value", () => {
    expect(edit([{ name: "Size", values: ["6", "10"] }, { name: "Brand", values: ["Crossbee"] }])).toBe("VALUE_IN_USE");
  });

  it("refuses renaming, adding or removing attributes once variations exist", () => {
    expect(edit([{ name: "Diameter", values: ["6", "8", "10"] }, { name: "Brand", values: ["Crossbee", "Halfen"] }])).toBe("ATTRIBUTES_LOCKED");
    expect(edit([{ name: "Size", values: ["6", "8", "10"] }])).toBe("ATTRIBUTES_LOCKED");
  });

  it("allows reordering attributes once variations exist", () => {
    expect(edit([{ name: "Brand", values: ["Crossbee", "Halfen"] }, { name: "Size", values: ["6", "8", "10"] }])).toBe("OK");
  });
});

describe("createProductBody", () => {
  it("uppercases Short Name and treats a blank Official SKU as none", () => {
    const b = createProductBody.parse({ productType: "simple", name: " D-Shackle ", unit: "Nos", shortName: " dsh-10 ", officialSku: "  " });
    expect(b).toMatchObject({ name: "D-Shackle", shortName: "DSH-10", officialSku: null, categoryId: null, imageUrl: null });
  });

  it("accepts a named Quality attribute and the selected grade on a variation", () => {
    const b = createProductBody.parse({
      productType: "variable",
      name: "Wire Rope",
      unit: "Piece",
      baseShortName: "WR",
      attributes: [{ name: "Quality", isQuality: true, values: ["3", "4", "5"] }],
      variations: [{ attributes: { Quality: "4" } }],
    });
    if (b.productType !== "variable") throw new Error("Expected a variable product");
    expect(resolveVariation(b.variations[0]!, b.attributes, b.baseShortName).attributes).toEqual({ Quality: "4" });
  });

  it("rejects non-http image URLs", () => {
    const r = createProductBody.safeParse({ productType: "simple", name: "X", unit: "Nos", shortName: "X", imageUrl: "javascript:alert(1)" });
    expect(r.success).toBe(false);
  });
});
