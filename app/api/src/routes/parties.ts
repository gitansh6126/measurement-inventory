import { Prisma } from "@prisma/client";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { requirePermission } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { can } from "../lib/permissions.js";
import { bumpVersion, hasChanges, lockVersion, versionField } from "../lib/versions.js";

// Customers and suppliers (D20): an optional reference on documents. No ledger, credit or GST.
// Shape follows marble 2110 routes/parties.ts; fields follow main v2 Customers/Suppliers.

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const fields = {
  name: z.string().trim().min(1, "Name is required").max(150),
  phone: opt(30),
  email: opt(200).refine((v) => v === null || z.string().email().safeParse(v).success, "Invalid email"),
  address: opt(500),
  city: opt(100),
  // V2 profile (plan §3.2); GSTIN/PAN/state are V3 (owner decision 4).
  contactPerson: opt(150),
  altPhone: opt(30),
  shippingAddress: opt(500),
  creditScore: z.coerce.number().int().min(0, "Credit score cannot be negative").max(1000).optional().default(0),
};
const createBody = z.object({ type: z.enum(["CUSTOMER", "SUPPLIER", "BOTH"]), ...fields });
const updateBody = z
  .object({
    type: z.enum(["CUSTOMER", "SUPPLIER", "BOTH"]).optional(),
    name: fields.name.optional(),
    phone: fields.phone.optional(),
    email: fields.email.optional(),
    address: fields.address.optional(),
    city: fields.city.optional(),
    contactPerson: fields.contactPerson.optional(),
    altPhone: fields.altPhone.optional(),
    shippingAddress: fields.shippingAddress.optional(),
    creditScore: z.coerce.number().int().min(0, "Credit score cannot be negative").max(1000).optional(),
    active: z.boolean().optional(),
    version: versionField,
  })
  .refine(hasChanges, "Nothing to update");
const listQuery = z.object({
  // customer → CUSTOMER + BOTH; supplier → SUPPLIER + BOTH (as in marble).
  role: z.enum(["customer", "supplier", "all"]).default("all"),
  q: z.string().trim().max(100).optional(),
  status: z.enum(["active", "all"]).default("active"),
});

const select = {
  id: true,
  type: true,
  name: true,
  phone: true,
  email: true,
  address: true,
  city: true,
  contactPerson: true,
  altPhone: true,
  shippingAddress: true,
  creditScore: true,
  active: true,
  version: true,
} as const;
const ctx = (req: Request) => ({ companyId: req.auth!.companyId, actorId: req.auth!.userId, requestId: req.requestId });

function duplicateName(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export function partyRoutes() {
  const r = Router();

  // Anyone who can record a sale needs to search customers; purchase.view users need suppliers.
  r.get("/", requirePermission("sale.view"), async (req, res) => {
    const q = listQuery.parse(req.query);
    const companyId = req.auth!.companyId;
    const types = q.role === "customer" ? ["CUSTOMER", "BOTH"] : q.role === "supplier" ? ["SUPPLIER", "BOTH"] : ["CUSTOMER", "SUPPLIER", "BOTH"];
    const parties = await prisma.party.findMany({
      where: {
        companyId,
        type: { in: types as ("CUSTOMER" | "SUPPLIER" | "BOTH")[] },
        ...(q.status === "active" ? { active: true } : {}),
        ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { phone: { contains: q.q } }, { city: { contains: q.q, mode: "insensitive" } }] } : {}),
      },
      select,
      orderBy: { name: "asc" },
      take: 500,
    });
    res.json({ parties });
  });

  // Profile page (plan §3.2): the party plus lifetime totals. Cancelled documents are excluded.
  // Purchase figures only for roles that may see purchases (sales staff see customers only).
  r.get("/:id", requirePermission("sale.view"), async (req, res) => {
    const companyId = req.auth!.companyId;
    const party = await prisma.party.findFirst({ where: { id: String(req.params.id), companyId }, select: { ...select, createdAt: true } });
    if (!party) throw new AppError(404, "NOT_FOUND", "Customer or supplier not found");
    const seesPurchases = can(req.auth!.role, "purchase.view");
    if (party.type === "SUPPLIER" && !seesPurchases) throw new AppError(403, "FORBIDDEN", "You do not have permission for this action");
    const where = { companyId, partyId: party.id, void: { is: null } };
    const [sales, purchases, lastSale, lastPurchase] = await Promise.all([
      prisma.sale.aggregate({ where, _count: true, _sum: { total: true } }),
      seesPurchases ? prisma.purchase.aggregate({ where, _count: true, _sum: { total: true } }) : null,
      prisma.sale.findFirst({ where, orderBy: { saleDate: "desc" }, select: { saleDate: true } }),
      seesPurchases ? prisma.purchase.findFirst({ where, orderBy: { purchaseDate: "desc" }, select: { purchaseDate: true } }) : null,
    ]);
    res.json({
      party,
      metrics: {
        sales: { count: sales._count, total: (sales._sum.total ?? new Prisma.Decimal(0)).toFixed(2), last: lastSale?.saleDate ?? null },
        purchases: purchases
          ? { count: purchases._count, total: (purchases._sum.total ?? new Prisma.Decimal(0)).toFixed(2), last: lastPurchase?.purchaseDate ?? null }
          : null,
      },
    });
  });

  r.post("/", requirePermission("party.create"), async (req, res) => {
    const body = createBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    if (body.type !== "CUSTOMER" && req.auth!.role === "sales_staff") {
      throw new AppError(403, "FORBIDDEN", "Only a manager or admin can add suppliers");
    }
    try {
      const party = await prisma.$transaction(async (tx) => {
        const p = await tx.party.create({ data: { companyId, ...body, createdById: actorId, updatedById: actorId }, select });
        await audit(tx, { companyId, actorId, action: "PARTY_CREATE", entityType: "Party", entityId: p.id, after: p, requestId });
        return p;
      });
      res.status(201).json({ party });
    } catch (e) {
      if (duplicateName(e)) throw new AppError(409, "PARTY_EXISTS", `A customer or supplier named "${body.name}" already exists`);
      throw e;
    }
  });

  r.patch("/:id", requirePermission("party.edit"), async (req, res) => {
    const { version, ...body } = updateBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    try {
      const party = await prisma.$transaction(async (tx) => {
        await lockVersion(tx, "party", companyId, String(req.params.id), version, "This customer or supplier");
        const before = await tx.party.findFirst({ where: { id: String(req.params.id), companyId }, select });
        if (!before) throw new AppError(404, "NOT_FOUND", "Customer or supplier not found");
        const after = await tx.party.update({ where: { id: before.id }, data: { ...body, updatedById: actorId, ...bumpVersion }, select });
        await audit(tx, { companyId, actorId, action: "PARTY_UPDATE", entityType: "Party", entityId: before.id, before, after, requestId });
        return after;
      });
      res.json({ party });
    } catch (e) {
      if (duplicateName(e)) throw new AppError(409, "PARTY_EXISTS", `A customer or supplier named "${body.name}" already exists`);
      throw e;
    }
  });

  return r;
}