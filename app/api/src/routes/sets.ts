import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, WRITE_TX } from "../db.js";
import { requirePermission } from "../lib/auth.js";
import {
  addOpeningSets,
  cancelOpeningSet,
  definitionBody,
  getSet,
  listSets,
  openingSetsBody,
  setCounts,
  setsQuery,
  updateDefinition,
} from "../lib/sets.js";

// V3.1 grouped products / sets (docs\GROUPED-PRODUCTS-V3-PLAN.md §2–§4).
const ctx = (req: Request) => ({ companyId: req.auth!.companyId, actorId: req.auth!.userId, requestId: req.requestId });

export function setRoutes() {
  const r = Router();

  // Sets of a grouped product (Sets tab, sale set drawer). Default: in stock.
  r.get("/", requirePermission("catalog.view"), async (req, res) => {
    const q = setsQuery.parse(req.query);
    const companyId = req.auth!.companyId;
    const [sets, counts] = await Promise.all([listSets(prisma, companyId, q), q.groupId ? setCounts(prisma, companyId, q.groupId) : null]);
    res.json({ sets, counts });
  });

  r.get("/:id", requirePermission("catalog.view"), async (req, res) => {
    res.json({ set: await getSet(prisma, req.auth!.companyId, String(req.params.id)) });
  });

  // D20: admin-only opening sets (go-live stock); same set sheet as a purchase.
  r.post("/opening", requirePermission("set.opening"), async (req, res) => {
    const body = openingSetsBody.parse(req.body);
    const created = await prisma.$transaction((tx) => addOpeningSets(tx, ctx(req), body), WRITE_TX);
    res.status(201).json({ sets: created });
  });

  r.post("/:id/cancel-opening", requirePermission("set.opening"), async (req, res) => {
    const { reason } = z.object({ reason: z.string().trim().min(3, "Enter a reason").max(300) }).parse(req.body);
    await prisma.$transaction((tx) => cancelOpeningSet(tx, ctx(req), String(req.params.id), reason), WRITE_TX);
    res.json({ set: await getSet(prisma, req.auth!.companyId, String(req.params.id)) });
  });

  // Change a grouped product's by-product links (plan §2 "Edit").
  r.put("/definition/:groupId", requirePermission("product.write"), async (req, res) => {
    const body = definitionBody.parse(req.body);
    await prisma.$transaction((tx) => updateDefinition(tx, ctx(req), String(req.params.groupId), body), WRITE_TX);
    res.json({ ok: true });
  });

  return r;
}
