"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { grossPaise, hasSetBackorder, isSetLine, lineKey, linePaise, paise, useCart, type CartLine, type CartMode } from "@/components/CartContext";
import { LineFlags } from "@/components/cart/LineFlags";
import { Combobox } from "@/components/Combobox";
import { DraftsButton } from "@/components/DraftsDrawer";
import { PlusIcon } from "@/components/icons";
import { useCan, useMe } from "@/components/MeContext";
import { PartyModal, type Party } from "@/components/PartyModal";
import { CreditScoreBadge } from "@/components/CreditScoreBadge";
import { ProductDrawer } from "@/components/ProductDrawer";
import { ProductThumb } from "@/components/ProductThumb";
import { PurchaseSetsModal } from "@/components/sets/PurchaseSetsModal";
import { SaleSetsModal } from "@/components/sets/SaleSetsModal";
import { SetDetailsList } from "@/components/sets/SetContents";
import { DeliveryDatePicker, PageHeader } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { formatAttributeValue, money } from "@/lib/format";
import { fmtLen, kindPhrase, rateLabel } from "@/lib/measure";
import type { StockProduct } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { useSupplierRates } from "@/lib/useSupplierRates";
import { useWarehouses } from "@/lib/useWarehouses";
import { SplitChips, TakeFromPopup } from "@/components/cart/TakeFromPopup";

// GAS script_versions/07 renderSalesCart + submitSales / checkoutPOFromCart, submitted as one
// server transaction. Customer/supplier is optional (D1): "Normal" = walk-in, "Regular" = saved party.
//
// V2 additions (plan §3.1, §3.3, §3.4, §4.3):
//   * per-line flat discount and note; payment mode and amount paid (information only, V3 does ledgers)
//   * shortage banner; any seller may explicitly confirm "Sell anyway" under the fixed Warn & Allow policy
//   * "Hold cart" parks the cart as a server draft; a resumed draft is completed by this checkout
//   * purchases: supplier rate suggestions per line (click to use) — never applied automatically
//   * orders (docs/orders/ORDER-LIFECYCLE-PLAN.md): "Save as order" creates a Draft or Placed sale /
//     purchase order instead of completing now; a cart loaded from an order ("Edit items") saves
//     the order back instead of completing it. The direct "Complete Sale" path is unchanged.
//   * measured lines (plan §2.7–2.8, W13/W16/W17): a length and the piece to cut, or the rolls
//     received; the server re-plans and a changed piece (409 PIECE_CHANGED) can be re-planned here

const PAYMENT_MODES = [
  { v: "", t: "Not recorded" },
  { v: "CASH", t: "Cash" },
  { v: "UPI", t: "UPI" },
  { v: "BANK_TRANSFER", t: "Bank transfer" },
  { v: "CHEQUE", t: "Cheque" },
  { v: "CREDIT", t: "Credit (pay later)" },
] as const;

interface Shortage { variationId: string; name: string; shortName: string; available: number; requested: number; canOversell: boolean }
interface PieceProblem { key: string; code: string; name: string; length: number; longest: number; unit: string }

export function Checkout({ mode }: { mode: CartMode }) {
  const router = useRouter();
  const cart = useCart();
  const me = useMe();
  const isSale = mode === "sale";
  const lines = cart.mode === mode ? cart.lines : [];
  // Set (grouped) items never show a short name (owner, 2026-10-22).
  const setVariation = (variationId: string) => lines.some((l) => l.variationId === variationId && isSetLine(l));
  const initialParty = cart.party?.mode === mode ? cart.party : null;
  const isWalkIn = initialParty?.id === "walk-in";

  const [regular, setRegular] = useState(isSale ? !isWalkIn && !!initialParty : true);
  const [partyId, setPartyId] = useState<string | null>(isWalkIn ? null : initialParty?.id ?? null);
  const [selectedPartyName, setSelectedPartyName] = useState<string | null>(isWalkIn ? null : initialParty?.name ?? null);
  const [showPartyModal, setShowPartyModal] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ index: number; line: CartLine; product: StockProduct } | null>(null);
  const [editingSets, setEditingSets] = useState<number | null>(null);
  const [openExtras, setOpenExtras] = useState<Record<string, boolean>>({});
  const [paymentMode, setPaymentMode] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [shortages, setShortages] = useState<Shortage[] | null>(null);
  const [holding, setHolding] = useState(false);
  const [holdTitle, setHoldTitle] = useState("");
  const [flash, setFlash] = useState("");
  const [ordering, setOrdering] = useState(false);
  const [orderStatus, setOrderStatus] = useState<"DRAFT" | "PLACED">("PLACED");
  const [expectedDate, setExpectedDate] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const editingOrder = cart.order && cart.mode === mode ? cart.order : null;
  const editingDoc = cart.editing && cart.mode === mode ? cart.editing : null;
  const [editReason, setEditReason] = useState("");
  const [showEditPreview, setShowEditPreview] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{
    originalNumber: string;
    newNumber: string;
    revision: number;
    lines: {
      variationId: string;
      productName: string;
      shortName: string;
      unit: string;
      change: "added" | "removed" | "changed" | "same";
      before?: { quantity: number; price: string; discount: string; lineTotal: string };
      after?: { quantity: number; price: string; discount: string; lineTotal: string };
    }[];
    totals: {
      before: { subtotal: string; total: string };
      after: { subtotal: string; total: string };
    };
    stock: {
      variationId: string;
      productName: string;
      shortName: string;
      unit: string;
      delta: number;
      currentBalance: number;
      afterBalance: number;
      belowZero: boolean;
    }[];
    hasStockWarning: boolean;
  } | null>(null);

  const ordersBase = isSale ? "/sales/orders" : "/purchases/orders";
  // V3.1 warehouses: purchase "Receive into" (cart.warehouseId) and per-line splits (WH-5, WH-6).
  const wh = useWarehouses();
  const [splitting, setSplitting] = useState<number | null>(null);
  const receiveInto = cart.warehouseId && wh.byId.get(cart.warehouseId)?.active ? cart.warehouseId : (wh.defaultWarehouse?.id ?? null);
  const headerWarehouse = !isSale && wh.enabled && receiveInto ? { warehouseId: receiveInto } : {};
  const [pieceProblems, setPieceProblems] = useState<{ code: string; message: string; lines: PieceProblem[] } | null>(null);

  // Prefill edit notes & payment info from document being edited
  useEffect(() => {
    if (editingDoc) {
      if (editingDoc.notes && !notes) setNotes(editingDoc.notes);
      if (editingDoc.paymentMode && !paymentMode) setPaymentMode(editingDoc.paymentMode);
      if (editingDoc.amountPaid && !amountPaid) setAmountPaid(editingDoc.amountPaid);
    }
  }, [editingDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  const parties = useApi<{ parties: Party[] }>(regular ? `/parties?role=${isSale ? "customer" : "supplier"}` : null);
  const settings = useApi<{ canOversell: boolean }>(isSale ? "/company/settings" : null);
  const variationIds = isSale ? [] : lines.map((l) => l.variationId);
  const { suggestions } = useSupplierRates(variationIds, partyId);
  const label = isSale ? "customer" : "supplier";

  // Permission to create party:
  // Customers can be created by any role (including sales_staff).
  // Suppliers can only be created by admin or sales_manager.
  const canAddParty = useCan("party.create") && (isSale || me?.user.role !== "sales_staff");

  async function handlePartySaved(party: Party) {
    setShowPartyModal(false);
    setSelectedPartyName(party.name);
    setRegular(true);
    setPartyId(party.id);
    cart.setParty(mode, { id: party.id, name: party.name });
    await parties.reload();
  }

  async function openEdit(index: number) {
    const line = lines[index]!;
    // V3.1 grouped purchase line: edit its sets in the set sheet.
    if (isSetLine(line)) {
      setEditingSets(index);
      return;
    }
    try {
      const { product } = await api<{ product: StockProduct }>(`/inventory/products/${line.productId}`);
      setEditing({ index, line, product });
    } catch (e) {
      setError(errorText(e));
    }
  }

  // forDocument: measured sale lines also send the scrap answer (drafts keep length + piece only).
  const draftLines = (src: CartLine[] = lines, forDocument = false) =>
    src.map((l) => ({
      variationId: l.variationId,
      quantity: l.quantity,
      price: l.price.trim(),
      ...(l.discount?.trim() ? { discount: l.discount.trim() } : {}),
      ...(l.note?.trim() ? { note: l.note.trim() } : {}),
      ...(l.measure?.pieceId ? { pieceId: l.measure.pieceId } : {}),
      ...(forDocument && l.measure?.writeOffLeftover ? { writeOffLeftover: true } : {}),
      ...(l.measure?.rolls ? { rolls: l.measure.rolls } : {}),
      // V3.1 grouped purchase line: its sets (the rate is the line price).
      ...(l.sets ? { sets: l.sets } : {}),
      // V3.1 grouped sale line: the sets picked and their part changes.
      ...(l.saleSets ? { saleSets: l.saleSets.map(({ code: _, ...s }) => s) } : {}),
      // Held carts keep the set labels too (the document ignores them).
      ...(isSetLine(l) && !forDocument ? { setSummaries: l.setSummaries ?? [], ...(l.setDetails ? { setDetails: l.setDetails } : {}) } : {}),
      // Purchase lines carry no warehouse: the whole purchase goes to "Receive into".
      ...(wh.enabled && isSale && l.splits?.length && !l.measure && !isSetLine(l) ? { splits: l.splits } : {}),
      // Purchase order: the customer-order line this item is bought for (Arrange purchase).
      ...(l.linked && !isSale && !forDocument ? { linkedOrderId: l.linked.orderId, linkedOrderLineId: l.linked.orderLineId } : {}),
    }));

  // Backorder lines (a length no bundle has, or a set waiting for a by-product) can only be saved
  // as a customer order: stock never goes negative.
  const hasMeasuredShortage = lines.some((l) => isSale && ((l.measure && (l.measure.isShortage || !l.measure.pieceId)) || hasSetBackorder(l)));

  async function submit(allowNegative = false, override?: CartLine[]) {
    setError("");
    setFlash("");
    setPieceProblems(null);
    if (isSale && hasMeasuredShortage) {
      setError("This cart has backorder items (a length no bundle has, or a set part not in stock). Stock cannot go negative. Save it as a Customer Order, then use Arrange purchase on the order.");
      setOrdering(true);
      return;
    }
    // Sales: "Regular" means a customer must be chosen. Purchases: a supplier must be selected.
    if (isSale && regular && !partyId) return setError("Choose a customer, or switch to Normal (Walk-in)");
    if (!isSale && !partyId) return setError("Select a supplier before completing the purchase");
    setSaving(true);
    try {
      const res = await api<{ id: string }>(isSale ? "/sales" : "/purchases", {
        method: "POST",
        body: {
          partyId: regular ? partyId : null,
          notes: notes || null,
          clientRef: cart.clientRef,
          lines: draftLines(override, true),
          ...headerWarehouse,
          ...(paymentMode ? { paymentMode } : {}),
          ...(paymentMode && amountPaid.trim() ? { amountPaid: amountPaid.trim() } : {}),
          ...(cart.draft ? { draftId: cart.draft.id } : {}),
          ...(allowNegative ? { allowNegative: true } : {}),
        },
      });
      cart.clear();
      router.replace(`/${isSale ? "sales" : "purchases"}/${res.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "INSUFFICIENT_STOCK" && Array.isArray(e.details)) {
        setShortages(e.details as Shortage[]);
      } else if (e instanceof ApiError && (e.code === "PIECE_CHANGED" || e.code === "NO_PIECE_LONG_ENOUGH") && Array.isArray(e.details)) {
        setPieceProblems({ code: e.code, message: e.message, lines: e.details as PieceProblem[] });
      } else {
        setError(e instanceof ApiError ? e.message : "Could not reach the server. Your cart is kept; try again.");
      }
      setSaving(false);
    }
  }

  // Save the cart as a sale / purchase order (no stock moves until the order is completed).
  async function saveOrder() {
    setError("");
    if (isSale && regular && !partyId) return setError("Choose a customer, or switch to Normal (Walk-in)");
    if (!isSale && !partyId) return setError("Select a supplier before saving the purchase order");
    setSaving(true);
    try {
      const res = await api<{ id: string }>("/orders", {
        method: "POST",
        body: {
          kind: isSale ? "SALE" : "PURCHASE",
          status: orderStatus,
          partyId: regular ? partyId : null,
          notes: notes || null,
          expectedDate: expectedDate || null,
          deliveryAddress: deliveryAddress.trim() || null,
          clientRef: cart.clientRef,
          lines: draftLines(),
          ...headerWarehouse,
        },
      });
      cart.clear();
      router.replace(`${ordersBase}/${res.id}`);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  // The cart was loaded from an order: write the items and party back to it.
  async function saveOrderChanges() {
    if (!editingOrder) return;
    setError("");
    if (isSale && regular && !partyId) return setError("Choose a customer, or switch to Normal (Walk-in)");
    if (!isSale && !partyId) return setError("Select a supplier before saving the purchase order");
    setSaving(true);
    try {
      await api(`/orders/${editingOrder.id}`, { method: "PUT", body: { partyId: regular ? partyId : null, lines: draftLines(), version: editingOrder.version } });
      cart.clear();
      router.replace(`${ordersBase}/${editingOrder.id}`);
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  function openOrderPanel() {
    setOrdering((o) => !o);
    if (!deliveryAddress && partyId) {
      const p = parties.data?.parties.find((x) => x.id === partyId);
      const addr = p?.shippingAddress || p?.address;
      if (addr) setDeliveryAddress(addr);
    }
  }

  // Park the cart as a server draft (new, or update of the draft it was resumed from).
  async function hold() {
    const title = holdTitle.trim() || cart.draft?.title || `${selectedPartyName ?? (isSale ? "Walk-in customer" : "Purchase")} — ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
    setError("");
    try {
      const body = { title, partyId: regular ? partyId : null, notes: notes || null, lines: draftLines() };
      if (cart.draft) await api(`/drafts/${cart.draft.id}`, { method: "PUT", body: { ...body, version: cart.draft.version } });
      else await api("/drafts", { method: "POST", body: { mode: isSale ? "SALE" : "PURCHASE", ...body } });
      cart.clear();
      setHolding(false);
      setHoldTitle("");
      setFlash(`Held as “${title}”. Find it under Drafts.`);
    } catch (e) {
      setError(errorText(e));
    }
  }

  // Review changes before submitting an edit
  async function reviewEdit() {
    setError("");
    if (editReason.trim().length < 3) {
      return setError("Please give a reason for the edit (at least 3 characters).");
    }
    if (isSale && regular && !partyId) return setError("Choose a customer, or switch to Normal (Walk-in)");
    if (!isSale && !partyId) return setError("Select a supplier before completing the purchase");

    setPreviewLoading(true);
    try {
      const body = {
        partyId: regular ? partyId : null,
        notes: notes || null,
        lines: draftLines(),
        ...headerWarehouse,
        ...(paymentMode ? { paymentMode } : {}),
        ...(paymentMode && amountPaid.trim() ? { amountPaid: amountPaid.trim() } : {}),
      };
      const res = await api<any>(`/${isSale ? "sales" : "purchases"}/${editingDoc!.documentId}/edit/preview`, {
        method: "POST",
        body,
      });
      setPreviewData(res);
      setShowEditPreview(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  // Submit the revision to the server
  async function submitEdit(allowNegative = false) {
    if (!editingDoc) return;
    setError("");
    setSaving(true);
    try {
      const body = {
        partyId: regular ? partyId : null,
        notes: notes || null,
        clientRef: cart.clientRef,
        reason: editReason.trim(),
        expectedNumber: editingDoc.number,
        lines: draftLines(),
        ...headerWarehouse,
        ...(paymentMode ? { paymentMode } : {}),
        ...(paymentMode && amountPaid.trim() ? { amountPaid: amountPaid.trim() } : {}),
        ...(allowNegative ? { allowNegative: true } : {}),
      };
      const res = await api<{ id: string; number: string }>(`/${isSale ? "sales" : "purchases"}/${editingDoc.documentId}/edit`, {
        method: "POST",
        body,
      });
      cart.clear();
      setShowEditPreview(false);
      router.replace(`/${isSale ? "sales" : "purchases"}/${res.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "INSUFFICIENT_STOCK" && Array.isArray(e.details)) {
        setShortages(e.details as Shortage[]);
        setShowEditPreview(false);
      } else if (e instanceof ApiError && e.code === "ALREADY_REPLACED") {
        setError("This document was already edited and replaced. Please discard this edit and open the latest revision.");
        setShowEditPreview(false);
      } else {
        setError(errorText(e));
      }
    } finally {
      setSaving(false);
    }
  }

  const back = isSale ? "/sales/new" : "/purchases/new";
  if (!lines.length) {
    return (
      <div className="grid gap-4">
        <PageHeader title="Checkout" actions={<DraftsButton mode={mode} />} />
        {flash && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{flash}</p>}
        <div className="card grid justify-items-center gap-3 p-10 text-center text-slate-500">
          <div>No items in the {isSale ? "Sale" : "Purchase"} Cart yet.</div>
          {cart.count > 0 && cart.mode !== mode && (
            <div className="text-sm">The {cart.mode} cart has {cart.count} item(s). Complete or clear it first.</div>
          )}
          <Link href={back} className="btn-primary">Add items</Link>
        </div>
      </div>
    );
  }

  const totalPaise = lines.reduce((t, l) => t + linePaise(l), 0);
  const grossTotal = lines.reduce((t, l) => t + grossPaise(l), 0);
  const knownShort = isSale ? lines.filter((l) => !l.measure && l.quantity > l.available) : [];
  // PIECE_CHANGED: let the server choose the next piece in DM-5 order for the lines named.
  const replan = () => {
    const keys = new Set(pieceProblems?.lines.map((p) => p.key));
    const next = lines.map((l, i) => (keys.has(String(i + 1)) && l.measure ? { ...l, measure: { ...l.measure, pieceId: null, pieceCode: null } } : l));
    next.forEach((l, i) => cart.replace(i, l));
    void submit(false, next);
  };
  const canOversell = settings.data?.canOversell ?? false;
  const suggestionFor = (id: string) => suggestions.get(id);

  return (
    <div className="mx-auto grid max-w-3xl gap-5">
      <PageHeader
        back={{ href: back, label: "Add more items" }}
        title={`Checkout — ${isSale ? "Sale" : "Purchase"}`}
        subtitle={
          editingDoc
            ? `Editing ${editingDoc.number} (creates revision -R${editingDoc.revision + 1})`
            : editingOrder
            ? `Editing items of order ${editingOrder.number}`
            : cart.draft
            ? `Resumed draft: ${cart.draft.title}`
            : undefined
        }
        actions={
          editingDoc ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (window.confirm("Discard changes and stop editing?")) cart.clear();
              }}
            >
              Discard edit
            </button>
          ) : editingOrder ? (
            <Link className="btn-secondary" href={`${ordersBase}/${editingOrder.id}`} onClick={() => cart.clear()}>Discard changes</Link>
          ) : (
          <div className="flex flex-wrap gap-2">
            <DraftsButton mode={mode} />
            <button className="btn-secondary" onClick={() => setHolding((h) => !h)}>Hold cart</button>
            <button
              className="btn-secondary"
              onClick={() => {
                if (window.confirm(`Remove all ${cart.count} item${cart.count > 1 ? "s" : ""} from the cart?`)) {
                  cart.clear();
                }
              }}
            >
              Clear cart
            </button>
          </div>
          )
        }
      />

      {editingDoc && (
        <div className="card flex items-center justify-between gap-3 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <div>
            <strong className="font-semibold">Editing {editingDoc.number}</strong> — saving creates revision{" "}
            <span className="font-mono font-semibold">{editingDoc.number.replace(/-R\d+$/, "")}-R{editingDoc.revision + 1}</span>{" "}
            and cancels the original with the edit reason.
          </div>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => {
              if (window.confirm("Discard changes and stop editing?")) cart.clear();
            }}
          >
            Discard edit
          </button>
        </div>
      )}

      {holding && (
        <div className="card flex flex-wrap items-end gap-2 border-sky-200 bg-sky-50 p-3">
          <div className="min-w-[12rem] flex-1">
            <label className="label" htmlFor="hold-title">Name this held cart</label>
            <input id="hold-title" className="input" maxLength={120} placeholder={cart.draft?.title ?? "e.g. Kishan — waiting for length confirmation"} value={holdTitle} onChange={(e) => setHoldTitle(e.target.value)} />
          </div>
          <button className="btn-primary" onClick={hold}>{cart.draft ? "Update held cart" : "Hold cart"}</button>
          <p className="w-full text-xs text-slate-600">Held carts do not reserve stock. Resume from Drafts on any counter.</p>
        </div>
      )}

      {knownShort.length > 0 && !shortages && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
          {knownShort.length} item(s) were short when added. {canOversell ? "You can still sell them; you will be asked to confirm." : "The server checks stock again when you complete the sale."}
        </p>
      )}

      {!isSale && wh.enabled && (
        <div className="card flex flex-wrap items-center gap-3 p-3">
          <label className="text-sm font-semibold text-slate-900" htmlFor="receive-into">Receive into</label>
          <select id="receive-into" className="input w-auto" value={receiveInto ?? ""} onChange={(e) => cart.setWarehouse(e.target.value || null)}>
            {wh.active.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-500">Every item of this purchase is received here.</span>
        </div>
      )}

      {lines.map((l, i) => {
        const p = paise(l.price);
        const short = isSale && !l.measure && l.quantity > l.available;
        const k = lineKey(l);
        const m = l.measure;
        const extras = openExtras[k] || !!l.discount || !!l.note;
        const sug = !isSale ? suggestionFor(l.variationId) : undefined;
        return (
          <div key={k} className={`card p-4 ${short ? "border-amber-300" : ""}`}>
            <div className="flex items-start gap-3">
              <ProductThumb src={l.imageUrl} name={l.productName} className="h-12 w-12 shrink-0 rounded-lg text-[7px]" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-slate-900">{l.productName}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(l.attributes).map(([k, v]) => (
                    <span key={k} className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-xs">
                      {k}: <b>{formatAttributeValue(k, v, l.attributeUnits?.[k])}</b>
                    </span>
                  ))}
                </div>
              </div>
              <button className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:bg-brand-50 px-2 py-1 rounded transition-all duration-150 active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" onClick={() => openEdit(i)}>Edit</button>
              <button className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2 py-1 rounded transition-all duration-150 active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400" onClick={() => cart.remove(i)}>Delete</button>
            </div>
            <div className="mt-3 flex items-center justify-between">
              {isSetLine(l) ? (
                <div className="text-sm">
                  <div className="font-semibold text-slate-900">
                    {l.quantity} set{l.quantity === 1 ? "" : "s"}
                  </div>
                  <SetDetailsList className="mt-1 min-w-[16rem]" details={l.setDetails} summaries={l.setSummaries} />
                  <button type="button" className="mt-0.5 text-xs font-semibold text-brand-600 hover:underline" onClick={() => openEdit(i)}>
                    Edit sets
                  </button>
                </div>
              ) : m ? (
                <div className="text-sm">
                  <div className="font-semibold text-slate-900">{fmtLen(l.quantity, m)}</div>
                  {m.rolls ? (
                    <div className="text-xs text-slate-500">
                      {m.rolls.length} {(m.rollName || "roll").toLowerCase()}{m.rolls.length === 1 ? "" : "s"}: {m.rolls.map((r) => fmtLen(r.length, m)).join(" · ")}
                    </div>
                  ) : m.pieceCode ? (
                    <div className="text-xs text-slate-500">
                      cut from {m.pieceKind ? kindPhrase(m.pieceKind, m.rollName) : "a chosen piece"}
                      {m.writeOffLeftover && " · leftover written off"}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">piece chosen at checkout</div>
                  )}
                  <button type="button" className="mt-0.5 text-xs font-semibold text-brand-600 hover:underline" onClick={() => openEdit(i)}>
                    {m.rolls ? "Edit rolls" : "Change length / piece"}
                  </button>
                </div>
              ) : (
              <div className="flex items-center rounded-lg border border-slate-300 bg-slate-50 shadow-sm">
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-l-lg text-sm font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-600 active:bg-rose-100 active:scale-90 transition-all duration-150 cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                  aria-label={`Decrease quantity of ${l.productName}`}
                  disabled={l.quantity <= 1}
                  onClick={() => cart.setQuantity(i, l.quantity - 1)}
                >
                  −
                </button>
                <span className="min-w-[2.5rem] text-center font-semibold text-slate-900">{l.quantity}</span>
                <button
                  className="flex h-8 w-8 items-center justify-center rounded-r-lg text-sm font-semibold text-slate-700 hover:bg-brand-50 hover:text-brand-600 active:bg-brand-100 active:scale-90 transition-all duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  aria-label={`Increase quantity of ${l.productName}`}
                  onClick={() => cart.setQuantity(i, l.quantity + 1)}
                >
                  +
                </button>
              </div>
              )}
              <div className="text-right">
                <div className="text-lg font-bold text-slate-900">{money(linePaise(l) / 100)}</div>
                <div className="text-xs text-slate-500">
                  @ {money(p / 100)} / {l.measure ? rateLabel(l.measure.lengthUnit) : isSetLine(l) ? "set" : l.unit}
                  {paise(l.discount) > 0 && <> · − {money(paise(l.discount) / 100)} discount</>}
                </div>
              </div>
            </div>
            {wh.enabled && isSale && !l.measure && !isSetLine(l) && (
              <div className="mt-2">
                <SplitChips splits={l.splits} onClick={() => setSplitting(i)} emptyLabel="Auto: default warehouse first" />
              </div>
            )}
            <LineFlags line={l} className="mt-2" />
            {short && (
              <p className="mt-2 text-sm text-amber-700">
                Shortage: selling {l.quantity}, {l.available} on hand{l.available - l.quantity < 0 ? ` (balance would be ${l.available - l.quantity})` : ""}.
              </p>
            )}
            {sug && (sug.supplierRate || sug.cheapest) && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                {sug.supplierRate && sug.supplierRate !== l.price && (
                  <button type="button" className="rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-sky-800 hover:bg-sky-100" onClick={() => cart.patchLine(i, { price: String(Math.round(Number(sug.supplierRate))) })}>
                    This supplier’s rate {money(sug.supplierRate)} — use
                  </button>
                )}
                {sug.cheapest && sug.cheapest.rate !== sug.supplierRate && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600" title="Cheapest active supplier rate">
                    Best rate {money(sug.cheapest.rate)} ({sug.cheapest.supplierName})
                  </span>
                )}
              </div>
            )}
            {!extras ? (
              <button type="button" className="mt-2 text-xs font-medium text-slate-500 hover:text-brand-600" onClick={() => setOpenExtras((o) => ({ ...o, [k]: true }))}>
                + Discount / note
              </button>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-[8rem_1fr]">
                <div>
                  <label className="label" htmlFor={`disc-${k}`}>Discount ₹</label>
                  <input id={`disc-${k}`} className="input" inputMode="numeric" placeholder="0" value={l.discount ?? ""} onChange={(e) => cart.patchLine(i, { discount: e.target.value.replace(/[^\d]/g, "") })} />
                </div>
                <div>
                  <label className="label" htmlFor={`note-${k}`}>Line note</label>
                  <input id={`note-${k}`} className="input" maxLength={300} placeholder="e.g. cut to 25 m, old customer rate" value={l.note ?? ""} onChange={(e) => cart.patchLine(i, { note: e.target.value })} />
                </div>
              </div>
            )}
          </div>
        );
      })}

      <section className="card grid gap-3 bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-slate-900">{isSale ? "Customer Details" : "Supplier Details"}</h2>
          {canAddParty && (
            <button
              type="button"
              className="btn-secondary !py-1 !px-2.5 text-xs inline-flex items-center gap-1.5 font-medium text-brand-700 bg-white border border-slate-200 hover:bg-brand-50 hover:border-brand-300 transition-all duration-150 active:scale-95 cursor-pointer"
              onClick={() => {
                setPresetName("");
                setShowPartyModal(true);
              }}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              {isSale ? "Add Customer" : "Add Supplier"}
            </button>
          )}
        </div>
        {isSale && (
          <div className="flex gap-2" role="radiogroup" aria-label="Customer type">
            {[
              { v: false, t: "Normal" },
              { v: true, t: "Regular" },
            ].map((o) => (
              <button
                key={o.t}
                role="radio"
                aria-checked={regular === o.v}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-all duration-150 cursor-pointer select-none active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  regular === o.v
                    ? "bg-brand-600 text-white shadow-sm"
                    : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-900"
                }`}
                onClick={() => {
                  setRegular(o.v);
                  if (!o.v) {
                    setPartyId(null);
                    setSelectedPartyName(null);
                    cart.setParty(mode, null);
                  }
                }}
              >
                {o.t}
              </button>
            ))}
          </div>
        )}
        {isSale && !regular && <p className="text-sm text-slate-500">Walk-in customer — no name is recorded.</p>}
        {regular && (
          <>
            <Combobox
              value={partyId}
              selectedLabel={selectedPartyName || undefined}
              options={(parties.data?.parties ?? []).map((p) => ({
                id: p.id,
                label: p.name,
                sublabel: [
                  p.phone,
                  p.city,
                  isSale && typeof p.creditScore === "number" ? `Credit: ${p.creditScore}` : null,
                ].filter(Boolean).join(" · ") || undefined,
              }))}
              onSelect={(id) => {
                setPartyId(id);
                const found = parties.data?.parties.find((p) => p.id === id);
                setSelectedPartyName(found?.name ?? null);
                cart.setParty(mode, found ? { id: found.id, name: found.name } : null);
              }}
              onCreate={(name) => {
                setPresetName(name);
                setShowPartyModal(true);
              }}
              createLabel={(name) => `Add new ${label} “${name}”`}
              placeholder={`Search ${label} name or phone…`}
            />
            {isSale && partyId && (() => {
              const party = parties.data?.parties.find((p) => p.id === partyId);
              if (!party) return null;
              return (
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-600">
                  <span className="font-medium text-slate-700">Customer Credit Score:</span>
                  <CreditScoreBadge score={party.creditScore ?? 0} showTier />
                </div>
              );
            })()}
            {!isSale && <p className="text-xs text-slate-500">Optional — leave empty if the supplier is not recorded.</p>}
          </>
        )}
      </section>

      {!editingOrder && (
      <section className="card grid gap-3 p-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="pay-mode">Payment mode</label>
          <select id="pay-mode" className="input" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
            {PAYMENT_MODES.map((m) => <option key={m.v} value={m.v}>{m.t}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pay-amount">Amount paid ₹</label>
          <input
            id="pay-amount"
            className="input"
            inputMode="numeric"
            disabled={!paymentMode}
            placeholder={!paymentMode ? "Choose a payment mode" : paymentMode === "CREDIT" ? "0 (pay later)" : `${totalPaise / 100} (full)`}
            value={amountPaid}
            onChange={(e) => setAmountPaid(e.target.value.replace(/[^\d]/g, ""))}
          />
          <p className="mt-1 text-xs text-slate-500">Leave empty for paid in full{paymentMode === "CREDIT" ? " — credit means nothing paid yet" : ""}.</p>
        </div>
      </section>
      )}

      {!editingOrder && (
      <div>
        <label className="label" htmlFor="doc-notes">Notes</label>
        <textarea id="doc-notes" className="input min-h-[3rem]" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      )}

      {editingDoc && (
        <section className="card grid gap-2 border-amber-200 bg-amber-50/50 p-4">
          <label className="label font-semibold text-slate-800" htmlFor="edit-reason">
            Reason for edit <span className="text-rose-500">*</span>
          </label>
          <input
            id="edit-reason"
            className="input bg-white"
            placeholder="e.g. Customer returned 1 item, price correction (required, 3–300 chars)"
            value={editReason}
            onChange={(e) => setEditReason(e.target.value)}
            maxLength={300}
          />
          <p className="text-xs text-slate-500">This reason is required and will be permanently recorded on the replaced document's cancellation voucher and the audit log.</p>
        </section>
      )}

      {ordering && !editingOrder && !editingDoc && (
        <section className="card grid gap-3 border-violet-200 bg-violet-50 p-4" aria-label="Save as order">
          <div>
            <h2 className="font-semibold text-slate-900">Save as {isSale ? "sale" : "purchase"} order</h2>
            <p className="text-xs text-slate-600">
              No stock moves now. Complete the order later from {isSale ? "Sale" : "Purchase"} Orders{isSale ? "; stock is checked again then" : ""}. Payment is recorded at completion.
            </p>
          </div>
          <div className="flex gap-2" role="radiogroup" aria-label="Order status">
            {([
              { v: "PLACED", t: "Place order", d: `Confirmed with the ${label}` },
              { v: "DRAFT", t: "Save as draft", d: "Still being worked out" },
            ] as const).map((o) => (
              <button
                key={o.v}
                type="button"
                role="radio"
                aria-checked={orderStatus === o.v}
                onClick={() => setOrderStatus(o.v)}
                className={`flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${orderStatus === o.v ? "border-violet-500 bg-white ring-2 ring-violet-200" : "border-slate-200 bg-white/60 hover:bg-white"}`}
              >
                <div className="font-semibold text-slate-900">{o.t}</div>
                <div className="text-xs text-slate-500">{o.d}</div>
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="order-expected">{isSale ? "Deliver by" : "Expected by"}</label>
              <DeliveryDatePicker
                id="order-expected"
                value={expectedDate}
                onChange={setExpectedDate}
              />
            </div>
            <div>
              <label className="label" htmlFor="order-address">{isSale ? "Delivery address" : "Deliver to"}</label>
              <input id="order-address" className="input" maxLength={300} placeholder="Optional" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOrdering(false)}>Close</button>
            <button type="button" className="btn bg-violet-700 text-white hover:bg-violet-800" disabled={saving} onClick={saveOrder}>
              {saving ? "Saving…" : orderStatus === "PLACED" ? "Place order" : "Save draft order"}
            </button>
          </div>
        </section>
      )}

      {shortages && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm" role="alert">
          <p className="font-semibold text-rose-800">Not enough recorded stock</p>
          <ul className="mt-1 list-disc pl-5 text-rose-800">
            {shortages.map((s) => (
              <li key={s.variationId}>{s.name} {s.shortName}: selling {s.requested}, {s.available} on hand (balance would be {s.available - s.requested})</li>
            ))}
          </ul>
          {shortages.every((s) => s.canOversell) ? (
            <>
              <p className="mt-2 text-rose-900">Completing the sale will record a negative balance until the purchase or stock count is entered.</p>
              <div className="mt-3 flex gap-2">
                <button className="btn bg-rose-700 text-white hover:bg-rose-800" disabled={saving} onClick={() => { setShortages(null); void submit(true); }}>
                  Sell anyway
                </button>
                <button className="btn-secondary" onClick={() => setShortages(null)}>Go back</button>
              </div>
            </>
          ) : (
            <p className="mt-2 text-rose-900">
              "You cannot confirm this sale with your current account. Reduce the quantity or ask an administrator for help."
            </p>
          )}
        </div>
      )}

      {pieceProblems && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm" role="alert">
          <p className="font-semibold text-rose-800">{pieceProblems.code === "PIECE_CHANGED" ? "A chosen piece changed" : "No piece is long enough"}</p>
          <p className="mt-1 text-rose-800">{pieceProblems.message}</p>
          <ul className="mt-1 list-disc pl-5 text-rose-800">
            {pieceProblems.lines.map((p) => (
              <li key={p.key}>
                Line {p.key}: {p.name}, {p.length} {p.unit} requested; longest piece left {p.longest} {p.unit}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            {pieceProblems.code === "PIECE_CHANGED" && (
              <button className="btn bg-rose-700 text-white hover:bg-rose-800" disabled={saving} onClick={replan}>
                Accept new plan
              </button>
            )}
            <button className="btn-secondary" onClick={() => setPieceProblems(null)}>Go back and edit the line</button>
          </div>
        </div>
      )}

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-400">Total</div>
          <div className="text-2xl font-bold text-slate-900">{money(totalPaise / 100)}</div>
          {grossTotal !== totalPaise && <div className="text-xs text-slate-500">{money(grossTotal / 100)} − {money((grossTotal - totalPaise) / 100)} discount</div>}
        </div>
        {hasMeasuredShortage && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            <span className="font-semibold">⚠️ Backorder in cart:</span> Stock cannot go negative. Save this cart as a <b>Customer Order</b>, then use <b>Arrange purchase</b> on the order to buy the new bundles.
          </div>
        )}
        {editingDoc ? (
          <button
            className="btn bg-amber-600 px-6 py-3 text-white hover:bg-amber-700 hover:shadow-md cursor-pointer"
            disabled={saving || previewLoading}
            onClick={reviewEdit}
          >
            {previewLoading ? "Loading preview…" : "Review changes"}
          </button>
        ) : editingOrder ? (
          <button className="btn bg-violet-700 px-6 py-3 text-white hover:bg-violet-800" disabled={saving} onClick={saveOrderChanges}>
            {saving ? "Saving…" : `Save changes to ${editingOrder.number}`}
          </button>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" className="btn-secondary px-4 py-3" aria-expanded={ordering} onClick={openOrderPanel}>Save as order</button>
            {hasMeasuredShortage ? (
              <button
                type="button"
                className="btn bg-violet-700 px-6 py-3 text-white hover:bg-violet-800"
                onClick={openOrderPanel}
              >
                Save as Customer Order (Backorder)
              </button>
            ) : (
              <button className={`btn px-6 py-3 text-white transition-all duration-150 active:scale-[0.98] motion-reduce:transform-none ${isSale ? "bg-brand-600 hover:bg-brand-700 hover:shadow-md focus-visible:ring-brand-500" : "bg-slate-900 hover:bg-slate-800 hover:shadow-md focus-visible:ring-slate-700"}`} disabled={saving} onClick={() => submit()}>
                {saving ? "Saving…" : isSale ? "Complete Sale" : "Complete Purchase"}
              </button>
            )}
          </div>
        )}
      </div>

      {showEditPreview && previewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6 shadow-2xl">
            <div className="flex items-start justify-between border-b pb-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Review revision: {previewData.originalNumber} → {previewData.newNumber}
                </h2>
                <p className="text-xs text-slate-500">
                  Saving will cancel {previewData.originalNumber} and create revision {previewData.newNumber}.
                </p>
              </div>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-600 text-lg font-bold"
                onClick={() => setShowEditPreview(false)}
              >
                ✕
              </button>
            </div>

            <div className="mt-4 grid gap-4 text-sm">
              <div className="rounded-lg bg-amber-50 p-3 text-amber-900 border border-amber-200">
                <span className="font-semibold">Reason:</span> {editReason.trim()}
              </div>

              {/* Totals Before & After */}
              <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-center">
                <div>
                  <div className="text-xs uppercase text-slate-500">Original Total</div>
                  <div className="text-lg font-bold text-slate-700">{money(previewData.totals.before.total)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase text-slate-500">New Revision Total</div>
                  <div className="text-lg font-bold text-brand-700">{money(previewData.totals.after.total)}</div>
                </div>
              </div>

              {/* Line Items Diff */}
              <div>
                <h3 className="mb-2 font-semibold text-slate-800">Line Items</h3>
                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b bg-slate-50 text-slate-600">
                      <tr>
                        <th className="p-2">Change</th>
                        <th className="p-2">Item</th>
                        <th className="p-2 text-right">Before</th>
                        <th className="p-2 text-right">After</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {previewData.lines.map((l) => (
                        <tr key={l.variationId} className={l.change === "removed" ? "bg-rose-50/50" : l.change === "added" ? "bg-emerald-50/50" : ""}>
                          <td className="p-2">
                            {l.change === "added" && <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800">+ Added</span>}
                            {l.change === "removed" && <span className="rounded bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-800">− Removed</span>}
                            {l.change === "changed" && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">Changed</span>}
                            {l.change === "same" && <span className="text-slate-400">Unchanged</span>}
                          </td>
                          <td className="p-2">
                            <div className="font-medium text-slate-900">{l.productName}</div>
                            {!setVariation(l.variationId) && <div className="text-slate-500">{l.shortName}</div>}
                          </td>
                          <td className="p-2 text-right text-slate-600">
                            {l.before ? `${l.before.quantity} ${l.unit} @ ${money(l.before.price)}` : "—"}
                          </td>
                          <td className="p-2 text-right font-medium text-slate-900">
                            {l.after ? `${l.after.quantity} ${l.unit} @ ${money(l.after.price)}` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Stock Impact */}
              <div>
                <h3 className="mb-2 font-semibold text-slate-800">Net Stock Impact</h3>
                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b bg-slate-50 text-slate-600">
                      <tr>
                        <th className="p-2">Item</th>
                        <th className="p-2 text-right">Net Change</th>
                        <th className="p-2 text-right">Current Stock</th>
                        <th className="p-2 text-right">After Edit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {previewData.stock.map((s) => (
                        <tr key={s.variationId} className={s.belowZero ? "bg-rose-50" : ""}>
                          <td className="p-2">
                            <span className="font-medium text-slate-900">{s.productName}</span>{" "}
                            {!setVariation(s.variationId) && <span className="text-slate-500">{s.shortName}</span>}
                          </td>
                          <td className={`p-2 text-right font-medium ${s.delta > 0 ? "text-emerald-700" : s.delta < 0 ? "text-rose-700" : "text-slate-600"}`}>
                            {s.delta > 0 ? `+${s.delta}` : s.delta} {s.unit}
                          </td>
                          <td className="p-2 text-right text-slate-600">{s.currentBalance} {s.unit}</td>
                          <td className={`p-2 text-right font-bold ${s.belowZero ? "text-rose-600" : "text-slate-900"}`}>
                            {s.afterBalance} {s.unit} {s.belowZero && "⚠️"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {previewData.hasStockWarning && (
                <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900" role="alert">
                  <strong>Warning:</strong> One or more items will have negative stock after this edit. Completing will record a negative balance until new stock arrives.
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t pt-3">
              <button
                type="button"
                className="btn-secondary"
                disabled={saving}
                onClick={() => setShowEditPreview(false)}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="btn bg-brand-600 text-white hover:bg-brand-700"
                disabled={saving}
                onClick={() => submitEdit(previewData.hasStockWarning)}
              >
                {saving ? "Saving revision…" : "Confirm and save revision"}
              </button>
            </div>
          </div>
        </div>
      )}

      {editing && <ProductDrawer product={editing.product} mode={mode} edit={{ index: editing.index, line: editing.line }} onClose={() => setEditing(null)} />}
      {editingSets !== null && lines[editingSets]?.sets && (
        <PurchaseSetsModal
          productId={lines[editingSets]!.productId}
          initial={lines[editingSets]!.sets!.map((s) => ({ ...s, rate: lines[editingSets]!.price.trim() }))}
          onClose={() => setEditingSets(null)}
          onConfirm={(next) => {
            const index = editingSets;
            setEditingSets(null);
            // The edited sets replace this line; a new rate becomes its own line.
            cart.replace(index, next[0]!);
            for (const line of next.slice(1)) cart.add(mode, line);
          }}
        />
      )}
      {editingSets !== null && lines[editingSets]?.saleSets && (
        <SaleSetsModal
          productId={lines[editingSets]!.productId}
          initial={lines[editingSets]!.saleSets}
          orderId={cart.order?.id}
          excludeSetIds={lines.flatMap((l, j) => (j === editingSets ? [] : (l.saleSets ?? []).map((s) => s.setId)))}
          onClose={() => setEditingSets(null)}
          onConfirm={(next) => {
            const index = editingSets;
            setEditingSets(null);
            // The edited picks replace this line; a set at another price becomes its own line.
            cart.replace(index, next[0]!);
            for (const line of next.slice(1)) cart.add(mode, line);
          }}
        />
      )}

      {splitting !== null && lines[splitting] && (
        <TakeFromPopup
          title={`${lines[splitting]!.productName} ${lines[splitting]!.shortName}`}
          unit={lines[splitting]!.unit}
          quantity={lines[splitting]!.quantity}
          productId={lines[splitting]!.productId}
          variationId={lines[splitting]!.variationId}
          initial={lines[splitting]!.splits}
          receive={!isSale}
          laterLabel={isSale ? "Let the system pick" : `All into ${wh.codeOf(receiveInto)}`}
          onConfirm={(splits) => {
            cart.setSplits(splitting, splits);
            setSplitting(null);
          }}
          onClose={() => setSplitting(null)}
        />
      )}

      <PartyModal
        open={showPartyModal}
        party={null}
        mode={isSale ? "customer" : "supplier"}
        initialName={presetName}
        onClose={() => setShowPartyModal(false)}
        onSaved={handlePartySaved}
      />
    </div>
  );
}
