"use client";

import Link from "next/link";
import { useState } from "react";
import { UsedBar } from "@/components/measure/MeasuredStock";
import { TableSkeleton } from "@/components/ui";
import { dateTime, variationLabel } from "@/lib/format";
import { ACTION_LABEL, KIND_CLASS, fmtLen, fmtLenSigned, metaOf, type LengthUnit, type MeasureMeta, type PieceKind, type PieceStatus } from "@/lib/measure";
import type { AttributeDef, Attributes } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useWarehouses } from "@/lib/useWarehouses";
import { useLengthView } from "@/lib/lengthView";

// Stock history of a Measured product, per bundle (owner 2026-10-24): each roll is a card with
// its timeline — Sealed → Open → cuts, sales, cancels, write-offs, shifts — and the cut pieces
// made from it nested under it with their own timelines. Lengths are shown in the product's unit.

interface TimelineRow {
  id: string;
  occurredAt: string;
  action: string;
  change: number;
  before: number;
  after: number;
  stateBefore: PieceKind;
  stateAfter: PieceKind;
  related: { id: string; code: string | null } | null;
  sale: { id: string; number: string | null } | null;
  purchase: { id: string; number: string | null } | null;
  warehouseId: string | null;
  reason: string | null;
  by: string | null;
}

interface BundleNode {
  id: string;
  code: string;
  kind: PieceKind;
  status: PieceStatus;
  variation: { id: string; shortName: string; attributes: Attributes } | null;
  originalLength: number;
  remainingLength: number;
  receivedAt: string;
  openedAt: string | null;
  warehouseId: string | null;
  set: { id: string; code: string | null } | null;
  setOrigin: boolean;
  purchase: { id: string; number: string | null } | null;
  supplier: string | null;
  used: { sold: number; cutIntoPieces: number; returned: number; writtenOff: number; corrected: number };
  timeline: TimelineRow[];
  children: BundleNode[];
}

interface BundlesResponse {
  product: { id: string; name: string; lengthUnit: LengthUnit; rollName: string | null; decimals: number | null };
  summary: { onHand: number; sealed: number; open: number; cut: number; bundles: number };
  bundles: BundleNode[];
  total: number;
}

type Status = "active" | "used_up" | "all";
const PAGE = 10;

const stateText = (k: PieceKind, roll: string) => (k === "CUT" ? "Cut piece" : k === "OPEN" ? `Open ${roll}` : `Sealed ${roll}`);

function StateChip({ kind, roll }: { kind: PieceKind; roll: string }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_CLASS[kind]}`}>{stateText(kind, roll)}</span>;
}

/** Dot colour of a timeline event. */
const dotClass = (r: TimelineRow) =>
  r.action === "SALE" ? "bg-rose-500" : r.action === "SALE_VOID" ? "bg-emerald-500" : r.action === "WRITE_OFF" ? "bg-slate-500" : r.change > 0 ? "bg-emerald-500" : r.change < 0 ? "bg-amber-500" : "bg-sky-400";

interface Ctx {
  meta: MeasureMeta;
  roll: string;
  attributeDefs: AttributeDef[];
  showVariation: boolean;
  from: string;
  whCode: (id: string | null) => string;
}

function Timeline({ rows, c }: { rows: TimelineRow[]; c: Ctx }) {
  if (!rows.length) return <p className="text-xs text-slate-400">No events.</p>;
  return (
    <ol className="relative ml-1.5 border-l border-slate-200">
      {rows.map((r) => {
        const doc = r.sale ? { href: `/sales/${r.sale.id}`, number: r.sale.number } : r.purchase ? { href: `/purchases/${r.purchase.id}`, number: r.purchase.number } : null;
        const cutInto = r.action === "CUT" && r.change < 0;
        const wh = c.whCode(r.warehouseId);
        return (
          <li key={r.id} className="relative pb-2 pl-4 last:pb-0">
            <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${dotClass(r)}`} aria-hidden />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="whitespace-nowrap text-slate-500">{dateTime(r.occurredAt)}</span>
              <span className="font-semibold text-slate-900">{ACTION_LABEL[r.action] ?? r.action}</span>
              {doc && (
                <Link className="text-brand-700 hover:underline" href={`${doc.href}?from=${c.from}`}>
                  {doc.number ?? "Open"}
                </Link>
              )}
              <StateChip kind={r.stateBefore} roll={c.roll} />
              {r.stateAfter !== r.stateBefore && (
                <>
                  <span className="text-slate-400">→</span>
                  <StateChip kind={r.stateAfter} roll={c.roll} />
                </>
              )}
              {r.change !== 0 && (
                <span className={`font-semibold ${r.change > 0 ? "text-emerald-700" : "text-rose-600"}`}>{fmtLenSigned(r.change, c.meta)}</span>
              )}
              <span className="text-slate-600">
                {fmtLen(r.before, c.meta)} → <b className="text-slate-900">{fmtLen(r.after, c.meta)}</b>
              </span>
              {wh && <span className="rounded bg-slate-100 px-1 text-[11px] text-slate-600">{wh}</span>}
            </div>
            {(r.related?.code || r.reason || r.by) && (
              <div className="mt-0.5 text-[11px] text-slate-500">
                {r.related?.code && (
                  <>
                    {cutInto ? "into " : r.action === "SALE_VOID" ? "returned as new piece from " : "from "}
                    <Link href={`/inventory/rolls/${r.related.id}`} className="font-mono text-brand-700 hover:underline">
                      {r.related.code}
                    </Link>
                    {(r.reason || r.by) && " · "}
                  </>
                )}
                {r.reason}
                {r.reason && r.by && " · "}
                {r.by}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function UsedChips({ n, c }: { n: BundleNode; c: Ctx }) {
  const parts = [
    ["Sold", n.used.sold],
    ["Cut into pieces", n.used.cutIntoPieces],
    ["Returned", n.used.returned],
    ["Written off", n.used.writtenOff],
    ["Corrected", n.used.corrected],
  ] as const;
  const shown = parts.filter(([, v]) => v !== 0);
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 text-[11px]">
      {shown.map(([t, v]) => (
        <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
          {t} <b>{fmtLen(v, c.meta)}</b>
        </span>
      ))}
    </div>
  );
}

function PieceHeader({ n, c, big }: { n: BundleNode; c: Ctx; big?: boolean }) {
  const wh = c.whCode(n.warehouseId);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <StateChip kind={n.kind} roll={c.roll} />
      <Link href={`/inventory/rolls/${n.id}`} className={`whitespace-nowrap font-mono font-semibold text-brand-700 hover:underline ${big ? "text-sm" : "text-xs"}`}>
        {n.code}
      </Link>
      {c.showVariation && n.variation && <span className="text-xs font-medium text-slate-800">{variationLabel(n.variation, c.attributeDefs)}</span>}
      {n.status === "USED_UP" && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">Used up</span>}
      {n.set && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800">In set {n.set.code}</span>}
      {wh && <span className="rounded bg-slate-100 px-1 text-[11px] text-slate-600">{wh}</span>}
      <span className="text-[11px] text-slate-500">
        {fmtLen(n.remainingLength, c.meta)} left of {fmtLen(n.originalLength, c.meta)}
      </span>
    </div>
  );
}

function CutPiece({ n, c }: { n: BundleNode; c: Ctx }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md border border-slate-200 bg-white p-2">
      <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <PieceHeader n={n} c={c} />
        <span className="shrink-0 text-[11px] font-semibold text-brand-700">{open ? "Hide" : `${n.timeline.length} event${n.timeline.length === 1 ? "" : "s"}`}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <UsedChips n={n} c={c} />
          <Timeline rows={n.timeline} c={c} />
          {n.children.length > 0 && (
            <ul className="ml-3 grid gap-1.5 border-l-2 border-amber-200 pl-3">
              {n.children.map((k) => (
                <CutPiece key={k.id} n={k} c={c} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function BundleCard({ n, c }: { n: BundleNode; c: Ctx }) {
  const [showPieces, setShowPieces] = useState(n.children.length <= 4);
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <PieceHeader n={n} c={c} big />
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span>Received {dateTime(n.receivedAt)}</span>
        {n.openedAt && <span>Opened {dateTime(n.openedAt)}</span>}
        {n.purchase && (
          <Link className="text-brand-700 hover:underline" href={`/purchases/${n.purchase.id}?from=${c.from}`}>
            {n.purchase.number}
          </Link>
        )}
        {n.supplier && <span>{n.supplier}</span>}
        {n.setOrigin && <span>Cut inside a set</span>}
      </div>
      {n.kind !== "CUT" && (
        <div className="mt-2 max-w-sm">
          <UsedBar remaining={n.remainingLength} original={n.originalLength} />
        </div>
      )}
      <div className="mt-2">
        <UsedChips n={n} c={c} />
      </div>
      <div className="mt-3">
        <Timeline rows={n.timeline} c={c} />
      </div>
      {n.children.length > 0 && (
        <div className="mt-3">
          <button type="button" className="text-xs font-semibold text-slate-700 hover:text-slate-900" onClick={() => setShowPieces((s) => !s)} aria-expanded={showPieces}>
            {showPieces ? "▾" : "▸"} Cut pieces from this {c.roll} ({n.children.length})
          </button>
          {showPieces && (
            <ul className="mt-2 ml-1.5 grid gap-1.5 border-l-2 border-amber-200 pl-3">
              {n.children.map((k) => (
                <CutPiece key={k.id} n={k} c={c} />
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

export function BundleHistory({
  productId,
  attributeDefs,
  variations,
  from,
}: {
  productId: string;
  attributeDefs: AttributeDef[];
  /** The product's variations (filter); one variation hides the column and filter. */
  variations: { id: string; shortName: string; attributes: Attributes }[];
  from: string;
}) {
  useLengthView();
  const wh = useWarehouses();
  const [status, setStatus] = useState<Status>("active");
  const [variationId, setVariationId] = useState("");
  const [page, setPage] = useState(1);
  const q = new URLSearchParams({ status, page: String(page), pageSize: String(PAGE), ...(variationId ? { variationId } : {}) });
  const { data } = useApi<BundlesResponse>(`/measure/products/${productId}/bundles?${q}`);
  const showVariation = variations.length > 1;

  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1 rounded-full bg-slate-100 p-1" role="radiogroup" aria-label="Bundle status">
        {(
          [
            ["active", "In stock"],
            ["used_up", "Used up"],
            ["all", "All"],
          ] as const
        ).map(([k, t]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={status === k}
            onClick={() => {
              setStatus(k);
              setPage(1);
            }}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${status === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {showVariation && (
        <select
          className="input w-auto py-1 text-xs"
          aria-label="Variation"
          value={variationId}
          onChange={(e) => {
            setVariationId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All variations</option>
          {variations.map((v) => (
            <option key={v.id} value={v.id}>
              {variationLabel(v, attributeDefs)}
            </option>
          ))}
        </select>
      )}
    </div>
  );

  if (!data) return <div className="space-y-3">{filters}<TableSkeleton rows={4} /></div>;
  const meta = metaOf(data.product);
  const roll = (data.product.rollName || "Roll").toLowerCase();
  const c: Ctx = { meta, roll, attributeDefs, showVariation, from, whCode: (id) => (wh.enabled ? wh.codeOf(id) : "") };
  const s = data.summary;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
        <span>
          On hand <b className="text-slate-900">{fmtLen(s.onHand, meta)}</b>
        </span>
        <span className="text-slate-300">|</span>
        <StateChip kind="CLOSED" roll={roll} /> <b>{s.sealed}</b>
        <StateChip kind="OPEN" roll={roll} /> <b>{s.open}</b>
        <StateChip kind="CUT" roll={roll} /> <b>{s.cut}</b>
      </div>
      {filters}
      {data.bundles.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">No {status === "active" ? "bundles in stock" : status === "used_up" ? "used-up bundles" : "bundles"} yet.</p>
      ) : (
        <div className="max-h-[60vh] space-y-3 overflow-auto pr-1">
          {data.bundles.map((b) => (
            <BundleCard key={b.id} n={b} c={c} />
          ))}
        </div>
      )}
      {data.total > PAGE && (
        <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-xs">
          <span className="text-slate-500">
            Bundles {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, data.total)} of {data.total}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary py-1 text-xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Newer
            </button>
            <span className="font-medium text-slate-600">
              Page {page} of {Math.ceil(data.total / PAGE)}
            </span>
            <button type="button" className="btn-secondary py-1 text-xs" disabled={page * PAGE >= data.total} onClick={() => setPage((p) => p + 1)}>
              Older
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
