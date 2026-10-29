"use client";

import { useState } from "react";
import { Combobox } from "@/components/Combobox";
import { CreditScoreBadge } from "@/components/CreditScoreBadge";
import { PartyModal, type Party } from "@/components/PartyModal";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { errorText } from "@/lib/useApi";

// Type-ahead customer/supplier picker: suggestions appear while typing, and a new name is saved
// straight from the typed text (name only) instead of opening the "Add New" form. Phone, city and
// the rest can be added afterwards from the optional "Add details" link.
export function PartyPicker({
  mode,
  parties,
  value,
  selectedLabel,
  creditScore,
  canAdd,
  onChange,
  onCreated,
  inputId,
  autoFocus,
}: {
  mode: "customer" | "supplier";
  parties: Party[];
  value: string | null;
  selectedLabel?: string;
  creditScore?: number | null;
  canAdd: boolean;
  onChange: (party: Party | null) => void;
  // Called after a quick-create or details save so the caller can refresh its party list.
  onCreated?: (party: Party) => void | Promise<void>;
  inputId?: string;
  autoFocus?: boolean;
}) {
  const isSale = mode === "customer";
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [justCreated, setJustCreated] = useState<Party | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  async function quickCreate(name: string) {
    setError("");
    setCreating(true);
    try {
      const res = await api<{ party: Party }>("/parties", {
        method: "POST",
        body: { type: isSale ? "CUSTOMER" : "SUPPLIER", name: name.trim() },
      });
      setJustCreated(res.party);
      onChange(res.party);
      await onCreated?.(res.party);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setCreating(false);
    }
  }

  const selectedParty = parties.find((p) => p.id === value) ?? (justCreated?.id === value ? justCreated : null);
  const resolvedCreditScore = typeof creditScore === "number"
    ? creditScore
    : (typeof selectedParty?.creditScore === "number" ? selectedParty.creditScore : null);
  const detailsTarget = justCreated && justCreated.id === value ? justCreated : null;

  return (
    <div className="grid gap-1.5">
      <Combobox
        inputId={inputId}
        autoFocus={autoFocus}
        value={value}
        selectedLabel={selectedLabel}
        badge={isSale && resolvedCreditScore !== null ? <CreditScoreBadge score={resolvedCreditScore} /> : undefined}
        options={parties.map((p) => ({
          id: p.id,
          label: p.name,
          sublabel: [
            p.phone,
            p.city,
            isSale && typeof p.creditScore === "number" ? `Credit: ${p.creditScore}` : null,
          ].filter(Boolean).join(" · ") || undefined,
        }))}
        onSelect={(id) => {
          setError("");
          onChange(id ? parties.find((p) => p.id === id) ?? null : null);
        }}
        onCreate={canAdd && !creating ? (name) => void quickCreate(name) : undefined}
        createLabel={(name) => `Add new ${mode} “${name}”`}
        placeholder={creating ? `Saving ${mode}…` : `Type ${mode} name or phone…`}
        emptyText={canAdd ? `No ${mode}s found — keep typing to add one` : `No ${mode}s found`}
      />
      {error && <Alert message={error} />}
      {detailsTarget && (
        <p className="text-xs text-slate-500">
          New {mode} “{detailsTarget.name}” saved.{" "}
          <button type="button" className="font-medium text-brand-600 hover:underline" onClick={() => setDetailsOpen(true)}>
            Add phone / city (optional)
          </button>
        </p>
      )}
      <PartyModal
        open={detailsOpen}
        party={detailsTarget}
        mode={mode}
        onClose={() => setDetailsOpen(false)}
        onSaved={async (party) => {
          setDetailsOpen(false);
          setJustCreated(null);
          onChange(party);
          await onCreated?.(party);
        }}
      />
    </div>
  );
}
