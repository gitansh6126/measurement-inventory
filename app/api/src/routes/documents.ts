import { Prisma } from "@prisma/client";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requirePermission } from "../lib/auth.js";
import {
  createDocument,
  documentBody,
  editDocument,
  editDocumentBody,
  getRevisionChain,
  previewEditDocument,
  PURCHASE,
  SALE,
  voidBody,
  voidDocument,
} from "../lib/documents.js";
import { AppError } from "../lib/errors.js";
import type { Permission } from "../lib/permissions.js";
import { documentChainIds } from "../lib/measure.js";
import { setsOfDocument } from "../lib/sets.js";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  from: day.optional(),
  to: day.optional(),
  // V2: party history (plan §3.2) and cancelled documents (void, D3).
  partyId: z.string().min(1).optional(),
  status: z.enum(["all", "completed", "cancelled", "replaced"]).default("all"),
  includeReplaced: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === "1" || v === "true"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const paymentView = (d: { paymentMode: string | null; paymentStatus: string | null; amountPaid: Prisma.Decimal | null }) =>
  d.paymentMode || d.paymentStatus ? { mode: d.paymentMode, status: d.paymentStatus, amountPaid: d.amountPaid?.toFixed(2) ?? null } : null;

/** A calendar day in India (Asia/Kolkata, UTC+5:30) as a UTC instant. */
import { type AttributeDef } from "@rs-v31/shared";

const istDayStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
const nextDay = (d: string) => new Date(istDayStart(d).getTime() + 24 * 3600 * 1000);

const ctx = (req: Request) => ({ companyId: req.auth!.companyId, actorId: req.auth!.userId, requestId: req.requestId });

function lineView(l: {
  id: string;
  lineNo: number;
  variationId: string;
  productNameSnapshot: string;
  shortNameSnapshot: string;
  officialSkuSnapshot: string | null;
  attributesSnapshot: Prisma.JsonValue;
  unit: string;
  quantity: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
  discount?: Prisma.Decimal;
  note?: string | null;
  unitPrice?: Prisma.Decimal;
  unitCost?: Prisma.Decimal;
  ratePer?: number;
  variation?: {
    groupId?: string;
    group?: {
      attributeDefinitions?: Prisma.JsonValue;
    } | null;
  } | null;
}) {
  const defs = Array.isArray(l.variation?.group?.attributeDefinitions)
    ? (l.variation!.group!.attributeDefinitions as unknown as AttributeDef[])
    : [];
  const attributeUnits: Record<string, string> = {};
  for (const d of defs) {
    if (d && !d.isQuality && d.unit) {
      attributeUnits[d.name] = d.unit;
    }
  }

  return {
    id: l.id,
    lineNo: l.lineNo,
    variationId: l.variationId,
    productId: l.variation?.groupId ?? null,
    productName: l.productNameSnapshot,
    shortName: l.shortNameSnapshot,
    officialSku: l.officialSkuSnapshot,
    attributes: l.attributesSnapshot,
    attributeUnits,
    unit: l.unit,
    quantity: Number(l.quantity),
    price: (l.unitPrice ?? l.unitCost)!.toFixed(2),
    // The unit the price is per: "ft" on a feet + inches line priced per foot (0028).
    rateUnit: l.ratePer === 12 ? "ft" : l.unit,
    discount: (l.discount ?? new Prisma.Decimal(0)).toFixed(2),
    note: l.note ?? null,
    lineTotal: l.lineTotal.toFixed(2),
  };
}


/** /api/sales and /api/purchases share one shape; only the table, permissions and stock sign differ. */
function documentRoutes(kind: "sale" | "purchase") {
  const r = Router();
  const view: Permission = kind === "sale" ? "sale.view" : "purchase.view";
  const create: Permission = kind === "sale" ? "sale.create" : "purchase.create";
  const cfg = kind === "sale" ? SALE : PURCHASE;
  const dateField = kind === "sale" ? "saleDate" : "purchaseDate";

  r.get("/", requirePermission(view), async (req, res) => {
    const q = listQuery.parse(req.query);
    const companyId = req.auth!.companyId;
    const where = {
      companyId,
      ...(q.q ? { OR: [{ number: { contains: q.q, mode: "insensitive" as const } }, { partyName: { contains: q.q, mode: "insensitive" as const } }] } : {}),
      ...(q.from || q.to ? { [dateField]: { ...(q.from ? { gte: istDayStart(q.from) } : {}), ...(q.to ? { lt: nextDay(q.to) } : {}) } } : {}),
      ...(q.partyId ? { partyId: q.partyId } : {}),
      ...(q.status === "cancelled"
        ? { void: { is: { kind: "CANCELLED" as const } } }
        : q.status === "replaced"
        ? { void: { is: { kind: "REPLACED" as const } } }
        : q.status === "completed"
        ? { void: { is: null } }
        : q.includeReplaced
        ? {}
        : { OR: [{ void: { is: null } }, { void: { is: { kind: "CANCELLED" as const } } }] }),
    };
    const args = {
      where,
      orderBy: [{ [dateField]: "desc" as const }, { number: "desc" as const }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true,
        number: true,
        revision: true,
        [dateField]: true,
        partyId: true,
        partyName: true,
        total: true,
        paymentMode: true,
        paymentStatus: true,
        amountPaid: true,
        void: { select: { createdAt: true, kind: true } },
        _count: { select: { lines: true } },
      },
    };
    const [total, rows] =
      kind === "sale"
        ? await prisma.$transaction([prisma.sale.count({ where }), prisma.sale.findMany(args as Prisma.SaleFindManyArgs)])
        : await prisma.$transaction([prisma.purchase.count({ where }), prisma.purchase.findMany(args as Prisma.PurchaseFindManyArgs)]);
    res.json({
      documents: (rows as unknown as Record<string, unknown>[]).map((d) => ({
        id: d.id,
        number: d.number,
        date: d[dateField],
        partyId: d.partyId,
        partyName: d.partyName,
        total: (d.total as Prisma.Decimal).toFixed(2),
        lineCount: (d._count as { lines: number }).lines,
        revision: (d.revision as number) ?? 0,
        edited: ((d.revision as number) ?? 0) > 0,
        status: d.void ? ((d.void as any).kind === "REPLACED" ? "REPLACED" : "CANCELLED") : "COMPLETED",
        payment: paymentView(d as unknown as Parameters<typeof paymentView>[0]),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  });

  r.get("/:id", requirePermission(view), async (req, res) => {
    const companyId = req.auth!.companyId;
    const where = { id: String(req.params.id), companyId };
    const include = {
      void: { select: { reason: true, createdAt: true, createdById: true, kind: true, replacedBySaleId: true, replacedByPurchaseId: true } },
      replaces: { select: { id: true, number: true } },
      replacedBy: { select: { id: true, number: true } },
      lines: {
        orderBy: { lineNo: "asc" as const },
        include: {
          variation: {
            select: {
              groupId: true,
              group: {
                select: {
                  attributeDefinitions: true,
                },
              },
            },
          },
        },
      },
    };
    const d = kind === "sale" ? await prisma.sale.findFirst({ where, include }) : await prisma.purchase.findFirst({ where, include });
    if (!d) throw new AppError(404, "NOT_FOUND", `${kind === "sale" ? "Sale" : "Purchase"} not found`);
    const by = await prisma.user.findUnique({ where: { id: d.createdById }, select: { name: true } });
    const voidedBy = d.void ? await prisma.user.findUnique({ where: { id: d.void.createdById }, select: { name: true } }) : null;
    const revisions = await getRevisionChain(kind === "sale", companyId, d.id);
    // Gross before line discounts, for the print view.
    const gross = d.lines.reduce((s, l) => s.add(l.lineTotal).add(l.discount), new Prisma.Decimal(0));
    // Measured lines (V2 plan §2.8): the rolls each line was cut from or received as. Internal
    // view only; the printed line shows length and rate.
    // A header-edited document (2026-10-27): its rolls were cut or received by the first of its chain.
    const chain = await documentChainIds(prisma, companyId, kind, d.id);
    const pieceRows = await prisma.measurementPieceLedger.findMany({
      where: { companyId, ...(kind === "sale" ? { saleId: { in: chain } } : { purchaseId: { in: chain } }), action: { in: ["SALE", "RECEIVE", "SALE_VOID", "PURCHASE_VOID"] } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: { variationId: true, lineNo: true, action: true, change: true, beforeLength: true, afterLength: true, piece: { select: { id: true, code: true, kind: true } } },
    });
    // V3.1: the sets on grouped lines (codes, contents; internal view).
    const setsByLine = await setsOfDocument(prisma, companyId, kind, d.id);
    res.json({
      document: {
        id: d.id,
        number: d.number,
        revision: d.revision,
        replaces: d.replaces ? { id: d.replaces.id, number: d.replaces.number } : null,
        replacedBy: d.replacedBy ? { id: d.replacedBy.id, number: d.replacedBy.number } : null,
        revisions,
        status: d.void ? (d.void.kind === "REPLACED" ? "REPLACED" : "CANCELLED") : d.status,
        void: d.void ? { kind: d.void.kind, reason: d.void.reason, at: d.void.createdAt, by: voidedBy?.name ?? null, replacedById: kind === "sale" ? d.void.replacedBySaleId : d.void.replacedByPurchaseId } : null,
        payment: paymentView(d),
        gross: gross.toFixed(2),
        discount: gross.sub(d.total).toFixed(2),
        date: "saleDate" in d ? d.saleDate : d.purchaseDate,
        partyId: d.partyId,
        partyName: d.partyName,
        subtotal: d.subtotal.toFixed(2),
        total: d.total.toFixed(2),
        notes: d.notes,
        createdBy: by?.name ?? null,
        createdAt: d.createdAt,
        lines: d.lines.map((l) => ({
          ...lineView(l),
          pieces: pieceRows
            // Rows from before 0021 may lack a line number; those match by variation. V3.1: a set
            // line's chain pieces belong to the set (listed with its sets), not to the line.
            .filter((p) => (p.lineNo === null || p.lineNo === l.lineNo) && p.variationId === l.variationId)
            .map((p) => ({ id: p.piece.id, code: p.piece.code, kind: p.piece.kind, action: p.action, change: Number(p.change), before: Number(p.beforeLength), after: Number(p.afterLength) })),
          sets: (setsByLine.get(l.lineNo) ?? []).map((s) => ({
            id: s.id,
            code: s.code,
            name: s.name,
            contents: s.contents,
            status: s.status,
            groupId: s.groupId,
            // Measured parts fitted in the set: the cancel dialog offers to release them (2026-10-24).
            measuredParts: s.parts.filter((p) => p.productType === "measured" && p.piece).map((p) => ({ name: p.productName, value: p.value })),
          })),
        })),
      },
    });
  });

  r.post("/", requirePermission(create), async (req, res) => {
    const body = documentBody.parse(req.body);
    const { id, created } = await createDocument(cfg, ctx(req), body);
    res.status(created ? 201 : 200).json({ id, created });
  });

  // V2 (D3): cancel with a reason; stock is reversed, the document itself never changes.
  r.post("/:id/void", requirePermission(kind === "sale" ? "sale.void" : "purchase.void"), async (req, res) => {
    const { reason, releaseSetIds } = voidBody.parse(req.body);
    res.json(await voidDocument(cfg, ctx(req), String(req.params.id), reason, { releaseSetIds }));
  });

  // V2 (plan §6): preview edit diff before saving
  r.post("/:id/edit/preview", requirePermission(kind === "sale" ? "sale.edit" : "purchase.edit"), async (req, res) => {
    const body = documentBody.parse(req.body);
    res.json(await previewEditDocument(cfg, ctx(req), String(req.params.id), body));
  });

  // V2 (plan §1, §6): edit (replaces original document in one transaction)
  r.post("/:id/edit", requirePermission(kind === "sale" ? "sale.edit" : "purchase.edit"), async (req, res) => {
    const body = editDocumentBody.parse(req.body);
    res.status(201).json(await editDocument(cfg, ctx(req), String(req.params.id), body));
  });

  return r;
}

export const saleRoutes = () => documentRoutes("sale");
export const purchaseRoutes = () => documentRoutes("purchase");
