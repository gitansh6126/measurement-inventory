"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BookIcon, EditIcon, InvoiceIcon, PlusIcon } from "@/components/icons";
import { useCan, useMe } from "@/components/MeContext";
import { PartyModal, type Party } from "@/components/PartyModal";
import { CreditScoreBadge } from "@/components/CreditScoreBadge";
import { Alert, Avatar, EmptyState, PageHeader, SearchInput, Segmented, StatusBadge, Switch, TableSkeleton, Toolbar } from "@/components/ui";
import { api } from "@/lib/api";
import { errorText, useApi } from "@/lib/useApi";

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
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"active" | "all">("active");
  const [sort, setSort] = useState<"name_asc" | "name_desc" | "credit_desc" | "credit_asc">("name_asc");
  const [modal, setModal] = useState<{ party: Party | null } | null>(null);
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  // Debounce search query
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

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

  const { data, error, reload } = useApi<{ parties: Party[] }>(`/parties?${queryParams}`);

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
          <table className="table">
            <thead>
              <tr>
                <th>{isSupplier ? "Supplier" : "Customer"}</th>
                <th>Phone</th>
                <th>City</th>
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
        }}
      />
    </div>
  );
}
