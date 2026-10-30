"use client";

import { useEffect, useMemo, useState } from "react";
import { ratePerOf, toMilli } from "@rs-v31/shared/measure";
import { alternatives, countedKey, diffSet, planSets, setTypeKey, wantComplete, type PlanChange, type PlanLink, type PlanProblem, type PlanSet, type PlanStock, type SetStatus, type SetWant } from "@rs-v31/shared/sets";
import { useCart, type CartLine, type SaleSetPick } from "@/components/CartContext";
import { LengthField } from "@/components/measure/LengthField";
import { Alert, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { GroupedInfo, GroupSet, Product, SetContentRow, SetDetail, SetPart, WarehouseQty } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useEntryUnits } from "@/lib/useEntryUnits";
import { useWarehouses } from "@/lib/useWarehouses";
import { partValue, variationText } from "./SetSheet";
import { formatContentItem } from "./SetContents";
import { fmtLen, fmtSellRate } from "@/lib/measure";
import { useLengthView } from "@/lib/lengthView";

// V3.1 sale cart (docs\GROUPED-PRODUCTS-V3-PLAN.md §5, docs\SET-BUILD-IN-SALE-PLAN.md), two steps:
// 1. Choose the combination the customer wants — each by-product's option and, for a chain, its
//    length in any unit — with the set combinations in stock alongside (tap one to use it).
// 2. Confirm: sets in stock with exactly that combination are used (Ready); only for sets still
//    missing does the shared planner (`planSets`) offer to create one on the spot — the set needing
//    the fewest changes, every new part from free stock (a chain cut from the bundle shown, which
//    the seller can change, like the measured cut plan).
// Each change reprices the set (D12). Confirm turns the picks into cart lines — one line per price.
// Nothing changes in stock until the sale is saved; the server re-checks every set and piece then.
// 3. Backorder: when no free bundle (or counted stock) has a by-product, the seller can confirm a
//    backorder — the set is held on a customer order and the part is fitted at delivery, after a
//    new bundle is bought (the order's "Arrange purchase" fills the purchase cart with it).

type Byproduct = GroupedInfo["byproducts"][number];

interface PartEdit {
  action: "REPLACE" | "ADD" | "REMOVE";
  variationId: string;
  length: string;
  /** "" = the first free piece that fits (Cut → Open → Sealed, smallest first). */
  pieceId: string;
  /** No free stock has it now: fitted at delivery from stock bought for the order. */
  backorder?: boolean;
}
type Edits = Record<string, Record<string, PartEdit>>;

interface FreePiece {
  id: string;
  code: string;
  kind: "CLOSED" | "OPEN" | "CUT";
  remainingLength: number;
  warehouseId: string | null;
  setId: string | null;
}

/** Wanted part in the form: variation ("" = not chosen) and length in base units; null = not fitted. */
type WantForm = Record<string, { variationId: string; length: number | null } | null>;

const paiseOf = (v: string | number) => Math.round(Number(v) * 100);
const KIND_TEXT: Record<FreePiece["kind"], string> = { CUT: "Cut piece", OPEN: "Open roll", CLOSED: "Sealed roll" };
const KIND_ORDER: Record<FreePiece["kind"], number> = { CUT: 0, OPEN: 1, CLOSED: 2 };
const lenText = (b: Byproduct, milli: number) => fmtLen(milli / 1000, { lengthUnit: b.lengthUnit ?? "m", decimals: b.decimals ?? 3 });
/** A typed length in milli, rounded to the product's decimals (10 ft on a 1-decimal metres product = 3.0 m, as shown). */
const roundedMilli = (b: Byproduct, base: number) => {
  const step = 10 ** (3 - Math.min(3, Math.max(0, b.decimals ?? 3)));
  return Math.round(toMilli(base) / step) * step;
};

/** Sale amount of a part in paise: sale rate × quantity (a length is per m, or per ft on ft + in). */
function partPaise(salePrice: string, quantity: number, lengthUnit: "m" | "ft_in" | null, measured: boolean) {
  if (!measured) return paiseOf(salePrice);
  return Math.round((paiseOf(salePrice) * quantity) / ratePerOf(lengthUnit) / 100) * 100;
}

const toEdit = (c: PlanChange): PartEdit => ({
  action: c.action,
  variationId: c.variationId ?? "",
  length: c.lengthMilli !== undefined ? String(c.lengthMilli / 1000) : "",
  pieceId: c.pieceId ?? "",
  ...(c.backorder ? { backorder: true } : {}),
});

/** A set's by-products as planner parts. */
const planPartsOf = (s: GroupSet) =>
  s.parts.filter((p) => p.role === "BY" && p.byproductId).map((p) => ({ byproductId: p.byproductId!, variationId: p.variationId, lengthMilli: p.productType === "measured" ? toMilli(p.quantity) : null }));

export function SaleSetsModal({
  productId,
  initial,
  initialPrice,
  excludeSetIds = [],
  orderId,
  onClose,
  onConfirm,
}: {
  productId: string;
  /** Editing a sale order: its held sets can be picked again. */
  orderId?: string;
  /** The picks of the cart line(s) being edited: their combination is filled in. */
  initial?: SaleSetPick[];
  /** Price of the cart line being edited, if any. */
  initialPrice?: string;
  /** Sets already on other cart lines. */
  excludeSetIds?: string[];
  onClose: () => void;
  onConfirm: (lines: CartLine[]) => void;
}) {
  useLengthView();
  const { data, error: loadError } = useApi<{ product: Product }>(`/products/${productId}`);
  const setsRes = useApi<{ sets: GroupSet[]; typePrices?: Record<string, { salePrice: string; minSalePrice?: string }> }>(`/sets?groupId=${productId}&status=IN_STOCK`);
  const heldRes = useApi<{ sets: GroupSet[] }>(orderId ? `/sets?groupId=${productId}&status=HELD` : null);
  const product = data?.product ?? null;
  const info = product?.grouped ?? null;
  const wh = useWarehouses();
  const cart = useCart();
  // V3.2 editing a sale: its own sets can be picked again, at the price each was sold at.
  const soldSets = cart.mode === "sale" ? cart.editing?.soldSets : undefined;
  const soldRes = useApi<{ sets: GroupSet[] }>(soldSets ? `/sets?groupId=${productId}&status=SOLD&saleId=${cart.editing!.documentId}` : null);
  const units = useEntryUnits("sale");
  const [step, setStep] = useState<1 | 2>(1);
  const [want, setWant] = useState<WantForm>({});
  const [quantity, setQuantity] = useState(initial?.length || 1);
  /** Step 2: selling price per set and individual per-set overrides. */
  const [sellingPrice, setSellingPrice] = useState<string>(initialPrice ?? "");
  const [perSetPrices, setPerSetPrices] = useState<Record<string, string>>({});
  /** Step 2: the set the seller chose for a slot ("Other set…"), and bundles tapped per set. */
  const [preferred, setPreferred] = useState<Record<number, string>>({});
  const [chosenPieces, setChosenPieces] = useState<Record<string, Record<string, string>>>({});
  const [otherFor, setOtherFor] = useState<number | null>(null);
  /** Step 2: the seller confirmed a backorder for the by-products not in stock. */
  const [backorder, setBackorder] = useState(false);
  const [pieces, setPieces] = useState<Record<string, FreePiece[]>>({});
  const [freeQty, setFreeQty] = useState<Record<string, number>>({});
  const [freeByWh, setFreeByWh] = useState<Record<string, WarehouseQty[] | null>>({});
  const [error, setError] = useState("");

  // Free pieces of measured by-products and free stock of counted ones (for the planner).
  useEffect(() => {
    if (!info) return;
    let live = true;
    for (const b of info.byproducts) {
      if (b.productType === "measured") {
        api<{ variations: { id: string; pieces: FreePiece[] }[] }>(`/measure/products/${b.productId}/pieces?status=active`).then(
          (r) => live && setPieces((x) => ({ ...x, ...Object.fromEntries(r.variations.map((v) => [v.id, v.pieces.filter((p) => !p.setId)])) })),
          () => undefined,
        );
      } else {
        api<{ product: { variations: { id: string; quantity: number; byWarehouse?: (WarehouseQty & { inSets?: number })[] | null }[] } }>(`/inventory/products/${b.productId}`).then(
          (r) => {
            if (!live) return;
            setFreeQty((x) => ({ ...x, ...Object.fromEntries(r.product.variations.map((v) => [v.id, v.quantity])) }));
            setFreeByWh((x) => ({ ...x, ...Object.fromEntries(r.product.variations.map((v) => [v.id, v.byWarehouse ?? null])) }));
          },
          () => undefined,
        );
      }
    }
    return () => {
      live = false;
    };
  }, [info]);

  const setPrice = product?.variations[0] ? paiseOf(product.variations[0].salePrice) : 0;
  const setMinPrice = product?.variations[0] && Number(product.variations[0].minSalePrice) > 0 ? paiseOf(product.variations[0].minSalePrice) : 0;
  const all = useMemo(
    () =>
      [...(heldRes.data?.sets ?? []).filter((s) => s.orderId === orderId), ...(soldRes.data?.sets ?? []), ...(setsRes.data?.sets ?? [])].filter((s) => !excludeSetIds.includes(s.id)),
    [setsRes.data, heldRes.data, soldRes.data, orderId, excludeSetIds],
  );
  const byproducts = useMemo(() => info?.byproducts ?? [], [info]);
  const setById = useMemo(() => new Map(all.map((s) => [s.id, s])), [all]);

  // Start: optional parts "none", a required part with one variation chosen; editing a cart line
  // fills in the combination its first set will have after its changes.
  useEffect(() => {
    if (!info || !setsRes.data || (orderId && !heldRes.data) || (soldSets && !soldRes.data)) return;
    setWant((w) => {
      if (Object.keys(w).length) return w;
      const first = initial?.[0];
      const set = first ? setById.get(first.setId) : undefined;
      return Object.fromEntries(
        info.byproducts.map((b) => {
          if (set) {
            const c = first!.changes?.find((x) => x.byproductId === b.id);
            if (c) return [b.id, c.action === "REMOVE" ? null : { variationId: c.variationId ?? "", length: c.length ?? null }];
            const p = set.parts.find((x) => x.role === "BY" && x.byproductId === b.id);
            return [b.id, p ? { variationId: p.variationId, length: b.productType === "measured" ? p.quantity : null } : b.required ? { variationId: "", length: null } : null];
          }
          return [b.id, b.required ? { variationId: b.variations.length === 1 ? b.variations[0]!.id : "", length: null } : null];
        }),
      );
    });
  }, [info, setsRes.data, heldRes.data, soldRes.data, soldSets, orderId, initial, setById]);

  // ---- Planner inputs ----
  const links: PlanLink[] = useMemo(() => byproducts.map((b) => ({ id: b.id, required: b.required, measured: b.productType === "measured" })), [byproducts]);
  const whOf = (s: GroupSet) => (wh.enabled ? s.warehouseId : null);
  const planSetsIn: PlanSet[] = useMemo(() => {
    // The line's own sets first (an edit keeps them unless the combination changes), then the
    // sets sold on the sale being edited, then oldest first (FIFO): the API lists sets in code order.
    const rank = (s: GroupSet) => (initial?.some((p) => p.setId === s.id) ? 0 : soldSets?.[s.id] ? 1 : 2);
    return [...all]
      .sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt))
      .map((s) => ({ id: s.id, warehouseId: wh.enabled ? s.warehouseId : null, parts: planPartsOf(s) }));
  }, [all, wh.enabled, initial, soldSets]);

  /** Free stock now, less what other cart lines will take (the server re-checks on save). */
  const stock: PlanStock = useMemo(() => {
    const s: PlanStock = {
      pieces: Object.entries(pieces).flatMap(([variationId, list]) =>
        list.map((p) => ({ id: p.id, variationId, kind: p.kind, remainingMilli: toMilli(p.remainingLength), warehouseId: wh.enabled ? p.warehouseId : null })),
      ),
      counted: {},
    };
    for (const [variationId, q] of Object.entries(freeQty)) s.counted[countedKey(variationId, null)] = q;
    for (const [variationId, rows] of Object.entries(freeByWh)) {
      for (const r of rows ?? []) s.counted[countedKey(variationId, r.warehouseId)] = r.quantity - ((r as { inSets?: number }).inSets ?? 0);
    }
    const editing = new Set((initial ?? []).map((p) => p.setId));
    const take = (variationId: string, warehouseId: string | null, n: number) => {
      for (const k of [countedKey(variationId, null), ...(warehouseId ? [countedKey(variationId, warehouseId)] : [])]) if (k in s.counted) s.counted[k] = s.counted[k]! - n;
    };
    for (const l of cart.lines) {
      if (l.saleSets?.some((p) => editing.has(p.setId))) continue;
      if (l.measure?.pieceId) {
        const p = s.pieces.find((x) => x.id === l.measure!.pieceId);
        if (p) p.remainingMilli -= toMilli(l.quantity);
      } else if (l.saleSets) {
        for (const c of l.saleSets.flatMap((x) => x.changes ?? [])) {
          if (c.action === "REMOVE" || !c.variationId) continue;
          if (c.pieceId && c.length) {
            const p = s.pieces.find((x) => x.id === c.pieceId);
            if (p) p.remainingMilli -= toMilli(c.length);
          } else if (!c.length) take(c.variationId, null, 1);
        }
      } else if (!l.sets) {
        if (l.splits?.length) for (const sp of l.splits) take(l.variationId, sp.warehouseId, sp.quantity);
        else take(l.variationId, null, l.quantity);
      }
    }
    return s;
  }, [pieces, freeQty, freeByWh, wh.enabled, cart.lines, initial]);

  const wanted: SetWant = useMemo(
    () =>
      Object.fromEntries(
        byproducts.map((b) => {
          const w = want[b.id];
          if (!w) return [b.id, w === null ? null : undefined];
          return [b.id, { variationId: w.variationId, lengthMilli: b.productType === "measured" && w.length !== null && Number.isFinite(w.length) ? roundedMilli(b, w.length) : null }];
        }),
      ) as SetWant,
    [want, byproducts],
  );
  const complete = links.length > 0 && wantComplete(links, wanted);
  const plan = useMemo(
    () => (complete ? planSets(links, planSetsIn, wanted, quantity, stock, { preferred, chosenPieces, backorder }) : null),
    [complete, links, planSetsIn, wanted, quantity, stock, preferred, chosenPieces, backorder],
  );
  const readyCount = complete ? planSetsIn.filter((s) => !diffSet(links, s, wanted).length).length : 0;

  /** Set combinations in stock (like variations): sets with the same parts, with how many. */
  const types = useMemo(() => {
    const map = new Map<string, { key: string; set: GroupSet; plan: PlanSet; count: number; byWh: Map<string, number> }>();
    for (const s of all) {
      const ps = planSetsIn.find((p) => p.id === s.id)!;
      const key = links.map((l) => {
        const p = ps?.parts.find((x) => x.byproductId === l.id);
        return p ? `${p.variationId}:${p.lengthMilli ?? ""}` : "-";
      }).join("|");
      const t = map.get(key) ?? { key, set: s, plan: ps, count: 0, byWh: new Map<string, number>() };
      t.count += 1;
      if (wh.enabled && s.warehouseId) t.byWh.set(s.warehouseId, (t.byWh.get(s.warehouseId) ?? 0) + 1);
      map.set(key, t);
    }
    return [...map.values()].sort((a, b) => a.set.name.localeCompare(b.set.name, undefined, { numeric: true }));
  }, [all, planSetsIn, links, wh.enabled]);

  const resetPlanChoices = () => {
    setPreferred({});
    setChosenPieces({});
    setOtherFor(null);
    setBackorder(false);
  };
  const applyType = (s: GroupSet) => {
    setWant(Object.fromEntries(byproducts.map((b) => {
      const p = s.parts.find((x) => x.role === "BY" && x.byproductId === b.id);
      return [b.id, p ? { variationId: p.variationId, length: b.productType === "measured" ? p.quantity : null } : null];
    })));
    resetPlanChoices();
    setError("");
  };

  const fittedOf = (s: GroupSet, b: Byproduct) => s.parts.find((p) => p.role === "BY" && p.byproductId === b.id) ?? null;
  const shownLength = (b: Byproduct, e: PartEdit) => (Number(e.length) > 0 ? String(roundedMilli(b, Number(e.length)) / 1000) : e.length);
  const newLabel = (b: Byproduct, e: PartEdit) => {
    const v = b.variations.find((x) => x.id === e.variationId);
    if (!v) return "";
    return b.productType === "measured" ? `${variationText(b, v)} ${shownLength(b, e)} ${b.lengthUnit === "ft_in" ? "in" : "m"}` : b.productType === "simple" ? b.name : variationText(b, v);
  };

  /** D12 repricing of one set with its edits, in paise. */
  function priceOf(s: GroupSet, edits: Edits) {
    // A set of the sale being edited starts from the price it was sold at.
    // 0041: a set's price is its set type's, else the product's old price.
    const typePrice = setsRes.data?.typePrices?.[s.typeKey]?.salePrice;
    let p = soldSets?.[s.id] !== undefined ? paiseOf(soldSets[s.id]!) : typePrice !== undefined ? paiseOf(typePrice) : setPrice;
    for (const b of byproducts) {
      const e = edits[s.id]?.[b.id];
      if (!e) continue;
      const old: SetPart | null = fittedOf(s, b);
      if (old && e.action !== "ADD") p -= partPaise(old.salePrice, old.quantity, old.lengthUnit, old.productType === "measured");
      if (e.action !== "REMOVE") {
        const v = b.variations.find((x) => x.id === e.variationId);
        const len = Number(e.length) > 0 ? roundedMilli(b, Number(e.length)) / 1000 : 0;
        if (v && (b.productType !== "measured" || len > 0)) p += partPaise(v.salePrice, len, b.lengthUnit, b.productType === "measured");
      }
    }
    return Math.max(0, p);
  }

  const typePriceOf = (s: GroupSet) => {
    const tp = setsRes.data?.typePrices?.[s.typeKey];
    let sale = 0;
    if (tp?.salePrice !== undefined && Number(tp.salePrice) > 0) {
      sale = Math.round(Number(tp.salePrice));
    } else {
      const p = priceOf(s, {});
      sale = p > 0 ? Math.round(p / 100) : setPrice > 0 ? Math.round(setPrice / 100) : 0;
    }

    let min = 0;
    if (tp?.minSalePrice !== undefined && Number(tp.minSalePrice) > 0) {
      min = Math.round(Number(tp.minSalePrice));
    } else if (setMinPrice > 0) {
      min = Math.round(setMinPrice / 100);
    }
    return { sale, min };
  };

  /** "Chain Hoist · 4 mm 3 m (was 8 mm 3 m)" — named by contents after the edits (D18). */
  function summaryOf(s: GroupSet, edits: Edits) {
    const parts = byproducts.flatMap((b) => {
      const e = edits[s.id]?.[b.id];
      const old = fittedOf(s, b);
      if (!e) return old ? [old.label] : [];
      if (e.action === "REMOVE") return [`no ${old?.label ?? b.name}`];
      const now = `${newLabel(b, e)}${e.backorder ? " — backorder" : ""}`;
      return [old ? `${now} (was ${old.label})` : `+ ${now}`];
    });
    // Parts whose link was removed from the product stay in the set as they are.
    const extra = s.parts.filter((p) => p.role === "BY" && !byproducts.some((b) => b.id === p.byproductId)).map((p) => p.label);
    return [...parts, ...extra, s.warehouseId && wh.enabled ? `in ${wh.codeOf(s.warehouseId)}` : ""].filter(Boolean).join(" · ");
  }

  /** The set's contents part by part after the edits, for the cart line (no codes). */
  function detailOf(s: GroupSet, edits: Edits): SetDetail {
    const rows: SetContentRow[] = byproducts.flatMap((b) => {
      const e = edits[s.id]?.[b.id];
      const old = fittedOf(s, b);
      if (!e) return old ? [{ name: b.name, value: old.value }] : [];
      if (e.action === "REMOVE") return [{ name: b.name, value: "Removed" }];
      const now = `${partValue(b, b.variations.find((x) => x.id === e.variationId), shownLength(b, e))}${e.backorder ? " — backorder" : ""}`;
      return [{ name: b.name, value: old ? `${now} (was ${old.value})` : `${now} (added)` }];
    });
    const extra = s.parts.filter((p) => p.role === "BY" && !byproducts.some((b) => b.id === p.byproductId)).map((p) => ({ name: p.productName, value: p.value }));
    return { rows: [...rows, ...extra], ...(s.warehouseId && wh.enabled ? { note: wh.codeOf(s.warehouseId) } : {}) };
  }

  const problemText = (p: PlanProblem) => {
    if (p.kind === "NO_SETS") return all.length ? "no more sets in stock to use" : `no ${product?.name ?? ""} sets in stock — buy sets or add opening sets`;
    const b = byproducts.find((x) => x.id === p.byproductId);
    const v = b?.variations.find((x) => x.id === p.variationId);
    const name = b && v ? (b.productType === "simple" ? b.name : `${b.name} ${variationText(b, v)}`) : "part";
    return p.kind === "NO_PIECE" ? `no free ${name} bundle has ${b ? lenText(b, p.lengthMilli) : ""}` : `no free ${name} in stock`;
  };
  /** The by-product a problem is about, and the longest free bundle of it (measured). */
  const problemPart = (p: PlanProblem) => {
    if (p.kind === "NO_SETS") return null;
    const b = byproducts.find((x) => x.id === p.byproductId);
    const v = b?.variations.find((x) => x.id === p.variationId);
    if (!b || !v) return null;
    const longest = stock.pieces.filter((x) => x.variationId === p.variationId).reduce((m, x) => Math.max(m, x.remainingMilli), 0);
    return { b, name: b.productType === "simple" ? b.name : `${b.name} ${variationText(b, v)}`, measured: b.productType === "measured", longest };
  };

  /** The combination as text, e.g. "8 mm · 3 m · Safety Hook 1 Ton". */
  const wantText = byproducts
    .flatMap((b) => {
      const w = wanted[b.id];
      if (!w) return [];
      const v = b.variations.find((x) => x.id === w.variationId);
      if (!v) return [];
      return [b.productType === "simple" ? b.name : b.productType === "measured" && w.lengthMilli ? `${variationText(b, v)} · ${lenText(b, w.lengthMilli)}` : variationText(b, v)];
    })
    .join(" · ");

  const wantedTypeKey = useMemo(
    () =>
      setTypeKey(
        byproducts.map((b) => {
          const w = wanted[b.id];
          return {
            byproductId: b.id,
            variationId: w?.variationId ?? "",
            length: b.productType === "measured" ? (w?.lengthMilli ?? null) : null,
          };
        }),
      ),
    [byproducts, wanted],
  );
  const combinationPrice = useMemo(() => {
    const tp = setsRes.data?.typePrices?.[wantedTypeKey]?.salePrice;
    if (tp !== undefined) return paiseOf(tp);
    let p = setPrice;
    for (const b of byproducts) {
      const w = wanted[b.id];
      if (!w || !w.variationId) continue;
      const v = b.variations.find((x) => x.id === w.variationId);
      const len = b.productType === "measured" ? (w.lengthMilli ?? 0) / 1000 : 0;
      if (v && (b.productType !== "measured" || len > 0)) {
        p += partPaise(v.salePrice, len, b.lengthUnit, b.productType === "measured");
      }
    }
    return Math.max(0, p);
  }, [setsRes.data?.typePrices, wantedTypeKey, setPrice, byproducts, wanted]);

  const wantedRows = useMemo<SetContentRow[]>(
    () =>
      byproducts.flatMap((b) => {
        const w = wanted[b.id];
        if (!w || !w.variationId) return [];
        const v = b.variations.find((x) => x.id === w.variationId);
        const len = b.productType === "measured" && w.lengthMilli ? String(w.lengthMilli / 1000) : "";
        return [{ name: b.name, value: partValue(b, v, len) }];
      }),
    [byproducts, wanted],
  );

  const picks = plan?.picks ?? [];
  const edits: Edits = useMemo(() => Object.fromEntries(picks.filter((p) => !p.isWholeBackorder).map((p) => [p.setId, Object.fromEntries(p.changes.map((c) => [c.byproductId, toEdit(c)]))])), [picks]);
  const readyPicks = picks.filter((p) => p.ready);
  const madePicks = picks.map((p, slot) => ({ p, slot })).filter((x) => !x.p.ready && !x.p.isWholeBackorder);
  const wholeBackorderPicks = picks.map((p, slot) => ({ p, slot })).filter((x) => x.p.isWholeBackorder);
  const backorderPicks = picks.filter((p) => p.isWholeBackorder || p.changes.some((c) => c.backorder)).length;
  const problem = plan?.problems[0] ?? null;
  const shortPart = problem ? problemPart(problem) : null;
  
  const combinationMinPrice = useMemo(() => {
    const tp = setsRes.data?.typePrices?.[wantedTypeKey]?.minSalePrice;
    if (tp !== undefined && Number(tp) > 0) return paiseOf(tp);
    if (tp !== undefined && Number(tp) === 0) return 0;
    let p = setMinPrice;
    let hasMin = setMinPrice > 0;
    for (const b of byproducts) {
      const w = wanted[b.id];
      if (!w || !w.variationId) continue;
      const v = b.variations.find((x) => x.id === w.variationId);
      const len = b.productType === "measured" ? (w.lengthMilli ?? 0) / 1000 : 0;
      if (v && (b.productType !== "measured" || len > 0)) {
        const partMin = v.minSalePrice && Number(v.minSalePrice) > 0 ? v.minSalePrice : v.salePrice;
        if (v.minSalePrice && Number(v.minSalePrice) > 0) hasMin = true;
        p += partPaise(partMin, len, b.lengthUnit, b.productType === "measured");
      }
    }
    return hasMin && p > 0 ? Math.max(0, p) : 0;
  }, [setsRes.data?.typePrices, wantedTypeKey, setMinPrice, byproducts, wanted]);

  const guideSalePrice = useMemo(() => {
    const tp = setsRes.data?.typePrices?.[wantedTypeKey]?.salePrice;
    if (tp !== undefined && Number(tp) > 0) return Math.round(Number(tp));
    if (combinationPrice > 0) return Math.round(combinationPrice / 100);
    return setPrice > 0 ? Math.round(setPrice / 100) : 0;
  }, [setsRes.data?.typePrices, wantedTypeKey, combinationPrice, setPrice]);

  const guideMinPrice = useMemo(() => {
    if (combinationMinPrice > 0) return Math.round(combinationMinPrice / 100);
    return setMinPrice > 0 ? Math.round(setMinPrice / 100) : 0;
  }, [combinationMinPrice, setMinPrice]);

  function priceOfSet(s: GroupSet | null, pickId: string, edits: Edits): number {
    const custom = perSetPrices[pickId];
    if (custom !== undefined && custom !== "") {
      return paiseOf(custom);
    }
    if (sellingPrice !== "" && Number(sellingPrice) >= 0) {
      return paiseOf(sellingPrice);
    }
    return 0;
  }

  const pickedSets = picks.map((p) => setById.get(p.setId)!).filter(Boolean);
  const total = picks.reduce((t, p) => {
    const s = setById.get(p.setId) ?? null;
    return t + priceOfSet(s, p.setId, edits);
  }, 0);

  function next() {
    setError("");
    if (!complete) return setError(`Choose every required part${byproducts.some((b) => b.productType === "measured") ? " and its length" : ""}`);
    resetPlanChoices();
    setPerSetPrices({});
    setStep(2);
  }

  function confirm() {
    if (!product || !info) return;
    setError("");
    if (!picks.length) return setError("No set can be used or made with this combination");
    const hasInvalidPrice = picks.some((p) => {
      const custom = perSetPrices[p.setId];
      const val = custom !== undefined && custom !== "" ? custom : sellingPrice;
      return !val || !/^\d+$/.test(val.trim());
    });
    if (hasInvalidPrice) {
      return setError("Enter a whole rupee price");
    }
    const out: { pick: SaleSetPick; price: number; summary: string; detail: SetDetail }[] = [];
    for (const p of picks) {
      if (p.isWholeBackorder) {
        const combination = p.combination?.map((c) => {
          const b = info.byproducts.find((x) => x.id === c.byproductId)!;
          return {
            byproductId: c.byproductId,
            variationId: c.variationId,
            ...(b?.productType === "measured" ? { length: (c.lengthMilli ?? 0) / 1000 } : {}),
          };
        }) ?? [];
        out.push({
          pick: {
            setId: "",
            isWholeBackorder: true,
            combination,
            changes: [],
            code: "BACKORDER",
          },
          price: priceOfSet(null, p.setId, edits),
          summary: `${product.name} · ${wantText} (Backorder)`,
          detail: { rows: wantedRows, note: "Whole Backorder" },
        });
        continue;
      }
      const s = setById.get(p.setId);
      if (!s) continue;
      const changes: NonNullable<SaleSetPick["changes"]> = Object.entries(edits[s.id] ?? {}).map(([bp, e]) => {
        const b = info.byproducts.find((x) => x.id === bp)!;
        return {
          byproductId: bp,
          action: e.action,
          ...(e.action !== "REMOVE" ? { variationId: e.variationId } : {}),
          ...(e.action !== "REMOVE" && b.productType === "measured" ? { length: roundedMilli(b, Number(e.length)) / 1000, ...(e.pieceId && !e.backorder ? { pieceId: e.pieceId } : {}) } : {}),
          ...(e.backorder ? { backorder: true } : {}),
        };
      });
      out.push({
        pick: { setId: s.id, version: s.version, ...(changes.length ? { changes } : {}), code: s.code },
        price: priceOfSet(s, s.id, edits),
        summary: summaryOf(s, edits),
        detail: detailOf(s, edits),
      });
    }
    const byPrice = new Map<number, typeof out>();
    for (const p of out) byPrice.set(p.price, [...(byPrice.get(p.price) ?? []), p]);
    const variation = product.variations[0]!;
    onConfirm(
      [...byPrice].map(([price, group]) => ({
        variationId: variation.id,
        productId: product.id,
        productName: product.name,
        shortName: variation.shortName,
        attributes: {},
        unit: product.unit,
        imageUrl: variation.imageUrl ?? product.imageUrl,
        price: String(Math.round(price / 100)),
        quantity: group.length,
        available: all.length,
        saleSets: group.map((g) => g.pick),
        setSummaries: group.map((g) => g.summary),
        setDetails: group.map((g) => g.detail),
      })),
    );
  }

  const stepClass = (on: boolean) => `rounded-md px-2.5 py-1 text-xs font-semibold ${on ? "bg-brand-50 text-brand-700" : "text-slate-400"}`;
  const chip = (on: boolean) => `rounded-full border px-3 py-1 text-sm font-medium transition ${on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:border-brand-500 hover:text-brand-700"}`;

  return (
    <Modal open title={product ? `Sell sets · ${product.name}` : "Sell sets"} onClose={onClose} xl>
      <Alert message={loadError || setsRes.error} />
      {product && !info && <Alert message={`${product.name} is not a grouped product`} />}
      {info && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1" aria-label="Steps">
              <span className={stepClass(step === 1)}>1 Choose combination</span>
              <span className="text-slate-300">›</span>
              <span className={stepClass(step === 2)}>2 Confirm</span>
            </div>
            <span className="text-xs text-slate-500">
              {all.length} in stock · price per set type
            </span>
          </div>

          {!setsRes.data && !setsRes.error && <p className="text-sm text-slate-500">Loading sets…</p>}

          {step === 1 && setsRes.data && (
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
              {/* What the customer wants */}
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                <div className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-36 shrink-0 text-slate-500">{info.main?.name ?? "Main"}</span>
                  <span className="text-slate-700">Always included</span>
                </div>
                {byproducts.map((b) => {
                  const w = want[b.id];
                  const pick = (variationId: string | null) => {
                    setWant((x) => ({ ...x, [b.id]: variationId === null ? null : { variationId, length: x[b.id]?.length ?? null } }));
                    setError("");
                  };
                  return (
                    <div key={b.id} className="flex flex-wrap items-start gap-3 px-3 py-2">
                      <span className="w-36 shrink-0 pt-1 text-sm text-slate-500">
                        {b.name}
                        {!b.required && <span className="text-slate-400"> (optional)</span>}
                      </span>
                      <div className="grid min-w-0 flex-1 gap-2">
                        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={b.name}>
                          {!b.required && (
                            <button type="button" role="radio" aria-checked={w === null} className={chip(w === null)} onClick={() => pick(null)}>
                              None
                            </button>
                          )}
                          {b.variations.map((v) => (
                            <button key={v.id} type="button" role="radio" aria-checked={w?.variationId === v.id} className={chip(w?.variationId === v.id)} onClick={() => pick(v.id)}>
                              {b.productType === "simple" ? "Fitted" : variationText(b, v)}
                            </button>
                          ))}
                        </div>
                        {b.productType === "measured" && w && (
                          <LengthField
                            compact
                            base={b.lengthUnit ?? "m"}
                            decimals={b.decimals ?? 3}
                            label={`${b.name} length`}
                            value={w.length}
                            preferredUnit={units.lengthUnit(b.lengthUnit ?? "m")}
                            onUnitChange={(u) => units.setLengthUnit(b.lengthUnit ?? "m", u)}
                            onChange={(length) => {
                              setWant((x) => ({ ...x, [b.id]: { variationId: x[b.id]?.variationId ?? "", length: Number.isFinite(length) ? length : null } }));
                              setError("");
                            }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
                <div className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-36 shrink-0 text-slate-500">Quantity</span>
                  <div className="inline-flex items-center rounded-lg border border-slate-300">
                    <button type="button" className="px-3 py-1 text-lg" aria-label="Fewer sets" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
                      −
                    </button>
                    <span className="min-w-8 text-center font-semibold">{quantity}</span>
                    <button type="button" className="px-3 py-1 text-lg" aria-label="More sets" onClick={() => setQuantity((q) => q + 1)}>
                      +
                    </button>
                  </div>
                </div>
              </div>

              {/* Set combinations in stock */}
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Set combinations in stock</div>
                {!all.length && <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">No {product?.name} sets in stock. You can still choose a combination and backorder it as a Customer Order.</p>}
                <ul className="grid max-h-[50vh] gap-1.5 overflow-auto pr-1">
                  {types.map((t) => {
                    const match = complete && !diffSet(links, t.plan, wanted).length;
                    const { sale: tSale, min: tMin } = typePriceOf(t.set);
                    return (
                      <li key={t.key}>
                        <button
                          type="button"
                          onClick={() => applyType(t.set)}
                          className={`w-full rounded-lg border px-2.5 py-2 text-left text-sm transition ${match ? "border-emerald-500 bg-emerald-50 ring-1 ring-emerald-500/30" : "border-slate-200 bg-white hover:border-brand-400"}`}
                          aria-label={`Use ${t.set.contents.map((c) => c.value).join(", ")}`}
                        >
                          <span className="flex items-start justify-between gap-2">
                            <span className="min-w-0">
                              {t.set.contents.length ? (
                                t.set.contents.map((c) => {
                                  const { label, displayValue, isFitted, fullTitle } = formatContentItem(c);
                                  return (
                                    <span key={c.name} className="block text-xs text-slate-600" title={fullTitle}>
                                      {isFitted ? (
                                        <span className="font-medium text-slate-800">{displayValue}</span>
                                      ) : (
                                        <>
                                          <span className="text-slate-400">{label}: </span>
                                          <span className="font-medium text-slate-800">{displayValue}</span>
                                        </>
                                      )}
                                    </span>
                                  );
                                })
                              ) : (
                                <span className="text-xs text-slate-600">Main part only</span>
                              )}
                              {(tSale > 0 || tMin > 0) && (
                                <span className="mt-1 block text-xs">
                                  <span className="font-semibold text-brand-700">{fmtSellRate(null, tMin, tSale, "Sell: ")}</span>
                                  {tMin > 0 && tMin < tSale && (
                                    <span className="ml-1 text-[11px] font-normal text-slate-500">· Min {money(tMin)}</span>
                                  )}
                                </span>
                              )}
                            </span>
                            <span className="shrink-0 text-right text-xs">
                              <span className="block font-semibold text-slate-900">
                                {t.count} set{t.count === 1 ? "" : "s"}
                              </span>
                              {match && <span className="block font-semibold text-emerald-700">Ready</span>}
                              {[...t.byWh].map(([id, n]) => (
                                <span key={id} className="block font-mono text-[11px] text-slate-500">
                                  {wh.codeOf(id)} {n}
                                </span>
                              ))}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid max-h-[60vh] gap-3 overflow-auto pr-1">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
                <div className="min-w-0">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Combination</span>
                  <p className="text-sm text-slate-800">
                    <b className="text-slate-900">{wantText || "—"}</b> × {quantity}
                  </p>
                  {(guideSalePrice > 0 || guideMinPrice > 0) && (
                    <div className="mt-1 text-xs font-semibold text-brand-700">
                      {fmtSellRate(null, guideMinPrice, guideSalePrice, "Sell: ")}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <div className="flex items-center gap-2">
                    <label htmlFor="sale-set-selling-price" className="text-xs font-semibold text-slate-700">
                      Selling price:
                    </label>
                    <div className="relative flex items-center">
                      <span className="pointer-events-none absolute left-2.5 text-sm font-semibold text-slate-400">₹</span>
                      <input autoComplete="off"
                        id="sale-set-selling-price"
                        type="text"
                        inputMode="numeric"
                        className="w-28 rounded-lg border border-slate-300 bg-white py-1.5 pl-6 pr-2.5 text-right text-sm font-bold text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        value={sellingPrice}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.]/g, "");
                          setSellingPrice(val);
                          setPerSetPrices({});
                          setError("");
                        }}
                        placeholder="0"
                      />
                      <span className="ml-1 text-xs text-slate-500">/ set</span>
                    </div>
                  </div>
                  {(guideSalePrice > 0 || guideMinPrice > 0) && (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-medium text-slate-500">Price guide:</span>
                      {guideMinPrice > 0 && (
                        <button
                          type="button"
                          className={`rounded-full border px-2.5 py-0.5 transition-colors cursor-pointer ${
                            sellingPrice === String(guideMinPrice)
                              ? "border-emerald-500 bg-emerald-50 text-emerald-800 font-medium"
                              : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                          }`}
                          onClick={() => {
                            setSellingPrice(String(guideMinPrice));
                            setPerSetPrices({});
                            setError("");
                          }}
                          title="Use minimum selling price"
                        >
                          Min {money(guideMinPrice)}
                        </button>
                      )}
                      {guideSalePrice > 0 && (
                        <button
                          type="button"
                          className={`rounded-full border px-2.5 py-0.5 transition-colors cursor-pointer ${
                            sellingPrice === String(guideSalePrice)
                              ? "border-emerald-500 bg-emerald-50 text-emerald-800 font-medium"
                              : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                          }`}
                          onClick={() => {
                            setSellingPrice(String(guideSalePrice));
                            setPerSetPrices({});
                            setError("");
                          }}
                          title="Use standard selling price"
                        >
                          Selling {money(guideSalePrice)}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {readyPicks.length > 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800">Ready</span>
                    <span className="flex-1 text-sm font-semibold text-slate-900">
                      {readyPicks.length} set{readyPicks.length === 1 ? "" : "s"} in stock with this combination
                    </span>
                    <span className="text-sm font-bold text-slate-900">
                      {priceOfSet(setById.get(readyPicks[0]!.setId) ?? null, readyPicks[0]!.setId, edits) > 0 ? (
                        <>
                          {money(priceOfSet(setById.get(readyPicks[0]!.setId) ?? null, readyPicks[0]!.setId, edits) / 100)}
                          {readyPicks.length > 1 ? " each" : ""}
                        </>
                      ) : (
                        <span className="text-xs font-normal text-slate-400">price not set</span>
                      )}
                    </span>
                  </div>
                  {wh.enabled && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {readyPicks.map((p) => {
                        const s = setById.get(p.setId);
                        return s?.warehouseId ? (
                          <span key={p.setId} className="rounded bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600">
                            {wh.codeOf(s.warehouseId)}
                          </span>
                        ) : null;
                      })}
                    </div>
                  )}
                </div>
              )}
              {madePicks.map(({ p, slot }) => {
                const s = setById.get(p.setId);
                if (!s) return null;
                const others = otherFor === slot ? alternatives(links, planSetsIn, wanted, stock, picks.map((x) => x.setId)).filter((o) => o.status === "CHANGE") : [];
                const onBackorder = p.changes.some((c) => c.backorder);
                return (
                  <div key={p.setId} className={`rounded-xl border p-3 ${onBackorder ? "border-rose-300 bg-rose-50/60" : "border-amber-200 bg-amber-50/60"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      {onBackorder ? (
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs font-semibold text-rose-800">Backorder — part to be bought</span>
                      ) : (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">Not ready — create</span>
                      )}
                      <span className="min-w-0 flex-1 text-sm font-semibold text-slate-900">From {s.name}</span>
                      {wh.enabled && s.warehouseId && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600">{wh.codeOf(s.warehouseId)}</span>}
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-slate-500">₹</span>
                        <input autoComplete="off"
                          type="text"
                          inputMode="numeric"
                          className="w-24 rounded border border-slate-300 bg-white px-2 py-0.5 text-right text-sm font-bold text-slate-900 focus:border-brand-500 focus:outline-none"
                          value={perSetPrices[p.setId] ?? sellingPrice}
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^\d.]/g, "");
                            setPerSetPrices((prev) => ({ ...prev, [p.setId]: val }));
                            setError("");
                          }}
                          placeholder={sellingPrice || "0"}
                          aria-label={`Selling price for set from ${s.name}`}
                        />
                      </div>
                    </div>
                    <ChangeList set={s} changes={p.changes} byproducts={byproducts} stock={stock} warehouseId={whOf(s)} onPiece={(bp, pieceId) => setChosenPieces((x) => ({ ...x, [s.id]: { ...(x[s.id] ?? {}), [bp]: pieceId } }))} />
                    <button type="button" className="mt-1 text-xs font-semibold text-brand-600 hover:underline" onClick={() => setOtherFor(otherFor === slot ? null : slot)}>
                      {otherFor === slot ? "Close" : "Other set…"}
                    </button>
                    {otherFor === slot && (
                      <ul className="mt-2 grid gap-1">
                        {!others.length && <li className="text-xs text-slate-500">No other set can be used.</li>}
                        {others.map((o) => (
                          <li key={o.setId}>
                            <button
                              type="button"
                              className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left text-xs hover:border-brand-400"
                              onClick={() => {
                                setPreferred((x) => ({ ...x, [slot]: o.setId }));
                                setOtherFor(null);
                              }}
                            >
                              <span className="min-w-0 flex-1 truncate">{setById.get(o.setId)?.name}</span>
                              <ChangeCount status={o} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
              {wholeBackorderPicks.map(({ p, slot }) => (
                <div key={p.setId || slot} className="rounded-xl border border-rose-300 bg-rose-50/60 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-rose-100 px-1.5 py-0.5 text-xs font-semibold text-rose-800">Backorder — Whole Combination</span>
                    <span className="min-w-0 flex-1 text-sm font-semibold text-slate-900">Set #{slot + 1}: {wantText}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-500">₹</span>
                      <input autoComplete="off"
                        type="text"
                        inputMode="numeric"
                        className="w-24 rounded border border-slate-300 bg-white px-2 py-0.5 text-right text-sm font-bold text-slate-900 focus:border-brand-500 focus:outline-none"
                        value={perSetPrices[p.setId] ?? sellingPrice}
                        onChange={(e) => {
                          const val = e.target.value.replace(/[^\d.]/g, "");
                          setPerSetPrices((prev) => ({ ...prev, [p.setId]: val }));
                          setError("");
                        }}
                        placeholder={sellingPrice || "0"}
                        aria-label={`Selling price for backordered set #${slot + 1}`}
                      />
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-rose-700">
                    Main component and by-products not in stock — will be held on a Customer Order and procured.
                  </p>
                </div>
              ))}
              {problem && !backorderPicks && (
                <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800" role="alert">
                  <div className="font-bold">
                    {picks.length ? `Only ${picks.length} of ${quantity} sets possible from stock: ` : "Shortage: "}
                    {problemText(problem!)}.
                  </div>
                  {shortPart ? (
                    <>
                      <p className="mt-0.5 text-xs text-rose-700">
                        {shortPart.measured
                          ? `${shortPart.longest ? `The longest free bundle is ${lenText(shortPart.b, shortPart.longest)}. ` : "No free bundle in stock. "}Bundles are never joined; add the set as a backorder and order a new bundle.`
                          : `Add the set as a backorder and order more ${shortPart.name}.`}
                      </p>
                      <button
                        type="button"
                        className="btn mt-2 bg-amber-600 !py-1 !text-xs text-white hover:bg-amber-700"
                        onClick={() => {
                          setBackorder(true);
                          setError("");
                        }}
                      >
                        Backorder {shortPart.name}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="mt-0.5 text-xs text-rose-700">
                        No sets or main component in stock. You can backorder the whole combination as a Customer Order and procure it.
                      </p>
                      <button
                        type="button"
                        className="btn mt-2 bg-amber-600 !py-1 !text-xs text-white hover:bg-amber-700"
                        onClick={() => {
                          setBackorder(true);
                          setError("");
                        }}
                      >
                        Backorder whole combination ({quantity - picks.length} set{quantity - picks.length === 1 ? "" : "s"})
                      </button>
                    </>
                  )}
                </div>
              )}
              {backorderPicks > 0 && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="status">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      ⚠️ Backorder: {backorderPicks} set{backorderPicks === 1 ? "" : "s"} on backorder{shortPart ? ` waiting for ${shortPart.name}` : ` (whole combination to be procured)`}.
                      {shortPart ? (shortPart.measured ? " — a new bundle must be ordered" : " — it must be ordered") : ""}.
                    </span>
                    <button type="button" className="text-xs font-semibold text-amber-800 underline" onClick={() => setBackorder(false)}>
                      Undo backorder
                    </button>
                  </div>
                  <p className="mt-0.5 text-xs text-amber-800">
                    Saved as a <b>Customer Order</b>. Use <b>Arrange purchase</b> or create a Purchase Order to buy it from a supplier.
                  </p>
                  {picks.length < quantity && <p className="mt-1 text-xs font-semibold text-rose-700">Only {picks.length} of {quantity} sets possible: no more sets in stock to use.</p>}
                </div>
              )}
            </div>
          )}
        </>
      )}
      <div className="mt-3">
        <Alert message={error} />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-3">
        <span className="text-sm text-slate-600">
          {step === 1 ? (
            complete ? (
              <>
                {readyCount} ready in stock{readyCount < quantity ? ` · ${quantity - readyCount} to create` : ""}
              </>
            ) : (
              "Choose the combination"
            )
          ) : total > 0 ? (
            <>
              {picks.length} of {quantity} set{quantity === 1 ? "" : "s"} · <b>{money(total / 100)}</b>
            </>
          ) : (
            <span className="text-xs text-slate-500">Enter a selling price to see the total</span>
          )}
        </span>
        <div className="flex gap-2">
          {step === 2 ? (
            <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
              Back
            </button>
          ) : (
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
          )}
          {step === 1 ? (
            <button type="button" className="btn-primary" onClick={next} disabled={!info || !complete}>
              Next
            </button>
          ) : (
            <button type="button" className={backorderPicks ? "btn bg-amber-600 text-white hover:bg-amber-700" : "btn-primary"} onClick={confirm} disabled={!picks.length}>
              {backorderPicks
                ? `Confirm backorder · ${initial?.length ? "update" : "add"} ${picks.length} set${picks.length === 1 ? "" : "s"}`
                : `${madePicks.length ? `Create ${madePicks.length} and ` : ""}${initial?.length ? (madePicks.length ? "update" : "Update sets") : madePicks.length ? "add to sale" : "Add to sale"}`}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ChangeCount({ status }: { status: SetStatus }) {
  const n = status.status === "CHANGE" ? status.changes.length : 0;
  return <span className="shrink-0 text-slate-500">{n} change{n === 1 ? "" : "s"}</span>;
}

/** The planned changes of one set, with bundle cards for every chain cut. */
function ChangeList({
  set,
  changes,
  byproducts,
  stock,
  warehouseId,
  onPiece,
}: {
  set: GroupSet;
  changes: PlanChange[];
  byproducts: Byproduct[];
  stock: PlanStock;
  warehouseId: string | null;
  onPiece: (byproductId: string, pieceId: string) => void;
}) {
  return (
    <ul className="mt-2 grid gap-2 text-sm text-slate-700">
      {changes.map((c) => {
        const b = byproducts.find((x) => x.id === c.byproductId)!;
        const old = set.parts.find((p) => p.role === "BY" && p.byproductId === c.byproductId);
        const v = b.variations.find((x) => x.id === c.variationId);
        const now = v ? (b.productType === "measured" ? `${variationText(b, v)} ${lenText(b, c.lengthMilli ?? 0)}` : b.productType === "simple" ? "" : variationText(b, v)) : "";
        const text =
          c.shortenInPlace
            ? `Shorten fitted ${b.name} ${old?.value ?? ""} → ${now} (cut in place, leaves ${lenText(b, (c.from?.lengthMilli ?? 0) - (c.lengthMilli ?? 0))} cut piece in stock)`
            : c.action === "REMOVE"
            ? `Remove ${b.name} ${old?.value ?? ""} — back to free stock`
            : c.action === "ADD"
              ? `Add ${b.name}${now ? ` ${now}` : ""}`
              : `${b.name} ${old?.value ?? ""} → ${now}${b.productType === "measured" ? " — old one back to free stock as a cut piece" : " — old one back to free stock"}`;
        return (
          <li key={c.byproductId}>
            <span>· {text}</span>
            {c.backorder ? (
              <p className="mt-1 rounded border border-rose-300 bg-rose-100/70 px-2 py-1 text-xs font-semibold text-rose-800">
                Backorder: no free {b.productType === "measured" ? `bundle has ${lenText(b, c.lengthMilli ?? 0)}` : "stock"} — fitted at delivery after the {b.productType === "measured" ? "new bundle" : "stock"} is bought.
              </p>
            ) : b.productType === "measured" && c.action !== "REMOVE" && c.variationId && !c.shortenInPlace && (
              <BundleCards
                b={b}
                list={stock.pieces.filter((p) => p.variationId === c.variationId && (!warehouseId || p.warehouseId === warehouseId))}
                needMilli={c.lengthMilli ?? 0}
                selected={c.pieceId ?? ""}
                onPick={(id) => onPiece(c.byproductId, id)}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Free bundles of a chain as cards (like the measured drawer): kind, length left, what a cut leaves. */
function BundleCards({
  b,
  list,
  needMilli,
  selected,
  onPick,
}: {
  b: Byproduct;
  list: { id: string; kind: FreePiece["kind"]; remainingMilli: number }[];
  needMilli: number;
  selected: string;
  onPick: (id: string) => void;
}) {
  const sorted = [...list].sort((x, y) => KIND_ORDER[x.kind] - KIND_ORDER[y.kind] || x.remainingMilli - y.remainingMilli);
  if (!sorted.length) return <p className="mt-1 text-xs text-rose-600">No free bundle of this size.</p>;
  return (
    <div className="mt-1.5">
      {needMilli > 0 && <div className="mb-1 text-xs text-slate-500">Cut {lenText(b, needMilli)} from:</div>}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5" role="radiogroup" aria-label={`${b.name} bundle`}>
        {sorted.map((p) => {
          const fits = p.remainingMilli >= needMilli;
          const on = p.id === selected;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!fits}
              onClick={() => onPick(p.id)}
              className={`rounded-lg border px-2 py-1.5 text-left text-xs ${on ? "border-brand-600 bg-white ring-2 ring-brand-500/30" : fits ? "border-slate-300 bg-white hover:border-brand-400" : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400"}`}
            >
              <span className="block font-semibold">{KIND_TEXT[p.kind]}</span>
              <span className="block">
                {lenText(b, p.remainingMilli)} left{fits && needMilli > 0 ? ` · leaves ${lenText(b, p.remainingMilli - needMilli)}` : !fits ? " · too short" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}


