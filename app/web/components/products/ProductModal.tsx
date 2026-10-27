"use client";

import { Modal } from "@/components/ui";
import type { Product } from "@/lib/types";
import { ProductForm } from "./ProductForm";

export function ProductModal({
  open,
  product,
  presetCategoryId,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = create */
  product: Product | null;
  presetCategoryId?: string;
  onClose: () => void;
  onSaved: (p: Product, created: boolean) => void;
}) {
  const isEdit = !!product;

  return (
    <Modal open={open} xl title={isEdit ? `Edit ${product!.name}` : "Add Product"} onClose={onClose}>
      <ProductForm
        product={product}
        presetCategoryId={presetCategoryId}
        onSaved={onSaved}
        onCancel={onClose}
        isPage={false}
      />
    </Modal>
  );
}
