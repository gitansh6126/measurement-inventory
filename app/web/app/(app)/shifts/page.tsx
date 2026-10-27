"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCan } from "@/components/MeContext";
import { PlusIcon, ShiftIcon } from "@/components/icons";
import { Alert, EmptyState, PageHeader, SearchInput, TableSkeleton, Toolbar } from "@/components/ui";
import { dateTime } from "@/lib/format";
import type { TransferSummary } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useWarehouses } from "@/lib/useWarehouses";

// V3.1 Shifts list (docs\WAREHOUSE-V3-PLAN.md §4.2): stock moved between warehouses, newest first.

const PAGE = 30;

export default function ShiftsPage() {
  const router = useRouter();
  const canShift = useCan("stock.transfer");
  const wh = useWarehouses();
  const [q, setQ] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE) });
  if (q.trim()) params.set("q", q.trim());
  if (warehouseId) params.set("warehouseId", warehouseId);
  const { data, error } = useApi<{ transfers: TransferSummary[]; total: number }>(wh.enabled ? `/transfers?${params}` : null);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <div>
      <PageHeader
        title="Shifts"
        subtitle="Stock moved from one warehouse to another"
        actions={
          canShift && wh.enabled ? (
            <Link href="/shifts/new" className="btn-primary">
              <PlusIcon className="h-4 w-4" /> New shift
            </Link>
          ) : null
        }
      />
      <Alert message={error} />
      {wh.loaded && !wh.enabled ? (
        <div className="card">
          <EmptyState icon={<ShiftIcon className="h-6 w-6" />} title="Warehousing is not set up">
            An admin creates the first warehouse on the Warehouses page; shifts start after that.
          </EmptyState>
        </div>
      ) : (
        <>
          <Toolbar>
            <SearchInput
              value={q}
              onChange={(v) => {
                setQ(v);
                setPage(1);
              }}
              placeholder="Search number or item…"
              className="max-w-xs"
            />
            <select
              className="input w-auto"
              value={warehouseId}
              onChange={(e) => {
                setWarehouseId(e.target.value);
                setPage(1);
              }}
              aria-label="Warehouse"
            >
              <option value="">All warehouses</option>
              {wh.warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </select>
          </Toolbar>
          <div className="card overflow-x-auto lg:overflow-x-visible">
            {!data ? (
              <TableSkeleton />
            ) : data.transfers.length === 0 ? (
              <EmptyState icon={<ShiftIcon className="h-6 w-6" />} title="No shifts yet" />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Date</th>
                    <th>From → To</th>
                    <th className="text-right">Lines</th>
                    <th>By</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.transfers.map((t) => (
                    <tr key={t.id} className={`cursor-pointer hover:bg-slate-50 ${t.status === "CANCELLED" ? "opacity-60" : ""}`} onClick={() => router.push(`/shifts/${t.id}`)}>
                      <td className="font-mono font-medium text-slate-900">{t.number}</td>
                      <td className="whitespace-nowrap">{dateTime(t.date)}</td>
                      <td className="whitespace-nowrap">
                        <span className="font-semibold">{t.from?.code}</span> → <span className="font-semibold">{t.to?.code}</span>
                        {t.notes && <div className="max-w-xs truncate text-xs text-slate-500">{t.notes}</div>}
                      </td>
                      <td className="text-right tabular-nums">{t.lineCount}</td>
                      <td>{t.createdBy ?? "—"}</td>
                      <td>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${t.status === "DONE" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                          {t.status === "DONE" ? "Done" : "Cancelled"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {data && pages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-sm text-slate-600">
              <button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                Page {page} of {pages}
              </span>
              <button type="button" className="btn-secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
