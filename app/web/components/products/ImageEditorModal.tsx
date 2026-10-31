"use client";

import { useCallback, useEffect, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Alert, Modal } from "@/components/ui";
import { getCroppedImg, uploadImageBlob } from "@/lib/cropImage";

export interface EditorImageItem {
  id: string;
  source: string; // Data URL or existing server URL
  name?: string;
  croppedResult?: string; // Stored server URL after crop
}

export interface ImageEditorModalProps {
  open: boolean;
  onClose: () => void;
  context: "product" | "variation" | "category" | "set";
  images: EditorImageItem[];
  initialIndex?: number;
  /** Called with uploaded server URLs (/api/images/<id>) upon completion */
  onComplete: (savedUrls: string[]) => void;
}

interface ImageEditState {
  crop: { x: number; y: number };
  zoom: number;
  rotation: number;
  cropPixels: Area | null;
}

export function ImageEditorModal({
  open,
  onClose,
  context,
  images,
  initialIndex = 0,
  onComplete,
}: ImageEditorModalProps) {
  const [items, setItems] = useState<EditorImageItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [cropPixels, setCropPixels] = useState<Area | null>(null);
  const [editStates, setEditStates] = useState<Record<string, ImageEditState>>({});
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  // Sync incoming images whenever modal opens or image list changes
  useEffect(() => {
    if (open && images.length > 0) {
      setItems(images.map((img) => ({ ...img })));
      const startIdx = Math.max(0, Math.min(initialIndex, images.length - 1));
      setCurrentIndex(startIdx);

      const initialStates: Record<string, ImageEditState> = {};
      images.forEach((img) => {
        initialStates[img.id] = {
          crop: { x: 0, y: 0 },
          zoom: 1,
          rotation: 0,
          cropPixels: null,
        };
      });
      setEditStates(initialStates);

      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setRotation(0);
      setCropPixels(null);
      setError(null);
      setBusy(false);
      setUploadProgress(null);
    }
  }, [open, images, initialIndex]);

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCropPixels(pixels);
  }, []);

  const resetCurrent = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setRotation(0);
    setError(null);
  };

  const rotate = (delta: number) => {
    setRotation((prev) => (prev + delta + 360) % 360);
  };

  const switchImage = (newIndex: number) => {
    if (newIndex === currentIndex || newIndex < 0 || newIndex >= items.length) return;
    setError(null);

    // Save current active image's edit state
    const currentItem = items[currentIndex];
    const updatedStates: Record<string, ImageEditState> = {
      ...editStates,
      ...(currentItem
        ? {
            [currentItem.id]: { crop, zoom, rotation, cropPixels },
          }
        : {}),
    };
    setEditStates(updatedStates);

    // Load target image's edit state
    const targetItem = items[newIndex];
    const targetState = (targetItem && updatedStates[targetItem.id]) || {
      crop: { x: 0, y: 0 },
      zoom: 1,
      rotation: 0,
      cropPixels: null,
    };

    setCrop(targetState.crop);
    setZoom(targetState.zoom);
    setRotation(targetState.rotation);
    setCropPixels(targetState.cropPixels);
    setCurrentIndex(newIndex);
  };

  const removeItem = (idxToRemove: number) => {
    if (items.length <= 1) return;
    const removedItem = items[idxToRemove];
    const newItems = items.filter((_, i) => i !== idxToRemove);

    setEditStates((prev) => {
      const copy = { ...prev };
      if (removedItem) delete copy[removedItem.id];
      return copy;
    });

    if (idxToRemove === currentIndex) {
      const nextIdx = Math.min(currentIndex, newItems.length - 1);
      setCurrentIndex(nextIdx);
      const nextItem = newItems[nextIdx];
      const state = (nextItem && editStates[nextItem.id]) || {
        crop: { x: 0, y: 0 },
        zoom: 1,
        rotation: 0,
        cropPixels: null,
      };
      setCrop(state.crop);
      setZoom(state.zoom);
      setRotation(state.rotation);
      setCropPixels(state.cropPixels);
    } else if (idxToRemove < currentIndex) {
      setCurrentIndex((prev) => prev - 1);
    }

    setItems(newItems);
  };

  const handleFinishAndUpload = async () => {
    if (!items.length) return;
    setBusy(true);
    setError(null);

    // Snapshot latest states including active editor values
    const currentItem = items[currentIndex];
    const allStates: Record<string, ImageEditState> = {
      ...editStates,
      ...(currentItem
        ? {
            [currentItem.id]: { crop, zoom, rotation, cropPixels },
          }
        : {}),
    };

    try {
      const results: string[] = [];
      const total = items.length;

      for (let i = 0; i < total; i++) {
        const item = items[i]!;
        setUploadProgress({ current: i + 1, total });

        const state = allStates[item.id] || {
          crop: { x: 0, y: 0 },
          zoom: 1,
          rotation: 0,
          cropPixels: null,
        };

        const isDataOrBlob =
          item.source.startsWith("data:") || item.source.startsWith("blob:");

        if (isDataOrBlob) {
          // Newly selected/dropped file: crop & upload
          const blob = await getCroppedImg(item.source, state.cropPixels, state.rotation);
          const uploadedUrl = await uploadImageBlob(blob);
          results.push(uploadedUrl);
        } else if (item.source.startsWith("/api/images")) {
          // Existing server image: re-crop & upload if edited, otherwise preserve existing URL
          if (state.cropPixels || state.rotation !== 0) {
            const blob = await getCroppedImg(item.source, state.cropPixels, state.rotation);
            const uploadedUrl = await uploadImageBlob(blob);
            results.push(uploadedUrl);
          } else {
            results.push(item.source);
          }
        } else {
          // Any other URL: crop and upload to ensure server storage
          const blob = await getCroppedImg(item.source, state.cropPixels, state.rotation);
          const uploadedUrl = await uploadImageBlob(blob);
          results.push(uploadedUrl);
        }
      }

      onComplete(results);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to crop or upload images";
      setError(msg);
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  };

  const currentItem = items[currentIndex];
  const contextLabel =
    context === "product"
      ? "Product Image"
      : context === "variation"
        ? "Variation Image"
        : context === "set"
          ? "Standard Set Image"
          : "Category Image";

  return (
    <Modal
      open={open}
      xl
      title={`Image Editor — ${contextLabel}${items.length > 1 ? ` (${currentIndex + 1} of ${items.length})` : ""}`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        <Alert message={error} />

        {/* Thumbnail carousel strip for multiple images */}
        {items.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto border-b border-slate-200 pb-2">
            <span className="text-xs font-medium text-slate-500 shrink-0">Images:</span>
            {items.map((item, idx) => (
              <div key={item.id || idx} className="relative shrink-0">
                <button
                  type="button"
                  onClick={() => switchImage(idx)}
                  disabled={busy}
                  className={`relative h-12 w-12 overflow-hidden rounded-md border-2 transition ${
                    idx === currentIndex
                      ? "border-brand-600 ring-2 ring-brand-200"
                      : "border-slate-200 opacity-60 hover:opacity-100"
                  }`}
                  title={`Image ${idx + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.source} alt="" className="h-full w-full object-cover" />
                  <span className="absolute bottom-0 right-0 rounded-tl bg-slate-900/80 px-1 text-[10px] text-white">
                    {idx + 1}
                  </span>
                </button>
                {items.length > 1 && !busy && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeItem(idx);
                    }}
                    className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-600 text-[10px] font-bold text-white shadow hover:bg-rose-700"
                    title="Remove this image"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Main Cropper viewport with white canvas backing */}
        <div className="relative h-[360px] w-full overflow-hidden rounded-lg border border-slate-300 bg-slate-100 sm:h-[420px]">
          {currentItem ? (
            <Cropper
              image={currentItem.source}
              crop={crop}
              zoom={zoom}
              minZoom={0.2}
              maxZoom={3}
              restrictPosition={false}
              rotation={rotation}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              onCropComplete={onCropComplete}
              onMediaLoaded={() => setError(null)}
              style={{
                containerStyle: { backgroundColor: "#ffffff" },
                cropAreaStyle: {
                  border: "2px solid #ea580c",
                  boxShadow: "0 0 0 9999em rgba(15, 23, 42, 0.65)",
                },
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-slate-400">
              No image loaded
            </div>
          )}
        </div>

        {/* Controls Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          {/* Zoom Slider & Buttons */}
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <span className="mr-1">Zoom:</span>
            <button
              type="button"
              className="btn-secondary h-7 w-7 p-0 text-center font-bold"
              onClick={() => setZoom((z) => Math.max(0.2, Number((z - 0.1).toFixed(2))))}
              disabled={busy || zoom <= 0.2}
              title="Zoom Out (Whitespace around image will be pure white)"
            >
              −
            </button>
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.05}
              value={zoom}
              disabled={busy}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="h-1.5 w-24 accent-brand-600 sm:w-32"
            />
            <button
              type="button"
              className="btn-secondary h-7 w-7 p-0 text-center font-bold"
              onClick={() => setZoom((z) => Math.min(3, Number((z + 0.1).toFixed(2))))}
              disabled={busy || zoom >= 3}
              title="Zoom In"
            >
              +
            </button>
            <span className="w-12 font-mono text-[11px] text-slate-600">{Math.round(zoom * 100)}%</span>

            <div className="hidden items-center gap-1 sm:flex ml-1 border-l border-slate-200 pl-2">
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
                  zoom === 0.5 ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                }`}
                onClick={() => setZoom(0.5)}
                disabled={busy}
                title="50% Zoom (Add white margin)"
              >
                50%
              </button>
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
                  zoom === 0.75 ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                }`}
                onClick={() => setZoom(0.75)}
                disabled={busy}
                title="75% Zoom"
              >
                75%
              </button>
              <button
                type="button"
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium transition ${
                  zoom === 1 ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                }`}
                onClick={() => setZoom(1)}
                disabled={busy}
                title="100% Fit"
              >
                100%
              </button>
            </div>
          </div>

          {/* Rotate & Reset Buttons */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="btn-secondary px-2.5 py-1 text-xs"
              onClick={() => rotate(-90)}
              disabled={busy}
              title="Rotate Left 90°"
            >
              ↺ 90° Left
            </button>
            <button
              type="button"
              className="btn-secondary px-2.5 py-1 text-xs"
              onClick={() => rotate(90)}
              disabled={busy}
              title="Rotate Right 90°"
            >
              ↻ 90° Right
            </button>
            <button
              type="button"
              className="btn-secondary px-2.5 py-1 text-xs"
              onClick={resetCurrent}
              disabled={busy}
              title="Reset Crop and Rotation"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Bottom Actions */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <p className="text-xs text-slate-500">
            Square 1:1 format. Zoom out to fit full product; blank margin space is automatically pure white (<code className="text-slate-700 font-mono">#ffffff</code>).
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleFinishAndUpload}
              disabled={busy || !currentItem}
            >
              {busy
                ? uploadProgress
                  ? `Saving & Uploading (${uploadProgress.current}/${uploadProgress.total})…`
                  : "Saving & Uploading…"
                : items.length > 1
                  ? `Apply & Save All (${items.length})`
                  : "Apply & Save"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
