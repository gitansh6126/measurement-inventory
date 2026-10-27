import { z } from "zod";
import { Prisma } from "@prisma/client";
import type { Tx } from "../db.js";
import { AppError } from "./errors.js";

// V3.1 category heads (0033). The built-in head "Product Type" has no row: its categories have
// head_id NULL and a product has at most one of them (product_groups.category_id). Categories of
// any other head are links (product_categories), any number per product.
// V3.1 (0038, docs\VARIATION-CATEGORIES-V3-PLAN.md): a category of another head applies to the whole
// product (product_categories) or only to chosen variations (variation_categories), never both.
// A grouped product is also in a category of another head through its by-products (G-A).

export const PRODUCT_TYPE_HEAD = { id: null, name: "Product Type", builtIn: true } as const;

/** `headId=product-type` (or no headId) selects the built-in head. */
export const PRODUCT_TYPE_KEY = "product-type";

/** Category ids of other heads on a product create / edit (replaces the product's links). */
export const categoryIdsInput = z
  .array(z.string().min(1))
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, "Each category may appear only once")
  .optional();

/** Variation-only categories on a product edit: one entry per category, replaces them all. */
export const variationCategoriesInput = z
  .array(z.object({ categoryId: z.string().min(1), variationIds: z.array(z.string().min(1)).max(500) }))
  .max(100)
  .refine((rows) => new Set(rows.map((r) => r.categoryId)).size === rows.length, "Each category may appear only once")
  .optional();
export type VariationCategoriesInput = NonNullable<z.infer<typeof variationCategoriesInput>>;

/**
 * Products in a category of any head: Product Type by category_id, other heads by a whole-product
 * link, a link on an active variation, or (grouped, G-A) a by-product in it at either level.
 */
export function inCategory(categoryId: string): Prisma.ProductGroupWhereInput {
  const ownLinks: Prisma.ProductGroupWhereInput[] = [
    { categoryLinks: { some: { categoryId } } },
    { variationCategoryLinks: { some: { categoryId, variation: { active: true } } } },
  ];
  return {
    OR: [{ categoryId }, ...ownLinks, { productType: "grouped", byproducts: { some: { active: true, product: { OR: ownLinks } } } }],
  };
}

/**
 * SQL: the variation whose id is `variationId` is in the category at either level (its product's
 * Product Type, a whole-product link, or its own link).
 */
export function variationInCategorySql(variationId: Prisma.Sql, categoryId: string) {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM product_variations cv JOIN product_groups cg ON cg.id = cv.group_id
    WHERE cv.id = ${variationId} AND (
      cg.category_id = ${categoryId}
      OR EXISTS (SELECT 1 FROM product_categories cpc WHERE cpc.product_id = cg.id AND cpc.category_id = ${categoryId})
      OR EXISTS (SELECT 1 FROM variation_categories cvc WHERE cvc.variation_id = cv.id AND cvc.category_id = ${categoryId})))`;
}

/** SQL twin of `inCategory` for the product whose id is `productId`. */
export function productInCategorySql(productId: Prisma.Sql, categoryId: string) {
  const own = (id: Prisma.Sql) => Prisma.sql`(
    EXISTS (SELECT 1 FROM product_categories ppc WHERE ppc.product_id = ${id} AND ppc.category_id = ${categoryId})
    OR EXISTS (SELECT 1 FROM variation_categories pvc JOIN product_variations pv ON pv.id = pvc.variation_id
               WHERE pvc.product_id = ${id} AND pvc.category_id = ${categoryId} AND pv.active))`;
  return Prisma.sql`(
    EXISTS (SELECT 1 FROM product_groups pg0 WHERE pg0.id = ${productId} AND pg0.category_id = ${categoryId})
    OR ${own(productId)}
    OR EXISTS (SELECT 1 FROM group_byproducts gb WHERE gb.group_id = ${productId} AND gb.active AND ${own(Prisma.sql`gb.product_id`)}))`;
}

/** Categories being added to a product or variation: active, of a head other than Product Type. */
async function assertOtherHeadCategories(tx: Tx, companyId: string, ids: readonly string[]) {
  if (!ids.length) return;
  const found = await tx.category.findMany({
    where: { companyId, id: { in: [...ids] } },
    select: { id: true, headId: true, active: true, head: { select: { active: true } } },
  });
  if (found.length !== new Set(ids).size) throw new AppError(400, "UNKNOWN_CATEGORY", "Category not found");
  for (const c of found) {
    if (!c.headId) throw new AppError(400, "PRODUCT_TYPE_CATEGORY", "Product Type is chosen with the product's category, not with the other heads");
    if (!c.active || !c.head?.active) throw new AppError(400, "INACTIVE_CATEGORY", "That category is inactive");
  }
}

/**
 * Checks that every id is an active category of a head other than Product Type (inactive ones
 * already on the product may stay), then replaces the product's links. Returns true when changed.
 */
export async function setProductCategories(tx: Tx, companyId: string, productId: string, ids: readonly string[], actorId: string) {
  const current = await tx.productCategory.findMany({ where: { companyId, productId }, select: { categoryId: true } });
  const have = new Set(current.map((c) => c.categoryId));
  const added = ids.filter((id) => !have.has(id));
  await assertOtherHeadCategories(tx, companyId, added);
  const keep = new Set(ids);
  const removed = [...have].filter((id) => !keep.has(id));
  if (removed.length) await tx.productCategory.deleteMany({ where: { companyId, productId, categoryId: { in: removed } } });
  if (added.length) {
    // VC2: "All variations" replaces that category's variation links.
    await tx.variationCategory.deleteMany({ where: { companyId, productId, categoryId: { in: added } } });
    await tx.productCategory.createMany({ data: added.map((categoryId) => ({ companyId, productId, categoryId, createdById: actorId })) });
  }
  return added.length > 0 || removed.length > 0;
}

/**
 * Adds variation links (VC2–VC5): only on a Variable / Measured product's own variations, for
 * active categories of other heads that do not already apply to the whole product. Existing links
 * are kept. Returns true when a link was added.
 */
export async function addVariationCategories(
  tx: Tx,
  companyId: string,
  productId: string,
  rows: readonly { variationId: string; categoryIds: readonly string[] }[],
  actorId: string,
) {
  const wanted = rows.flatMap((r) => r.categoryIds.map((categoryId) => ({ variationId: r.variationId, categoryId })));
  if (!wanted.length) return false;
  const product = await tx.productGroup.findFirst({
    where: { id: productId, companyId },
    select: {
      productType: true,
      variations: { select: { id: true } },
      categoryLinks: { select: { categoryId: true } },
      variationCategoryLinks: { select: { variationId: true, categoryId: true } },
    },
  });
  if (!product) throw new AppError(404, "NOT_FOUND", "Product not found");
  if (product.productType !== "variable" && product.productType !== "measured") {
    throw new AppError(400, "NOT_VARIABLE", "Only a Variable or Measured product has categories per variation");
  }
  const own = new Set(product.variations.map((v) => v.id));
  if (wanted.some((w) => !own.has(w.variationId))) throw new AppError(404, "NOT_FOUND", "Variation not found");
  const whole = new Set(product.categoryLinks.map((c) => c.categoryId));
  if (wanted.some((w) => whole.has(w.categoryId))) {
    throw new AppError(400, "VARIATION_CATEGORY_WHOLE_PRODUCT", "That category already applies to all variations of this product");
  }
  const have = new Set(product.variationCategoryLinks.map((l) => `${l.variationId}|${l.categoryId}`));
  const used = new Set(product.variationCategoryLinks.map((l) => l.categoryId));
  const fresh = wanted.filter((w) => !have.has(`${w.variationId}|${w.categoryId}`));
  if (!fresh.length) return false;
  // A category already on another variation of this product may be extended even if since retired.
  await assertOtherHeadCategories(tx, companyId, [...new Set(fresh.map((w) => w.categoryId))].filter((id) => !used.has(id)));
  await tx.variationCategory.createMany({ data: fresh.map((w) => ({ ...w, productId, companyId, createdById: actorId })) });
  return true;
}

/** Replaces every variation link of a product (product form). */
export async function setVariationCategories(tx: Tx, companyId: string, productId: string, links: VariationCategoriesInput, actorId: string) {
  const current = await tx.variationCategory.findMany({ where: { companyId, productId }, select: { variationId: true, categoryId: true } });
  const keep = new Set(links.flatMap((l) => l.variationIds.map((v) => `${v}|${l.categoryId}`)));
  const gone = current.filter((c) => !keep.has(`${c.variationId}|${c.categoryId}`));
  for (const g of gone) await tx.variationCategory.delete({ where: { variationId_categoryId: g } });
  const byVariation = new Map<string, string[]>();
  for (const l of links) for (const v of l.variationIds) byVariation.set(v, [...(byVariation.get(v) ?? []), l.categoryId]);
  const added = await addVariationCategories(
    tx,
    companyId,
    productId,
    [...byVariation].map(([variationId, categoryIds]) => ({ variationId, categoryIds })),
    actorId,
  );
  return added || gone.length > 0;
}

/**
 * Category page: puts one product in a category of another head for all its variations, or only
 * for the given ones (VC2). Returns true when something changed.
 */
export async function setCategoryScope(
  tx: Tx,
  companyId: string,
  productId: string,
  categoryId: string,
  scope: "all" | readonly string[],
  actorId: string,
) {
  const whole = await tx.productCategory.findUnique({ where: { productId_categoryId: { productId, categoryId } } });
  if (scope === "all") {
    if (whole) return false;
    await tx.variationCategory.deleteMany({ where: { companyId, productId, categoryId } });
    await tx.productCategory.create({ data: { companyId, productId, categoryId, createdById: actorId } });
    return true;
  }
  if (whole) await tx.productCategory.delete({ where: { productId_categoryId: { productId, categoryId } } });
  const gone = await tx.variationCategory.deleteMany({ where: { companyId, productId, categoryId, variationId: { notIn: [...scope] } } });
  const added = await addVariationCategories(tx, companyId, productId, scope.map((variationId) => ({ variationId, categoryIds: [categoryId] })), actorId);
  return !!whole || gone.count > 0 || added;
}

/** Replaces one variation's own links (variation edit). */
export async function setOneVariationCategories(tx: Tx, companyId: string, productId: string, variationId: string, ids: readonly string[], actorId: string) {
  const gone = await tx.variationCategory.deleteMany({ where: { companyId, variationId, categoryId: { notIn: [...ids] } } });
  const added = await addVariationCategories(tx, companyId, productId, [{ variationId, categoryIds: ids }], actorId);
  return added || gone.count > 0;
}
