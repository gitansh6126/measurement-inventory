"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useCan } from "@/components/MeContext";
import { ShiftIcon } from "@/components/icons";
import { ProductThumb } from "@/components/ProductThumb";
import { freeIn, ShiftItemDrawer, type Line } from "@/components/shifts/ShiftItemDrawer";
import { Alert, Field, PageHeader, SearchInput } from "@/components/ui";
import { api } from "@/lib/api";
import { qty, variationLabel } from "@/lib/format";
import type { InventoryList, StockProduct, TransferDetail } from "@/lib/types";
import { contentsText } from "@/components/sets/SetContents";
import { errorText, useApi } from "@/lib/useApi";
import { useWarehouses } from "@/lib/useWarehouses";

// V3.1 New shift (docs\WAREHOUSE-V3-PLAN.md §4.2, WH-9…WH-11, GW-3): From / To, items by quantity,
// measured rolls whole (tick roll codes), grouped products as whole sets. Products are picked the
// sale/purchase way: tap a card, choose options in the bottom drawer (ShiftItemDrawer). Pre-filled
// from Stock In with ?from=<warehouseId>&variation=<variationId>.

export default function NewShiftPage() {
  return (
    <Suspense>
      <NewShift />
    </Suspense>
  );
}

function NewShift() {
  const router = useRouter();
  const params = useSearchParams();
  const canShift = useCan("stock.transfer");
  const wh = useWarehouses();
  const [from, setFrom] = useState(params.get("from") ?? "");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [clientRef] = useState(() => crypto.randomUUID());
  const [open, setOpen] = useState<{ product: StockProduct; focus?: string | null } | null>(null);

  // Defaults: From = default warehouse, To = the next active one.
  useEffect(() => {
    if (!wh.loaded || !wh.active.length) return;
    const f = from || wh.defaultWarehouse?.id || wh.active[0]!.id;
    if (!from) setFrom(f);
    if (!to) setTo(wh.active.find((w) => w.id !== f)?.id ?? "");
  }, [wh.loaded, wh.active, wh.defaultWarehouse, from, to]);

  // No search yet: show the first products so the user can browse, like the sale/purchase catalog.
  const { data: found } = useApi<InventoryList>(`/inventory?${q.trim() ? `q=${encodeURIComponent(q.trim())}&` : ""}page=1&pageSize=24&status=active`);
  // Pre-fill from Stock In ("Shift" on a row): open the drawer on that variation.
  const preVariation = params.get("variation");
  const [preDone, setPreDone] = useState(false);
  const { data: pre } = useApi<InventoryList>(preVariation && !preDone ? `/inventory?page=1&pageSize=200&status=active` : null);
  useEffect(() => {
    if (!pre || !preVariation || preDone) return;
    const p = pre.products.find((x) => x.variations.some((v) => v.id === preVariation));
    if (p) setOpen({ product: p, focus: preVariation });
    setPreDone(true);
  }, [pre, preVariation, preDone]);

  const fromCode = wh.codeOf(from);

  function swap() {
    setFrom(to);
    setTo(from);
    setLines([]);
  }

  async function submit() {
    setError("");
    setBusy(true);
    try {
      const body = {
        fromWarehouseId: from,
        toWarehouseId: to,
        notes: notes.trim() || null,
        clientRef,
        lines: lines.map((l) => (l.kind === "item" ? { variationId: l.variation.id, quantity: l.quantity } : l.kind === "piece" ? { pieceId: l.piece.id } : { setId: l.set.id })),
      };
      const res = await api<{ transfer: TransferDetail }>("/transfers", { method: "POST", body });
      router.push(`/shifts/${res.transfer.id}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  if (!canShift) {
    return (
      <div>
        <PageHeader back={{ href: "/shifts", label: "Shifts" }} title="New shift" />
        <Alert message="Only an admin or a sales manager shifts stock." />
      </div>
    );
  }

  const valid = from && to && from !== to && lines.length > 0 && lines.every((l) => l.kind !== "item" || (l.quantity > 0 && l.quantity <= freeIn(l.variation, from)));

  return (
    <div className="max-w-6xl">
      <PageHeader back={{ href: "/shifts", label: "Shifts" }} title="New shift" subtitle="Move stock from one warehouse to another" />
      <Alert message={error} />
      {wh.loaded && wh.active.length < 2 && <Alert message="Add a second warehouse first (Warehouses page)." />}

      <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
        <Field label="From" className="w-56">
          <select
            className="input"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setLines([]);
            }}
          >
            {wh.active.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
        </Field>
        <button type="button" className="btn-secondary mb-0.5" onClick={swap} title="Swap From and To" aria-label="Swap From and To">
          <ShiftIcon className="h-4 w-4" />
        </button>
        <Field label="To" className="w-56">
          <select className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose…</option>
            {wh.active
              .filter((w) => w.id !== from)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Note (optional)" className="min-w-[14rem] flex-1">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="e.g. Shop display stock" />
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Find items in {fromCode || "From"}</h2>
          <SearchInput value={q} onChange={setQ} placeholder="Search product, short name or SKU…" />
          <div className="mt-3 grid max-h-[32rem] grid-cols-2 gap-3 overflow-y-auto p-0.5 sm:grid-cols-3">
            {(found?.products ?? []).map((p) => (
              <ProductCard key={p.id} product={p} from={from} fromCode={fromCode} inShift={lines.filter((l) => l.product.id === p.id).length} onOpen={() => setOpen({ product: p })} />
            ))}
          </div>
          {found && !found.products.length && <p className="text-sm text-slate-500">Nothing found.</p>}
        </section>

        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">
            Shifting {fromCode} → {wh.codeOf(to) || "…"} ({lines.length} line{lines.length === 1 ? "" : "s"})
          </h2>
          {!lines.length ? (
            <p className="text-sm text-slate-500">Tap a product on the left, choose its options, and add it here.</p>
          ) : (
            <table className="table">
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      <button
                        type="button"
                        className="text-left hover:text-brand-700"
                        title="Change"
                        onClick={() => setOpen({ product: l.product, focus: l.kind === "set" ? null : l.variation.id })}
                      >
                        <div className="font-medium text-slate-900">{l.product.name}</div>
                        <div className="text-xs text-slate-500">
                          {l.kind === "set" ? contentsText(l.set.contents) : l.kind === "piece" ? l.label : variationLabel(l.variation, l.product.attributes) || l.variation.shortName}
                        </div>
                      </button>
                    </td>
                    <td className="w-36 text-right">
                      {l.kind === "item" ? (
                        <div>
                          <input
                            type="number"
                            min={1}
                            max={freeIn(l.variation, from)}
                            className="input w-24 text-right"
                            value={l.quantity}
                            onChange={(e) => setLines(lines.map((x) => (x.key === l.key && x.kind === "item" ? { ...x, quantity: Math.max(0, Math.floor(Number(e.target.value))) } : x)))}
                          />
                          <div className={`text-[11px] ${l.quantity > freeIn(l.variation, from) ? "text-rose-600" : "text-slate-400"}`}>
                            max {qty(freeIn(l.variation, from))} in {fromCode}
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">whole</span>
                      )}
                    </td>
                    <td className="w-10">
                      <button type="button" className="text-slate-400 hover:text-rose-600" aria-label="Remove" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-4 flex justify-end">
            <button type="button" className="btn-primary" disabled={!valid || busy} onClick={submit}>
              <ShiftIcon className="h-4 w-4" /> {busy ? "Shifting…" : "Shift stock"}
            </button>
          </div>
        </section>
      </div>

      {open && (
        <ShiftItemDrawer
          key={`${open.product.id}|${open.focus ?? ""}`}
          product={open.product}
          from={from}
          fromCode={fromCode}
          lines={lines}
          setLines={setLines}
          focusVariationId={open.focus}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}

/** Catalog-style card (ProductBrowser): free stock in From, variations count, lines already picked. */
function ProductCard({ product, from, fromCode, inShift, onOpen }: { product: StockProduct; from: string; fromCode: string; inShift: number; onOpen: () => void }) {
  const active = product.variations.filter((v) => v.active);
  const counted = product.productType !== "measured" && product.productType !== "grouped";
  const free = counted ? active.reduce((s, v) => s + freeIn(v, from), 0) : null;
  const action = product.productType === "measured" ? "Choose rolls" : product.productType === "grouped" ? "Choose sets" : product.productType === "variable" ? "Choose options" : "Add";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group card relative flex min-w-0 flex-col overflow-hidden text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
        free === 0 ? "opacity-60" : ""
      }`}
    >
      {inShift > 0 && <span className="absolute top-2 right-2 z-10 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow">{inShift} in shift</span>}
      <div className="w-full overflow-hidden bg-slate-100">
        <ProductThumb src={product.imageUrl} name={product.name} className="aspect-[4/3] w-full text-xl transition-transform duration-300 group-hover:scale-105" />
      </div>
      <div className="grid w-full flex-1 gap-1 p-3 pb-2">
        <div className="line-clamp-2 text-sm font-semibold text-slate-900">{product.name}</div>
        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="truncate">{active.length > 1 ? `${active.length} variations` : (active[0]?.shortName ?? "")}</span>
          {free !== null && (
            <span className={`shrink-0 rounded px-1.5 font-semibold ${free > 0 ? "bg-brand-50 text-brand-700" : "bg-slate-100 text-slate-400"}`}>
              {fromCode} {qty(free)}
            </span>
          )}
        </div>
      </div>
      <div className="px-3 pb-3">
        <span className={`block w-full rounded-md py-1.5 text-center text-xs font-semibold ${free === 0 ? "bg-slate-100 text-slate-400" : "border border-slate-300 text-slate-700 group-hover:border-brand-500 group-hover:text-brand-700"}`}>
          {free === 0 ? `None free in ${fromCode}` : action}
        </span>
      </div>
    </button>
  );
}
