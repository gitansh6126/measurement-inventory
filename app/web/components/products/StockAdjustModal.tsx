"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Alert, Field, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { formatVariationAttributesString, qty } from "@/lib/format";
import type { AttributeDef, StockVariation } from "@/lib/types";
import { errorText } from "@/lib/useApi";

// main v2 "Adjust Stock" modal: set the new quantity with a stepper and give a reason.
// Saved through Stock In, which refuses the change if stock moved since the modal opened.

export function StockAdjustModal({
  target,
  onClose,
  onSaved,
}: {
  target: { name: string; unit: string; variation: StockVariation; attributeDefs?: readonly AttributeDef[] } | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [value, setValue] = useState("0");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setValue(String(target.variation.quantity));
    setReason("");
    setError("");
    setSaving(false);
  }, [target]);

  if (!target) return null;
  const v = target.variation;
  const n = Number(value);
  const diff = Number.isInteger(n) ? n - v.quantity : 0;
  const attrsText = formatVariationAttributesString(v.attributes, target.attributeDefs);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!Number.isInteger(n) || n < 0) return setError("Enter a whole number, 0 or more");
    if (diff === 0) return setError("The quantity is unchanged");
    if (!reason.trim()) return setError("Enter a reason for the adjustment");
    setSaving(true);
    try {
      const r = await api<{ message: string }>("/inventory/stock-in", {
        method: "POST",
        body: { reason: reason.trim(), rows: [{ variationId: v.id, expectedQuantity: v.quantity, quantity: n }] },
      });
      onSaved(r.message);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  return (
    <Modal open title="Adjust Stock" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <strong>{target.name}</strong>
          {attrsText && (
            <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-700">
              {attrsText}
            </span>
          )}
          <span className="ml-auto">
            Current stock: <b>{qty(v.quantity)}</b> {target.unit}
          </span>
        </div>
        <Field label="New quantity">
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-md border border-slate-300 bg-white shadow-sm">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-l-md text-lg font-semibold text-slate-700 hover:bg-rose-50 hover:text-rose-600 active:bg-rose-100 active:scale-90 transition-all duration-150 cursor-pointer select-none disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                aria-label="Decrease quantity"
                disabled={Number(value) <= 0}
                onClick={() => setValue(String(Math.max(0, (Number(value) || 0) - 1)))}
              >
                −
              </button>
              <input className="h-9 w-24 border-x border-slate-300 text-center font-semibold outline-none focus:bg-brand-50/20" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))} aria-label="New quantity" />
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-r-md text-lg font-semibold text-slate-700 hover:bg-brand-50 hover:text-brand-600 active:bg-brand-100 active:scale-90 transition-all duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                aria-label="Increase quantity"
                onClick={() => setValue(String((Number(value) || 0) + 1))}
              >
                +
              </button>
            </div>
            <span className={`text-sm font-semibold ${diff > 0 ? "text-emerald-600" : diff < 0 ? "text-rose-600" : "text-slate-400"}`}>
              {diff > 0 ? `+${diff}` : diff} {target.unit}
            </span>
          </div>
        </Field>
        <Field label="Reason">
          <input className="input" maxLength={100} placeholder="e.g. Recount, Damaged, Found" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Alert message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Modal>
  );
}
