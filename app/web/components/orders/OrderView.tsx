"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { newLineId, useCart, type CartLine, type CartLink, type CartMeasure, type CartRoll, type SaleSetPick } from "@/components/CartContext";
import { PurchaseSetsModal } from "@/components/sets/PurchaseSetsModal";
import type { SetBody } from "@/components/sets/SetSheet";
import { contentsText } from "@/components/sets/SetContents";
import { useCan } from "@/components/MeContext";
import { ProductThumb } from "@/components/ProductThumb";
import { DeliveryDatePicker, Modal, PageHeader, TableSkeleton } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { dateTime, formatVariationAttributesString, money } from "@/lib/format";
import { errorText, useApi } from "@/lib/useApi";
import { metaOf } from "@/lib/measure";
import type { GroupSet, LineSplit, Product, ProductType } from "@/lib/types";
import { splitTotal, useWarehouses } from "@/lib/useWarehouses";
import { SplitChips, TakeFromPopup } from "@/components/cart/TakeFromPopup";
import { ORDER_STATUS, STEPS, StatusPill, orderDay, type OrderKind, type OrderStatus } from "./orderStatus";

interface OrderLine {
  id: string;
  lineNo: number;
  variationId: string;
  productId: string;
  productName: string;
  shortName: string;
  attributes: Record<string, string>;
  attributeUnits?: Record<string, string>;
  unit: string;
  /** The unit the price is per: "ft" on a feet + inches line priced per foot (0028). */
  rateUnit?: string;
  imageUrl: string | null;
  active: boolean;
  quantity: number;
  fulfilledQuantity: number;
  outstandingQuantity: number;
  price: string;
  discount: string;
  note: string | null;
  lineTotal: string;
  available: number;
  shortage: number;
  currentPrice: string | null;
  pieceId?: string | null;
  piece?: { id: string; code: string; kind: string } | null;
  rolls?: CartRoll[] | null;
  measure?: CartMeasure | null;
  /** V3.1 (WH-13): sale-order Take-from split saved with the line; null = decide at delivery. */
  splits?: LineSplit[] | null;
  productType?: ProductType;
  /** V3.1 set lines (0037): purchase order — sets expected; sale order — picks + the held sets. */
  sets?: SetBody[] | null;
  saleSets?: SaleSetPick[] | null;
  heldSets?: GroupSet[] | null;
  /** Purchase-order line bought for a customer order's shortage. */
  linked?: CartLink | null;
}

interface Order {
  id: string;
  number: string;
  kind: OrderKind;
  status: OrderStatus;
  orderDate: string;
  expectedDate: string | null;
  partyId: string | null;
  partyName: string | null;
  /** V3.1 (WH-13): purchase order preferred warehouse. */
  warehouseId?: string | null;
  deliveryAddress: string | null;
  deliveryNote: string | null;
  notes: string | null;
  total: string;
  gross: string;
  discount: string;
  cancelReason: string | null;
  version: number;
  createdBy: string | null;
  createdAt: string;
  document: { id: string; number: string; cancelled: boolean } | null;
  documents: OrderDocument[];
  lines: OrderLine[];
  events: { id: string; from: OrderStatus | null; to: OrderStatus; note: string | null; at: string; by: string | null }[];
}

interface OrderDocument {
  id: string;
  number: string;
  total: string;
  paymentMode: string | null;
  paymentStatus: "PAID" | "PARTIAL" | "PENDING" | null;
  amountPaid: string | null;
  at: string;
  cancelled: boolean;
  voidKind: "CANCELLED" | "REPLACED" | null;
}

const PAYMENT_STATUS: Record<string, string> = { PAID: "Paid", PARTIAL: "Part paid", PENDING: "Unpaid" };

interface Shortage { variationId: string; name: string; shortName: string; available: number; requested: number; canOversell: boolean }

interface LineShortageReport {
  lineNo: number;
  orderLineId: string;
  productId: string;
  variationId: string;
  name: string;
  unit: string;
  productType: string;
  /** V3.1: a by-product backordered for this set line ("Chain Hoist"); null = the line itself. */
  forSet: string | null;
  orderedQuantity: number;
  fulfilledQuantity: number;
  outstandingQuantity: number;
  physicalStock: number;
  allocatedQuantity: number;
  availableToPromise: number;
  shortageQuantity: number;
  coveredByPOQuantity: number;
  uncoveredShortageQuantity: number;
  canFulfillContinuous: boolean;
  status: "IN_STOCK" | "SHORTAGE" | "PURCHASE_PENDING" | "PARTIALLY_COVERED" | "READY_TO_FULFILL" | "PARTIALLY_FULFILLED" | "FULFILLED" | "CANCELLED";
  linkedPOs: {
    id: string;
    number: string;
    status: string;
    quantity: number;
    expectedDate: string | null;
    supplierName: string | null;
  }[];
}

const PAYMENT_MODES = [
  { v: "", t: "Not recorded" },
  { v: "CASH", t: "Cash" },
  { v: "UPI", t: "UPI" },
  { v: "BANK_TRANSFER", t: "Bank transfer" },
  { v: "CHEQUE", t: "Cheque" },
  { v: "CREDIT", t: "Credit (pay later)" },
] as const;

type Dialog = null | "complete" | "dispatch" | "cancel" | "details" | "reopen" | "back";

/**
 * One sale / purchase order (docs/orders/ORDER-LIFECYCLE-PLAN.md §6.3): status stepper, items with
 * live stock, delivery details, timeline, and the actions the current status allows.
 */
export function OrderView({ kind, id }: { kind: OrderKind; id: string }) {
  const router = useRouter();
  const cart = useCart();
  const isSale = kind === "SALE";
  const mode = isSale ? "sale" : "purchase";
  const base = isSale ? "/sales/orders" : "/purchases/orders";
  const canWork = useCan(isSale ? "sale.create" : "purchase.create");
  const canVoid = useCan(isSale ? "sale.void" : "purchase.void");
  const canPurchase = useCan("purchase.create");
  const { data, error, reload } = useApi<{ order: Order }>(`/orders/${id}`);
  const shortagesReport = useApi<{ shortages: LineShortageReport[] }>(isSale ? `/orders/${id}/shortages` : null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  // Dialog fields
  const [note, setNote] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [reason, setReason] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [shortages, setShortages] = useState<Shortage[] | null>(null);
  // Set when a sale cannot be completed from stock (no roll long enough / not enough on hand).
  const [stockBlocked, setStockBlocked] = useState(false);
  // Quantity to deliver / receive now, by order line id (defaults to what is outstanding).
  const [fulfilNow, setFulfilNow] = useState<Record<string, string>>({});
  // V3.1 (WH-13): Take-from split chosen for this delivery, by order line id; purchase "Receive into".
  const wh = useWarehouses();
  const [splitsNow, setSplitsNow] = useState<Record<string, LineSplit[] | null>>({});
  const [splitting, setSplitting] = useState<OrderLine | null>(null);
  // V3.1: purchase-order set lines — the sets typed for this receipt, by order line id.
  const [setsNow, setSetsNow] = useState<Record<string, SetBody[]>>({});
  const [enteringSets, setEnteringSets] = useState<OrderLine | null>(null);
  const [receiveInto, setReceiveInto] = useState("");
  const [details, setDetails] = useState({ expectedDate: "", deliveryAddress: "", deliveryNote: "", notes: "" });

  // The list's "Complete" button links here with ?complete=1.
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("complete") === "1") setDialog("complete");
  }, []);

  const o = data?.order;
  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!o) return <TableSkeleton rows={6} />;

  const open = o.status === "DRAFT" || o.status === "PLACED" || o.status === "ON_DELIVERY" || o.status === "PARTIALLY_FULFILLED";
  const completable = o.status === "PLACED" || o.status === "ON_DELIVERY" || o.status === "PARTIALLY_FULFILLED";
  const anyFulfilled = o.lines.some((l) => l.fulfilledQuantity > 0);
  const pendingLines = o.lines.filter((l) => l.outstandingQuantity > 0);
  // V3.1 set lines: a sale order delivers its held sets together (API: WHOLE_SETS); a purchase
  // order receives the sets entered on it together, or the sets typed at receipt.
  const isSets = (l: OrderLine) => l.productType === "grouped";
  const setsOnOrder = (l: OrderLine) => !isSale && isSets(l) && !!l.sets?.length && l.fulfilledQuantity === 0;
  const setsTyped = (l: OrderLine) => !isSale && isSets(l) && !setsOnOrder(l);
  // Measured purchase lines list their rolls; they are received together (API: WHOLE_ROLLS).
  const wholeOnly = (l: OrderLine) => (!isSale && !!l.measure) || (isSale && isSets(l)) || setsOnOrder(l);
  const qtyNow = (l: OrderLine) => {
    if (setsTyped(l)) return Math.min(setsNow[l.id]?.length ?? 0, l.outstandingQuantity);
    const raw = fulfilNow[l.id];
    const n = raw === undefined ? l.outstandingQuantity : Number(raw);
    return Number.isFinite(n) ? Math.min(Math.max(n, 0), l.outstandingQuantity) : 0;
  };
  const nowLines = pendingLines.filter((l) => qtyNow(l) > 0);
  // The split used for a line now: chosen in this dialog, else the saved one when this delivery
  // takes the whole line (the API applies the same rule), else none (automatic pick).
  const splitFor = (l: OrderLine): LineSplit[] | undefined => {
    if (!wh.enabled || !isSale || l.measure || isSets(l)) return undefined;
    const chosen = splitsNow[l.id];
    if (chosen !== undefined) return chosen && splitTotal(chosen) === qtyNow(l) ? chosen : undefined;
    return l.splits && l.fulfilledQuantity === 0 && qtyNow(l) === l.quantity ? l.splits : undefined;
  };
  // Estimate shown in the dialog; the server computes the exact amount (discount shared pro rata).
  const nowTotal = nowLines.reduce((t, l) => t + (Number(l.lineTotal) * qtyNow(l)) / l.quantity, 0);
  const isPartial = nowLines.length !== pendingLines.length || nowLines.some((l) => qtyNow(l) < l.outstandingQuantity);
  const editable = o.status === "DRAFT" || o.status === "PLACED";
  const canCancel = open && (o.status === "DRAFT" ? canWork : canVoid);
  const shortLines = o.lines.filter((l) => l.shortage > 0);

  function openDialog(d: Dialog) {
    setActionError("");
    setNote("");
    setReason("");
    setShortages(null);
    setStockBlocked(false);
    if (d === "dispatch") setDeliveryNote(o!.deliveryNote ?? "");
    if (d === "complete") {
      setFulfilNow({});
      setSplitsNow({});
      setSetsNow({});
      setReceiveInto(o!.warehouseId ?? "");
      setPaymentMode("");
      setAmountPaid("");
    }
    if (d === "details") setDetails({ expectedDate: o!.expectedDate ?? "", deliveryAddress: o!.deliveryAddress ?? "", deliveryNote: o!.deliveryNote ?? "", notes: o!.notes ?? "" });
    setDialog(d);
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError("");
    try {
      await fn();
      setDialog(null);
      await reload();
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const move = (to: OrderStatus, extra: Record<string, unknown> = {}) =>
    run(() => api(`/orders/${o.id}/status`, { method: "POST", body: { to, note: note.trim() || null, version: o.version, ...extra } }));

  async function complete(allowNegative = false) {
    setBusy(true);
    setActionError("");
    setStockBlocked(false);
    try {
      const res = await api<{ documentId: string }>(`/orders/${o!.id}/fulfill`, {
        method: "POST",
        body: {
          version: o!.version,
          lines: nowLines.map((l) => {
            const typed = splitsNow[l.id];
            if (setsTyped(l)) return { orderLineId: l.id, sets: (setsNow[l.id] ?? []).map(({ rate: _, ...s }) => s) };
            return { orderLineId: l.id, quantity: qtyNow(l), ...(typed && splitTotal(typed) === qtyNow(l) ? { splits: typed } : {}) };
          }),
          ...(!isSale && wh.enabled && receiveInto ? { warehouseId: receiveInto } : {}),
          ...(paymentMode ? { paymentMode } : {}),
          ...(paymentMode && amountPaid.trim() ? { amountPaid: amountPaid.trim() } : {}),
          ...(allowNegative ? { allowNegative: true } : {}),
        },
      });
      setDialog(null);
      await reload();
      router.push(`/${isSale ? "sales" : "purchases"}/${res.documentId}`);
    } catch (e) {
      setStockBlocked(isSale && e instanceof ApiError && (e.code === "INSUFFICIENT_STOCK" || e.code === "NO_PIECE_LONG_ENOUGH"));
      if (e instanceof ApiError && e.code === "INSUFFICIENT_STOCK" && Array.isArray(e.details)) setShortages(e.details as Shortage[]);
      else setActionError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  // Rows still to buy: measured / counted shortages (a set line's backordered by-products are rows
  // of their own) not yet covered by a purchase order.
  const toBuy = (shortagesReport.data?.shortages ?? []).filter((s) => s.productType !== "grouped" && s.uncoveredShortageQuantity > 0 && s.status !== "CANCELLED");

  /**
   * Arrange purchase (owner 2026-10-24): the shortages go into the purchase cart as normal lines —
   * a measured one as a bundle (the product's usual bundle length, never shorter than the length
   * needed, as bundles are never joined) — linked to this order. The full purchase flow follows:
   * supplier, rates, more items, then "Save as order" (linked purchase order) or complete.
   */
  async function arrangeInCart() {
    if (!toBuy.length) return setActionError("Nothing left to buy: every shortage is covered by a purchase order.");
    if (cart.lines.length && !confirm(`The ${cart.mode ?? ""} cart has ${cart.lines.length} item(s). Replace them with the items to buy for ${o!.number}? Hold the cart first to keep it.`)) return;
    setBusy(true);
    setActionError("");
    try {
      const products = new Map<string, Product>();
      for (const id of new Set(toBuy.map((s) => s.productId))) products.set(id, (await api<{ product: Product }>(`/products/${id}`)).product);
      const lines: CartLine[] = [];
      for (const s of toBuy) {
        const p = products.get(s.productId);
        const v = p?.variations.find((x) => x.id === s.variationId);
        if (!p || !v) continue;
        const base = {
          variationId: v.id,
          productId: p.id,
          productName: p.name,
          shortName: v.shortName,
          attributes: v.attributes as Record<string, string>,
          unit: p.unit,
          imageUrl: v.imageUrl ?? p.imageUrl,
          price: String(Math.round(Number(v.purchaseCost) || 0)),
          available: 0,
          note: s.forSet ? `For ${o!.number} (${s.forSet} sets)` : `For ${o!.number}`,
          linked: { orderId: o!.id, orderLineId: s.orderLineId, orderNumber: o!.number },
        };
        if (p.productType === "measured") {
          const usual = v.defaultRollLength ?? p.measure?.defaultRollLength ?? 0;
          const length = Math.max(usual, s.uncoveredShortageQuantity);
          lines.push({ ...base, lineId: newLineId(), quantity: length, measure: { ...metaOf({ ...(p.measure ?? {}), lengthUnit: p.measure?.lengthUnit ?? "m" }), rolls: [{ length }] } });
        } else {
          // A counted item is one line per purchase order.
          const same = lines.find((l) => !l.measure && l.variationId === v.id);
          if (same) same.quantity += Math.ceil(s.uncoveredShortageQuantity);
          else lines.push({ ...base, quantity: Math.ceil(s.uncoveredShortageQuantity) });
        }
      }
      cart.loadLines("purchase", lines, null);
      router.push("/purchases/checkout");
    } catch (e) {
      setActionError(errorText(e));
      setBusy(false);
    }
  }

  function editItems() {
    if (cart.lines.length && !(cart.order?.id === o!.id)) {
      if (!confirm(`The ${cart.mode ?? ""} cart has ${cart.lines.length} item(s). Replace them with the items of ${o!.number}? Hold the cart first to keep it.`)) return;
    }
    const lines: CartLine[] = o!.lines
      .filter((l) => l.active)
      .map((l) => ({
        lineId: l.measure || isSets(l) ? newLineId() : undefined,
        // V3.1 set lines keep their sets: a sale order's held picks, a purchase order's sets.
        ...(isSale && l.saleSets?.length
          ? { saleSets: l.saleSets.map((p) => ({ ...p, code: l.heldSets?.find((s) => s.id === p.setId)?.code })), setSummaries: l.saleSets.map((p) => l.heldSets?.find((s) => s.id === p.setId)?.name ?? ""), setDetails: l.saleSets.map((p) => { const s = l.heldSets?.find((x) => x.id === p.setId); return { rows: s?.contents ?? [], ...(s?.warehouseId && wh.enabled ? { note: wh.codeOf(s.warehouseId) } : {}) }; }) }
          : {}),
        ...(!isSale && l.sets?.length ? { sets: l.sets.map((s) => ({ parts: s.parts, notes: s.notes ?? null, ...(s.warehouseId ? { warehouseId: s.warehouseId } : {}) })), setSummaries: l.sets.map((_, i) => `Set ${i + 1} as entered`) } : {}),
        variationId: l.variationId,
        productId: l.productId,
        productName: l.productName,
        shortName: l.shortName,
        attributes: l.attributes ?? {},
        attributeUnits: l.attributeUnits,
        unit: l.unit,
        imageUrl: l.imageUrl,
        price: String(Math.round(Number(l.price))),
        quantity: l.quantity,
        available: l.available,
        discount: Number(l.discount) ? String(Math.round(Number(l.discount))) : "",
        note: l.note ?? "",
        ...(l.splits?.length ? { splits: l.splits } : {}),
        ...(l.linked ? { linked: l.linked } : {}),
        ...(l.measure
          ? {
              measure: {
                ...l.measure,
                pieceId: l.pieceId ?? l.piece?.id ?? l.measure.pieceId ?? null,
                pieceCode: l.piece?.code ?? l.measure.pieceCode ?? null,
                pieceKind: (l.piece?.kind as any) ?? l.measure.pieceKind ?? null,
                rolls: l.rolls ?? l.measure.rolls ?? undefined,
              },
            }
          : {}),
      }));
    cart.loadOrder(mode, { id: o!.id, number: o!.number, version: o!.version }, lines, o!.partyId && o!.partyName ? { id: o!.partyId, name: o!.partyName } : null);
    router.push(isSale ? "/sales/checkout" : "/purchases/checkout");
  }

  const steps = STEPS.filter((s) => s !== "PARTIALLY_FULFILLED" || anyFulfilled);
  const stepIndex = steps.indexOf(o.status);

  return (
    <div className="mx-auto grid max-w-5xl gap-5">
      <PageHeader
        back={{ href: base, label: isSale ? "Sale Orders" : "Purchase Orders" }}
        title={o.number}
        badge={<StatusPill status={o.status} />}
        subtitle={`${isSale ? "Sale" : "Purchase"} order · ${orderDay(o.orderDate)}${o.createdBy ? ` · by ${o.createdBy}` : ""}`}
        actions={
          canWork && open ? (
            <div className="flex flex-wrap gap-2">
              {editable && <button className="btn-secondary" onClick={editItems}>Edit items</button>}
              <button className="btn-secondary" onClick={() => openDialog("details")}>Edit details</button>
              {o.status === "DRAFT" && <button className="btn-primary" disabled={busy} onClick={() => move("PLACED")}>Place order</button>}
              {o.status === "PLACED" && <button className="btn-secondary" onClick={() => openDialog("dispatch")}>{isSale ? "Mark on delivery" : "Mark in transit"}</button>}
              {o.status === "PARTIALLY_FULFILLED" && <button className="btn-secondary" onClick={() => openDialog("dispatch")}>{isSale ? "Mark on delivery" : "Mark in transit"}</button>}
              {isSale && open && canPurchase && toBuy.length > 0 && (
                <button className="btn bg-violet-700 text-white hover:bg-violet-800" disabled={busy} onClick={() => void arrangeInCart()}>
                  Arrange purchase
                </button>
              )}
              {completable && (
                <button className="btn bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => openDialog("complete")}>
                  {isSale ? (anyFulfilled ? "Deliver rest" : "Complete sale") : anyFulfilled ? "Receive rest" : "Receive & complete"}
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      {/* Stepper */}
      {o.status !== "CANCELLED" ? (
        <ol className="card flex items-center gap-2 overflow-x-auto p-4" aria-label="Order progress">
          {steps.map((s, i) => {
            const done = i < stepIndex || o.status === "COMPLETED";
            const current = i === stepIndex && o.status !== "COMPLETED";
            return (
              <li key={s} className="flex min-w-0 flex-1 items-center gap-2" aria-current={current ? "step" : undefined}>
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${done ? "bg-emerald-600 text-white" : current ? `ring-2 ring-offset-1 ${ORDER_STATUS[s].pill} ring-current` : "bg-slate-100 text-slate-400"}`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className={`whitespace-nowrap text-sm ${current ? "font-semibold text-slate-900" : done ? "text-slate-700" : "text-slate-400"}`}>{ORDER_STATUS[s].label}</span>
                {i < steps.length - 1 && <span className={`h-0.5 min-w-[1rem] flex-1 rounded ${i < stepIndex || o.status === "COMPLETED" ? "bg-emerald-500" : "bg-slate-200"}`} aria-hidden />}
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="status">
          <b>Cancelled.</b> {o.cancelReason}
        </div>
      )}

      {o.documents.length > 0 && (
        <section className="card p-4 text-sm">
          <h2 className="mb-2 font-semibold text-slate-900">{isSale ? "Deliveries (sales)" : "Receipts (purchases)"} &amp; payment</h2>
          <ul className="grid gap-1.5">
            {o.documents.map((d) => (
              <li key={d.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${d.voidKind === "REPLACED" ? "text-slate-400 line-through" : d.cancelled ? "text-rose-700" : "text-slate-700"}`}>
                <Link className="font-semibold underline" href={`/${isSale ? "sales" : "purchases"}/${d.id}`}>{d.number}</Link>
                <span className="text-slate-500">{dateTime(d.at)}</span>
                <span className="font-medium">{money(d.total)}</span>
                {d.voidKind === "REPLACED" ? (
                  <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600 no-underline">Edited (replaced by a revision)</span>
                ) : d.cancelled ? (
                  <span className="rounded bg-rose-100 px-1.5 text-xs">Cancelled (stock reversed)</span>
                ) : (
                  <span className={`rounded px-1.5 text-xs ${d.paymentStatus === "PAID" ? "bg-emerald-100 text-emerald-800" : d.paymentStatus ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
                    {d.paymentStatus
                      ? `${PAYMENT_STATUS[d.paymentStatus]}${d.amountPaid !== null ? ` ${money(d.amountPaid)}` : ""}${d.paymentMode ? ` · ${PAYMENT_MODES.find((m) => m.v === d.paymentMode)?.t ?? d.paymentMode}` : ""}`
                      : "Payment not recorded"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {open && isSale && shortLines.length > 0 && !shortagesReport.data && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
          {shortLines.length} item(s) are short right now. Orders do not reserve stock; completing checks stock again.
        </p>
      )}

      {/* Shortage & Procurement Tracking Card */}
      {isSale && shortagesReport.data?.shortages && shortagesReport.data.shortages.some((s) => s.status !== "IN_STOCK" && s.status !== "FULFILLED") && (
        <section className="card p-4 border-amber-200 bg-amber-50/40">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span>📦 Shortage &amp; Procurement Tracking</span>
              </h2>
              <p className="text-xs text-slate-600">
                Lengths no bundle has, set parts on backorder, and the purchase orders bought for them. Stock is never made negative.
              </p>
            </div>
            {open && canPurchase && toBuy.length > 0 && (
              <button
                type="button"
                className="btn bg-violet-700 text-white text-xs px-3 py-1.5 hover:bg-violet-800 shadow-sm"
                disabled={busy}
                onClick={() => void arrangeInCart()}
              >
                + Arrange purchase (purchase cart)
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded border border-amber-200 bg-white">
            <table className="table-stack w-full text-left text-xs">
              <thead className="bg-amber-100/60 text-slate-700 font-semibold border-b border-amber-200">
                <tr>
                  <th className="p-2.5">Line / Item</th>
                  <th className="p-2.5 text-right">Needed</th>
                  <th className="p-2.5 text-right">Fulfilled</th>
                  <th className="p-2.5 text-right">Physical Stock</th>
                  <th className="p-2.5 text-right">Available (ATP)</th>
                  <th className="p-2.5 text-right">Shortage</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">Procurement / Linked POs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {shortagesReport.data.shortages.map((s) => (
                  <tr key={`${s.lineNo}-${s.variationId}`} className={s.shortageQuantity > 0 ? (s.forSet ? "bg-rose-50/50" : "bg-amber-50/30") : ""}>
                    <td className="p-2.5 font-medium text-slate-900">
                      {s.forSet ? (
                        <span className="pl-3">
                          ↳ {s.name} <span className="rounded bg-rose-100 px-1 text-[10px] font-semibold text-rose-800">Backorder · part of {s.forSet} sets</span>
                        </span>
                      ) : (
                        <>Line {s.lineNo}: {s.name}</>
                      )}
                    </td>
                    <td className="p-2.5 text-right whitespace-nowrap font-semibold">
                      {s.orderedQuantity} {s.unit}
                    </td>
                    <td className="p-2.5 text-right whitespace-nowrap text-slate-600">
                      {s.fulfilledQuantity} {s.unit}
                    </td>
                    <td className="p-2.5 text-right whitespace-nowrap text-slate-600">
                      {s.physicalStock} {s.unit}
                    </td>
                    <td className="p-2.5 text-right whitespace-nowrap text-slate-600">
                      {s.availableToPromise} {s.unit}
                    </td>
                    <td className="p-2.5 text-right whitespace-nowrap font-bold text-rose-600">
                      {s.shortageQuantity > 0 ? `${s.shortageQuantity} ${s.unit}` : "—"}
                    </td>
                    <td className="p-2.5 whitespace-nowrap">
                      {s.status === "READY_TO_FULFILL" && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                          ✓ Ready to fulfill
                        </span>
                      )}
                      {s.status === "PURCHASE_PENDING" && (
                        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                          ⏳ Purchase pending ({s.coveredByPOQuantity} {s.unit})
                        </span>
                      )}
                      {s.status === "PARTIALLY_COVERED" && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          Partially covered ({s.coveredByPOQuantity} / {s.shortageQuantity} {s.unit})
                        </span>
                      )}
                      {s.status === "SHORTAGE" && (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800">
                          ⚠️ Shortage: PO required
                        </span>
                      )}
                      {s.status === "PARTIALLY_FULFILLED" && (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-semibold text-indigo-800">
                          Partially fulfilled
                        </span>
                      )}
                      {s.status === "FULFILLED" && (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                          Fulfilled
                        </span>
                      )}
                      {s.status === "IN_STOCK" && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                          In stock
                        </span>
                      )}
                    </td>
                    <td className="p-2.5">
                      {s.linkedPOs.length === 0 ? (
                        <span className="text-slate-400 italic">No PO created yet</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {s.linkedPOs.map((po) => (
                            <Link
                              key={po.id}
                              href={`/purchases/orders/${po.id}`}
                              className="rounded border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-800 hover:bg-sky-100 hover:underline"
                            >
                              {po.number} ({po.quantity} {s.unit} · {po.status})
                            </Link>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {actionError && !dialog && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{actionError}</p>}

      <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
        <section className="card overflow-x-auto lg:overflow-x-visible">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Rate</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {o.lines.map((l) => (
                <tr key={l.lineNo}>
                  <td>
                    <div className="flex items-start gap-2.5">
                      <ProductThumb src={l.imageUrl} name={l.productName} className="h-9 w-9 shrink-0 rounded-md text-[6px]" />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900">{l.productName} {!isSets(l) && <span className="text-slate-500">{l.shortName}</span>}</div>
                        <div className="text-xs text-slate-500">{formatVariationAttributesString(l.attributes, l.attributeUnits)}</div>
                        {l.note && <div className="text-xs italic text-slate-500">{l.note}</div>}
                        {l.piece?.code && (
                          <div className="text-xs text-slate-600">
                            Preferred piece: <span className="font-medium">{l.piece.kind === "CUT" ? "cut piece" : `${l.piece.kind.toLowerCase()} roll`}</span>
                          </div>
                        )}
                        {l.rolls && l.rolls.length > 0 && (
                          <div className="text-xs text-slate-600">
                            {l.rolls.length} {l.rolls.length === 1 ? "roll" : "rolls"}: {l.rolls.map((r) => `${r.length} ${l.unit}`).join(", ")}
                          </div>
                        )}
                        {/* V3.1 set lines: the sets held for this order / expected on it */}
                        {!!l.heldSets?.length && (
                          <ul className="mt-0.5 text-xs text-slate-600">
                            {l.heldSets.map((s) => {
                              const planned = l.saleSets?.find((p) => p.setId === s.id)?.changes?.length ?? 0;
                              return (
                                <li key={s.id}>
                                  <span className="rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-700">Held</span> {s.contents ? contentsText(s.contents) : s.name}
                                  {planned > 0 && <span className="text-slate-500"> · {planned} part change{planned === 1 ? "" : "s"} at delivery</span>}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        {!isSale && isSets(l) && (
                          <div className="text-xs text-slate-600">{l.sets?.length ? `${l.sets.length} set${l.sets.length === 1 ? "" : "s"} entered on the order` : "Sets are entered when received"}</div>
                        )}
                        {isSale && wh.enabled && !l.measure && !isSets(l) && (
                          <div className="mt-0.5">
                            <SplitChips splits={l.splits ?? undefined} emptyLabel="Take from: decide at delivery" />
                          </div>
                        )}
                        <div className="mt-0.5 flex flex-wrap gap-1 text-[11px]">
                          {!l.active && <span className="rounded bg-rose-100 px-1.5 text-rose-700">Archived item</span>}
                          {open && isSale && (
                            <span className={`rounded px-1.5 ${l.shortage ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
                              {l.available} on hand{l.shortage ? ` · short ${l.shortage}` : ""}
                            </span>
                          )}
                          {open && l.currentPrice && l.currentPrice !== l.price && !isSets(l) && (
                            <span className="rounded bg-sky-50 px-1.5 text-sky-800" title="Current catalog price">Now {money(l.currentPrice)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {l.quantity} {l.unit}
                    {l.fulfilledQuantity > 0 && (
                      <div className="text-xs text-slate-500">
                        {isSale ? "delivered" : "received"} {l.fulfilledQuantity}
                        {l.outstandingQuantity > 0 ? ` · ${l.outstandingQuantity} to go` : ""}
                      </div>
                    )}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {money(l.price)}
                    {l.rateUnit && l.rateUnit !== l.unit ? ` / ${l.rateUnit}` : ""}
                  </td>
                  <td className="text-right font-semibold">
                    {money(l.lineTotal)}
                    {Number(l.discount) > 0 && <div className="text-xs font-normal text-slate-500">− {money(l.discount)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {Number(o.discount) > 0 && (
                <tr>
                  <td colSpan={3} className="text-right text-sm text-slate-500">Gross {money(o.gross)} − discount</td>
                  <td className="text-right text-sm text-slate-500">{money(o.discount)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={3} className="text-right font-semibold">Total</td>
                <td className="text-right text-lg font-bold">{money(o.total)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <aside className="grid content-start gap-4">
          <section className="card grid gap-2 p-4 text-sm">
            <h2 className="font-semibold text-slate-900">{isSale ? "Customer & delivery" : "Supplier & receipt"}</h2>
            <Info label={isSale ? "Customer" : "Supplier"} value={o.partyName ?? (isSale ? "Walk-in" : "—")} />
            <Info label={isSale ? "Deliver by" : "Expected by"} value={o.expectedDate ? orderDay(`${o.expectedDate}T00:00:00+05:30`) : "—"} />
            <Info label={isSale ? "Delivery address" : "Deliver to"} value={o.deliveryAddress ?? "—"} />
            <Info label="Vehicle / transport" value={o.deliveryNote ?? "—"} />
            {!isSale && wh.enabled && (
              <Info label="Receive into" value={o.warehouseId ? `${wh.codeOf(o.warehouseId)} ${wh.byId.get(o.warehouseId)?.name ?? ""}` : `Default (${wh.codeOf(wh.defaultWarehouse?.id)})`} />
            )}
            <Info label="Notes" value={o.notes ?? "—"} />
          </section>

          <section className="card p-4 text-sm">
            <h2 className="mb-2 font-semibold text-slate-900">Timeline</h2>
            <ol className="grid gap-3 border-l border-slate-200 pl-4">
              {o.events.map((e) => (
                <li key={e.id} className="relative">
                  <span className={`absolute -left-[1.3rem] top-1 h-2.5 w-2.5 rounded-full ${ORDER_STATUS[e.to].dot}`} aria-hidden />
                  <div className="font-medium text-slate-800">{e.from ? `${ORDER_STATUS[e.from].label} → ${ORDER_STATUS[e.to].label}` : `Created as ${ORDER_STATUS[e.to].label.toLowerCase()}`}</div>
                  <div className="text-xs text-slate-500">{dateTime(e.at)}{e.by ? ` · ${e.by}` : ""}</div>
                  {e.note && <div className="text-xs text-slate-600">{e.note}</div>}
                </li>
              ))}
            </ol>
          </section>

          {canWork && open && (
            <section className="grid gap-2">
              {o.status === "PLACED" && <button className="btn-secondary text-sm" onClick={() => openDialog("reopen")}>Reopen as draft</button>}
              {o.status === "ON_DELIVERY" && (
                <button className="btn-secondary text-sm" onClick={() => openDialog("back")}>{anyFulfilled ? "Back to partially fulfilled" : "Back to placed (not delivered)"}</button>
              )}
              {canCancel && <button className="btn-secondary text-sm text-rose-700 hover:bg-rose-50" onClick={() => openDialog("cancel")}>Cancel order</button>}
            </section>
          )}
        </aside>
      </div>

      {/* Dispatch */}
      <Modal open={dialog === "dispatch"} title={`${isSale ? "Mark on delivery" : "Mark in transit"} — ${o.number}`} onClose={() => setDialog(null)}>
        <div className="grid gap-3">
          <div>
            <label className="label" htmlFor="dn">Vehicle / transporter / tracking</label>
            <input autoComplete="off" id="dn" className="input" maxLength={300} placeholder="e.g. Tempo MH12 AB 1234, driver Ramesh" value={deliveryNote} onChange={(e) => setDeliveryNote(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="mv-note">Note (optional)</label>
            <input autoComplete="off" id="mv-note" className="input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <p className="text-xs text-slate-500">Items can no longer be changed while the order is {isSale ? "on delivery" : "in transit"}. Stock moves when you complete it.</p>
          <DialogError message={actionError} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setDialog(null)}>Close</button>
            <button className="btn-primary" disabled={busy} onClick={() => move("ON_DELIVERY", { deliveryNote: deliveryNote.trim() || null })}>{busy ? "Saving…" : "Confirm"}</button>
          </div>
        </div>
      </Modal>

      {/* Reopen / back to placed */}
      <Modal open={dialog === "reopen" || dialog === "back"} title={dialog === "reopen" ? `Reopen ${o.number} as draft` : `Move ${o.number} back to ${anyFulfilled ? "partially fulfilled" : "placed"}`} onClose={() => setDialog(null)}>
        <div className="grid gap-3">
          <div>
            <label className="label" htmlFor="mv-note2">{dialog === "back" ? "What happened?" : "Reason (optional)"}</label>
            <input autoComplete="off" id="mv-note2" className="input" maxLength={300} placeholder={dialog === "back" ? "e.g. customer not available, returned to shop" : ""} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogError message={actionError} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setDialog(null)}>Close</button>
            <button className="btn-primary" disabled={busy} onClick={() => move(dialog === "reopen" ? "DRAFT" : anyFulfilled ? "PARTIALLY_FULFILLED" : "PLACED")}>{busy ? "Saving…" : "Confirm"}</button>
          </div>
        </div>
      </Modal>

      {/* Cancel */}
      <Modal open={dialog === "cancel"} title={`Cancel ${o.number}`} onClose={() => setDialog(null)}>
        <div className="grid gap-3">
          <p className="text-sm text-slate-600">
            {anyFulfilled
              ? `The rest of the order is cancelled. What was already ${isSale ? "delivered" : "received"} stays as its own ${isSale ? "sale" : "purchase"}; cancel that document separately if needed.`
              : "The order stays on record as cancelled. No stock has moved, so nothing is reversed."}
          </p>
          <div>
            <label className="label" htmlFor="cancel-reason">Reason</label>
            <input autoComplete="off" id="cancel-reason" className="input" maxLength={300} placeholder="e.g. customer cancelled" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogError message={actionError} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setDialog(null)}>Keep order</button>
            <button className="btn bg-rose-700 text-white hover:bg-rose-800" disabled={busy || reason.trim().length < 3} onClick={() => run(() => api(`/orders/${o.id}/cancel`, { method: "POST", body: { reason: reason.trim(), version: o.version } }))}>
              {busy ? "Cancelling…" : "Cancel order"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit details */}
      <Modal open={dialog === "details"} title={`Details — ${o.number}`} onClose={() => setDialog(null)}>
        <div className="grid gap-3">
          {editable && (
            <div>
              <label className="label" htmlFor="d-exp">{isSale ? "Deliver by" : "Expected by"}</label>
              <DeliveryDatePicker
                id="d-exp"
                value={details.expectedDate}
                onChange={(val) => setDetails({ ...details, expectedDate: val })}
              />
            </div>
          )}
          <div>
            <label className="label" htmlFor="d-addr">{isSale ? "Delivery address" : "Deliver to"}</label>
            <input autoComplete="off" id="d-addr" className="input" maxLength={300} value={details.deliveryAddress} onChange={(e) => setDetails({ ...details, deliveryAddress: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="d-dn">Vehicle / transport</label>
            <input autoComplete="off" id="d-dn" className="input" maxLength={300} value={details.deliveryNote} onChange={(e) => setDetails({ ...details, deliveryNote: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="d-notes">Notes</label>
            <textarea id="d-notes" className="input min-h-[3rem]" maxLength={500} value={details.notes} onChange={(e) => setDetails({ ...details, notes: e.target.value })} />
          </div>
          <DialogError message={actionError} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setDialog(null)}>Close</button>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                run(() =>
                  api(`/orders/${o.id}`, {
                    method: "PUT",
                    body: {
                      ...(editable ? { expectedDate: details.expectedDate || null } : {}),
                      deliveryAddress: details.deliveryAddress,
                      deliveryNote: details.deliveryNote,
                      notes: details.notes,
                      version: o.version,
                    },
                  }),
                )
              }
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Modal>

      {splitting && (
        <TakeFromPopup
          title={`${splitting.productName} ${splitting.shortName}`}
          unit={splitting.unit}
          quantity={qtyNow(splitting)}
          productId={splitting.productId}
          variationId={splitting.variationId}
          initial={splitFor(splitting)}
          laterLabel="Pick automatically"
          onConfirm={(splits) => {
            setSplitsNow({ ...splitsNow, [splitting.id]: splits ?? null });
            setSplitting(null);
          }}
          onClose={() => setSplitting(null)}
        />
      )}

      {/* Complete */}
      <Modal open={dialog === "complete"} title={`${isSale ? "Complete sale" : "Receive & complete"} — ${o.number}`} onClose={() => setDialog(null)}>
        <div className="grid gap-3">
          <div className="overflow-x-auto">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">To go</th>
                  <th className="text-right">{isSale ? "Deliver now" : "Receive now"}</th>
                </tr>
              </thead>
              <tbody>
                {pendingLines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.productName} {!isSets(l) && <span className="text-slate-500">{l.shortName}</span>}
                    </td>
                    <td className="text-right whitespace-nowrap">{l.outstandingQuantity} {l.unit}</td>
                    <td className="text-right">
                      {setsTyped(l) ? (
                        <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => setEnteringSets(l)}>
                          {setsNow[l.id]?.length ? `${setsNow[l.id]!.length} set${setsNow[l.id]!.length === 1 ? "" : "s"} · edit` : "Enter sets received"}
                        </button>
                      ) : wholeOnly(l) ? (
                        <label className="inline-flex items-center gap-1.5 text-xs">
                          <input type="checkbox" checked={qtyNow(l) > 0} onChange={(e) => setFulfilNow({ ...fulfilNow, [l.id]: e.target.checked ? String(l.outstandingQuantity) : "0" })} />
                          {isSets(l) ? "all sets" : "all rolls"}
                        </label>
                      ) : (
                        <input autoComplete="off"
                          className="input !w-24 text-right"
                          inputMode="decimal"
                          aria-label={`${isSale ? "Deliver" : "Receive"} now: ${l.productName} ${l.shortName}`}
                          value={fulfilNow[l.id] ?? String(l.outstandingQuantity)}
                          onChange={(e) => setFulfilNow({ ...fulfilNow, [l.id]: e.target.value.replace(l.measure ? /[^\d.]/g : /[^\d]/g, "") })}
                        />
                      )}
                      {isSale && wh.enabled && !l.measure && !isSets(l) && qtyNow(l) > 0 && (
                        <div className="mt-1">
                          <SplitChips splits={splitFor(l)} onClick={() => setSplitting(l)} emptyLabel="Auto: default warehouse first" />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!isSale && wh.enabled && (
            <div className="flex flex-wrap items-center gap-2">
              <label className="label !mb-0" htmlFor="c-receive">Receive into</label>
              <select id="c-receive" className="input w-auto" value={receiveInto} onChange={(e) => setReceiveInto(e.target.value)}>
                <option value="">{`Default (${wh.codeOf(wh.defaultWarehouse?.id)})`}</option>
                {wh.active.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.code} · {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p className="text-sm text-slate-600">
            Creates a {isSale ? "sale" : "purchase"} for about {money(nowTotal.toFixed(2))} and {isSale ? "takes these items out of" : "adds these items to"} stock now.
            {isPartial ? " The rest stays open on the order (Partially fulfilled)." : " The order is then completed."}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="c-mode">Payment mode</label>
              <select id="c-mode" className="input" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                {PAYMENT_MODES.map((m) => <option key={m.v} value={m.v}>{m.t}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="c-paid">Amount paid ₹</label>
              <input autoComplete="off"
                id="c-paid"
                className="input"
                inputMode="numeric"
                disabled={!paymentMode}
                placeholder={!paymentMode ? "Choose a payment mode" : paymentMode === "CREDIT" ? "0 (pay later)" : "Empty = paid in full"}
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
          </div>
          {shortages && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm" role="alert">
              <p className="font-semibold text-rose-800">Not enough recorded stock</p>
              <ul className="mt-1 list-disc pl-5 text-rose-800">
                {shortages.map((s) => (
                  <li key={s.variationId}>{s.name} {s.shortName}: selling {s.requested}, {s.available} on hand (balance would be {s.available - s.requested})</li>
                ))}
              </ul>
              {shortages.every((s) => s.canOversell) ? (
                <div className="mt-2 flex gap-2">
                  <button className="btn bg-rose-700 text-white hover:bg-rose-800" disabled={busy} onClick={() => { setShortages(null); void complete(true); }}>Sell anyway</button>
                  <button className="btn-secondary" onClick={() => setShortages(null)}>Go back</button>
                </div>
              ) : (
                <p className="mt-2 text-rose-900">You cannot confirm this sale with your account. Reduce the quantity (Edit items) or ask an administrator.</p>
              )}
            </div>
          )}
          <DialogError message={actionError} />
          <div className="flex flex-wrap justify-end gap-2">
            {stockBlocked && canPurchase && (
              <button className="btn mr-auto bg-violet-700 text-white hover:bg-violet-800" disabled={busy || !toBuy.length} onClick={() => void arrangeInCart()}>
                Arrange purchase
              </button>
            )}
            <button className="btn-secondary" onClick={() => setDialog(null)}>Close</button>
            <button className="btn bg-emerald-600 text-white hover:bg-emerald-700" disabled={busy || nowLines.length === 0} onClick={() => complete()}>
              {busy ? "Saving…" : isPartial ? (isSale ? "Deliver these" : "Receive these") : "Complete"}
            </button>
          </div>
        </div>
      </Modal>

      {/* V3.1: sets received on a purchase-order line — rendered after the Complete dialog so it sits on top of it */}
      {enteringSets && (
        <PurchaseSetsModal
          productId={enteringSets.productId}
          initial={(setsNow[enteringSets.id] ?? []).map((s) => ({ ...s, rate: String(Math.round(Number(enteringSets.price))) }))}
          defaultRate={String(Math.round(Number(enteringSets.price)))}
          pickWarehouse
          onClose={() => setEnteringSets(null)}
          onConfirm={(cartLines) => {
            // The order line has one rate: every set received on it takes that rate.
            const sets = cartLines.flatMap((c) => (c.sets ?? []).map((s) => ({ ...s, rate: String(Math.round(Number(enteringSets.price))) })));
            setSetsNow({ ...setsNow, [enteringSets.id]: sets.slice(0, enteringSets.outstandingQuantity) });
            setEnteringSets(null);
          }}
        />
      )}

    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="whitespace-pre-line text-slate-800">{value}</div>
    </div>
  );
}

function DialogError({ message }: { message: string }) {
  return message ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{message}</p> : null;
}
