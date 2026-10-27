"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMe } from "@/components/MeContext";
import { ratePerOf } from "@rs-v31/shared/measure";
import type { MeasureMeta, PieceKind } from "@/lib/measure";
import type { LineSplit, SetDetail } from "@/lib/types";
import { useWarehouses } from "@/lib/useWarehouses";
import { loadFreeStock, TakeFromPopup } from "@/components/cart/TakeFromPopup";

/** Adds two splits warehouse by warehouse (merging cart lines of one item). */
function mergeSplits(a: LineSplit[] | undefined, b: LineSplit[] | undefined): LineSplit[] | undefined {
  if (!a || !b) return undefined;
  const m = new Map<string, number>();
  for (const s of [...a, ...b]) m.set(s.warehouseId, (m.get(s.warehouseId) ?? 0) + Math.round(s.quantity * 1000));
  return [...m].map(([warehouseId, q]) => ({ warehouseId, quantity: q / 1000 }));
}

// Sale/purchase cart (GAS script_versions/07: openDrawerFor, commitFromDrawer, updateCartCounts).
// The cart is only a draft: the server re-reads products, prices, stock and totals on submit.
//
// V2 (plan §3.4): the active cart auto-saves to localStorage under the signed-in user, so it
// survives a closed tab and is never shown to the next person who signs in on this browser
// (fixes V1 B12). A cart resumed from a held draft remembers the draft, so saving or checking
// out updates / completes that same draft. Lines carry an optional flat discount and a note.
//
// Measured lines (V2 plan §2.7–2.8): quantity is a length in the product's base unit. A sale line
// names the piece to cut (one piece per line, never joined), so two lines of one variation are
// kept apart instead of merged; a purchase line carries one entry per roll and its quantity is
// the sum of the rolls.

export type CartMode = "sale" | "purchase";

export interface CartParty {
  mode: CartMode;
  id: string;
  name: string;
}

/** One roll on a measured purchase line (W12). Length in base units. */
export interface CartRoll {
  length: number;
  supplierRollNo?: string;
  rack?: string;
  /** V3.1: the warehouse this roll goes to; default = the cart's "Receive into". */
  warehouseId?: string;
}

export interface CartMeasure extends MeasureMeta {
  /** Sale: the piece chosen in the drawer (the server re-plans and may answer PIECE_CHANGED). */
  pieceId?: string | null;
  pieceCode?: string | null;
  pieceKind?: PieceKind | null;
  /** Sale: answer to the scrap prompt (DM-7). */
  writeOffLeftover?: boolean;
  /** Purchase: the rolls received. */
  rolls?: CartRoll[];
  /** Customer shortage / backorder line requiring procurement */
  isShortage?: boolean;
}

export interface CartLine {
  /** Measured lines: a key of their own (lines of one variation are never merged). */
  lineId?: string;
  variationId: string;
  productId: string;
  productName: string;
  shortName: string;
  attributes: Record<string, string>;
  attributeUnits?: Record<string, string>;
  unit: string;
  imageUrl: string | null;
  /** Rupees as typed, e.g. "450". */
  price: string;
  quantity: number;
  /** Stock when the line was added (for warnings only). */
  available: number;
  /** V2: flat discount on the line in rupees ("" = none). */
  discount?: string;
  /** V2: short note printed on the line. */
  note?: string;
  /** Measured products only. */
  measure?: CartMeasure;
  /**
   * V3.1 grouped purchase line: the sets bought, all at this line's price (sets at another rate
   * are another line). quantity = sets.length; `summaries` are their contents for display.
   */
  sets?: { parts: { byproductId: string; variationId: string; length?: number }[]; notes: string | null; warehouseId?: string }[];
  setSummaries?: string[];
  /** Each set's contents part by part (shown in place of `setSummaries`; older carts have none). */
  setDetails?: SetDetail[];
  /** V3.1 grouped sale line: the sets picked from stock with their part changes (quantity = picks). */
  saleSets?: SaleSetPick[];
  /**
   * V3.1 warehouses, counted lines (WH-5, WH-6): how much comes from (sale) / goes to (purchase)
   * each warehouse. Omitted: sale = picked automatically (default first), purchase = "Receive into".
   */
  splits?: LineSplit[];
  /** Purchase line bought for a customer order's shortage (Arrange purchase); saved on the purchase order. */
  linked?: CartLink;
}

/** The customer-order line a purchase line is bought for. */
export interface CartLink {
  orderId: string;
  orderLineId: string;
  orderNumber: string;
}

/** One set picked on a sale line and the part changes made to it (plan §5.2). */
export interface SaleSetPick {
  setId: string;
  version?: number;
  /** Display only. */
  code?: string;
  /**
   * backorder: no free stock has the new part now — the set can only be held on a customer order,
   * and the part is fitted at delivery from the bundle / stock bought for it.
   */
  changes?: { byproductId: string; action: "REPLACE" | "ADD" | "REMOVE"; variationId?: string; pieceId?: string | null; length?: number; backorder?: boolean }[];
}

/** V3.1: a grouped sale line with a by-product on backorder (customer order only). */
export const hasSetBackorder = (l: Pick<CartLine, "saleSets">) => !!l.saleSets?.some((p) => p.changes?.some((c) => c.backorder));

/** V3.1: a line of whole sets (purchase: sets entered; sale: sets picked). */
export const isSetLine = (l: Pick<CartLine, "sets" | "saleSets">) => !!(l.sets || l.saleSets);

/** Stable React key / identity of a cart line. */
export const lineKey = (l: Pick<CartLine, "lineId" | "variationId">) => l.lineId ?? l.variationId;

/** The held draft this cart was resumed from (or last saved as). */
export interface CartDraft {
  id: string;
  title: string;
  version: number;
}

/** V2 orders: the sale / purchase order whose items are being edited in this cart. */
export interface CartOrder {
  id: string;
  number: string;
  version: number;
}

/** V2 document edits: the sale / purchase being replaced in this cart. */
export interface CartEditing {
  documentId: string;
  number: string;
  revision: number;
  occurredAt?: string;
  notes?: string | null;
  paymentMode?: string | null;
  amountPaid?: string | null;
}

interface CartState {
  mode: CartMode | null;
  lines: CartLine[];
  clientRef: string;
  party: CartParty | null;
  draft: CartDraft | null;
  order: CartOrder | null;
  editing: CartEditing | null;
  /** V3.1: purchase "Receive into" warehouse (null = the default warehouse). */
  warehouseId?: string | null;
}

interface CartApi extends CartState {
  /** V3.1: a counted line's warehouse split (undefined = automatic / "Receive into"). */
  setSplits: (index: number, splits: LineSplit[] | undefined) => void;
  setWarehouse: (warehouseId: string | null) => void;
  count: number;
  totalPaise: number;
  /** Adds or merges a line; returns an error message when the other cart is in use. */
  add: (mode: CartMode, line: CartLine) => string | null;
  setParty: (mode: CartMode, party: Omit<CartParty, "mode"> | null) => void;
  replace: (index: number, line: CartLine) => void;
  setQuantity: (index: number, quantity: number) => void;
  /** Discount / note / price edits on one line. */
  patchLine: (index: number, patch: Partial<Pick<CartLine, "discount" | "note" | "price">>) => void;
  remove: (index: number) => void;
  clear: () => void;
  /** Replace (or append to) the cart with a resumed draft. */
  loadDraft: (mode: CartMode, draft: CartDraft, lines: CartLine[], party: Omit<CartParty, "mode"> | null, how: "replace" | "append") => void;
  setDraft: (draft: CartDraft | null) => void;
  /** Replace the cart with an order's items for editing; the checkout then saves the order. */
  loadOrder: (mode: CartMode, order: CartOrder, lines: CartLine[], party: Omit<CartParty, "mode"> | null) => void;
  /** Replace the cart with new lines (Arrange purchase: a customer order's shortages). */
  loadLines: (mode: CartMode, lines: CartLine[], party: Omit<CartParty, "mode"> | null) => void;
  /** Replace the cart with a document's items for editing; checkout then saves a new revision. */
  loadDocument: (mode: CartMode, editing: CartEditing, lines: CartLine[], party: Omit<CartParty, "mode"> | null) => void;
  setEditing: (editing: CartEditing | null) => void;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
}

function safeRandomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const keyFor = (userId: string | undefined) => (userId ? `rs.v2.cart:${userId}` : null);
const fresh = (): CartState => ({ mode: null, lines: [], clientRef: safeRandomUUID(), party: null, draft: null, order: null, editing: null });

function load(key: string | null): CartState {
  if (!key) return fresh();
  try {
    // One-time clean-up of the V1-style, user-less session cart (B12).
    sessionStorage.removeItem("rs.v2.cart");
    const raw = localStorage.getItem(key);
    if (raw) {
      const s = JSON.parse(raw) as Partial<CartState>;
      if (Array.isArray(s.lines) && typeof s.clientRef === "string") {
        const party =
          s.party &&
          (s.party.mode === "sale" || s.party.mode === "purchase") &&
          typeof s.party.id === "string" &&
          typeof s.party.name === "string"
            ? s.party
            : null;
        const draft = s.draft && typeof s.draft.id === "string" && typeof s.draft.title === "string" ? s.draft : null;
        const order = s.order && typeof s.order.id === "string" && typeof s.order.number === "string" && typeof s.order.version === "number" ? s.order : null;
        const editing =
          s.editing &&
          typeof s.editing.documentId === "string" &&
          typeof s.editing.number === "string" &&
          typeof s.editing.revision === "number"
            ? s.editing
            : null;
        return {
          mode: s.mode === "sale" || s.mode === "purchase" ? s.mode : null,
          lines: s.lines,
          clientRef: s.clientRef,
          party,
          draft,
          order,
          editing,
          warehouseId: typeof s.warehouseId === "string" ? s.warehouseId : null,
        };
      }
    }
  } catch {
    /* storage unavailable: start empty */
  }
  return fresh();
}

/** Whole paise for a typed rupee amount; invalid input counts as 0 (the server validates). */
export function paise(price: string | undefined): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec((price ?? "").trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : 0;
}

/** Line amount after its discount, in paise (never below 0). */
export function linePaise(l: Pick<CartLine, "quantity" | "price" | "discount" | "measure">): number {
  return Math.max(0, grossPaise(l) - paise(l.discount));
}

/**
 * Quantity × price in paise. A fractional length is rounded half-up to the whole rupee, as the
 * server does (owner decision: no paise on measured lines; shared lineAmountRupees). A Measured
 * line's price is per its rate unit (per ft on a feet + inches product, lengths in inches).
 */
export function grossPaise(l: Pick<CartLine, "quantity" | "price"> & { measure?: Pick<MeasureMeta, "lengthUnit"> | null }, ratePer = ratePerOf(l.measure?.lengthUnit)): number {
  const p = paise(l.price);
  if (ratePer === 1 && Number.isInteger(l.quantity)) return l.quantity * p;
  const div = 100_000 * ratePer;
  return Math.floor((Math.round(l.quantity * 1000) * p + div / 2) / div) * 100;
}

export const newLineId = () => safeRandomUUID();

const Ctx = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const userId = useMe()?.user.id;
  const key = keyFor(userId);
  const [state, setState] = useState<CartState>(() => (typeof window === "undefined" ? fresh() : load(key)));
  const [loadedKey, setLoadedKey] = useState(key);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // A different user on this browser gets their own cart, never the previous user's.
  useEffect(() => {
    if (key !== loadedKey) {
      setState(load(key));
      setLoadedKey(key);
    }
  }, [key, loadedKey]);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleDrawer = useCallback(() => setDrawerOpen((v) => !v), []);

  useEffect(() => {
    if (!key || key !== loadedKey) return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  }, [state, key, loadedKey]);

  const put = useCallback((mode: CartMode, line: CartLine) => {
    setState((s) => {
      if (line.measure || isSetLine(line)) return { ...s, mode, lines: [...s.lines, { ...line, lineId: line.lineId ?? safeRandomUUID() }] };
      const i = s.lines.findIndex((l) => !l.measure && l.variationId === line.variationId);
      const lines = [...s.lines];
      if (i >= 0) lines[i] = { ...lines[i]!, ...line, quantity: lines[i]!.quantity + line.quantity, splits: mergeSplits(lines[i]!.splits, line.splits) };
      else lines.push(line);
      return { ...s, mode, lines };
    });
  }, []);

  // V3.1 (WH-6): a counted sale line asks where it comes from when 2+ warehouses hold it; with one,
  // it is taken from there ("from W1"). Warehousing off: added as before.
  const wh = useWarehouses();
  const [takeFrom, setTakeFrom] = useState<{ mode: CartMode; line: CartLine } | null>(null);
  const add = useCallback(
    (mode: CartMode, line: CartLine): string | null => {
      if (state.lines.length && state.mode && state.mode !== mode) {
        return state.mode === "sale"
          ? "You have items in the Sale cart. Complete or clear the sale before adding purchase items."
          : "You have items in the Purchase cart. Complete or clear the purchase before starting a sale.";
      }
      if (mode === "sale" && wh.enabled && !line.measure && !isSetLine(line) && !line.splits) {
        loadFreeStock(line.productId, line.variationId).then(
          (free) => {
            if (free.length >= 2) setTakeFrom({ mode, line });
            else put(mode, free.length === 1 ? { ...line, splits: [{ warehouseId: free[0]!.warehouseId, quantity: line.quantity }] } : line);
          },
          () => put(mode, line),
        );
        return null;
      }
      put(mode, line);
      return null;
    },
    [state.lines.length, state.mode, wh.enabled, put],
  );

  const api = useMemo<CartApi>(
    () => ({
      ...state,
      count: state.lines.length,
      totalPaise: state.lines.reduce((t, l) => t + linePaise(l), 0),
      add,
      setParty: (mode, party) => setState((s) => ({ ...s, party: party ? { ...party, mode } : null })),
      replace: (index, line) => setState((s) => ({ ...s, lines: s.lines.map((l, i) => (i === index ? { ...l, ...line } : l)) })),
      // A one-warehouse split follows the new quantity; a split over several no longer adds up and
      // is dropped (the line shows "Auto" and the Take-from popup can set it again).
      setQuantity: (index, quantity) =>
        setState((s) => ({
          ...s,
          lines: s.lines.map((l, i) => {
            if (i !== index || l.measure || isSetLine(l)) return l;
            const q = Math.max(1, Math.floor(quantity));
            const splits = l.splits?.length === 1 ? [{ ...l.splits[0]!, quantity: q }] : undefined;
            return { ...l, quantity: q, splits };
          }),
        })),
      setSplits: (index, splits) => setState((s) => ({ ...s, lines: s.lines.map((l, i) => (i === index ? { ...l, splits } : l)) })),
      setWarehouse: (warehouseId) => setState((s) => ({ ...s, warehouseId })),
      patchLine: (index, patch) => setState((s) => ({ ...s, lines: s.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) })),
      remove: (index) =>
        setState((s) => {
          const lines = s.lines.filter((_, i) => i !== index);
          return {
            ...s,
            lines,
            mode: lines.length ? s.mode : null,
            draft: lines.length ? s.draft : null,
            order: lines.length ? s.order : null,
            editing: lines.length ? s.editing : null,
          };
        }),
      // A new key per checkout, so the next document is not mistaken for a repeat.
      clear: () => setState(fresh()),
      loadDraft: (mode, draft, lines, party, how) =>
        setState((s) => {
          if (how === "append" && s.mode === mode) {
            const merged = [...s.lines];
            for (const l of lines) {
              const i = l.measure || isSetLine(l) ? -1 : merged.findIndex((x) => !x.measure && !isSetLine(x) && x.variationId === l.variationId);
              if (i >= 0) merged[i] = { ...merged[i]!, quantity: merged[i]!.quantity + l.quantity };
              else merged.push(l);
            }
            return { ...s, lines: merged };
          }
          return { ...fresh(), mode, lines, party: party ? { ...party, mode } : null, draft };
        }),
      setDraft: (draft) => setState((s) => ({ ...s, draft })),
      loadOrder: (mode, order, lines, party) => setState({ ...fresh(), mode, lines, party: party ? { ...party, mode } : null, order }),
      loadLines: (mode, lines, party) => setState({ ...fresh(), mode, lines, party: party ? { ...party, mode } : null }),
      loadDocument: (mode, editing, lines, party) => setState({ ...fresh(), mode, lines, party: party ? { ...party, mode } : null, editing }),
      setEditing: (editing) => setState((s) => ({ ...s, editing })),
      drawerOpen,
      openDrawer,
      closeDrawer,
      toggleDrawer,
    }),
    [state, add, drawerOpen, openDrawer, closeDrawer, toggleDrawer],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      {takeFrom && (
        <TakeFromPopup
          title={`${takeFrom.line.productName} ${takeFrom.line.shortName}`}
          unit={takeFrom.line.unit}
          quantity={takeFrom.line.quantity}
          productId={takeFrom.line.productId}
          variationId={takeFrom.line.variationId}
          onConfirm={(splits) => {
            put(takeFrom.mode, { ...takeFrom.line, splits });
            setTakeFrom(null);
          }}
          onClose={() => setTakeFrom(null)}
        />
      )}
    </Ctx.Provider>
  );
}

export function useCart(): CartApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}
