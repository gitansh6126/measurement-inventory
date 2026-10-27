import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission } from "../lib/auth.js";

// Per-user screen settings (V2 plan §1.10, backlog F6): visible columns per page and similar.
// Always the signed-in user's own rows, so one user's layout never reaches another. Presentation
// only — never used for permissions or data access.

const key = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,63}$/, "Invalid preference key");
const putBody = z.object({ value: z.unknown().refine((v) => v !== undefined, "value is required") });

export function preferenceRoutes() {
  const r = Router();

  r.get("/", requirePermission("catalog.view"), async (req, res) => {
    const rows = await prisma.userPreference.findMany({ where: { userId: req.auth!.userId }, select: { key: true, value: true } });
    res.json({ preferences: Object.fromEntries(rows.map((p) => [p.key, p.value])) });
  });

  r.get("/:key", requirePermission("catalog.view"), async (req, res) => {
    const k = key.parse(req.params.key);
    const row = await prisma.userPreference.findUnique({ where: { userId_key: { userId: req.auth!.userId, key: k } }, select: { value: true } });
    res.json({ key: k, value: row?.value ?? null });
  });

  r.put("/:key", requirePermission("catalog.view"), async (req, res) => {
    const k = key.parse(req.params.key);
    const { value } = putBody.parse(req.body);
    if (JSON.stringify(value).length > 8000) {
      res.status(400).json({ error: { code: "TOO_LARGE", message: "Preference is too large" } });
      return;
    }
    const json = value as Prisma.InputJsonValue;
    const userId = req.auth!.userId;
    await prisma.userPreference.upsert({ where: { userId_key: { userId, key: k } }, create: { userId, key: k, value: json }, update: { value: json } });
    res.json({ key: k, value });
  });

  r.delete("/:key", requirePermission("catalog.view"), async (req, res) => {
    const k = key.parse(req.params.key);
    await prisma.userPreference.deleteMany({ where: { userId: req.auth!.userId, key: k } });
    res.json({ key: k, value: null });
  });

  return r;
}
