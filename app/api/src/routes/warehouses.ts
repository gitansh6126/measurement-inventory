import { Router, type Request } from "express";
import { prisma, WRITE_TX } from "../db.js";
import { requirePermission } from "../lib/auth.js";
import { cancelBody, cancelTransfer, createTransfer, getTransfer, listTransfers, transferBody, transfersQuery } from "../lib/transfers.js";
import { createWarehouse, isWarehousingOn, listWarehouses, makeDefault, setActive, updateWarehouse, warehouseBody, warehouseUpdate } from "../lib/warehouses.js";

// V3.1 warehouses and shifts (docs\WAREHOUSE-V3-PLAN.md §3.3–3.4).
const ctx = (req: Request) => ({ companyId: req.auth!.companyId, actorId: req.auth!.userId, requestId: req.requestId });

export function warehouseRoutes() {
  const r = Router();

  // Every role sees warehouses (pickers, per-warehouse stock); `enabled` = WH-0 switch.
  r.get("/", requirePermission("catalog.view"), async (req, res) => {
    const companyId = req.auth!.companyId;
    const [enabled, warehouses] = await Promise.all([isWarehousingOn(prisma, companyId), listWarehouses(prisma, companyId)]);
    res.json({ enabled, warehouses });
  });

  // The first warehouse turns warehousing on and takes all current stock (WH-1).
  r.post("/", requirePermission("warehouse.manage"), async (req, res) => {
    const body = warehouseBody.parse(req.body);
    const out = await prisma.$transaction((tx) => createWarehouse(tx, ctx(req), body), { ...WRITE_TX, timeout: 120_000 });
    res.status(201).json({ warehouse: out.warehouse, warehousingEnabled: out.enabled });
  });

  r.patch("/:id", requirePermission("warehouse.manage"), async (req, res) => {
    const body = warehouseUpdate.parse(req.body);
    const warehouse = await prisma.$transaction((tx) => updateWarehouse(tx, ctx(req), String(req.params.id), body), WRITE_TX);
    res.json({ warehouse });
  });

  r.post("/:id/default", requirePermission("warehouse.manage"), async (req, res) => {
    await prisma.$transaction((tx) => makeDefault(tx, ctx(req), String(req.params.id)), WRITE_TX);
    res.json({ ok: true });
  });

  r.post("/:id/deactivate", requirePermission("warehouse.manage"), async (req, res) => {
    await prisma.$transaction((tx) => setActive(tx, ctx(req), String(req.params.id), false), WRITE_TX);
    res.json({ ok: true });
  });

  r.post("/:id/activate", requirePermission("warehouse.manage"), async (req, res) => {
    await prisma.$transaction((tx) => setActive(tx, ctx(req), String(req.params.id), true), WRITE_TX);
    res.json({ ok: true });
  });

  return r;
}

export function transferRoutes() {
  const r = Router();

  r.get("/", requirePermission("catalog.view"), async (req, res) => {
    res.json(await listTransfers(prisma, req.auth!.companyId, transfersQuery.parse(req.query)));
  });

  r.get("/:id", requirePermission("catalog.view"), async (req, res) => {
    res.json({ transfer: await getTransfer(prisma, req.auth!.companyId, String(req.params.id)) });
  });

  r.post("/", requirePermission("stock.transfer"), async (req, res) => {
    const out = await createTransfer(ctx(req), transferBody.parse(req.body));
    res.status(out.created ? 201 : 200).json({ transfer: await getTransfer(prisma, req.auth!.companyId, out.id) });
  });

  r.post("/:id/cancel", requirePermission("stock.transfer.void"), async (req, res) => {
    const { reason } = cancelBody.parse(req.body);
    await cancelTransfer(ctx(req), String(req.params.id), reason);
    res.json({ transfer: await getTransfer(prisma, req.auth!.companyId, String(req.params.id)) });
  });

  return r;
}
