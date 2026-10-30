"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Alert, Field, Modal, Switch } from "@/components/ui";
import { scrollToAndHighlightField } from "@/lib/formFeedback";
import { Combobox } from "@/components/Combobox";
import { CreditScoreBadge } from "@/components/CreditScoreBadge";
import { api } from "@/lib/api";
import { errorText, useApi } from "@/lib/useApi";

export interface Party {
  id: string;
  type: "CUSTOMER" | "SUPPLIER" | "BOTH";
  name: string;
  phone: string | null;
  email?: string | null;
  address?: string | null;
  city: string | null;
  // V2 profile fields (plan §3.2; GSTIN/PAN are V3).
  contactPerson?: string | null;
  altPhone?: string | null;
  shippingAddress?: string | null;
  creditScore?: number;
  category?: string | null;
  notes?: string | null;
  active: boolean;
  version?: number;
}

const EXTRA = ["contactPerson", "altPhone", "address", "shippingAddress"] as const;
type Extra = (typeof EXTRA)[number];

export function PartyModal({
  open,
  party,
  mode,
  initialName = "",
  onClose,
  onSaved,
}: {
  open: boolean;
  party: Party | null;
  mode: "customer" | "supplier";
  initialName?: string;
  onClose: () => void;
  onSaved: (party: Party, message: string) => void;
}) {
  const isEdit = !!party;
  const isSupplier = mode === "supplier";
  const type = isSupplier ? "SUPPLIER" : "CUSTOMER";

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [creditScore, setCreditScore] = useState<string>("0");
  const [category, setCategory] = useState("");
  const [notes, setNotes] = useState("");
  const [active, setActive] = useState(true);
  const [extra, setExtra] = useState<Record<Extra, string>>({ contactPerson: "", altPhone: "", address: "", shippingAddress: "" });
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Existing customer categories for the "select or create" box.
  const { data: catData } = useApi<{ categories: string[] }>(open && !isSupplier ? "/parties/categories" : null);
  const categoryOptions = (catData?.categories ?? []).map((c) => ({ id: c, label: c }));

  useEffect(() => {
    if (!open) return;
    if (party) {
      setName(party.name);
      setPhone(party.phone ?? "");
      setCity(party.city ?? "");
      setCreditScore(party.creditScore != null ? String(party.creditScore) : "0");
      setCategory(party.category ?? "");
      setNotes(party.notes ?? "");
      setActive(party.active);
      const e = { contactPerson: party.contactPerson ?? "", altPhone: party.altPhone ?? "", address: party.address ?? "", shippingAddress: party.shippingAddress ?? "" };
      setExtra(e);
      setMore(Object.values(e).some(Boolean));
    } else {
      setName(initialName || "");
      setPhone("");
      setCity("");
      setCreditScore("0");
      setCategory("");
      setNotes("");
      setActive(true);
      setExtra({ contactPerson: "", altPhone: "", address: "", shippingAddress: "" });
      setMore(false);
    }
    setError("");
    setSaving(false);
  }, [open, party, initialName]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      scrollToAndHighlightField("party-name-input");
      return setError(isSupplier ? "Supplier name is required" : "Customer name is required");
    }
    setError("");
    setSaving(true);

    try {
      if (!isEdit) {
        const body = {
          type,
          name: trimmedName,
          phone: phone.trim() || null,
          city: city.trim() || null,
          creditScore: !isSupplier ? Math.max(0, parseInt(creditScore, 10) || 0) : 0,
          category: !isSupplier ? category.trim() || null : null,
          notes: notes.trim() || null,
          ...Object.fromEntries(EXTRA.map((k) => [k, extra[k].trim() || null])),
        };
        const res = await api<{ party: Party }>("/parties", { method: "POST", body });
        onSaved(
          res.party,
          `${isSupplier ? "Supplier" : "Customer"} "${res.party.name}" added successfully`
        );
      } else {
        const body: Record<string, unknown> = {};
        if (trimmedName !== party.name) body.name = trimmedName;
        if ((phone.trim() || null) !== party.phone) body.phone = phone.trim() || null;
        if ((city.trim() || null) !== party.city) body.city = city.trim() || null;
        if (!isSupplier && (parseInt(creditScore, 10) || 0) !== (party.creditScore ?? 0)) {
          body.creditScore = Math.max(0, parseInt(creditScore, 10) || 0);
        }
        if (!isSupplier && (category.trim() || null) !== (party.category ?? null)) body.category = category.trim() || null;
        if ((notes.trim() || null) !== (party.notes ?? null)) body.notes = notes.trim() || null;
        for (const k of EXTRA) if ((extra[k].trim() || null) !== (party[k] ?? null)) body[k] = extra[k].trim() || null;
        if (active !== party.active) body.active = active;

        if (Object.keys(body).length === 0) {
          onClose();
          return;
        }
        // V2: a stale edit (someone else saved first) is refused instead of overwriting.
        if (party.version) body.version = party.version;

        const res = await api<{ party: Party }>(`/parties/${party.id}`, {
          method: "PATCH",
          body,
        });
        onSaved(
          res.party,
          `${isSupplier ? "Supplier" : "Customer"} "${res.party.name}" updated successfully`
        );
      }
    } catch (err) {
      const msg = errorText(err);
      setError(msg);
      setSaving(false);
      const lower = msg.toLowerCase();
      if (lower.includes("phone")) {
        scrollToAndHighlightField("party-phone-input");
      } else if (lower.includes("email")) {
        scrollToAndHighlightField("party-email-input");
      } else {
        scrollToAndHighlightField("party-name-input");
      }
    }
  }

  const title = isEdit
    ? isSupplier
      ? "Edit Supplier Details"
      : "Edit Customer Details"
    : isSupplier
      ? "Add New Supplier"
      : "Add New Customer";

  const submitLabel = saving
    ? "Saving…"
    : isEdit
      ? isSupplier
        ? "Update Supplier"
        : "Update Customer"
      : isSupplier
        ? "Save Supplier"
        : "Save Customer";

  return (
    <Modal open={open} title={title} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <Field
          label={isSupplier ? "Supplier / Company Name *" : "Customer / Company Name *"}
          error={!name.trim() && error ? error : undefined}
          id="party-name-field"
        >
          <input autoComplete="off"
            id="party-name-input"
            className="input"
            required
            maxLength={150}
            placeholder={isSupplier ? "Company Name" : "Name"}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (error) setError("");
            }}
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Phone Number">
            <input autoComplete="off"
              className="input"
              type="tel"
              maxLength={30}
              placeholder="Phone Number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label="City">
            <input autoComplete="off"
              className="input"
              maxLength={100}
              placeholder="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
          </Field>
        </div>

        {!isSupplier && (
          <Field label="Customer Category">
            <Combobox
              value={category || null}
              selectedLabel={category}
              options={categoryOptions}
              onSelect={(id) => setCategory(id ?? "")}
              onCreate={(q) => setCategory(q.slice(0, 60))}
              createLabel={(q) => `Create category “${q}”`}
              placeholder="Select a category or type a new one"
              emptyText="No categories yet — type a name to create one"
              minMenuWidth={240}
            />
          </Field>
        )}

        {!more ? (
          <button type="button" className="justify-self-start text-xs font-medium text-brand-600 hover:underline" onClick={() => setMore(true)}>
            + More details (contact person, address)
          </button>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Contact Person">
              <input autoComplete="off" className="input" maxLength={150} placeholder="e.g. Store manager" value={extra.contactPerson} onChange={(e) => setExtra((x) => ({ ...x, contactPerson: e.target.value }))} />
            </Field>
            <Field label="Alternate Phone">
              <input autoComplete="off" className="input" type="tel" maxLength={30} value={extra.altPhone} onChange={(e) => setExtra((x) => ({ ...x, altPhone: e.target.value }))} />
            </Field>
            <Field label="Address" className="sm:col-span-2">
              <textarea className="input min-h-[3rem]" maxLength={500} value={extra.address} onChange={(e) => setExtra((x) => ({ ...x, address: e.target.value }))} />
            </Field>
            <Field label={isSupplier ? "Pickup / Dispatch Address" : "Delivery Address"} className="sm:col-span-2">
              <textarea className="input min-h-[3rem]" maxLength={500} placeholder="Leave empty if same as address" value={extra.shippingAddress} onChange={(e) => setExtra((x) => ({ ...x, shippingAddress: e.target.value }))} />
            </Field>
          </div>
        )}

        <Field label="Notes">
          <textarea
            className="input min-h-[4rem]"
            maxLength={2000}
            placeholder={isSupplier ? "Anything to remember about this supplier" : "Anything to remember about this customer"}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>

        {!isSupplier && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <label htmlFor="party-credit-score" className="text-xs font-semibold text-slate-800">
                  Customer Credit Score (0–100+)
                </label>
                <p className="text-[11px] text-slate-500">
                  Manual score tier used across customer cards, checkout, and sorting.
                </p>
              </div>
              <CreditScoreBadge score={parseInt(creditScore, 10) || 0} showTier />
            </div>
            <div className="mt-2">
              <input autoComplete="off"
                id="party-credit-score"
                className="input !w-32 tabular-nums"
                type="number"
                min={0}
                max={1000}
                value={creditScore}
                onChange={(e) => setCreditScore(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>
        )}

        {isEdit && (
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div>
              <div className="text-xs font-semibold text-slate-800">Account Status</div>
              <div className="text-[11px] text-slate-500">
                Inactive parties cannot be selected on new documents
              </div>
            </div>
            <Switch checked={active} onChange={setActive} label={active ? "Active" : "Inactive"} />
          </div>
        )}

        <Alert message={error} />

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
