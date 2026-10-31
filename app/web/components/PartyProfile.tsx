"use client";

import Link from "next/link";
import { useState } from "react";
import { DocumentHistory } from "@/components/DocumentHistory";
import { useCan } from "@/components/MeContext";
import { PartyModal, type Party } from "@/components/PartyModal";
import { CreditScoreBadge } from "@/components/CreditScoreBadge";
import { useCart } from "@/components/CartContext";
import { Alert, PageHeader, StatusBadge, TableSkeleton } from "@/components/ui";
import { dateTime, money } from "@/lib/format";
import { useApi } from "@/lib/useApi";
import { useRouter } from "next/navigation";

// Customer / supplier profile (V2 plan §3.2): contact details, lifetime totals (cancelled
// documents excluded), full document history with search and date filters, and a quick
// "New sale / New purchase" that starts the cart with this party already chosen.

interface Metrics { count: number; total: string; last: string | null }

export function PartyProfile({ mode, id }: { mode: "customer" | "supplier"; id: string }) {
  const router = useRouter();
  const cart = useCart();
  const isSupplier = mode === "supplier";
  const canEdit = useCan("party.edit");
  const canSell = useCan("sale.create");
  const canBuy = useCan("purchase.create");
  const seesPurchases = useCan("purchase.view");
  const { data, error, reload } = useApi<{ party: Party & { createdAt: string }; metrics: { sales: Metrics; purchases: Metrics | null } }>(`/parties/${id}`);
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState("");
  const [tab, setTab] = useState<"sale" | "purchase">(isSupplier ? "purchase" : "sale");

  if (error) return <Alert message={error} />;
  if (!data) return <TableSkeleton rows={6} />;
  const { party, metrics } = data;
  const both = party.type === "BOTH";
  const showSales = !isSupplier || both;
  const showPurchases = seesPurchases && (isSupplier || both);

  function start(kind: "sale" | "purchase") {
    if (cart.lines.length && cart.mode && cart.mode !== kind) {
      setFlash(`Complete or clear the current ${cart.mode} cart first.`);
      return;
    }
    cart.setParty(kind, { id: party.id, name: party.name, creditScore: party.creditScore });
    router.push(kind === "sale" ? "/sales/new" : "/purchases/new");
  }

  return (
    <div className="grid gap-4">
      <PageHeader
        back={{ href: isSupplier ? "/suppliers" : "/customers", label: isSupplier ? "Suppliers" : "Customers" }}
        title={party.name}
        badge={
          <div className="flex items-center gap-2">
            <StatusBadge status={party.active ? "ACTIVE" : "INACTIVE"} />
            {!isSupplier && <CreditScoreBadge score={party.creditScore ?? 0} showTier />}
          </div>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            {canEdit && <button className="btn-secondary" onClick={() => setEditing(true)}>Edit details</button>}
            {isSupplier && (
              <Link href={`/supplier-prices?supplierId=${party.id}`} className="btn-secondary">
                Products &amp; Pricing
              </Link>
            )}
            {showSales && canSell && party.active && <button className="btn-primary" onClick={() => start("sale")}>New sale</button>}
            {showPurchases && canBuy && party.active && <button className="btn-primary" onClick={() => start("purchase")}>New purchase</button>}
          </div>
        }
      />
      <Alert message={flash} />

      <section className="card grid gap-4 p-5 text-sm sm:grid-cols-3">
        <Info label="Phone">{party.phone || "—"}{party.altPhone ? ` · ${party.altPhone}` : ""}</Info>
        <Info label="Contact person">{party.contactPerson || "—"}</Info>
        <Info label="City">{party.city || "—"}</Info>
        {!isSupplier && <Info label="Category">{party.category || "—"}</Info>}
        <Info label="Address">{party.address || "—"}</Info>
        <Info label={isSupplier ? "Pickup / dispatch address" : "Delivery address"}>{party.shippingAddress || "Same as address"}</Info>
        <Info label="Since">{dateTime(party.createdAt)}</Info>
        {!isSupplier && (
          <Info label="Credit score">
            <CreditScoreBadge score={party.creditScore ?? 0} showTier />
          </Info>
        )}
        {party.notes && (
          <div className="sm:col-span-3">
            <Info label="Notes">{party.notes}</Info>
          </div>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {showSales && <Stat label="Lifetime sales" m={metrics.sales} noun="sale" />}
        {showPurchases && metrics.purchases && <Stat label="Lifetime purchases" m={metrics.purchases} noun="purchase" />}
      </section>

      {showSales && showPurchases && (
        <div className="flex gap-2" role="tablist">
          {(["sale", "purchase"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === k ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-200"}`} onClick={() => setTab(k)}>
              {k === "sale" ? "Sales" : "Purchases"}
            </button>
          ))}
        </div>
      )}
      <h2 className="text-sm font-semibold text-slate-700">{(showSales && showPurchases ? tab : showSales ? "sale" : "purchase") === "sale" ? "Sales" : "Purchases"} with {party.name}</h2>
      <DocumentHistory key={tab} mode={showSales && showPurchases ? tab : showSales ? "sale" : "purchase"} partyId={party.id} embedded />

      <PartyModal
        open={editing}
        party={party}
        mode={mode}
        onClose={() => setEditing(false)}
        onSaved={(_p, message) => {
          setEditing(false);
          setFlash(message);
          void reload();
        }}
      />
      <p className="text-xs text-slate-400">
        <Link href={isSupplier ? "/suppliers" : "/customers"} className="hover:underline">Back to list</Link>
      </p>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="whitespace-pre-line text-slate-800">{children}</div>
    </div>
  );
}

function Stat({ label, m, noun }: { label: string; m: Metrics; noun: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{money(m.total)}</div>
      <div className="text-xs text-slate-500">
        {m.count} {noun}{m.count === 1 ? "" : "s"}{m.last ? ` · last on ${dateTime(m.last)}` : ""} · cancelled ones not counted
      </div>
    </div>
  );
}
