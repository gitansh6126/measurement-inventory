"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { UsedBar, target } from "@/components/measure/MeasuredStock";
import { CorrectModal, CutModal, EditPieceModal, WriteOffModal } from "@/components/measure/RollActions";
import { useCan } from "@/components/MeContext";
import { Alert, PageHeader, TableSkeleton } from "@/components/ui";
import { dateTime, variationLabel } from "@/lib/format";
import { ACTION_LABEL, KIND_CLASS, KIND_LABEL, fmtLen, fmtRate, kindPhrase, metaOf, rollWord, type PieceRecord } from "@/lib/measure";
import { useApi } from "@/lib/useApi";
import { useWarehouses } from "@/lib/useWarehouses";
import { useLengthView } from "@/lib/lengthView";
import { LengthViewToggle } from "@/components/measure/LengthViewToggle";

// Roll record (wireframe W8, V2 plan §2.5) with its full history (W19): identity, lengths,
// where it came from, what it cost, and what happened to it. Notes are edited
// directly; lengths change only through the audited actions.

type Action = "open" | "cut" | "writeoff" | "correct" | "edit";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

export default function RollPage() {
  useLengthView();
  const { rollId } = useParams<{ rollId: string }>();
  const { data, error, reload } = useApi<PieceRecord>(`/measure/pieces/${rollId}`);
  const wh = useWarehouses();
  const canAdjust = useCan("stock.adjust");
  const [action, setAction] = useState<Action | null>(null);
  const [flash, setFlash] = useState("");

  if (error) return <Alert message={error} />;
  if (!data) return <TableSkeleton rows={6} />;

  const p = data.piece;
  const meta = metaOf(p.product);
  const L = (n: number) => fmtLen(n, meta);
  const active = p.status === "ACTIVE";
  const used = p.originalLength - p.remainingLength;
  const done = async (message: string) => {
    setAction(null);
    setFlash(message);
    await reload();
  };
  const row = (label: string, value: React.ReactNode, edit?: boolean) => (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">
        {value}
        {edit && canAdjust && (
          <button type="button" className="ml-2 text-xs text-brand-600 hover:underline" onClick={() => setAction("edit")} aria-label={`Edit ${label}`}>
            ✎
          </button>
        )}
      </span>
    </div>
  );
  const varLabel = variationLabel(p.variation) || p.variation.shortName;
  const kindTitle = p.kind === "CUT" ? "Cut piece" : `${KIND_LABEL[p.kind]} ${rollWord(meta)}`;

  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <PageHeader
        back={{ href: `/inventory?focus=${p.product.id}`, label: "Stock In" }}
        title={`${varLabel} · ${kindTitle}`}
        badge={
          <>
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${KIND_CLASS[p.kind]}`}>{KIND_LABEL[p.kind]}</span>
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}`}>{active ? "Active" : "Used up"}</span>
            <LengthViewToggle />
          </>
        }
        subtitle={`${p.product.name} · ${L(p.originalLength)} received ${day(p.receivedAt)}`}
        actions={
          <button type="button" className="btn-secondary" onClick={() => window.print()} title="Print this record (QR label later)">
            Print label
          </button>
        }
      />
      <Alert kind="success" message={flash} />

      <section className="card grid gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <span className="text-xs uppercase tracking-wide text-slate-400">Remaining</span>
            <div className="text-2xl font-bold text-slate-900">
              {L(p.remainingLength)} <span className="text-base font-normal text-slate-500">of {L(p.originalLength)}</span>
            </div>
          </div>
          <UsedBar remaining={p.remainingLength} original={p.originalLength} />
        </div>
        <p className="text-sm text-slate-600">
          Used {L(used)} · sold {L(p.used.sold)} · cut into pieces {L(p.used.cutIntoPieces)} · written off {L(p.used.writtenOff)}
          {p.used.corrected !== 0 && <> · corrected {p.used.corrected > 0 ? "+" : "−"}{L(Math.abs(p.used.corrected))}</>}
        </p>
        {canAdjust && active && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
            {p.kind === "CLOSED" && <button className="btn-secondary" onClick={() => setAction("open")}>Open</button>}
            <button className="btn-secondary" onClick={() => setAction("cut")}>Cut</button>
            <button className="btn-secondary" onClick={() => setAction("correct")}>Correct length</button>
            <button className="btn-secondary" onClick={() => setAction("edit")}>Edit details</button>
            <button className="btn border border-rose-300 bg-white text-rose-700 hover:bg-rose-50" onClick={() => setAction("writeoff")}>Write off</button>
          </div>
        )}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-2 font-semibold text-slate-900">{p.kind === "CUT" ? "Piece" : rollWord(meta).replace(/^./, (c) => c.toUpperCase())} details</h2>
          {row("Original length", L(p.originalLength))}
          {row("Received", day(p.receivedAt))}
          {p.parent && row("Cut from", <Link className="text-brand-700 hover:underline" href={`/inventory/rolls/${p.parent.id}`}>Parent {rollWord(meta)} ↗</Link>)}
          {row("Purchase", p.purchase ? <Link className="text-brand-700 hover:underline" href={`/purchases/${p.purchase.id}`}>{p.purchase.number ?? "Purchase"} ↗</Link> : "—")}
          {row("Supplier", p.supplier?.name ?? "—")}
          {wh.enabled && row("Warehouse", p.warehouseId ? `${wh.codeOf(p.warehouseId)} · ${wh.byId.get(p.warehouseId)?.name ?? ""}${p.setId ? " (in a set)" : ""}` : "—")}
          {p.unitCost !== null && row("Cost", fmtRate(meta.lengthUnit, p.unitCost))}
          {row("Opened", p.openedAt ? `${day(p.openedAt)}${p.openedBy ? ` · ${p.openedBy}` : ""}` : "Not opened")}
          {row("Notes", p.notes ?? "—", true)}
        </section>
        <section className="card p-4">
          <h2 className="mb-2 font-semibold text-slate-900">Cut pieces from this {p.kind === "CUT" ? "piece" : rollWord(meta)}</h2>
          {p.children.length === 0 ? (
            <p className="text-sm text-slate-500">None yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {p.children.map((c) => (
                <Link key={c.id} href={`/inventory/rolls/${c.id}`} className={`rounded border px-2 py-1 text-xs hover:border-brand-400 ${c.status === "ACTIVE" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-400 line-through"}`} title={c.status === "ACTIVE" ? `${L(c.remainingLength)} left of ${L(c.originalLength)}` : "Used up"}>
                  {kindPhrase(c.kind, meta.rollName)} · {L(c.status === "ACTIVE" ? c.remainingLength : c.originalLength)}
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">History</h2>
        <div className="overflow-x-auto">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th className="text-right">Change</th>
                <th>Before → after</th>
                {wh.enabled && <th>Warehouse</th>}
                <th>Ref</th>
                <th>Reason</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((h) => (
                <tr key={h.id}>
                  <td className="whitespace-nowrap text-slate-500">{dateTime(h.occurredAt)}</td>
                  <td>{ACTION_LABEL[h.action] ?? h.action}</td>
                  <td className={`whitespace-nowrap text-right font-semibold ${h.change > 0 ? "text-emerald-700" : h.change < 0 ? "text-rose-600" : "text-slate-400"}`}>
                    {h.change > 0 ? "+" : h.change < 0 ? "−" : ""}
                    {h.change === 0 ? "0" : L(Math.abs(h.change))}
                  </td>
                  <td className="whitespace-nowrap text-slate-600">
                    {L(h.before)} → {L(h.after)}
                  </td>
                  {wh.enabled && (
                    <td className="whitespace-nowrap font-mono text-xs text-slate-600">
                      {h.warehouseId ? wh.codeOf(h.warehouseId) : "—"}
                      {h.toWarehouseId ? ` → ${wh.codeOf(h.toWarehouseId)}` : ""}
                    </td>
                  )}
                  <td className="whitespace-nowrap text-xs">
                    {h.transferId ? (
                      <Link className="text-brand-700 hover:underline" href={`/shifts/${h.transferId}`}>Shift</Link>
                    ) : h.sale ? (
                      <Link className="text-brand-700 hover:underline" href={`/sales/${h.sale.id}`}>{h.sale.number ?? "Sale"}</Link>
                    ) : h.purchase ? (
                      <Link className="text-brand-700 hover:underline" href={`/purchases/${h.purchase.id}`}>{h.purchase.number ?? "Purchase"}</Link>
                    ) : h.related ? (
                      <Link className="text-brand-700 hover:underline" href={`/inventory/rolls/${h.related.id}`}>→ {h.action === "CUT" && p.parent?.id === h.related.id ? `parent ${rollWord(meta)}` : "piece"}</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-slate-600">{h.reason && h.reason !== h.sale?.number && h.reason !== h.purchase?.number ? h.reason : "—"}</td>
                  <td className="text-slate-500">{h.by ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {action === "edit" && <EditPieceModal open piece={target(p, varLabel)} onClose={() => setAction(null)} onDone={done} />}
      {(action === "cut" || action === "open") && <CutModal open openOnly={action === "open"} piece={target(p, varLabel)} meta={meta} onClose={() => setAction(null)} onDone={done} />}
      {action === "writeoff" && <WriteOffModal open piece={target(p, varLabel)} meta={meta} onClose={() => setAction(null)} onDone={done} />}
      {action === "correct" && <CorrectModal open piece={target(p, varLabel)} meta={meta} onClose={() => setAction(null)} onDone={done} />}
    </div>
  );
}
