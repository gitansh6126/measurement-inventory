"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeftIcon, InvoiceIcon, PlusIcon } from "@/components/icons";
import { useCan } from "@/components/MeContext";
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
      </Toolbar>
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
            <table className="table">
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
