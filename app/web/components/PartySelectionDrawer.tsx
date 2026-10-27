"use client";

import { useState } from "react";
import { useCart, type CartMode } from "@/components/CartContext";
import { Combobox } from "@/components/Combobox";
import { PlusIcon } from "@/components/icons";
import { useCan, useMe } from "@/components/MeContext";
import { PartyModal, type Party } from "@/components/PartyModal";
import { Alert } from "@/components/ui";
import { errorText, useApi } from "@/lib/useApi";

export function PartySelectionDrawer({
  mode,
  onSelected,
}: {
  mode: CartMode;
  onSelected: () => void;
}) {
  const cart = useCart();
  const me = useMe();
  const isSale = mode === "sale";
  const label = isSale ? "customer" : "supplier";
  const currentParty = cart.party?.mode === mode ? cart.party : null;
  const canAddParty = useCan("party.create") && (isSale || me?.user.role !== "sales_staff");
  const parties = useApi<{ parties: Party[] }>(`/parties?role=${label}`);
  const [showPartyModal, setShowPartyModal] = useState(false);
  const [presetName, setPresetName] = useState("");

  function selectParty(party: Party) {
    cart.setParty(mode, { id: party.id, name: party.name });
    onSelected();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={`Choose ${label}`}>
      <div className="absolute inset-0 bg-slate-900/50" aria-hidden="true" />
      <section className="relative z-10 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:p-6">
        <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-slate-200" aria-hidden="true" />
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                {isSale ? "New sale" : "New purchase"}
              </div>
              <h2 className="mt-1 text-xl font-bold text-slate-900">
                Select {label} to continue
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                This {label} will be attached to the {isSale ? "sale" : "purchase"} cart.
              </p>
            </div>
            <button
              type="button"
              className="text-sm font-semibold text-slate-400 hover:text-slate-700"
              onClick={onSelected}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

        {/* Quick choices: Walk-in (sales only) and Add later (sales + purchases) */}
        <div className="mb-4 grid gap-2.5 sm:grid-cols-2">
          {isSale && (
            <button
              type="button"
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-brand-500 hover:bg-brand-50/60 active:scale-[0.99]"
              onClick={() => {
                cart.setParty("sale", { id: "walk-in", name: "Walk-in customer" });
                onSelected();
              }}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800 font-bold text-sm">
                W
              </div>
              <div>
                <div className="font-semibold text-slate-900 text-sm">Normal / Walk-in</div>
                <div className="text-xs text-slate-500">Counter sale without saved customer</div>
              </div>
            </button>
          )}
          <button
            type="button"
            className={`flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-brand-500 hover:bg-brand-50/60 active:scale-[0.99] ${!isSale ? "sm:col-span-2" : ""}`}
            onClick={() => {
              cart.setParty(mode, null);
              onSelected();
            }}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-800 font-bold text-sm">
              +
            </div>
            <div>
              <div className="font-semibold text-slate-900 text-sm">Add later</div>
              <div className="text-xs text-slate-500">Start cart now, attach {label} before checkout</div>
            </div>
          </button>
        </div>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-2 font-medium text-slate-400">Or choose a registered {label}</span>
          </div>
        </div>

        {parties.error && <Alert message={parties.error} />}
        <label className="label" htmlFor="transaction-party">
          Registered {isSale ? "Customer" : "Supplier"}
        </label>
        <Combobox
          inputId="transaction-party"
          value={currentParty?.id ?? null}
          selectedLabel={currentParty?.name}
          options={(parties.data?.parties ?? []).map((party) => ({
            id: party.id,
            label: party.name,
            sublabel: [
              party.phone,
              party.city,
              isSale && typeof party.creditScore === "number" ? `Credit: ${party.creditScore}` : null,
            ].filter(Boolean).join(" · ") || undefined,
          }))}
          onSelect={(id) => {
            if (!id) return;
            const party = parties.data?.parties.find((item) => item.id === id);
            if (party) selectParty(party);
          }}
          onCreate={canAddParty ? (name) => {
            setPresetName(name);
            setShowPartyModal(true);
          } : undefined}
          createLabel={(name) => `Add new ${label} “${name}”`}
          placeholder={`Search ${label} name or phone…`}
          emptyText={`No ${label}s found`}
        />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {canAddParty ? (
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-1.5"
              onClick={() => {
                setPresetName("");
                setShowPartyModal(true);
              }}
            >
              <PlusIcon className="h-4 w-4" />
              Add {isSale ? "Customer" : "Supplier"}
            </button>
          ) : <span />}
          {parties.loading && <span className="text-xs text-slate-500">Loading {label}s…</span>}
        </div>

        {!canAddParty && !parties.loading && parties.data?.parties.length === 0 && (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            No {label}s are available. Ask an administrator to add one before starting this {isSale ? "sale" : "purchase"}.
          </p>
        )}
      </section>

      <PartyModal
        open={showPartyModal}
        party={null}
        mode={label}
        initialName={presetName}
        onClose={() => setShowPartyModal(false)}
        onSaved={(party) => {
          setShowPartyModal(false);
          selectParty(party);
        }}
      />
    </div>
  );
}
