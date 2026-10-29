"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState, type ReactNode } from "react";
import { useCan } from "@/components/MeContext";
import { LengthViewToggle } from "@/components/measure/LengthViewToggle";
import { COLUMN_BADGE, PieceColumns, PieceBox, PieceTile, type PieceActions } from "@/components/measure/PieceColumns";
import { AddRollsModal, CorrectModal, CutModal, WriteOffModal, type PieceTarget } from "@/components/measure/RollActions";
import { Alert, TableSkeleton } from "@/components/ui";
import { variationLabel } from "@/lib/format";
import { KIND_LABEL, fmtLen, fmtRate, metaOf, pieceSummary, rollWord, summaryText, type MeasuredVariation, type PieceKind, type PieceView, type ProductPieces } from "@/lib/measure";
import type { StockProduct } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useWarehouses } from "@/lib/useWarehouses";
import { VariationOrderCell } from "@/components/VariationOrderCell";
import { api } from "@/lib/api";
import { errorText } from "@/lib/useApi";
import { moved, useRowOrder } from "@/lib/useRowOrder";
import { useLengthView } from "@/lib/lengthView";

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
  layout = "cards",
  extraHeads,
  extraCells,
  extraCount = 0,
  readOnly,
  renderActions,
  singleStockCell,
}: {
  product: StockProduct;
  /** "rows" only: extra columns before the actions (Stock In's editable prices and min stock). */
  extraHeads?: ReactNode;
  extraCells?: (variationId: string) => ReactNode;
  extraCount?: number;
  readOnly?: boolean;
  renderActions?: (v: MeasuredVariation, p: StockProduct) => ReactNode;
  /** When true (default for readOnly / product page), merges Cut, Open, Closed, Total into one Stock cell. */
  singleStockCell?: boolean;
  /** Opens only this variation at first (product page). */
  focusVariationId?: string;
  /** Lists only this variation (Stock In drawer → Pieces). */
  onlyVariationId?: string;
  /** "rows" (Stock In table): one row per variation with Cut / Open / Closed columns, each row
   *  closed until opened into its pieces. "cards": every variation open as a card. */
  layout?: "cards" | "rows";
}) {
  useLengthView();
  const router = useRouter();
  const canAdjust = useCan("stock.adjust");
  const { data, error, reload } = useApi<ProductPieces>(`/measure/products/${product.id}/pieces?status=active`);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [action, setAction] = useState<Action | null>(null);
  const [flash, setFlash] = useState("");
  // V3.1: show the rolls of one warehouse ("" = all) and each roll's warehouse code.
  const wh = useWarehouses();
  const [whFilter, setWhFilter] = useState("");
  // V3.2 A2: rows layout — the variation order (drag, ↑ ↓ or position), saved for the product and
  // shared with Products, Stock In, cart pickers and documents.
  const canOrder = useCan("product.write") && layout === "rows" && !onlyVariationId;
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState("");
  const shownOf = (d: ProductPieces | null) =>
    (d?.variations ?? []).filter((v) => v.active && (!onlyVariationId || v.id === onlyVariationId) && (!product.categoryMatch || product.categoryMatch.includes(v.id)));
  const orderIds = shownOf(data).map((v) => v.id);
  async function moveVariation(from: number, to: number) {
    if (!data || ordering || to < 0 || to >= orderIds.length || from === to) return;
    // Only the shown rows move; the others (inactive, other category) keep their places.
    const re = moved(orderIds, from, to);
    let i = 0;
    const next = data.variations.map((v) => (orderIds.includes(v.id) ? re[i++]! : v.id));
    setOrdering(true);
    setOrderError("");
    try {
      await api(`/products/${product.id}/variations/order`, { method: "PUT", body: { variationIds: next } });
      await reload();
    } catch (e) {
      setOrderError(errorText(e));
    } finally {
      setOrdering(false);
    }
  }
  const order = useRowOrder(orderIds, (from, to) => void moveVariation(from, to));

  if (error) return <Alert message={error} />;
  if (!data) return <TableSkeleton rows={2} />;

  const meta = metaOf(data.product);
  const L = (n: number) => fmtLen(n, meta);
  // V3.1 (0038): under a Stock In category filter, only the variations in that category.
  const variations = shownOf(data)
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
  const isOpen = (v: MeasuredVariation) => open[v.id] ?? (focusVariationId ? v.id === focusVariationId : layout === "cards");
  const done = async (message: string) => {
    setAction(null);
    setFlash(message);
    await reload();
  };
  const actionsFor = (v: MeasuredVariation): PieceActions => ({
    onOpenRecord: (p) => router.push(`/inventory/rolls/${p.id}`),
    ...(canAdjust && !readOnly
      ? {
          onOpen: (p) => setAction({ kind: "open", piece: p }),
          onCut: (p) => setAction({ kind: "cut", piece: p }),
          onCorrect: (p) => setAction({ kind: "correct", piece: p }),
          onWriteOff: (p) => setAction({ kind: "writeoff", piece: p }),
        }
      : {}),
  });
  const piecesOf = (v: MeasuredVariation) =>
    v.pieces.length === 0 ? (
      <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
        No {rollWord(meta, 2)} in stock.{canAdjust && !readOnly ? ` Use “+ Add ${rollWord(meta, 2)}” for opening or found stock.` : ""}
      </div>
    ) : (
      <PieceColumns
        pieces={v.pieces}
        lengthOf={(p) => p.remainingLength}
        meta={meta}
        tileKinds={["CUT"]}
        renderPiece={(p) => (p.kind === "CUT" ? <PieceTile key={p.id} p={p} meta={meta} actions={actionsFor(v)} badge={whBadge(p)} /> : <PieceBox key={p.id} p={p} meta={meta} actions={actionsFor(v)} badge={whBadge(p)} />)}
      />
    );
  // Count and length of one kind, e.g. "3 · 12.5 m"; a dash when the variation has none.
  const kindCell = (v: MeasuredVariation, k: PieceKind) => {
    const list = v.pieces.filter((p) => p.kind === k);
    if (!list.length) return <span className="text-slate-300">—</span>;
    const len = Math.round(list.reduce((s, p) => s + p.remainingLength, 0) * 1000) / 1000;
    return (
      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${COLUMN_BADGE[k]}`}>
        <b>{list.length}</b>
        <span className="font-medium opacity-80">· {L(len)}</span>
      </span>
    );
  };
  const KINDS: PieceKind[] = ["CUT", "OPEN", "CLOSED"];
  const isSingle = singleStockCell ?? (readOnly ?? false);
  const anyOpen = variations.some(isOpen);
  const setAll = (value: boolean) => setOpen(Object.fromEntries(variations.map((v) => [v.id, value])));
  const actionVariation = action ? variations.find((v) => v.id === (action.kind === "add" ? action.variation.id : action.piece.variationId)) : undefined;
  const actionLabel = actionVariation ? label(actionVariation) : "";

  const stockCellSingle = (v: MeasuredVariation, s: ReturnType<typeof pieceSummary>) => {
    const present = KINDS.map((k) => {
      const list = v.pieces.filter((p) => p.kind === k);
      const len = Math.round(list.reduce((sum, p) => sum + p.remainingLength, 0) * 1000) / 1000;
      return { kind: k, count: list.length, len };
    }).filter((x) => x.count > 0);

    if (present.length === 0) {
      return <span className="text-slate-300">—</span>;
    }

    return (
      <div className="flex flex-wrap items-center gap-1.5" title={`Total: ${L(s.total)} (${s.count} ${s.count === 1 ? "piece" : "pieces"})`}>
        {present.map(({ kind, count, len }) => (
          <span
            key={kind}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold ${COLUMN_BADGE[kind]}`}
            title={`${KIND_LABEL[kind]}: ${count} ${count === 1 ? "piece" : "pieces"} · ${L(len)}`}
          >
            <span className="text-[10px] font-bold uppercase tracking-wide opacity-75">{KIND_LABEL[kind]}</span>
            <b>{count}</b>
            <span className="font-medium opacity-80">· {L(len)}</span>
          </span>
        ))}
      </div>
    );
  };

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
        <LengthViewToggle />
        <span className="rounded border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">Total stock: {L(all.total)}</span>
      </div>
      <Alert kind="success" message={flash} />
      <Alert message={orderError} />

      {layout === "rows" ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="table table-stack">
            <thead>
              <tr>
                {canOrder && variations.length > 1 && <th>Order</th>}
                <th className="w-8">
                  {variations.length > 1 && (
                    <button type="button" className="text-brand-600" aria-label={anyOpen ? "Collapse all variations" : "Expand all variations"} title={anyOpen ? "Collapse all" : "Expand all"} onClick={() => setAll(!anyOpen)}>
                      {anyOpen ? "⊖" : "⊕"}
                    </button>
                  )}
                </th>
                <th>Variation</th>
                {isSingle ? (
                  <th data-label="Stock">Stock</th>
                ) : (
                  <>
                    {KINDS.map((k) => (
                      <th key={k}>
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${COLUMN_BADGE[k]}`}>{KIND_LABEL[k]}</span>
                      </th>
                    ))}
                    <th data-label="Total">Total</th>
                  </>
                )}
                {extraHeads}
                <th className="text-right" aria-label="Actions">{renderActions ? "Actions" : null}</th>
              </tr>
            </thead>
            <tbody>
              {variations.map((v, index) => {
                const s = pieceSummary(v.pieces);
                const low = v.lowStockThreshold > 0 && s.total <= v.lowStockThreshold;
                const opened = isOpen(v);
                const toggle = () => setOpen((o) => ({ ...o, [v.id]: !opened }));
                const drag = canOrder && variations.length > 1 ? order.rowProps(v.id) : null;
                return (
                  <Fragment key={v.id}>
                    <tr
                      className={`cursor-pointer hover:bg-slate-50 ${opened ? "bg-brand-50/40" : ""} ${drag?.className ?? ""}`}
                      onDragOver={drag?.onDragOver}
                      onDrop={drag?.onDrop}
                      // Typing in a price field (or the order controls) must not open or close the row.
                      onClick={(e) => !(e.target as HTMLElement).closest("input, select, label, button") && toggle()}
                    >
                      {drag && (
                        <VariationOrderCell
                          label={label(v)}
                          index={index}
                          count={variations.length}
                          disabled={ordering}
                          onMove={(from, to) => void moveVariation(from, to)}
                          {...order.handleProps(v.id)}
                        />
                      )}
                      <td className="stack-hide">
                        <button
                          type="button"
                          className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-xs text-brand-600 hover:bg-slate-100"
                          aria-expanded={opened}
                          aria-label={`${opened ? "Collapse" : "Expand"} ${label(v)}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle();
                          }}
                        >
                          {opened ? "▾" : "▸"}
                        </button>
                      </td>
                      <td>
                        <div className="font-semibold text-slate-900">{label(v)}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                          {Number(v.salePrice) > 0 && <span>{fmtRate(meta.lengthUnit, v.salePrice)}</span>}
                          {v.lowStockThreshold > 0 && <span>Min {L(v.lowStockThreshold)}</span>}
                          {low && <span className="rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">Low stock</span>}
                        </div>
                      </td>
                      {isSingle ? (
                        <td data-label="Stock" className="whitespace-nowrap">
                          {stockCellSingle(v, s)}
                        </td>
                      ) : (
                        <>
                          {KINDS.map((k) => (
                            <td key={k}>{kindCell(v, k)}</td>
                          ))}
                          <td className="whitespace-nowrap">
                            <b className={low ? "text-rose-600" : "text-emerald-700"}>{L(s.total)}</b>
                            <div className="text-[11px] text-slate-500">
                              {s.count} {s.count === 1 ? "piece" : "pieces"}
                            </div>
                          </td>
                        </>
                      )}
                      {extraCells?.(v.id)}
                      <td className="text-right" onClick={(e) => e.stopPropagation()}>
                        {renderActions ? (
                          renderActions(v, product)
                        ) : canAdjust && !readOnly ? (
                          <button type="button" className="btn whitespace-nowrap border border-emerald-600 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100" onClick={() => setAction({ kind: "add", variation: v })}>
                            + Add {rollWord(meta, 2)}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    {opened && (
                      <tr>
                        <td colSpan={(isSingle ? 4 : 7) + extraCount + (canOrder && variations.length > 1 ? 1 : 0)} className="bg-slate-50/60 p-3">
                          {piecesOf(v)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
      <div className="grid gap-3">
        {variations.map((v) => {
          const s = pieceSummary(v.pieces);
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
                      {Number(v.salePrice) > 0 && <span className="text-xs font-semibold text-slate-600">Rate: {fmtRate(meta.lengthUnit, v.salePrice)}</span>}
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
                  <LengthViewToggle />
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {s.count} {s.count === 1 ? "piece" : "pieces"} ({summaryText(s)})
                  </span>
                  {canAdjust && !readOnly && (
                    <button type="button" className="btn border border-emerald-600 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100" onClick={() => setAction({ kind: "add", variation: v })}>
                      + Add {rollWord(meta, 2)}
                    </button>
                  )}
                </div>
              </div>
              {opened && (
                <div className="rounded-b-lg bg-slate-50/50 p-3.5">{piecesOf(v)}</div>
              )}
            </div>
          );
        })}
      </div>
      )}
      <p className="mt-2 text-xs text-slate-500">
        {readOnly
          ? "Click a piece for its record and history. Stock changes on Stock In only."
          : "Measured stock changes only through its pieces: add, cut, write off or correct a length (BR-18). Click a piece for its record and history."}
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
export function MeasuredStock({
  product,
  colSpan,
  singleStockCell,
  ...extra
}: {
  product: StockProduct;
  colSpan: number;
  extraHeads?: ReactNode;
  extraCells?: (variationId: string) => ReactNode;
  extraCount?: number;
  readOnly?: boolean;
  renderActions?: (v: MeasuredVariation, p: StockProduct) => ReactNode;
  singleStockCell?: boolean;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="bg-slate-50/70 !p-0">
        <div className="child-panel">
          <MeasuredStockPanel product={product} layout="rows" singleStockCell={singleStockCell ?? extra.readOnly} {...extra} />
        </div>
      </td>
    </tr>
  );
}

/**
 * Read-only Cut / Open / Closed pieces of one variation (Products list, owner 2026-10-28): the
 * same columns as Stock In, with no add, cut, open, correct or write-off actions; a piece opens
 * its record. Stock is changed on Stock In only.
 */
export function VariationPieces({ productId, variationId }: { productId: string; variationId: string }) {
  useLengthView();
  const router = useRouter();
  const { data, error } = useApi<ProductPieces>(`/measure/products/${productId}/pieces?status=active`);
  if (error) return <Alert message={error} />;
  if (!data) return <p className="text-xs text-slate-500">Loading pieces…</p>;
  const meta = metaOf(data.product);
  const v = data.variations.find((x) => x.id === variationId);
  if (!v || v.pieces.length === 0) return <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-400">No {rollWord(meta, 2)} in stock.</div>;
  const view: PieceActions = { onOpenRecord: (p) => router.push(`/inventory/rolls/${p.id}`) };
  return (
    <PieceColumns
      pieces={v.pieces}
      lengthOf={(p) => p.remainingLength}
      meta={meta}
      tileKinds={["CUT"]}
      renderPiece={(p) => (p.kind === "CUT" ? <PieceTile key={p.id} p={p} meta={meta} actions={view} /> : <PieceBox key={p.id} p={p} meta={meta} actions={view} />)}
    />
  );
}

