import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, WRITE_TX, type Tx } from "../db.js";
import { audit } from "../lib/audit.js";
import { requirePermission } from "../lib/auth.js";
import { PRODUCT_TYPE_HEAD } from "../lib/category-heads.js";
import { AppError } from "../lib/errors.js";
import { isUniqueViolation } from "../lib/products.js";

// V3.1 (0033) category heads, after the script_versions "Dimensions" (category groups): the
// Categories page shows one tab per head. "Product Type" is built in (no row, always first,
// cannot be renamed or retired); the company adds heads such as "Industry" or "Material".
// Never hard-deleted: active=false retires a head and hides its categories from product forms.

const name = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .refine((v) => v.toLowerCase() !== PRODUCT_TYPE_HEAD.name.toLowerCase(), "Product Type is the built-in head");
const createBody = z.object({ name });
const updateBody = z
  .object({ name: name.optional(), active: z.boolean().optional() })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Nothing to update");
const orderBody = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "Each head may appear only once"),
});
const listQuery = z.object({ status: z.enum(["active", "all"]).default("active") });

const select = { id: true, name: true, active: true, sortOrder: true, createdAt: true, updatedAt: true } as const;
const order = [{ sortOrder: "asc" }, { name: "asc" }] as const;
const ctx = (req: Request) => ({ companyId: req.auth!.companyId, actorId: req.auth!.userId, requestId: req.requestId });

async function writeTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn, WRITE_TX);
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError(409, "HEAD_EXISTS", "A category head with this name already exists");
    throw e;
  }
}

async function loadHead(tx: Tx, companyId: string, id: string) {
  const h = await tx.categoryHead.findFirst({ where: { id, companyId }, select });
  if (!h) throw new AppError(404, "NOT_FOUND", "Category head not found");
  return h;
}

async function assertNameFree(tx: Tx, companyId: string, value: string, exceptId?: string) {
  const hit = await tx.categoryHead.findFirst({
    where: { companyId, name: { equals: value, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (hit) throw new AppError(409, "HEAD_EXISTS", "A category head with this name already exists");
}

export function categoryHeadRoutes() {
  const r = Router();

  // Product Type first, then the company's heads in their order. Counts are of categories.
  r.get("/", requirePermission("catalog.view"), async (req, res) => {
    const { status } = listQuery.parse(req.query);
    const companyId = req.auth!.companyId;
    const [heads, productTypeCount] = await Promise.all([
      prisma.categoryHead.findMany({
        where: { companyId, ...(status === "active" ? { active: true } : {}) },
        select: { ...select, _count: { select: { categories: { where: { active: true } } } } },
        orderBy: [...order],
      }),
      prisma.category.count({ where: { companyId, headId: null, active: true } }),
    ]);
    res.json({
      heads: [
        { ...PRODUCT_TYPE_HEAD, active: true, sortOrder: 0, categoryCount: productTypeCount },
        ...heads.map(({ _count, ...h }) => ({ ...h, builtIn: false, categoryCount: _count.categories })),
      ],
    });
  });

  // Registered before "/:id" so "order" is never read as an id.
  r.put("/order", requirePermission("category.write"), async (req, res) => {
    const { ids } = orderBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    const heads = await writeTx(async (tx) => {
      const found = await tx.categoryHead.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, sortOrder: true } });
      if (found.length !== ids.length) throw new AppError(404, "NOT_FOUND", "Category head not found");
      const before = new Map(found.map((h) => [h.id, h.sortOrder]));
      const changed = ids.flatMap((id, i) => (before.get(id) === i + 1 ? [] : [{ id, sortOrder: i + 1 }]));
      for (const h of changed) await tx.categoryHead.update({ where: { id: h.id }, data: { sortOrder: h.sortOrder, updatedById: actorId } });
      if (changed.length) {
        await audit(tx, {
          companyId,
          actorId,
          action: "CATEGORY_HEAD_REORDER",
          entityType: "CategoryHead",
          before: { order: ids.map((id) => ({ id, sortOrder: before.get(id) })) },
          after: { order: ids.map((id, i) => ({ id, sortOrder: i + 1 })) },
          requestId,
        });
      }
      return tx.categoryHead.findMany({ where: { companyId }, select, orderBy: [...order] });
    });
    res.json({ heads });
  });

  r.post("/", requirePermission("category.write"), async (req, res) => {
    const body = createBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    const head = await writeTx(async (tx) => {
      await assertNameFree(tx, companyId, body.name);
      const last = await tx.categoryHead.aggregate({ where: { companyId }, _max: { sortOrder: true } });
      const h = await tx.categoryHead.create({
        data: { companyId, name: body.name, sortOrder: (last._max.sortOrder ?? 0) + 1, createdById: actorId, updatedById: actorId },
        select,
      });
      await audit(tx, { companyId, actorId, action: "CATEGORY_HEAD_CREATE", entityType: "CategoryHead", entityId: h.id, after: h, requestId });
      return h;
    });
    res.status(201).json({ head: { ...head, builtIn: false, categoryCount: 0 } });
  });

  r.patch("/:id", requirePermission("category.write"), async (req, res) => {
    const body = updateBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    const head = await writeTx(async (tx) => {
      const before = await loadHead(tx, companyId, String(req.params.id));
      if (body.name) await assertNameFree(tx, companyId, body.name, before.id);
      const after = await tx.categoryHead.update({ where: { id: before.id }, data: { ...body, updatedById: actorId }, select });
      const action = body.active === false ? "CATEGORY_HEAD_DEACTIVATE" : body.active === true && !before.active ? "CATEGORY_HEAD_ACTIVATE" : "CATEGORY_HEAD_UPDATE";
      await audit(tx, { companyId, actorId, action, entityType: "CategoryHead", entityId: before.id, before, after, requestId });
      return after;
    });
    res.json({ head: { ...head, builtIn: false } });
  });

  return r;
}
