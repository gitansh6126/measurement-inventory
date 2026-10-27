"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCan } from "@/components/MeContext";
import { PieceColumns, PieceBox, PieceTile, type PieceActions } from "@/components/measure/PieceColumns";
import { AddRollsModal, CorrectModal, CutModal, WriteOffModal, type PieceTarget } from "@/components/measure/RollActions";
import { Alert, TableSkeleton } from "@/components/ui";
import { money, variationLabel } from "@/lib/format";
import { fmtLen, metaOf, pieceSummary, rateLabel, rollWord, summaryText, type MeasuredVariation, type PieceView, type ProductPieces } from "@/lib/measure";
import type { StockProduct } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useWarehouses } from "@/lib/useWarehouses";

// Piece-level stock of one Measured product (wireframe W7, owner design 2026-10-16 in
// v2\docs\measurement\measurement-design.html). Each variation is a card with its total length,
// sealed / in-use / cut counts, rate and minimum stock; opened, it shows every piece in three
// columns (Cut → Open → Closed, smallest first): cut pieces as small length tiles, open and sealed
// pieces with a remaining-length bar; every action is in the piece's "⋯" menu. Pieces are named by kind and length;
// roll codes are not shown. A piece opens its record (W8). Stock changes only through the piece
// actions (BR-18).

type Action = { kind: "cut" | "open" | "writeoff" | "correct"; piece: PieceView } | { kind: "add"; variation: MeasuredVariation };

export function UsedBar({ remaining, original }: { remaining: number; original: number }) {
  const pct = original > 0 ? Math.round(((original - remaining) / original) * 100) : 0;
  return (
    <div className="flex items-center gap-2" title={`${pct}% used`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-emerald-500">
        <div className="h-full bg-slate-300" style={{ width: `${pct}%`, marginLeft: `${100 - pct}%` }} />
      </div>
    </div>
  );
}

/** A piece for the roll-action modals; `variation` names it in titles and messages. */
export const target = (p: Pick<PieceView, "id" | "code" | "kind" | "remainingLength" | "originalLength" | "notes">, variation = ""): PieceTarget => ({
  id: p.id,
  code: p.code,
  kind: p.kind,
  remainingLength: p.remainingLength,
  originalLength: p.originalLength,
  notes: p.notes,
  variation,
});

export function MeasuredStockPanel({
  product,
  focusVariationId,
  onlyVariationId,
}: {
  product: StockProduct;
  /** Opens only this variation at first (product page). */
  focusVariationId?: string;
  /** Lists only this variation (Stock In drawer → Pieces). */
  onlyVariationId?: string;
}) {
  const router = useRouter();
  const canAdjust = useCan("stock.adjust");
  const { data, error, reload } = useApi<ProductPieces>(`/measure/products/${product.id}/pieces?status=active`);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [action, setAction] = useState<Action | null>(null);
  const [flash, setFlash] = useState("");
  // V3.1: show the rolls of one warehouse ("" = all) and each roll's warehouse code.
  const wh = useWarehouses();
  const [whFilter, setWhFilter] = useState("");

  if (error) return <Alert message={error} />;
  if (!data) return <TableSkeleton rows={2} />;

  const meta = metaOf(data.product);
  // Rates are per m, or per ft on a feet + inches product (lengths in inches, 0028).
  const unit = rateLabel(meta.lengthUnit)!;
  const L = (n: number) => fmtLen(n, meta);
  const variations = data.variations
    // V3.1 (0038): under a Stock In category filter, only the variations in that category.
    .filter((v) => v.active && (!onlyVariationId || v.id === onlyVariationId) && (!product.categoryMatch || product.categoryMatch.includes(v.id)))
    .map((v) => (whFilter ? { ...v, pieces: v.pieces.filter((p) => p.warehouseId === whFilter) } : v));
  const whBadge = (p: PieceView) =>
    wh.enabled && p.warehouseId ? (
      <span className="rounded bg-slate-100 px-1 font-mono text-[10px] font-semibold text-slate-600" title={wh.byId.get(p.warehouseId)?.name}>
        {wh.codeOf(p.warehouseId)}
        {p.setId ? " · in set" : ""}
      </span>
    ) : null;
  const all = pieceSummary(variations.flatMap((v) => v.pieces));
  const label = (v: MeasuredVariation) => variationLabel(v, product.attributes) || v.shortName;
  const isOpen = (v: MeasuredVariation) => open[v.id] ?? (focusVariationId ? v.id === focusVariationId : true);
  const done = async (message: string) => {
    setAction(null);
    setFlash(message);
    await reload();
  };
  const actionsFor = (v: MeasuredVariation): PieceActions => ({
    onOpenRecord: (p) => router.push(`/inventory/rolls/${p.id}`),
    ...(canAdjust
      ? {
          onOpen: (p) => setAction({ kind: "open", piece: p }),
          onCut: (p) => setAction({ kind: "cut", piece: p }),
          onCorrect: (p) => setAction({ kind: "correct", piece: p }),
          onWriteOff: (p) => setAction({ kind: "writeoff", piece: p }),
        }
      : {}),
  });
  const actionVariation = action ? variations.find((v) => v.id === (action.kind === "add" ? action.variation.id : action.piece.variationId)) : undefined;
  const actionLabel = actionVariation ? label(actionVariation) : "";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        {wh.enabled && (
          <select className="input w-auto py-1 text-xs" value={whFilter} onChange={(e) => setWhFilter(e.target.value)} aria-label="Warehouse">
            <option value="">All warehouses</option>
            {wh.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
        )}
        <span className="rounded border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">Total stock: {L(all.total)}</span>
      </div>
      <Alert kind="success" message={flash} />

      <div className="grid gap-3">
        {variations.map((v) => {
          const s = pieceSummary(v.pieces);
          const rows = v.pieces;
          const low = v.lowStockThreshold > 0 && s.total <= v.lowStockThreshold;
          const opened = isOpen(v);
          const toggle = () => setOpen((o) => ({ ...o, [v.id]: !opened }));
          return (
            <div key={v.id} className={`rounded-lg border bg-white shadow-sm ${v.id === focusVariationId ? "border-brand-300" : "border-slate-200"}`}>
              <div className="flex cursor-pointer select-none flex-wrap items-center justify-between gap-3 rounded-t-lg border-b border-slate-100 px-4 py-3 hover:bg-slate-50/70" onClick={toggle}>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-brand-600 hover:bg-slate-100"
                    aria-expanded={opened}
                    aria-label={`${opened ? "Collapse" : "Expand"} ${label(v)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle();
                    }}
                  >
                    {opened ? "▾" : "▸"}
                  </button>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-slate-900">{label(v)}</span>
                      {Number(v.salePrice) > 0 && <span className="text-xs font-semibold text-slate-600">Rate: {money(v.salePrice)}/{unit}</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>Min stock: {L(v.lowStockThreshold)}</span>
                      {(v.defaultRollLength ?? data.product.defaultRollLength) && <span>· Std {rollWord(meta)}: {L((v.defaultRollLength ?? data.product.defaultRollLength)!)}</span>}
                      {low && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">Low stock</span>}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800">
                    Total: <b className={low ? "text-rose-600" : "text-emerald-700"}>{L(s.total)}</b>
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {s.count} {s.count === 1 ? "piece" : "pieces"} ({summaryText(s)})
                  </span>
                  {canAdjust && (
                    <button type="button" className="btn border border-emerald-600 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100" onClick={() => setAction({ kind: "add", variation: v })}>
                      + Add {rollWord(meta, 2)}
                    </button>
                  )}
                </div>
              </div>
              {opened && (
                <div className="rounded-b-lg bg-slate-50/50 p-3.5">
                  {rows.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
                      No {rollWord(meta, 2)} in stock.{canAdjust ? ` Use “+ Add ${rollWord(meta, 2)}” for opening or found stock.` : ""}
                    </div>
                  ) : (
                    <PieceColumns
                      pieces={rows}
                      lengthOf={(p) => p.remainingLength}
                      meta={meta}
                      tileKinds={["CUT"]}
                      renderPiece={(p) => (p.kind === "CUT" ? <PieceTile key={p.id} p={p} meta={meta} actions={actionsFor(v)} badge={whBadge(p)} /> : <PieceBox key={p.id} p={p} meta={meta} actions={actionsFor(v)} badge={whBadge(p)} />)}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Measured stock changes only through its pieces: add, cut, write off or correct a length (BR-18). Click a piece for its record and history.
      </p>

      {action?.kind === "add" && (
        <AddRollsModal
          open
          onClose={() => setAction(null)}
          onDone={done}
          variationId={action.variation.id}
          title={`${product.name} ${actionLabel}`}
          meta={meta}
          defaultLength={action.variation.defaultRollLength ?? data.product.defaultRollLength}
          warehouseId={whFilter || null}
        />
      )}
      {(action?.kind === "cut" || action?.kind === "open") && <CutModal open openOnly={action.kind === "open"} piece={target(action.piece, actionLabel)} meta={meta} onClose={() => setAction(null)} onDone={done} />}
      {action?.kind === "writeoff" && <WriteOffModal open piece={target(action.piece, actionLabel)} meta={meta} onClose={() => setAction(null)} onDone={done} />}
      {action?.kind === "correct" && <CorrectModal open piece={target(action.piece, actionLabel)} meta={meta} onClose={() => setAction(null)} onDone={done} />}
    </div>
  );
}

/** The panel as an expanded row of the Stock In table. */
export function MeasuredStock({ product, colSpan }: { product: StockProduct; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="bg-slate-50/70 px-4 py-3">
        <MeasuredStockPanel product={product} />
      </td>
    </tr>
  );
}
