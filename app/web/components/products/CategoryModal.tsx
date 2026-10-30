"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert, Field, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import type { Category } from "@/lib/types";
import { errorText } from "@/lib/useApi";
import { ImageEditorModal, type EditorImageItem } from "./ImageEditorModal";

export function CategoryModal({
  open,
  category,
  head,
  initialName,
  onClose,
  onSaved,
}: {
  open: boolean;
  category: Category | null;
  /** V3.1: the head a new category goes under (omitted / null id = Product Type). */
  head?: { id: string | null; name: string };
  /** V3.1: prefilled name of a new category typed in a product-form dropdown. */
  initialName?: string;
  onClose: () => void;
  onSaved: (c: Category) => void;
}) {
  const [name, setName] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorImages, setEditorImages] = useState<EditorImageItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? initialName ?? "");
    setImageUrl(category?.imageUrl ?? "");
    setError("");
    setSaving(false);
    setEditorOpen(false);
    setEditorImages([]);
  }, [open, category, initialName]);

  const handleFiles = (files: FileList | File[]) => {
    const file = Array.from(files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setEditorImages([
        {
          id: `cat-${Date.now()}`,
          source: reader.result as string,
          name: file.name,
        },
      ]);
      setEditorOpen(true);
    };
    reader.readAsDataURL(file);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    // Opened inside the product form: never let this submit reach it.
    e.stopPropagation();
    setSaving(true);
    try {
      const body = { name, imageUrl: imageUrl || null };
      const r = category
        ? await api<{ category: Category }>(`/categories/${category.id}`, { method: "PATCH", body })
        : await api<{ category: Category }>("/categories", { method: "POST", body: { ...body, headId: head?.id ?? null } });
      onSaved(r.category);
    } catch (err) {
      setError(errorText(err));
      setSaving(false);
    }
  }

  return (
    <Modal open={open} title={category ? "Edit Category" : head?.id ? `Add Category to ${head.name}` : "Add Category"} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Category Name *">
          <input autoComplete="off"
            className="input"
            required
            maxLength={100}
            placeholder="e.g. Lifting Gear"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <div>
          <span className="label">Category Image</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) {
                handleFiles(e.target.files);
                e.target.value = "";
              }
            }}
          />

          <div className="flex items-center gap-4 mt-1">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`group relative flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition ${
                isDragging
                  ? "border-brand-500 bg-brand-50"
                  : "border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-slate-100"
              }`}
              title="Click or drop an image file here"
            >
              {imageUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 opacity-0 transition group-hover:opacity-100">
                    <span className="text-[10px] font-medium text-white">Change</span>
                  </div>
                </>
              ) : (
                <div className="text-center">
                  <span className="text-xl text-slate-400">+</span>
                  <span className="block text-[9px] text-slate-400">Upload</span>
                </div>
              )}
            </div>

            <div className="flex-1 space-y-1">
              {imageUrl ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditorImages([
                        {
                          id: `cat-${category?.id || "curr"}`,
                          source: imageUrl,
                          name: "Category Image",
                        },
                      ]);
                      setEditorOpen(true);
                    }}
                    className="btn-secondary px-2.5 py-1 text-xs"
                  >
                    Crop / Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setImageUrl("")}
                    className="btn-link text-xs text-rose-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="btn-primary text-xs"
                >
                  Upload Image
                </button>
              )}
              <p className="text-xs text-slate-500">
                Direct upload or drag & drop. Cropped to square in popup editor.
              </p>
            </div>
          </div>
        </div>

        <Alert message={error} />

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : category ? "Update" : "Add Category"}
          </button>
        </div>
      </form>

      <ImageEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        context="category"
        images={editorImages}
        onComplete={(urls) => {
          if (urls.length) setImageUrl(urls[0]!);
        }}
      />
    </Modal>
  );
}
