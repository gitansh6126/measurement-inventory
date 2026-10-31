"use client";

import { Modal, TableSkeleton } from "@/components/ui";
import { dateTime, money } from "@/lib/format";
import { rateLabel, type LengthUnit } from "@/lib/measure";
import { useApi } from "@/lib/useApi";

interface Hist {
  id: string;
  supplierName: string | null;
  rate: string;
  /** 12 = per ft; 1 on a feet + inches product = an older per-inch rate (0028). */
  ratePer?: number;
  active: boolean;
  notes: string | null;
  recordedAt: string;
  recordedBy: string | null;
}

/** One supplier's recorded rates for one variation, newest first (both Vendor Pricing views). */
export function PriceHistoryModal({
  title,
  variationId,
  supplierId,
  lengthUnit,
  onClose,
}: {
  title: string;
  variationId: string;
  supplierId: string;
  lengthUnit: LengthUnit | null;
  onClose: () => void;
}) {
  const historyApi = useApi<{ history: Hist[] }>(`/vendor-prices/history?variationId=${variationId}&supplierId=${supplierId}`);
  const history = historyApi.data?.history ?? null;

  return (
    <Modal open title={`Price History — ${title}`} onClose={onClose}>
      <div className="space-y-3">
        {historyApi.error ? (
          <p className="py-8 text-center text-xs text-red-600">{historyApi.error}</p>
        ) : !history ? (
          <TableSkeleton rows={3} />
        ) : history.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500">No price history recorded yet.</p>
        ) : (
          <div className="table-scroll table-container max-h-80 overflow-auto rounded-lg border border-slate-200">
            <table className="table table-stack table-sticky-0 text-xs">
              <thead>
                <tr>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Date</th>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] text-right">Rate</th>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] text-center">Status</th>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Notes</th>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Recorded By</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{dateTime(h.recordedAt)}</td>
                    <td className="text-right font-semibold text-slate-900">
                      {money(h.rate)}
                      {lengthUnit ? ` / ${h.ratePer === 12 ? "ft" : rateLabel(lengthUnit) === "ft" ? "in" : rateLabel(lengthUnit)}` : ""}
                    </td>
                    <td className="text-center">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${h.active ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600"}`}>
                        {h.active ? "Active" : "Paused"}
                      </span>
                    </td>
                    <td className="text-slate-600">{h.notes ?? "—"}</td>
                    <td className="text-slate-500">{h.recordedBy ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
