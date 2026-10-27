import { Prisma } from "@prisma/client";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, WRITE_TX } from "../db.js";
import { audit } from "../lib/audit.js";
import { requirePermission } from "../lib/auth.js";
import { fromPaise, lineGrossPaise, toPaise } from "../lib/documents.js";
import { AppError } from "../lib/errors.js";
import { can } from "../lib/permissions.js";
import { seesCost } from "../lib/products.js";
import { ratePerOf, toMilli } from "@rs-v31/shared/measure";
import { balances, money } from "../lib/stock.js";
import { splitsInput } from "../lib/warehouses.js";
import { bumpVersion, hasChanges, versionField } from "../lib/versions.js";

// Held / parked carts (V2 plan §3.4, backlog F8). Company-wide so one counter can park an order
// and another can finish it. Drafts never write stock: resuming re-validates stock and prices,
// and the normal checkout (POST /api/sales|purchases with draftId) completes the draft in the
// same transaction as the document.

const DRAFT_DAYS = 30;
const MODES = ["SALE", "PURCHASE"] as const;

const draftLine = z.object({
  variationId: z.string().min(1),
  // Whole for counted items; a Measured length may carry 3 decimals (re-checked at checkout).
  quantity: z
    .number()
    .positive()
    .max(1_000_000)
    .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, "Use at most 3 decimal places"),
  price: money,
  // Measured lines (V2 plan §2.8 / §3.4): the preferred piece only; the cut plan is rebuilt on resume.
  pieceId: z.string().min(1).nullish(),
  // Measured purchase lines: the typed roll lengths, kept as entered until checkout.
  rolls: z
    .array(z.object({ length: z.number().positive().max(1_000_000), supplierRollNo: z.string().trim().max(60).nullish(), rack: z.string().trim().max(40).nullish(), notes: z.string().trim().max(300).nullish(), warehouseId: z.string().min(1).nullish() }))
    .max(500)
    .optional(),
  discount: money.optional(),
  note: z.string().trim().max(300).nullish().transform((v) => v || null),
  // V3.1 grouped purchase lines: the sets as entered (checked again at checkout) and their labels.
  sets: z
    .array(
      z.object({
        parts: z.array(z.object({ byproductId: z.string().min(1), variationId: z.string().min(1), length: z.number().positive().max(1_000_000).optional() })).max(10),
        notes: z.string().trim().max(300).nullish(),
        // V3.1 (GW-1): the warehouse the set is received into.
        warehouseId: z.string().min(1).nullish(),
      }),
    )
    .max(100)
    .optional(),
  setSummaries: z.array(z.string().max(300)).max(100).optional(),
  // Each set's contents for display, part by part (no codes).
  setDetails: z
    .array(z.object({ note: z.string().max(60).optional(), rows: z.array(z.object({ name: z.string().max(150), value: z.string().max(200) })).max(20) }))
    .max(100)
    .optional(),
  // V3.1 grouped sale lines: the sets picked and their part changes (checked again at checkout).
  saleSets: z
    .array(
      z.object({
        setId: z.string().min(1),
        version: z.number().int().positive().optional(),
        changes: z
          .array(
            z.object({
              byproductId: z.string().min(1),
              action: z.enum(["REPLACE", "ADD", "REMOVE"]),
              variationId: z.string().min(1).optional(),
              pieceId: z.string().min(1).nullish(),
              length: z.number().positive().max(1_000_000).optional(),
              backorder: z.boolean().optional(),
            }),
          )
          .max(10)
          .optional(),
      }),
    )
    .max(100)
    .optional(),
  // V3.1 (WH-14): the line's warehouse split as chosen; re-checked at checkout.
  splits: splitsInput.optional(),
});
const title = z.string().trim().min(1, "Give the draft a name").max(120);
const notes = z.string().trim().max(500).nullish().transform((v) => v || null);
const createBody = z.object({
  mode: z.enum(MODES),
  title,
  partyId: z.string().min(1).nullish().transform((v) => v ?? null),
  notes,
  lines: z.array(draftLine).max(200),
});
const updateBody = z
  .object({
    title: title.optional(),
    partyId: z.string().min(1).nullable().optional(),
    notes: notes.optional(),
    lines: z.array(draftLine).max(200).optional(),
    version: versionField,
  })
  .refine(hasChanges, "Nothing to update");
const listQuery = z.object({ mode: z.enum(MODES), q: z.string().trim().max(100).optional() });

type DraftLine = z.infer<typeof draftLine>;
const ctx = (req: Request) => ({ companyId: req.auth!.companyId, actorId: req.auth!.userId, requestId: req.requestId, role: req.auth!.role });

function assertMode(role: Parameters<typeof can>[0], mode: (typeof MODES)[number]) {
  if (!can(role, mode === "SALE" ? "sale.create" : "purchase.create")) throw new AppError(403, "FORBIDDEN", "You do not have permission for this action");
}

function totals(lines: DraftLine[], ratePer: ReadonlyMap<string, number>) {
  let total = 0n;
  for (const l of lines) {
    const gross = lineGrossPaise(toMilli(l.quantity), toPaise(l.price), ratePer.get(l.variationId) ?? 1);
    const d = l.discount ? toPaise(l.discount) : 0n;
    total += gross > d ? gross - d : 0n;
  }
  return { estimatedTotal: fromPaise(total), lineCount: lines.length };
}

/** Checks the party and items; returns each item's base units per rate unit (per ft = 12). */
async function assertRefs(companyId: string, mode: (typeof MODES)[number], partyId: string | null | undefined, lines?: DraftLine[]) {
  if (partyId) {
    const p = await prisma.party.findFirst({ where: { id: partyId, companyId }, select: { type: true } });
    const ok = p && (p.type === "BOTH" || p.type === (mode === "SALE" ? "CUSTOMER" : "SUPPLIER"));
    if (!ok) throw new AppError(400, "UNKNOWN_PARTY", `That ${mode === "SALE" ? "customer" : "supplier"} was not found`);
  }
  if (lines?.length) {
    const ids = [...new Set(lines.map((l) => l.variationId))];
    const found = await prisma.productVariation.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, group: { select: { lengthUnit: true } } } });
    if (found.length !== ids.length) throw new AppError(400, "UNKNOWN_ITEM", "An item in this draft was not found");
    return new Map(found.map((v) => [v.id, ratePerOf(v.group.lengthUnit)]));
  }
  return new Map<string, number>();
}

const listSelect = {
  id: true,
  mode: true,
  title: true,
  partyId: true,
  party: { select: { name: true } },
  notes: true,
  estimatedTotal: true,
  lineCount: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
} satisfies Prisma.DraftOrderSelect;

async function withNames<T extends { createdById: string }>(rows: T[]) {
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, createdBy: name.get(r.createdById) ?? null }));
}

const view = <T extends { estimatedTotal: Prisma.Decimal; party: { name: string } | null }>(d: T) => ({
  ...d,
  estimatedTotal: d.estimatedTotal.toFixed(2),
  partyName: d.party?.name ?? null,
});

export function draftRoutes() {
  const r = Router();

  // The "Drafts (N)" queue: active, unexpired drafts of one mode, newest first.
  r.get("/", requirePermission("catalog.view"), async (req, res) => {
    const q = listQuery.parse(req.query);
    const { companyId, role } = ctx(req);
    assertMode(role, q.mode);
    const rows = await prisma.draftOrder.findMany({
      where: {
        companyId,
        mode: q.mode,
        status: "ACTIVE",
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        ...(q.q ? { AND: [{ OR: [{ title: { contains: q.q, mode: "insensitive" } }, { party: { name: { contains: q.q, mode: "insensitive" } } }] }] } : {}),
      },
      select: listSelect,
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 200,
    });
    res.json({ drafts: (await withNames(rows)).map(view), count: rows.length });
  });

  // Resume: the draft plus live re-validation of every line (stock, price, archived items).
  r.get("/:id", requirePermission("catalog.view"), async (req, res) => {
    const { companyId, role } = ctx(req);
    const d = await prisma.draftOrder.findFirst({ where: { id: String(req.params.id), companyId }, select: { ...listSelect, status: true, lines: true, documentId: true } });
    if (!d) throw new AppError(404, "NOT_FOUND", "Draft not found");
    assertMode(role, d.mode);
    const lines = (d.lines as unknown as DraftLine[]) ?? [];
    const ids = [...new Set(lines.map((l) => l.variationId))];
    const variations = await prisma.productVariation.findMany({
      where: { companyId, id: { in: ids } },
      include: { group: { select: { id: true, name: true, unit: true, active: true, imageUrl: true, productType: true, lengthUnit: true, lengthDecimals: true, scrapBelow: true, rollName: true } } },
    });
    const byId = new Map(variations.map((v) => [v.id, v]));
    const stock = await balances(prisma, companyId, ids);
    const showCost = seesCost(role);
    const checked = lines.map((l) => {
      const v = byId.get(l.variationId);
      if (!v) return { ...l, missing: true };
      const available = stock.get(v.id) ?? 0;
      const current = d.mode === "SALE" ? v.salePrice : showCost ? v.purchaseCost : null;
      return {
        ...l,
        // Enough to rebuild the cart line on resume.
        productId: v.group.id,
        attributes: v.attributes,
        imageUrl: v.imageUrl ?? v.group.imageUrl,
        productName: v.group.name,
        shortName: v.shortName,
        unit: v.group.unit,
        // Measured lines (V2 plan §2.8): rebuilt as length + preferred piece / rolls on resume.
        measure:
          v.group.productType === "measured" && v.group.lengthUnit
            ? { lengthUnit: v.group.lengthUnit, decimals: v.group.lengthDecimals ?? 3, scrapBelow: v.group.scrapBelow === null ? null : Number(v.group.scrapBelow), rollName: v.group.rollName }
            : null,
        active: v.active && v.group.active,
        available,
        // Sales only: the shortage badge ("Stock changed: 2 on hand, draft requests 5").
        shortage: d.mode === "SALE" && l.quantity > available ? l.quantity - available : 0,
        currentPrice: current ? current.toFixed(2) : null,
        priceChanged: current ? !current.equals(new Prisma.Decimal(l.price)) : false,
      };
    });
    const [named] = await withNames([d]);
    res.json({ draft: { ...view(named!), status: d.status, documentId: d.documentId, lines: checked } });
  });

  r.post("/", requirePermission("catalog.view"), async (req, res) => {
    const body = createBody.parse(req.body);
    const { companyId, actorId, requestId, role } = ctx(req);
    assertMode(role, body.mode);
    const ratePer = await assertRefs(companyId, body.mode, body.partyId, body.lines);
    const draft = await prisma.$transaction(async (tx) => {
      const d = await tx.draftOrder.create({
        data: {
          companyId,
          mode: body.mode,
          title: body.title,
          partyId: body.partyId,
          notes: body.notes,
          lines: body.lines as unknown as Prisma.InputJsonValue,
          ...totals(body.lines, ratePer),
          expiresAt: new Date(Date.now() + DRAFT_DAYS * 86_400_000),
          createdById: actorId,
          updatedById: actorId,
        },
        select: listSelect,
      });
      await audit(tx, { companyId, actorId, action: "DRAFT_CREATE", entityType: "DraftOrder", entityId: d.id, after: { mode: d.mode, title: d.title, lines: d.lineCount }, requestId });
      return d;
    }, WRITE_TX);
    res.status(201).json({ draft: view((await withNames([draft]))[0]!) });
  });

  r.put("/:id", requirePermission("catalog.view"), async (req, res) => {
    const { version, ...body } = updateBody.parse(req.body);
    const { companyId, actorId, requestId, role } = ctx(req);
    const id = String(req.params.id);
    const draft = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ version: number }[]>`SELECT version FROM draft_orders WHERE id = ${id} AND company_id = ${companyId} FOR UPDATE`;
      const before = await tx.draftOrder.findFirst({ where: { id, companyId }, select: { mode: true, status: true } });
      if (!before || !rows[0]) throw new AppError(404, "NOT_FOUND", "Draft not found");
      assertMode(role, before.mode);
      if (before.status !== "ACTIVE") throw new AppError(409, "DRAFT_CLOSED", "This draft was already completed or discarded");
      if (version !== undefined && rows[0].version !== version) {
        throw new AppError(409, "VERSION_CONFLICT", "This draft was changed by someone else. Reload to see the latest, then try again.", { currentVersion: rows[0].version });
      }
      const ratePer = await assertRefs(companyId, before.mode, body.partyId, body.lines);
      const d = await tx.draftOrder.update({
        where: { id },
        data: {
          title: body.title,
          partyId: body.partyId,
          notes: body.notes,
          ...(body.lines ? { lines: body.lines as unknown as Prisma.InputJsonValue, ...totals(body.lines, ratePer) } : {}),
          expiresAt: new Date(Date.now() + DRAFT_DAYS * 86_400_000),
          updatedById: actorId,
          ...bumpVersion,
        },
        select: listSelect,
      });
      await audit(tx, { companyId, actorId, action: "DRAFT_UPDATE", entityType: "DraftOrder", entityId: id, after: { title: d.title, lines: d.lineCount }, requestId });
      return d;
    }, WRITE_TX);
    res.json({ draft: view((await withNames([draft]))[0]!) });
  });

  r.post("/:id/discard", requirePermission("catalog.view"), async (req, res) => {
    const { companyId, actorId, requestId, role } = ctx(req);
    const id = String(req.params.id);
    await prisma.$transaction(async (tx) => {
      const d = await tx.draftOrder.findFirst({ where: { id, companyId }, select: { mode: true, status: true, title: true } });
      if (!d) throw new AppError(404, "NOT_FOUND", "Draft not found");
      assertMode(role, d.mode);
      if (d.status !== "ACTIVE") throw new AppError(409, "DRAFT_CLOSED", "This draft was already completed or discarded");
      await tx.draftOrder.update({ where: { id }, data: { status: "DISCARDED", updatedById: actorId, ...bumpVersion } });
      await audit(tx, { companyId, actorId, action: "DRAFT_DISCARD", entityType: "DraftOrder", entityId: id, after: { title: d.title }, requestId });
    }, WRITE_TX);
    res.json({ ok: true });
  });

  return r;
}
