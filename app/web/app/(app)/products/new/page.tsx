"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useCan } from "@/components/MeContext";
import { ProductForm } from "@/components/products/ProductForm";
import { PageHeader } from "@/components/ui";
import type { Product } from "@/lib/types";

function NewProductContent() {
  const router = useRouter();
  const params = useSearchParams();
  const canEdit = useCan("product.write");
  const presetCategoryId = params.get("categoryId") ?? undefined;
  // V3.1: opened from a category of another head (Industry → Gym…).
  const presetHeadCategoryId = params.get("headCategoryId") ?? undefined;
  // Opened from Stock In: return there with the new product focused so its opening stock can be entered.
  const fromStockIn = params.get("from") === "stock-in";
  const backHref = fromStockIn ? "/inventory" : "/products";

  if (!canEdit) {
    return (
      <div className="card p-8 text-center text-slate-500">
        You do not have permission to create products.
      </div>
    );
  }

  const handleSaved = (p: Product) => {
    router.push(fromStockIn ? `/inventory?focus=${p.id}` : `/products?focus=${p.id}`);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-20">
      <PageHeader
        back={{ href: backHref, label: fromStockIn ? "Stock In" : "Products" }}
        title="Add Product"
        subtitle="Create a simple, variable, measured or grouped (set) product."
      />

      <ProductForm
        presetCategoryId={presetCategoryId}
        presetHeadCategoryId={presetHeadCategoryId}
        onSaved={handleSaved}
        onCancel={() => router.push(backHref)}
        isPage
      />
    </div>
  );
}

export default function NewProductPage() {
  return (
    <Suspense fallback={<div className="card p-8 text-center text-slate-400">Loading form…</div>}>
      <NewProductContent />
    </Suspense>
  );
}
