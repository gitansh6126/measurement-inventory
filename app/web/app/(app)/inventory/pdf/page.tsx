"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useCan } from "@/components/MeContext";
import { Alert, PageHeader, SearchInput, Segmented, TableSkeleton, Toolbar } from "@/components/ui";
import { DEFAULT_HIDDEN, INVENTORY_COLUMNS, PRODUCT_REPORT_COLUMNS, exportRows, filterProductTableRows } from "@/lib/inventoryColumns";
import { fetchAllInventory } from "@/lib/inventoryExport";
import type { CategoryList, ProductActivityStatus, StockFilter, StockProduct } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";

// "Customize PDF" (V2 plan §1.10): a full-page builder over the same company-scoped inventory
// data and permissions as the table. Filter, tick products and individual variations, choose
// columns, preview, then download. Cost columns appear only for roles that can see costs.

const PREVIEW_ROWS = 60;
type ActivityFilter = "active" | "min-active" | "inactive" | "never-sold" | "all";
const activityFilterByLabel: Record<string, ActivityFilter> = {
  Active: "active",
  "Min-Active": "min-active",
  Inactive: "inactive",
  "Never Sold": "never-sold",
};
const activityLabelByFilter: Partial<Record<ActivityFilter, ProductActivityStatus>> = {
  active: "Active",
  "min-active": "Min-Active",
  inactive: "Inactive",
  "never-sold": "Never Sold",
};

function Builder() {
  const sp = useSearchParams();
  const seesCost = useCan("inventory.configure");
  const productReport = sp.get("source") === "products";
  const initialActivity = activityFilterByLabel[sp.get("activity") ?? ""] ?? "all";
  const [stage, setStage] = useState<StockFilter>(((productReport ? sp.get("quick") : sp.get("state")) as StockFilter) || "all");
  const [activity, setActivity] = useState<ActivityFilter>(initialActivity);
  const [search, setSearch] = useState(productReport ? sp.get("search") ?? "" : sp.get("q") ?? "");
  const [category, setCategory] = useState(productReport ? sp.get("category") ?? "" : sp.get("categoryId") ?? "");
  const columns = (productReport ? PRODUCT_REPORT_COLUMNS : INVENTORY_COLUMNS).filter(
    (c) =>
      (!c.cost || seesCost) &&
      (productReport || seesCost || !["minSalePrice", "salePrice", "minStock"].includes(c.id)),
  );
  const requestedColumns = (sp.get("columns") ?? "").split(",").filter((id) => columns.some((column) => column.id === id));
  const [chosenCols, setChosenCols] = useState<string[]>(requestedColumns.length ? requestedColumns : columns.filter((c) => c.fixed || !DEFAULT_HIDDEN.includes(c.id)).map((c) => c.id));
  const [products, setProducts] = useState<Set<string>>(new Set());
  const [variations, setVariations] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("Stock Report");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const query = new URLSearchParams({
    state: productReport ? "all" : stage,
    status: productReport ? "all" : "active",
    ...(!productReport && search.trim() ? { q: search.trim() } : {}),
    ...(!productReport && category ? { categoryId: category } : {}),
  });
  const queryString = query.toString();
  const [data, setData] = useState<StockProduct[] | null>(null);
  const [error, setError] = useState("");
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const cats = useApi<CategoryList>("/categories");

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    setLoadProgress(null);
    void fetchAllInventory(new URLSearchParams(queryString), (loaded, total) => setLoadProgress({ loaded, total }), controller.signal)
      .then(setData)
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadProgress(null);
        }
      });
    return () => controller.abort();
  }, [queryString]);

  // New data (filters changed): select everything that matches by default.
  const list = useMemo(() => {
    if (!data || !productReport) return data ?? [];
    return filterProductTableRows(data, {
      search,
      category,
      activity: activityLabelByFilter[activity] ?? "",
      quick: stage === "all" ? "" : stage,
    });
  }, [data, productReport, search, category, activity, stage]);

  useEffect(() => {
    if (!data) return;
    setProducts(new Set(list.map((p) => p.id)));
    setVariations(new Set(list.flatMap((p) => p.variations.filter((v) => productReport || v.active).map((v) => v.id))));
  }, [data, list, productReport]);
  const rows = useMemo(
    () => exportRows(list, { products, variations }, { includeInactiveVariations: productReport }),
    [list, products, variations, productReport],
  );
  const cols = columns.filter((c) => chosenCols.includes(c.id));

  const toggleProduct = (id: string, on: boolean) => {
    const p = list.find((x) => x.id === id)!;
    const kids = p.variations.filter((v) => productReport || v.active).map((v) => v.id);
    setProducts((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
    setVariations((s) => { const n = new Set(s); for (const k of kids) { if (on) n.add(k); else n.delete(k); } return n; });
  };
  const toggleVariation = (id: string, on: boolean) => setVariations((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const selectAll = (on: boolean) => {
    setProducts(on ? new Set(list.map((p) => p.id)) : new Set());
    setVariations(on ? new Set(list.flatMap((p) => p.variations.filter((v) => productReport || v.active).map((v) => v.id))) : new Set());
  };

  async function download() {
    setBusy(true);
    setMsg("");
    try {
      const { downloadInventoryPdf } = await import("@/lib/pdf");
      await downloadInventoryPdf({ title: title.trim() || "Stock Report", columns: cols, rows, filename: `${(title.trim() || "stock-report").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf` });
    } catch (e) {
      setMsg(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Customize PDF"
        subtitle="Choose rows and columns, preview, then download"
        back={{ href: productReport ? "/products" : "/inventory", label: productReport ? "Products" : "Stock In" }}
      />
      <Toolbar>
        <Segmented<StockFilter> label="Stock filter" value={stage} onChange={setStage} options={[{ value: "all", label: "All" }, { value: "low", label: "Low" }, { value: "out", label: "Out" }, { value: "negative", label: "Negative" }]} />
        {productReport && (
          <select className="input w-auto" value={activity} onChange={(e) => setActivity(e.target.value as typeof activity)} aria-label="Sales activity">
            <option value="all">All sales activity</option>
            <option value="active">Active</option>
            <option value="min-active">Min-Active</option>
            <option value="inactive">Inactive</option>
            <option value="never-sold">Never Sold</option>
          </select>
        )}
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, short name or SKU…" />
        <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All Categories</option>
          {productReport && <option value="none">Uncategorized</option>}
          {cats.data?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Toolbar>
      <Alert message={error || msg} />
      {loadProgress && <p className="mb-3 text-xs text-slate-500">Loading inventory rows: {loadProgress.loaded} / {loadProgress.total}</p>}

      <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
        <div className="space-y-4">
          <div className="card p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">Rows ({rows.length})</h2>
              <div className="flex gap-2 text-xs">
                <button className="text-brand-600 hover:underline" onClick={() => selectAll(true)}>All</button>
                <button className="text-brand-600 hover:underline" onClick={() => selectAll(false)}>None</button>
              </div>
            </div>
            {!data ? <TableSkeleton rows={4} /> : (
              <div className="max-h-[28rem] space-y-1 overflow-y-auto pr-1 text-sm">
                {list.map((p) => {
                  const kids = p.productType === "variable"
                    ? p.variations.filter((v) => productReport || v.active)
                    : [];
                  return (
                    <div key={p.id}>
                      <label className="flex items-center gap-2 rounded px-1 py-0.5 font-medium hover:bg-slate-50">
                        <input type="checkbox" checked={products.has(p.id)} onChange={(e) => toggleProduct(p.id, e.target.checked)} />
                        {p.name}
                      </label>
                      {kids.map((v) => (
                        <label key={v.id} className="ml-6 flex items-center gap-2 rounded px-1 py-0.5 text-slate-600 hover:bg-slate-50">
                          <input type="checkbox" checked={variations.has(v.id)} onChange={(e) => toggleVariation(v.id, e.target.checked)} />
                          {Object.values(v.attributes).join(" / ") || v.shortName}
                        </label>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="card p-3">
            <h2 className="mb-2 text-sm font-semibold text-slate-800">Columns</h2>
            {columns.map((c) => (
              <label key={c.id} className={`flex items-center gap-2 px-1 py-0.5 text-sm ${c.fixed ? "text-slate-400" : ""}`}>
                <input type="checkbox" disabled={c.fixed} checked={chosenCols.includes(c.id)} onChange={(e) => setChosenCols((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} />
                {c.label}
              </label>
            ))}
          </div>
        </div>

        <div className="card p-3">
          <Toolbar>
            <input className="input flex-1" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} aria-label="Report title" />
            <button className="btn-primary" disabled={busy || !data} onClick={download}>{busy ? "Preparing…" : `Download PDF (${rows.length} rows)`}</button>
          </Toolbar>
          <div className="overflow-x-auto">
            <table className="table text-xs">
              <thead><tr>{cols.map((c) => <th key={c.id} className={c.align === "right" ? "text-right" : ""}>{c.label}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                  <tr key={`${r.product.id}-${r.variation?.id ?? "p"}-${i}`} className={!r.child && r.product.productType === "variable" ? "bg-slate-50 font-semibold" : ""}>
                    {cols.map((c, j) => <td key={c.id} className={c.align === "right" ? "text-right" : ""}>{j === 0 && r.child ? "" : c.value(r.product, r.variation)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > PREVIEW_ROWS && <p className="mt-2 text-xs text-slate-500">Preview shows the first {PREVIEW_ROWS} of {rows.length} rows; the PDF contains all of them.</p>}
            {rows.length === 0 && data && <p className="py-6 text-center text-sm text-slate-500">No rows selected.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <Builder />
    </Suspense>
  );
}
