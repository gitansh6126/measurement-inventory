"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCart, type CartLine, type CartMode } from "@/components/CartContext";
import { CloseIcon } from "@/components/icons";
import { useCan } from "@/components/MeContext";
import { SearchInput } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { errorText, useApi } from "@/lib/useApi";

// "Drafts (N)" queue for held carts (V2 plan §3.4). Drafts are shared by the whole company, so a
// floor associate can park an order and the cashier can finish it. Opening a draft re-checks
// stock and prices (it never reserved stock); resuming loads it into the cart.

interface DraftRow {
  id: string;
  title: string;
  partyId: string | null;
  partyName: string | null;
  estimatedTotal: string;
  lineCount: number;
  version: number;
  updatedAt: string;
  createdBy: string | null;
}
interface DraftLine {
  variationId: string;
  quantity: number;
  price: string;
  discount?: string;
  note?: string | null;
  missing?: boolean;
  productId?: string;
  productName?: string;
  shortName?: string;
  unit?: string;
  attributes?: Record<string, string>;
  imageUrl?: string | null;
  active?: boolean;
  available?: number;
  shortage?: number;
  currentPrice?: string | null;
  priceChanged?: boolean;
  sets?: CartLine["sets"];
  saleSets?: CartLine["saleSets"];
  setSummaries?: string[];
  setDetails?: CartLine["setDetails"];
}

const apiMode = (m: CartMode) => (m === "sale" ? "SALE" : "PURCHASE");

export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** "Drafts (N)" button; opens the queue. */
export function DraftsButton({ mode, className = "btn-secondary" }: { mode: CartMode; className?: string }) {
  const allowed = useCan(mode === "sale" ? "sale.create" : "purchase.create");
  const { data } = useApi<{ count: number }>(allowed ? `/drafts?mode=${apiMode(mode)}` : null);
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} title="Held carts">
        Drafts ({data?.count ?? 0})
      </button>
      {open && <DraftsDrawer mode={mode} onClose={() => setOpen(false)} />}
    </>
  );
}

export function DraftsDrawer({ mode, onClose }: { mode: CartMode; onClose: () => void }) {
  const router = useRouter();
  const cart = useCart();
  const [q, setQ] = useState("");
  const { data, error } = useApi<{ drafts: DraftRow[] }>(`/drafts?mode=${apiMode(mode)}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`);
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useApi<{ draft: DraftRow & { lines: DraftLine[] } }>(openId ? `/drafts/${openId}` : null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const otherCartBusy = cart.lines.length > 0 && cart.mode !== null && cart.mode !== mode;
  const sameCartBusy = cart.lines.length > 0 && cart.mode === mode && cart.draft?.id !== openId;

  function resume(how: "replace" | "append") {
    const d = detail.data?.draft;
    if (!d) return;
    const lines: CartLine[] = d.lines
      .filter((l) => !l.missing && l.active !== false)
      .map((l) => ({
        variationId: l.variationId,
        productId: l.productId!,
        productName: l.productName!,
        shortName: l.shortName!,
        attributes: l.attributes ?? {},
        unit: l.unit ?? "",
        imageUrl: l.imageUrl ?? null,
        // The quoted price stays; the checkout shows the current catalog price next to it.
        price: l.price,
        quantity: l.quantity,
        available: l.available ?? 0,
        discount: l.discount ?? "",
        note: l.note ?? "",
        // V3.1 grouped purchase lines keep their sets.
        ...(l.sets ? { sets: l.sets, setSummaries: l.setSummaries ?? [], ...(l.setDetails ? { setDetails: l.setDetails } : {}) } : {}),
        // V3.1 grouped sale lines keep their picked sets (re-checked at checkout).
        ...(l.saleSets ? { saleSets: l.saleSets, setSummaries: l.setSummaries ?? [], ...(l.setDetails ? { setDetails: l.setDetails } : {}) } : {}),
      }));
    cart.loadDraft(mode, { id: d.id, title: d.title, version: d.version }, lines, d.partyId && d.partyName ? { id: d.partyId, name: d.partyName } : null, how);
    onClose();
    router.push(mode === "sale" ? "/sales/checkout" : "/purchases/checkout");
  }

  async function discard(id: string) {
    if (!confirm("Discard this draft? It cannot be resumed afterwards.")) return;
    setBusy(true);
    try {
      await api(`/drafts/${id}/discard`, { method: "POST", body: {} });
      if (cart.draft?.id === id) cart.setDraft(null);
      setOpenId(null);
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const d = detail.data?.draft;
  const shortLines = d?.lines.filter((l) => (l.shortage ?? 0) > 0) ?? [];
  const priceLines = d?.lines.filter((l) => l.priceChanged) ?? [];
  const goneLines = d?.lines.filter((l) => l.missing || l.active === false) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-slate-900/50" onClick={onClose} aria-hidden />
      <div className="relative z-50 flex h-full w-full max-w-md flex-col bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={`${mode === "sale" ? "Sale" : "Purchase"} drafts`}>
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Held {mode === "sale" ? "sale" : "purchase"} carts</h2>
          <button className="rounded-full p-1.5 text-slate-400 hover:bg-slate-200" onClick={onClose} aria-label="Close drafts"><CloseIcon className="h-5 w-5" /></button>
        </div>
        <div className="border-b border-slate-100 p-3"><SearchInput value={q} onChange={setQ} placeholder="Search by name or customer…" /></div>
        {(error || msg) && <p className="m-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error || msg}</p>}
        <div className="flex-1 overflow-y-auto">
          {!data ? (
            <p className="p-5 text-sm text-slate-500">Loading…</p>
          ) : data.drafts.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No held carts. Use “Hold cart” at checkout to park one.</p>
          ) : (
            data.drafts.map((r) => (
              <div key={r.id} className={`border-b border-slate-100 ${openId === r.id ? "bg-brand-50/50" : ""}`}>
                <button className="w-full px-5 py-3 text-left hover:bg-slate-50" onClick={() => setOpenId(openId === r.id ? null : r.id)} aria-expanded={openId === r.id}>
                  <div className="font-medium text-slate-900">{r.title}</div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {r.partyName ?? "Walk-in"} · {r.lineCount} item(s) · {money(r.estimatedTotal)} · {r.createdBy ?? "—"} · parked {ago(r.updatedAt)}
                  </div>
                </button>
                {openId === r.id && (
                  <div className="space-y-2 px-5 pb-4 text-sm">
                    {!d ? (
                      <p className="text-slate-500">Checking stock and prices…</p>
                    ) : (
                      <>
                        {shortLines.map((l) => (
                          <p key={l.variationId} className="rounded bg-amber-50 px-2 py-1 text-amber-800">
                            Stock changed: {l.productName} {l.shortName} — {l.available} on hand, draft requests {l.quantity}
                          </p>
                        ))}
                        {priceLines.map((l) => (
                          <p key={l.variationId} className="rounded bg-sky-50 px-2 py-1 text-sky-800">
                            Price changed: {l.productName} {l.shortName} — quoted {money(l.price)}, now {money(l.currentPrice ?? "0")} (quoted price kept)
                          </p>
                        ))}
                        {goneLines.length > 0 && <p className="rounded bg-slate-100 px-2 py-1 text-slate-700">{goneLines.length} archived item(s) will be left out.</p>}
                        {otherCartBusy && <p className="text-rose-700">The {cart.mode} cart has items. Complete or clear it first.</p>}
                        <div className="flex flex-wrap gap-2 pt-1">
                          {sameCartBusy ? (
                            <>
                              <button className="btn-primary" disabled={otherCartBusy} onClick={() => resume("replace")} title="The current cart is cleared — hold it first to keep it">Replace current cart</button>
                              <button className="btn-secondary" disabled={otherCartBusy} onClick={() => resume("append")}>Add to current cart</button>
                            </>
                          ) : (
                            <button className="btn-primary" disabled={otherCartBusy} onClick={() => resume("replace")}>Resume</button>
                          )}
                          <button className="btn-secondary text-rose-600" disabled={busy} onClick={() => discard(r.id)}>Discard</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
