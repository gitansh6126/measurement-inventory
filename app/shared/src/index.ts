// Shared by the API (authoritative) and the web app (live previews).
// Ports of main v2 index.html helpers; keep behaviour identical. The API unit test
// tests/unit/variation-parity.test.ts slices the originals out of main v2 and fails on drift.

/** One declared attribute of a Variable product, e.g. Length (unit mm) with values 6, 8, 10. */
export interface AttributeDef {
  name: string;
  unit?: string;
  /** Declared values. Values no variation uses are still valid (declared ≠ instantiated). */
  values: string[];
  /** Optional per-value code abbreviation, e.g. { Crossbee: "CB" }. */
  abbrMap?: Record<string, string>;
  /** main v2 Quality attribute: values are star grades "1".."5" and never carry a unit. */
  isQuality?: boolean;
  /** main v2 Sub Var: each value is composed "Main (Sub subUnit)", e.g. "16 (Fibre m)". */
  sub?: boolean;
  subName?: string;
  subUnit?: string;
}

/** Builder-only editing state for one attribute (main v2 VariationBuilder). */
export interface AttributeDraft extends AttributeDef {
  pairs?: { a: string; b: string }[];
  stars?: number[];
}

/** Port of main v2 composeSubVal: "16" + "Fibre" + unit "m" → "16 (Fibre m)". */
export function composeSubValue(a: string, b: string, subUnit?: string): string {
  const x = String(a ?? "").trim();
  const y = String(b ?? "").trim();
  const u = String(subUnit ?? "").trim();
  return x + (y ? " (" + y + (u ? " " + u : "") + ")" : "");
}

/**
 * Port of main v2 normAttrVals: the declared value list an attribute produces —
 * sorted star grades for Quality, composed pairs for Sub Var, trimmed values otherwise.
 */
export function normAttrVals(d: AttributeDraft): string[] {
  if (!d) return [];
  if (d.isQuality) return (d.stars ?? []).slice().sort((a, b) => a - b).map(String);
  if (d.sub) {
    return (d.pairs ?? [])
      .map((p) => {
        const a = String(p.a ?? "").trim();
        const b = String(p.b ?? "").trim();
        if (!a && !b) return "";
        return composeSubValue(a, b, d.subUnit);
      })
      .filter(Boolean);
  }
  return (d.values ?? []).map((x) => String(x).trim()).filter(Boolean);
}

export type Attributes = Record<string, string>;

/** 0044: one technical specification row, e.g. { name: "Breaking load", value: "12 t" }. */
export interface TechSpec {
  name: string;
  value: string;
}

/** A product's own specs, then a variation's / set's: a row with the same name replaces the product's. */
export function mergeSpecs(base: readonly TechSpec[] | null | undefined, own: readonly TechSpec[] | null | undefined): TechSpec[] {
  const mine = own ?? [];
  const names = new Set(mine.map((s) => s.name.trim().toLowerCase()));
  return [...(base ?? []).filter((s) => !names.has(s.name.trim().toLowerCase())), ...mine];
}

// Port of main v2 abbrLookup: attribute-scoped, case-insensitive on the value, uppercased.
function abbrLookup(defs: readonly AttributeDef[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const d of defs) {
    if (!d?.abbrMap) continue;
    const name = String(d.name || "").trim();
    for (const v of Object.keys(d.abbrMap)) {
      const ab = String(d.abbrMap[v] ?? "").trim();
      if (!ab) continue;
      map[name + "\u0000" + String(v).trim().toLowerCase()] = ab.toUpperCase();
    }
  }
  return map;
}

/**
 * Port of main v2 variationCode (BR-05, BR-07). One composer, two codes:
 * value tokens in attribute order, then the base as the suffix. withUnits weaves
 * "<value><UNIT>" (Short Name); without units it yields the bare tokens (Official SKU).
 * An abbreviation replaces its token and suppresses the unit.
 */
export function variationCode(base: string, attrs: Attributes, defs: readonly AttributeDef[], withUnits: boolean): string {
  const unitOf: Record<string, string> = {};
  if (withUnits) for (const d of defs) if (d && !d.isQuality) unitOf[String(d.name || "").trim()] = String(d.unit || "").trim();
  const abbrOf = abbrLookup(defs);
  const parts: string[] = [];
  for (const k of Object.keys(attrs || {})) {
    const raw = String(attrs[k] ?? "").trim();
    const name = String(k).trim();
    const ab = raw ? String(abbrOf[name + "\u0000" + raw.toLowerCase()] || "") : "";
    const u = withUnits && !ab ? String(unitOf[name] || "") : "";
    let tok = ab || raw;
    if (raw && u) {
      const uu = u.toUpperCase();
      if (raw.toUpperCase().slice(-uu.length) !== uu) tok = raw + uu;
    }
    parts.push(tok);
  }
  parts.push(String(base ?? "").trim().toUpperCase().replace(/\s+/g, "-"));
  return parts.filter(Boolean).join("-").replace(/\s+/g, "-");
}

/** Generated internal Short Name (units woven in). The write path uppercases it. */
export const autoShortName = (base: string, attrs: Attributes, defs: readonly AttributeDef[]) =>
  variationCode(base, attrs, defs, true);

/** Generated customer-facing Official SKU (units omitted). */
export const autoOfficialSku = (base: string, attrs: Attributes, defs: readonly AttributeDef[]) =>
  variationCode(base, attrs, defs, false);

/** Port of main v2 attrComboKey: order-independent, values trimmed, case-sensitive. */
export function comboKey(attrs: Attributes): string {
  return Object.keys(attrs || {})
    .sort()
    .map((k) => k + "=" + String(attrs[k] ?? "").trim())
    .join("|");
}

/** Attributes re-ordered to the definition order, values trimmed (stable storage and code order). */
export function orderAttributes(attrs: Attributes, defs: readonly AttributeDef[]): Attributes {
  const out: Attributes = {};
  for (const d of defs) {
    const v = attrs[d.name];
    if (v !== undefined) out[d.name] = String(v).trim();
  }
  return out;
}

/** Short Name as stored: trimmed and uppercased (BR-04). */
export const normalizeShortName = (s: string) => s.trim().toUpperCase();

/** Official SKU as stored: trimmed; blank means "none assigned" (BR-05). */
export const normalizeOfficialSku = (s: string | null | undefined) => {
  const t = String(s ?? "").trim();
  return t === "" ? null : t;
};

/** Document code precedence (BR-05 _docSku): Official SKU, then Short Name, then "-". */
export const documentSku = (officialSku: string | null | undefined, shortName: string | null | undefined) =>
  String(officialSku ?? "").trim() || String(shortName ?? "").trim() || "-";

/**
 * Formats an individual attribute value with its unit:
 * - Appends unit only when defined and not empty.
 * - Does not append units to Quality attributes (isQuality = true).
 * - Avoids duplicating units if the value already ends with the unit or parenthesized unit (e.g., Sub Var).
 * - Leaves unitless attributes (e.g. Material, Color) untouched.
 */
export function formatAttributeValue(
  name: string,
  value: string | null | undefined,
  unit?: string | null,
  isQuality?: boolean
): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  if (isQuality) return trimmed;
  const u = String(unit ?? "").trim();
  if (!u) return trimmed;

  const escUnit = u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alreadyHasUnit = new RegExp(`(?:\\s|^|\\d)${escUnit}\\s*\\)?$`, "i").test(trimmed);
  if (alreadyHasUnit) {
    return trimmed;
  }
  return `${trimmed} ${u}`;
}

export type UnitDefSource =
  | readonly AttributeDef[]
  | Record<string, string | { unit?: string; isQuality?: boolean }>
  | null
  | undefined;

/**
 * Resolves unit and quality flag from an AttributeDef array or simple unit map.
 */
export function resolveAttrUnit(
  name: string,
  defsOrMap: UnitDefSource
): { unit?: string; isQuality?: boolean } {
  if (!defsOrMap) return {};
  if (Array.isArray(defsOrMap)) {
    const d = defsOrMap.find((x) => x && x.name === name);
    return d ? { unit: d.unit, isQuality: d.isQuality } : {};
  }
  const entry = (defsOrMap as Record<string, string | { unit?: string; isQuality?: boolean }>)[name];
  if (!entry) return {};
  if (typeof entry === "string") return { unit: entry, isQuality: false };
  return { unit: entry.unit, isQuality: entry.isQuality };
}

/**
 * Formats a record of variation attributes into an array of { name, value, formatted }.
 */
export function formatVariationAttributes(
  attrs: Record<string, string> | null | undefined,
  defsOrMap: UnitDefSource
): { name: string; value: string; formatted: string }[] {
  if (!attrs) return [];
  return Object.entries(attrs).map(([name, val]) => {
    const { unit, isQuality } = resolveAttrUnit(name, defsOrMap);
    const formatted = formatAttributeValue(name, val, unit, isQuality);
    return { name, value: val, formatted };
  });
}

/**
 * Formats variation attributes into a single string (e.g. "Size: 5 mm · Length: 10 m · Material: Steel").
 */
export function formatVariationAttributesString(
  attrs: Record<string, string> | null | undefined,
  defsOrMap: UnitDefSource,
  separator: string = " · "
): string {
  const items = formatVariationAttributes(attrs, defsOrMap);
  return items.map((i) => `${i.name}: ${i.formatted}`).join(separator);
}


// ---------------------------------------------------------------------------
// Demo company (every version keeps one, as marble's seed does). These accounts exist
// only in a DEMO database: api/scripts/seed-demo.ts refuses any other APP_ENV, and the
// login page shows them only when /api/version reports DEMO. Never reuse for live users.
// ---------------------------------------------------------------------------

export const DEMO_COMPANY_NAME = "RS Machinery (Demo)";
export const DEMO_PASSWORD = "demo-rs-2026";
export const DEMO_ACCOUNTS = [
  { role: "admin", name: "Demo Admin", email: "admin@demo.rs.test" },
  { role: "sales_manager", name: "Demo Manager", email: "manager@demo.rs.test" },
  { role: "sales_staff", name: "Demo Staff", email: "staff@demo.rs.test" },
] as const;
