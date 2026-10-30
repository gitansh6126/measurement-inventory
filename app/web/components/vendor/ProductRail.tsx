"use client";

import { useSearchParams } from "next/navigation";

import { useEffect, useMemo, useState } from "react";
import { ProductThumb } from "@/components/ProductThumb";
import { SearchInput } from "@/components/ui";
import { PriceRail, RailItem, type RailMode } from "@/components/vendor/PriceRail";
import type { CatalogPage, CategoryStatsList, ProductCard } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { scrollToFocus } from "@/lib/scrollToFocus";

const NONE = "none";

/** The product picked in the rail; null = matrix comparison across all suppliers. */
export type RailProduct = Pick<
  ProductCard,
  "id" | "name" | "imageUrl" | "category" | "activeVariations" | "productType"
> | null;

export interface ProductRailProps {
  selected: RailProduct;
  onSelect: (p: RailProduct) => void;
  onProductsLoaded?: (products: ProductCard[]) => void;
}

/**
 * Product rail for Vendor Pricing > By product.
 * Provides instant category filtering, search, and a direct list of products,
 * plus a quick link to the cross-supplier Matrix Comparison view.
 */
export function ProductRail({ selected, onSelect, onProductsLoaded }: ProductRailProps) {
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus") ?? searchParams.get("productId");
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");

  // Load categories with product counts
  const cats = useApi<CategoryStatsList>("/categories?stats=1");
  const categories = useMemo(() => {
    if (!cats.data) return [];
    return [
      ...cats.data.categories
        .filter((c) => c.productCount > 0)
        .map((c) => ({ id: c.id, name: c.name, count: c.productCount })),
      ...(cats.data.uncategorized.productCount > 0
        ? [{ id: NONE, name: "Uncategorized", count: cats.data.uncategorized.productCount }]
        : []),
    ];
  }, [cats.data]);

  const totalProducts = cats.data?.all.productCount ?? 0;

  // Load products based on search and category
  const q = search.trim();
  const listUrl = `/catalog/products?sort=name&state=all&page=1&pageSize=100${
    selectedCategory ? `&categoryId=${encodeURIComponent(selectedCategory)}` : ""
  }${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  const list = useApi<CatalogPage>(listUrl);
  const products = list.data?.products ?? [];

  // Notify parent of loaded products
  useEffect(() => {
    if (products.length > 0 && onProductsLoaded) {
      onProductsLoaded(products);
    }
  }, [products, onProductsLoaded]);

  // Auto-scroll to focused product in rail
  useEffect(() => {
    if (!focusId || !products.length) return;
    return scrollToFocus(`product-rail-${focusId}`);
  }, [focusId, products]);

  function pick(p: RailProduct) {
    onSelect(p);
    setOpen(false);
  }

  const loadingRows = (
    <div className="space-y-1.5 p-2" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />
      ))}
    </div>
  );

  return (
    <PriceRail
      title="Products"
      count={cats.data ? `${totalProducts} products` : undefined}
      open={open}
      onOpenChange={setOpen}
      current={
        selected ? (
          <span className="flex items-center gap-2.5">
            <ProductThumb src={selected.imageUrl} name={selected.name} className="h-8 w-8 rounded-md text-[7px]" />
            <span className="min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Product</span>
              <span className="block truncate text-sm font-semibold text-slate-900">{selected.name}</span>
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-slate-100 text-slate-600">
              <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
                <path d="M1 1h6v6H1zM9 1h6v6H9zM1 9h6v6H1zM9 9h6v6H9z" />
              </svg>
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">View</span>
              <span className="block truncate text-sm font-semibold text-slate-900">Matrix Comparison</span>
            </span>
          </span>
        )
      }
      search={
        <div className="space-y-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Filter products…" />
          {categories.length > 0 && (
            <select
              className="input w-full py-1 text-xs"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              aria-label="Filter by Category"
            >
              <option value="">All Categories ({totalProducts})</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
          )}
        </div>
      }
    >
      {/* Option to view Matrix comparison across all suppliers */}
      <RailItem
        selected={selected === null}
        onClick={() => pick(null)}
        thumb={
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-600" aria-hidden>
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
              <path d="M1 1h6v6H1zM9 1h6v6H9zM1 9h6v6H1zM9 9h6v6H9z" />
            </svg>
          </span>
        }
        title="Matrix Comparison"
        subtitle="All suppliers side-by-side"
      />

      {/* Flat List of Products */}
      {list.loading && !list.data ? (
        loadingRows
      ) : products.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-400">
          {q || selectedCategory ? "No products match this filter" : "No products found"}
        </div>
      ) : (
        products.map((p) => (
          <RailItem
            key={p.id}
            id={`product-rail-${p.id}`}
            selected={selected?.id === p.id}
            blink={selected?.id === p.id && focusId === p.id}
            onClick={() => pick(p)}
            thumb={
              <ProductThumb
                src={p.imageUrl}
                name={p.name}
                className="h-9 w-9 rounded-lg border border-slate-200 text-[7px]"
              />
            }
            title={p.name}
            subtitle={
              p.productType === "simple"
                ? p.shortName ?? "Single item"
                : `${p.activeVariations} variation${p.activeVariations === 1 ? "" : "s"}${
                    p.category ? ` · ${p.category.name}` : ""
                  }`
            }
          />
        ))
      )}
    </PriceRail>
  );
}
