// Measured products (V2 plan §2): lengths, unit conversion and the piece order.
// Shared by the API (authoritative) and the web app (previews). Pure functions only.
//
// Lengths are handled as whole thousandths of the product's base unit ("milli"), so sums and
// cuts never drift; the database stores the same value as NUMERIC(14,3).

/** Base unit of a Measured product: metres, or feet + inches (stored in inches). */
export type LengthUnit = "m" | "ft_in";

/** Closed = unopened roll, Open = roll in use, Cut = piece cut from a roll. */
export type PieceKind = "CLOSED" | "OPEN" | "CUT";

/** Active = has length; Used up = sold to zero or written off. */
export type PieceStatus = "ACTIVE" | "USED_UP";

export const LENGTH_UNITS: readonly LengthUnit[] = ["m", "ft_in"];

/** Unit written on stock movements and document lines. */
export const BASE_UNIT_LABEL: Record<LengthUnit, string> = { m: "m", ft_in: "in" };

/** Units a length may be typed in, per base unit (converted on entry). */
export const ENTRY_UNITS: Record<LengthUnit, readonly string[]> = {
  m: ["m", "cm", "mm", "ft", "in"],
  ft_in: ["in", "ft", "m"],
};

/** Metres in one of each length unit (exact: 1 in = 0.0254 m). */
export const METRES_PER: Record<string, number> = { m: 1, cm: 0.01, mm: 0.001, ft: 0.3048, in: 0.0254 };

// ---------------------------------------------------------------------------
// Rate unit (owner decision 2026-10-16): every Measured rate — selling price, min price, cost,
// supplier rate, roll cost, document line price — is stored per the product's default rate unit:
// per metre for metric products, per FOOT for feet + inches products (lengths stay in inches).
// A rate may be typed per another unit; it is converted to the default one on entry.
// ---------------------------------------------------------------------------

/** The unit every rate of a Measured product is stored in. */
export const RATE_UNIT_LABEL: Record<LengthUnit, string> = { m: "m", ft_in: "ft" };

/** Base units in one rate unit: a line's amount is length (base) ÷ this × rate. */
export const RATE_PER: Record<LengthUnit, number> = { m: 1, ft_in: 12 };

/** Units a rate may be typed per; the first is the stored (default) one. */
export const RATE_ENTRY_UNITS: Record<LengthUnit, readonly string[]> = {
  m: ["m", "ft"],
  ft_in: ["ft", "in", "m"],
};

/** Base units per rate unit for a product (1 for counted items). */
export const ratePerOf = (unit: LengthUnit | null | undefined) => (unit ? RATE_PER[unit] : 1);

/**
 * A rate typed per `entryUnit` → whole rupees per the product's rate unit (half-up), or NaN.
 * ₹10 / in on a feet + inches product → ₹120 / ft; ₹500 / m on it → ₹152 / ft.
 */
export function rateToDefault(rupees: number, entryUnit: string, unit: LengthUnit): number {
  const from = METRES_PER[entryUnit];
  if (!Number.isFinite(rupees) || rupees < 0 || from === undefined || !RATE_ENTRY_UNITS[unit].includes(entryUnit)) return NaN;
  const to = METRES_PER[RATE_UNIT_LABEL[unit]]!;
  return Math.floor((rupees * to) / from + 0.5 + 1e-9);
}

/** A stored rate shown per another unit (unrounded rupees): ₹120 / ft → ₹10 / in. */
export function rateFromDefault(rupees: number, entryUnit: string, unit: LengthUnit): number {
  const to = METRES_PER[entryUnit];
  if (to === undefined) return NaN;
  return (rupees * to) / METRES_PER[RATE_UNIT_LABEL[unit]]!;
}

/** Largest length accepted anywhere: 1,000,000 base units. */
export const MAX_MILLI = 1_000_000_000;

/** "18.375" or 18.375 → 18375. Rounds to the nearest thousandth. */
export function toMilli(v: number | string): number {
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 1000);
}

/** 18375 → "18.375" (exact decimal string for the database). */
export function milliToDecimal(m: number): string {
  const neg = m < 0;
  const a = Math.abs(Math.round(m));
  return `${neg ? "-" : ""}${Math.floor(a / 1000)}.${String(a % 1000).padStart(3, "0")}`;
}

/** Converts a typed length into thousandths of the product's base unit. */
export function toBaseMilli(value: number, entryUnit: string, base: LengthUnit): number {
  const factor = METRES_PER[entryUnit];
  if (factor === undefined || !ENTRY_UNITS[base].includes(entryUnit)) return NaN;
  const metres = value * factor;
  const inBase = base === "m" ? metres : metres / METRES_PER.in!;
  return Math.round(inBase * 1000);
}

/** Feet + inches typed separately → thousandths of an inch. */
export const feetInchesToMilli = (feet: number, inches: number) => Math.round((feet * 12 + inches) * 1000);

/** Trims a decimal string's trailing zeros: "18.500" → "18.5", "18.000" → "18". */
export function trimDecimal(s: string): string {
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Normalized readable length in canonical base unit without trailing zeros: 500000 milli → "500", 25500 milli → "25.5". */
export function formatPieceLength(lengthMilli: number): string {
  return trimDecimal(milliToDecimal(lengthMilli));
}

export const BUSINESS_TIME_ZONE = "Asia/Kolkata";

/** Formats a date as unpadded day, unpadded month, 2-digit year in Asia/Kolkata: e.g. "2-1-26", "9-10-26", "15-12-26", "5-2-27". */
export function formatPieceDate(date: Date | string | number, timeZone = BUSINESS_TIME_ZONE): string {
  const d = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    day: "numeric",
    month: "numeric",
    year: "2-digit",
  }).formatToParts(d);
  const day = parts.find((p) => p.type === "day")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const year = parts.find((p) => p.type === "year")?.value;
  return `${parseInt(day ?? "1", 10)}-${parseInt(month ?? "1", 10)}-${year}`;
}

/** Formats copy sequence number: 1 → "01", 99 → "99", 100 → "100", 101 → "101". */
export function formatCopyNumber(n: number): string {
  return n < 100 ? String(n).padStart(2, "0") : String(n);
}

/** Builds the prefix key for sequence allocation: {SKU}-{LENGTH}-{D-M-YY} for rolls, {SKU}-{LENGTH}-{D-M-YY}-C for cut pieces. */
export function buildPiecePrefixKey(
  sku: string,
  lengthMilli: number,
  date: Date | string | number,
  kind: PieceKind = "CLOSED",
): string {
  const lenStr = formatPieceLength(lengthMilli);
  const dateStr = formatPieceDate(date);
  if (kind === "CUT") {
    return `${sku}-${lenStr}-${dateStr}-C`;
  }
  return `${sku}-${lenStr}-${dateStr}`;
}

/**
 * Builds the complete unique stock ID:
 * Full bundle: {VARIATION_SKU}-{ORIGINAL_LENGTH}-{DAY}-{MONTH}-{YY}-{COPY_NUMBER} (e.g. "WR619FC-10MM-500-2-1-26-01")
 * Cut piece:   {VARIATION_SKU}-{ORIGINAL_LENGTH}-{DAY}-{MONTH}-{YY}-C{COPY_NUMBER} (e.g. "WR619FC-10MM-22.5-9-10-26-C01")
 */
export function buildPieceCode(
  sku: string,
  lengthMilli: number,
  date: Date | string | number,
  copyNumber: number,
  kind: PieceKind = "CLOSED",
): string {
  const prefix = buildPiecePrefixKey(sku, lengthMilli, date, kind);
  const copyStr = formatCopyNumber(copyNumber);
  if (kind === "CUT") {
    return `${prefix}${copyStr}`;
  }
  return `${prefix}-${copyStr}`;
}

/**
 * Human length in the product's base unit: "18.375 m", or "41 ft 8 in" for feet + inches.
 * @param decimals display places for metres / inches (0–3); the stored value is never rounded.
 */
export function formatLength(milli: number, base: LengthUnit, decimals = 3): string {
  const places = Math.min(3, Math.max(0, decimals));
  if (base === "m") {
    const v = (Math.round(milli) / 1000).toFixed(places);
    return `${trimDecimal(v)} m`;
  }
  const neg = milli < 0;
  const total = Math.abs(milli);
  const feet = Math.floor(total / 12000);
  const inches = trimDecimal(((total - feet * 12000) / 1000).toFixed(places));
  const parts = [feet ? `${feet} ft` : "", inches !== "0" || !feet ? `${inches} in` : ""].filter(Boolean);
  return (neg ? "-" : "") + parts.join(" ");
}

/** Converts a stored length between base units (used when a product's unit is changed). */
export function convertBaseMilli(milli: number, from: LengthUnit, to: LengthUnit): number {
  if (from === to) return milli;
  // 1 in = 0.0254 m exactly.
  return from === "m" ? Math.round(milli / 0.0254) : Math.round(milli * 0.0254);
}

// ---------------------------------------------------------------------------
// Piece order (owner decision DM-5) and sale planning (DM-4: one piece per line, never joined)
// ---------------------------------------------------------------------------

export interface PieceLite {
  id: string;
  code: string;
  variationId: string;
  kind: PieceKind;
  remainingMilli: number;
  /** ISO date or epoch ms: receipt order breaks ties between equal lengths. */
  receivedAt: string | number | Date;
}

const KIND_RANK: Record<PieceKind, number> = { CUT: 0, OPEN: 1, CLOSED: 2 };
const time = (v: PieceLite["receivedAt"]) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v));

/** Cut → Open → Closed; smallest to largest inside each kind; then oldest first; then code. */
export function sortPieces<T extends PieceLite>(pieces: readonly T[]): T[] {
  return [...pieces].sort(
    (a, b) =>
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.remainingMilli - b.remainingMilli ||
      time(a.receivedAt) - time(b.receivedAt) ||
      a.code.localeCompare(b.code),
  );
}

/** Pieces that can supply `needMilli` by themselves, in DM-5 order (first = default choice). */
export const longEnough = <T extends PieceLite>(pieces: readonly T[], needMilli: number) =>
  sortPieces(pieces.filter((p) => p.remainingMilli > 0 && p.remainingMilli >= needMilli));

/** Alternatives: pieces of the same variation that are too short, same order. */
export const shorterThan = <T extends PieceLite>(pieces: readonly T[], needMilli: number) =>
  sortPieces(pieces.filter((p) => p.remainingMilli > 0 && p.remainingMilli < needMilli));

export interface PlanRequest {
  /** Caller's line key (cart line id or index). */
  key: string;
  variationId: string;
  lengthMilli: number;
  /** Piece chosen by the seller; otherwise the first long-enough piece is used. */
  pieceId?: string | null;
}

export interface PlanCut {
  key: string;
  variationId: string;
  pieceId: string;
  code: string;
  kind: PieceKind;
  lengthMilli: number;
  beforeMilli: number;
  afterMilli: number;
}

export interface PlanProblem {
  key: string;
  variationId: string;
  lengthMilli: number;
  code: "NO_PIECE_LONG_ENOUGH" | "PIECE_NOT_AVAILABLE" | "PIECE_TOO_SHORT";
  /** Longest piece left for the variation after earlier lines, for the message. */
  longestMilli: number;
}

/**
 * Assigns one piece to every line (pieces are never joined). Lines are planned in order and
 * see what earlier lines took, so two lines of one variation never claim the same length twice.
 * Pure: returns a plan; the caller performs the cuts inside its own locked transaction.
 */
export function planCuts(requests: readonly PlanRequest[], pieces: readonly PieceLite[]): { cuts: PlanCut[]; problems: PlanProblem[] } {
  const left = new Map(pieces.map((p) => [p.id, p.remainingMilli]));
  const cuts: PlanCut[] = [];
  const problems: PlanProblem[] = [];
  for (const r of requests) {
    const own = pieces.filter((p) => p.variationId === r.variationId).map((p) => ({ ...p, remainingMilli: left.get(p.id) ?? 0 }));
    const longest = own.reduce((m, p) => Math.max(m, p.remainingMilli), 0);
    let chosen: PieceLite | undefined;
    if (r.pieceId) {
      chosen = own.find((p) => p.id === r.pieceId && p.remainingMilli > 0);
      if (!chosen) {
        problems.push({ key: r.key, variationId: r.variationId, lengthMilli: r.lengthMilli, code: "PIECE_NOT_AVAILABLE", longestMilli: longest });
        continue;
      }
      if (chosen.remainingMilli < r.lengthMilli) {
        problems.push({ key: r.key, variationId: r.variationId, lengthMilli: r.lengthMilli, code: "PIECE_TOO_SHORT", longestMilli: longest });
        continue;
      }
    } else {
      chosen = longEnough(own, r.lengthMilli)[0];
      if (!chosen) {
        problems.push({ key: r.key, variationId: r.variationId, lengthMilli: r.lengthMilli, code: "NO_PIECE_LONG_ENOUGH", longestMilli: longest });
        continue;
      }
    }
    const before = chosen.remainingMilli;
    left.set(chosen.id, before - r.lengthMilli);
    cuts.push({
      key: r.key,
      variationId: r.variationId,
      pieceId: chosen.id,
      code: chosen.code,
      kind: chosen.kind,
      lengthMilli: r.lengthMilli,
      beforeMilli: before,
      afterMilli: before - r.lengthMilli,
    });
  }
  return { cuts, problems };
}

/** True when a leftover is above zero but below the product's scrap-below length (DM-7). */
export const isScrapLeftover = (afterMilli: number, scrapBelowMilli: number | null | undefined) =>
  !!scrapBelowMilli && afterMilli > 0 && afterMilli < scrapBelowMilli;

/**
 * Line amount in whole rupees (owner decision: no paise). Whole quantities keep the exact
 * product, as before; a fractional length is rounded half-up to the rupee.
 * @param rupees whole-rupee rate per rate unit
 * @param ratePer base units per rate unit (12 for a per-foot rate on lengths in inches)
 */
export function lineAmountRupees(lengthMilli: number, rupees: number, ratePer = 1): number {
  const div = 1000 * ratePer;
  const milliRupees = lengthMilli * rupees; // thousandths of a rupee × ratePer
  return Math.floor((milliRupees + div / 2) / div);
}

// ---------------------------------------------------------------------------
// Shortage & Available-To-Promise (ATP) calculations
// ---------------------------------------------------------------------------

export interface ActiveAllocation {
  pieceId: string;
  orderId?: string;
  orderLineId?: string;
  lengthMilli: number;
}

export interface PieceATP extends PieceLite {
  allocatedMilli: number;
  atpMilli: number;
}

export interface VariationATP {
  variationId: string;
  physicalStockMilli: number;
  allocatedMilli: number;
  atpMilli: number;
  pieces: PieceATP[];
}

/**
 * Calculates physical stock, allocated length, and available-to-promise (ATP) quantity
 * for a variation across eligible physical pieces.
 */
export function calculateATP(pieces: readonly PieceLite[], allocations: readonly ActiveAllocation[] = []): VariationATP {
  const allocMap = new Map<string, number>();
  for (const a of allocations) {
    allocMap.set(a.pieceId, (allocMap.get(a.pieceId) ?? 0) + a.lengthMilli);
  }

  const variationId = pieces[0]?.variationId ?? "";
  let physicalStockMilli = 0;
  let allocatedMilli = 0;
  let totalAtpMilli = 0;

  const piecesWithATP: PieceATP[] = pieces.map((p) => {
    physicalStockMilli += p.remainingMilli;
    const allocated = allocMap.get(p.id) ?? 0;
    allocatedMilli += allocated;
    const atp = Math.max(0, p.remainingMilli - allocated);
    totalAtpMilli += atp;
    return {
      ...p,
      allocatedMilli: allocated,
      atpMilli: atp,
    };
  });

  return {
    variationId,
    physicalStockMilli,
    allocatedMilli,
    atpMilli: totalAtpMilli,
    pieces: piecesWithATP,
  };
}

/**
 * Shortage = max(0, requested - available-to-promise).
 * Physical stock remains non-negative; shortage represents unfulfilled demand.
 */
export function calculateShortage(requestedMilli: number, atpMilli: number): number {
  return Math.max(0, requestedMilli - atpMilli);
}

