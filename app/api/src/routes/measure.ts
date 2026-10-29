import type { PieceKind, Prisma } from "@prisma/client";
import { orderAttributes, type AttributeDef, type Attributes } from "@rs-v31/shared";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, WRITE_TX } from "../db.js";
import { requirePermission } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { OPENS_ROLL, RESEALED, addRolls, correctLength, cutPiece, editPiece, lengthInput, milliOf, openPiece, pieceEditBody, rollInput, writeOff } from "../lib/measure.js";
import { can } from "../lib/permissions.js";
import { seesCost } from "../lib/products.js";
import { money } from "../lib/stock.js";

// /api/measure — Measured products' rolls (V2 plan §2.5–2.6, wireframes W7–W11, W19).
// Reads need catalog.view; every length change needs stock.adjust (BR-18: measured stock changes
// only through its rolls). Costs follow the same visibility rule as products (audit B05).

const ctx = (req: Request) => ({ companyId: req.auth!.companyId, actorId: req.auth!.userId, requestId: req.requestId });

const piecesQuery = z.object({ status: z.enum(["active", "used_up", "all"]).default("active") });
const bundlesQuery = z.object({
  status: z.enum(["active", "used_up", "all"]).default("all"),
  variationId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * Sealed / Open / Cut just before and after each ledger row of one piece, replayed from its full
 * ledger (oldest first): a Cut piece is Cut for life; a roll is Sealed until a row opens it, and
 * Sealed again after a sale void that put it back whole. A roll added already open starts Open.
 */
function replayPiece(kind: PieceKind, rows: readonly { id: string; action: string; change: number; reason: string | null }[]) {
  const out = new Map<string, { before: PieceKind; after: PieceKind }>();
  let s: PieceKind = kind === "CUT" ? "CUT" : rows.some((r) => OPENS_ROLL(r.action, r.change)) ? "CLOSED" : kind;
  for (const r of rows) {
    const before = s;
    if (s === "CLOSED" && OPENS_ROLL(r.action, r.change)) s = "OPEN";
    else if (s === "OPEN" && r.action === "SALE_VOID" && r.reason?.endsWith(RESEALED)) s = "CLOSED";
    out.set(r.id, { before, after: s });
  }
  return out;
}

const addRollsBody = z.object({
  rolls: z.array(rollInput).min(1, "Add at least one roll").max(500),
  unitCost: money.nullish(),
  note: z.string().trim().max(200).nullish().transform((v) => v || null),
  // V3.1: warehouse for rolls that name none (default warehouse when omitted).
  warehouseId: z.string().min(1).nullish(),
});
const cutBody = z.object({
  lengths: z.array(lengthInput).min(1, "Enter a length to cut").max(50),
  writeOffLeftover: z.boolean().optional(),
  reason: z.string().trim().max(200).nullish().transform((v) => v || null),
});
const writeOffBody = z.object({ reason: z.string().trim().min(3, "Give a reason (at least 3 characters)").max(200) });
// 0 is allowed: the piece was measured and nothing usable is left.
const correctBody = z.object({
  length: z.union([z.number(), z.string().trim().min(1)]).transform((v, c) => {
    const n = Number(v);
    const m = Math.round(n * 1000);
    if (!Number.isFinite(n) || n < 0 || Math.abs(n * 1000 - m) > 1e-6) {
      c.addIssue({ code: "custom", message: "Enter the measured length (0 or more, at most 3 decimals)" });
      return z.NEVER;
    }
    return m;
  }),
  note: z.string().trim().min(3, "Say why the length changed (at least 3 characters)").max(200),
});

type PieceRow = Prisma.MeasurementPieceGetPayload<{
  include: {
    parent: { select: { code: true } };
    purchase: { select: { number: true } };
    supplier: { select: { name: true } };
    _count: { select: { children: true } };
  };
}>;

const pieceInclude = {
  parent: { select: { code: true } },
  purchase: { select: { number: true } },
  supplier: { select: { name: true } },
  _count: { select: { children: true } },
} as const;

function pieceView(p: PieceRow, showCost: boolean) {
  return {
    id: p.id,
    code: p.code,
    variationId: p.variationId,
    kind: p.kind,
    status: p.status,
    originalLength: Number(p.originalLength),
    remainingLength: Number(p.remainingLength),
    parent: p.parentId ? { id: p.parentId, code: p.parent?.code ?? null } : null,
    childCount: p._count.children,
    purchase: p.purchaseId ? { id: p.purchaseId, number: p.purchase?.number ?? null } : null,
    supplier: p.supplierId ? { id: p.supplierId, name: p.supplier?.name ?? null } : null,
    unitCost: showCost && p.unitCost ? p.unitCost.toFixed(2) : null,
    supplierRollNo: p.supplierRollNo,
    rack: p.rack,
    notes: p.notes,
    receivedAt: p.receivedAt,
    openedAt: p.openedAt,
    // V3.1: null while warehousing is off; names resolve through GET /api/warehouses.
    warehouseId: p.warehouseId,
    // V3.1: fitted in this set (moves only with the set); null = free.
    setId: p.setId,
  };
}

const statusWhere = (s: z.infer<typeof piecesQuery>["status"]) => (s === "all" ? {} : { status: s === "active" ? ("ACTIVE" as const) : ("USED_UP" as const) });

async function measuredGroup(companyId: string, groupId: string) {
  const g = await prisma.productGroup.findFirst({
    where: { id: groupId, companyId },
    // The saved variation order (sort_order), same as Products and Stock In (V3.2 A2).
    include: { variations: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!g) throw new AppError(404, "NOT_FOUND", "Product not found");
  if (g.productType !== "measured") throw new AppError(400, "NOT_MEASURED", `${g.name} is not a Measured product`);
  return g;
}

export function measureRoutes() {
  const r = Router();

  /**
   * Every roll of a Measured product, per variation (inventory rows W7, sale piece picker and
   * "Show alternatives" W15 — other variations are in the same response).
   */
  r.get("/products/:id/pieces", requirePermission("catalog.view"), async (req, res) => {
    const { status } = piecesQuery.parse(req.query);
    const companyId = req.auth!.companyId;
    const g = await measuredGroup(companyId, String(req.params.id));
    const showCost = seesCost(req.auth!.role);
    const [pieces, balances] = await Promise.all([
      prisma.measurementPiece.findMany({
        where: { companyId, variationId: { in: g.variations.map((v) => v.id) }, ...statusWhere(status) },
        include: pieceInclude,
        orderBy: [{ receivedAt: "asc" }, { code: "asc" }],
      }),
      prisma.stockBalance.findMany({ where: { companyId, variationId: { in: g.variations.map((v) => v.id) } }, select: { variationId: true, quantity: true } }),
    ]);
    const stock = new Map(balances.map((b) => [b.variationId, Number(b.quantity)]));
    const defs = g.attributeDefinitions as unknown as AttributeDef[];
    res.json({
      product: {
        id: g.id,
        name: g.name,
        lengthUnit: g.lengthUnit,
        rollName: g.rollName,
        decimals: g.lengthDecimals,
        scrapBelow: g.scrapBelow === null ? null : Number(g.scrapBelow),
        defaultRollLength: g.defaultRollLength === null ? null : Number(g.defaultRollLength),
      },
      variations: g.variations.map((v) => ({
        id: v.id,
        shortName: v.shortName,
        officialSku: v.officialSku,
        attributes: orderAttributes(v.attributes as Attributes, defs),
        active: v.active,
        salePrice: v.salePrice.toFixed(2),
        minSalePrice: v.minSalePrice.toFixed(2),
        lowStockThreshold: v.lowStockThreshold,
        defaultRollLength: v.defaultRollLength === null ? null : Number(v.defaultRollLength),
        stock: stock.get(v.id) ?? 0,
        pieces: pieces.filter((p) => p.variationId === v.id).map((p) => pieceView(p, showCost)),
      })),
    });
  });

  /**
   * Stock history per bundle (owner 2026-10-24): every roll of the product as a timeline —
   * Sealed → Open → cuts — with the cut pieces made from it nested under it, each with its own
   * sales, returns, write-offs and shifts. Paged by bundle (newest received first). A bundle is
   * "active" while it or any piece cut from it still has length.
   */
  r.get("/products/:id/bundles", requirePermission("catalog.view"), async (req, res) => {
    const { status, variationId, page, pageSize } = bundlesQuery.parse(req.query);
    const companyId = req.auth!.companyId;
    const g = await measuredGroup(companyId, String(req.params.id));
    if (variationId && !g.variations.some((v) => v.id === variationId)) throw new AppError(404, "NOT_FOUND", "Variation not found in this product");
    const ids = variationId ? [variationId] : g.variations.map((v) => v.id);
    const all = await prisma.measurementPiece.findMany({
      where: { companyId, variationId: { in: ids } },
      include: { purchase: { select: { number: true } }, supplier: { select: { name: true } }, set: { select: { code: true } } },
      orderBy: [{ receivedAt: "desc" }, { code: "desc" }],
    });
    type Piece = (typeof all)[number];
    const byId = new Map(all.map((p) => [p.id, p]));
    const kids = new Map<string, Piece[]>();
    for (const p of all) if (p.parentId) kids.set(p.parentId, [...(kids.get(p.parentId) ?? []), p]);
    const tree = (p: Piece): Piece[] => [p, ...(kids.get(p.id) ?? []).flatMap(tree)];
    const roots = all.filter((p) => !p.parentId || !byId.has(p.parentId));
    const live = (p: Piece) => tree(p).some((x) => x.status === "ACTIVE");
    const picked = roots.filter((p) => (status === "all" ? true : status === "active" ? live(p) : !live(p)));
    const pageRoots = picked.slice((page - 1) * pageSize, page * pageSize);
    const inPage = pageRoots.flatMap(tree);
    // In the order the events were recorded (ids are time-ordered): a sale may carry an earlier
    // document date than the roll's arrival, but it still happened after it.
    const ledger = await prisma.measurementPieceLedger.findMany({
      where: { pieceId: { in: inPage.map((p) => p.id) } },
      orderBy: { id: "asc" },
      include: { sale: { select: { number: true } }, purchase: { select: { number: true } } },
    });
    const actorIds = [...new Set(ledger.map((h) => h.createdById).filter((x): x is string => !!x))];
    const relatedIds = [...new Set(ledger.map((h) => h.relatedPieceId).filter((x): x is string => !!x))];
    const [actors, related] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: actorIds }, companyId }, select: { id: true, name: true } }),
      prisma.measurementPiece.findMany({ where: { id: { in: relatedIds }, companyId }, select: { id: true, code: true } }),
    ]);
    const actorName = new Map(actors.map((a) => [a.id, a.name]));
    const relatedCode = new Map(related.map((x) => [x.id, x.code]));
    const defs = g.attributeDefinitions as unknown as AttributeDef[];
    const variationOf = new Map(g.variations.map((v) => [v.id, { id: v.id, shortName: v.shortName, attributes: orderAttributes(v.attributes as Attributes, defs) }]));
    const rowsOf = new Map<string, typeof ledger>();
    for (const h of ledger) rowsOf.set(h.pieceId, [...(rowsOf.get(h.pieceId) ?? []), h]);
    const showCost = seesCost(req.auth!.role);

    const node = (p: Piece): unknown => {
      const rows = rowsOf.get(p.id) ?? [];
      const states = replayPiece(p.kind, rows.map((h) => ({ id: h.id, action: h.action, change: milliOf(h.change), reason: h.reason })));
      // Where the length went: sold, cut into pieces, returned by voids, written off, corrected.
      const used = { sold: 0, cutIntoPieces: 0, returned: 0, writtenOff: 0, corrected: 0 };
      for (const h of rows) {
        const c = milliOf(h.change);
        if (h.action === "SALE") used.sold -= c;
        else if (h.action === "SALE_VOID") used.returned += c;
        else if (h.action === "CUT" && c < 0) used.cutIntoPieces -= c;
        else if (h.action === "WRITE_OFF") used.writtenOff -= c;
        else if (h.action === "CORRECTION") used.corrected += c;
      }
      return {
        id: p.id,
        code: p.code,
        kind: p.kind,
        status: p.status,
        variation: variationOf.get(p.variationId) ?? null,
        originalLength: Number(p.originalLength),
        remainingLength: Number(p.remainingLength),
        receivedAt: p.receivedAt,
        openedAt: p.openedAt,
        warehouseId: p.warehouseId,
        set: p.setId ? { id: p.setId, code: p.set?.code ?? null } : null,
        setOrigin: p.setOrigin,
        purchase: p.purchaseId ? { id: p.purchaseId, number: p.purchase?.number ?? null } : null,
        supplier: p.supplier?.name ?? null,
        unitCost: showCost && p.unitCost ? p.unitCost.toFixed(2) : null,
        used: Object.fromEntries(Object.entries(used).map(([k, v]) => [k, v / 1000])),
        timeline: rows.map((h) => {
          const st = states.get(h.id)!;
          return {
            id: h.id,
            occurredAt: h.occurredAt,
            action: h.action,
            change: Number(h.change),
            before: Number(h.beforeLength),
            after: Number(h.afterLength),
            stateBefore: st.before,
            stateAfter: st.after,
            related: h.relatedPieceId ? { id: h.relatedPieceId, code: relatedCode.get(h.relatedPieceId) ?? null } : null,
            sale: h.saleId ? { id: h.saleId, number: h.sale?.number ?? null } : null,
            purchase: h.purchaseId ? { id: h.purchaseId, number: h.purchase?.number ?? null } : null,
            warehouseId: h.warehouseId,
            reason: h.reason,
            by: h.createdById ? (actorName.get(h.createdById) ?? null) : null,
          };
        }),
        children: [...(kids.get(p.id) ?? [])].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.code.localeCompare(b.code)).map(node),
      };
    };

    const active = all.filter((p) => p.status === "ACTIVE");
    res.json({
      product: { id: g.id, name: g.name, lengthUnit: g.lengthUnit, rollName: g.rollName, decimals: g.lengthDecimals },
      summary: {
        onHand: active.reduce((s, p) => s + milliOf(p.remainingLength), 0) / 1000,
        sealed: active.filter((p) => p.kind === "CLOSED").length,
        open: active.filter((p) => p.kind === "OPEN").length,
        cut: active.filter((p) => p.kind === "CUT").length,
        bundles: roots.length,
      },
      bundles: pageRoots.map(node),
      total: picked.length,
      page,
      pageSize,
    });
  });

  /** One roll's record (W8) and its full history (W19). */
  r.get("/pieces/:id", requirePermission("catalog.view"), async (req, res) => {
    const companyId = req.auth!.companyId;
    const p = await prisma.measurementPiece.findFirst({
      where: { companyId, OR: [{ id: String(req.params.id) }, { code: String(req.params.id) }] },
      include: {
        ...pieceInclude,
        variation: { select: { id: true, shortName: true, attributes: true, group: { select: { id: true, name: true, lengthUnit: true, rollName: true, lengthDecimals: true, scrapBelow: true, attributeDefinitions: true } } } },
        children: { select: { id: true, code: true, kind: true, status: true, originalLength: true, remainingLength: true }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!p) throw new AppError(404, "NOT_FOUND", "Roll not found");
    const history = await prisma.measurementPieceLedger.findMany({
      where: { pieceId: p.id },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      include: { sale: { select: { number: true } }, purchase: { select: { number: true } } },
    });
    const actorIds = [...new Set(history.map((h) => h.createdById).filter((x): x is string => !!x)), ...(p.openedById ? [p.openedById] : [])];
    const related = [...new Set(history.map((h) => h.relatedPieceId).filter((x): x is string => !!x))];
    const [actors, relatedPieces] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: actorIds }, companyId }, select: { id: true, name: true } }),
      prisma.measurementPiece.findMany({ where: { id: { in: related }, companyId }, select: { id: true, code: true } }),
    ]);
    const actorName = new Map(actors.map((a) => [a.id, a.name]));
    const relatedCode = new Map(relatedPieces.map((x) => [x.id, x.code]));
    // Where the used length went (wireframe W8 strip). Cut rows on this piece are negative when
    // length left it for a child, positive when this piece was created by a cut.
    let sold = 0;
    let cutAway = 0;
    let writtenOff = 0;
    let corrected = 0;
    for (const h of history) {
      const c = milliOf(h.change);
      if (h.action === "SALE" || h.action === "SALE_VOID") sold -= c;
      else if (h.action === "CUT" && c < 0) cutAway -= c;
      else if (h.action === "WRITE_OFF") writtenOff -= c;
      else if (h.action === "CORRECTION") corrected += c;
    }
    const g = p.variation.group;
    res.json({
      piece: {
        ...pieceView(p, seesCost(req.auth!.role)),
        openedBy: p.openedById ? (actorName.get(p.openedById) ?? null) : null,
        product: { id: g.id, name: g.name, lengthUnit: g.lengthUnit, rollName: g.rollName, decimals: g.lengthDecimals, scrapBelow: g.scrapBelow === null ? null : Number(g.scrapBelow) },
        variation: { id: p.variation.id, shortName: p.variation.shortName, attributes: orderAttributes(p.variation.attributes as Attributes, g.attributeDefinitions as unknown as AttributeDef[]) },
        children: p.children.map((c) => ({ id: c.id, code: c.code, kind: c.kind, status: c.status, originalLength: Number(c.originalLength), remainingLength: Number(c.remainingLength) })),
        used: { sold: sold / 1000, cutIntoPieces: cutAway / 1000, writtenOff: writtenOff / 1000, corrected: corrected / 1000 },
      },
      history: history.map((h) => ({
        id: h.id,
        action: h.action,
        change: Number(h.change),
        before: Number(h.beforeLength),
        after: Number(h.afterLength),
        related: h.relatedPieceId ? { id: h.relatedPieceId, code: relatedCode.get(h.relatedPieceId) ?? null } : null,
        sale: h.saleId ? { id: h.saleId, number: h.sale?.number ?? null } : null,
        purchase: h.purchaseId ? { id: h.purchaseId, number: h.purchase?.number ?? null } : null,
        // V3.1: the piece's warehouse at the time; a shift row also names where it went.
        warehouseId: h.warehouseId,
        toWarehouseId: h.toWarehouseId,
        transferId: h.transferId,
        reason: h.reason,
        occurredAt: h.occurredAt,
        by: h.createdById ? (actorName.get(h.createdById) ?? null) : null,
      })),
    });
  });

  /** Rolls already on the rack: opening or found stock (W9). Purchases receive rolls themselves. */
  r.post("/variations/:id/rolls", requirePermission("stock.adjust"), async (req, res) => {
    const body = addRollsBody.parse(req.body);
    if (body.unitCost && !can(req.auth!.role, "inventory.configure")) throw new AppError(403, "FORBIDDEN", "You cannot set costs");
    const c = ctx(req);
    const created = await prisma.$transaction((tx) => addRolls(tx, c, String(req.params.id), body.rolls, { unitCost: body.unitCost ?? null, note: body.note, warehouseId: body.warehouseId }), WRITE_TX);
    res.status(201).json({ pieces: created.map((p) => ({ id: p.id, code: p.code, kind: p.kind, length: Number(p.remainingLength), originalLength: Number(p.originalLength) })) });
  });

  r.post("/pieces/:id/open", requirePermission("stock.adjust"), async (req, res) => {
    const c = ctx(req);
    await prisma.$transaction((tx) => openPiece(tx, c, String(req.params.id)), WRITE_TX);
    res.json({ ok: true });
  });

  r.post("/pieces/:id/cut", requirePermission("stock.adjust"), async (req, res) => {
    const body = cutBody.parse(req.body);
    const c = ctx(req);
    const children = await prisma.$transaction((tx) => cutPiece(tx, c, String(req.params.id), body.lengths, { writeOffLeftover: body.writeOffLeftover, reason: body.reason }), WRITE_TX);
    res.status(201).json({ pieces: children.map((p) => ({ id: p.id, code: p.code, length: Number(p.originalLength) })) });
  });

  r.post("/pieces/:id/write-off", requirePermission("stock.adjust"), async (req, res) => {
    const body = writeOffBody.parse(req.body);
    const c = ctx(req);
    await prisma.$transaction((tx) => writeOff(tx, c, String(req.params.id), body.reason), WRITE_TX);
    res.json({ ok: true });
  });

  r.post("/pieces/:id/correct", requirePermission("stock.adjust"), async (req, res) => {
    const body = correctBody.parse(req.body);
    const c = ctx(req);
    await prisma.$transaction((tx) => correctLength(tx, c, String(req.params.id), body.length, body.note), WRITE_TX);
    res.json({ ok: true });
  });

  r.patch("/pieces/:id", requirePermission("stock.adjust"), async (req, res) => {
    const body = pieceEditBody.parse(req.body);
    const c = ctx(req);
    await prisma.$transaction((tx) => editPiece(tx, c, String(req.params.id), body), WRITE_TX);
    res.json({ ok: true });
  });

  return r;
}
