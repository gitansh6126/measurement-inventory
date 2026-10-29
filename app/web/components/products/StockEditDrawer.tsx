"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CollapseIcon, ExpandIcon } from "@/components/icons";
import { ProductThumb } from "@/components/ProductThumb";
import { StockBadge } from "@/components/StockBadge";
import { SearchInput } from "@/components/ui";
import { variationLabel } from "@/lib/format";
import { fmtLen, metaOf } from "@/lib/measure";
import type { StockProduct, StockVariation } from "@/lib/types";
import { variationAttributeColumns } from "@/lib/variationColumns";
import { useLengthView } from "@/lib/lengthView";

// Stock In grid → drawer (same shell as the cart ProductDrawer). Shows every active variation in
// one table with the Stock In edit cells (Current / New Stock, Min Selling Price, Selling Price,
// Min Stock). Edits live in the Stock In page state, so closing keeps them and the page's Save
// still picks them up; Save here sends only this product's rows.
export function StockEditDrawer({
  product,
  heads,
  cells,
  dirty,
  saving,
  error,
  reason,
  reasons,
  onReason,
  notes,
  onNotes,
  onSave,
  onDiscard,
  onClose,
  extra,
}: {
  product: StockProduct;
  heads: ReactNode;
  cells: (v: StockVariation) => ReactNode;
  dirty: number;
  saving: boolean;
  error?: string | null;
  reason: string;
  reasons: string[];
  onReason: (r: string) => void;
  notes: string;
  onNotes: (n: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onClose: () => void;
  /** Shown under the table: V3.1 a grouped product's set types (like variation rows). */
  extra?: ReactNode;
}) {
  useLengthView();
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState("");
  const variable = product.productType === "variable";
  // Measured rows: variation name + standard roll, totals as lengths (owner design 2026-10-16).
  const measured = product.productType === "measured";
  const meta = measured ? metaOf({ ...(product.measure ?? {}), lengthUnit: product.measure?.lengthUnit ?? "m" }) : null;
  const active = useMemo(() => product.variations.filter((v) => v.active), [product]);
  const attrCols = variable ? variationAttributeColumns(product, active) : [];
  const total = active.reduce((s, v) => s + v.quantity, 0);

  const rows = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return active;
    return active.filter((v) =>
      v.shortName.toLowerCase().includes(term) ||
      v.officialSku?.toLowerCase().includes(term) ||
      Object.entries(v.attributes).some(([k, val]) => k.toLowerCase().includes(term) || val.toLowerCase().includes(term))
    );
  }, [active, filter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 flex ${expanded ? "items-stretch justify-stretch p-0" : "items-end justify-center sm:items-center sm:p-4"}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Stock In: ${product.name}`}
    >
      <button className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity" aria-label="Close" onClick={onClose} />
      <div
        className={`relative z-10 flex w-full flex-col overflow-hidden bg-white shadow-2xl transition-all duration-200 ${
          expanded
            ? "h-full max-h-none w-full max-w-none rounded-none"
            : "h-[94vh] max-h-[94vh] w-full max-w-5xl rounded-t-2xl sm:h-[88vh] sm:max-h-[88vh] sm:rounded-2xl lg:max-w-6xl xl:max-w-7xl"
        }`}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-3.5 sm:px-6">
          <ProductThumb src={product.imageUrl ?? active[0]?.imageUrl ?? null} name={product.name} className="h-14 w-14 shrink-0 rounded-lg border border-slate-200 object-cover text-[9px]" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Stock In</div>
            <h2 className="truncate text-lg font-bold text-slate-900">{product.name}</h2>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>{variable || measured ? `${active.length} variation${active.length === 1 ? "" : "s"}` : product.category?.name ?? "Uncategorized"}</span>
              <span>·</span>
              <span>Total {meta ? <b className="text-slate-800">{fmtLen(total, meta)}</b> : <StockBadge quantity={total} state={product.state} unit={product.unit} />}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Link href={`/inventory/${product.id}`} className="hidden h-8 items-center rounded-lg px-2.5 text-xs font-medium text-brand-600 hover:bg-brand-50 sm:flex" onClick={(e) => { if (dirty && !window.confirm("Open the product page and discard the unsaved changes?")) e.preventDefault(); }}>
              Product page
            </Link>
            <button
              type="button"
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              title={expanded ? "Restore size" : "Full size"}
            >
              {expanded ? <CollapseIcon className="h-4 w-4" /> : <ExpandIcon className="h-4 w-4" />}
              <span className="hidden sm:inline">{expanded ? "Restore" : "Full size"}</span>
            </button>
            <button className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-xl leading-none text-slate-400 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-3 sm:px-6">
          {active.length > 5 && (
            <div className="mb-2 shrink-0">
              <SearchInput value={filter} onChange={setFilter} placeholder="Filter by attribute or SKU…" />
            </div>
          )}
          <div className={`min-h-0 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-xs ${extra ? "shrink-0" : "flex-1"}`}>
            <table className="table table-stack min-w-full">
              <thead className="sticky top-0 z-10 bg-slate-50 shadow-xs">
                <tr>
                  {(variable || measured) && <th className="w-14 bg-slate-50" aria-label="Image" />}
                  {variable ? attrCols.map((c) => <th key={c.name} className="bg-slate-50">{c.name}{c.unit ? ` (${c.unit})` : ""}</th>) : <th className="bg-slate-50">{measured ? "Variation" : "Product"}</th>}
                  {heads}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((v) => (
                  <tr key={v.id}>
                    {(variable || measured) && (
                      <td className="w-14">
                        <ProductThumb src={v.imageUrl ?? product.imageUrl ?? null} name={`${product.name} (${variationLabel(v, product.attributes)})`} className="h-10 w-10 rounded text-[6px]" />
                      </td>
                    )}
                    {variable ? (
                      attrCols.map((c) => <td key={c.name} className="whitespace-nowrap text-slate-800">{v.attributes[c.name] ?? "—"}</td>)
                    ) : meta ? (
                      <td>
                        <div className="text-sm font-bold text-slate-900">{variationLabel(v, product.attributes)}</div>
                        {(v.defaultRollLength ?? product.measure?.defaultRollLength) && (
                          <div className="text-[11px] text-slate-400">Std {(meta.rollName || "roll").toLowerCase()}: {fmtLen((v.defaultRollLength ?? product.measure?.defaultRollLength)!, meta)}</div>
                        )}
                      </td>
                    ) : (
                      <td className="font-medium text-slate-900">{product.name}</td>
                    )}
                    {cells(v)}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={99} className="py-12 text-center text-sm text-slate-500">
                      {active.length ? <>No variations match &ldquo;{filter}&rdquo;</> : "This product has no active variation"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {extra && <div className="mt-3 min-h-0 flex-1 overflow-auto">{extra}</div>}
          {error && <p className="mt-2 shrink-0 text-sm text-rose-600" role="alert">{error}</p>}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50/95 px-5 py-3 sm:px-6">
          <span className="rounded-md bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200">
            <b className={dirty ? "text-emerald-600" : ""}>{dirty}</b> with changes
          </span>
          <select className="input w-auto" value={reason} onChange={(e) => onReason(e.target.value)} aria-label="Reason">
            {reasons.map((r) => <option key={r}>{r}</option>)}
          </select>
          <input className="input min-w-[10rem] flex-1" placeholder="Notes (optional)" maxLength={300} value={notes} onChange={(e) => onNotes(e.target.value)} />
          <button type="button" className="btn-secondary" disabled={!dirty || saving} onClick={onDiscard}>Discard</button>
          <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          <button type="button" className="btn border border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800" disabled={saving || !dirty} onClick={onSave}>
            {saving ? "Saving…" : `Save Stock (${dirty})`}
          </button>
        </div>
      </div>
    </div>
  );
}
