"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CartMode } from "@/components/CartContext";
import { Combobox } from "@/components/Combobox";
import type { Party } from "@/components/PartyModal";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { errorText, useApi } from "@/lib/useApi";

const PAYMENT_MODES = [
  { v: "", t: "Not recorded" },
  { v: "CASH", t: "Cash" },
  { v: "UPI", t: "UPI" },
  { v: "BANK_TRANSFER", t: "Bank transfer" },
  { v: "CHEQUE", t: "Cheque" },
  { v: "CREDIT", t: "Credit (pay later)" },
] as const;

export interface HeaderEditDoc {
  id: string;
  number: string;
  partyId: string | null;
  partyName: string | null;
  notes: string | null;
  payment: { mode: string | null; amountPaid: string | null } | null;
  lines: {
    id: string;
    variationId: string;
    productName: string;
    shortName: string;
    unit: string;
    quantity: number;
    price: string;
    rateUnit?: string;
    discount: string;
    note: string | null;
    sets?: unknown[];
  }[];
}

interface Row {
  price: string;
  discount: string;
  note: string;
}

/**
 * Edit of a sale or purchase with Measured items or sets (2026-10-27): the rolls cut or received
 * and the sets stay exactly as they are, so only prices, discounts, line notes, the party, notes
 * and payment change. The server saves it as the next revision (-R<n>), like any edit.
 */
export function DocumentHeaderEdit({ mode, doc, onClose }: { mode: CartMode; doc: HeaderEditDoc; onClose: () => void }) {
  const router = useRouter();
  const isSale = mode === "sale";
  const base = isSale ? "sales" : "purchases";
  const parties = useApi<{ parties: Party[] }>(`/parties?role=${isSale ? "customer" : "supplier"}`);
  const [partyId, setPartyId] = useState<string | null>(doc.partyId);
  const [notes, setNotes] = useState(doc.notes ?? "");
  const [paymentMode, setPaymentMode] = useState(doc.payment?.mode ?? "");
  const [amountPaid, setAmountPaid] = useState(doc.payment?.amountPaid ?? "");
  const [rows, setRows] = useState<Row[]>(doc.lines.map((l) => ({ price: l.price, discount: Number(l.discount) > 0 ? l.discount : "", note: l.note ?? "" })));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  // A feet + inches line is priced per foot over a length in inches (0028).
  const lineTotal = (i: number) => {
    const l = doc.lines[i]!;
    const r = rows[i]!;
    const per = l.rateUnit === "ft" && l.unit !== "ft" ? 12 : 1;
    return Math.max(0, (l.quantity * Number(r.price || 0)) / per - Number(r.discount || 0));
  };
  const total = doc.lines.reduce((s, _, i) => s + lineTotal(i), 0);
  const options = (parties.data?.parties ?? []).map((p) => ({ id: p.id, label: p.name, sublabel: [p.phone, p.city].filter(Boolean).join(" · ") }));

  async function save() {
    setMsg("");
    if (reason.trim().length < 3) return setMsg("Give a reason for the edit (at least 3 characters).");
    if (!isSale && !partyId) return setMsg("Choose a supplier.");
    if (rows.some((r) => r.price.trim() === "" || Number.isNaN(Number(r.price)))) return setMsg("Enter a price on every line.");
    setBusy(true);
    try {
      const res = await api<{ id: string }>(`/${base}/${doc.id}/edit`, {
        method: "POST",
        body: {
          partyId,
          notes: notes.trim() || null,
          reason: reason.trim(),
          expectedNumber: doc.number,
          lines: doc.lines.map((l, i) => ({
            variationId: l.variationId,
            quantity: l.quantity,
            price: rows[i]!.price.trim(),
            ...(rows[i]!.discount.trim() ? { discount: rows[i]!.discount.trim() } : {}),
            note: rows[i]!.note.trim() || null,
          })),
          ...(paymentMode ? { paymentMode } : {}),
          ...(paymentMode && amountPaid.trim() ? { amountPaid: amountPaid.trim() } : {}),
        },
      });
      router.push(`/${base}/${res.id}`);
    } catch (e) {
      setMsg(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="no-print card border-brand-200 bg-brand-50/40 p-4 text-sm">
      <p className="font-semibold text-slate-900">Edit {doc.number}</p>
      <p className="mt-1 text-slate-600">
        This {isSale ? "sale" : "purchase"} has measured items or sets. Prices, discounts, notes, the {isSale ? "customer" : "supplier"} and payment can be changed; the rolls and sets stay as they are. To change items or quantities, cancel it and enter it again.
      </p>

      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="text-right">Qty</th>
              <th className="text-right">{isSale ? "Price" : "Cost"} ₹</th>
              <th className="text-right">Discount ₹</th>
              <th>Line note</th>
              <th className="text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => (
              <tr key={l.id}>
                <td>
                  <div className="font-medium text-slate-900">{l.productName}</div>
                  <div className="text-xs text-slate-500">{l.shortName}</div>
                </td>
                <td className="text-right whitespace-nowrap">
                  {l.quantity} {l.sets?.length ? (l.quantity === 1 ? "set" : "sets") : l.unit}
                </td>
                <td className="text-right">
                  <input className="input w-28 text-right" inputMode="decimal" aria-label={`${l.productName} price`} value={rows[i]!.price} onChange={(e) => setRow(i, { price: e.target.value })} />
                  {l.rateUnit && l.rateUnit !== l.unit && <div className="text-[11px] text-slate-500">per {l.rateUnit}</div>}
                </td>
                <td className="text-right">
                  <input className="input w-24 text-right" inputMode="decimal" aria-label={`${l.productName} discount`} placeholder="0" value={rows[i]!.discount} onChange={(e) => setRow(i, { discount: e.target.value })} />
                </td>
                <td>
                  <input className="input min-w-[8rem]" maxLength={300} aria-label={`${l.productName} note`} value={rows[i]!.note} onChange={(e) => setRow(i, { note: e.target.value })} />
                </td>
                <td className="text-right font-semibold whitespace-nowrap">{money(lineTotal(i))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="text-right font-semibold">New total</td>
              <td className="text-right font-bold">{money(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="he-party">{isSale ? "Customer" : "Supplier"}</label>
          <Combobox
            inputId="he-party"
            value={partyId}
            options={options}
            selectedLabel={partyId === doc.partyId ? (doc.partyName ?? undefined) : undefined}
            onSelect={setPartyId}
            placeholder={isSale ? "Walk-in customer (leave empty)" : "Choose a supplier"}
          />
        </div>
        <div>
          <label className="label" htmlFor="he-notes">Notes</label>
          <input id="he-notes" className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="he-pay-mode">Payment mode</label>
          <select id="he-pay-mode" className="input" value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
            {PAYMENT_MODES.map((m) => <option key={m.v} value={m.v}>{m.t}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="he-pay-amount">Amount paid ₹</label>
          <input
            id="he-pay-amount"
            className="input"
            inputMode="decimal"
            disabled={!paymentMode}
            placeholder={!paymentMode ? "Choose a payment mode" : paymentMode === "CREDIT" ? "0 (pay later)" : `${total} (full)`}
            value={amountPaid}
            onChange={(e) => setAmountPaid(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="he-reason">Reason for the edit</label>
          <input id="he-reason" className="input" maxLength={300} placeholder="e.g. Wrong rate entered" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </div>

      {msg && <p className="mt-2 text-rose-700" role="alert">{msg}</p>}
      <div className="mt-3 flex gap-2">
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save as new revision"}</button>
        <button className="btn-secondary" disabled={busy} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
