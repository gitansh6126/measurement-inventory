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
import { listSetTypes, saveSetTypeOrder, saveStandardSets, setTypeOrderBody, setTypeStockBody, setTypesQuery, standardSetsBody, stockInSetTypes } from "../lib/set-types.js";
import { can } from "../lib/permissions.js";
import { AppError } from "../lib/errors.js";

// V3.1 grouped products / sets (docs\GROUPED-PRODUCTS-V3-PLAN.md §2–§4).
const ctx = (req: Request) => ({ companyId: req.auth!.companyId, actorId: req.auth!.userId, requestId: req.requestId });

export function setRoutes() {
  const r = Router();

  // Sets of a grouped product (Sets tab, sale set drawer). Default: in stock.
  r.get("/", requirePermission("catalog.view"), async (req, res) => {
    const q = setsQuery.parse(req.query);
    const companyId = req.auth!.companyId;
    const [sets, counts, types] = await Promise.all([
      listSets(prisma, companyId, q),
      q.groupId ? setCounts(prisma, companyId, q.groupId) : null,
      q.groupId ? prisma.groupSetType.findMany({ where: { companyId, groupId: q.groupId }, select: { typeKey: true, salePrice: true, minSalePrice: true } }) : [],
    ]);
    // 0041: selling price per set type (the sale set drawer prices a set from its type).
    const typePrices = Object.fromEntries(types.map((t) => [t.typeKey, { salePrice: t.salePrice.toFixed(2), minSalePrice: t.minSalePrice.toFixed(2) }]));
    res.json({ sets, counts, typePrices });
  });

  // 0041: set types of a grouped product (standard sets + types in stock) with prices and counts.
  r.get("/types/:groupId", requirePermission("catalog.view"), async (req, res) => {
    const q = setTypesQuery.parse(req.query);
    res.json({ types: await listSetTypes(prisma, req.auth!.companyId, String(req.params.groupId), q) });
  });

  // Product form: the grouped product's standard sets.
  r.put("/types/:groupId/standard", requirePermission("product.write"), async (req, res) => {
    const body = standardSetsBody.parse(req.body);
    await prisma.$transaction((tx) => saveStandardSets(tx, ctx(req), String(req.params.groupId), body), WRITE_TX);
    res.json({ types: await listSetTypes(prisma, req.auth!.companyId, String(req.params.groupId), {}) });
  });

  // V3.2 A2: order of the set-type child rows (same permission as variation order).
  r.put("/types/:groupId/order", requirePermission("product.write"), async (req, res) => {
    const body = setTypeOrderBody.parse(req.body);
    await prisma.$transaction((tx) => saveSetTypeOrder(tx, ctx(req), String(req.params.groupId), body), WRITE_TX);
    res.json({ types: await listSetTypes(prisma, req.auth!.companyId, String(req.params.groupId), {}) });
  });

  // Stock In child rows: new set count (builds or undoes opening sets) and prices per set type.
  r.post("/types/:groupId/stock-in", requirePermission("stock.adjust"), async (req, res) => {
    const body = setTypeStockBody.parse(req.body);
    const role = req.auth!.role;
    if (body.rows.some((x) => x.salePrice !== undefined || x.minSalePrice !== undefined || x.lowStockThreshold !== undefined) && !can(role, "inventory.configure")) {
      throw new AppError(403, "FORBIDDEN", "You cannot change prices");
    }
    if (body.rows.some((x) => x.count !== undefined) && !can(role, "set.opening")) throw new AppError(403, "FORBIDDEN", "You cannot add or remove sets here");
    const r2 = await prisma.$transaction((tx) => stockInSetTypes(tx, ctx(req), String(req.params.groupId), body), WRITE_TX);
    res.json(r2);
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
