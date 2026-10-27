import { Prisma } from "@prisma/client";
import type { AttributeDef } from "@rs-v31/shared";
import { RATE_UNIT_LABEL, rateToDefault } from "@rs-v31/shared/measure";
import { Router, type Request } from "express";
import { z } from "zod";
import { prisma, WRITE_TX, type Tx } from "../db.js";
import { audit } from "../lib/audit.js";
import { requirePermission } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { assertOwnImages } from "../lib/images.js";
import { can } from "../lib/permissions.js";
import { bumpVersion, lockVersion } from "../lib/versions.js";
import {
  addVariationsBody,
  assertActiveCategory,
  assertAttributeEditSafe,
  assertBatchUnique,
  assertCodesFree,
  companyLengthSettings,
  costFor,
  createProductBody,
  groupInclude,
  isUniqueViolation,
  measureColumns,
  resolveVariation,
  serializeGroup,
  serializeVariation,
  updateProductBody,
  updateVariationBody,
} from "../lib/products.js";
import { createGroupedProduct, createPlainProduct } from "../lib/product-create.js";
import { deleteProduct, deleteVariation, renameAttribute, renameAttributeBody, unused, usageByVariation, usageText, variationUsage } from "../lib/product-corrections.js";
import { addVariationCategories, inCategory, setOneVariationCategories, setProductCategories, setVariationCategories } from "../lib/category-heads.js";

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: z.string().min(1).optional(),
  // "none" = products without a category.
  uncategorized: z.enum(["true", "false"]).optional(),
  status: z.enum(["active", "archived", "all"]).default("active"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

/** Runs a write, turning a lost uniqueness race into a 409 instead of a 500. */
async function writeTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(fn, WRITE_TX);
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError(409, "DUPLICATE", "Short Name, Official SKU or combination already exists");
    throw e;
  }
}

async function loadGroup(tx: Tx, companyId: string, id: string) {
  const g = await tx.productGroup.findFirst({ where: { id, companyId }, include: groupInclude });
  if (!g) throw new AppError(404, "NOT_FOUND", "Product not found");
  return g;
}

const ctx = (req: Request) => ({ companyId: req.auth!.companyId, actorId: req.auth!.userId, requestId: req.requestId });

export function productRoutes() {
  const r = Router();

  r.get("/", requirePermission("catalog.view"), async (req, res) => {
    const q = listQuery.parse(req.query);
    const companyId = req.auth!.companyId;
    const where: Prisma.ProductGroupWhereInput = {
      companyId,
      // V3.1: a grouped product's main component is shown inside its set, never on its own.
      ownerGroupId: null,
      ...(q.status === "all" ? {} : { active: q.status === "active" }),
      ...(q.uncategorized === "true" ? { categoryId: null } : {}),
      AND: [
        // V3.1: a category of any head (Product Type or a link).
        ...(q.categoryId ? [inCategory(q.categoryId)] : []),
        ...(q.q
          ? [
              {
                OR: [
                  { name: { contains: q.q, mode: "insensitive" } },
                  { variations: { some: { shortName: { contains: q.q, mode: "insensitive" } } } },
                  { variations: { some: { officialSku: { contains: q.q, mode: "insensitive" } } } },
                ],
              } satisfies Prisma.ProductGroupWhereInput,
            ]
          : []),
      ],
    };
    const [total, groups] = await prisma.$transaction([
      prisma.productGroup.count({ where }),
      prisma.productGroup.findMany({
        where,
        include: groupInclude,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    res.json({ products: groups.map((g) => costFor(req.auth!.role, serializeGroup(g))), total, page: q.page, pageSize: q.pageSize });
  });

  r.get("/:id", requirePermission("catalog.view"), async (req, res) => {
    const g = await loadGroup(prisma, req.auth!.companyId, String(req.params.id));
    res.json({ product: costFor(req.auth!.role, serializeGroup(g)) });
  });

  r.post("/", requirePermission("product.write"), async (req, res) => {
    const body = createProductBody.parse(req.body);
    const product = await writeTx((tx) =>
      body.productType === "grouped" ? createGroupedProduct(tx, ctx(req), body) : createPlainProduct(tx, ctx(req), body),
    );
    res.status(201).json({ product });
  });

  r.patch("/:id", requirePermission("product.write"), async (req, res) => {
    const body = updateProductBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    if (body.active !== undefined && !can(req.auth!.role, "product.archive")) {
      throw new AppError(403, "FORBIDDEN", "Only an admin can archive or restore products");
    }
    const product = await writeTx(async (tx) => {
      await lockVersion(tx, "productGroup", companyId, String(req.params.id), body.version, "This product");
      const before = await loadGroup(tx, companyId, String(req.params.id));
      // A grouped product has one variation (set SKU, set price), edited like a Simple product.
      const isSimple = before.productType === "simple" || before.productType === "grouped";
      if (before.ownerGroupId && body.active !== undefined) {
        throw new AppError(400, "MAIN_FOLLOWS_SET", "A set's main component is archived or restored with its grouped product");
      }
      const isMeasured = before.productType === "measured";
      if (isSimple && (body.attributes || body.baseShortName)) {
        throw new AppError(400, "NOT_VARIABLE", "Attributes apply to Variable products only");
      }
      if (!isMeasured && body.measure) throw new AppError(400, "NOT_MEASURED", "Length settings apply to Measured products only");
      if (isMeasured && body.unit !== undefined && body.unit !== before.unit) {
        throw new AppError(400, "UNIT_FROM_LENGTH", "A measured product's unit follows its length unit");
      }
      // DM-8 allows changing metres ↔ feet + inches with every roll and rate converted. Until that
      // conversion is built, the unit can change only while the product has no stock history.
      if (isMeasured && body.measure?.lengthUnit && body.measure.lengthUnit !== before.lengthUnit) {
        const history = await tx.stockMovement.count({ where: { companyId, variation: { groupId: before.id } } });
        if (history) {
          throw new AppError(409, "UNIT_CHANGE_NOT_AVAILABLE", "This product already has stock; changing its length unit (with conversion of every roll) is not available yet");
        }
        // Rates are per the rate unit (per m / per ft, 0028): convert them to the new one.
        if (before.lengthUnit) {
          const from = RATE_UNIT_LABEL[before.lengthUnit];
          const to = body.measure.lengthUnit;
          const conv = (d: Prisma.Decimal) => String(rateToDefault(Number(d), from, to));
          const vars = await tx.productVariation.findMany({ where: { companyId, groupId: before.id }, select: { id: true, salePrice: true, minSalePrice: true, purchaseCost: true } });
          for (const v of vars) {
            await tx.productVariation.update({ where: { id: v.id }, data: { salePrice: conv(v.salePrice), minSalePrice: conv(v.minSalePrice), purchaseCost: conv(v.purchaseCost) } });
          }
          const rates = await tx.vendorPrice.findMany({ where: { companyId, variation: { groupId: before.id } }, select: { id: true, rate: true } });
          for (const r of rates) {
            await tx.vendorPrice.update({ where: { id: r.id }, data: { rate: String(Math.max(1, rateToDefault(Number(r.rate), from, to))) } });
          }
        }
      }
      if (!isSimple && (body.shortName || body.officialSku !== undefined)) {
        throw new AppError(400, "USE_VARIATION", "Edit a variation's Short Name or Official SKU on the variation itself");
      }
      if (body.categoryId !== undefined && body.categoryId !== before.categoryId) {
        await assertActiveCategory(tx, companyId, body.categoryId);
      }
      await assertOwnImages(tx, companyId, [body.imageUrl, ...(body.gallery ?? [])]);
      if (body.attributes) {
        assertAttributeEditSafe(before.attributeDefinitions as unknown as AttributeDef[], body.attributes, before.variations);
      }

      if (isSimple && (body.shortName || body.officialSku !== undefined)) {
        const v = before.variations[0]!;
        const shortName = body.shortName ?? v.shortName;
        const officialSku = body.officialSku === undefined ? v.officialSku : body.officialSku;
        await assertCodesFree(tx, companyId, [{ shortName, officialSku }], v.id);
        await tx.productVariation.update({ where: { id: v.id }, data: { shortName, officialSku, updatedById: actorId, ...bumpVersion } });
      }
      if (body.categoryIds !== undefined) await setProductCategories(tx, companyId, before.id, body.categoryIds, actorId);
      // V3.1 (0038): after the whole-product links, so a category can move between the two scopes.
      if (body.variationCategories !== undefined) await setVariationCategories(tx, companyId, before.id, body.variationCategories, actorId);
      await tx.productGroup.update({
        where: { id: before.id },
        data: {
          name: body.name,
          unit: isMeasured ? undefined : body.unit,
          description: body.description,
          ...(isMeasured && body.measure
            ? {
                ...(body.measure.lengthUnit
                  ? {
                      lengthUnit: body.measure.lengthUnit,
                      unit: body.measure.lengthUnit === "m" ? "m" : "in",
                      // Decimals and scrap-below follow the company setting of the (new) unit.
                      ...(await companyLengthSettings(tx, companyId, body.measure.lengthUnit)),
                    }
                  : {}),
                ...(body.measure.rollName !== undefined ? { rollName: body.measure.rollName } : {}),
                ...(body.measure.defaultRollLength !== undefined ? { defaultRollLength: body.measure.defaultRollLength } : {}),
              }
            : {}),
          imageUrl: body.imageUrl !== undefined ? body.imageUrl : (body.gallery !== undefined ? (body.gallery.length > 0 ? body.gallery[0] : null) : undefined),
          gallery: body.gallery !== undefined ? body.gallery : undefined,
          categoryId: body.categoryId,
          active: body.active,
          // A Simple product's base follows its Short Name.
          baseShortName: isSimple ? body.shortName : body.baseShortName,
          attributeDefinitions: body.attributes as unknown as Prisma.InputJsonValue | undefined,
          updatedById: actorId,
          ...bumpVersion,
        },
      });
      // V3.1: archiving / restoring a grouped product does the same to its main component.
      if (before.productType === "grouped" && body.active !== undefined) {
        await tx.productGroup.updateMany({ where: { companyId, ownerGroupId: before.id }, data: { active: body.active, updatedById: actorId } });
      }
      const after = serializeGroup(await loadGroup(tx, companyId, before.id));
      const action = body.active === false ? "PRODUCT_ARCHIVE" : body.active === true && !before.active ? "PRODUCT_RESTORE" : "PRODUCT_UPDATE";
      await audit(tx, { companyId, actorId, action, entityType: "ProductGroup", entityId: before.id, before: serializeGroup(before), after, requestId });
      return after;
    });
    res.json({ product });
  });

  r.post("/:id/variations", requirePermission("product.write"), async (req, res) => {
    const body = addVariationsBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    const product = await writeTx(async (tx) => {
      const g = await loadGroup(tx, companyId, String(req.params.id));
      if (g.productType === "simple" || g.productType === "grouped") throw new AppError(400, "NOT_VARIABLE", "This product has exactly one variation");
      if (g.productType !== "measured" && body.variations.some((v) => v.defaultRollLength)) {
        throw new AppError(400, "NOT_MEASURED", "Roll lengths apply to Measured products only");
      }
      const defs = g.attributeDefinitions as unknown as AttributeDef[];
      const rows = body.variations.map((v) => resolveVariation(v, defs, g.baseShortName));
      assertBatchUnique(rows);
      const existing = new Set(g.variations.map((v) => v.attributeKey));
      for (const r of rows) {
        if (existing.has(r.attributeKey)) {
          throw new AppError(409, "DUPLICATE_COMBINATION", `This combination already exists: ${Object.values(r.attributes).join(" / ")}`);
        }
      }
      await assertCodesFree(tx, companyId, rows);
      await assertOwnImages(tx, companyId, rows.map((r) => r.imageUrl));
      const last = await tx.productVariation.aggregate({ where: { groupId: g.id }, _max: { sortOrder: true } });
      const startOrder = (last._max.sortOrder ?? -1) + 1;
      await tx.productVariation.createMany({
        data: rows.map((v, i) => ({
          ...v,
          companyId,
          groupId: g.id,
          sortOrder: startOrder + i,
          createdById: actorId,
          updatedById: actorId,
        })),
      });
      // V3.1 (0038): categories on the new variations only (VC3), matched by attribute combination.
      if (body.variations.some((v) => v.categoryIds?.length)) {
        const made = await tx.productVariation.findMany({ where: { groupId: g.id }, select: { id: true, attributeKey: true } });
        const idOf = new Map(made.map((v) => [v.attributeKey, v.id]));
        await addVariationCategories(
          tx,
          companyId,
          g.id,
          body.variations.map((v, i) => ({ variationId: idOf.get(rows[i]!.attributeKey)!, categoryIds: v.categoryIds ?? [] })),
          actorId,
        );
      }
      const after = serializeGroup(await loadGroup(tx, companyId, g.id));
      const created = after.variations.filter((v) => !g.variations.some((o) => o.id === v.id));
      await audit(tx, { companyId, actorId, action: "VARIATION_CREATE", entityType: "ProductGroup", entityId: g.id, after: created, requestId });
      return after;
    });
    res.status(201).json({ product });
  });

  r.put("/:id/variations/order", requirePermission("product.write"), async (req, res) => {
    const body = z.object({ variationIds: z.array(z.string().min(1)).min(1).max(500) }).parse(req.body);
    if (new Set(body.variationIds).size !== body.variationIds.length) {
      throw new AppError(400, "INVALID_ORDER", "Each variation must appear exactly once");
    }
    const { companyId, actorId, requestId } = ctx(req);
    const order = await writeTx(async (tx) => {
      const groupId = String(req.params.id);
      await tx.$queryRaw`SELECT id FROM product_groups WHERE id = ${groupId} AND company_id = ${companyId} FOR UPDATE`;
      const group = await loadGroup(tx, companyId, groupId);
      const currentIds = group.variations.map((v) => v.id);
      if (
        currentIds.length !== body.variationIds.length ||
        currentIds.some((id) => !body.variationIds.includes(id))
      ) {
        throw new AppError(409, "VARIATIONS_CHANGED", "The product's variations changed; reload before reordering");
      }
      const before = group.variations.map((v) => ({ id: v.id, sortOrder: v.sortOrder }));
      for (const [sortOrder, id] of body.variationIds.entries()) {
        await tx.productVariation.update({ where: { id }, data: { sortOrder, updatedById: actorId } });
      }
      const after = body.variationIds.map((id, sortOrder) => ({ id, sortOrder }));
      await audit(tx, {
        companyId,
        actorId,
        action: "VARIATION_REORDER",
        entityType: "ProductGroup",
        entityId: groupId,
        before: { order: before },
        after: { order: after },
        requestId,
      });
      return after;
    });
    res.json({ order });
  });

  r.patch("/:id/variations/:variationId", requirePermission("product.write"), async (req, res) => {
    const body = updateVariationBody.parse(req.body);
    const { companyId, actorId, requestId } = ctx(req);
    if (body.active !== undefined && !can(req.auth!.role, "product.archive")) {
      throw new AppError(403, "FORBIDDEN", "Only an admin can archive or restore variations");
    }
    const variation = await writeTx(async (tx) => {
      await lockVersion(tx, "productVariation", companyId, String(req.params.variationId), body.version, "This variation");
      const g = await loadGroup(tx, companyId, String(req.params.id));
      const before = g.variations.find((v) => v.id === String(req.params.variationId));
      if (!before) throw new AppError(404, "NOT_FOUND", "Variation not found");
      if (g.productType !== "measured" && body.defaultRollLength !== undefined) {
        throw new AppError(400, "NOT_MEASURED", "Roll lengths apply to Measured products only");
      }
      if (g.productType === "simple" && body.active !== undefined) {
        throw new AppError(400, "ARCHIVE_PRODUCT", "Archive the product itself; a Simple product has one variation");
      }
      if (body.active === false && before.active && g.variations.filter((v) => v.active).length === 1) {
        throw new AppError(409, "LAST_VARIATION", "This is the last active variation; archive the product instead");
      }
      const shortName = body.shortName ?? before.shortName;
      const officialSku = body.officialSku === undefined ? before.officialSku : body.officialSku;
      await assertCodesFree(tx, companyId, [{ shortName, officialSku }], before.id);
      await assertOwnImages(tx, companyId, [body.imageUrl]);
      const after = await tx.productVariation.update({
        where: { id: before.id },
        data: { shortName, officialSku, description: body.description, imageUrl: body.imageUrl, active: body.active, defaultRollLength: body.defaultRollLength, updatedById: actorId, ...bumpVersion },
      });
      // V3.1 (0038): this variation's own categories of other heads.
      const categoriesBefore = g.variationCategoryLinks.filter((l) => l.variationId === before.id).map((l) => l.category.id);
      let categoryIds = categoriesBefore;
      if (body.categoryIds !== undefined) {
        await setOneVariationCategories(tx, companyId, g.id, before.id, body.categoryIds, actorId);
        categoryIds = body.categoryIds;
      }
      const action = body.active === false ? "VARIATION_ARCHIVE" : body.active === true && !before.active ? "VARIATION_RESTORE" : "VARIATION_UPDATE";
      await audit(tx, {
        companyId,
        actorId,
        action,
        entityType: "ProductVariation",
        entityId: before.id,
        before: { ...serializeVariation(before), categoryIds: categoriesBefore },
        after: { ...serializeVariation(after), categoryIds },
        requestId,
      });
      return { ...serializeVariation(after), categoryIds };
    });
    res.json({ variation });
  });

  // Corrections (docs\CORRECTIONS-AUDIT-2026-10-27.md): rename an attribute or value; delete
  // what was never used. Anything used keeps Archive.
  r.post("/:id/attributes/rename", requirePermission("product.write"), async (req, res) => {
    const body = renameAttributeBody.parse(req.body);
    const result = await writeTx((tx) => renameAttribute(tx, ctx(req), String(req.params.id), body));
    const product = serializeGroup(await loadGroup(prisma, req.auth!.companyId, String(req.params.id)));
    res.json({ ...result, product: costFor(req.auth!.role, product) });
  });

  r.get("/:id/usage", requirePermission("product.write"), async (req, res) => {
    const companyId = req.auth!.companyId;
    const g = await prisma.productGroup.findFirst({ where: { id: String(req.params.id), companyId }, select: { id: true, variations: { select: { id: true } }, mainComponent: { select: { id: true, variations: { select: { id: true } } } } } });
    if (!g) throw new AppError(404, "NOT_FOUND", "Product not found");
    const own = g.variations.map((v) => v.id);
    const byVariation = await usageByVariation(prisma, companyId, [...own, ...(g.mainComponent?.variations.map((v) => v.id) ?? [])]);
    const total = await variationUsage(prisma, companyId, [...byVariation.keys()]);
    const [sets, setOf] = await Promise.all([
      prisma.groupSet.count({ where: { companyId, groupId: { in: [g.id, ...(g.mainComponent ? [g.mainComponent.id] : [])] } } }),
      prisma.groupByproduct.count({ where: { companyId, productId: g.id } }),
    ]);
    const productUsage = { ...total, sets: total.sets + sets };
    res.json({
      product: { unused: unused(productUsage) && setOf === 0, usage: setOf ? "a by-product of a set" : usageText(productUsage) },
      variations: own.map((id) => ({ id, unused: unused(byVariation.get(id)!), usage: usageText(byVariation.get(id)!) })),
    });
  });

  r.delete("/:id", requirePermission("product.write"), async (req, res) => {
    res.json(await writeTx((tx) => deleteProduct(tx, ctx(req), String(req.params.id))));
  });

  r.delete("/:id/variations/:variationId", requirePermission("product.write"), async (req, res) => {
    const result = await writeTx((tx) => deleteVariation(tx, ctx(req), String(req.params.id), String(req.params.variationId)));
    const product = serializeGroup(await loadGroup(prisma, req.auth!.companyId, String(req.params.id)));
    res.json({ ...result, product: costFor(req.auth!.role, product) });
  });

  return r;
}
