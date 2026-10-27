"use client";

import type { ReactNode } from "react";
import { Menu } from "@/components/ui";
import { KIND_COLUMN, KIND_LABEL, fmtLen, type MeasureMeta, type PieceKind, type PieceView } from "@/lib/measure";

// Cut / Open / Closed stock view (owner design 2026-10-16, measurement-design.html): the pieces of
// one variation in three columns, each column smallest first, with its count and total length.
// Pieces are named by kind and length; roll codes are not shown. Used by the inventory rows, the
// product page's "Rolls & Physical Bundles" section and the sale drawer's piece chooser.

const KINDS: PieceKind[] = ["CUT", "OPEN", "CLOSED"];
const COLUMN_BADGE: Record<PieceKind, string> = { CUT: "bg-amber-100 text-amber-800", OPEN: "bg-sky-100 text-sky-800", CLOSED: "bg-slate-200 text-slate-700" };
const EMPTY: Record<PieceKind, string> = { CUT: "No cut pieces", OPEN: "No open pieces", CLOSED: "No sealed pieces" };

export const dayMonth = (iso: string | number | Date) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });

export function PieceColumns<T extends { id: string; kind: PieceKind }>({
  pieces,
  lengthOf,
  meta,
  renderPiece,
  tileKinds = [],
}: {
  pieces: T[];
  /** Remaining length in base units. */
  lengthOf: (p: T) => number;
  meta: MeasureMeta;
  renderPiece: (p: T) => ReactNode;
  /** Kinds whose pieces wrap as small tiles instead of a stacked list. */
  tileKinds?: PieceKind[];
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {KINDS.map((k) => {
        const list = pieces.filter((p) => p.kind === k).sort((a, b) => lengthOf(a) - lengthOf(b));
        const total = Math.round(list.reduce((s, p) => s + lengthOf(p), 0) * 1000) / 1000;
        return (
          <div key={k} className="flex flex-col rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
            <div className="mb-2 flex items-center justify-between border-b border-slate-200 pb-1.5">
              <div className="flex items-center gap-1.5">
                <span className={`rounded px-2 py-0.5 text-xs font-bold ${COLUMN_BADGE[k]}`}>{KIND_COLUMN[k]}</span>
                <span className="text-xs font-semibold text-slate-600">({list.length})</span>
              </div>
              <span className="text-xs font-semibold text-slate-600">{fmtLen(total, meta)}</span>
            </div>
            <div className={list.length && tileKinds.includes(k) ? "flex flex-wrap gap-1.5" : "space-y-1.5"}>{list.length ? list.map(renderPiece) : <div className="py-4 text-center text-xs text-slate-400">{EMPTY[k]}</div>}</div>
          </div>
        );
      })}
    </div>
  );
}

export interface PieceActions {
  onOpenRecord: (p: PieceView) => void;
  onOpen?: (p: PieceView) => void;
  onCut?: (p: PieceView) => void;
  onCorrect?: (p: PieceView) => void;
  onWriteOff?: (p: PieceView) => void;
}

// Every piece action sits in its "⋯" menu (owner 2026-10-20: no action buttons on the piece).
function PieceMenu({ p, a, meta, align }: { p: PieceView; a: PieceActions; meta: MeasureMeta; align?: "left" | "right" }) {
  const items = [
    ...(p.kind === "CLOSED" && a.onOpen ? [{ label: `Open ${(meta.rollName || "roll").toLowerCase()}`, onClick: () => a.onOpen!(p) }] : []),
    ...(a.onCut ? [{ label: "Cut", onClick: () => a.onCut!(p) }] : []),
    ...(a.onCorrect ? [{ label: "Correct length", onClick: () => a.onCorrect!(p) }] : []),
    ...(a.onWriteOff ? [{ label: "Write off", danger: true, onClick: () => a.onWriteOff!(p) }] : []),
  ];
  if (!items.length) return null;
  return <Menu compact align={align} label={`Actions for ${KIND_LABEL[p.kind].toLowerCase()} piece ${fmtLen(p.remainingLength, meta)}`} items={items} />;
}

const BAR_TONE: Record<PieceKind, string> = { OPEN: "bg-sky-500", CUT: "bg-amber-500", CLOSED: "bg-emerald-500" };

/** A cut piece as a small tile: the length large, received date, actions menu. */
export function PieceTile({ p, meta, actions, badge }: { p: PieceView; meta: MeasureMeta; actions: PieceActions; badge?: ReactNode }) {
  return (
    <div
      role="link"
      tabIndex={0}
      title={`Cut piece of ${fmtLen(p.originalLength, meta)} · received ${dayMonth(p.receivedAt)}`}
      className="relative flex min-w-[92px] cursor-pointer flex-col items-center justify-center rounded-lg border border-amber-200 bg-white px-3 pb-2 pt-6 text-center transition hover:border-amber-400 hover:bg-amber-50/40"
      onClick={() => actions.onOpenRecord(p)}
      onKeyDown={(e) => e.key === "Enter" && actions.onOpenRecord(p)}
    >
      <div className="absolute right-0.5 top-0.5" onClick={(e) => e.stopPropagation()}>
        <PieceMenu p={p} a={actions} meta={meta} align="left" />
      </div>
      <span className="text-xl font-bold leading-tight text-slate-900">{fmtLen(p.remainingLength, meta)}</span>
      <span className="mt-0.5 text-[10px] text-slate-400">{dayMonth(p.receivedAt)}</span>
      {badge}
    </div>
  );
}

const BOX_TONE: Record<PieceKind, string> = {
  OPEN: "border-sky-300 bg-white hover:border-sky-400",
  CUT: "border-amber-200 bg-white hover:border-amber-300",
  CLOSED: "border-slate-200 bg-white hover:border-slate-300",
};

/** One open or sealed piece in a column: remaining against original with a bar, received date, actions menu. */
export function PieceBox({ p, meta, actions, badge }: { p: PieceView; meta: MeasureMeta; actions: PieceActions; badge?: ReactNode }) {
  const L = (n: number) => fmtLen(n, meta);
  const pct = p.originalLength > 0 ? Math.round((p.remainingLength / p.originalLength) * 100) : 0;
  return (
    <div
      role="link"
      tabIndex={0}
      className={`cursor-pointer rounded-lg border px-2.5 py-2 text-left transition ${BOX_TONE[p.kind]}`}
      onClick={() => actions.onOpenRecord(p)}
      onKeyDown={(e) => e.key === "Enter" && actions.onOpenRecord(p)}
    >
      <div className="flex items-center justify-between gap-1.5">
        <div>
          <span className="text-sm font-bold text-slate-900">{L(p.remainingLength)}</span>
          {p.remainingLength !== p.originalLength && <span className="text-[11px] font-normal text-slate-400"> of {L(p.originalLength)}</span>}
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {badge}
          <span className="text-[11px] text-slate-400">{dayMonth(p.receivedAt)}</span>
          <PieceMenu p={p} a={actions} meta={meta} />
        </div>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200/50">
          <div className={`h-full ${BAR_TONE[p.kind]}`} style={{ width: `${Math.min(100, Math.max(5, pct))}%` }} />
        </div>
        <span className="w-9 text-right text-[10px] font-medium text-slate-500">{pct}%</span>
      </div>
    </div>
  );
}
