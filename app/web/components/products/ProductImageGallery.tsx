"use client";

import { useRef, useState, type DragEvent, type ChangeEvent } from "react";
import { PlusIcon } from "@/components/icons";
import { ProductThumb } from "@/components/ProductThumb";
import { ImageEditorModal, type EditorImageItem } from "./ImageEditorModal";

export interface ProductImageGalleryProps {
  images: string[];
  onChange: (images: string[]) => void;
  disabled?: boolean;
}

export function ProductImageGallery({ images, onChange, disabled }: ProductImageGalleryProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorImages, setEditorImages] = useState<EditorImageItem[]>([]);
  const [editorIndex, setEditorIndex] = useState(0);
  const [editMode, setEditMode] = useState<"new" | "replace">("new");
  const [replacingIndex, setReplacingIndex] = useState<number>(-1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_IMAGES = 10;

  const processFiles = (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!files.length) return;

    if (editMode === "replace") {
      // Replacing single image
      const file = files[0]!;
      const reader = new FileReader();
      reader.onload = () => {
        setEditorImages([
          {
            id: `upload-${Date.now()}-0`,
            source: reader.result as string,
            name: file.name,
          },
        ]);
        setEditorIndex(0);
        setEditorOpen(true);
      };
      reader.readAsDataURL(file);
      return;
    }

    const availableSlots = MAX_IMAGES - images.length;
    if (availableSlots <= 0) {
      alert(`A product can have a maximum of ${MAX_IMAGES} images.`);
      return;
    }

    const filesToRead = files.slice(0, availableSlots);
    if (files.length > availableSlots) {
      alert(
        `Only ${availableSlots} more image${availableSlots > 1 ? "s" : ""} can be added (maximum ${MAX_IMAGES} images).`
      );
    }

    const readPromises = filesToRead.map((file, idx) => {
      return new Promise<EditorImageItem>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            id: `upload-${Date.now()}-${idx}`,
            source: reader.result as string,
            name: file.name,
          });
        };
        reader.readAsDataURL(file);
      });
    });

    Promise.all(readPromises).then((items) => {
      setEditMode("new");
      setEditorImages(items);
      setEditorIndex(0);
      setEditorOpen(true);
    });
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (disabled) return;
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled || !e.dataTransfer.files?.length) return;
    processFiles(e.dataTransfer.files);
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    processFiles(e.target.files);
    e.target.value = "";
  };

  const handleOpenEditorForExisting = (idx: number) => {
    setEditMode("replace");
    setReplacingIndex(idx);
    setEditorImages([
      {
        id: `existing-${idx}`,
        source: images[idx]!,
        name: `Image ${idx + 1}`,
      },
    ]);
    setEditorIndex(0);
    setEditorOpen(true);
  };

  const handleEditorComplete = (uploadedUrls: string[]) => {
    if (!uploadedUrls.length) return;
    if (editMode === "replace" && replacingIndex >= 0) {
      const next = [...images];
      next[replacingIndex] = uploadedUrls[0]!;
      onChange(next);
    } else {
      // Append newly cropped images
      onChange([...images, ...uploadedUrls]);
    }
  };

  const handleSetPrimary = (idx: number) => {
    if (idx === 0) return;
    const next = [...images];
    const [selected] = next.splice(idx, 1);
    next.unshift(selected!);
    onChange(next);
  };

  const handleRemove = (idx: number) => {
    const next = images.filter((_, i) => i !== idx);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={handleFileInputChange}
        disabled={disabled}
      />

      {images.length === 0 ? (
        /* Empty State Dropzone */
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !disabled && fileInputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition ${
            isDragging
              ? "border-brand-500 bg-brand-50/50 ring-4 ring-brand-100"
              : "border-slate-300 bg-slate-50/50 hover:border-brand-400 hover:bg-slate-50"
          }`}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600 mb-3">
            <PlusIcon className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-slate-800">
            Drag & drop product images here, or browse files
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Select multiple images at once (JPEG, PNG, WebP). Square crop applied in editor.
          </p>
          <button
            type="button"
            className="btn-secondary mt-3 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
          >
            Choose Files
          </button>
        </div>
      ) : (
        /* Populated Gallery List & Dropzone */
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            {images.map((imgUrl, idx) => (
              <div
                key={imgUrl}
                className="group relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-sm transition hover:shadow-md"
              >
                <ProductThumb src={imgUrl} name="Product" className="h-full w-full object-cover" />

                {/* Primary / Main Badge */}
                {idx === 0 ? (
                  <span className="absolute left-1 top-1 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
                    Main
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSetPrimary(idx)}
                    className="absolute left-1 top-1 hidden rounded bg-slate-900/75 px-1 py-0.5 text-[10px] text-white opacity-0 transition group-hover:block group-hover:opacity-100 hover:bg-slate-900"
                    title="Set as Main Image"
                  >
                    Set Main
                  </button>
                )}

                {/* Overlay actions on hover */}
                <div className="absolute inset-0 flex items-center justify-center gap-1.5 bg-slate-950/60 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => handleOpenEditorForExisting(idx)}
                    className="rounded bg-white/90 p-1 text-xs font-medium text-slate-800 hover:bg-white hover:text-brand-600"
                    title="Crop / Edit Image"
                  >
                    Crop
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemove(idx)}
                    className="rounded bg-rose-600/90 p-1 text-xs font-medium text-white hover:bg-rose-700"
                    title="Remove Image"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}

            {/* "+ Upload More" Button & mini drop zone */}
            {images.length < MAX_IMAGES && (
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => !disabled && fileInputRef.current?.click()}
                className={`flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-2 text-center transition ${
                  isDragging
                    ? "border-brand-500 bg-brand-50 ring-2 ring-brand-200"
                    : "border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/30"
                }`}
                title="Click or drag files here to upload more images"
              >
                <PlusIcon className="h-5 w-5 text-slate-500 mb-1" />
                <span className="text-[11px] font-medium text-slate-700">Add More</span>
                <span className="text-[9px] text-slate-400">or drop</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>
              {images.length} {images.length === 1 ? "image" : "images"} uploaded
              {images.length >= MAX_IMAGES ? " (maximum 10 reached)" : ""}. The first is the primary image.
            </span>
            {images.length < MAX_IMAGES && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                + Upload more images
              </button>
            )}
          </div>
        </div>
      )}

      {/* Image Editor Modal */}
      <ImageEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        context="product"
        images={editorImages}
        initialIndex={editorIndex}
        onComplete={handleEditorComplete}
      />
    </div>
  );
}
