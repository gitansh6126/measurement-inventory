"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useCan } from "@/components/MeContext";
import { ProductForm } from "@/components/products/ProductForm";
import { Alert, PageHeader, TableSkeleton } from "@/components/ui";
import type { Product } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function EditProductContent() {
  const params = useParams();
  const id = String(params.id);
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnToStockIn = searchParams.get("returnTo") === "inventory";
  const returnToProducts = searchParams.get("returnTo") === "products";
  const returnHref = returnToStockIn
    ? `/inventory?focus=${encodeURIComponent(id)}`
    : returnToProducts
      ? `/products?expand=${encodeURIComponent(id)}`
      : "/products";
  const returnLabel = returnToStockIn ? "Stock In" : "Products";
  const canEdit = useCan("product.write");
  const { data, error, reload } = useApi<{ product: Product }>(id ? `/products/${id}` : null);

  if (!canEdit) {
    return (
      <div className="card p-8 text-center text-slate-500">
        You do not have permission to edit products.
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <PageHeader back={{ href: returnHref, label: returnLabel }} title="Edit Product" />
        <Alert message={error} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <PageHeader back={{ href: returnHref, label: returnLabel }} title="Edit Product" />
        <TableSkeleton rows={6} />
      </div>
    );
  }

  const handleSaved = () => {
    void reload();
    router.push(returnHref);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        back={{ href: returnHref, label: returnLabel }}
        title={`Edit ${data.product.name}`}
        subtitle={`Update details, gallery images, and variation options for ${data.product.name}`}
      />

      <ProductForm
        product={data.product}
        onSaved={handleSaved}
        onCancel={() => router.push(returnHref)}
        isPage
      />
    </div>
  );
}

export default function EditProductPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={6} />}>
      <EditProductContent />
    </Suspense>
  );
}
