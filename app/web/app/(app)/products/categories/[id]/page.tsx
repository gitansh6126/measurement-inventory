"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PackageIcon, PlusIcon } from "@/components/icons";
import { useCan } from "@/components/MeContext";
import { ProductThumb } from "@/components/ProductThumb";
import { CategoryModal } from "@/components/products/CategoryModal";
import { ViewToggle } from "@/components/catalog/ViewToggle";
import { StockBadge } from "@/components/StockBadge";
import { Alert, EmptyState, Menu, Modal, PageHeader, SearchInput, TableSkeleton, Toolbar } from "@/components/ui";
import { api } from "@/lib/api";
import { money, qty, variationLabel } from "@/lib/format";
import type { Category, CategoryHead, Product, StockProduct } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { useViewMode } from "@/lib/useViewMode";

/** V3.1 (0038): how a product is in the category — whole, some variations, or a set via its parts. */
type CategoryProduct = Product & { scope?: "all" | "variations" | "parts" };
const hasVariations = (p: Product) => p.productType === "variable" || p.productType === "measured";

// main v2 CategoryDetailView: side card (image + name, click to edit), product list with Remove,
// and "+ Add Product" → Add Existing Product / Add New Product (preselected category).
export default function CategoryDetailPage() {
  const id = String(useParams().id);
  const router = useRouter();
  const canWrite = useCan("category.write");
  const canCreate = useCan("product.write");
  const { data, error, reload } = useApi<{ category: Category; products: CategoryProduct[] }>(`/categories/${id}`);
  const stock = useApi<{ products: StockProduct[] }>(`/inventory?status=all&categoryId=${id}`);
  const heads = useApi<{ heads: CategoryHead[] }>("/category-heads?status=all");
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  // V3.1 (0038): the product whose variations in this category are being chosen.
  const [choosing, setChoosing] = useState<Product | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useViewMode("categories.products", "grid");

  async function run(fn: () => Promise<unknown>, ok: string) {
    setFlash(null);
    try {
      await fn();
      setFlash({ kind: "success", text: ok });
      await Promise.all([reload(), stock.reload()]);
    } catch (e) {
      setFlash({ kind: "error", text: errorText(e) });
    }
  }

  if (error) return <Alert message={error} />;
  if (!data) return <TableSkeleton rows={5} />;
  const { category } = data;
  // V3.1: a category of another head (Industry → Gym…) holds products by link; they keep their
  // Product Type and other categories.
  const head = category.headId ? heads.data?.heads.find((h) => h.id === category.headId) : undefined;
  const headName = category.headId ? (head?.name ?? "") : "Product Type";
  const backHref = category.headId ? `/products/categories?head=${category.headId}` : "/products/categories";
  const term = search.trim().toLowerCase();
  const products = term ? data.products.filter((p) => p.name.toLowerCase().includes(term) || p.variations.some((v) => v.shortName.toLowerCase().includes(term))) : data.products;
  const priceRange = (p: Product) => {
    const prices = p.variations.map((v) => Number(v.salePrice));
    if (!prices.length) return "—";
    return Math.min(...prices) === Math.max(...prices) ? money(prices[0] ?? 0) : `${money(Math.min(...prices))} – ${money(Math.max(...prices))}`;
  };
  const remove = (p: Product) =>
    window.confirm(`Remove ${p.name} from ${category.name}?`) &&
    run(() => api(`/categories/${category.id}/products/${p.id}`, { method: "DELETE" }), `${p.name} removed from category`);
  const qtyOf = new Map((stock.data?.products ?? []).map((p) => [p.id, p]));
  const inThis = (p: Product) => p.variations.filter((v) => (v.categoryIds ?? []).includes(category.id));
  // V3.1 (0038): "All variations", the variations in it, or "Sets with a part in it".
  const scopeLine = (p: CategoryProduct) => {
    if (!category.headId) return null;
    if (p.scope === "parts") return <span className="text-xs text-slate-500">Sets with a part in {category.name}</span>;
    if (p.scope !== "variations") return hasVariations(p) ? <span className="text-xs text-slate-500">All variations</span> : null;
    return (
      <span className="flex flex-wrap gap-1">
        {inThis(p).map((v) => (
          <span key={v.id} className={`rounded-full px-2 py-0.5 text-[11px] ring-1 ${v.active ? "bg-violet-50 text-violet-700 ring-violet-200" : "bg-slate-50 text-slate-400 ring-slate-200 line-through"}`}>
            {variationLabel(v, p.attributes)}
          </span>
        ))}
      </span>
    );
  };
  const editVariations = (p: CategoryProduct) =>
    canWrite && category.active && category.headId && hasVariations(p) && p.scope !== "parts" ? (
      <button className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setChoosing(p)}>Edit variations</button>
    ) : null;

  return (
    <div>
      <PageHeader
        back={{ href: backHref, label: headName ? `Categories · ${headName}` : "Categories" }}
        title={category.name}
        badge={!category.active ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600">Inactive</span> : undefined}
        subtitle={`${headName ? `${headName} · ` : ""}${category.productCount} active product${category.productCount === 1 ? "" : "s"}${
          data.products.some((p) => p.active && p.scope && p.scope !== "all")
            ? ` · ${data.products.filter((p) => p.active && p.scope && p.scope !== "all").length} for some variations or sets only`
            : ""
        }`}
        actions={
          category.active &&
          (canWrite || canCreate) && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-600"><PlusIcon className="inline h-4 w-4" /> Add Product</span>
              <Menu
                label="Add product"
                items={[
                  ...(canWrite ? [{ label: "Add Existing Product", onClick: () => setAdding(true) }] : []),
                  ...(canCreate ? [{ label: "Add New Product", onClick: () => router.push(category.headId ? `/products/new?headCategoryId=${category.id}` : `/products/new?categoryId=${category.id}`) }] : []),
                ]}
              />
            </div>
          )
        }
      />
      <Alert message={flash?.text} kind={flash?.kind} />

      <div className="flex flex-col gap-4 md:flex-row">
        <button
          type="button"
          className="card shrink-0 overflow-hidden text-left md:w-56"
          onClick={() => canWrite && setEditing(true)}
          title={canWrite ? "Edit category" : undefined}
          disabled={!canWrite}
        >
          <ProductThumb src={category.imageUrl} name={category.name} className="aspect-square w-full text-lg" />
          <div className="p-3 font-semibold text-slate-900">{category.name}</div>
        </button>

        <div className="grid min-w-0 flex-1 content-start gap-3">
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search products in this category…" />
          <span className="flex-1" />
          <ViewToggle value={view} onChange={setView} />
        </Toolbar>
        <div className={view === "grid" && products.length > 0 ? "" : "card overflow-x-auto lg:overflow-x-visible"}>
          {products.length === 0 ? (
            term ? <EmptyState icon={<PackageIcon className="h-6 w-6" />} title="No products match the search" /> :
            <EmptyState icon={<PackageIcon className="h-6 w-6" />} title="No products in this category">Use “Add Product” to attach an existing product or create a new one here.</EmptyState>
          ) : view === "grid" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {products.map((p) => {
                const s = qtyOf.get(p.id);
                return (
                  <div key={p.id} className={`group card flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-md ${p.active ? "" : "opacity-60"}`}>
                    <Link href={`/products/${p.id}`} className="flex flex-1 flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500" aria-label={`Open ${p.name}`}>
                      <div className="overflow-hidden bg-slate-100">
                        <ProductThumb src={p.imageUrl ?? p.variations[0]?.imageUrl ?? null} name={p.name} className="aspect-[4/3] w-full text-xl transition-transform duration-300 group-hover:scale-105" />
                      </div>
                      <div className="grid flex-1 content-start gap-1 p-3">
                        <div className="line-clamp-2 font-semibold text-slate-900">{p.name}</div>
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="truncate">{p.productType === "variable" ? `${p.variations.length} variations` : p.variations[0]?.shortName}</span>
                          {s && <StockBadge quantity={s.quantity} state={s.state} unit={p.unit} />}
                        </div>
                        <div className="text-sm font-semibold text-brand-700">{priceRange(p)}</div>
                      </div>
                    </Link>
                    {scopeLine(p) && <div className="px-3 pb-2">{scopeLine(p)}</div>}
                    {canWrite && p.scope !== "parts" && (
                      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
                        <button className="text-xs font-semibold text-rose-600 hover:underline" onClick={() => remove(p)}>Remove from category</button>
                        {editVariations(p)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Type</th>
                  <th>Selling Price</th>
                  <th>Minimum Selling Price</th>
                  <th>Stock</th>
                  {canWrite && <th className="text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const s = qtyOf.get(p.id);
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <ProductThumb src={p.imageUrl} name={p.name} className="h-10 w-10 shrink-0 rounded-md text-[7px]" />
                          <div className="grid gap-1">
                            <Link href={`/products/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">{p.name}</Link>
                            {scopeLine(p)}
                          </div>
                        </div>
                      </td>
                      <td className="text-slate-600">{p.productType === "variable" ? `${p.variations.length} variations` : <span className="font-mono text-xs">{p.variations[0]?.shortName}</span>}</td>
                      <td>{priceRange(p)}</td>
                      <td>{p.variations.some((v) => Number(v.minSalePrice) > 0) ? money(Math.min(...p.variations.filter((v) => Number(v.minSalePrice) > 0).map((v) => Number(v.minSalePrice)))) : "—"}</td>
                      <td className={s && s.quantity <= s.lowStockThreshold ? "text-rose-600" : ""}>{s ? `${qty(s.quantity)} ${p.unit}` : "—"}</td>
                      {canWrite && (
                        <td className="text-right">
                          {p.scope !== "parts" && (
                            <div className="flex items-center justify-end gap-3">
                              {editVariations(p)}
                              <button className="btn-danger" onClick={() => remove(p)}>
                                Remove
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        </div>
      </div>

      <CategoryModal open={editing} category={category} head={{ id: category.headId ?? null, name: headName }} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void reload(); }} />
      <AddExistingModal
        open={adding}
        categoryId={category.id}
        linked={!!category.headId}
        excludeIds={new Set(products.map((p) => p.id))}
        onClose={() => setAdding(false)}
        onAdd={(p) => run(() => api(`/categories/${category.id}/products`, { method: "POST", body: { productId: p.id } }), `${p.name} added to ${category.name}`)}
        onChoose={(p) => {
          setAdding(false);
          setChoosing(p);
        }}
      />
      <ChooseVariationsModal
        key={choosing?.id ?? "none"}
        product={choosing}
        categoryName={category.name}
        initial={choosing && data.products.find((p) => p.id === choosing.id)?.scope === "variations" ? inThis(choosing).map((v) => v.id) : null}
        onClose={() => setChoosing(null)}
        onSave={(p, ids) => {
          setChoosing(null);
          void run(
            () => api(`/categories/${category.id}/products`, { method: "POST", body: ids ? { productId: p.id, variationIds: ids } : { productId: p.id } }),
            ids ? `${p.name}: ${ids.length} variation${ids.length === 1 ? "" : "s"} in ${category.name}` : `${p.name} (all variations) in ${category.name}`,
          );
        }}
      />
    </div>
  );
}

// main v2 AddExistingProductModal: search all products and attach one.
function AddExistingModal({
  open,
  categoryId,
  linked,
  excludeIds,
  onClose,
  onAdd,
  onChoose,
}: {
  open: boolean;
  categoryId: string;
  linked: boolean;
  excludeIds: Set<string>;
  onClose: () => void;
  onAdd: (p: Product) => void;
  /** V3.1 (0038): put only some variations of a Variable / Measured product in the category. */
  onChoose: (p: Product) => void;
}) {
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    if (open) setSearch("");
  }, [open, categoryId]);
  const list = useApi<{ products: Product[] }>(open ? `/products?pageSize=50${q ? `&q=${encodeURIComponent(q)}` : ""}` : null);
  const rows = (list.data?.products ?? []).filter((p) => !excludeIds.has(p.id));

  return (
    <Modal open={open} wide title="Add Existing Product" onClose={onClose}>
      <SearchInput value={search} onChange={setSearch} placeholder="Search products…" />
      <div className="mt-3 max-h-[50vh] divide-y divide-slate-100 overflow-auto rounded-md border border-slate-200">
        {!list.data && <TableSkeleton rows={3} />}
        {list.data && rows.length === 0 && <p className="p-4 text-center text-sm text-slate-500">No other products found.</p>}
        {rows.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-3 py-2">
            <ProductThumb src={p.imageUrl} name={p.name} className="h-9 w-9 shrink-0 rounded text-[6px]" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-slate-900">{p.name}</div>
              <div className="truncate text-xs text-slate-500">
                {linked
                  ? [p.category?.name, ...(p.categories ?? []).map((c) => c.name)].filter(Boolean).join(" · ") || "No categories"
                  : p.category ? `Currently in ${p.category.name}` : "No category"}
              </div>
            </div>
            {linked && hasVariations(p) && (
              <button className="btn-secondary" onClick={() => onChoose(p)} title="Only some variations">
                Choose variations
              </button>
            )}
            <button className="btn-secondary" onClick={() => onAdd(p)}>{linked && hasVariations(p) ? "Add all" : "Add"}</button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * V3.1 (0038): the variations of one product in this category — all of them (whole product) or
 * the ticked ones, with quick picks per attribute value.
 */
function ChooseVariationsModal({
  product,
  categoryName,
  initial,
  onClose,
  onSave,
}: {
  product: Product | null;
  categoryName: string;
  /** Variation ids when the product is in it for some variations; null = whole product / new. */
  initial: string[] | null;
  onClose: () => void;
  onSave: (p: Product, variationIds: string[] | null) => void;
}) {
  // Remounted per product (key), so the ticks start from that product's variations in the category.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial ?? []));
  if (!product) return null;
  const shown = product.variations.filter((v) => v.active || picked.has(v.id));
  const values = new Map<string, string[]>();
  for (const v of shown) {
    for (const [name, value] of Object.entries(v.attributes)) {
      if (!value) continue;
      const list = values.get(name) ?? [];
      if (!list.includes(value)) list.push(value);
      values.set(name, list);
    }
  }
  const toggle = (ids: string[], on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });

  return (
    <Modal open wide title={`${product.name} in ${categoryName}`} onClose={onClose}>
      <p className="text-sm text-slate-600">
        Tick the variations that belong in {categoryName}. Variations added later are not included unless you tick them.
      </p>
      <div className="mt-3 grid gap-2">
        {[...values].map(([name, list]) => (
          <div key={name} className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="w-24 shrink-0 text-slate-500">{name}</span>
            {list.map((value) => {
              const ids = shown.filter((v) => v.attributes[name] === value).map((v) => v.id);
              const all = ids.every((id) => picked.has(id));
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={all}
                  className={`rounded-full px-2 py-0.5 ring-1 ${all ? "bg-violet-600 text-white ring-violet-600" : "bg-white text-slate-700 ring-slate-300 hover:bg-slate-50"}`}
                  onClick={() => toggle(ids, !all)}
                >
                  {value}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 grid max-h-[45vh] gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 sm:grid-cols-2">
        {shown.map((v) => (
          <label key={v.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
            <input type="checkbox" checked={picked.has(v.id)} onChange={(e) => toggle([v.id], e.target.checked)} />
            <span className={v.active ? "" : "text-slate-400 line-through"}>{variationLabel(v, product.attributes)}</span>
          </label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <button className="btn-secondary" onClick={() => onSave(product, null)}>
          Whole product (all variations)
        </button>
        <button className="btn-primary" disabled={picked.size === 0} onClick={() => onSave(product, [...picked])}>
          Save {picked.size} variation{picked.size === 1 ? "" : "s"}
        </button>
      </div>
    </Modal>
  );
}
