// Measured products in the web app (V2 plan §2, wireframes W1–W19). Lengths are numbers in the
// product's base unit (metres, or inches for feet + inches); the API is authoritative and the
// helpers from @rs-v31/shared/measure are used for previews only.
import {
  BASE_UNIT_LABEL,
  ENTRY_UNITS,
  METRES_PER,
  RATE_ENTRY_UNITS,
  RATE_UNIT_LABEL,
  formatLength,
  rateFromDefault,
  ratePerOf,
  rateToDefault,
  toBaseMilli,
  toMilli,
  type LengthUnit,
  type PieceKind,
  type PieceStatus,
} from "@rs-v31/shared/measure";
import { money } from "./format";
import { getLengthView } from "./lengthView";
import type { Attributes, MeasureSettings, ProductType } from "./types";

export { BASE_UNIT_LABEL, ENTRY_UNITS, RATE_ENTRY_UNITS, rateFromDefault, ratePerOf, rateToDefault, type LengthUnit, type PieceKind, type PieceStatus };

/** What a measured cart line or screen needs to format and check lengths. */
export interface MeasureMeta {
  lengthUnit: LengthUnit;
  decimals: number;
  scrapBelow: number | null;
  rollName: string | null;
}

export const metaOf = (m: { lengthUnit: LengthUnit; decimals?: number | null; lengthDecimals?: number | null; scrapBelow?: number | null; rollName?: string | null }): MeasureMeta => ({
  lengthUnit: m.lengthUnit,
  decimals: m.decimals ?? m.lengthDecimals ?? 3,
  scrapBelow: m.scrapBelow ?? null,
  rollName: m.rollName ?? null,
});

/** A Measured product's stock is a length (shown in the user's m / ft view); other products have none. */
export const stockLengthOf = (p: { productType: ProductType; measure?: Partial<MeasureSettings> | null }): MeasureMeta | undefined =>
  p.productType === "measured" ? metaOf({ ...(p.measure ?? {}), lengthUnit: p.measure?.lengthUnit ?? "m" }) : undefined;

/** 18.5 (base units) → "18.5 m" / "41 ft 8 in", always in the product's own unit (entry fields, settings). */
export const fmtLenNative = (value: number, meta: Pick<MeasureMeta, "lengthUnit" | "decimals">) => formatLength(toMilli(value), meta.lengthUnit, meta.decimals);

/** Decimal metres / feet for a converted length: up to 2 places, trailing zeros dropped. */
const short = (n: number, unit: string) => `${Number(n.toFixed(2))} ${unit}`;

/**
 * 18.5 (base units) shown in the user's length view (lib/lengthView): "18.5 m", "60.7 ft" or
 * "18.5 m (60.7 ft)". A feet + inches product keeps "41 ft 8 in" as its feet form.
 */
export const fmtLen = (value: number, meta: Pick<MeasureMeta, "lengthUnit" | "decimals">) => {
  const view = getLengthView();
  const metres = meta.lengthUnit === "m" ? value : value * METRES_PER.in!;
  const m = meta.lengthUnit === "m" ? fmtLenNative(value, meta) : short(metres, "m");
  const ft = meta.lengthUnit === "ft_in" ? fmtLenNative(value, meta) : short(metres / METRES_PER.ft!, "ft");
  return view === "ft" ? ft : view === "both" ? `${m} (${ft})` : m;
};

/** fmtLen with a leading "+" on increases (history changes). */
export const fmtLenSigned = (value: number, meta: Pick<MeasureMeta, "lengthUnit" | "decimals">) => (value > 0 ? "+" : "") + fmtLen(value, meta);

/** "m" or "in": the unit lengths are stored in (stock movements, document quantities). */
export const baseLabel = (unit: LengthUnit) => BASE_UNIT_LABEL[unit];

/**
 * "m" or "ft": the unit every rate of the product is stored and shown per (0028). A feet +
 * inches product keeps lengths in inches but is priced per foot.
 */
export const rateLabel = (unit: LengthUnit | null | undefined) => (unit ? RATE_UNIT_LABEL[unit] : null);

/** " / ft" or " / m" written after a Measured rate; "" for counted items. */
export const perRate = (unit: LengthUnit | null | undefined) => (unit ? ` / ${RATE_UNIT_LABEL[unit]}` : "");

/**
 * One rate or a range ("₹40 – ₹52") with its unit, in the user's length view (lib/lengthView):
 * "₹52 / m", "₹15.85 / ft" or "₹52 / m (₹15.85 / ft)". Rates are stored per the product's rate
 * unit (0028) and converted for display only. Counted items (no unit): the amounts alone.
 */
export const fmtRate = (unit: LengthUnit | null | undefined, ...values: (number | string)[]) => {
  const amounts = (to?: string) =>
    values.map((v) => money(to && unit ? (Number(v) * METRES_PER[to]!) / METRES_PER[RATE_UNIT_LABEL[unit]]! : Number(v))).join(" – ");
  if (!unit) return amounts();
  const m = `${amounts("m")} / m`;
  const ft = `${amounts("ft")} / ft`;
  const view = getLengthView();
  return view === "ft" ? ft : view === "both" ? `${m} (${ft})` : m;
};

const whole = new Intl.NumberFormat("en-IN");

/**
 * Direct selling price or range ("Sell: ₹300 - 400") with unit if measured.
 * When minSalePrice and salePrice are both set and min < sale:
 *   prefix + "₹300 - 400" (or "₹300 - 400 / m")
 * When only salePrice is set (or min == sale):
 *   prefix + "₹400" (or "₹400 / m")
 */
export const fmtSellRate = (
  unit: LengthUnit | null | undefined,
  minPrice: number | string | null | undefined,
  salePrice: number | string | null | undefined,
  prefix = "Sell: "
) => {
  const min = Math.round(Number(minPrice) || 0);
  const sale = Math.round(Number(salePrice) || 0);

  if (min > 0 && sale > 0 && min < sale) {
    if (!unit) {
      return `${prefix}${money(min)} - ${whole.format(sale)}`;
    }
    const rateOf = (v: number, to: string) =>
      Math.round((v * METRES_PER[to]!) / METRES_PER[RATE_UNIT_LABEL[unit]]!);
    const m = `${money(rateOf(min, "m"))} - ${whole.format(rateOf(sale, "m"))} / m`;
    const ft = `${money(rateOf(min, "ft"))} - ${whole.format(rateOf(sale, "ft"))} / ft`;
    const view = getLengthView();
    const text = view === "ft" ? ft : view === "both" ? `${m} (${ft})` : m;
    return `${prefix}${text}`;
  }

  const single = sale > 0 ? sale : min;
  if (single > 0) {
    return `${prefix}${fmtRate(unit, single)}`;
  }
  return "—";
};

/** "Roll" / "Drum"… (lower-case plural helper for counts). */
export const rollWord = (meta: Pick<MeasureMeta, "rollName">, n = 1) => {
  const w = (meta.rollName || "Roll").toLowerCase();
  return n === 1 ? w : `${w}s`;
};

export const KIND_LABEL: Record<PieceKind, string> = { CLOSED: "Closed", OPEN: "Open", CUT: "Cut" };
/** "cut piece" / "open roll" / "closed roll" for sentences. */
export const kindPhrase = (k: PieceKind, rollName?: string | null) => (k === "CUT" ? "cut piece" : `${k === "OPEN" ? "open" : "closed"} ${(rollName || "roll").toLowerCase()}`);

export const KIND_CLASS: Record<PieceKind, string> = {
  CLOSED: "bg-slate-100 text-slate-700",
  OPEN: "bg-sky-100 text-sky-800",
  CUT: "bg-amber-100 text-amber-800",
};

/** Column titles of the Cut / Open / Closed stock view (owner design 2026-10-16). */
export const KIND_COLUMN: Record<PieceKind, string> = { CUT: "Cut pieces", OPEN: "In-use (Open)", CLOSED: "Sealed (Closed)" };

/**
 * How a piece is named on screen: roll codes are not shown (owner design 2026-10-16), so a piece
 * is its variation, kind and length — "10 mm · open roll (32.5 m)".
 */
export const pieceName = (p: { kind: PieceKind; remainingLength: number }, meta: MeasureMeta, variation?: string) =>
  `${variation ? `${variation} · ` : ""}${kindPhrase(p.kind, meta.rollName)} (${fmtLen(p.remainingLength, meta)})`;

/** Total remaining length and counts per kind of a list of pieces. */
export function pieceSummary(pieces: { kind: PieceKind; remainingLength: number }[]) {
  const s = { total: 0, count: pieces.length, CLOSED: 0, OPEN: 0, CUT: 0 };
  for (const p of pieces) {
    s.total += p.remainingLength;
    s[p.kind] += 1;
  }
  s.total = Math.round(s.total * 1000) / 1000;
  return s;
}

/** "2 sealed · 1 in-use · 3 cut". */
export const summaryText = (s: { CLOSED: number; OPEN: number; CUT: number }) => `${s.CLOSED} sealed · ${s.OPEN} in-use · ${s.CUT} cut`;

/** Typed length (+ entry unit) → base units, or NaN. ft_in entry uses feet and inches together. */
export function typedToBase(text: string, entryUnit: string, base: LengthUnit, inchesText = ""): number {
  if (base === "ft_in" && entryUnit === "ft+in") {
    const ft = text.trim() === "" ? 0 : Number(text);
    const inch = inchesText.trim() === "" ? 0 : Number(inchesText);
    if (!Number.isFinite(ft) || !Number.isFinite(inch) || ft < 0 || inch < 0 || (text.trim() === "" && inchesText.trim() === "")) return NaN;
    return Math.round((ft * 12 + inch) * 1000) / 1000;
  }
  if (text.trim() === "") return NaN;
  const n = Number(text);
  if (!Number.isFinite(n)) return NaN;
  const m = toBaseMilli(n, entryUnit, base);
  return Number.isFinite(m) ? m / 1000 : NaN;
}

/** Entry units offered in a length field: ft_in products also get a "ft + in" pair. */
export const entryOptions = (base: LengthUnit) => (base === "ft_in" ? ["ft+in", ...ENTRY_UNITS.ft_in] : [...ENTRY_UNITS.m]);

/** A base-unit length written in another entry unit (not "ft+in"): 4.2 m as "cm" → 420. NaN when not offered. */
export function baseToEntry(value: number, entryUnit: string, base: LengthUnit): number {
  // Base thousandths per 1000 entry units keeps ft (0.3048 m) exact.
  const per = toBaseMilli(1000, entryUnit, base) / 1_000_000;
  if (!Number.isFinite(value) || !Number.isFinite(per) || per <= 0) return NaN;
  return Math.round((value / per) * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// /api/measure response shapes
// ---------------------------------------------------------------------------

export interface PieceView {
  id: string;
  code: string;
  variationId: string;
  kind: PieceKind;
  status: PieceStatus;
  originalLength: number;
  remainingLength: number;
  parent: { id: string; code: string | null } | null;
  childCount: number;
  purchase: { id: string; number: string | null } | null;
  supplier: { id: string; name: string | null } | null;
  unitCost: string | null;
  supplierRollNo: string | null;
  rack: string | null;
  notes: string | null;
  receivedAt: string;
  openedAt: string | null;
  /** V3.1: the warehouse the piece is in (null while warehousing is off); set = fitted in that set. */
  warehouseId?: string | null;
  setId?: string | null;
}

export interface MeasuredVariation {
  id: string;
  shortName: string;
  officialSku: string | null;
  attributes: Attributes;
  active: boolean;
  salePrice: string;
  minSalePrice?: string;
  lowStockThreshold: number;
  defaultRollLength: number | null;
  stock: number;
  pieces: PieceView[];
}

export interface ProductPieces {
  product: {
    id: string;
    name: string;
    lengthUnit: LengthUnit;
    rollName: string | null;
    decimals: number | null;
    scrapBelow: number | null;
    defaultRollLength: number | null;
  };
  variations: MeasuredVariation[];
}

export type PieceAction = "RECEIVE" | "ADD" | "OPEN" | "CUT" | "SALE" | "SALE_VOID" | "WRITE_OFF" | "CORRECTION" | "PURCHASE_VOID" | "EDIT";

export interface PieceHistoryRow {
  id: string;
  action: PieceAction | string;
  change: number;
  before: number;
  after: number;
  related: { id: string; code: string | null } | null;
  sale: { id: string; number: string | null } | null;
  purchase: { id: string; number: string | null } | null;
  /** V3.1: warehouse at the time; TRANSFER rows also carry the destination and the shift. */
  warehouseId?: string | null;
  toWarehouseId?: string | null;
  transferId?: string | null;
  reason: string | null;
  occurredAt: string;
  by: string | null;
}

export interface PieceRecord {
  piece: PieceView & {
    openedBy: string | null;
    product: { id: string; name: string; lengthUnit: LengthUnit; rollName: string | null; decimals: number | null; scrapBelow: number | null };
    variation: { id: string; shortName: string; attributes: Attributes };
    children: { id: string; code: string; kind: PieceKind; status: PieceStatus; originalLength: number; remainingLength: number }[];
    used: { sold: number; cutIntoPieces: number; writtenOff: number; corrected: number };
  };
  history: PieceHistoryRow[];
}

export const ACTION_LABEL: Record<string, string> = {
  RECEIVE: "Received",
  ADD: "Added (opening / found)",
  OPEN: "Opened",
  CUT: "Cut",
  SALE: "Sale",
  SALE_VOID: "Sale cancelled",
  PURCHASE_VOID: "Purchase cancelled",
  WRITE_OFF: "Written off",
  CORRECTION: "Length corrected",
  EDIT: "Details edited",
  SET_ALLOCATE: "Fitted in a set",
  SET_RELEASE: "Taken out of a set",
  // V3.1 shifts between warehouses.
  TRANSFER: "Shifted",
  TRANSFER_VOID: "Shift cancelled",
};

/**
 * Short code for tables when variation is already shown:
 * - Legacy format: "WR619FC-10MM-0007" → "-0007"
 * - New bundle format: "WR619FC-10MM-500-2-1-26-01" → "-01"
 * - New cut piece format: "WR619FC-10MM-22.5-9-10-26-C01" → "-C01"
 */
export const shortCode = (code: string) => {
  const i = code.lastIndexOf("-");
  return i > 0 ? code.slice(i) : code;
};
