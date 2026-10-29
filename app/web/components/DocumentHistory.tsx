"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeftIcon, InvoiceIcon, PlusIcon, SlidersIcon } from "@/components/icons";
import { useCan } from "@/components/MeContext";
import { PageMobileSidebar, SidebarField, SidebarSection } from "@/components/PageMobileSidebar";
import { EmptyState, PageHeader, Pagination, PeriodFilter, SearchInput, Segmented, TableSkeleton, Toolbar, type Period } from "@/components/ui";
import { money } from "@/lib/format";
import { useApi } from "@/lib/useApi";

interface Row {
  id: string;
  number: string;
  date: string;
  partyName: string | null;
  total: string;
  lineCount: number;
  status: "COMPLETED" | "CANCELLED" | "REPLACED";
  revision?: number;
  edited?: boolean;
  payment: { mode: string | null; status: string | null; amountPaid: string | null } | null;
}

type StatusFilter = "all" | "completed" | "cancelled" | "replaced";
const PAY: Record<string, string> = { PAID: "Paid", PARTIAL: "Part paid", PENDING: "Pending" };
const PAY_TONE: Record<string, string> = { PAID: "bg-emerald-50 text-emerald-700", PARTIAL: "bg-amber-50 text-amber-700", PENDING: "bg-slate-100 text-slate-600" };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

/**
 * Sale / Purchase History in marble list style (PageHeader, Toolbar, PeriodFilter, Pagination).
 * V2: status filter (cancelled documents, D3), payment column, and an embedded mode used by the
 * customer / supplier profile pages (partyId set, no page header).
 */
export function DocumentHistory({ mode, partyId, embedded }: { mode: "sale" | "purchase"; partyId?: string; embedded?: boolean }) {
  const isSale = mode === "sale";
  const canCreate = useCan(isSale ? "sale.create" : "purchase.create");
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlPage = parseInt(searchParams.get("page") || "1", 10);

  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState<Period>({ from: "", to: "" });
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(Number.isFinite(urlPage) && urlPage > 0 ? urlPage : 1);
  const [pageSize, setPageSize] = useState(embedded ? 10 : 25);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const activeFiltersCount = (status !== "all" ? 1 : 0) + (period.from || period.to ? 1 : 0);

  // Sync state if URL query param changes (browser Back / Forward)
  useEffect(() => {
    const p = parseInt(searchParams.get("page") || "1", 10);
    const valid = Number.isFinite(p) && p > 0 ? p : 1;
    if (valid !== page) {
      setPage(valid);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const updatePage = (nextPage: number) => {
    const target = Math.max(1, nextPage);
    setPage(target);
    if (!embedded) {
      const nextParams = new URLSearchParams(searchParams.toString());
      if (target <= 1) {
        nextParams.delete("page");
      } else {
        nextParams.set("page", String(target));
      }
      const qs = nextParams.toString();
      router.push(qs ? `?${qs}` : window.location.pathname);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      updatePage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), status });
  if (q) params.set("q", q);
  if (period.from) params.set("from", period.from);
  if (period.to) params.set("to", period.to);
  if (partyId) params.set("partyId", partyId);
  const base = isSale ? "sales" : "purchases";
  const { data, error } = useApi<{ documents: Row[]; total: number }>(`/${base}?${params}`);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const newHref = `/${base}/new`;

  return (
    <div>
      {!embedded && (
        <>
          {/* Mobile Page Header Bar */}
          <div className="no-print mb-3 lg:hidden space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  {isSale ? "Sale History" : "Purchase History"}
                </h1>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                  {total}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {canCreate && (
                  <Link href={newHref} className="btn-primary py-1 px-2.5 text-xs font-semibold shadow-xs">
                    <PlusIcon className="h-3.5 w-3.5" />
                    <span>New</span>
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(true)}
                  className={`btn-secondary py-1 px-2.5 text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                    activeFiltersCount > 0 ? "border-brand-500 bg-brand-50/60 text-brand-700" : ""
                  }`}
                  aria-label="Open filters"
                >
                  <SlidersIcon className="h-3.5 w-3.5 text-slate-600" />
                  <span>Filters</span>
                  {activeFiltersCount > 0 && (
                    <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white leading-none">
                      {activeFiltersCount}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Mobile Search input */}
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder={partyId ? "Search number…" : `Search number or ${isSale ? "customer" : "supplier"}…`}
            />

            {/* Active filter chips */}
            {(search || status !== "all" || period.from || period.to) && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs [scrollbar-width:none]">
                <span className="text-[11px] font-medium text-slate-400 shrink-0">Filters:</span>
                {status !== "all" && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100/90 px-2.5 py-0.5 font-medium text-amber-800 text-[11px]">
                    Status: {status.toUpperCase()}
                    <button type="button" onClick={() => { setStatus("all"); updatePage(1); }} className="hover:text-amber-950 font-bold ml-0.5" aria-label="Remove status filter">×</button>
                  </span>
                )}
                {(period.from || period.to) && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-100/90 px-2.5 py-0.5 font-medium text-sky-800 text-[11px]">
                    Dates: {period.from || "Any"} to {period.to || "Any"}
                    <button type="button" onClick={() => { setPeriod({ from: "", to: "" }); updatePage(1); }} className="hover:text-sky-950 font-bold ml-0.5" aria-label="Remove date filter">×</button>
                  </span>
                )}
                {search && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-200/90 px-2.5 py-0.5 font-medium text-slate-700 text-[11px]">
                    &ldquo;{search}&rdquo;
                    <button type="button" onClick={() => setSearch("")} className="hover:text-slate-900 font-bold ml-0.5" aria-label="Clear search">×</button>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => { setSearch(""); setStatus("all"); setPeriod({ from: "", to: "" }); updatePage(1); }}
                  className="shrink-0 text-[11px] font-semibold text-slate-500 hover:text-brand-600 underline ml-1 cursor-pointer"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>

          {/* In-Page Mobile Sidebar for Document History */}
          <PageMobileSidebar
            open={mobileSidebarOpen}
            onClose={() => setMobileSidebarOpen(false)}
            title={isSale ? "Sale History Filters" : "Purchase History Filters"}
            subtitle="Filter by status and date period"
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
                onClick={() => setMobileSidebarOpen(false)}
                className="btn-primary w-full py-2.5 text-sm font-semibold shadow-sm justify-center cursor-pointer"
              >
                Show {total} {isSale ? "Sales" : "Purchases"}
              </button>
            }
          >
            {/* Status Section */}
            <SidebarSection title="Status Filter">
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { value: "all", label: "All Documents" },
                  { value: "completed", label: "Completed" },
                  { value: "cancelled", label: "Cancelled" },
                  { value: "replaced", label: "Replaced" },
                ].map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => {
                      setStatus(s.value as StatusFilter);
                      updatePage(1);
                    }}
                    className={`rounded-lg border px-2 py-1.5 text-xs font-semibold text-center transition-all cursor-pointer ${
                      status === s.value
                        ? "border-brand-600 bg-brand-50 text-brand-700 shadow-xs"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </SidebarSection>

            {/* Date Range Section */}
            <SidebarSection title="Date Period">
              <PeriodFilter
                value={period}
                onChange={(p) => {
                  setPeriod(p);
                  updatePage(1);
                }}
              />
            </SidebarSection>

            {/* Quick Actions */}
            {canCreate && (
              <SidebarSection title="Quick Actions">
                <Link
                  href={newHref}
                  className="btn-primary w-full justify-center py-2 text-xs font-semibold"
                  onClick={() => setMobileSidebarOpen(false)}
                >
                  <PlusIcon className="h-4 w-4" /> {isSale ? "Create New Sale" : "Create New Purchase"}
                </Link>
              </SidebarSection>
            )}
          </PageMobileSidebar>
        </>
      )}

      {/* Desktop Header & Toolbars - preserved for screens lg and up */}
      <div className={embedded ? "" : "hidden lg:block"}>
        {!embedded && (
          <PageHeader
            title={isSale ? "Sale History" : "Purchase History"}
            subtitle={data ? `${total} ${isSale ? "sale" : "purchase"}${total === 1 ? "" : "s"}` : undefined}
            back={page > 1 ? { label: `Page ${page - 1}`, onClick: () => updatePage(page - 1) } : undefined}
            actions={canCreate && <Link href={newHref} className="btn-primary"><PlusIcon className="h-4 w-4" /> {isSale ? "New Sale" : "New Purchase"}</Link>}
          />
        )}
        <Toolbar>
          {page > 1 && (
            <button
              type="button"
              className="btn-secondary flex items-center gap-1 text-xs"
              onClick={() => updatePage(page - 1)}
              title={`Go back to page ${page - 1}`}
            >
              <ArrowLeftIcon className="h-3.5 w-3.5" /> Page {page - 1}
            </button>
          )}
          <SearchInput value={search} onChange={setSearch} placeholder={partyId ? "Search number…" : `Search number or ${isSale ? "customer" : "supplier"}…`} />
          <PeriodFilter value={period} onChange={(p) => { setPeriod(p); updatePage(1); }} />
          <div className="max-w-full overflow-x-auto">
            <Segmented<StatusFilter>
              label="Status"
              value={status}
              onChange={(s) => { setStatus(s); updatePage(1); }}
              options={[
                { value: "all", label: "All" },
                { value: "completed", label: "Completed" },
                { value: "cancelled", label: "Cancelled" },
                { value: "replaced", label: "Replaced" },
              ]}
            />
          </div>
        </Toolbar>
      </div>
      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}
      <div className="card overflow-x-auto lg:overflow-x-visible">
        {!data && !error ? (
          <TableSkeleton rows={6} />
        ) : data?.documents && data.documents.length === 0 ? (
          <EmptyState
            icon={<InvoiceIcon className="h-6 w-6" />}
            title={q || period.from || period.to || status !== "all" ? "Nothing matches" : `No ${isSale ? "sales" : "purchases"} yet`}
            action={canCreate && !q && !embedded && <Link href={newHref} className="btn-primary">{isSale ? "New Sale" : "New Purchase"}</Link>}
          />
        ) : (
          <>
            {/* Phones get one tappable card per document instead of a sideways-scrolling table. */}
            {(
              <ul className="divide-y divide-slate-100 md:hidden">
                {(data?.documents || []).map((d) => {
                  const cancelled = d.status === "CANCELLED";
                  const replaced = d.status === "REPLACED";
                  const muted = cancelled || replaced;
                  return (
                    <li key={d.id}>
                      <Link href={`/${base}/${d.id}`} className="block px-4 py-3 active:bg-slate-50">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`font-semibold ${muted ? "text-slate-500 line-through" : "text-brand-700"}`}>{d.number}</span>
                              {cancelled && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-700">Cancelled</span>}
                              {replaced && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">Replaced</span>}
                              {d.edited && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800">R{d.revision}</span>}
                            </div>
                            {!partyId && <div className={`mt-0.5 truncate text-sm ${muted ? "text-slate-400" : "text-slate-700"}`}>{d.partyName ?? "Walk-in"}</div>}
                          </div>
                          <div className={`shrink-0 text-right font-semibold ${muted ? "text-slate-400" : "text-slate-900"} ${cancelled ? "line-through" : ""}`}>{money(d.total)}</div>
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span>{day(d.date)} · {d.lineCount} item{d.lineCount === 1 ? "" : "s"}</span>
                          {d.payment?.status && (
                            <span className={`rounded-full px-2 py-0.5 font-medium ${PAY_TONE[d.payment.status] ?? ""}`}>{PAY[d.payment.status] ?? d.payment.status}</span>
                          )}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <table className="table hidden md:table">
              <thead>
                <tr>
                  <th>{isSale ? "Sale" : "Purchase"} No.</th>
                  <th>Date</th>
                  {!partyId && <th>{isSale ? "Customer" : "Supplier"}</th>}
                  <th>Items</th>
                  <th>Payment</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(data?.documents || []).map((d) => {
                  const cancelled = d.status === "CANCELLED";
                  const replaced = d.status === "REPLACED";
                  return (
                    <tr key={d.id} className={cancelled || replaced ? "text-slate-400" : ""}>
                      <td>
                        <Link href={`/${base}/${d.id}`} className={`font-semibold hover:underline ${cancelled || replaced ? "text-slate-500 line-through" : "text-brand-700"}`}>{d.number}</Link>
                        {cancelled && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-rose-700">Cancelled</span>}
                        {replaced && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">Replaced</span>}
                        {d.edited && (
                          <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800" title={`Revision ${d.revision}`}>R{d.revision}</span>
                        )}
                      </td>
                      <td className="text-slate-500">{day(d.date)}</td>
                      {!partyId && <td>{d.partyName ?? <span className="text-slate-400">{isSale ? "Walk-in" : "—"}</span>}</td>}
                      <td>{d.lineCount} item{d.lineCount === 1 ? "" : "s"}</td>
                      <td>
                        {d.payment?.status ? (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PAY_TONE[d.payment.status] ?? ""}`}>{PAY[d.payment.status] ?? d.payment.status}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className={`text-right font-semibold ${cancelled ? "line-through" : ""}`}>{money(d.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination
              label={isSale ? "sales" : "purchases"}
              state={{
                page,
                pages,
                pageSize,
                total,
                from: total ? (page - 1) * pageSize + 1 : 0,
                to: Math.min(page * pageSize, total),
                setPage: updatePage,
                setPageSize: (n) => { setPageSize(n); updatePage(1); },
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
