export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", (error) => reject(error));
    image.setAttribute("crossOrigin", "anonymous");
    image.src = url;
  });
}

function getRadianAngle(degreeValue: number) {
  return (degreeValue * Math.PI) / 180;
}

function rotateSize(width: number, height: number, rotation: number) {
  const rotRad = getRadianAngle(rotation);
  return {
    width: Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height: Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  };
}

/**
 * Returns a square cropped and rotated JPEG Blob from image source and crop area.
 * When zoomed out or rotated, any blank space outside the image is rendered pure white (#ffffff).
 */
export async function getCroppedImg(
  imageSrc: string,
  pixelCrop?: PixelCrop | null,
  rotation = 0
): Promise<Blob> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) throw new Error("No 2d canvas context");

  const rotRad = getRadianAngle(rotation);
  const { width: bBoxWidth, height: bBoxHeight } = rotateSize(image.width, image.height, rotation);

  canvas.width = bBoxWidth;
  canvas.height = bBoxHeight;

  // Fill canvas with white background before rotation so transparent corners/margins are white
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, bBoxWidth, bBoxHeight);

  ctx.translate(bBoxWidth / 2, bBoxHeight / 2);
  ctx.rotate(rotRad);
  ctx.translate(-image.width / 2, -image.height / 2);

  ctx.drawImage(image, 0, 0);

  const croppedCanvas = document.createElement("canvas");
  const croppedCtx = croppedCanvas.getContext("2d");

  if (!croppedCtx) throw new Error("No 2d canvas context");

  // Determine actual crop rectangle:
  // If pixelCrop is provided with positive dimensions, use it.
  // Otherwise default to a centered 1:1 square crop from the canvas.
  const crop: PixelCrop =
    pixelCrop && pixelCrop.width > 0 && pixelCrop.height > 0
      ? pixelCrop
      : (() => {
          const minDim = Math.min(bBoxWidth, bBoxHeight);
          return {
            x: Math.max(0, Math.round((bBoxWidth - minDim) / 2)),
            y: Math.max(0, Math.round((bBoxHeight - minDim) / 2)),
            width: minDim,
            height: minDim,
          };
        })();

  const side = Math.min(Math.max(Math.round(crop.width), Math.round(crop.height)), 1600);
  croppedCanvas.width = side;
  croppedCanvas.height = side;

  // CRITICAL: Fill with pure solid white background so any blank space is pure white (#ffffff)
  croppedCtx.fillStyle = "#ffffff";
  croppedCtx.fillRect(0, 0, side, side);

  // Map source canvas onto destination croppedCanvas:
  // When zoomed out, crop.x or crop.y may be negative and crop.width can be larger than canvas.width.
  // Drawing canvas into destination coordinates avoids out-of-bounds source clamping across browsers.
  const scale = side / crop.width;
  const destX = (0 - crop.x) * scale;
  const destY = (0 - crop.y) * scale;
  const destWidth = canvas.width * scale;
  const destHeight = canvas.height * scale;

  croppedCtx.drawImage(
    canvas,
    0,
    0,
    canvas.width,
    canvas.height,
    destX,
    destY,
    destWidth,
    destHeight
  );

  return new Promise((resolve, reject) => {
    croppedCanvas.toBlob(
      (file) => {
        if (file) resolve(file);
        else reject(new Error("Canvas is empty"));
      },
      "image/jpeg",
      0.92
    );
  });
}

/**
 * Uploads an image blob to /api/images and returns the server URL (/api/images/<id>).
 */
export async function uploadImageBlob(blob: Blob): Promise<string> {
  const res = await fetch("/api/images", {
    method: "POST",
    headers: { "Content-Type": "image/jpeg" },
    body: blob,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Upload failed (${res.status})`);
  }
  return data.url as string;
}
