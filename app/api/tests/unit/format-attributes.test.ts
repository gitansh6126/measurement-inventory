import { describe, expect, it } from "vitest";
import {
  formatAttributeValue,
  formatVariationAttributes,
  formatVariationAttributesString,
  type AttributeDef,
} from "@rs-v31/shared";

describe("formatAttributeValue", () => {
  it("formats value with unit when unit is configured", () => {
    expect(formatAttributeValue("Size", "5", "mm")).toBe("5 mm");
    expect(formatAttributeValue("Length", "10", "m")).toBe("10 m");
    expect(formatAttributeValue("Thickness", "2", "mm")).toBe("2 mm");
  });

  it("does not append unit if attribute has no unit", () => {
    expect(formatAttributeValue("Material", "Steel", "")).toBe("Steel");
    expect(formatAttributeValue("Material", "Steel", undefined)).toBe("Steel");
    expect(formatAttributeValue("Color", "Blue", null)).toBe("Blue");
  });

  it("never appends unit to Quality attributes", () => {
    expect(formatAttributeValue("Quality", "5", "stars", true)).toBe("5");
    expect(formatAttributeValue("Grade", "4", "grade", true)).toBe("4");
  });

  it("avoids duplicating units when stored value already contains the unit", () => {
    expect(formatAttributeValue("Size", "5 mm", "mm")).toBe("5 mm");
    expect(formatAttributeValue("Size", "5mm", "mm")).toBe("5mm");
    expect(formatAttributeValue("Length", "10 m", "m")).toBe("10 m");
    expect(formatAttributeValue("Weight", "25 kg", "kg")).toBe("25 kg");
  });

  it("handles compound sub-attribute values without duplicate units", () => {
    // e.g., "16 (Fibre m)" where unit is "m"
    expect(formatAttributeValue("Diameter", "16 (Fibre m)", "m")).toBe("16 (Fibre m)");
  });

  it("does not false-match unrelated words that happen to end with unit letters", () => {
    // "Beam" ends with 'm', but unit 'm' should be appended because 'Beam' is not a unit 'm'
    expect(formatAttributeValue("Type", "Beam", "m")).toBe("Beam m");
    // "Cross" ends with 's', but unit 's'
    expect(formatAttributeValue("Type", "Cross", "s")).toBe("Cross s");
  });

  it("handles empty and malformed values safely", () => {
    expect(formatAttributeValue("Size", "", "mm")).toBe("");
    expect(formatAttributeValue("Size", null, "mm")).toBe("");
    expect(formatAttributeValue("Size", undefined, "mm")).toBe("");
  });
});

describe("formatVariationAttributesString", () => {
  it("formats attributes string with units and skips unitless ones", () => {
    const defs: AttributeDef[] = [
      { name: "Size", unit: "mm", values: ["5"] },
      { name: "Length", unit: "m", values: ["10"] },
      { name: "Material", values: ["Steel"] },
    ];
    const attrs = { Size: "5", Length: "10", Material: "Steel" };
    expect(formatVariationAttributesString(attrs, defs)).toBe(
      "Size: 5 mm · Length: 10 m · Material: Steel"
    );
  });

  it("works with a simple unit map Record<string, string>", () => {
    const map = { Size: "mm", Length: "m" };
    const attrs = { Size: "5", Length: "10", Material: "Steel" };
    expect(formatVariationAttributesString(attrs, map)).toBe(
      "Size: 5 mm · Length: 10 m · Material: Steel"
    );
  });
});
