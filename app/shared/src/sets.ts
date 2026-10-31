// V3.1 sale "Build set" (docs\SET-BUILD-IN-SALE-PLAN.md): the seller chooses the contents the
// customer wants; this decides, per set, whether a set in stock already has them (Ready) or which
// set to change and how (Needs change), taking every new part from free stock. Pure functions used
// by the sale drawer; the sale save (api lib\sets.ts prepareSaleSets) re-checks everything under locks.
// Lengths are thousandths of the by-product's base unit (milli), like the measured cut plan.

import type { PieceKind } from "./measure.js";

/** Shown name of a by-product link: "Load Chain · Hand chain"; the product name when unlabelled. */
export function byproductName(productName: string, label: string | null | undefined): string {
  return label?.trim() ? `${productName} · ${label.trim()}` : productName;
}

/**
 * Labels for a grouped product's by-product rows: a product listed more than once gets "#1",
 * "#2"… on each repeat left unlabelled; a typed label is kept. Same length/order as `rows`.
 */
export function repeatLabels(rows: readonly { productId: string; label?: string | null }[]): (string | null)[] {
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.productId, (count.get(r.productId) ?? 0) + 1);
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const n = (seen.get(r.productId) ?? 0) + 1;
    seen.set(r.productId, n);
    const typed = r.label?.trim() || null;
    return typed ?? ((count.get(r.productId) ?? 0) > 1 ? `#${n}` : null);
  });
}

/** A by-product link of the grouped product. */
export interface PlanLink {
  id: string;
  required: boolean;
  measured: boolean;
}

/** A by-product fitted in a set: its variation, and its length when measured. */
export interface PlanPart {
  byproductId: string;
  variationId: string;
  lengthMilli: number | null;
}

/** A set in stock (by-products only; the main part never changes). Order = oldest first. */
export interface PlanSet {
  id: string;
  warehouseId: string | null;
  parts: PlanPart[];
}

/** Wanted contents per by-product: a variation (+ length when measured), or null = not fitted. */
export type SetWant = Record<string, { variationId: string; lengthMilli: number | null } | null>;

/** A free measured piece (bundle): cut piece, open roll or sealed roll. */
export interface PlanPiece {
  id: string;
  variationId: string;
  kind: PieceKind;
  remainingMilli: number;
  warehouseId: string | null;
}

/** Free stock the plan may take new parts from. `counted` key: `variationId|warehouseId` ("" = no warehouse). */
export interface PlanStock {
  pieces: PlanPiece[];
  counted: Record<string, number>;
}

export interface PlanChange {
  byproductId: string;
  action: "REPLACE" | "ADD" | "REMOVE";
  variationId?: string;
  lengthMilli?: number;
  pieceId?: string;
  /**
   * Backorder: no free stock has this part now. The set is held on a customer order and the part
   * is fitted at delivery, once a new bundle (measured) or stock (counted) has been bought.
   */
  backorder?: true;
  /** The part taken out (REPLACE / REMOVE): it goes back to free stock. */
  from: PlanPart | null;
  /** When true, the fitted chain is shortened in place (same variation, smaller length). */
  shortenInPlace?: boolean;
}

export type PlanProblem =
  | { kind: "NO_SETS" }
  | { kind: "NO_PIECE"; byproductId: string; variationId: string; lengthMilli: number }
  | { kind: "NO_FREE"; byproductId: string; variationId: string };

export interface SetOption {
  setId: string;
  /** No change needed. */
  ready: boolean;
  changes: PlanChange[];
  /** When true, no physical set exists in stock; the entire set/combination is on backorder. */
  isWholeBackorder?: boolean;
  /** Wanted parts for a whole backorder set. */
  combination?: { byproductId: string; variationId: string; lengthMilli: number | null }[];
}

export type SetStatus = { setId: string; status: "READY" | "CHANGE"; changes: PlanChange[] } | { setId: string; status: "CANNOT"; problem: PlanProblem };

const KIND_ORDER: Record<PieceKind, number> = { CUT: 0, OPEN: 1, CLOSED: 2 };
export const countedKey = (variationId: string, warehouseId: string | null) => `${variationId}|${warehouseId ?? ""}`;

/** "bp:variation:milli|…" sorted by by-product, so the same parts always give the same key. */
export function setTypeKey(parts: readonly { byproductId: string; variationId: string; length?: number | null }[]) {
  return [...parts]
    .map((p) => `${p.byproductId}:${p.variationId}:${p.length ?? ""}`)
    .sort()
    .join("|");
}

/** True when every required by-product has a variation, and every measured one a length. */
export function wantComplete(links: readonly PlanLink[], want: SetWant): boolean {
  return links.every((l) => {
    const w = want[l.id];
    if (!w) return !l.required && w === null;
    return !!w.variationId && (!l.measured || (w.lengthMilli ?? 0) > 0);
  });
}

/** The changes that turn `set` into `want` (no stock decided yet). */
export function diffSet(links: readonly PlanLink[], set: PlanSet, want: SetWant): PlanChange[] {
  const out: PlanChange[] = [];
  for (const l of links) {
    const has = set.parts.find((p) => p.byproductId === l.id) ?? null;
    const w = want[l.id] ?? null;
    if (!w) {
      if (has) out.push({ byproductId: l.id, action: "REMOVE", from: has });
      continue;
    }
    const lengthMilli = l.measured ? (w.lengthMilli ?? 0) : null;
    if (has && has.variationId === w.variationId && (!l.measured || has.lengthMilli === lengthMilli)) continue;
    const isShorten = l.measured && has?.variationId === w.variationId && (has?.lengthMilli ?? 0) >= (lengthMilli ?? 0);
    out.push({
      byproductId: l.id,
      action: has ? "REPLACE" : "ADD",
      variationId: w.variationId,
      ...(l.measured ? { lengthMilli: lengthMilli! } : {}),
      from: has,
      ...(isShorten ? { shortenInPlace: true } : {}),
    });
  }
  return out;
}

/** Free pieces of a variation in a warehouse that are long enough, in plan order (Cut → Open → Sealed, shortest first). */
export function piecesThatFit(stock: PlanStock, variationId: string, warehouseId: string | null, needMilli: number): PlanPiece[] {
  return stock.pieces
    .filter((p) => p.variationId === variationId && (!warehouseId || p.warehouseId === warehouseId) && p.remainingMilli >= needMilli)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.remainingMilli - b.remainingMilli);
}

/**
 * Takes every new part of `changes` from `stock` (mutated): measured — the chosen piece if it still
 * fits, else the first that fits; counted — one free unit. Returns the changes with pieceIds, or the
 * first problem (stock left as it was). With `backorder`, a part not in stock is marked
 * `backorder` instead of failing.
 */
export function takeParts(
  links: readonly PlanLink[],
  set: PlanSet,
  changes: readonly PlanChange[],
  stock: PlanStock,
  chosenPieces: Record<string, string> = {},
  backorder = false,
): { ok: true; changes: PlanChange[] } | { ok: false; problem: PlanProblem } {
  const undo: (() => void)[] = [];
  const out: PlanChange[] = [];
  for (const c of changes) {
    if (c.action === "REMOVE") {
      out.push(c);
      continue;
    }
    const link = links.find((l) => l.id === c.byproductId)!;
    if (link.measured) {
      const need = c.lengthMilli ?? 0;

      // CASE 2A: Same variation and SMALLER length -> shorten in place!
      if (
        c.from &&
        c.from.variationId === c.variationId &&
        (c.from.lengthMilli ?? 0) >= need &&
        !chosenPieces[c.byproductId]
      ) {
        const leftover = (c.from.lengthMilli ?? 0) - need;
        if (leftover > 0) {
          const cutPiece: PlanPiece = {
            id: `leftover-${set.id}-${c.byproductId}`,
            variationId: c.variationId!,
            kind: "CUT",
            remainingMilli: leftover,
            warehouseId: set.warehouseId,
          };
          stock.pieces.push(cutPiece);
          undo.push(() => {
            const idx = stock.pieces.indexOf(cutPiece);
            if (idx >= 0) stock.pieces.splice(idx, 1);
          });
        }
        out.push({ ...c, shortenInPlace: true });
        continue;
      }

      // If c.from is replaced (different variation, or same variation but LARGER),
      // the fitted piece goes back to free stock!
      let releasedPiece: PlanPiece | null = null;
      if (c.from && c.from.lengthMilli && c.from.lengthMilli > 0) {
        releasedPiece = {
          id: `released-${set.id}-${c.byproductId}`,
          variationId: c.from.variationId,
          kind: "CUT",
          remainingMilli: c.from.lengthMilli,
          warehouseId: set.warehouseId,
        };
        stock.pieces.push(releasedPiece);
        undo.push(() => {
          const idx = stock.pieces.indexOf(releasedPiece!);
          if (idx >= 0) stock.pieces.splice(idx, 1);
        });
      }

      const fits = piecesThatFit(stock, c.variationId!, set.warehouseId, need);
      const piece = fits.find((p) => p.id === chosenPieces[c.byproductId]) ?? fits[0];
      if (!piece && backorder) {
        out.push({ ...c, backorder: true });
        continue;
      }
      if (!piece) {
        undo.forEach((u) => u());
        return { ok: false, problem: { kind: "NO_PIECE", byproductId: c.byproductId, variationId: c.variationId!, lengthMilli: need } };
      }
      piece.remainingMilli -= need;
      undo.push(() => (piece.remainingMilli += need));
      out.push({ ...c, pieceId: piece.id });
    } else {
      const key = countedKey(c.variationId!, set.warehouseId);
      if ((stock.counted[key] ?? 0) < 1 && backorder) {
        out.push({ ...c, backorder: true });
        continue;
      }
      if ((stock.counted[key] ?? 0) < 1) {
        undo.forEach((u) => u());
        return { ok: false, problem: { kind: "NO_FREE", byproductId: c.byproductId, variationId: c.variationId! } };
      }
      stock.counted[key] = (stock.counted[key] ?? 0) - 1;
      undo.push(() => (stock.counted[key] = (stock.counted[key] ?? 0) + 1));
      out.push(c);
    }
  }
  return { ok: true, changes: out };
}

/** Deep copy, so a preview never touches the caller's stock. */
export const cloneStock = (s: PlanStock): PlanStock => ({ pieces: s.pieces.map((p) => ({ ...p })), counted: { ...s.counted } });

/** Status of one set against the wanted contents, with stock as it is now (stock not changed). */
export function setStatus(links: readonly PlanLink[], set: PlanSet, want: SetWant, stock: PlanStock, chosenPieces: Record<string, string> = {}): SetStatus {
  const diff = diffSet(links, set, want);
  if (!diff.length) return { setId: set.id, status: "READY", changes: [] };
  const r = takeParts(links, set, diff, cloneStock(stock), chosenPieces);
  return r.ok ? { setId: set.id, status: "CHANGE", changes: r.changes } : { setId: set.id, status: "CANNOT", problem: r.problem };
}

export interface BuildPlan {
  picks: SetOption[];
  /** Picks with a part on backorder (only when planned with `backorder`). */
  backorders: number;
  /** Why fewer than `quantity` sets could be made (empty when all were). */
  problems: PlanProblem[];
}

/**
 * Plans `quantity` sets of the wanted contents (plan §3.1):
 * 1. sets that already match, oldest first;
 * 2. for each set still needed, the set needing the fewest changes whose new parts are all in free
 *    stock (ties: fewest chain cuts, then oldest), unless the seller chose a set for that slot (`preferred`);
 * stock taken by earlier sets of this plan is deducted, so two sets never count on the same piece.
 * 3. with `backorder`, a slot no set can fill from stock takes the set needing the fewest changes
 *    and marks the parts not in stock as backorder (the problem is still reported).
 * `stock` is not changed; `chosenPieces[setId][byproductId]` = the bundle the seller tapped.
 */
export function planSets(
  links: readonly PlanLink[],
  sets: readonly PlanSet[],
  want: SetWant,
  quantity: number,
  stock: PlanStock,
  opts: { preferred?: Record<number, string>; chosenPieces?: Record<string, Record<string, string>>; backorder?: boolean } = {},
): BuildPlan {
  const left = cloneStock(stock);
  const used = new Set<string>();
  const picks: SetOption[] = [];
  const problems: PlanProblem[] = [];
  let backorders = 0;
  const ready = sets.filter((s) => !diffSet(links, s, want).length);
  for (let slot = 0; slot < quantity; slot++) {
    const preferredId = opts.preferred?.[slot];
    const preferred = preferredId && !used.has(preferredId) ? sets.find((s) => s.id === preferredId) : undefined;
    const exact = preferred ? (ready.includes(preferred) ? preferred : undefined) : ready.find((s) => !used.has(s.id));
    if (exact) {
      used.add(exact.id);
      picks.push({ setId: exact.id, ready: true, changes: [] });
      continue;
    }
    const candidates = (preferred ? [preferred] : sets.filter((s) => !used.has(s.id)))
      .map((s, i) => ({ s, i, diff: diffSet(links, s, want) }))
      .sort((a, b) =>
        bundleCuts(links, a.diff) - bundleCuts(links, b.diff) ||
        a.diff.length - b.diff.length ||
        shortenExcess(a.diff) - shortenExcess(b.diff) ||
        a.i - b.i
      );
    let done = false;
    let firstProblem: PlanProblem | null = null;
    for (const c of candidates) {
      const r = takeParts(links, c.s, c.diff, left, opts.chosenPieces?.[c.s.id]);
      if (!r.ok) {
        firstProblem ??= r.problem;
        continue;
      }
      used.add(c.s.id);
      picks.push({ setId: c.s.id, ready: false, changes: r.changes });
      done = true;
      break;
    }
    if (!done && opts.backorder && firstProblem && candidates[0]) {
      const c = candidates[0];
      const r = takeParts(links, c.s, c.diff, left, opts.chosenPieces?.[c.s.id], true);
      if (r.ok) {
        used.add(c.s.id);
        picks.push({ setId: c.s.id, ready: false, changes: r.changes });
        backorders += 1;
        if (!problems.length) problems.push(firstProblem);
        continue;
      }
    }
    // Whole combination backorder when no candidates remain (no sets / main component in stock)
    if (!done && opts.backorder && !candidates.length) {
      const combination = links.map((l) => ({
        byproductId: l.id,
        variationId: want[l.id]?.variationId ?? "",
        lengthMilli: l.measured ? (want[l.id]?.lengthMilli ?? null) : null,
      }));
      picks.push({
        setId: `backorder-slot-${slot}`,
        ready: false,
        isWholeBackorder: true,
        combination,
        changes: [],
      });
      backorders += 1;
      if (!problems.length) problems.push({ kind: "NO_SETS" });
      continue;
    }
    if (!done) {
      problems.push(firstProblem ?? { kind: "NO_SETS" });
      break;
    }
  }
  return { picks, problems, backorders };
}

/** Measured parts a change set would cut from a free bundle (fewer is better; shorten-in-place cuts existing fitted chain without using a free bundle). */
export function bundleCuts(links: readonly PlanLink[], changes: readonly PlanChange[]): number {
  return changes.filter((c) => {
    if (c.action === "REMOVE") return false;
    const l = links.find((x) => x.id === c.byproductId);
    if (!l?.measured) return false;
    if (c.shortenInPlace) return false;
    const isShorten = c.from && c.from.variationId === c.variationId && (c.from.lengthMilli ?? 0) >= (c.lengthMilli ?? 0);
    return !isShorten;
  }).length;
}

/** Backward compatible alias for bundleCuts */
export const cuts = bundleCuts;

/** Millimetres of excess chain cut off when shortening fitted chain (less waste is better). */
export function shortenExcess(changes: readonly PlanChange[]): number {
  return changes.reduce((sum, c) => {
    if (c.shortenInPlace || (c.from && c.from.variationId === c.variationId && (c.from.lengthMilli ?? 0) >= (c.lengthMilli ?? 0))) {
      return sum + Math.max(0, (c.from?.lengthMilli ?? 0) - (c.lengthMilli ?? 0));
    }
    return sum;
  }, 0);
}

/** The other sets that could fill a slot instead, each with its changes (for "Other set…"). */
export function alternatives(links: readonly PlanLink[], sets: readonly PlanSet[], want: SetWant, stock: PlanStock, exclude: readonly string[]): SetStatus[] {
  return sets
    .filter((s) => !exclude.includes(s.id))
    .map((s) => setStatus(links, s, want, stock))
    .filter((s) => s.status !== "CANNOT")
    .sort((a, b) =>
      (a.status === "READY" ? 0 : 1) - (b.status === "READY" ? 0 : 1) ||
      (a.status === "READY" ? 0 : bundleCuts(links, a.changes)) - (b.status === "READY" ? 0 : bundleCuts(links, b.changes)) ||
      (a.status === "READY" ? 0 : a.changes.length) - (b.status === "READY" ? 0 : b.changes.length) ||
      (a.status === "READY" ? 0 : shortenExcess(a.changes)) - (b.status === "READY" ? 0 : shortenExcess(b.changes))
    );
}
