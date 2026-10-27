"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeftIcon, InvoiceIcon, PlusIcon } from "@/components/icons";
import { useCan } from "@/components/MeContext";
import { EmptyState, PageHeader, Pagination, PeriodFilter, SearchInput, TableSkeleton, Toolbar, type Period } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { errorText, useApi } from "@/lib/useApi";
import { NEXT_STEP, ORDER_STATUS, StatusPill, orderDay, type OrderKind, type OrderStatus } from "./orderStatus";

interface Row {
  id: string;
  number: string;
  status: OrderStatus;
  orderDate: string;
  expectedDate: string | null;
  partyName: string | null;
  total: string;
  lineCount: number;
  version: number;
}

type Tab = "OPEN" | OrderStatus | "ALL";
const TABS: { value: Tab; label: string }[] = [
  { value: "OPEN", label: "Open" },
  { value: "DRAFT", label: ORDER_STATUS.DRAFT.label },
  { value: "PLACED", label: ORDER_STATUS.PLACED.label },
  { value: "ON_DELIVERY", label: ORDER_STATUS.ON_DELIVERY.label },
  { value: "PARTIALLY_FULFILLED", label: ORDER_STATUS.PARTIALLY_FULFILLED.label },
  { value: "COMPLETED", label: ORDER_STATUS.COMPLETED.label },
  { value: "CANCELLED", label: ORDER_STATUS.CANCELLED.label },
  { value: "ALL", label: "All" },
];

const todayIst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/**
 * Sale Orders / Purchase Orders management list (docs/orders/ORDER-LIFECYCLE-PLAN.md §6.2):
 * status tabs with counts, search, period, and a one-click next step per open order.
 * Completing always opens the order page, because it asks for payment and may hit a shortage.
 */
export function OrderList({ kind }: { kind: OrderKind }) {
  const isSale = kind === "SALE";
  const base = isSale ? "/sales/orders" : "/purchases/orders";
  const canCreate = useCan(isSale ? "sale.create" : "purchase.create");
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlPage = parseInt(searchParams.get("page") || "1", 10);

  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [period, setPeriod] = useState<Period>({ from: "", to: "" });
  const [tab, setTab] = useState<Tab>("OPEN");
  const [page, setPage] = useState(Number.isFinite(urlPage) && urlPage > 0 ? urlPage : 1);
  const [pageSize, setPageSize] = useState(25);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

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
    const nextParams = new URLSearchParams(searchParams.toString());
    if (target <= 1) {
      nextParams.delete("page");
    } else {
      nextParams.set("page", String(target));
    }
    const qs = nextParams.toString();
    router.push(qs ? `?${qs}` : window.location.pathname);
  };

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      updatePage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const params = new URLSearchParams({ kind, status: tab, page: String(page), pageSize: String(pageSize) });
  if (q) params.set("q", q);
  if (period.from) params.set("from", period.from);
  if (period.to) params.set("to", period.to);
  const { data, error, reload } = useApi<{ orders: Row[]; counts: Record<string, number>; total: number }>(`/orders?${params}`);
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const today = todayIst();

  async function step(o: Row) {
    const next = NEXT_STEP[o.status];
    if (!next || next.to === "COMPLETED") return;
    setBusy(o.id);
    setActionError("");
    try {
      await api(`/orders/${o.id}/status`, { method: "POST", body: { to: next.to, version: o.version } });
      await reload();
    } catch (e) {
      setActionError(`${o.number}: ${errorText(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader
        title={isSale ? "Sale Orders" : "Purchase Orders"}
        subtitle={isSale ? "Orders move Draft → Placed → On delivery → Completed. Stock is taken only when an order is completed." : "Orders move Draft → Placed → On delivery → Completed. Stock is received only when an order is completed."}
        back={page > 1 ? { label: `Page ${page - 1}`, onClick: () => updatePage(page - 1) } : undefined}
        actions={
          canCreate && (
            <Link href={isSale ? "/sales/new" : "/purchases/new"} className="btn-primary">
              <PlusIcon className="h-4 w-4" /> New order
            </Link>
          )
        }
      />

      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Order status">
        {TABS.map((t) => {
          const active = tab === t.value;
          const count = data?.counts[t.value];
          return (
            <button
              key={t.value}
              role="tab"
              aria-selected={active}
              onClick={() => {
                setTab(t.value);
                updatePage(1);
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${active ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}
            >
              {t.value in ORDER_STATUS && <span className={`h-2 w-2 rounded-full ${ORDER_STATUS[t.value as OrderStatus].dot}`} aria-hidden />}
              {t.label}
              {count !== undefined && <span className={`rounded-full px-1.5 text-xs ${active ? "bg-white/20" : "bg-slate-100 text-slate-600"}`}>{count}</span>}
            </button>
          );
        })}
      </div>

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
        <SearchInput value={search} onChange={setSearch} placeholder={`Search order number or ${isSale ? "customer" : "supplier"}…`} />
        <PeriodFilter value={period} onChange={(p) => { setPeriod(p); updatePage(1); }} />
      </Toolbar>
      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}
      {actionError && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{actionError}</p>}

      <div className="card overflow-x-auto lg:overflow-x-visible">
        {!data && !error ? (
          <TableSkeleton rows={6} />
        ) : data?.orders.length === 0 ? (
          <EmptyState
            icon={<InvoiceIcon className="h-6 w-6" />}
            title={q || period.from || period.to ? "Nothing matches" : tab === "OPEN" ? "No open orders" : `No ${ORDER_STATUS[tab as OrderStatus]?.label.toLowerCase() ?? ""} orders`}
          >
            {!q && tab === "OPEN" && <p className="text-sm text-slate-500">Add items to the cart, then choose <b>Save as order</b> at checkout.</p>}
          </EmptyState>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Order No.</th>
                  <th>Date</th>
                  <th>{isSale ? "Customer" : "Supplier"}</th>
                  <th>Items</th>
                  <th>{isSale ? "Deliver by" : "Expected by"}</th>
                  <th>Status</th>
                  <th className="text-right">Total</th>
                  <th className="text-right"><span className="sr-only">Next step</span></th>
                </tr>
              </thead>
              <tbody>
                {(data?.orders ?? []).map((o) => {
                  const next = canCreate ? NEXT_STEP[o.status] : undefined;
                  const late = o.expectedDate && o.expectedDate < today && (o.status === "PLACED" || o.status === "ON_DELIVERY" || o.status === "PARTIALLY_FULFILLED" || o.status === "DRAFT");
                  const closed = o.status === "CANCELLED";
                  return (
                    <tr key={o.id} className={closed ? "text-slate-400" : ""}>
                      <td>
                        <Link href={`${base}/${o.id}`} className={`font-semibold hover:underline ${closed ? "text-slate-500 line-through" : "text-brand-700"}`}>{o.number}</Link>
                      </td>
                      <td className="text-slate-500">{orderDay(o.orderDate)}</td>
                      <td>{o.partyName ?? <span className="text-slate-400">{isSale ? "Walk-in" : "—"}</span>}</td>
                      <td>{o.lineCount} item{o.lineCount === 1 ? "" : "s"}</td>
                      <td className={late ? "font-medium text-rose-600" : "text-slate-500"}>
                        {o.expectedDate ? orderDay(`${o.expectedDate}T00:00:00+05:30`) : <span className="text-slate-300">—</span>}
                        {late && <span className="ml-1 text-xs">(late)</span>}
                      </td>
                      <td><StatusPill status={o.status} /></td>
                      <td className={`text-right font-semibold ${closed ? "line-through" : ""}`}>{money(o.total)}</td>
                      <td className="text-right">
                        {next &&
                          (next.to === "COMPLETED" ? (
                            <Link href={`${base}/${o.id}?complete=1`} className="btn-secondary !px-2.5 !py-1 text-xs">{next.label}</Link>
                          ) : (
                            <button className="btn-secondary !px-2.5 !py-1 text-xs" disabled={busy === o.id} onClick={() => step(o)}>
                              {busy === o.id ? "…" : next.label}
                            </button>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <Pagination
              label="orders"
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
