"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCan } from "@/components/MeContext";
import { PlusIcon, ShiftIcon, SlidersIcon } from "@/components/icons";
import { PageMobileSidebar, SidebarField, SidebarSection } from "@/components/PageMobileSidebar";
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const activeFiltersCount = warehouseId ? 1 : 0;
  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE) });
  if (q.trim()) params.set("q", q.trim());
  if (warehouseId) params.set("warehouseId", warehouseId);
  const { data, error } = useApi<{ transfers: TransferSummary[]; total: number }>(wh.enabled ? `/transfers?${params}` : null);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  const selectedWarehouse = wh.warehouses.find((w) => w.id === warehouseId);

  return (
    <div>
      {/* Mobile-only compact header (<1024px) */}
      <div className="mb-3 space-y-2 lg:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-lg font-bold text-slate-900">Shifts</h1>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              {data?.total ?? 0}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {canShift && wh.enabled && (
              <Link href="/shifts/new" className="btn-primary !px-2.5 !py-1 text-xs">
                <PlusIcon className="h-3.5 w-3.5" /> New
              </Link>
            )}
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="relative inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <SlidersIcon className="h-3.5 w-3.5 text-slate-500" />
              Options
              {activeFiltersCount > 0 && (
                <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          </div>
        </div>

        <SearchInput
          value={q}
          onChange={(v) => {
            setQ(v);
            setPage(1);
          }}
          placeholder="Search number or item…"
        />

        {warehouseId && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
              Warehouse: {selectedWarehouse ? `${selectedWarehouse.code} · ${selectedWarehouse.name}` : "Selected"}
              <button
                type="button"
                onClick={() => {
                  setWarehouseId("");
                  setPage(1);
                }}
                className="ml-0.5 text-brand-500 hover:text-brand-900"
                aria-label="Clear warehouse filter"
              >
                ✕
              </button>
            </span>
            <button
              type="button"
              onClick={() => {
                setWarehouseId("");
                setPage(1);
              }}
              className="text-xs font-semibold text-slate-500 underline hover:text-slate-800"
            >
              Reset
            </button>
          </div>
        )}
      </div>

      {/* Desktop header and toolbar (>=1024px) */}
      <div className="hidden lg:block">
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
      </div>

      <Alert message={error} />
      {wh.loaded && !wh.enabled ? (
        <div className="card">
          <EmptyState icon={<ShiftIcon className="h-6 w-6" />} title="Warehousing is not set up">
            An admin creates the first warehouse on the Warehouses page; shifts start after that.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="hidden lg:block">
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
          </div>

          {/* Page Mobile Sidebar */}
          <PageMobileSidebar
            open={mobileSidebarOpen}
            onClose={() => setMobileSidebarOpen(false)}
            title="Shift Options"
            subtitle="Warehouse filters & actions"
            badge={
              activeFiltersCount > 0 ? (
                <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-700">
                  {activeFiltersCount} active
                </span>
              ) : undefined
            }
            footer={
              <button
                type="button"
                className="btn-primary w-full justify-center !py-2 text-sm"
                onClick={() => setMobileSidebarOpen(false)}
              >
                Show {data?.total ?? 0} shifts
              </button>
            }
          >
            {canShift && wh.enabled && (
              <SidebarSection title="Quick Actions">
                <Link
                  href="/shifts/new"
                  className="btn-primary w-full justify-center !py-2.5 text-sm"
                  onClick={() => setMobileSidebarOpen(false)}
                >
                  <PlusIcon className="h-4 w-4" /> New Shift
                </Link>
              </SidebarSection>
            )}

            <SidebarSection title="Warehouse">
              <SidebarField label="Filter by Warehouse">
                <select
                  className="input text-xs"
                  value={warehouseId}
                  onChange={(e) => {
                    setWarehouseId(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">All warehouses ({wh.warehouses.length})</option>
                  {wh.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} · {w.name}
                    </option>
                  ))}
                </select>
              </SidebarField>
            </SidebarSection>
          </PageMobileSidebar>
          <div className="card overflow-x-auto lg:overflow-x-visible">
            {!data ? (
              <TableSkeleton />
            ) : data.transfers.length === 0 ? (
              <EmptyState icon={<ShiftIcon className="h-6 w-6" />} title="No shifts yet" />
            ) : (
              <table className="table table-stack">
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
