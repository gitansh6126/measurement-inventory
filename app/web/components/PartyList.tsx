"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BookIcon, EditIcon, InvoiceIcon, PlusIcon, SlidersIcon } from "@/components/icons";
import { PageMobileSidebar, SidebarField, SidebarSection } from "@/components/PageMobileSidebar";
import { useCan, useMe } from "@/components/MeContext";
import { PartyModal, type Party } from "@/components/PartyModal";
import { CreditScoreBadge } from "@/components/CreditScoreBadge";
import { Alert, Avatar, EmptyState, PageHeader, SearchInput, Segmented, StatusBadge, Switch, TableSkeleton, Toolbar } from "@/components/ui";
import { api } from "@/lib/api";
import { errorText, useApi } from "@/lib/useApi";
import { useDebounced } from "@/lib/useDebounced";

export function PartyList({ mode }: { mode: "customer" | "supplier" }) {
  const isSupplier = mode === "supplier";
  const me = useMe();
  const searchParams = useSearchParams();

  // Role permissions:
  // Customers can be created by any role (including sales_staff).
  // Suppliers can only be created by admin or sales_manager (parties.ts line 77).
  const canCreate = useCan("party.create") && (!isSupplier || me?.user.role !== "sales_staff");
  const canEdit = useCan("party.edit");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "all">("active");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<"name_asc" | "name_desc" | "credit_desc" | "credit_asc">("name_asc");
  const [modal, setModal] = useState<{ party: Party | null } | null>(null);
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const activeFilterCount =
    (status !== "active" ? 1 : 0) +
    (category ? 1 : 0) +
    (sort !== "name_asc" ? 1 : 0);

  const resetFilters = () => {
    setStatus("active");
    setCategory("");
    setSort("name_asc");
  };

  const q = useDebounced(search.trim());

  // Deep-link / auto-open from ?new=true
  useEffect(() => {
    const isNew = searchParams.get("new");
    if ((isNew === "true" || isNew === "1") && canCreate) {
      setModal({ party: null });
    }
  }, [searchParams, canCreate]);

  const queryParams = new URLSearchParams({
    role: mode,
    status,
  });
  if (q) queryParams.set("q", q);
  if (category) queryParams.set("category", category);

  const { data, error, reload } = useApi<{ parties: Party[] }>(`/parties?${queryParams}`);
  const { data: catData, reload: reloadCategories } = useApi<{ categories: string[] }>(isSupplier ? null : "/parties/categories");

  async function toggleActive(p: Party, active: boolean) {
    setFlash(null);
    try {
      await api(`/parties/${p.id}`, { method: "PATCH", body: { active } });
      setFlash({
        kind: "success",
        text: `"${p.name}" marked as ${active ? "active" : "inactive"}`,
      });
      await reload();
    } catch (err) {
      setFlash({ kind: "error", text: errorText(err) });
    }
  }

  const rawParties = data?.parties ?? [];
  const parties = [...rawParties].sort((a, b) => {
    if (sort === "name_desc") return b.name.localeCompare(a.name);
    if (sort === "credit_desc") return (b.creditScore ?? 0) - (a.creditScore ?? 0) || a.name.localeCompare(b.name);
    if (sort === "credit_asc") return (a.creditScore ?? 0) - (b.creditScore ?? 0) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });

  const activeCount = parties.filter((p) => p.active).length;
  const total = parties.length;

  return (
    <div>
      {/* Mobile-only compact header (<1024px) */}
      <div className="mb-3 space-y-2 lg:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href="/"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 shadow-xs hover:bg-slate-50"
              aria-label="Back to Home"
              title="Back to Home"
            >
              ←
            </Link>
            <h1 className="truncate text-lg font-bold text-slate-900">
              {isSupplier ? "Suppliers" : "Customers"}
            </h1>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              {total}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {canCreate && (
              <button
                type="button"
                className="btn-primary !px-2.5 !py-1 text-xs"
                onClick={() => setModal({ party: null })}
              >
                <PlusIcon className="h-3.5 w-3.5" /> Add
              </button>
            )}
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="relative inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <SlidersIcon className="h-3.5 w-3.5 text-slate-500" />
              Options
              {activeFilterCount > 0 && (
                <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={`Search ${isSupplier ? "supplier" : "customer"} name, phone, city…`}
        />

        {(status !== "active" || category || sort !== "name_asc") && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
            {status !== "active" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
                Status: All
                <button
                  type="button"
                  onClick={() => setStatus("active")}
                  className="ml-0.5 text-brand-500 hover:text-brand-900"
                  aria-label="Clear status filter"
                >
                  ✕
                </button>
              </span>
            )}
            {category && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
                Category: {category}
                <button
                  type="button"
                  onClick={() => setCategory("")}
                  className="ml-0.5 text-brand-500 hover:text-brand-900"
                  aria-label="Clear category filter"
                >
                  ✕
                </button>
              </span>
            )}
            {sort !== "name_asc" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
                Sort: {sort === "name_desc" ? "Z-A" : sort === "credit_desc" ? "Credit (High)" : "Credit (Low)"}
                <button
                  type="button"
                  onClick={() => setSort("name_asc")}
                  className="ml-0.5 text-brand-500 hover:text-brand-900"
                  aria-label="Reset sort"
                >
                  ✕
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-semibold text-slate-500 underline hover:text-slate-800"
            >
              Reset all
            </button>
          </div>
        )}
      </div>

      {/* Desktop header and toolbar (>=1024px) */}
      <div className="hidden lg:block">
        <PageHeader
          title={isSupplier ? "Suppliers" : "Customers"}
          subtitle={
            data
              ? `${activeCount} active of ${total} ${isSupplier ? "supplier" : "customer"}${total === 1 ? "" : "s"}`
              : undefined
          }
          actions={
            canCreate && (
              <button className="btn-primary" onClick={() => setModal({ party: null })}>
                <PlusIcon className="h-4 w-4" /> {isSupplier ? "Add Supplier" : "Add Customer"}
              </button>
            )
          }
        />

        <Toolbar>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={`Search ${isSupplier ? "supplier" : "customer"} name, phone, city…`}
          />
          <div className="flex items-center gap-2">
            <Segmented
              label="Status filter"
              value={status}
              onChange={(s) => setStatus(s)}
              options={[
                { value: "active", label: "Active" },
                { value: "all", label: "All" },
              ]}
            />
            {!isSupplier && !!catData?.categories.length && (
              <select className="input !w-auto text-xs" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category">
                <option value="">All categories</option>
                {catData.categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            <select
              className="input !w-auto text-xs"
              value={sort}
              onChange={(e) => setSort(e.target.value as "name_asc" | "name_desc" | "credit_desc" | "credit_asc")}
              aria-label="Sort by"
            >
              <option value="name_asc">Name (A-Z)</option>
              <option value="name_desc">Name (Z-A)</option>
              {!isSupplier && (
                <>
                  <option value="credit_desc">Credit Score (High to Low)</option>
                  <option value="credit_asc">Credit Score (Low to High)</option>
                </>
              )}
            </select>
          </div>
        </Toolbar>
      </div>

      {/* In-Page Mobile Sidebar Drawer */}
      <PageMobileSidebar
        open={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        title={isSupplier ? "Supplier Options" : "Customer Options"}
        subtitle={`Filter and sort ${isSupplier ? "suppliers" : "customers"}`}
        badge={
          activeFilterCount > 0 ? (
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-bold text-brand-700">
              {activeFilterCount} active
            </span>
          ) : undefined
        }
        footer={
          <div className="flex items-center gap-2">
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={resetFilters}
                className="btn-secondary !py-2 text-xs"
              >
                Reset
              </button>
            )}
            <button
              type="button"
              className="btn-primary flex-1 justify-center !py-2 text-sm"
              onClick={() => setMobileSidebarOpen(false)}
            >
              Show {total} results
            </button>
          </div>
        }
      >
        {canCreate && (
          <SidebarSection title="Quick Actions">
            <button
              type="button"
              className="btn-primary w-full justify-center !py-2.5 text-sm"
              onClick={() => {
                setMobileSidebarOpen(false);
                setModal({ party: null });
              }}
            >
              <PlusIcon className="h-4 w-4" /> Add {isSupplier ? "Supplier" : "Customer"}
            </button>
          </SidebarSection>
        )}

        <SidebarSection title="Status">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setStatus("active")}
              className={`rounded-lg px-3 py-2 text-xs font-medium text-center transition-all ${
                status === "active"
                  ? "bg-brand-600 text-white shadow-sm"
                  : "bg-slate-50 text-slate-700 hover:bg-slate-100 ring-1 ring-inset ring-slate-200"
              }`}
            >
              Active only ({activeCount})
            </button>
            <button
              type="button"
              onClick={() => setStatus("all")}
              className={`rounded-lg px-3 py-2 text-xs font-medium text-center transition-all ${
                status === "all"
                  ? "bg-brand-600 text-white shadow-sm"
                  : "bg-slate-50 text-slate-700 hover:bg-slate-100 ring-1 ring-inset ring-slate-200"
              }`}
            >
              All parties ({total})
            </button>
          </div>
        </SidebarSection>

        {!isSupplier && !!catData?.categories.length && (
          <SidebarSection title="Customer Category">
            <SidebarField label="Filter by Category">
              <select
                className="input text-xs"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories ({catData.categories.length})</option>
                {catData.categories.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </SidebarField>
          </SidebarSection>
        )}

        <SidebarSection title="Sort Order">
          <div className="grid grid-cols-1 gap-1.5">
            {[
              { id: "name_asc", label: "Name (A → Z)" },
              { id: "name_desc", label: "Name (Z → A)" },
              ...(!isSupplier
                ? [
                    { id: "credit_desc", label: "Credit Score (High to Low)" },
                    { id: "credit_asc", label: "Credit Score (Low to High)" },
                  ]
                : []),
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSort(s.id as "name_asc" | "name_desc" | "credit_desc" | "credit_asc")}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                  sort === s.id
                    ? "bg-brand-600 text-white shadow-sm"
                    : "bg-slate-50 text-slate-700 hover:bg-slate-100 ring-1 ring-inset ring-slate-200"
                }`}
              >
                <span>{s.label}</span>
                {sort === s.id && <span>✓</span>}
              </button>
            ))}
          </div>
        </SidebarSection>
      </PageMobileSidebar>

      <Alert message={flash?.text} kind={flash?.kind} />
      <Alert message={error} />

      <div className="card overflow-x-auto lg:overflow-x-visible">
        {!data && !error ? (
          <TableSkeleton rows={5} />
        ) : parties.length === 0 ? (
          <EmptyState
            icon={isSupplier ? <BookIcon className="h-6 w-6" /> : <InvoiceIcon className="h-6 w-6" />}
            title={q ? "Nothing matches your search" : `No ${isSupplier ? "suppliers" : "customers"} yet`}
            action={
              canCreate &&
              !q && (
                <button className="btn-primary" onClick={() => setModal({ party: null })}>
                  <PlusIcon className="h-4 w-4" /> {isSupplier ? "Add Supplier" : "Add Customer"}
                </button>
              )
            }
          />
        ) : (
          <table className="table table-stack">
            <thead>
              <tr>
                <th>{isSupplier ? "Supplier" : "Customer"}</th>
                <th>Phone</th>
                <th>City</th>
                {!isSupplier && <th>Category</th>}
                {!isSupplier && <th>Credit Score</th>}
                <th>Status</th>
                {isSupplier && <th className="w-24 text-center">Pricing</th>}
                {canEdit && <th className="w-12 text-center">Edit</th>}
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => (
                <tr key={p.id} className={p.active ? "" : "opacity-60"}>
                  <td>
                    <div className="flex items-center gap-3">
                      <Avatar name={p.name} size="sm" muted={!p.active} />
                      <div>
                        <Link href={`/${isSupplier ? "suppliers" : "customers"}/${p.id}`} className="font-semibold text-slate-900 hover:text-brand-700 hover:underline">{p.name}</Link>
                        {p.contactPerson && <div className="text-xs text-slate-500">{p.contactPerson}</div>}
                      </div>
                    </div>
                  </td>
                  <td>{p.phone || <span className="text-slate-400">—</span>}</td>
                  <td>{p.city || <span className="text-slate-400">—</span>}</td>
                  {!isSupplier && <td>{p.category || <span className="text-slate-400">—</span>}</td>}
                  {!isSupplier && (
                    <td>
                      <CreditScoreBadge score={p.creditScore ?? 0} showTier />
                    </td>
                  )}
                  <td>
                    {canEdit ? (
                      <Switch
                        checked={p.active}
                        label={p.active ? "Active" : "Inactive"}
                        onChange={(on) => toggleActive(p, on)}
                      />
                    ) : (
                      <StatusBadge status={p.active ? "ACTIVE" : "INACTIVE"} />
                    )}
                  </td>
                  {isSupplier && (
                    <td className="text-center">
                      <Link
                        href={`/supplier-prices?supplierId=${p.id}`}
                        className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-brand-50 hover:text-brand-700 hover:ring-brand-300"
                        title={`View & edit rate card for ${p.name}`}
                      >
                        ₹ Rates
                      </Link>
                    </td>
                  )}
                  {canEdit && (
                    <td className="text-center">
                      <button
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        title={`Edit ${p.name}`}
                        aria-label={`Edit ${p.name}`}
                        onClick={() => setModal({ party: p })}
                      >
                        <EditIcon className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <PartyModal
        open={!!modal}
        party={modal?.party ?? null}
        mode={mode}
        onClose={() => setModal(null)}
        onSaved={(_savedParty, message) => {
          setModal(null);
          setFlash({ kind: "success", text: message });
          void reload();
          if (!isSupplier) void reloadCategories();
        }}
      />
    </div>
  );
}
