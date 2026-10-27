// Cross-version guard (AI_CONTEXT/15-cross-version-change-propagation.md): V1's ports in
// @rs-v31/shared must produce byte-identical codes and identity keys to the live main v2
// functions. The originals are sliced out of main v2/index.html by name, as main v2's own
// tools/variation-code-test.js does, so a change on either side fails here.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { autoOfficialSku, autoShortName, comboKey, normAttrVals, type AttributeDef, type AttributeDraft, type Attributes } from "@rs-v31/shared";
import { describe, expect, it } from "vitest";

const MAIN_V2_INDEX = resolve(import.meta.dirname, "../../../../../main v2/index.html");
// A V1-only repository has no main v2 folder: fall back to the committed snapshot of the same
// functions. With both present, the last test below fails if the snapshot has gone stale.
const SNAPSHOT = resolve(import.meta.dirname, "../fixtures/main-v2-variation-fns.js");
const hasMainV2 = existsSync(MAIN_V2_INDEX);

function sliceFn(src: string, name: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => l.startsWith(`function ${name}(`));
  if (start === -1) throw new Error(`main v2 function not found: ${name}`);
  for (let j = start; j < lines.length; j++) if (lines[j] === "}") return lines.slice(start, j + 1).join("\n");
  throw new Error(`unterminated function: ${name}`);
}

const names = ["abbrLookup", "variationCode", "autoVariationShortName", "autoVariationSku", "attrComboKey", "normAttrVals"];
const src = readFileSync(hasMainV2 ? MAIN_V2_INDEX : SNAPSHOT, "utf8");

describe("main v2 snapshot", () => {
  it.skipIf(!hasMainV2)("matches the live main v2 functions (refresh tests/fixtures when this fails)", () => {
    const snapshot = readFileSync(SNAPSHOT, "utf8");
    for (const n of names) expect(sliceFn(snapshot, n)).toBe(sliceFn(src, n));
  });
});
const mod: Record<string, (...a: unknown[]) => string> = {};
new Function("module", names.map((n) => sliceFn(src, n)).join("\n") + "\n" + names.map((n) => `module.${n} = ${n};`).join("\n"))(mod);

type Case = [base: string, attrs: Attributes, defs: AttributeDef[]];
const brandDefs: AttributeDef[] = [
  { name: "Brand", unit: "", values: ["Crossbee"], abbrMap: { Crossbee: "CB" } },
  { name: "Length", unit: "mm", values: ["8"], abbrMap: {} },
];
// Cases from main v2 tools/variation-code-test.js, plus quality and sub-attribute definitions.
const cases: Case[] = [
  ["ROPE", { Length: "8" }, [{ name: "Length", unit: "mm", values: ["8"] }]],
  ["ROPE", { Brand: "Crossbee", Length: "8" }, brandDefs],
  ["ROPE", { Brand: "Crossbee" }, [{ name: "Brand", unit: "", values: ["Crossbee"], abbrMap: { Crossbee: "cb" } }]],
  ["ROPE", { Length: "8" }, [{ name: "Length", unit: "mm", values: ["8"], abbrMap: { "8": "8MM" } }]],
  ["ROPE", { Brand: "Crossbee" }, [{ name: "Brand", unit: "", values: ["Crossbee"] }]],
  ["ROPE", { Brand: "Crossbee" }, [{ name: "Brand", unit: "", values: ["Crossbee"], abbrMap: { Crossbee: "  " } }]],
  ["ROPE", { Brand: "Halfen" }, [{ name: "Brand", unit: "", values: ["Halfen"], abbrMap: { Crossbee: "CB" } }]],
  ["ROPE", { Brand: "crossbee" }, [{ name: "Brand", unit: "", values: ["crossbee"], abbrMap: { Crossbee: "CB" } }]],
  ["ROPE", { Grade: "Crossbee" }, [{ name: "Brand", unit: "", values: ["Crossbee"], abbrMap: { Crossbee: "CB" } }]],
  ["ROPE CORE", { Brand: "Crossbee" }, [{ name: "Brand", unit: "", values: ["Crossbee"], abbrMap: { Crossbee: "CB" } }]],
  ["", { Brand: "Crossbee" }, [{ name: "Brand", unit: "", values: ["Crossbee"], abbrMap: { Crossbee: "CB" } }]],
  ["", {}, []],
  ["X", { A: "10 MM" }, [{ name: "A", unit: "mm", values: ["10 MM"] }]],
  ["GC", { Size: "8", "Rope Construction": "6x19" }, [{ name: "Size", unit: "mm", values: ["8"] }, { name: "Rope Construction", unit: "", values: ["6x19"] }]],
  ["WR", { Diameter: "16 (Fibre m)" }, [{ name: "Diameter", sub: true, subName: "Core", subUnit: "m", unit: "mm", values: ["16 (Fibre m)"], abbrMap: { "16 (Fibre m)": "16F" } }]],
  ["WR", { Diameter: "16 (Fibre m)" }, [{ name: "Diameter", sub: true, subName: "Core", subUnit: "m", unit: "mm", values: ["16 (Fibre m)"] }]],
  ["CH", { Capacity: "1", Quality: "3" }, [{ name: "Capacity", unit: "", values: ["1"] }, { name: "Quality", unit: "", isQuality: true, values: ["3"] }]],
  // A quality attribute never weaves a unit, even if one is stored.
  ["CH", { Capacity: "1", Quality: "3" }, [{ name: "Capacity", unit: "t", values: ["1"] }, { name: "Quality", unit: "star", isQuality: true, values: ["3"] }]],
  ["CB", { Capacity: "1T", Height: "3", Brand: "PF" }, [{ name: "Capacity", unit: "", values: ["1T"] }, { name: "Height", unit: "mtr", values: ["3"] }, { name: "Brand", unit: "", values: ["PF"] }]],
];

describe("variation codes match main v2 (BR-05, BR-07)", () => {
  it.each(cases.map((c, i) => [i + 1, ...c] as const))("case %i", (_n, base, attrs, defs) => {
    expect(autoShortName(base, attrs, defs)).toBe(mod.autoVariationShortName!(base, attrs, defs));
    expect(autoOfficialSku(base, attrs, defs)).toBe(mod.autoVariationSku!(base, attrs, defs));
  });

  it("keeps main v2's locked examples", () => {
    expect(autoShortName("ROPE", { Brand: "Crossbee", Length: "8" }, brandDefs)).toBe("CB-8MM-ROPE");
    expect(autoOfficialSku("ROPE", { Brand: "Crossbee", Length: "8" }, brandDefs)).toBe("CB-8-ROPE");
  });
});

describe("declared values match main v2 normAttrVals", () => {
  const drafts: AttributeDraft[] = [
    { name: "Size", values: [" 8 ", "", "10"] },
    { name: "Quality", isQuality: true, values: [], stars: [5, 3, 4] },
    { name: "Diameter", sub: true, subUnit: "m", values: [], pairs: [{ a: "16", b: "Fibre" }, { a: "18", b: "" }, { a: "", b: "" }] },
    { name: "Diameter", sub: true, values: [], pairs: [{ a: "16", b: "Steel" }] },
  ];
  it.each(drafts.map((d, i) => [i + 1, d] as const))("draft %i", (_n, d) => {
    expect(normAttrVals(d)).toEqual(mod.normAttrVals!(d));
  });
});

describe("combination identity matches main v2 attrComboKey", () => {
  const samples: Attributes[] = [{}, { Size: "8" }, { Size: " 8 ", Brand: "PF" }, { Brand: "PF", Size: "8" }, { b: "x", a: "y", C: "z" }];
  it.each(samples.map((s) => [JSON.stringify(s), s] as const))("%s", (_l, attrs) => {
    expect(comboKey(attrs)).toBe(mod.attrComboKey!(attrs));
  });

  it("is order-independent, trimmed and case-sensitive", () => {
    expect(comboKey({ A: "1", B: "2" })).toBe(comboKey({ B: "2", A: " 1 " }));
    expect(comboKey({ A: "x" })).not.toBe(comboKey({ A: "X" }));
  });
});
