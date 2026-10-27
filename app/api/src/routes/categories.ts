import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, WRITE_TX, type Tx } from "../db.js";
import { audit } from "../lib/audit.js";
import { requirePermission } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { assertOwnImages } from "../lib/images.js";
import { categoryStats } from "../lib/catalog.js";
import { inCategory, PRODUCT_TYPE_KEY, setCategoryScope } from "../lib/category-heads.js";
import { costFor, groupInclude, imageUrl, isUniqueViolation, serializeGroup } from "../lib/products.js";

// Categories follow main v2: one optional category per product, active/inactive lifecycle,
// detail with product count, attach an existing product, detach a product. Never hard-deleted.
// V2 catalog browse: categories are listed in the owner's rail order (sort_order, then name).
// V3.1 (0033): categories belong to a head. Product Type (head_id NULL) keeps the rules above;
// a category of another head holds any number of products (links), and a product may be in many.

const name = z.string().trim().min(1).max(100);
const createBody = z.object({
  name,
  imageUrl,
  // Omitted / null = Product Type.
  headId: z.string().min(1).nullish().transform((v) => (v && v !== PRODUCT_TYPE_KEY ? v : null)),
});
const updateBody = z
  .object({ name: name.optional(), imageUrl: imageUrl.optional(), active: z.boolean().optional() })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Nothing to update");
// V3.1 (0038): one product with `variationIds` = only those variations (replacing the
// category's variations on it); without = the whole product.
const attachBody = z.union([
  z
    .object({ productId: z.string().min(1), variationIds: z.array(z.string().min(1)).min(1).max(500).optional() })
    .transform((b) => ({ productIds: [b.productId], variationIds: b.variationIds ? [...new Set(b.variationIds)] : undefined })),
  z
    .object({ productIds: z.array(z.string().min(1)).min(1).max(500) })
    .transform((b) => ({ productIds: [...new Set(b.productIds)], variationIds: undefined as string[] | undefined })),
]);
const listQuery = z.object({
  status: z.enum(["active", "all"]).default("active"),
  // V3.1: "product-type" (default), a head id, or "all" heads.
  headId: z.string().min(1).default(PRODUCT_TYPE_KEY),
  // stats=1 adds low / out / below-zero product counts and a cover image (category rail).
  stats: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});
const orderBody = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, "Each category may appear only once"),
});

const select = { id: true, name: true, headId: true, imageUrl: true, active: true, sortOrder: true, createdAt: true, updatedAt: true } as const;
const railOrder = [{ sortOrder: "asc" }, { name: "asc" }] as const;
const ctx = (req: Request) => ({ companyId: req.auth!.companyId, actorId: req.auth!.userId, requestId: req.requestId });

async function writeTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn, WRITE_TX);
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError(409, "CATEGORY_EXISTS", "A category with this name already exists");
    throw e;
  }
}

async function loadCategory(tx: Tx, companyId: string, id: string) {
  const c = await tx.category.findFirst({ where: { id, companyId }, select });
  if (!c) throw new AppError(404, "NOT_FOUND", "Category not found");
  return c;
}

async function assertNameFree(tx: Tx, companyId: string, headId: string | null, value: string, exceptId?: string) {
  const hit = await tx.category.findFirst({
    where: { companyId, headId, name: { equals: value, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (hit) throw new AppError(409, "CATEGORY_EXISTS", "A category with this name already exists");
}

/**
 * Active products per category, matching `inCategory`: Product Type by column; other heads by a
 * whole-product link, a link on an active variation, or (grouped) a by-product in the category.
 * `partial` = products in it only for some variations or through a set's parts.
 */
async function productCounts(companyId: string) {
  const rows = await prisma.$queryRaw<{ cid: string; products: bigint; partial: bigint }[]>`
    WITH own AS (
      SELECT pc.category_id AS cid, pc.product_id AS pid, false AS partial FROM product_categories pc WHERE pc.company_id = ${companyId}
      UNION ALL
      SELECT vc.category_id, vc.product_id, true FROM variation_categories vc
      JOIN product_variations v ON v.id = vc.variation_id
      WHERE vc.company_id = ${companyId} AND v.active
    ),
    links AS (
      SELECT g.category_id AS cid, g.id AS pid, false AS partial FROM product_groups g
      WHERE g.company_id = ${companyId} AND g.category_id IS NOT NULL
      UNION ALL SELECT cid, pid, partial FROM own
      UNION ALL
      SELECT own.cid, gb.group_id, true FROM group_byproducts gb JOIN own ON own.pid = gb.product_id
      WHERE gb.company_id = ${companyId} AND gb.active
    ),
    per AS (
      SELECT l.cid, l.pid, bool_and(l.partial) AS partial FROM links l
      JOIN product_groups g ON g.id = l.pid AND g.active
      GROUP BY l.cid, l.pid
    )
    SELECT cid, COUNT(*) AS products, COUNT(*) FILTER (WHERE partial) AS partial FROM per GROUP BY cid`;
  return new Map(rows.map((r) => [r.cid, { products: Number(r.products), partial: Number(r.partial) }]));
}

export function categoryRoutes() {
  const r = Router();

  // Counts are of active products, matching the catalog sidebar.
  r.get("/", requirePermission("catalog.view"), async (req, res) => {
    const { status, stats, headId } = listQuery.parse(req.query);
    const companyId = req.auth!.companyId;
    const head = headId === "all" ? {} : { headId: headId === PRODUCT_TYPE_KEY ? null : headId };
    const [categories, uncategorized, all, st, counts] = await Promise.all([
      prisma.category.findMany({
        where: { companyId, ...head, ...(status === "active" ? { active: true } : {}) },
        select,
        orderBy: [...railOrder],
      }),
      prisma.productGroup.count({ where: { companyId, active: true, categoryId: null } }),
      prisma.productGroup.count({ where: { companyId, active: true } }),
      stats ? categoryStats(companyId) : null,
      productCounts(companyId),
    ]);
    const stockOf = (id: string | null) => {
      const { lowCount, outCount, negativeCount } = st!.counts(id);
      return { lowCount, outCount, negativeCount };
    };
    res.json({
      categories: categories.map((c) => ({
        ...c,
        // A category counts by its head's rule: Product Type by column, others by link (whole
        // product, some variations, or a set through its parts — `partialCount` of them).
        productCount: counts.get(c.id)?.products ?? 0,
        partialCount: counts.get(c.id)?.partial ?? 0,
        ...(st ? { ...stockOf(c.id), coverImageUrl: c.imageUrl ?? st.covers.get(c.id) ?? null } : {}),
      })),
      uncategorizedCount: uncategorized,
      totalCount: all,
      ...(st
        ? {
            uncategorized: { productCount: uncategorized, ...stockOf(null) },
            all: { productCount: all, lowCount: st.all.lowCount, outCount: st.all.outCount, negativeCount: st.all.negativeCount },
          }
        : {}),
    });
  });

  // Rail order: the listed categories get positions 1..n in the given order; categories left out
  // keep their position. Registered before "/:id" so "order" is never read as an id.
  r.put("/order", requirePermission("category.write"), async (req, res) => {
    const { ids } = orderBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    const categories = await writeTx(async (tx) => {
      const found = await tx.category.findMany({ where: { companyId, id: { in: ids } }, select: { id: true, sortOrder: true } });
      if (found.length !== ids.length) throw new AppError(404, "NOT_FOUND", "Category not found");
      const before = new Map(found.map((c) => [c.id, c.sortOrder]));
      const changed = ids.flatMap((id, i) => (before.get(id) === i + 1 ? [] : [{ id, sortOrder: i + 1 }]));
      for (const c of changed) await tx.category.update({ where: { id: c.id }, data: { sortOrder: c.sortOrder, updatedById: actorId } });
      if (changed.length) {
        await audit(tx, {
          companyId,
          actorId,
          action: "CATEGORY_REORDER",
          entityType: "Category",
          before: { order: ids.map((id) => ({ id, sortOrder: before.get(id) })) },
          after: { order: ids.map((id, i) => ({ id, sortOrder: i + 1 })) },
          requestId,
        });
      }
      return tx.category.findMany({ where: { companyId }, select, orderBy: [...railOrder] });
    });
    res.json({ categories });
  });

  r.get("/:id", requirePermission("catalog.view"), async (req, res) => {
    const companyId = req.auth!.companyId;
    const category = await loadCategory(prisma, companyId, String(req.params.id));
    const products = await prisma.productGroup.findMany({
      where: { companyId, ...inCategory(category.id) },
      include: groupInclude,
      orderBy: { name: "asc" },
    });
    // V3.1 (0038): how each product is in it — whole product, some variations, or (a set) its parts.
    const scopeOf = (p: (typeof products)[number]) =>
      p.categoryId === category.id || p.categoryLinks.some((l) => l.category.id === category.id)
        ? ("all" as const)
        : p.variationCategoryLinks.some((l) => l.category.id === category.id)
          ? ("variations" as const)
          : ("parts" as const);
    res.json({
      category: { ...category, productCount: products.filter((p) => p.active).length },
      products: products.map((p) => ({ ...costFor(req.auth!.role, serializeGroup(p)), scope: scopeOf(p) })),
    });
  });

  r.post("/", requirePermission("category.write"), async (req, res) => {
    const body = createBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    const category = await writeTx(async (tx) => {
      if (body.headId) {
        const h = await tx.categoryHead.findFirst({ where: { id: body.headId, companyId }, select: { active: true } });
        if (!h) throw new AppError(404, "NOT_FOUND", "Category head not found");
        if (!h.active) throw new AppError(400, "INACTIVE_HEAD", "That category head is inactive");
      }
      await assertNameFree(tx, companyId, body.headId, body.name);
      await assertOwnImages(tx, companyId, [body.imageUrl]);
      // A new category goes to the end of its head's list.
      const last = await tx.category.aggregate({ where: { companyId, headId: body.headId }, _max: { sortOrder: true } });
      const sortOrder = (last._max.sortOrder ?? 0) + 1;
      const c = await tx.category.create({ data: { companyId, ...body, sortOrder, createdById: actorId, updatedById: actorId }, select });
      await audit(tx, { companyId, actorId, action: "CATEGORY_CREATE", entityType: "Category", entityId: c.id, after: c, requestId });
      return c;
    });
    res.status(201).json({ category });
  });

  r.patch("/:id", requirePermission("category.write"), async (req, res) => {
    const body = updateBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    const category = await writeTx(async (tx) => {
      const before = await loadCategory(tx, companyId, String(req.params.id));
      if (body.name) await assertNameFree(tx, companyId, before.headId, body.name, before.id);
      await assertOwnImages(tx, companyId, [body.imageUrl]);
      const after = await tx.category.update({ where: { id: before.id }, data: { ...body, updatedById: actorId }, select });
      const action = body.active === false ? "CATEGORY_DEACTIVATE" : body.active === true && !before.active ? "CATEGORY_ACTIVATE" : "CATEGORY_UPDATE";
      await audit(tx, { companyId, actorId, action, entityType: "Category", entityId: before.id, before, after, requestId });
      return after;
    });
    res.json({ category });
  });

  // Attach existing products. Product Type: moves each from its other category if it had one.
  // Another head: adds a link (the product keeps its other categories) for the whole product, or
  // (V3.1, 0038) only for the given variations of one Variable / Measured product.
  r.post("/:id/products", requirePermission("category.write"), async (req, res) => {
    const { productIds, variationIds } = attachBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    await writeTx(async (tx) => {
      const category = await loadCategory(tx, companyId, String(req.params.id));
      if (!category.active) throw new AppError(400, "INACTIVE_CATEGORY", "That category is inactive");
      if (variationIds && !category.headId) throw new AppError(400, "PRODUCT_TYPE_WHOLE", "A Product Type category applies to the whole product");
      const products = await tx.productGroup.findMany({
        where: { id: { in: productIds }, companyId },
        select: { id: true, categoryId: true, variationCategoryLinks: { where: { categoryId: category.id }, select: { variationId: true } } },
      });
      if (products.length !== productIds.length) throw new AppError(404, "NOT_FOUND", "Product not found");
      for (const product of products) {
        if (category.headId) {
          const changed = await setCategoryScope(tx, companyId, product.id, category.id, variationIds ?? "all", actorId);
          if (!changed) continue;
          await audit(tx, {
            companyId,
            actorId,
            action: "CATEGORY_ATTACH",
            entityType: "ProductGroup",
            entityId: product.id,
            before: product.variationCategoryLinks.length ? { categoryId: category.id, variationIds: product.variationCategoryLinks.map((l) => l.variationId) } : undefined,
            after: { categoryId: category.id, headId: category.headId, ...(variationIds ? { variationIds } : {}) },
            requestId,
          });
          continue;
        } else {
          if (product.categoryId === category.id) continue;
          await tx.productGroup.update({ where: { id: product.id }, data: { categoryId: category.id, updatedById: actorId } });
        }
        await audit(tx, {
          companyId,
          actorId,
          action: "CATEGORY_ATTACH",
          entityType: "ProductGroup",
          entityId: product.id,
          before: category.headId ? undefined : { categoryId: product.categoryId },
          after: { categoryId: category.id, headId: category.headId },
          requestId,
        });
      }
    });
    res.json({ ok: true });
  });

  r.delete("/:id/products/:productId", requirePermission("category.write"), async (req, res) => {
    const { companyId, actorId, requestId } = ctx(req);
    await writeTx(async (tx) => {
      const category = await loadCategory(tx, companyId, String(req.params.id));
      const productId = String(req.params.productId);
      if (category.headId) {
        // Whole product or its variations (0038); a set in it only through a part stays in it.
        const gone = await tx.productCategory.deleteMany({ where: { companyId, productId, categoryId: category.id } });
        const goneVariations = await tx.variationCategory.deleteMany({ where: { companyId, productId, categoryId: category.id } });
        if (!gone.count && !goneVariations.count) throw new AppError(404, "NOT_FOUND", "Product is not in this category (a set is in it through its parts)");
      } else {
        const product = await tx.productGroup.findFirst({ where: { id: productId, companyId }, select: { id: true, categoryId: true } });
        if (!product || product.categoryId !== category.id) throw new AppError(404, "NOT_FOUND", "Product is not in this category");
        await tx.productGroup.update({ where: { id: product.id }, data: { categoryId: null, updatedById: actorId } });
      }
      await audit(tx, {
        companyId,
        actorId,
        action: "CATEGORY_DETACH",
        entityType: "ProductGroup",
        entityId: productId,
        before: { categoryId: category.id, headId: category.headId },
        after: category.headId ? undefined : { categoryId: null },
        requestId,
      });
    });
    res.json({ ok: true });
  });

  // V3.1 (0038): takes one variation out of a category it is on by itself.
  r.delete("/:id/products/:productId/variations/:variationId", requirePermission("category.write"), async (req, res) => {
    const { companyId, actorId, requestId } = ctx(req);
    await writeTx(async (tx) => {
      const category = await loadCategory(tx, companyId, String(req.params.id));
      const productId = String(req.params.productId);
      const variationId = String(req.params.variationId);
      const gone = await tx.variationCategory.deleteMany({ where: { companyId, productId, variationId, categoryId: category.id } });
      if (!gone.count) throw new AppError(404, "NOT_FOUND", "Variation is not in this category by itself");
      await audit(tx, {
        companyId,
        actorId,
        action: "CATEGORY_DETACH",
        entityType: "ProductGroup",
        entityId: productId,
        before: { categoryId: category.id, headId: category.headId, variationIds: [variationId] },
        requestId,
      });
    });
    res.json({ ok: true });
  });

  return r;
}
