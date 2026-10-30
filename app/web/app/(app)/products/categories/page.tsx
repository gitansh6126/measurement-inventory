"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EditIcon, LayersIcon, PlusIcon, SlidersIcon } from "@/components/icons";
import { PageMobileSidebar, SidebarField, SidebarSection } from "@/components/PageMobileSidebar";
import { useCan } from "@/components/MeContext";
import { ProductThumb } from "@/components/ProductThumb";
import { CategoryHeadModal } from "@/components/products/CategoryHeadModal";
import { CategoryModal } from "@/components/products/CategoryModal";
import { ViewToggle } from "@/components/catalog/ViewToggle";
import { Alert, EmptyState, Menu, PageHeader, SearchInput, Toolbar } from "@/components/ui";
import { api } from "@/lib/api";
import type { Category, CategoryHead, CategoryList } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { useViewMode } from "@/lib/useViewMode";

// main v2 CategoriesView: a card grid; a card opens the category detail. Categories have no
// Active/Inactive status here (V3.1 owner decision); every category is listed.
// V3.1 category heads (script_versions "Dimensions"): one tab per head. Product Type is built in;
// the company adds heads such as Industry (Agriculture, Gym…) where a product can be in many.
const PRODUCT_TYPE = "product-type";

export default function CategoriesPage() {
  const canEdit = useCan("category.write");
  const isAdmin = useCan("user.manage");
  const [headKey, setHeadKey] = useState(PRODUCT_TYPE);
  const heads = useApi<{ heads: CategoryHead[] }>("/category-heads?status=all");
  const { data, error, reload } = useApi<CategoryList>(`/categories?status=all&headId=${headKey}`);
  const [modal, setModal] = useState<{ category: Category | null } | null>(null);
  const [headModal, setHeadModal] = useState<{ head: CategoryHead | null } | null>(null);
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useViewMode("categories", "grid");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const activeFiltersCount = headKey !== PRODUCT_TYPE ? 1 : 0;

  // The open tab is kept in the address (?head=…) so the back link from a category returns to it.
  useEffect(() => {
    const h = new URLSearchParams(window.location.search).get("head");
    if (h) setHeadKey(h);
  }, []);
  const openHead = (key: string) => {
    setHeadKey(key);
    setSearch("");
    window.history.replaceState(null, "", key === PRODUCT_TYPE ? "/products/categories" : `/products/categories?head=${key}`);
  };

  const headList = (heads.data?.heads ?? []).filter((h) => h.active || isAdmin);
  const head = headList.find((h) => (h.id ?? PRODUCT_TYPE) === headKey) ?? headList[0];
  const headName = head?.name ?? "Product Type";
  const builtIn = !head || head.builtIn;

  async function setHeadActive(h: CategoryHead, active: boolean) {
    try {
      await api(`/category-heads/${h.id}`, { method: "PATCH", body: { active } });
      setFlash({ kind: "success", text: `${h.name} ${active ? "activated" : "deactivated"}` });
      await heads.reload();
      if (!active && !isAdmin) openHead(PRODUCT_TYPE);
    } catch (e) {
      setFlash({ kind: "error", text: errorText(e) });
    }
  }

  const all = data?.categories ?? [];
  const term = search.trim().toLowerCase();
  const list = term ? all.filter((c) => c.name.toLowerCase().includes(term)) : all;
  const categoryHref = (c: Category) => `/products/categories/${c.id}`;
  const headInactive = !!head && !head.active;
  return (
    <div>
      {/* Mobile-only compact header (<1024px) */}
      <div className="mb-3 space-y-2 lg:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href="/products"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-600 shadow-xs hover:bg-slate-50"
              aria-label="Back to Products"
              title="Back to Products"
            >
              ←
            </Link>
            <h1 className="truncate text-lg font-bold text-slate-900">Categories</h1>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              {list.length}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {canEdit && !headInactive && (
              <button
                type="button"
                className="btn-primary !px-2.5 !py-1 text-xs"
                onClick={() => setModal({ category: null })}
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
              {activeFiltersCount > 0 && (
                <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          </div>
        </div>

        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={`Search ${headName} categories…`}
        />

        {headKey !== PRODUCT_TYPE && (
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-0.5 font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
              Head: {headName}
              <button
                type="button"
                onClick={() => openHead(PRODUCT_TYPE)}
                className="ml-0.5 text-brand-500 hover:text-brand-900"
                aria-label="Reset head filter"
              >
                ✕
              </button>
            </span>
            <button
              type="button"
              onClick={() => openHead(PRODUCT_TYPE)}
              className="text-xs font-semibold text-slate-500 underline hover:text-slate-800"
            >
              Reset
            </button>
          </div>
        )}
      </div>

      {/* Desktop header, head tabs, and toolbar (>=1024px) */}
      <div className="hidden lg:block">
        <PageHeader
          title="Categories"
          subtitle={
            data
              ? builtIn
                ? `${all.length} categories · ${data.uncategorizedCount} products without a category`
                : `${all.length} categories under ${headName} · a product can be in several`
              : undefined
          }
          actions={
            canEdit &&
            !headInactive && (
              <button className="btn-primary" onClick={() => setModal({ category: null })}>
                <PlusIcon className="h-4 w-4" /> Add Category
              </button>
            )
          }
        />

        {/* Category heads */}
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2" role="tablist" aria-label="Category heads">
          {headList.map((h) => {
            const key = h.id ?? PRODUCT_TYPE;
            const on = key === (head?.id ?? PRODUCT_TYPE);
            return (
              <button
                key={key}
                role="tab"
                aria-selected={on}
                onClick={() => openHead(key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${on ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"} ${h.active ? "" : "opacity-60"}`}
              >
                {h.name}
                <span className={`ml-1.5 text-xs ${on ? "text-brand-100" : "text-slate-400"}`}>{h.categoryCount}</span>
              </button>
            );
          })}
          {canEdit && (
            <button
              className="rounded-md border border-dashed border-brand-300 px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50"
              onClick={() => setHeadModal({ head: null })}
            >
              <PlusIcon className="inline h-4 w-4" /> New Head
            </button>
          )}
          {canEdit && head && !head.builtIn && (
            <span className="ml-auto">
              <Menu
                label={`${head.name} actions`}
                items={[
                  { label: "Rename head", onClick: () => setHeadModal({ head }) },
                  head.active
                    ? { label: "Deactivate head", onClick: () => window.confirm(`Deactivate ${head.name}? Its categories stop showing on product forms; products keep them.`) && void setHeadActive(head, false) }
                    : { label: "Activate head", onClick: () => void setHeadActive(head, true) },
                ]}
              />
            </span>
          )}
        </div>

        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder={`Search ${headName} categories…`} />
          <span className="flex-1" />
          <ViewToggle value={view} onChange={setView} />
        </Toolbar>
      </div>

      {/* Page Mobile Sidebar */}
      <PageMobileSidebar
        open={mobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
        title="Category Options"
        subtitle="Layout, heads & actions"
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
            Show {list.length} categories
          </button>
        }
      >
        {canEdit && (
          <SidebarSection title="Quick Actions">
            <div className="space-y-2">
              {!headInactive && (
                <button
                  type="button"
                  className="btn-primary w-full justify-center !py-2.5 text-sm"
                  onClick={() => {
                    setMobileSidebarOpen(false);
                    setModal({ category: null });
                  }}
                >
                  <PlusIcon className="h-4 w-4" /> Add Category
                </button>
              )}
              <button
                type="button"
                className="btn-secondary w-full justify-center !py-2 text-xs"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  setHeadModal({ head: null });
                }}
              >
                <PlusIcon className="h-3.5 w-3.5" /> Add Category Head
              </button>
            </div>
          </SidebarSection>
        )}

        <SidebarSection title="Category Head">
          <div className="space-y-1.5">
            {headList.map((h) => {
              const key = h.id ?? PRODUCT_TYPE;
              const on = key === (head?.id ?? PRODUCT_TYPE);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => openHead(key)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-medium transition-all ${
                    on
                      ? "bg-brand-600 text-white shadow-sm"
                      : "bg-slate-50 text-slate-700 hover:bg-slate-100 ring-1 ring-inset ring-slate-200"
                  } ${h.active ? "" : "opacity-60"}`}
                >
                  <span>{h.name}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                      on ? "bg-white/25 text-white" : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {h.categoryCount}
                  </span>
                </button>
              );
            })}
          </div>

          {canEdit && head && !head.builtIn && (
            <div className="mt-3 flex gap-2 border-t border-slate-100 pt-2">
              <button
                type="button"
                className="btn-secondary flex-1 !py-1 text-xs"
                onClick={() => {
                  setMobileSidebarOpen(false);
                  setHeadModal({ head });
                }}
              >
                Rename {head.name}
              </button>
              {head.active ? (
                <button
                  type="button"
                  className="btn-secondary flex-1 !py-1 text-xs text-rose-600 hover:text-rose-700"
                  onClick={() => {
                    if (window.confirm(`Deactivate ${head.name}? Its categories stop showing on product forms; products keep them.`)) {
                      void setHeadActive(head, false);
                    }
                  }}
                >
                  Deactivate
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-secondary flex-1 !py-1 text-xs text-emerald-600 hover:text-emerald-700"
                  onClick={() => void setHeadActive(head, true)}
                >
                  Activate
                </button>
              )}
            </div>
          )}
        </SidebarSection>

        <SidebarSection title="View Mode">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setView("grid")}
              className={`rounded-lg px-3 py-2 text-xs font-medium text-center transition-all ${
                view === "grid"
                  ? "bg-brand-600 text-white shadow-sm"
                  : "bg-slate-50 text-slate-700 hover:bg-slate-100 ring-1 ring-inset ring-slate-200"
              }`}
            >
              Grid view
            </button>
            <button
              type="button"
              onClick={() => setView("table")}
              className={`rounded-lg px-3 py-2 text-xs font-medium text-center transition-all ${
                view === "table"
                  ? "bg-brand-600 text-white shadow-sm"
                  : "bg-slate-50 text-slate-700 hover:bg-slate-100 ring-1 ring-inset ring-slate-200"
              }`}
            >
              Table view
            </button>
          </div>
        </SidebarSection>
      </PageMobileSidebar>
      <Alert message={flash?.text} kind={flash?.kind} />
      <Alert message={error || heads.error} />
      {headInactive && <Alert message={`${headName} is inactive: its categories are hidden from product forms.`} />}

      {!data && !error ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-48 animate-pulse rounded-lg bg-slate-100" />)}
        </div>
      ) : list.length === 0 ? (
        <div className="card">
          {term ? (
            <EmptyState icon={<LayersIcon className="h-6 w-6" />} title="No categories match the search" />
          ) : (
            <EmptyState
              icon={<LayersIcon className="h-6 w-6" />}
              title={`No categories under ${headName} yet`}
              action={canEdit && !headInactive && <button className="btn-primary" onClick={() => setModal({ category: null })}>Add Category</button>}
            >
              {builtIn ? "Create your first category!" : `Add categories such as ${headName === "Industry" ? "Agriculture or Gym" : "the groups you sell to"}, then add products to them.`}
            </EmptyState>
          )}
        </div>
      ) : view === "table" ? (
        <div className="card overflow-x-auto">
          <table className="table" aria-label="Categories">
            <thead>
              <tr>
                <th>Category</th>
                <th className="text-right">Active products</th>
                {canEdit && <th className="text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={categoryHref(c)} className="flex items-center gap-3 hover:text-brand-700">
                      <ProductThumb src={c.imageUrl} name={c.name} className="h-10 w-10 shrink-0 rounded-md text-[7px]" />
                      <span className="font-medium">{c.name}</span>
                    </Link>
                  </td>
                  <td className="text-right">{c.productCount}</td>
                  {canEdit && (
                    <td className="text-right">
                      <button className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" title="Edit" aria-label={`Edit ${c.name}`} onClick={() => setModal({ category: c })}>
                        <EditIcon className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((c) => (
            <div key={c.id} className="card overflow-hidden transition hover:shadow-md">
              <Link href={categoryHref(c)} className="block">
                <ProductThumb src={c.imageUrl} name={c.name} className="aspect-[4/3] w-full text-lg" />
              </Link>
              <div className="flex items-center gap-2 p-3">
                <Link href={categoryHref(c)} className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-slate-900">{c.name}</div>
                  <div className="text-xs text-slate-500">{c.productCount} active product{c.productCount === 1 ? "" : "s"}</div>
                </Link>
                {canEdit && (
                  <button className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100" title="Edit" aria-label={`Edit ${c.name}`} onClick={() => setModal({ category: c })}>
                    <EditIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <CategoryModal
        open={!!modal}
        category={modal?.category ?? null}
        head={{ id: head?.id ?? null, name: headName }}
        onClose={() => setModal(null)}
        onSaved={(c) => { setModal(null); setFlash({ kind: "success", text: `${c.name} saved` }); void reload(); void heads.reload(); }}
      />
      <CategoryHeadModal
        open={!!headModal}
        head={headModal?.head ?? null}
        onClose={() => setHeadModal(null)}
        onSaved={(h) => {
          setHeadModal(null);
          setFlash({ kind: "success", text: `${h.name} saved` });
          void heads.reload();
          if (h.id) openHead(h.id);
        }}
      />
    </div>
  );
}
