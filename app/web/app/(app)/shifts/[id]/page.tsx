"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useCan } from "@/components/MeContext";
import { Alert, Field, Modal, PageHeader, TableSkeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { dateTime, qty } from "@/lib/format";
import { contentsText } from "@/components/sets/SetContents";
import type { TransferDetail } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";

// V3.1 shift detail (docs\WAREHOUSE-V3-PLAN.md §4.2): lines and Cancel (reason). No print slip in V3.

export default function ShiftPage() {
  const { id } = useParams<{ id: string }>();
  const canCancel = useCan("stock.transfer.void");
  const { data, error, reload } = useApi<{ transfer: TransferDetail }>(`/transfers/${id}`);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const t = data?.transfer;

  async function cancel() {
    setBusy(true);
    setCancelError("");
    try {
      await api(`/transfers/${id}/cancel`, { method: "POST", body: { reason } });
      setCancelling(false);
      await reload();
    } catch (e) {
      setCancelError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        back={{ href: "/shifts", label: "Shifts" }}
        title={t ? t.number : "Shift"}
        subtitle={t ? `${t.from?.code} ${t.from?.name} → ${t.to?.code} ${t.to?.name} · ${dateTime(t.date)}${t.createdBy ? ` · by ${t.createdBy}` : ""}` : undefined}
        badge={
          t ? (
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t.status === "DONE" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
              {t.status === "DONE" ? "Done" : "Cancelled"}
            </span>
          ) : undefined
        }
        actions={
          t && t.status === "DONE" && canCancel ? (
            <button type="button" className="btn-secondary text-rose-700" onClick={() => setCancelling(true)}>
              Cancel shift
            </button>
          ) : null
        }
      />
      <Alert message={error} />
      {t?.cancel && (
        <Alert>
          Cancelled {dateTime(t.cancel.at)}
          {t.cancel.by ? ` by ${t.cancel.by}` : ""}: {t.cancel.reason}. Everything went back to {t.from?.code}.
        </Alert>
      )}
      {t?.notes && <p className="mb-3 text-sm text-slate-600">{t.notes}</p>}
      <div className="card overflow-x-auto lg:overflow-x-visible">
        {!t ? (
          <TableSkeleton />
        ) : (
          <table className="table table-stack">
            <thead>
              <tr>
                <th className="w-10">#</th>
                <th>Item</th>
                <th>Roll / set</th>
                <th className="text-right">Quantity</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {t.lines.map((l) => (
                <tr key={l.lineNo}>
                  <td className="stack-hide text-slate-400">{l.lineNo}</td>
                  <td>
                    <div className="font-medium text-slate-900">{l.productName}</div>
                    {l.setId ? (
                      <div className="text-xs text-slate-500">{contentsText(l.setContents ?? [])}</div>
                    ) : (
                      <div className="font-mono text-xs text-slate-500">{l.shortName}</div>
                    )}
                  </td>
                  <td className={l.setId ? "text-xs" : "font-mono text-xs"}>{l.setId ? "Set" : (l.pieceCode ?? "—")}</td>
                  <td className="text-right tabular-nums">
                    {qty(l.quantity)} {l.unit}
                  </td>
                  <td className="text-slate-600">{l.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={cancelling} title={`Cancel ${t?.number ?? "shift"}`} onClose={() => setCancelling(false)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Everything goes back to {t?.from?.code}. Only possible while {t?.to?.code} still holds it; otherwise shift it back instead.
          </p>
          <Alert message={cancelError} />
          <Field label="Reason">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Shifted to the wrong warehouse" />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setCancelling(false)}>
              Keep it
            </button>
            <button type="button" className="btn-primary bg-rose-600 hover:bg-rose-700" disabled={busy || reason.trim().length < 3} onClick={cancel}>
              {busy ? "Cancelling…" : "Cancel shift"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
