"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useCart, type CartMode } from "@/components/CartContext";
import { DraftsButton } from "@/components/DraftsDrawer";
import { useCan, useMe } from "@/components/MeContext";
import type { Party } from "@/components/PartyModal";
import { CreditScoreBadge } from "@/components/CreditScoreBadge";
import { PartyPicker } from "@/components/PartyPicker";
import { ProductBrowser } from "@/components/ProductBrowser";
import { Alert, PageHeader } from "@/components/ui";
import { useApi } from "@/lib/useApi";

export function TransactionBuilder({ mode }: { mode: CartMode }) {
  const cart = useCart();
  const me = useMe();
  const isSale = mode === "sale";
  const label = isSale ? "customer" : "supplier";
  const party = cart.party?.mode === mode ? cart.party : null;
  const isWalkIn = party?.id === "walk-in";
  // Customers can be created by any role; suppliers not by sales_staff.
  const canAddParty = useCan("party.create") && (isSale || me?.user.role !== "sales_staff");
  const parties = useApi<{ parties: Party[] }>(`/parties?role=${label}`);
  const selectedCustomer = isSale && party && !isWalkIn ? parties.data?.parties?.find((p) => p.id === party.id) : null;
  const creditScore = typeof selectedCustomer?.creditScore === "number"
    ? selectedCustomer.creditScore
    : (typeof party?.creditScore === "number" ? party.creditScore : null);

  if (cart.lines.length > 0 && cart.mode && cart.mode !== mode) {
    const activeMode = cart.mode;
    const activeUrl = activeMode === "sale" ? "/sales/checkout" : "/purchases/checkout";
    return (
      <div className="grid gap-4">
        <PageHeader back={{ href: "/", label: "Home" }} title={isSale ? "New Sale" : "New Purchase"} />
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
    <div className="grid gap-3 sm:gap-4 pb-24">
      {/* Mobile-only compact top bar (<1024px) */}
      <div className="flex items-center justify-between gap-2 lg:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 shadow-xs hover:bg-slate-50"
            aria-label="Back to Home"
            title="Back to Home"
          >
            ←
          </Link>
          <h1 className="truncate text-lg font-bold text-slate-900">
            {isSale ? "New Sale" : "New Purchase"}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DraftsButton mode={mode} />
          {cart.count > 0 && cart.mode === mode && (
            <button
              type="button"
              className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-100"
              onClick={() => {
                if (window.confirm(`Remove all ${cart.count} item${cart.count > 1 ? "s" : ""} from the cart?`)) {
                  cart.clear();
                }
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Desktop PageHeader (>=1024px) */}
      <div className="hidden lg:block">
        <PageHeader
          back={{ href: "/", label: "Home" }}
          title={isSale ? "New Sale" : "New Purchase"}
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
            </div>
          }
        />
      </div>

      <section className="card grid gap-2 p-3 sm:p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center">
        <div className="flex items-center justify-between sm:block">
          <label className="text-sm font-semibold text-slate-900" htmlFor="transaction-party">
            {isSale ? "Customer" : "Supplier"}
          </label>
          {isSale && !party && (
            <button
              type="button"
              className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 sm:hidden"
              onClick={() => cart.setParty("sale", { id: "walk-in", name: "Walk-in customer" })}
            >
              Walk-in
            </button>
          )}
        </div>
        {isWalkIn ? (
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm">
            <span className="font-medium text-slate-800 text-xs sm:text-sm">Walk-in customer</span>
            <button type="button" className="text-xs font-semibold text-brand-600 hover:underline" onClick={() => cart.setParty(mode, null)}>
              Change
            </button>
          </div>
        ) : (
          <div className="grid gap-1.5 min-w-0">
            <PartyPicker
              inputId="transaction-party"
              mode={label}
              parties={parties.data?.parties ?? []}
              value={party?.id ?? null}
              selectedLabel={party?.name}
              creditScore={creditScore}
              canAdd={canAddParty}
              onChange={(p) => cart.setParty(mode, p ? { id: p.id, name: p.name, creditScore: p.creditScore } : null)}
              onCreated={() => parties.reload()}
            />
            {isSale && party && !isWalkIn && creditScore !== null && (
              <div className="flex items-center gap-2 text-xs sm:hidden">
                <span className="font-medium text-slate-600">Credit Score:</span>
                <CreditScoreBadge score={creditScore} showTier />
              </div>
            )}
          </div>
        )}
        <div className="hidden sm:flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {isSale && party && !isWalkIn && creditScore !== null && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-700">
              <span className="font-medium">Credit Score:</span>
              <CreditScoreBadge score={creditScore} showTier />
            </div>
          )}
          {isSale && !isWalkIn && (
            <button
              type="button"
              className="rounded-full bg-slate-100 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-200"
              onClick={() => cart.setParty("sale", { id: "walk-in", name: "Walk-in customer" })}
            >
              Walk-in
            </button>
          )}
          {!party && <span>Optional now — can be added at checkout</span>}
        </div>
        {parties.error && <div className="sm:col-span-3"><Alert message={parties.error} /></div>}
      </section>

      <Suspense fallback={<div className="card p-4 text-sm text-slate-500">Loading catalog…</div>}>
        <ProductBrowser mode={mode} />
      </Suspense>
    </div>
  );
}
