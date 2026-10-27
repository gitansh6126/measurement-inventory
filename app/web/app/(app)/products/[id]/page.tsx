"use client";

import { useParams } from "next/navigation";
import { ProductDetailView } from "@/components/products/ProductDetailView";

// Dedicated single-product page (owner reference image 2). Product cards and rows open here.
export default function Page() {
  const id = String(useParams().id);
  return <ProductDetailView productId={id} back={{ href: "/products", label: "Products" }} />;
}
