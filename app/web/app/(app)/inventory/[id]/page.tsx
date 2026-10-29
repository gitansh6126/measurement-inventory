"use client";

import { useParams } from "next/navigation";
import { ProductDetailView } from "@/components/products/ProductDetailView";

// Single-product page opened from Stock In's Grid view; same page as /products/[id].
export default function Page() {
  const id = String(useParams().id);
  return <ProductDetailView productId={id} back={{ href: `/inventory?focus=${id}`, label: "Stock In" }} />;
}
