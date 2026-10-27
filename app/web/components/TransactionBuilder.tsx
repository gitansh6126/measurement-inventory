"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useCart, type CartMode } from "@/components/CartContext";
import { DraftsButton } from "@/components/DraftsDrawer";
import { PartySelectionDrawer } from "@/components/PartySelectionDrawer";
import { ProductBrowser } from "@/components/ProductBrowser";
import { PageHeader } from "@/components/ui";

export function TransactionBuilder({ mode }: { mode: CartMode }) {
  const cart = useCart();
  const isSale = mode === "sale";
  const label = isSale ? "customer" : "supplier";
  const party = cart.party?.mode === mode ? cart.party : null;
  const [partyDismissed, setPartyDismissed] = useState(false);
  const [partyOpen, setPartyOpen] = useState(!party);

  useEffect(() => {
    if (!party && !partyDismissed) setPartyOpen(true);
  }, [party, partyDismissed]);

  if (cart.lines.length > 0 && cart.mode && cart.mode !== mode) {
    const activeMode = cart.mode;
    const activeUrl = activeMode === "sale" ? "/sales/checkout" : "/purchases/checkout";
    return (
      <div className="grid gap-4">
        <PageHeader back={{ href: isSale ? "/sales" : "/purchases", label: "History" }} title={isSale ? "New Sale" : "New Purchase"} />
        <div className="card grid justify-items-start gap-3 p-6">
          <p className="font-semibold text-slate-900">
            Complete or clear the current {activeMode} cart before starting a {mode}.
          </p>
          <Link href={activeUrl} className="btn-primary">Open {activeMode} cart</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 pb-24">
      <PageHeader
        back={{ href: isSale ? "/sales" : "/purchases", label: "History" }}
        title={isSale ? "New Sale" : "New Purchase"}
        subtitle={
          party?.id === "walk-in"
            ? `${isSale ? "Customer" : "Supplier"}: Walk-in customer`
            : party
            ? `${isSale ? "Customer" : "Supplier"}: ${party.name}`
            : `${isSale ? "Customer" : "Supplier"}: Not selected (Add later)`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <DraftsButton mode={mode} />
            {cart.count > 0 && cart.mode === mode && (
              <button
                type="button"
                className="btn-secondary text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                onClick={() => {
                  if (window.confirm(`Remove all ${cart.count} item${cart.count > 1 ? "s" : ""} from the cart?`)) {
                    cart.clear();
                  }
                }}
              >
                Clear cart
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPartyOpen(true)}
            >
              {party ? `Change ${label}` : `Select ${label}`}
            </button>
          </div>
        }
      />
      {!partyOpen && (
        <Suspense fallback={<div className="card p-4 text-sm text-slate-500">Loading catalog…</div>}>
          <ProductBrowser mode={mode} />
        </Suspense>
      )}
      {partyOpen && (
        <PartySelectionDrawer
          mode={mode}
          onSelected={() => {
            setPartyOpen(false);
            setPartyDismissed(true);
          }}
        />
      )}
    </div>
  );
}
