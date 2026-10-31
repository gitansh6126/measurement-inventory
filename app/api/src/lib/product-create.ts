import { Prisma } from "@prisma/client";
import type { AttributeDef } from "@rs-v31/shared";
import { repeatLabels } from "@rs-v31/shared/sets";
import type { Tx } from "../db.js";
import { audit } from "./audit.js";
import { addVariationCategories, setProductCategories } from "./category-heads.js";
import { AppError } from "./errors.js";
import { assertOwnImages } from "./images.js";
import {
  assertActiveCategory,
  assertBatchUnique,
  assertCodesFree,
  groupInclude,
  measureColumns,
  resolveVariation,
  serializeGroup,
  type GroupedBody,
  type PlainProductBody,
} from "./products.js";

export interface CreateCtx {
  companyId: string;
  actorId: string;
  requestId?: string;
}

/**
 * Creates a Simple, Variable or Measured product in the caller's transaction (POST /api/products,
 * and by-products / the main component created inside a grouped product).
 */
export async function createPlainProduct(tx: Tx, ctx: CreateCtx, body: PlainProductBody, opts: { ownerGroupId?: string } = {}) {
  const { companyId, actorId, requestId } = ctx;
  await assertActiveCategory(tx, companyId, body.categoryId);
  // Measured products use attributes and variations exactly like Variable ones (DM-1).
  const withVariations = body.productType === "variable" || body.productType === "measured";
  const defs: AttributeDef[] = withVariations ? body.attributes : [];
  const base = withVariations ? body.baseShortName : body.shortName;
  if (body.productType === "variable" && body.variations.some((v) => v.defaultRollLength)) {
    throw new AppError(400, "NOT_MEASURED", "Roll lengths apply to Measured products only");
  }
  const rows = withVariations
    ? body.variations.map((v) => resolveVariation(v, defs, base))
    : [{ attributes: {}, attributeKey: "", shortName: body.shortName, officialSku: body.officialSku ?? null, description: null, imageUrl: null }];
  assertBatchUnique(rows);
  await assertCodesFree(tx, companyId, rows);
  const primaryImage = body.imageUrl ?? (body.gallery && body.gallery.length > 0 ? body.gallery[0] : null);
  const galleryList = body.gallery && body.gallery.length > 0 ? body.gallery : primaryImage ? [primaryImage] : [];
  await assertOwnImages(tx, companyId, [primaryImage, ...galleryList, ...rows.map((r) => r.imageUrl)]);

  const created = await tx.productGroup.create({
    data: {
      companyId,
      name: body.name,
      productType: body.productType,
      baseShortName: base,
      description: body.description,
      unit: body.unit ?? "",
      ...(body.productType === "measured" ? await measureColumns(tx, companyId, body.measure) : {}),
      imageUrl: primaryImage,
      gallery: galleryList,
      specs: (body.specs ?? []) as unknown as Prisma.InputJsonValue,
      categoryId: body.categoryId,
      attributeDefinitions: defs as unknown as Prisma.InputJsonValue,
      ownerGroupId: opts.ownerGroupId ?? null,
      createdById: actorId,
      updatedById: actorId,
      variations: {
        create: rows.map((v, sortOrder) => ({ ...v, companyId, sortOrder, createdById: actorId, updatedById: actorId })),
      },
    },
  });
  if (body.categoryIds?.length) await setProductCategories(tx, companyId, created.id, body.categoryIds, actorId);
  // V3.1 (0038): categories on single variations, matched by attribute combination.
  if (withVariations && body.variations.some((v) => v.categoryIds?.length)) {
    const made = await tx.productVariation.findMany({ where: { groupId: created.id }, select: { id: true, attributeKey: true } });
    const idOf = new Map(made.map((v) => [v.attributeKey, v.id]));
    await addVariationCategories(
      tx,
      companyId,
      created.id,
      body.variations.map((v, i) => ({ variationId: idOf.get(rows[i]!.attributeKey)!, categoryIds: v.categoryIds ?? [] })),
      actorId,
    );
  }
  const group = await tx.productGroup.findUniqueOrThrow({ where: { id: created.id }, include: groupInclude });
  const out = serializeGroup(group);
  await audit(tx, { companyId, actorId, action: "PRODUCT_CREATE", entityType: "ProductGroup", entityId: group.id, after: out, requestId });
  return out;
}

/**
 * V3.1 grouped product (plan §2): one transaction creates the grouped product with its single
 * variation, its main component (always a new Simple product, owned by it), any by-products
 * created inline, and the by-product links.
 */
export async function createGroupedProduct(tx: Tx, ctx: CreateCtx, body: GroupedBody) {
  const { companyId, actorId, requestId } = ctx;
  await assertActiveCategory(tx, companyId, body.categoryId);
  const codes = [
    { shortName: body.shortName, officialSku: body.officialSku ?? null },
    { shortName: body.main.shortName, officialSku: body.main.officialSku ?? null },
  ];
  assertBatchUnique(codes.map((c, i) => ({ ...c, attributes: {}, attributeKey: String(i), description: null, imageUrl: null })));
  await assertCodesFree(tx, companyId, codes);
  const primaryImage = body.imageUrl ?? (body.gallery && body.gallery.length > 0 ? body.gallery[0] : null);
  const galleryList = body.gallery && body.gallery.length > 0 ? body.gallery : primaryImage ? [primaryImage] : [];
  await assertOwnImages(tx, companyId, [primaryImage, ...galleryList]);

  // 1. The grouped product and its one variation (set SKU, set price).
  const group = await tx.productGroup.create({
    data: {
      companyId,
      name: body.name,
      productType: "grouped",
      baseShortName: body.shortName,
      description: body.description,
      unit: body.unit,
      imageUrl: primaryImage,
      gallery: galleryList,
      specs: (body.specs ?? []) as unknown as Prisma.InputJsonValue,
      categoryId: body.categoryId,
      attributeDefinitions: [] as unknown as Prisma.InputJsonValue,
      createdById: actorId,
      updatedById: actorId,
      variations: {
        create: [{ companyId, attributes: {}, attributeKey: "", shortName: body.shortName, officialSku: body.officialSku ?? null, sortOrder: 0, createdById: actorId, updatedById: actorId }],
      },
    },
  });

  // 2. The main component: always new, always Simple, owned by the set (D2–D4).
  await createPlainProduct(
    tx,
    ctx,
    {
      productType: "simple",
      name: body.main.name,
      unit: body.main.unit,
      description: body.main.description,
      shortName: body.main.shortName,
      officialSku: body.main.officialSku,
      categoryId: body.categoryId,
      imageUrl: null,
    },
    { ownerGroupId: group.id },
  );

  // 3–4. By-products (existing or created inline) and their links. A product may repeat (two
  // chains in one hoist); each repeat is its own link with its own variation/length per set.
  const rows: { productId: string; required: boolean; label: string | null | undefined }[] = [];
  for (const b of body.byproducts) {
    let productId = b.productId;
    if (b.newProduct) {
      productId = (await createPlainProduct(tx, ctx, b.newProduct)).id;
    } else {
      const p = await tx.productGroup.findFirst({ where: { id: productId, companyId }, select: { name: true, productType: true, ownerGroupId: true, active: true } });
      if (!p) throw new AppError(404, "NOT_FOUND", "By-product not found");
      if (p.productType === "grouped") throw new AppError(400, "BYPRODUCT_GROUPED", `${p.name} is a grouped product; a set cannot contain another set`);
      if (p.ownerGroupId) throw new AppError(400, "BYPRODUCT_MAIN", `${p.name} is the main component of another set`);
      if (!p.active) throw new AppError(400, "BYPRODUCT_INACTIVE", `${p.name} is archived`);
    }
    rows.push({ productId: productId!, required: b.required, label: b.label });
  }
  const labels = repeatLabels(rows);
  for (const [sortOrder, b] of rows.entries()) {
    await tx.groupByproduct.create({ data: { companyId, groupId: group.id, productId: b.productId, label: labels[sortOrder], required: b.required, sortOrder, createdById: actorId } });
  }

  if (body.categoryIds?.length) await setProductCategories(tx, companyId, group.id, body.categoryIds, actorId);
  const out = serializeGroup(await tx.productGroup.findUniqueOrThrow({ where: { id: group.id }, include: groupInclude }));
  await audit(tx, { companyId, actorId, action: "GROUPED_PRODUCT_CREATED", entityType: "ProductGroup", entityId: group.id, after: out, requestId });
  return out;
}
