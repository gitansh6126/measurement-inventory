"use client";

import { Suspense, useEffect, useState } from "react";
import type { CartMode } from "@/components/CartContext";
import { ProductDrawer } from "@/components/ProductDrawer";
import { useCart } from "@/components/CartContext";
import { PurchaseSetsModal } from "@/components/sets/PurchaseSetsModal";
import { SaleSetsModal } from "@/components/sets/SaleSetsModal";
import { CategoryRail } from "@/components/catalog/CategoryRail";
import { Chips, ShopLayout } from "@/components/catalog/ShopLayout";
import { ProductThumb } from "@/components/ProductThumb";
import { StockBadge } from "@/components/StockBadge";
import { EmptyState, SearchInput } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { CatalogPage, CatalogSort, CatalogStock, CategoryStatsList, ProductCard, StockProduct } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { useCatalogNav, ALL_CATEGORIES } from "@/lib/useCatalogNav";
import { fmtRate, fmtSellRate } from "@/lib/measure";
import { useLengthView } from "@/lib/lengthView";

const STOCK_CHIPS: { value: CatalogStock; label: string }[] = [
  { value: "all", label: "All" },
  { value: "in_stock", label: "In stock" },
  { value: "low", label: "Low" },
];

const SORT_OPTIONS: { value: CatalogSort; label: string }[] = [
  { value: "high_moving", label: "High Moving" },
  { value: "name", label: "Name" },
  { value: "price_asc", label: "Price ↑" },
  { value: "price_desc", label: "Price ↓" },
  { value: "stock", label: "Stock" },
  { value: "newest", label: "Newest" },
];

function normalizeCategory(category: string | null) {
  if (!category || category === ALL_CATEGORIES) return ALL_CATEGORIES;
  return category;
}

function priceDisplay(product: ProductCard, mode: CartMode) {
  if (mode === "purchase") {
    const low = product.costMin ? money(product.costMin) : null;
    const high = product.costMax ? money(product.costMax) : null;
    const costText = product.costMin && product.costMax ? (low === high ? fmtRate(product.lengthUnit, product.costMin) : fmtRate(product.lengthUnit, product.costMin, product.costMax)) : low ?? high ?? "—";
    return (
      <div className="text-sm font-semibold text-slate-700">
        <span className="text-xs font-normal text-slate-500 mr-1" title="Purchase cost">Cost:</span>
        {costText}
        {product.vendor && (
          <div className="text-xs font-normal text-sky-700" title="Active supplier rates (Vendor pricing)">
            Vendor: {product.vendor.min === product.vendor.max ? fmtRate(product.lengthUnit, product.vendor.min) : fmtRate(product.lengthUnit, product.vendor.min, product.vendor.max)}
            <span className="text-slate-500"> · {product.vendor.suppliers} supplier{product.vendor.suppliers === 1 ? "" : "s"}</span>
          </div>
        )}
      </div>
    );
  }

  const hasMin = Number(product.minSalePrice) > 0;
  const minPrice = hasMin ? product.minSalePrice : product.priceMin;
  const salePrice = product.priceMax ?? product.priceMin;
  const displayText = fmtSellRate(product.lengthUnit, minPrice, salePrice, "Sell: ");

  return (
    <div
      className="text-xs sm:text-sm font-semibold text-brand-700"
      title={displayText}
    >
      {displayText}
    </div>
  );
}

/** Stock as shown on the card: feet + inches products are stored in inches but priced per ft. */
function stockDisplay(product: ProductCard) {
  if (product.lengthUnit === "ft_in") return { quantity: product.quantity / 12, unit: "ft" };
  return { quantity: product.quantity, unit: product.lengthUnit ?? product.unit };
}

export function ProductBrowser({ mode }: { mode: CartMode }) {
  return (
    <Suspense fallback={<div className="card p-4 text-sm text-slate-500">Loading catalog…</div>}>
      <ProductBrowserInner mode={mode} />
    </Suspense>
  );
}

function ProductBrowserInner({ mode }: { mode: CartMode }) {
  useLengthView();
  const nav = useCatalogNav();
  const { query: searchText, setQuery: setSearchText, category } = nav;
  // Tapping a product opens the bottom drawer (V1 flow) over the category grid.
  const [open, setOpen] = useState<StockProduct | null>(null);
  const [opening, setOpening] = useState("");
  const [openError, setOpenError] = useState("");
  const [setsFor, setSetsFor] = useState<string | null>(null);
  const cart = useCart();
  const [sort, setSort] = useState<CatalogSort>("high_moving");
  const [state, setState] = useState<CatalogStock>("all");
  const [pageSize, setPageSize] = useState(48);
  const [search, setSearch] = useState(searchText);

  useEffect(() => setSearch(searchText), [searchText]);

  const categoryKey = normalizeCategory(category);
  const activeCategory = search.trim() ? null : categoryKey;

  useEffect(() => {
    setPageSize(48);
  }, [search, state, sort, categoryKey]);

  const params = new URLSearchParams();
  if (search.trim()) params.set("q", search.trim());
  if (activeCategory && activeCategory !== ALL_CATEGORIES) params.set("categoryId", activeCategory === "none" ? "none" : activeCategory);
  params.set("sort", sort);
  params.set("state", state);
  params.set("page", "1");
  params.set("pageSize", String(pageSize));

  const cats = useApi<CategoryStatsList>("/categories?stats=1");
  const catalog = useApi<CatalogPage>(`/catalog/products?${params}`);
  const products = catalog.data?.products ?? [];

  const onSearch = (value: string) => {
    setSearch(value);
    setSearchText(value);
  };

  async function openProduct(id: string) {
    if (opening) return;
    // V3.1: a grouped product is bought as whole sets through the set sheet, and sold by
    // picking sets in stock (with part changes) in the sale set picker.
    if (products.find((p) => p.id === id)?.productType === "grouped") {
      setSetsFor(id);
      return;
    }
    setOpening(id);
    setOpenError("");
    try {
      const { product } = await api<{ product: StockProduct }>(`/inventory/products/${id}`);
      setOpen(product);
    } catch (e) {
      setOpenError(errorText(e));
    } finally {
      setOpening("");
    }
  }

  return (
    <ShopLayout
      rail={<CategoryRail data={cats.data} selected={activeCategory} onSelect={(id) => nav.selectCategory(id)} alerts />}
      title="Products"
      count={catalog.data ? `${catalog.data.total} items` : undefined}
      toolbar={
        // Phones: search on its own full-width row, then sort and the stock chips.
        <div className="grid w-full min-w-0 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
          <SearchInput value={search} onChange={onSearch} placeholder="Search products…" className="sm:flex-1" />
          <div className="flex min-w-0 items-center gap-2">
            <select className="input w-auto shrink-0" value={sort} onChange={(e) => setSort(e.target.value as CatalogSort)} aria-label="Sort products">
              {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <Chips value={state} onChange={setState} options={STOCK_CHIPS.map((option) => ({ value: option.value, label: option.label }))} label="Stock filter" />
          </div>
        </div>
      }
    >
      {openError && <p className="text-sm text-rose-600" role="alert">{openError}</p>}
      {catalog.data && products.length > 0 ? (
        // The cart keeps its card grid only (no Grid | Table switch): tap a card to open the drawer.
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {products.map((row) => (
            <div key={row.id} className="group card flex min-w-0 flex-col overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <button
                type="button"
                onClick={() => openProduct(row.id)}
                aria-label={`Open ${row.name}`}
                aria-busy={opening === row.id}
                className="flex flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <div className="w-full overflow-hidden bg-slate-100">
                  <ProductThumb src={row.imageUrl} name={row.name} className="aspect-[4/3] w-full text-xl transition-transform duration-300 group-hover:scale-105" />
                </div>
                <div className="grid w-full gap-1 p-3 pb-2">
                  <div className="line-clamp-2 font-semibold text-slate-900">{row.name}</div>
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                    <span className="truncate">{row.productType === "measured" || row.productType === "variable" ? `${row.activeVariations} variations` : row.category?.name ?? row.shortName}</span>
                    <StockBadge {...stockDisplay(row)} state={row.state} />
                  </div>
                  {priceDisplay(row, mode)}
                </div>
              </button>
              <div className="px-3 pb-3">
                {row.productType === "grouped" ? (
                  mode === "purchase" ? (
                    <button type="button" className="btn-secondary w-full text-sm" onClick={() => setSetsFor(row.id)}>
                      Enter sets
                    </button>
                  ) : (
                    <button type="button" className="btn-primary w-full text-sm" onClick={() => setSetsFor(row.id)} disabled={row.quantity <= 0}>
                      {row.quantity > 0 ? "Choose sets" : "No sets in stock"}
                    </button>
                  )
                ) : row.productType !== "simple" ? (
                  <button type="button" className="btn-secondary w-full text-sm" onClick={() => openProduct(row.id)}>
                    {row.productType === "measured" ? (mode === "sale" ? "Choose length" : "Enter rolls") : "Choose options"}
                  </button>
                ) : (
                  <button type="button" className="btn-primary w-full text-sm" onClick={() => openProduct(row.id)}>
                    Add to Cart
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : catalog.data && products.length === 0 ? (
        <div className="card"><EmptyState title="No products found">Try another search or category.</EmptyState></div>
      ) : (
        <div className="card p-6 text-sm text-slate-500">Loading products…</div>
      )}
      {catalog.data && catalog.data.total > products.length && (
        <div className="flex justify-center pt-2">
          <button type="button" className="btn-secondary" onClick={() => setPageSize((size) => size + 48)}>Load more</button>
        </div>
      )}
      {open && <ProductDrawer product={open} mode={mode} onClose={() => setOpen(null)} />}
      {setsFor && mode === "sale" && (
        <SaleSetsModal
          productId={setsFor}
          excludeSetIds={cart.lines.flatMap((l) => (l.saleSets ?? []).map((s) => s.setId))}
          orderId={cart.order?.id}
          onClose={() => setSetsFor(null)}
          onConfirm={(lines) => {
            for (const line of lines) {
              const err = cart.add("sale", line);
              if (err) {
                setOpenError(err);
                break;
              }
            }
            setSetsFor(null);
          }}
        />
      )}
      {setsFor && mode === "purchase" && (
        <PurchaseSetsModal
          productId={setsFor}
          onClose={() => setSetsFor(null)}
          onConfirm={(lines) => {
            for (const line of lines) {
              const err = cart.add("purchase", line);
              if (err) {
                setOpenError(err);
                break;
              }
            }
            setSetsFor(null);
          }}
        />
      )}
    </ShopLayout>
  );
}