import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import express, { Router, type RequestHandler } from "express";
import type { Env } from "../env.js";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { requireAuth } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, sniffImage } from "../lib/images.js";
import { can } from "../lib/permissions.js";

// Square-cropped product/category images. The browser crops and uploads the result as raw
// bytes; the server checks the real format and size, stores the file under the environment's
// STORAGE_ROOT and serves it only to signed-in users of the same company.

const canUpload: RequestHandler = (req, _res, next) => {
  const role = req.auth?.role;
  if (!role) return next(new AppError(401, "UNAUTHENTICATED", "Please sign in"));
  if (!can(role, "product.write") && !can(role, "category.write")) return next(new AppError(403, "FORBIDDEN", "You cannot upload images"));
  next();
};

export function imageRoutes(env: Env) {
  const r = Router();
  const root = path.resolve(env.storageRoot);

  r.post(
    "/",
    canUpload,
    express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: MAX_IMAGE_BYTES }),
    async (req, res) => {
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw new AppError(400, "NO_IMAGE", "Send a JPEG, PNG or WebP image");
      const img = sniffImage(body);
      if (!img) throw new AppError(400, "NOT_AN_IMAGE", "Only JPEG, PNG or WebP images can be uploaded");
      if (img.width > MAX_IMAGE_SIDE || img.height > MAX_IMAGE_SIDE) throw new AppError(400, "IMAGE_TOO_LARGE", `Images can be at most ${MAX_IMAGE_SIDE}×${MAX_IMAGE_SIDE} pixels`);
      const { companyId, userId } = req.auth!;

      // Server-chosen name: no client text ever reaches the file system path.
      const month = new Date().toISOString().slice(0, 7);
      const storageKey = `${companyId}/${month}/${randomUUID()}.${img.ext}`;
      const file = path.join(root, storageKey);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body, { flag: "wx" });

      const row = await prisma.$transaction(async (tx) => {
        const created = await tx.image.create({
          data: {
            companyId,
            storageKey,
            mimeType: img.mime,
            bytes: body.length,
            width: img.width,
            height: img.height,
            sha256: createHash("sha256").update(body).digest("hex"),
            createdById: userId,
          },
          select: { id: true, width: true, height: true },
        });
        await audit(tx, { companyId, actorId: userId, action: "IMAGE_UPLOAD", entityType: "Image", entityId: created.id, after: { ...created, bytes: body.length, mime: img.mime }, requestId: req.requestId });
        return created;
      });
      res.status(201).json({ id: row.id, url: `/api/images/${row.id}`, width: row.width, height: row.height });
    },
  );

  r.get("/:id", requireAuth, async (req, res) => {
    const img = await prisma.image.findFirst({ where: { id: String(req.params.id), companyId: req.auth!.companyId } });
    if (!img) throw new AppError(404, "NOT_FOUND", "Image not found");
    const file = path.resolve(root, img.storageKey);
    if (!file.startsWith(root + path.sep)) throw new AppError(404, "NOT_FOUND", "Image not found");
    const data = await readFile(file).catch(() => null);
    if (!data) throw new AppError(404, "NOT_FOUND", "Image not found");
    // Content never changes for an id, so private caching is safe; the browser still needs the session.
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.setHeader("Content-Type", img.mimeType);
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Content-Disposition", "inline");
    res.send(data);
  });

  return r;
}
