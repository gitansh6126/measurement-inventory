import type { Db } from "../db.js";
import { AppError } from "./errors.js";

// Identifies an uploaded image from its own bytes (never the client's Content-Type) and reads
// its pixel size. Only JPEG, PNG and WebP are accepted. No native dependencies.

export interface SniffedImage {
  mime: "image/jpeg" | "image/png" | "image/webp";
  ext: "jpg" | "png" | "webp";
  width: number;
  height: number;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 4096;

function jpegSize(b: Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = b.readUInt16BE(i + 2);
    // Start-of-frame markers carry the dimensions (C0–CF except DHT C4, JPG C8, DAC CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function webpSize(b: Buffer): { width: number; height: number } | null {
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8X" && b.length >= 30) return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (chunk === "VP8 " && b.length >= 30) return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L" && b.length >= 25 && b[20] === 0x2f) {
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function sniffImage(b: Buffer): SniffedImage | null {
  if (b.length < 32) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const s = jpegSize(b);
    return s ? { mime: "image/jpeg", ext: "jpg", ...s } : null;
  }
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && b.toString("ascii", 12, 16) === "IHDR") {
    return { mime: "image/png", ext: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const s = webpSize(b);
    return s ? { mime: "image/webp", ext: "webp", ...s } : null;
  }
  return null;
}

/** "/api/images/<id>" → id; anything else → null. */
export function internalImageId(url: string): string | null {
  const m = /^\/api\/images\/([a-z0-9]{20,40})$/.exec(url);
  return m ? m[1]! : null;
}

/**
 * Uploaded images referenced by a product, variation or category must belong to the same
 * company (audit B01). External http(s) URLs are not checked here.
 */
export async function assertOwnImages(db: Db, companyId: string, urls: readonly (string | null | undefined)[]) {
  const ids = [...new Set(urls.map((u) => (u ? internalImageId(u) : null)).filter((id): id is string => !!id))];
  if (!ids.length) return;
  const found = await db.image.count({ where: { companyId, id: { in: ids } } });
  if (found !== ids.length) throw new AppError(400, "UNKNOWN_IMAGE", "Image not found; upload it again");
}
