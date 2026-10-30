"use client";

import { useMemo, useState } from "react";
import { ViewToggle } from "@/components/catalog/ViewToggle";
import { Combobox } from "@/components/Combobox";
import { useCan } from "@/components/MeContext";
import { Alert, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { GroupedInfo, GroupSet, Product, SetContentRow, SetStatus } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { SetContents } from "./SetContents";
import { buildSets, emptyRow, SetSheetTable, type SheetRow } from "./SetSheet";
import { moved } from "@/lib/useRowOrder";
import { useViewMode } from "@/lib/useViewMode";
import { useWarehouses } from "@/lib/useWarehouses";

// V3.1 grouped product page → Sets (docs\GROUPED-PRODUCTS-V3-PLAN.md §4): what a set contains,
// the sets in stock (named by contents, D18; codes are never shown, search only), admin opening sets (D20) and
// cancelling an untouched one, and changing the by-product links (§2 Edit).


const STATUS_LABEL: Record<SetStatus, string> = { IN_STOCK: "In stock", HELD: "Held on order", SOLD: "Sold", CANCELLED: "Cancelled" };
const STATUS_CLASS: Record<SetStatus, string> = {
  IN_STOCK: "bg-emerald-50 text-emerald-700",
  HELD: "bg-amber-50 text-amber-700",
  SOLD: "bg-slate-100 text-slate-600",
  CANCELLED: "bg-rose-50 text-rose-700",
};

export function SetsPanel({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const canOpening = useCan("set.opening");
  const canEdit = useCan("product.write");
  const [status, setStatus] = useState<SetStatus | "all">("IN_STOCK");
  const sets = useApi<{ sets: GroupSet[]; counts: Record<SetStatus, number> }>(`/sets?groupId=${product.id}&status=${status}`);
  const [opening, setOpening] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState<GroupSet | null>(null);
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  // Table (default, like a variation product's rows) or Grid cards; the choice is remembered.
  const [view, setView] = useViewMode("sets", "table");
  const info = product.grouped;
  const counts = sets.data?.counts;
  const wh = useWarehouses();
  const refresh = () => {
    sets.reload();
    onChanged();
  };
  // A set card lists the main part, then every by-product (an optional one not fitted says so).
  const cardRows = (s: GroupSet): SetContentRow[] => {
    const main = s.parts.find((p) => p.role === "MAIN");
    const linked = (info?.byproducts ?? []).flatMap((b) => {
      const part = s.parts.find((p) => p.role === "BY" && p.byproductId === b.id);
      return part ? [{ name: b.name, value: part.value }] : b.required ? [] : [{ name: b.name, value: "Not fitted" }];
    });
    const unlinked = s.parts.filter((p) => p.role === "BY" && !(info?.byproducts ?? []).some((b) => b.id === p.byproductId)).map((p) => ({ name: p.productName, value: p.value }));
    return [...(main ? [{ name: main.productName, value: "Main part" }] : []), ...linked, ...unlinked];
  };
  // Table columns: every by-product of the product, then any part whose link was removed later
  // (the main part is the same in every set, so it is named once above the table).
  const partNames = [
    ...(info?.byproducts ?? []).map((b) => b.name),
    ...new Set((sets.data?.sets ?? []).flatMap((s) => cardRows(s).slice(1).map((r) => r.name)).filter((n) => !(info?.byproducts ?? []).some((b) => b.name === n))),
  ];

  return (
    <section className="card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            Sets <span className="text-sm font-normal text-slate-500">{counts ? `${counts.IN_STOCK} in stock` : ""}</span>
          </h3>
          <p className="text-xs text-slate-500">Each set is one physical unit. Its parts stay in their own products' stock and show there as “In sets”.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <button type="button" className="btn-secondary text-xs" onClick={() => setEditing(true)}>
              Change by-products
            </button>
          )}
          {canOpening && (
            <button type="button" className="btn-primary text-xs" onClick={() => setOpening(true)}>
              + Add opening sets
            </button>
          )}
        </div>
      </div>
      <Alert message={flash?.text} kind={flash?.kind} />

      {/* What a set contains */}
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-brand-200 bg-brand-50 px-3 py-1 font-medium text-brand-800">
          Main: {info?.main?.name ?? "—"}
        </span>
        {info?.byproducts.map((b) => (
          <span key={b.id} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700">
            {b.name} <span className="text-slate-400">· {b.productType === "measured" ? "length per set" : "1 per set"} · {b.required ? "required" : "optional"}</span>
          </span>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap gap-1 text-xs" role="tablist" aria-label="Set status">
        {(["IN_STOCK", "HELD", "SOLD", "CANCELLED", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={status === s}
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 ${status === s ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {s === "all" ? "All" : STATUS_LABEL[s]}
            {counts && s !== "all" ? ` ${counts[s]}` : ""}
          </button>
        ))}
      </div>
        <ViewToggle value={view} onChange={setView} />
      </div>

      {sets.error && <Alert message={sets.error} />}
      {!sets.data && !sets.error && <p className="text-sm text-slate-500">Loading sets…</p>}
      {sets.data && sets.data.sets.length === 0 && (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No {status === "all" ? "" : STATUS_LABEL[status as SetStatus].toLowerCase()} sets. Sets come from purchases{canOpening ? " or “Add opening sets”" : ""}.
        </p>
      )}
      {view === "table" && !!sets.data?.sets.length && (
        <div className="overflow-x-auto">
          <table className="table rounded-md bg-white">
            <thead>
              <tr>
                <th className="w-10">#</th>
                {partNames.map((n) => (
                  <th key={n}>{n}</th>
                ))}
                {wh.enabled && <th>Warehouse</th>}
                <th>Status</th>
                {canOpening && <th className="text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {sets.data.sets.map((s, i) => {
                const rows = cardRows(s);
                return (
                  <tr key={s.id}>
                    <td className="text-slate-400">{i + 1}</td>
                    {partNames.map((n) => {
                      const v = rows.find((r) => r.name === n)?.value;
                      return (
                        <td key={n} className={!v || v === "Not fitted" ? "text-slate-400" : "font-medium text-slate-800"}>
                          {v ?? "—"}
                          {n === partNames[partNames.length - 1] && s.notes && <div className="text-[11px] font-normal italic text-slate-500">{s.notes}</div>}
                        </td>
                      );
                    })}
                    {wh.enabled && <td className="text-slate-600">{s.warehouseId ? wh.codeOf(s.warehouseId) : "—"}</td>}
                    <td>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[s.status]}`}>{STATUS_LABEL[s.status]}</span>
                    </td>
                    {canOpening && (
                      <td className="text-right text-xs">
                        {s.source === "OPENING" && s.status === "IN_STOCK" && (
                          <button type="button" className="text-rose-600 hover:underline" onClick={() => setCancelling(s)}>
                            Cancel
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {view === "grid" && (
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {sets.data?.sets.map((s) => (
          <li key={s.id} className="rounded-xl border border-slate-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-900">{s.name}</div>
              </div>
              <span className="flex shrink-0 items-center gap-1">
                {wh.enabled && s.warehouseId && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-600" title={wh.byId.get(s.warehouseId)?.name}>
                    {wh.codeOf(s.warehouseId)}
                  </span>
                )}
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[s.status]}`}>{STATUS_LABEL[s.status]}</span>
              </span>
            </div>
            <SetContents className="mt-2" rows={cardRows(s)} />
            {canOpening && s.source === "OPENING" && s.status === "IN_STOCK" && (
              <div className="mt-2 flex justify-end border-t border-slate-100 pt-2 text-[11px]">
                <button type="button" className="text-rose-600 hover:underline" onClick={() => setCancelling(s)}>
                  Cancel
                </button>
              </div>
            )}
            {s.notes && <p className="mt-1 text-[11px] italic text-slate-500">{s.notes}</p>}
          </li>
        ))}
      </ul>
      )}

      {opening && info && (
        <OpeningSetsModal
          product={product}
          info={info}
          onClose={() => setOpening(false)}
          onSaved={(n) => {
            setOpening(false);
            setFlash({ kind: "success", text: `${n} opening set${n === 1 ? "" : "s"} added.` });
            refresh();
          }}
        />
      )}
      {editing && info && (
        <DefinitionModal
          product={product}
          info={info}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setFlash({ kind: "success", text: "By-products updated. They apply to sets added from now on." });
            refresh();
          }}
        />
      )}
      {cancelling && (
        <CancelSetModal
          set={cancelling}
          onClose={() => setCancelling(null)}
          onSaved={() => {
            setCancelling(null);
            setFlash({ kind: "success", text: `${cancelling.name} cancelled.` });
            refresh();
          }}
        />
      )}
    </section>
  );
}

/** Stock In → grouped row → "+ Add sets": the opening-sets sheet for one grouped product. */
export function AddSetsModal({ productId, onClose, onSaved }: { productId: string; onClose: () => void; onSaved: (n: number) => void }) {
  const { data, error } = useApi<{ product: Product }>(`/products/${productId}`);
  const product = data?.product;
  if (product?.grouped) return <OpeningSetsModal product={product} info={product.grouped} onClose={onClose} onSaved={onSaved} />;
  return (
    <Modal open title="Add sets" onClose={onClose}>
      {error ? <Alert message={error} /> : <p className="text-sm text-slate-500">{product ? `${product.name} is not a grouped product.` : "Loading…"}</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Admin opening sets (D20): the shared set sheet (components\sets\SetSheet.tsx) with a date.
// ---------------------------------------------------------------------------

function OpeningSetsModal({ product, info, onClose, onSaved }: { product: Product; info: GroupedInfo; onClose: () => void; onSaved: (n: number) => void }) {
  const defaultRate = product.variations[0] && Number(product.variations[0].purchaseCost) > 0 ? product.variations[0].purchaseCost.split(".")[0]! : "";
  const [rows, setRows] = useState<SheetRow[]>(() => [emptyRow(info, 1, defaultRate)]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const wh = useWarehouses();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setError("");
    try {
      const sets = buildSets(info, rows, { rateRequired: false, prices: true });
      setSaving(true);
      const res = await api<{ sets: { code: string }[] }>("/sets/opening", { method: "POST", body: { groupId: product.id, date: new Date(`${date}T09:00:00`).toISOString(), sets } });
      onSaved(res.sets.length);
    } catch (e) {
      setError(e instanceof Error && !("status" in e) ? e.message : errorText(e));
      setSaving(false);
    }
  }

  return (
    <Modal open title={`Add opening sets · ${product.name}`} onClose={onClose} xl>
      <p className="mb-3 text-xs text-slate-500">
        Sets already in the shop at go-live (no supplier or bill). Each row is one set: pick every by-product's variation, and the length for chain or rope.
        The set code is made from these parts and the date.
      </p>
      <label className="mb-3 block w-48">
        <span className="label">Date</span>
        <input autoComplete="off" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <SetSheetTable groupId={product.id} prices info={info} rows={rows} setRows={setRows} defaultRate={defaultRate} defaultWarehouseLabel={`Default (${wh.codeOf(wh.defaultWarehouse?.id)})`} />
      <div className="mt-2 text-xs text-slate-500">
        {rows.length} set{rows.length === 1 ? "" : "s"} · total value {money(String(rows.reduce((s, r) => s + (Number(r.rate) || 0), 0)))}
      </div>
      <div className="mt-3">
        <Alert message={error} />
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
          Close
        </button>
        <button type="button" className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : `Add ${rows.length} set${rows.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </Modal>
  );
}

function CancelSetModal({ set, onClose, onSaved }: { set: GroupSet; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    setError("");
    try {
      await api(`/sets/${set.id}/cancel-opening`, { method: "POST", body: { reason } });
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }
  return (
    <Modal open title="Cancel opening set" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">
        {set.name}. Its parts leave stock again. Use this only for a wrongly entered opening set.
      </p>
      <label className="block">
        <span className="label">Reason *</span>
        <input autoComplete="off" className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice" />
      </label>
      <div className="mt-3">
        <Alert message={error} />
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
          Keep set
        </button>
        <button type="button" className="btn-danger" onClick={save} disabled={saving || reason.trim().length < 3}>
          {saving ? "Cancelling…" : "Cancel set"}
        </button>
      </div>
    </Modal>
  );
}

let defSeq = 0;

function DefinitionModal({ product, info, onClose, onSaved }: { product: Product; info: GroupedInfo; onClose: () => void; onSaved: () => void }) {
  // One row per link; the same product may repeat (two chains), told apart by its label.
  type Row = { key: string; linkId: string | null; productId: string; name: string; label: string; required: boolean };
  const [rows, setRows] = useState<Row[]>(() =>
    info.byproducts.map((b) => ({ key: b.id, linkId: b.id, productId: b.productId, name: b.productName ?? b.name, label: b.label ?? "", required: b.required })),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const list = useApi<{ products: Product[] }>("/products?status=active&pageSize=200");
  const options = useMemo(
    () => (list.data?.products ?? []).filter((p) => p.productType !== "grouped").map((p) => ({ id: p.id, label: p.name, sublabel: p.productType })),
    [list.data],
  );
  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((x) => (x.key === key ? { ...x, ...p } : x)));
  // V3.2 A2: the part order (columns in set tables, set names, documents); saved with the list.
  const move = (from: number, to: number) => setRows((rs) => (to < 0 || to >= rs.length || from === to ? rs : moved(rs, from, to)));
  async function save() {
    setSaving(true);
    setError("");
    try {
      await api(`/sets/definition/${product.id}`, {
        method: "PUT",
        body: { byproducts: rows.map((r) => ({ ...(r.linkId ? { linkId: r.linkId } : {}), productId: r.productId, required: r.required, label: r.label.trim() || null })) },
      });
      onSaved();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }
  return (
    <Modal open title={`By-products of ${product.name}`} onClose={onClose} wide>
      <p className="mb-3 text-xs text-slate-500">
        Changes apply to sets added from now on. Sets already in stock keep the parts they have. A product can be added more than once (e.g. two chains); give each a label.
      </p>
      <ul className="grid gap-2">
        {rows.map((r, i) => (
          <li key={r.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <span className="flex items-center whitespace-nowrap">
              <button type="button" className="px-1 text-slate-600 hover:text-slate-950 disabled:text-slate-300" aria-label={`Move ${r.name} up`} title="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                ↑
              </button>
              <button type="button" className="px-1 text-slate-600 hover:text-slate-950 disabled:text-slate-300" aria-label={`Move ${r.name} down`} title="Move down" disabled={i === rows.length - 1} onClick={() => move(i, i + 1)}>
                ↓
              </button>
              {rows.length > 2 && (
                <select className="ml-1 h-6 rounded border border-slate-300 bg-white px-0.5 text-[11px]" aria-label={`Position of ${r.name}`} value={i + 1} onChange={(e) => move(i, Number(e.target.value) - 1)}>
                  {rows.map((_, n) => (
                    <option key={n} value={n + 1}>
                      {n + 1}
                    </option>
                  ))}
                </select>
              )}
            </span>
            <span className="font-medium text-slate-800">{r.name}</span>
            {rows.filter((x) => x.productId === r.productId).length > 1 && (
              <input autoComplete="off"
                className="input h-8 w-44 py-1 text-xs"
                maxLength={60}
                aria-label={`${r.name} label`}
                placeholder={`Label, e.g. Hand chain (blank = #${rows.filter((x) => x.productId === r.productId).findIndex((x) => x.key === r.key) + 1})`}
                value={r.label}
                onChange={(e) => patch(r.key, { label: e.target.value })}
              />
            )}
            <label className="ml-auto flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={r.required} onChange={(e) => patch(r.key, { required: e.target.checked })} />
              Required
            </label>
            <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} disabled={rows.length <= 1}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <span className="label">Add a by-product</span>
        <Combobox
          value={null}
          options={options}
          onSelect={(id) => {
            const p = list.data?.products.find((x) => x.id === id);
            if (p) setRows((rs) => [...rs, { key: `new-${++defSeq}`, linkId: null, productId: p.id, name: p.name, label: "", required: true }]);
          }}
          placeholder="Search products…"
        />
      </div>
      <div className="mt-3">
        <Alert message={error} />
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
          Close
        </button>
        <button type="button" className="btn-primary" onClick={save} disabled={saving || !rows.length}>
          {saving ? "Saving…" : "Save by-products"}
        </button>
      </div>
    </Modal>
  );
}
