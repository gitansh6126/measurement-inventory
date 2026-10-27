import { Prisma, type OrderStatus } from "@prisma/client";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { getShortagesAndProcurement } from "../lib/measure.js";
import {
  arrangePurchaseBody,
  arrangePurchaseForOrder,
  assertCan,
  cancelBody,
  cancelOrder,
  completeBody,
  completeOrder,
  createOrder,
  createOrderBody,
  fulfillOrder,
  fulfillOrderBody,
  moveOrder,
  statusBody,
  updateOrder,
  updateOrderBody,
} from "../lib/orders.js";
import { orderLineSets } from "../lib/orders.js";
import { seesCost } from "../lib/products.js";
import { setsOfOrder } from "../lib/sets.js";
import { balances } from "../lib/stock.js";
import type { AttributeDef } from "@rs-v31/shared";

// /api/orders — sale and purchase orders (v2/docs/orders/ORDER-LIFECYCLE-PLAN.md §5).
// Permissions depend on the order's kind, so each handler checks them (sale.* / purchase.*).

const STATUSES = ["DRAFT", "PLACED", "ON_DELIVERY", "PARTIALLY_FULFILLED", "COMPLETED", "CANCELLED"] as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const listQuery = z.object({
  kind: z.enum(["SALE", "PURCHASE"]),
  status: z.enum(["ALL", "OPEN", ...STATUSES]).default("ALL"),
  q: z.string().trim().max(100).optional(),
  from: day.optional(),
  to: day.optional(),
  partyId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const istDayStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
const nextDay = (d: string) => new Date(istDayStart(d).getTime() + 24 * 3600 * 1000);
const ctx = (req: Request) => ({ companyId: req.auth!.companyId, actorId: req.auth!.userId, requestId: req.requestId, role: req.auth!.role });

async function userNames(ids: (string | null)[]) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(ids.filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

export function orderRoutes() {
  const r = Router();
  r.use(requireAuth);

  r.get("/", async (req, res) => {
    const q = listQuery.parse(req.query);
    const { companyId, role } = ctx(req);
    assertCan(role, q.kind, "view");
    const base: Prisma.OrderWhereInput = {
      companyId,
      kind: q.kind,
      ...(q.q ? { OR: [{ number: { contains: q.q, mode: "insensitive" } }, { partyName: { contains: q.q, mode: "insensitive" } }] } : {}),
      ...(q.from || q.to ? { orderDate: { ...(q.from ? { gte: istDayStart(q.from) } : {}), ...(q.to ? { lt: nextDay(q.to) } : {}) } } : {}),
      ...(q.partyId ? { partyId: q.partyId } : {}),
    };
    const where: Prisma.OrderWhereInput = {
      ...base,
      ...(q.status === "ALL" ? {} : q.status === "OPEN" ? { status: { in: ["DRAFT", "PLACED", "ON_DELIVERY", "PARTIALLY_FULFILLED"] } } : { status: q.status }),
    };
    const [total, rows, grouped] = await prisma.$transaction([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        // Open work first by expected day; finished orders newest first.
        orderBy: [{ orderDate: "desc" }, { number: "desc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          number: true,
          kind: true,
          status: true,
          orderDate: true,
          expectedDate: true,
          partyId: true,
          partyName: true,
          subtotal: true,
          lineCount: true,
          documentId: true,
          version: true,
          updatedAt: true,
        },
      }),
      prisma.order.groupBy({ by: ["status"], where: base, _count: { _all: true }, orderBy: { status: "asc" } }),
    ]);
    const counts: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const g of grouped) counts[g.status] = (g._count as { _all: number })._all;
    counts.ALL = STATUSES.reduce((t, s) => t + counts[s]!, 0);
    counts.OPEN = counts.DRAFT! + counts.PLACED! + counts.ON_DELIVERY! + (counts.PARTIALLY_FULFILLED ?? 0);
    res.json({
      orders: rows.map(({ subtotal, ...o }) => ({ ...o, total: subtotal.toFixed(2) })),
      counts,
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  });

  r.get("/:id", async (req, res) => {
    const { companyId, role } = ctx(req);
    const o = await prisma.order.findFirst({
      where: { id: String(req.params.id), companyId },
      include: {
        lines: {
          orderBy: { lineNo: "asc" },
          include: {
            piece: { select: { id: true, code: true, kind: true } },
            linkedOrder: { select: { number: true } },
            variation: {
              select: {
                id: true,
                shortName: true,
                officialSku: true,
                attributes: true,
                imageUrl: true,
                active: true,
                salePrice: true,
                purchaseCost: true,
                defaultRollLength: true,
                group: {
                  select: {
                    id: true,
                    name: true,
                    unit: true,
                    active: true,
                    imageUrl: true,
                    attributeDefinitions: true,
                    productType: true,
                    lengthUnit: true,
                    rollName: true,
                    defaultRollLength: true,
                    lengthDecimals: true,
                    scrapBelow: true,
                  },
                },
              },
            },
          },
        },
        events: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!o) throw new AppError(404, "NOT_FOUND", "Order not found");
    assertCan(role, o.kind, "view");
    const stock = await balances(prisma, companyId, o.lines.map((l) => l.variationId));
    const names = await userNames([o.createdById, o.updatedById, ...o.events.map((e) => e.createdById)]);
    const showCost = seesCost(role);
    const open = (["DRAFT", "PLACED", "ON_DELIVERY", "PARTIALLY_FULFILLED"] as OrderStatus[]).includes(o.status);
    let document: { id: string; number: string; cancelled: boolean } | null = null;
    if (o.documentId) {
      const select = { id: true, number: true, void: { select: { id: true } } } as const;
      const d =
        o.kind === "SALE"
          ? await prisma.sale.findFirst({ where: { id: o.documentId, companyId }, select })
          : await prisma.purchase.findFirst({ where: { id: o.documentId, companyId }, select });
      if (d) document = { id: d.id, number: d.number, cancelled: !!d.void };
    }
    // Every sale / purchase made from this order (one per delivery / receipt), with its payment.
    const docSelect = { id: true, number: true, total: true, paymentMode: true, paymentStatus: true, amountPaid: true, createdAt: true, void: { select: { kind: true } } } as const;
    const docs =
      o.kind === "SALE"
        ? await prisma.sale.findMany({ where: { orderId: o.id, companyId }, select: docSelect, orderBy: { createdAt: "asc" } })
        : await prisma.purchase.findMany({ where: { orderId: o.id, companyId }, select: docSelect, orderBy: { createdAt: "asc" } });
    const documents = docs.map((d) => ({
      id: d.id,
      number: d.number,
      total: d.total.toFixed(2),
      paymentMode: d.paymentMode,
      paymentStatus: d.paymentStatus,
      amountPaid: d.amountPaid?.toFixed(2) ?? null,
      at: d.createdAt,
      cancelled: !!d.void,
      // REPLACED: edited — its revision is listed after it; CANCELLED: stock reversed.
      voidKind: d.void?.kind ?? null,
    }));
    const gross = o.lines.reduce((t, l) => t.add(l.lineTotal).add(l.discount), new Prisma.Decimal(0));
    // V3.1 set lines (0037): what the order line carries, and the sets a sale order holds.
    const [lineSets, heldSets] = await Promise.all([orderLineSets(prisma, o.id), setsOfOrder(prisma, companyId, o.id)]);
    res.json({
      order: {
        id: o.id,
        number: o.number,
        kind: o.kind,
        status: o.status,
        orderDate: o.orderDate,
        expectedDate: o.expectedDate,
        partyId: o.partyId,
        partyName: o.partyName,
        // V3.1 (WH-13): purchase order preferred warehouse (null while off / not chosen).
        warehouseId: o.warehouseId,
        deliveryAddress: o.deliveryAddress,
        deliveryNote: o.deliveryNote,
        notes: o.notes,
        total: o.subtotal.toFixed(2),
        gross: gross.toFixed(2),
        discount: gross.sub(o.subtotal).toFixed(2),
        cancelReason: o.cancelReason,
        version: o.version,
        createdAt: o.createdAt,
        createdBy: names.get(o.createdById) ?? null,
        updatedAt: o.updatedAt,
        updatedBy: o.updatedById ? (names.get(o.updatedById) ?? null) : null,
        document,
        documents,
        lines: o.lines.map((l) => {
          const v = l.variation;
          const available = stock.get(v.id) ?? 0;
          const current = o.kind === "SALE" ? v.salePrice : showCost ? v.purchaseCost : null;
          const defs = Array.isArray(v.group.attributeDefinitions) ? (v.group.attributeDefinitions as unknown as AttributeDef[]) : [];
          const qty = Number(l.quantity);
          const fulfilledQty = Number(l.fulfilledQuantity);
          const outstandingQty = Math.max(0, qty - fulfilledQty);
          const isMeasured = v.group.productType === "measured" && !!v.group.lengthUnit;
          const isGrouped = v.group.productType === "grouped";
          const held = isGrouped && o.kind === "SALE" ? (heldSets.get(l.lineNo) ?? []) : [];
          return {
            id: l.id,
            lineNo: l.lineNo,
            variationId: v.id,
            productId: v.group.id,
            productName: v.group.name,
            shortName: v.shortName,
            officialSku: v.officialSku,
            attributes: v.attributes,
            attributeUnits: Object.fromEntries(defs.filter((d) => d && !d.isQuality && d.unit).map((d) => [d.name, d.unit!])),
            unit: v.group.unit,
            imageUrl: v.imageUrl ?? v.group.imageUrl,
            active: v.active && v.group.active,
            quantity: qty,
            fulfilledQuantity: fulfilledQty,
            outstandingQuantity: outstandingQty,
            price: l.price.toFixed(2),
            // The unit the price is per: "ft" on a feet + inches line priced per foot (0028).
            rateUnit: l.ratePer === 12 ? "ft" : v.group.unit,
            discount: l.discount.toFixed(2),
            note: l.note,
            lineTotal: l.lineTotal.toFixed(2),
            available: isGrouped && o.kind === "SALE" ? held.length : available,
            // Live warning only while the order is open (no reservation, plan O4; a sale order's
            // sets are held, D23).
            shortage: open && o.kind === "SALE" && !isGrouped && outstandingQty > available ? outstandingQty - available : 0,
            // V3.1: purchase order — sets expected [{ parts, notes, warehouseId }]; sale order —
            // [{ setId, changes }] and the held sets themselves.
            productType: v.group.productType,
            sets: o.kind === "PURCHASE" ? (lineSets.get(l.id) ?? null) : null,
            saleSets: o.kind === "SALE" ? (lineSets.get(l.id) ?? null) : null,
            heldSets: isGrouped && o.kind === "SALE" ? held : null,
            currentPrice: current ? current.toFixed(2) : null,
            pieceId: l.pieceId,
            piece: l.piece ? { id: l.piece.id, code: l.piece.code, kind: l.piece.kind } : null,
            rolls: l.rolls ?? null,
            // Purchase-order line bought for a customer order's shortage.
            linked: l.linkedOrderId && l.linkedOrderLineId ? { orderId: l.linkedOrderId, orderLineId: l.linkedOrderLineId, orderNumber: l.linkedOrder?.number ?? "" } : null,
            // V3.1: saved Take-from split; null = decide at delivery.
            splits: l.splits ?? null,
            measure: isMeasured
              ? {
                  lengthUnit: v.group.lengthUnit!,
                  decimals: v.group.lengthDecimals ?? 3,
                  scrapBelow: v.group.scrapBelow === null ? null : Number(v.group.scrapBelow),
                  rollName: v.group.rollName,
                  defaultRollLength: v.defaultRollLength !== null ? Number(v.defaultRollLength) : v.group.defaultRollLength !== null ? Number(v.group.defaultRollLength) : null,
                  pieceId: l.pieceId,
                  pieceCode: l.piece?.code ?? null,
                  pieceKind: l.piece?.kind ?? null,
                  rolls: (l.rolls as unknown[]) ?? undefined,
                }
              : null,
          };
        }),
        events: o.events.map((e) => ({ id: e.id, from: e.fromStatus, to: e.toStatus, note: e.note, at: e.createdAt, by: names.get(e.createdById) ?? null })),
      },
    });
  });

  r.get("/:id/shortages", async (req, res) => {
    const { companyId, role } = ctx(req);
    const orderId = String(req.params.id);
    const o = await prisma.order.findFirst({ where: { id: orderId, companyId }, select: { kind: true } });
    if (!o) throw new AppError(404, "NOT_FOUND", "Order not found");
    assertCan(role, o.kind, "view");
    const shortages = await getShortagesAndProcurement(prisma, companyId, orderId);
    res.json({ orderId, shortages });
  });

  r.post("/:id/arrange-purchase", async (req, res) => {
    const result = await arrangePurchaseForOrder(ctx(req), String(req.params.id), arrangePurchaseBody.parse(req.body));
    res.status(201).json(result);
  });

  r.post("/:id/fulfill", async (req, res) => {
    const result = await fulfillOrder(ctx(req), String(req.params.id), fulfillOrderBody.parse(req.body));
    res.status(result.created ? 201 : 200).json(result);
  });

  r.post("/", async (req, res) => {
    const result = await createOrder(ctx(req), createOrderBody.parse(req.body));
    res.status(result.created ? 201 : 200).json(result);
  });

  r.put("/:id", async (req, res) => {
    res.json(await updateOrder(ctx(req), String(req.params.id), updateOrderBody.parse(req.body)));
  });

  r.post("/:id/status", async (req, res) => {
    res.json(await moveOrder(ctx(req), String(req.params.id), statusBody.parse(req.body)));
  });

  r.post("/:id/complete", async (req, res) => {
    const result = await completeOrder(ctx(req), String(req.params.id), completeBody.parse(req.body));
    res.status(result.created ? 201 : 200).json(result);
  });

  r.post("/:id/cancel", async (req, res) => {
    res.json(await cancelOrder(ctx(req), String(req.params.id), cancelBody.parse(req.body)));
  });

  return r;
}
