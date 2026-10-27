"use client";

import { useCallback, useState, type ChangeEvent } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Alert } from "@/components/ui";

export interface ImageCropperProps {
  onImageSelected: (croppedUrl: string) => void;
  onCancel: () => void;
  initialImageUrl?: string;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

/** Crops to a square JPEG and uploads it; returns the stored image URL ("/api/images/<id>", audit B01). */
async function cropAndUpload(src: string, area: Area): Promise<string> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  // Uploads are limited to 4096 px per side; product thumbnails never need more than 1600.
  const side = Math.min(Math.max(Math.round(area.width), Math.round(area.height)), 1600);
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d")!;

  // Fill canvas with pure solid white background so blank space is #ffffff
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, side, side);

  const scale = side / area.width;
  const destX = (0 - area.x) * scale;
  const destY = (0 - area.y) * scale;
  const destWidth = img.naturalWidth * scale;
  const destHeight = img.naturalHeight * scale;

  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, destX, destY, destWidth, destHeight);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new TaintedCanvas();
  const res = await fetch("/api/images", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new UploadFailed(data?.error?.message ?? `Upload failed (${res.status})`);
  return data.url as string;
}

class TaintedCanvas extends Error {}
class UploadFailed extends Error {}

// Square (1:1) crop for product / variation images. Buttons are type="button" because the
// cropper renders inside the product form.
export function ImageCropper({ onImageSelected, onCancel, initialImageUrl }: ImageCropperProps) {
  const [imageSrc, setImageSrc] = useState<string | null>(initialImageUrl || null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onCropComplete = useCallback((_: Area, pixels: Area) => setArea(pixels), []);

  const reset = () => {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setError(null);
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Please choose an image file.");
    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      reset();
    };
    reader.readAsDataURL(file);
  };

  const apply = async () => {
    if (!imageSrc || !area) return;
    setBusy(true);
    setError(null);
    try {
      onImageSelected(await cropAndUpload(imageSrc, area));
    } catch (e) {
      if (e instanceof UploadFailed) setError(e.message);
      // Remote host without CORS: the canvas is tainted, so keep the https URL uncropped.
      else if (/^https?:\/\//i.test(imageSrc)) onImageSelected(imageSrc);
      else setError("Could not crop this image. Please try another file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      <Alert message={error} />

      <div className="flex items-center gap-2">
        <input type="file" accept="image/*" className="text-sm" onChange={onFile} />
      </div>

      {imageSrc ? (
        <>
          <div className="relative h-[320px] overflow-hidden rounded-md border border-slate-300 bg-slate-100">
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              minZoom={0.2}
              maxZoom={3}
              restrictPosition={false}
              aspect={1}
              onCropChange={setCrop}
              onZoomChange={setZoom}
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
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span>Zoom</span>
            <button
              type="button"
              className="btn-secondary h-6 w-6 p-0 text-center font-bold"
              onClick={() => setZoom((z) => Math.max(0.2, Number((z - 0.1).toFixed(2))))}
              disabled={busy || zoom <= 0.2}
            >
              −
            </button>
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-brand-600"
            />
            <button
              type="button"
              className="btn-secondary h-6 w-6 p-0 text-center font-bold"
              onClick={() => setZoom((z) => Math.min(3, Number((z + 0.1).toFixed(2))))}
              disabled={busy || zoom >= 3}
            >
              +
            </button>
            <span className="w-10 font-mono text-[11px] text-slate-500">{Math.round(zoom * 100)}%</span>
          </div>
          <p className="text-[11px] text-slate-500">
            Zoom out below 100% to shrink image; empty space is filled with pure white.
          </p>
        </>
      ) : (
        <div className="flex h-[160px] items-center justify-center rounded-md border border-dashed border-slate-300 text-sm text-slate-400">
          Select or paste an image
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        {imageSrc && <button type="button" onClick={reset} className="btn-secondary">Reset</button>}
        <button type="button" onClick={apply} className="btn-primary" disabled={!imageSrc || !area || busy}>
          {busy ? "Cropping…" : "Apply Crop"}
        </button>
      </div>
    </div>
  );
}
