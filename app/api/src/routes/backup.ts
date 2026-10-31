import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import express, { Router, type RequestHandler } from "express";
import AdmZip from "adm-zip";
import { prisma } from "../db.js";
import { audit } from "../lib/audit.js";
import { setTypeKey } from "../lib/set-types.js";
import { requirePermission } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { recalculateAllProductActivity } from "../lib/product-activity.js";
import { readServerBackupStatus } from "../lib/server-backup-status.js";
import type { Env } from "../env.js";

// Backup format versions: "1.0" = V1 (no voids/drafts/supplier prices, no V2 columns);
// "2.0" = V2. A V2 server restores both; a 1.0 archive is uplifted with safe defaults
// (V2 plan §1.9, PRE-HOSTING-CHECKLIST).
export const BACKUP_VERSION = "2.0" as const;

export interface RSBackupManifest {
  format: "RS_INVENTORY_ZIP_BACKUP";
  backupVersion: "1.0" | "2.0";
  exportTimestamp: string;
  appVersion: string;
  environment: string;
  /** "per_rate_unit" (0028): feet + inches rates are per ft. Absent: they are per inch. */
  rateUnits?: "per_rate_unit";
  company: {
    id: string;
    name: string;
  };
  recordCounts: {
    categories: number;
    parties: number;
    productGroups: number;
    productVariations: number;
    documentCounters: number;
    sales: number;
    saleLines: number;
    purchases: number;
    purchaseLines: number;
    stockMovements: number;
    images: number;
    users?: number;
    documentVoids?: number;
    draftOrders?: number;
    orders?: number;
    vendorPrices?: number;
    vendorPriceHistory?: number;
    measurementPieces?: number;
    measurementPieceLedger?: number;
  };
  imageMappings: {
    id: string;
    archivePath: string;
    originalKey: string;
    mimeType: string;
    bytes: number;
    sha256: string;
  }[];
}

export interface RSInventoryData {
  categories: any[];
  parties: any[];
  productGroups: any[];
  productVariations: any[];
  documentCounters: any[];
  sales: any[];
  saleLines: any[];
  purchases: any[];
  purchaseLines: any[];
  stockMovements: any[];
  images: any[];
  users?: any[];
  // V2 only (absent in 1.0 archives).
  documentVoids?: any[];
  draftOrders?: any[];
  // Sale / purchase orders with their lines and events (0014_orders); absent in older archives.
  orders?: any[];
  vendorPrices?: any[];
  vendorPriceHistory?: any[];
  // V2 measured stock (0020): one row per roll and its append-only history.
  measurementPieces?: any[];
  measurementPieceLedger?: any[];
  // V3.1 grouped products / sets (0031); absent in older archives.
  groupByproducts?: any[];
  groupSets?: any[];
  groupSetParts?: any[];
  groupSetPartChanges?: any[];
  // Set types / standard sets with their prices (0041); absent in older archives.
  groupSetTypes?: any[];
  // V3.1 category heads and product ↔ category links (0033); absent in older archives.
  categoryHeads?: any[];
  productCategories?: any[];
  variationCategories?: any[];
  // V3.1 warehouses and shifts (0035); absent in older archives, which restore warehousing-off.
  warehouses?: any[];
  stockTransfers?: any[];
  stockTransferVoids?: any[];
  warehousingEnabled?: boolean;
  // Company length settings for Measured products (0029); absent in older archives.
  companySettings?: {
    lengthDecimalsM: number;
    scrapBelowM: unknown;
    lengthDecimalsFtIn: number;
    scrapBelowFtIn: unknown;
  };
}

// Tables every archive since V1 carries; the rest are optional (absent in older archives).
const REQUIRED_TABLES = [
  "categories", "parties", "productGroups", "productVariations", "documentCounters",
  "sales", "saleLines", "purchases", "purchaseLines", "stockMovements", "images",
] as const;
const OPTIONAL_TABLES = [
  "users", "documentVoids", "draftOrders", "orders", "vendorPrices", "vendorPriceHistory",
  "measurementPieces", "measurementPieceLedger", "groupByproducts", "groupSets", "groupSetParts",
  "groupSetPartChanges", "categoryHeads", "productCategories", "variationCategories", "warehouses",
  "stockTransfers", "stockTransferVoids", "groupSetTypes",
] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Audit H1: restore deletes every company table before inserting the archive, so anything that is
 * not a real backup must be refused first. Each required table must be an array; optional tables,
 * when present, too. Throws 400 INVALID_FORMAT; nothing has been written when it does.
 */
export function validateInventoryData(data: unknown): asserts data is RSInventoryData {
  const bad = (detail: string) => new AppError(400, "INVALID_FORMAT", "File is not a valid RS Inventory backup", { detail });
  if (!isRecord(data)) throw bad("inventory data is not an object");
  for (const key of REQUIRED_TABLES) if (!Array.isArray(data[key])) throw bad(`"${key}" is missing or not a list`);
  for (const key of OPTIONAL_TABLES) if (data[key] !== undefined && !Array.isArray(data[key])) throw bad(`"${key}" is not a list`);
  if (data.warehousingEnabled !== undefined && typeof data.warehousingEnabled !== "boolean") throw bad(`"warehousingEnabled" is not true/false`);
  if (data.companySettings !== undefined && !isRecord(data.companySettings)) throw bad(`"companySettings" is not an object`);
}

/** Parses manifest.json / inventory.json of a ZIP archive; malformed JSON or shape is a 400, not a 500. */
function readZipBackup(zip: AdmZip): { manifest: RSBackupManifest; inventoryData: RSInventoryData } {
  const manifestEntry = zip.getEntry("manifest.json");
  const inventoryEntry = zip.getEntry("inventory.json");
  if (!manifestEntry || !inventoryEntry) {
    throw new AppError(400, "INCOMPLETE_BACKUP", "Archive is missing manifest.json or inventory.json");
  }
  let manifest: unknown;
  let inventoryData: unknown;
  try {
    manifest = JSON.parse(manifestEntry.getData().toString("utf8"));
    inventoryData = JSON.parse(inventoryEntry.getData().toString("utf8"));
  } catch {
    throw new AppError(400, "INVALID_METADATA", "manifest.json or inventory.json contains invalid JSON");
  }
  if (!isRecord(manifest) || manifest.format !== "RS_INVENTORY_ZIP_BACKUP") {
    throw new AppError(400, "INVALID_FORMAT", "File is not a valid RS Inventory backup", { detail: "manifest.json format" });
  }
  if (manifest.imageMappings !== undefined && !Array.isArray(manifest.imageMappings)) {
    throw new AppError(400, "INVALID_FORMAT", "File is not a valid RS Inventory backup", { detail: "manifest.json imageMappings" });
  }
  validateInventoryData(inventoryData);
  return { manifest: manifest as unknown as RSBackupManifest, inventoryData };
}

/** Parses a standalone JSON backup (GET /api/backup?format=json); only that wrapper is accepted. */
function readJsonBackup(body: Buffer) {
  let json: unknown;
  try {
    json = JSON.parse(body.toString("utf8"));
  } catch {
    throw new AppError(400, "INVALID_JSON", "Payload is not a valid JSON or ZIP file");
  }
  if (!isRecord(json) || json.format !== "RS_INVENTORY_BACKUP") {
    throw new AppError(400, "INVALID_FORMAT", "File is not a valid RS Inventory backup", { detail: "format" });
  }
  validateInventoryData(json.data);
  return { json, inventoryData: json.data };
}

// Triggers switched off for the restore transaction only (append-only guards, commit-time
// document checks, and the stock check — historic replay order can dip below zero briefly).
// Never listed: stock_movements_maintain_balance (keeps stock_balances exact).
export const RESTORE_TRIGGERS: readonly (readonly [string, string])[] = [
  ["sales", "sales_no_update_delete"],
  ["sales", "sales_consistent"],
  ["sales", "sales_replace_consistent"],
  ["sale_lines", "sale_lines_no_update_delete"],
  ["purchases", "purchases_no_update_delete"],
  ["purchases", "purchases_consistent"],
  ["purchases", "purchases_replace_consistent"],
  ["purchase_lines", "purchase_lines_no_update_delete"],
  ["stock_movements", "stock_movements_no_update_delete"],
  ["stock_movements", "stock_movements_check_balance"],
  ["document_voids", "document_voids_no_update_delete"],
  ["vendor_price_history", "vendor_price_history_no_update_delete"],
  // Measured stock guards (0020). The commit-time "rolls = stock" check stays ON, so a restore
  // whose rolls do not add up to the restored stock is rolled back.
  ["measurement_pieces", "measurement_pieces_no_delete"],
  ["measurement_piece_ledger", "measurement_piece_ledger_no_update_delete"],
  // V3.1 shifts (0035): append-only guards and the commit-time line check (a restored shift of a
  // set whose parts changed later no longer matches its lines). The warehouse balance itself is
  // kept by the maintain trigger like stock_balances.
  ["stock_transfers", "stock_transfers_no_update_delete"],
  ["stock_transfers", "stock_transfers_consistent"],
  ["stock_transfer_lines", "stock_transfer_lines_no_update_delete"],
  ["stock_transfer_voids", "stock_transfer_voids_no_update_delete"],
  ["stock_transfer_voids", "stock_transfer_voids_consistent"],
];

// Deletes every business record of one company in dependency order: the restore runs it before
// importing, "Delete all data" on its own. Users, the company profile, preferences and the audit
// log stay. The caller disables RESTORE_TRIGGERS first (the ledgers are append-only).
export const WIPE_PHRASE = "DELETE ALL DATA";

export async function wipeCompanyData(tx: Prisma.TransactionClient, companyId: string) {
  // V2 tables first: they reference the rest.
  // Measurement piece ledger references transfers, sales, purchases (0035 FKs with RESTRICT).
  await tx.measurementPieceLedger.deleteMany({ where: { companyId } });
  // V3.1 shifts first: their lines point at pieces and sets, their movements at them.
  await tx.stockMovement.deleteMany({ where: { companyId, transferId: { not: null } } });
  await tx.stockTransferVoid.deleteMany({ where: { companyId } });
  await tx.stockTransferLine.deleteMany({ where: { transfer: { companyId } } });
  await tx.stockTransfer.deleteMany({ where: { companyId } });
  // V3.1 sets next: they reference pieces, documents, orders and products.
  await tx.groupSetPartChange.deleteMany({ where: { companyId } });
  await tx.groupSetPart.deleteMany({ where: { companyId } });
  await tx.measurementPiece.updateMany({ where: { companyId, setId: { not: null } }, data: { setId: null } });
  await tx.groupSet.deleteMany({ where: { companyId } });
  await tx.groupSetType.deleteMany({ where: { companyId } });
  await tx.groupByproduct.deleteMany({ where: { companyId } });
  await tx.productGroup.updateMany({ where: { companyId, ownerGroupId: { not: null } }, data: { ownerGroupId: null } });
  await tx.documentVoid.deleteMany({ where: { companyId } });
  await tx.draftOrder.deleteMany({ where: { companyId } });
  // Document lines reference order lines (0027, RESTRICT): delete them before the orders.
  await tx.saleLine.deleteMany({ where: { sale: { companyId } } });
  await tx.purchaseLine.deleteMany({ where: { purchase: { companyId } } });
  // Order lines and events go with their order (ON DELETE CASCADE).
  await tx.order.deleteMany({ where: { companyId } });
  await tx.vendorPriceHistory.deleteMany({ where: { companyId } });
  await tx.vendorPrice.deleteMany({ where: { companyId } });
  // Children first: clear lineage, then delete (pieces reference each other).
  await tx.measurementPiece.updateMany({ where: { companyId, parentId: { not: null } }, data: { parentId: null, kind: "OPEN" } });
  await tx.measurementPiece.updateMany({ where: { companyId, setOrigin: true }, data: { setOrigin: false, kind: "OPEN" } });
  await tx.measurementPiece.deleteMany({ where: { companyId } });
  await tx.stockMovement.deleteMany({ where: { companyId } });
  await tx.sale.updateMany({ where: { companyId, replacesId: { not: null } }, data: { replacesId: null } });
  await tx.purchase.updateMany({ where: { companyId, replacesId: { not: null } }, data: { replacesId: null } });
  await tx.sale.deleteMany({ where: { companyId } });
  await tx.purchase.deleteMany({ where: { companyId } });
  await tx.productCategory.deleteMany({ where: { companyId } });
  await tx.variationCategory.deleteMany({ where: { companyId } });
  await tx.productVariation.deleteMany({ where: { companyId } });
  await tx.productGroup.deleteMany({ where: { companyId } });
  await tx.category.deleteMany({ where: { companyId } });
  await tx.categoryHead.deleteMany({ where: { companyId } });
  await tx.party.deleteMany({ where: { companyId } });
  await tx.documentCounter.deleteMany({ where: { companyId } });
  await tx.pieceCounter.deleteMany({ where: { companyId } });
  await tx.image.deleteMany({ where: { companyId } });
  // V3.1 warehouses last (everything above may point at them); their balances are empty
  // now that every movement is gone.
  await tx.warehouseStockBalance.deleteMany({ where: { companyId } });
  await tx.warehouse.deleteMany({ where: { companyId } });
}

export function backupRoutes(env: Env) {
  const r = Router();
  r.use(requirePermission("backup.manage"));

  const root = path.resolve(env.storageRoot);

  // Summary counts for current company (used by Backup UI dashboard)
  r.get("/summary", async (req, res) => {
    const companyId = req.auth!.companyId;
    const [
      categoriesCount,
      partiesCount,
      productGroupsCount,
      productVariationsCount,
      salesCount,
      purchasesCount,
      stockMovementsCount,
      imagesCount,
    ] = await Promise.all([
      prisma.category.count({ where: { companyId } }),
      prisma.party.count({ where: { companyId } }),
      prisma.productGroup.count({ where: { companyId } }),
      prisma.productVariation.count({ where: { companyId } }),
      prisma.sale.count({ where: { companyId } }),
      prisma.purchase.count({ where: { companyId } }),
      prisma.stockMovement.count({ where: { companyId } }),
      prisma.image.count({ where: { companyId } }),
    ]);

    res.json({
      categoriesCount,
      partiesCount,
      productGroupsCount,
      productVariationsCount,
      salesCount,
      purchasesCount,
      stockMovementsCount,
      imagesCount,
    });
  });

  // Nightly server backup + weekly restore test of this PC (local server only).
  r.get("/server-status", async (_req, res) => {
    res.json(
      await readServerBackupStatus(
        { backup: env.BACKUP_STATUS_FILE, restoreTest: env.RESTORE_TEST_STATUS_FILE },
        env.APP_ENV === "CLIENT_READY"
      )
    );
  });

  // Export Complete Inventory Backup as ZIP (or JSON if ?format=json)
  r.get("/", async (req, res) => {
    const companyId = req.auth!.companyId;
    // Audit H2: every table is read in ONE repeatable-read transaction (one connection, one
    // snapshot), so a sale saved during the export is either wholly in the archive or wholly out,
    // and the export no longer opens ~30 connections at once.
    const snapshot = await prisma.$transaction(
      async (db) => {
        const company = await db.company.findUnique({
          where: { id: companyId },
          select: { id: true, name: true, lengthDecimalsM: true, scrapBelowM: true, lengthDecimalsFtIn: true, scrapBelowFtIn: true, warehousingEnabled: true },
        });
        const [warehouses, stockTransfers, stockTransferVoids] = await Promise.all([
          db.warehouse.findMany({ where: { companyId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
          db.stockTransfer.findMany({ where: { companyId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { lines: { orderBy: { lineNo: "asc" } } } }),
          db.stockTransferVoid.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
        ]);

        const [
          categories,
          parties,
          productGroups,
          productVariations,
          documentCounters,
          sales,
          saleLines,
          purchases,
          purchaseLines,
          stockMovements,
          images,
          users,
          documentVoids,
          draftOrders,
          vendorPrices,
          vendorPriceHistory,
          orders,
          measurementPieces,
          measurementPieceLedger,
          groupByproducts,
          groupSets,
          groupSetParts,
          groupSetPartChanges,
          groupSetTypes,
          categoryHeads,
          productCategories,
          variationCategories,
        ] = await Promise.all([
          db.category.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
          db.party.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
          db.productGroup.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
          db.productVariation.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
          db.documentCounter.findMany({ where: { companyId } }),
          db.sale.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
          db.saleLine.findMany({ where: { sale: { companyId } }, orderBy: { lineNo: "asc" } }),
          db.purchase.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
          db.purchaseLine.findMany({ where: { purchase: { companyId } }, orderBy: { lineNo: "asc" } }),
          db.stockMovement.findMany({ where: { companyId }, orderBy: { occurredAt: "asc" } }),
          db.image.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
          db.user.findMany({
            where: { companyId },
            select: { id: true, name: true, email: true, role: true, active: true, passwordHash: true, createdAt: true, updatedAt: true },
            orderBy: { createdAt: "asc" },
          }),
          db.documentVoid.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
          db.draftOrder.findMany({ where: { companyId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } }),
          db.vendorPrice.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } }),
          db.vendorPriceHistory.findMany({ where: { companyId }, orderBy: { recordedAt: "asc" } }),
          db.order.findMany({
            where: { companyId },
            orderBy: { createdAt: "asc" },
            include: { lines: { orderBy: { lineNo: "asc" } }, events: { orderBy: { createdAt: "asc" } } },
          }),
          // Parents before children (a Cut piece is always created after its roll).
          db.measurementPiece.findMany({ where: { companyId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
          db.measurementPieceLedger.findMany({ where: { companyId }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] }),
          db.groupByproduct.findMany({ where: { companyId }, orderBy: [{ groupId: "asc" }, { sortOrder: "asc" }] }),
          db.groupSet.findMany({ where: { companyId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
          db.groupSetPart.findMany({ where: { companyId }, orderBy: [{ allocatedAt: "asc" }, { id: "asc" }] }),
          db.groupSetPartChange.findMany({ where: { companyId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
          db.groupSetType.findMany({ where: { companyId }, orderBy: [{ groupId: "asc" }, { sortOrder: "asc" }] }),
          db.categoryHead.findMany({ where: { companyId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
          db.productCategory.findMany({ where: { companyId }, orderBy: [{ createdAt: "asc" }, { productId: "asc" }] }),
          db.variationCategory.findMany({ where: { companyId }, orderBy: [{ createdAt: "asc" }, { variationId: "asc" }] }),
        ]);
        // V3.1 (0037): order_lines.sets, read with SQL (see lib\orders.ts saveOrderSets).
        const lineSets = new Map(
          (await db.$queryRaw<{ id: string; sets: unknown }[]>`
            SELECT l.id, l.sets FROM order_lines l JOIN orders o ON o.id = l.order_id WHERE o.company_id = ${companyId} AND l.sets IS NOT NULL`).map((r) => [r.id, r.sets]),
        );
        for (const o of orders) for (const l of o.lines) if (lineSets.has(l.id)) Object.assign(l, { sets: lineSets.get(l.id) });
        return { company, warehouses, stockTransfers, stockTransferVoids, categories, parties, productGroups, productVariations, documentCounters, sales, saleLines, purchases, purchaseLines, stockMovements, images, users, documentVoids, draftOrders, vendorPrices, vendorPriceHistory, orders, measurementPieces, measurementPieceLedger, groupByproducts, groupSets, groupSetParts, groupSetPartChanges, groupSetTypes, categoryHeads, productCategories, variationCategories };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120_000, maxWait: 10_000 },
    );
    const { company, warehouses, stockTransfers, stockTransferVoids, categories, parties, productGroups, productVariations, documentCounters, sales, saleLines, purchases, purchaseLines, stockMovements, images, users, documentVoids, draftOrders, vendorPrices, vendorPriceHistory, orders, measurementPieces, measurementPieceLedger, groupByproducts, groupSets, groupSetParts, groupSetPartChanges, groupSetTypes, categoryHeads, productCategories, variationCategories } = snapshot;

    const inventoryData: RSInventoryData = {
      categories,
      parties,
      productGroups,
      productVariations,
      documentCounters,
      sales,
      saleLines,
      purchases,
      purchaseLines,
      stockMovements,
      images,
      users,
      documentVoids,
      draftOrders,
      vendorPrices,
      vendorPriceHistory,
      orders,
      measurementPieces,
      measurementPieceLedger,
      groupByproducts,
      groupSets,
      groupSetParts,
      groupSetPartChanges,
      groupSetTypes,
      categoryHeads,
      productCategories,
      variationCategories,
      warehouses,
      stockTransfers,
      stockTransferVoids,
      warehousingEnabled: company?.warehousingEnabled ?? false,
      ...(company
        ? {
            companySettings: {
              lengthDecimalsM: company.lengthDecimalsM,
              scrapBelowM: company.scrapBelowM,
              lengthDecimalsFtIn: company.lengthDecimalsFtIn,
              scrapBelowFtIn: company.scrapBelowFtIn,
            },
          }
        : {}),
    };

    const companySlug = (company?.name || "backup").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const dateStamp = new Date().toISOString().slice(0, 10);

    // If caller specifically requested JSON, return standalone JSON
    if (req.query.format === "json") {
      const backupJson = {
        format: "RS_INVENTORY_BACKUP",
        version: BACKUP_VERSION,
        // Feet + inches rates are per ft (0028); absent in older archives (per inch).
        rateUnits: "per_rate_unit",
        exportedAt: new Date().toISOString(),
        environment: env.APP_ENV,
        company: { id: company?.id ?? companyId, name: company?.name ?? "Company" },
        summary: {
          categoriesCount: categories.length,
          partiesCount: parties.length,
          productGroupsCount: productGroups.length,
          productVariationsCount: productVariations.length,
          documentCountersCount: documentCounters.length,
          salesCount: sales.length,
          saleLinesCount: saleLines.length,
          purchasesCount: purchases.length,
          purchaseLinesCount: purchaseLines.length,
          stockMovementsCount: stockMovements.length,
          imagesCount: images.length,
          usersCount: users.length,
        },
        data: inventoryData,
      };
      res.setHeader("Content-Disposition", `attachment; filename="rs-inventory-backup-${companySlug}-${dateStamp}.json"`);
      res.setHeader("Content-Type", "application/json");
      res.send(JSON.stringify(backupJson, null, 2));
      return;
    }

    // Default: Complete Inventory Backup as ZIP Archive
    const zip = new AdmZip();
    const imageMappings: RSBackupManifest["imageMappings"] = [];

    // Add physical images to images/ inside the ZIP
    for (const img of images) {
      const filePath = path.resolve(root, img.storageKey);
      if (filePath.startsWith(root + path.sep)) {
        const fileData = await readFile(filePath).catch(() => null);
        if (fileData) {
          const ext = img.storageKey.split(".").pop() || "jpg";
          const archiveName = `${img.id}.${ext}`;
          const archivePath = `images/${archiveName}`;
          zip.addFile(archivePath, fileData);
          imageMappings.push({
            id: img.id,
            archivePath,
            originalKey: img.storageKey,
            mimeType: img.mimeType,
            bytes: fileData.length,
            sha256: img.sha256,
          });
        }
      }
    }

    // Add inventory.json
    zip.addFile("inventory.json", Buffer.from(JSON.stringify(inventoryData, null, 2), "utf8"));

    // Add manifest.json
    const manifest: RSBackupManifest = {
      format: "RS_INVENTORY_ZIP_BACKUP",
      backupVersion: BACKUP_VERSION,
      exportTimestamp: new Date().toISOString(),
      appVersion: env.RELEASE_VERSION || "0.1.0",
      environment: env.APP_ENV,
      rateUnits: "per_rate_unit",
      company: {
        id: company?.id ?? companyId,
        name: company?.name ?? "Company",
      },
      recordCounts: {
        categories: categories.length,
        parties: parties.length,
        productGroups: productGroups.length,
        productVariations: productVariations.length,
        documentCounters: documentCounters.length,
        sales: sales.length,
        saleLines: saleLines.length,
        purchases: purchases.length,
        purchaseLines: purchaseLines.length,
        stockMovements: stockMovements.length,
        images: imageMappings.length,
        users: users.length,
        documentVoids: documentVoids.length,
        draftOrders: draftOrders.length,
        orders: orders.length,
        vendorPrices: vendorPrices.length,
        vendorPriceHistory: vendorPriceHistory.length,
        measurementPieces: measurementPieces.length,
        measurementPieceLedger: measurementPieceLedger.length,
      },
      imageMappings,
    };
    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));

    const zipBuffer = zip.toBuffer();
    const filename = `rs-inventory-backup-${companySlug}-${dateStamp}.zip`;

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", String(zipBuffer.length));
    res.send(zipBuffer);
  });

  // Inspect uploaded archive (ZIP or JSON) before restoration
  r.post(
    "/inspect",
    express.raw({ limit: "100mb", type: ["application/zip", "application/x-zip-compressed", "application/octet-stream", "application/json"] }),
    async (req, res) => {
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new AppError(400, "NO_DATA", "Please upload a backup file to inspect");
      }

      // Check if ZIP archive (PK magic bytes: 0x50, 0x4B)
      const isZip = body.length > 4 && body[0] === 0x50 && body[1] === 0x4B;

      if (isZip) {
        let zip: AdmZip;
        try {
          zip = new AdmZip(body);
        } catch {
          throw new AppError(400, "INVALID_ZIP", "Corrupted or invalid ZIP archive");
        }

        // Same checks as restore, so "valid" here means restore will accept it.
        const { manifest, inventoryData: inventory } = readZipBackup(zip);
        res.json({
          valid: true,
          format: "ZIP",
          manifest,
          // A V1 archive is accepted and uplifted with V2 defaults on restore.
          sourceVersion: manifest.backupVersion ?? "1.0",
          upgradesFromV1: (manifest.backupVersion ?? "1.0") === "1.0",
          sample: {
            firstProduct: inventory.productGroups?.[0]?.name,
            totalImagesInZip: manifest.imageMappings?.length || 0,
          },
        });
        return;
      }

      // Standalone JSON fallback
      try {
        const json: any = readJsonBackup(body).json;
        res.json({
          valid: true,
          format: "JSON",
          sourceVersion: json.version || "1.0",
          upgradesFromV1: (json.version || "1.0") === "1.0",
          manifest: {
            format: "RS_INVENTORY_ZIP_BACKUP",
            backupVersion: json.version || "1.0",
            exportTimestamp: json.exportedAt || new Date().toISOString(),
            environment: json.environment || "UNKNOWN",
            company: json.company || { id: "", name: "Company" },
            recordCounts: {
              categories: json.summary?.categoriesCount ?? json.data?.categories?.length ?? 0,
              parties: json.summary?.partiesCount ?? json.data?.parties?.length ?? 0,
              productGroups: json.summary?.productGroupsCount ?? json.data?.productGroups?.length ?? 0,
              productVariations: json.summary?.productVariationsCount ?? json.data?.productVariations?.length ?? 0,
              documentCounters: json.summary?.documentCountersCount ?? json.data?.documentCounters?.length ?? 0,
              sales: json.summary?.salesCount ?? json.data?.sales?.length ?? 0,
              saleLines: json.summary?.saleLinesCount ?? json.data?.saleLines?.length ?? 0,
              purchases: json.summary?.purchasesCount ?? json.data?.purchases?.length ?? 0,
              purchaseLines: json.summary?.purchaseLinesCount ?? json.data?.purchaseLines?.length ?? 0,
              stockMovements: json.summary?.stockMovementsCount ?? json.data?.stockMovements?.length ?? 0,
              images: json.summary?.imagesCount ?? json.data?.images?.length ?? 0,
            },
            imageMappings: [],
          },
        });
      } catch (err: unknown) {
        if (err instanceof AppError) throw err;
        throw new AppError(400, "INVALID_BACKUP", "Failed to parse backup payload");
      }
    }
  );

  // Restore Complete Inventory Backup (ZIP or JSON)
  r.post(
    "/restore",
    express.raw({ limit: "100mb", type: ["application/zip", "application/x-zip-compressed", "application/octet-stream", "application/json"] }),
    async (req, res) => {
      const auth = req.auth!;
      const targetCompanyId = auth.companyId;

      const confirm = req.query.confirm === "true" || req.headers["x-confirm"] === "true";
      if (!confirm) {
        throw new AppError(400, "CONFIRMATION_REQUIRED", "Confirmation required: pass confirm=true to acknowledge data overwrite");
      }

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new AppError(400, "NO_DATA", "Please upload backup archive to restore");
      }

      let inventoryData: RSInventoryData;
      let manifest: RSBackupManifest | null = null;
      let zip: AdmZip | null = null;
      let sourceVersion = "1.0";
      // An archive from before 0028 holds feet + inches rates per inch; they are restored per ft.
      let perRateUnit = false;

      const isZip = body.length > 4 && body[0] === 0x50 && body[1] === 0x4B;

      if (isZip) {
        try {
          zip = new AdmZip(body);
        } catch {
          throw new AppError(400, "INVALID_ZIP", "Corrupted or invalid ZIP archive");
        }

        // Validated before any image is written or row deleted (audit H1).
        ({ manifest, inventoryData } = readZipBackup(zip));
        sourceVersion = manifest.backupVersion ?? "1.0";
        perRateUnit = manifest.rateUnits === "per_rate_unit";
      } else {
        const parsed = readJsonBackup(body);
        inventoryData = parsed.inventoryData;
        sourceVersion = typeof parsed.json.version === "string" ? parsed.json.version : "1.0";
        perRateUnit = parsed.json.rateUnits === "per_rate_unit";
      }

      // 1. If images are present in ZIP, restore physical files to STORAGE_ROOT
      const imageFileMap = new Map<string, string>(); // oldImageId -> newStorageKey
      const month = new Date().toISOString().slice(0, 7);

      if (zip && manifest?.imageMappings) {
        for (const mapping of manifest.imageMappings) {
          const entry = zip.getEntry(mapping.archivePath);
          if (entry) {
            const ext = mapping.archivePath.split(".").pop() || "jpg";
            const newStorageKey = `${targetCompanyId}/${month}/${randomUUID()}.${ext}`;
            const targetFilePath = path.resolve(root, newStorageKey);

            await mkdir(path.dirname(targetFilePath), { recursive: true });
            await writeFile(targetFilePath, entry.getData());
            imageFileMap.set(mapping.id, newStorageKey);
          }
        }
      }

      // 2. Perform atomic database restore
      await prisma.$transaction(
        async (tx) => {
          // Temporarily disable append-only and balance check triggers. The balance MAINTENANCE
          // trigger (0007) stays on, so stock_balances follow every delete and insert below.
          for (const [table, trigger] of RESTORE_TRIGGERS) {
            await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
          }

          try {
            await wipeCompanyData(tx, targetCompanyId);

            // Generate collision-safe IDs
            const genId = () => "c" + randomUUID().replace(/-/g, "").slice(0, 24);

            // V3.1 warehouses before any movement, piece, set or order that names one. Created
            // active (the 0035 trigger refuses new rows in an inactive one); flags restored at the end.
            const whIdMap = new Map<string, string>();
            const archivedWarehouses: any[] = inventoryData.warehousingEnabled ? inventoryData.warehouses || [] : [];
            for (const w of archivedWarehouses) {
              whIdMap.set(w.id, genId());
              await tx.warehouse.create({
                data: {
                  id: whIdMap.get(w.id)!,
                  companyId: targetCompanyId,
                  code: w.code,
                  name: w.name,
                  address: w.address ?? null,
                  isDefault: false,
                  active: true,
                  sortOrder: Number.isInteger(w.sortOrder) ? w.sortOrder : 0,
                  version: w.version ?? 1,
                  createdAt: w.createdAt ? new Date(w.createdAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }
            await tx.company.update({ where: { id: targetCompanyId }, data: { warehousingEnabled: whIdMap.size > 0 } });
            const whOf = (id: string | null | undefined) => (id ? (whIdMap.get(id) ?? null) : null);
            // Shift headers before the movements that point at them; lines once pieces and sets exist.
            const transferIdMap = new Map<string, string>();
            for (const t of whIdMap.size ? inventoryData.stockTransfers || [] : []) {
              if (!whIdMap.has(t.fromWarehouseId) || !whIdMap.has(t.toWarehouseId)) continue;
              transferIdMap.set(t.id, genId());
              await tx.stockTransfer.create({
                data: {
                  id: transferIdMap.get(t.id)!,
                  companyId: targetCompanyId,
                  number: t.number,
                  transferDate: t.transferDate ? new Date(t.transferDate) : undefined,
                  fromWarehouseId: whIdMap.get(t.fromWarehouseId)!,
                  toWarehouseId: whIdMap.get(t.toWarehouseId)!,
                  notes: t.notes ?? null,
                  clientRef: t.clientRef ?? null,
                  createdAt: t.createdAt ? new Date(t.createdAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }
            const catIdMap = new Map<string, string>();
            const partyIdMap = new Map<string, string>();
            const groupIdMap = new Map<string, string>();
            const varIdMap = new Map<string, string>();
            const saleIdMap = new Map<string, string>();
            const purchaseIdMap = new Map<string, string>();
            const imgIdMap = new Map<string, string>();

            for (const cat of inventoryData.categories || []) catIdMap.set(cat.id, genId());
            for (const p of inventoryData.parties || []) partyIdMap.set(p.id, genId());
            for (const g of inventoryData.productGroups || []) groupIdMap.set(g.id, genId());
            for (const v of inventoryData.productVariations || []) varIdMap.set(v.id, genId());
            for (const s of inventoryData.sales || []) saleIdMap.set(s.id, genId());
            for (const p of inventoryData.purchases || []) purchaseIdMap.set(p.id, genId());
            for (const img of inventoryData.images || []) imgIdMap.set(img.id, genId());

            // Helper to rewrite image URLs (e.g. /api/images/<oldId> -> /api/images/<newId>)
            const rewriteImgUrl = (url?: string | null) => {
              if (!url) return null;
              for (const [oldId, newId] of imgIdMap.entries()) {
                if (url.includes(oldId)) {
                  return url.replace(oldId, newId);
                }
              }
              return url;
            };

            // Restore Document Counters
            for (const c of inventoryData.documentCounters || []) {
              await tx.documentCounter.create({
                data: {
                  companyId: targetCompanyId,
                  docType: c.docType,
                  fiscalYear: c.fiscalYear,
                  lastValue: c.lastValue ?? 0,
                },
              });
            }

            // Restore Category Heads (0033); older archives have none (every category is Product Type).
            const headIdMap = new Map<string, string>();
            for (const h of inventoryData.categoryHeads || []) {
              const id = genId();
              headIdMap.set(h.id, id);
              await tx.categoryHead.create({
                data: {
                  id,
                  companyId: targetCompanyId,
                  name: h.name,
                  active: h.active ?? true,
                  sortOrder: Number.isInteger(h.sortOrder) ? h.sortOrder : 0,
                  createdAt: h.createdAt ? new Date(h.createdAt) : undefined,
                  updatedAt: h.updatedAt ? new Date(h.updatedAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }

            // Restore Categories
            for (const cat of inventoryData.categories || []) {
              await tx.category.create({
                data: {
                  id: catIdMap.get(cat.id)!,
                  companyId: targetCompanyId,
                  name: cat.name,
                  headId: cat.headId ? (headIdMap.get(cat.headId) ?? null) : null,
                  imageUrl: rewriteImgUrl(cat.imageUrl),
                  active: cat.active ?? true,
                  // Rail order (0013); V1 and older V2 backups have none.
                  sortOrder: Number.isInteger(cat.sortOrder) ? cat.sortOrder : 0,
                  createdAt: cat.createdAt ? new Date(cat.createdAt) : undefined,
                  updatedAt: cat.updatedAt ? new Date(cat.updatedAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }

            // Restore Parties (Customers & Suppliers)
            for (const p of inventoryData.parties || []) {
              await tx.party.create({
                data: {
                  id: partyIdMap.get(p.id)!,
                  companyId: targetCompanyId,
                  type: p.type,
                  name: p.name,
                  phone: p.phone ?? null,
                  email: p.email ?? null,
                  address: p.address ?? null,
                  city: p.city ?? null,
                  // V2 fields; absent in a V1 archive.
                  contactPerson: p.contactPerson ?? null,
                  altPhone: p.altPhone ?? null,
                  shippingAddress: p.shippingAddress ?? null,
                  category: p.category ?? null,
                  notes: p.notes ?? null,
                  active: p.active ?? true,
                  createdAt: p.createdAt ? new Date(p.createdAt) : undefined,
                  updatedAt: p.updatedAt ? new Date(p.updatedAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }

            // Restore Product Groups
            for (const g of inventoryData.productGroups || []) {
              const gallery = Array.isArray(g.gallery)
                ? g.gallery.map((item: string) => rewriteImgUrl(item)).filter(Boolean)
                : [];

              await tx.productGroup.create({
                data: {
                  id: groupIdMap.get(g.id)!,
                  companyId: targetCompanyId,
                  name: g.name,
                  productType: g.productType,
                  baseShortName: g.baseShortName,
                  description: g.description ?? null,
                  unit: g.unit,
                  imageUrl: rewriteImgUrl(g.imageUrl),
                  gallery,
                  categoryId: g.categoryId ? (catIdMap.get(g.categoryId) ?? null) : null,
                  attributeDefinitions: g.attributeDefinitions ?? [],
                  // Measured products (0020); absent in a V1 or earlier V2 archive.
                  lengthUnit: g.lengthUnit ?? null,
                  rollName: g.rollName ?? null,
                  defaultRollLength: g.defaultRollLength ?? null,
                  lengthDecimals: g.lengthDecimals ?? null,
                  scrapBelow: g.scrapBelow ?? null,
                  active: g.active ?? true,
                  createdAt: g.createdAt ? new Date(g.createdAt) : undefined,
                  updatedAt: g.updatedAt ? new Date(g.updatedAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }

            // Pre-0028 archive: a feet + inches product's current rates become per ft (× 12), as
            // migration 0028 did; append-only rows keep their own rate_per (1 = per inch).
            const imperialGroups = new Set((inventoryData.productGroups || []).filter((g: any) => g.lengthUnit === "ft_in").map((g: any) => g.id));
            const imperialVars = new Set((inventoryData.productVariations || []).filter((v: any) => imperialGroups.has(v.groupId)).map((v: any) => v.id));
            const toFoot = (oldVariationId: string) => !perRateUnit && imperialVars.has(oldVariationId);
            const perFoot = (value: any, oldVariationId: string) =>
              value === null || value === undefined || !toFoot(oldVariationId) ? value : new Prisma.Decimal(value).mul(12).toFixed(2);

            // Restore product ↔ category links of other heads (0033).
            for (const l of inventoryData.productCategories || []) {
              const productId = groupIdMap.get(l.productId);
              const categoryId = catIdMap.get(l.categoryId);
              if (!productId || !categoryId) continue;
              await tx.productCategory.create({
                data: { companyId: targetCompanyId, productId, categoryId, createdAt: l.createdAt ? new Date(l.createdAt) : undefined, createdById: auth.userId },
              });
            }

            // Restore Product Variations
            for (const v of inventoryData.productVariations || []) {
              await tx.productVariation.create({
                data: {
                  id: varIdMap.get(v.id)!,
                  companyId: targetCompanyId,
                  groupId: groupIdMap.get(v.groupId)!,
                  shortName: v.shortName,
                  officialSku: v.officialSku ?? null,
                  attributes: v.attributes ?? {},
                  attributeKey: v.attributeKey ?? "",
                  description: v.description ?? null,
                  imageUrl: rewriteImgUrl(v.imageUrl),
                  salePrice: perFoot(v.salePrice ?? 0, v.id),
                  minSalePrice: perFoot(v.minSalePrice ?? 0, v.id),
                  purchaseCost: perFoot(v.purchaseCost ?? 0, v.id),
                  lowStockThreshold: v.lowStockThreshold ?? 0,
                  defaultRollLength: v.defaultRollLength ?? null,
                  active: v.active ?? true,
                  createdAt: v.createdAt ? new Date(v.createdAt) : undefined,
                  updatedAt: v.updatedAt ? new Date(v.updatedAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }

            // V3.1 (0038): categories on single variations (after the variations exist).
            for (const l of inventoryData.variationCategories || []) {
              const variationId = varIdMap.get(l.variationId);
              const productId = groupIdMap.get(l.productId);
              const categoryId = catIdMap.get(l.categoryId);
              if (!variationId || !productId || !categoryId) continue;
              await tx.variationCategory.create({
                data: { companyId: targetCompanyId, variationId, productId, categoryId, createdAt: l.createdAt ? new Date(l.createdAt) : undefined, createdById: auth.userId },
              });
            }

            // V3.1 grouped products: main component owners and by-product links.
            for (const g of inventoryData.productGroups || []) {
              const owner = g.ownerGroupId ? groupIdMap.get(g.ownerGroupId) : undefined;
              if (owner) await tx.productGroup.update({ where: { id: groupIdMap.get(g.id)! }, data: { ownerGroupId: owner } });
            }
            const byproductIdMap = new Map<string, string>();
            for (const b of inventoryData.groupByproducts || []) {
              const groupId = groupIdMap.get(b.groupId);
              const productId = groupIdMap.get(b.productId);
              if (!groupId || !productId) continue;
              byproductIdMap.set(b.id, genId());
              await tx.groupByproduct.create({
                data: {
                  id: byproductIdMap.get(b.id)!,
                  companyId: targetCompanyId,
                  groupId,
                  productId,
                  label: b.label ?? null,
                  required: b.required ?? true,
                  sortOrder: b.sortOrder ?? 0,
                  active: b.active ?? true,
                  createdAt: b.createdAt ? new Date(b.createdAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }

            // Restore Sales
            for (const s of inventoryData.sales || []) {
              await tx.sale.create({
                data: {
                  id: saleIdMap.get(s.id)!,
                  companyId: targetCompanyId,
                  number: s.number,
                  status: s.status ?? "COMPLETED",
                  saleDate: s.saleDate ? new Date(s.saleDate) : undefined,
                  partyId: s.partyId ? (partyIdMap.get(s.partyId) ?? null) : null,
                  partyName: s.partyName ?? null,
                  subtotal: s.subtotal ?? 0,
                  total: s.total ?? 0,
                  notes: s.notes ?? null,
                  clientRef: s.clientRef ? `${s.clientRef}-${targetCompanyId.slice(0, 6)}` : null,
                  paymentMode: s.paymentMode ?? null,
                  paymentStatus: s.paymentStatus ?? null,
                  amountPaid: s.amountPaid ?? null,
                  replacesId: s.replacesId ? (saleIdMap.get(s.replacesId) ?? null) : null,
                  revision: typeof s.revision === "number" ? s.revision : 0,
                  createdAt: s.createdAt ? new Date(s.createdAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }

            // Restore Sale Lines (old → new ids kept to re-link order lines after the orders, 0027)
            const saleLineIdMap = new Map<string, string>();
            for (const sl of inventoryData.saleLines || []) {
              saleLineIdMap.set(sl.id, genId());
              await tx.saleLine.create({
                data: {
                  id: saleLineIdMap.get(sl.id)!,
                  saleId: saleIdMap.get(sl.saleId)!,
                  lineNo: sl.lineNo,
                  variationId: varIdMap.get(sl.variationId)!,
                  productNameSnapshot: sl.productNameSnapshot,
                  shortNameSnapshot: sl.shortNameSnapshot,
                  officialSkuSnapshot: sl.officialSkuSnapshot ?? null,
                  attributesSnapshot: sl.attributesSnapshot ?? {},
                  unit: sl.unit,
                  quantity: sl.quantity,
                  unitPrice: sl.unitPrice,
                  ratePer: sl.ratePer ?? 1,
                  discount: sl.discount ?? 0,
                  note: sl.note ?? null,
                  lineTotal: sl.lineTotal,
                },
              });
            }

            // Restore Purchases
            for (const p of inventoryData.purchases || []) {
              await tx.purchase.create({
                data: {
                  id: purchaseIdMap.get(p.id)!,
                  companyId: targetCompanyId,
                  number: p.number,
                  status: p.status ?? "COMPLETED",
                  purchaseDate: p.purchaseDate ? new Date(p.purchaseDate) : undefined,
                  partyId: p.partyId ? (partyIdMap.get(p.partyId) ?? null) : null,
                  partyName: p.partyName ?? null,
                  subtotal: p.subtotal ?? 0,
                  total: p.total ?? 0,
                  notes: p.notes ?? null,
                  clientRef: p.clientRef ? `${p.clientRef}-${targetCompanyId.slice(0, 6)}` : null,
                  paymentMode: p.paymentMode ?? null,
                  paymentStatus: p.paymentStatus ?? null,
                  amountPaid: p.amountPaid ?? null,
                  replacesId: p.replacesId ? (purchaseIdMap.get(p.replacesId) ?? null) : null,
                  revision: typeof p.revision === "number" ? p.revision : 0,
                  createdAt: p.createdAt ? new Date(p.createdAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }

            // Restore Purchase Lines
            const purchaseLineIdMap = new Map<string, string>();
            for (const pl of inventoryData.purchaseLines || []) {
              purchaseLineIdMap.set(pl.id, genId());
              await tx.purchaseLine.create({
                data: {
                  id: purchaseLineIdMap.get(pl.id)!,
                  purchaseId: purchaseIdMap.get(pl.purchaseId)!,
                  lineNo: pl.lineNo,
                  variationId: varIdMap.get(pl.variationId)!,
                  productNameSnapshot: pl.productNameSnapshot,
                  shortNameSnapshot: pl.shortNameSnapshot,
                  officialSkuSnapshot: pl.officialSkuSnapshot ?? null,
                  attributesSnapshot: pl.attributesSnapshot ?? {},
                  unit: pl.unit,
                  quantity: pl.quantity,
                  unitCost: pl.unitCost,
                  ratePer: pl.ratePer ?? 1,
                  discount: pl.discount ?? 0,
                  note: pl.note ?? null,
                  lineTotal: pl.lineTotal,
                },
              });
            }

            // Restore Stock Movements
            for (const sm of inventoryData.stockMovements || []) {
              await tx.stockMovement.create({
                data: {
                  id: genId(),
                  companyId: targetCompanyId,
                  variationId: varIdMap.get(sm.variationId)!,
                  movementType: sm.movementType,
                  quantity: sm.quantity,
                  unit: sm.unit,
                  rate: sm.rate ?? null,
                  ratePer: sm.ratePer ?? 1,
                  reason: sm.reason ?? null,
                  saleId: sm.saleId ? (saleIdMap.get(sm.saleId) ?? null) : null,
                  purchaseId: sm.purchaseId ? (purchaseIdMap.get(sm.purchaseId) ?? null) : null,
                  warehouseId: whOf(sm.warehouseId),
                  transferId: sm.transferId ? (transferIdMap.get(sm.transferId) ?? null) : null,
                  occurredAt: sm.occurredAt ? new Date(sm.occurredAt) : undefined,
                  createdAt: sm.createdAt ? new Date(sm.createdAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }

            // Restore Images metadata records
            for (const img of inventoryData.images || []) {
              const restoredKey = imageFileMap.get(img.id) || `${targetCompanyId}/restored/${randomUUID()}.jpg`;
              await tx.image.create({
                data: {
                  id: imgIdMap.get(img.id)!,
                  companyId: targetCompanyId,
                  storageKey: restoredKey,
                  mimeType: img.mimeType,
                  bytes: img.bytes,
                  width: img.width,
                  height: img.height,
                  sha256: img.sha256,
                  createdAt: img.createdAt ? new Date(img.createdAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }

            // Restore additional staff users (if any)
            if (Array.isArray(inventoryData.users)) {
              for (const u of inventoryData.users) {
                if (!u.email) continue;
                const email = String(u.email).toLowerCase();
                const existing = await tx.user.findUnique({ where: { email } });
                if (!existing) {
                  await tx.user.create({
                    data: {
                      companyId: targetCompanyId,
                      name: u.name || "User",
                      email,
                      role: u.role || "sales_staff",
                      passwordHash: u.passwordHash,
                      active: u.active ?? true,
                    },
                  });
                }
              }
            }

            // V2 tables (absent in a V1 archive). Every reference is remapped to the new ids.
            for (const dv of inventoryData.documentVoids || []) {
              const saleId = dv.saleId ? saleIdMap.get(dv.saleId) : undefined;
              const purchaseId = dv.purchaseId ? purchaseIdMap.get(dv.purchaseId) : undefined;
              if (!saleId && !purchaseId) continue;
              const replacedBySaleId = dv.replacedBySaleId ? saleIdMap.get(dv.replacedBySaleId) : undefined;
              const replacedByPurchaseId = dv.replacedByPurchaseId ? purchaseIdMap.get(dv.replacedByPurchaseId) : undefined;
              await tx.documentVoid.create({
                data: {
                  companyId: targetCompanyId,
                  saleId: saleId ?? null,
                  purchaseId: purchaseId ?? null,
                  kind: dv.kind === "REPLACED" ? "REPLACED" : "CANCELLED",
                  replacedBySaleId: replacedBySaleId ?? null,
                  replacedByPurchaseId: replacedByPurchaseId ?? null,
                  reason: dv.reason,
                  createdAt: dv.createdAt ? new Date(dv.createdAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }
            await recalculateAllProductActivity(tx, targetCompanyId);
            for (const d of inventoryData.draftOrders || []) {
              const lines = (Array.isArray(d.lines) ? d.lines : [])
                .filter((l: { variationId?: string }) => l.variationId && varIdMap.has(l.variationId))
                .map((l: { variationId: string }) => ({ ...l, variationId: varIdMap.get(l.variationId)! }));
              await tx.draftOrder.create({
                data: {
                  companyId: targetCompanyId,
                  mode: d.mode,
                  status: d.status ?? "ACTIVE",
                  title: d.title,
                  partyId: d.partyId ? (partyIdMap.get(d.partyId) ?? null) : null,
                  notes: d.notes ?? null,
                  lines,
                  estimatedTotal: d.estimatedTotal ?? 0,
                  lineCount: lines.length,
                  expiresAt: d.expiresAt ? new Date(d.expiresAt) : null,
                  createdAt: d.createdAt ? new Date(d.createdAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }
            const orderIdMap = new Map<string, string>();
            const orderLineIdMap = new Map<string, string>();
            for (const o of inventoryData.orders || []) {
              const documentId = o.documentId ? (o.kind === "SALE" ? saleIdMap.get(o.documentId) : purchaseIdMap.get(o.documentId)) : null;
              const lines = (Array.isArray(o.lines) ? o.lines : []).filter((l: { variationId: string }) => varIdMap.has(l.variationId));
              // A completed order must point at its document; skip one whose document is not in the archive.
              if (o.status === "COMPLETED" && !documentId) continue;
              orderIdMap.set(o.id, genId());
              for (const l of lines) orderLineIdMap.set(l.id, genId());
              await tx.order.create({
                data: {
                  id: orderIdMap.get(o.id)!,
                  companyId: targetCompanyId,
                  kind: o.kind,
                  number: o.number,
                  status: o.status,
                  orderDate: o.orderDate ? new Date(o.orderDate) : undefined,
                  partyId: o.partyId ? (partyIdMap.get(o.partyId) ?? null) : null,
                  partyName: o.partyName ?? null,
                  expectedDate: o.expectedDate ?? null,
                  deliveryAddress: o.deliveryAddress ?? null,
                  deliveryNote: o.deliveryNote ?? null,
                  notes: o.notes ?? null,
                  subtotal: o.subtotal ?? 0,
                  lineCount: lines.length,
                  documentId: documentId ?? null,
                  cancelReason: o.cancelReason ?? null,
                  warehouseId: whOf(o.warehouseId),
                  version: o.version ?? 1,
                  createdAt: o.createdAt ? new Date(o.createdAt) : undefined,
                  createdById: auth.userId,
                  lines: {
                    create: lines.map((l: any) => ({
                      id: orderLineIdMap.get(l.id)!,
                      lineNo: l.lineNo,
                      variationId: varIdMap.get(l.variationId)!,
                      quantity: l.quantity,
                      price: perFoot(l.price, l.variationId),
                      ratePer: toFoot(l.variationId) ? 12 : (l.ratePer ?? 1),
                      discount: l.discount ?? 0,
                      note: l.note ?? null,
                      lineTotal: l.lineTotal,
                      fulfilledQuantity: l.fulfilledQuantity ?? 0,
                      // Purchase-order rolls hold lengths only (no ids), so they copy as is.
                      ...(l.rolls != null ? { rolls: l.rolls } : {}),
                      // V3.1 saved Take-from split; dropped if any of its warehouses is not restored.
                      ...(Array.isArray(l.splits) && whIdMap.size && l.splits.every((s: { warehouseId: string }) => whIdMap.has(s.warehouseId))
                        ? { splits: l.splits.map((s: { warehouseId: string; quantity: number }) => ({ warehouseId: whIdMap.get(s.warehouseId)!, quantity: s.quantity })) }
                        : {}),
                    })),
                  },
                  events: {
                    create: (Array.isArray(o.events) ? o.events : []).map((e: any) => ({
                      fromStatus: e.fromStatus ?? null,
                      toStatus: e.toStatus,
                      note: e.note ?? null,
                      createdAt: e.createdAt ? new Date(e.createdAt) : undefined,
                      createdById: auth.userId,
                    })),
                  },
                },
              });
            }
            // Order links on documents (0026 order_id, 0027 order_line_id), now that orders exist.
            // Append-only triggers are off during restore; the 0027 insert check does not run on update.
            for (const s of inventoryData.sales || []) {
              const orderId = s.orderId ? orderIdMap.get(s.orderId) : undefined;
              if (orderId) await tx.sale.update({ where: { id: saleIdMap.get(s.id)! }, data: { orderId } });
            }
            for (const p of inventoryData.purchases || []) {
              const orderId = p.orderId ? orderIdMap.get(p.orderId) : undefined;
              if (orderId) await tx.purchase.update({ where: { id: purchaseIdMap.get(p.id)! }, data: { orderId } });
            }
            for (const sl of inventoryData.saleLines || []) {
              const orderLineId = sl.orderLineId ? orderLineIdMap.get(sl.orderLineId) : undefined;
              if (orderLineId) await tx.saleLine.update({ where: { id: saleLineIdMap.get(sl.id)! }, data: { orderLineId } });
            }
            for (const pl of inventoryData.purchaseLines || []) {
              const orderLineId = pl.orderLineId ? orderLineIdMap.get(pl.orderLineId) : undefined;
              if (orderLineId) await tx.purchaseLine.update({ where: { id: purchaseLineIdMap.get(pl.id)! }, data: { orderLineId } });
            }

            for (const vp of inventoryData.vendorPrices || []) {
              const variationId = varIdMap.get(vp.variationId);
              const supplierId = partyIdMap.get(vp.supplierId);
              if (!variationId || !supplierId) continue;
              await tx.vendorPrice.create({
                data: {
                  companyId: targetCompanyId,
                  variationId,
                  supplierId,
                  rate: perFoot(vp.rate, vp.variationId),
                  active: vp.active ?? true,
                  notes: vp.notes ?? null,
                  effectiveAt: vp.effectiveAt ? new Date(vp.effectiveAt) : undefined,
                  createdAt: vp.createdAt ? new Date(vp.createdAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }
            for (const h of inventoryData.vendorPriceHistory || []) {
              const variationId = varIdMap.get(h.variationId);
              const supplierId = partyIdMap.get(h.supplierId);
              if (!variationId || !supplierId) continue;
              await tx.vendorPriceHistory.create({
                data: {
                  companyId: targetCompanyId,
                  variationId,
                  supplierId,
                  rate: h.rate,
                  ratePer: h.ratePer ?? 1,
                  active: h.active ?? true,
                  notes: h.notes ?? null,
                  recordedAt: h.recordedAt ? new Date(h.recordedAt) : undefined,
                  recordedById: auth.userId,
                },
              });
            }

            // V3.1 sets (before their pieces, which point at them).
            const setIdMap = new Map<string, string>();
            for (const s of inventoryData.groupSets || []) {
              const groupId = groupIdMap.get(s.groupId);
              if (!groupId) continue;
              setIdMap.set(s.id, genId());
              await tx.groupSet.create({
                data: {
                  id: setIdMap.get(s.id)!,
                  companyId: targetCompanyId,
                  code: s.code,
                  groupId,
                  warehouseId: whOf(s.warehouseId),
                  status: s.status,
                  source: s.source,
                  purchaseId: s.purchaseId ? (purchaseIdMap.get(s.purchaseId) ?? null) : null,
                  purchaseLineNo: s.purchaseLineNo ?? null,
                  rate: s.rate ?? 0,
                  orderId: s.orderId ? (orderIdMap.get(s.orderId) ?? null) : null,
                  orderLineNo: s.orderLineNo ?? null,
                  saleId: s.saleId ? (saleIdMap.get(s.saleId) ?? null) : null,
                  saleLineNo: s.saleLineNo ?? null,
                  notes: s.notes ?? null,
                  version: s.version ?? 1,
                  createdAt: s.createdAt ? new Date(s.createdAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }

            // Measured stock (0020): rolls, then their history. Parents are listed before children.
            const pieceIdMap = new Map<string, string>();
            for (const mp of inventoryData.measurementPieces || []) pieceIdMap.set(mp.id, genId());
            for (const mp of inventoryData.measurementPieces || []) {
              const variationId = varIdMap.get(mp.variationId);
              if (!variationId) continue;
              await tx.measurementPiece.create({
                data: {
                  id: pieceIdMap.get(mp.id)!,
                  companyId: targetCompanyId,
                  variationId,
                  code: mp.code,
                  kind: mp.kind,
                  status: mp.status,
                  originalLength: mp.originalLength,
                  remainingLength: mp.remainingLength,
                  parentId: mp.parentId ? (pieceIdMap.get(mp.parentId) ?? null) : null,
                  setId: mp.setId ? (setIdMap.get(mp.setId) ?? null) : null,
                  setOrigin: mp.setOrigin ?? false,
                  warehouseId: whOf(mp.warehouseId),
                  purchaseId: mp.purchaseId ? (purchaseIdMap.get(mp.purchaseId) ?? null) : null,
                  supplierId: mp.supplierId ? (partyIdMap.get(mp.supplierId) ?? null) : null,
                  unitCost: perFoot(mp.unitCost ?? null, mp.variationId),
                  supplierRollNo: mp.supplierRollNo ?? null,
                  rack: mp.rack ?? null,
                  notes: mp.notes ?? null,
                  openedAt: mp.openedAt ? new Date(mp.openedAt) : null,
                  receivedAt: mp.receivedAt ? new Date(mp.receivedAt) : undefined,
                  createdAt: mp.createdAt ? new Date(mp.createdAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }
            const ledgerRows = (inventoryData.measurementPieceLedger || []).filter((h: { pieceId: string; variationId: string }) => pieceIdMap.has(h.pieceId) && varIdMap.has(h.variationId));
            if (ledgerRows.length) {
              await tx.measurementPieceLedger.createMany({
                data: ledgerRows.map((h: any) => ({
                  companyId: targetCompanyId,
                  pieceId: pieceIdMap.get(h.pieceId)!,
                  variationId: varIdMap.get(h.variationId)!,
                  action: h.action,
                  change: h.change,
                  beforeLength: h.beforeLength,
                  afterLength: h.afterLength,
                  relatedPieceId: h.relatedPieceId ? (pieceIdMap.get(h.relatedPieceId) ?? null) : null,
                  saleId: h.saleId ? (saleIdMap.get(h.saleId) ?? null) : null,
                  purchaseId: h.purchaseId ? (purchaseIdMap.get(h.purchaseId) ?? null) : null,
                  lineNo: h.lineNo ?? null,
                  reason: h.reason ?? null,
                  warehouseId: whOf(h.warehouseId),
                  toWarehouseId: whOf(h.toWarehouseId),
                  transferId: h.transferId ? (transferIdMap.get(h.transferId) ?? null) : null,
                  occurredAt: h.occurredAt ? new Date(h.occurredAt) : undefined,
                  createdById: auth.userId,
                })),
              });
            }

            // V3.1 set parts and their change history (after pieces and sets exist).
            const partIdMap = new Map<string, string>();
            for (const p of inventoryData.groupSetParts || []) {
              const setId = setIdMap.get(p.setId);
              const variationId = varIdMap.get(p.variationId);
              if (!setId || !variationId) continue;
              partIdMap.set(p.id, genId());
              await tx.groupSetPart.create({
                data: {
                  id: partIdMap.get(p.id)!,
                  companyId: targetCompanyId,
                  setId,
                  role: p.role,
                  byproductId: p.byproductId ? (byproductIdMap.get(p.byproductId) ?? null) : null,
                  variationId,
                  pieceId: p.pieceId ? (pieceIdMap.get(p.pieceId) ?? null) : null,
                  quantity: p.quantity,
                  status: p.status,
                  allocatedAt: p.allocatedAt ? new Date(p.allocatedAt) : undefined,
                  releasedAt: p.releasedAt ? new Date(p.releasedAt) : null,
                },
              });
            }
            for (const c of inventoryData.groupSetPartChanges || []) {
              const setId = setIdMap.get(c.setId);
              const saleId = saleIdMap.get(c.saleId);
              if (!setId || !saleId) continue;
              await tx.groupSetPartChange.create({
                data: {
                  companyId: targetCompanyId,
                  setId,
                  saleId,
                  changeType: c.changeType,
                  oldPartId: c.oldPartId ? (partIdMap.get(c.oldPartId) ?? null) : null,
                  newPartId: c.newPartId ? (partIdMap.get(c.newPartId) ?? null) : null,
                  oldPieceId: c.oldPieceId ? (pieceIdMap.get(c.oldPieceId) ?? null) : null,
                  newSourcePieceId: c.newSourcePieceId ? (pieceIdMap.get(c.newSourcePieceId) ?? null) : null,
                  reason: c.reason ?? null,
                  createdAt: c.createdAt ? new Date(c.createdAt) : undefined,
                  createdById: auth.userId,
                },
              });
            }
            // 0041 set types: the key is made of by-product and variation ids, so it is rebuilt.
            for (const t of inventoryData.groupSetTypes || []) {
              const groupId = groupIdMap.get(t.groupId);
              if (!groupId) continue;
              const parts = (Array.isArray(t.parts) ? t.parts : []).map((p: { byproductId: string; variationId: string; length?: number | null }) => ({
                byproductId: byproductIdMap.get(p.byproductId) ?? "",
                variationId: varIdMap.get(p.variationId) ?? "",
                length: p.length ?? null,
              }));
              if (parts.some((p: { byproductId: string; variationId: string }) => !p.byproductId || !p.variationId)) continue;
              await tx.groupSetType.create({
                data: {
                  companyId: targetCompanyId,
                  groupId,
                  typeKey: setTypeKey(parts),
                  standard: t.standard ?? false,
                  name: t.name ?? null,
                  parts,
                  salePrice: t.salePrice ?? 0,
                  minSalePrice: t.minSalePrice ?? 0,
                  lowStockThreshold: t.lowStockThreshold ?? 0,
                  sortOrder: t.sortOrder ?? 0,
                  updatedById: auth.userId,
                },
              });
            }

            // V3.1 shift lines (pieces and sets exist now) and cancels.
            for (const t of inventoryData.stockTransfers || []) {
              const transferId = transferIdMap.get(t.id);
              if (!transferId) continue;
              const lines = (Array.isArray(t.lines) ? t.lines : []).filter((l: { variationId: string }) => varIdMap.has(l.variationId));
              if (!lines.length) continue;
              await tx.stockTransferLine.createMany({
                data: lines.map((l: any) => ({
                  transferId,
                  lineNo: l.lineNo,
                  variationId: varIdMap.get(l.variationId)!,
                  productNameSnapshot: l.productNameSnapshot,
                  shortNameSnapshot: l.shortNameSnapshot,
                  unit: l.unit,
                  quantity: l.quantity,
                  pieceId: l.pieceId ? (pieceIdMap.get(l.pieceId) ?? null) : null,
                  setId: l.setId ? (setIdMap.get(l.setId) ?? null) : null,
                  note: l.note ?? null,
                })),
              });
            }
            for (const v of inventoryData.stockTransferVoids || []) {
              const transferId = transferIdMap.get(v.transferId);
              if (!transferId) continue;
              await tx.stockTransferVoid.create({
                data: { companyId: targetCompanyId, transferId, reason: v.reason, createdAt: v.createdAt ? new Date(v.createdAt) : undefined, createdById: auth.userId },
              });
            }
            // Warehouse flags as archived (one default, inactive ones last).
            const archivedDefault = archivedWarehouses.find((w) => w.isDefault) ?? archivedWarehouses[0];
            if (archivedDefault) await tx.warehouse.update({ where: { id: whIdMap.get(archivedDefault.id)! }, data: { isDefault: true } });
            for (const w of archivedWarehouses) {
              if (w.active === false && w !== archivedDefault) await tx.warehouse.update({ where: { id: whIdMap.get(w.id)! }, data: { active: false } });
            }

            // Order-line links that need rows restored later (0022): the preferred piece of a
            // sale-order line, and the procurement link of a purchase-order line to the sale
            // order (line) it buys for. Links to rows not in the archive are dropped.
            for (const o of inventoryData.orders || []) {
              if (!orderIdMap.has(o.id)) continue;
              for (const l of Array.isArray(o.lines) ? o.lines : []) {
                const id = orderLineIdMap.get(l.id);
                if (!id) continue;
                // V3.1 (0037): set lines — a sale order's picks name sets by id (remapped).
                if (Array.isArray(l.sets) && l.sets.length) {
                  const sets = (l.sets as Record<string, unknown>[]).map((s) => (typeof s.setId === "string" ? { ...s, setId: setIdMap.get(s.setId) ?? s.setId } : s));
                  await tx.$executeRaw`UPDATE order_lines SET sets = ${JSON.stringify(sets)}::jsonb WHERE id = ${id}`;
                }
                const pieceId = l.pieceId ? pieceIdMap.get(l.pieceId) : undefined;
                const linkedOrderId = l.linkedOrderId ? orderIdMap.get(l.linkedOrderId) : undefined;
                const linkedOrderLineId = l.linkedOrderLineId ? orderLineIdMap.get(l.linkedOrderLineId) : undefined;
                if (!pieceId && !linkedOrderId && !linkedOrderLineId) continue;
                await tx.orderLine.update({
                  where: { id },
                  data: {
                    ...(pieceId ? { pieceId } : {}),
                    ...(linkedOrderId ? { linkedOrderId } : {}),
                    ...(linkedOrderLineId ? { linkedOrderLineId } : {}),
                  },
                });
              }
            }

            const cs = inventoryData.companySettings;
            if (cs) {
              await tx.company.update({
                where: { id: targetCompanyId },
                data: {
                  lengthDecimalsM: cs.lengthDecimalsM,
                  scrapBelowM: (cs.scrapBelowM as Prisma.Decimal | string | null) ?? null,
                  lengthDecimalsFtIn: cs.lengthDecimalsFtIn,
                  scrapBelowFtIn: (cs.scrapBelowFtIn as Prisma.Decimal | string | null) ?? null,
                },
              });
            }

            // Pre-hosting gate (PRE-HOSTING-CHECKLIST §3): stored balances must equal the ledger.
            // Any drift rolls the whole restore back.
            // V3.1: and each warehouse's balance must match too (0035 views).
            const drift = await tx.$queryRaw<{ n: bigint }[]>`
              SELECT (SELECT count(*) FROM stock_balance_drift WHERE company_id = ${targetCompanyId})
                   + (SELECT count(*) FROM warehouse_total_drift WHERE company_id = ${targetCompanyId})
                   + (SELECT count(*) FROM warehouse_balance_drift d JOIN warehouses w ON w.id = d.warehouse_id WHERE w.company_id = ${targetCompanyId}) AS n`;
            if (Number(drift[0]?.n ?? 0) > 0) {
              throw new AppError(500, "BALANCE_DRIFT", "Restored stock balances do not match the movement history; nothing was changed");
            }

            // Record audit event (a V1 archive is the V1 → V2 migration of plan §1.9)
            await audit(tx, {
              companyId: targetCompanyId,
              actorId: auth.userId,
              action: sourceVersion === "1.0" ? "BACKUP_MIGRATION_V1_TO_V2" : "BACKUP_RESTORE",
              entityType: "Company",
              entityId: targetCompanyId,
              after: {
                archiveType: isZip ? "ZIP" : "JSON",
                sourceVersion,
                restoredCounts: {
                  categories: (inventoryData.categories || []).length,
                  parties: (inventoryData.parties || []).length,
                  productGroups: (inventoryData.productGroups || []).length,
                  productVariations: (inventoryData.productVariations || []).length,
                  sales: (inventoryData.sales || []).length,
                  purchases: (inventoryData.purchases || []).length,
                  stockMovements: (inventoryData.stockMovements || []).length,
                  images: (inventoryData.images || []).length,
                },
              },
              requestId: req.requestId,
            });

            // Run the still-enabled commit-time checks now (restored voids must exactly reverse their
            // documents); Postgres also refuses ALTER TABLE while such checks are pending.
            await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
            // Re-enable triggers before transaction commit
            for (const [table, trigger] of RESTORE_TRIGGERS) {
              await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
            }
          } catch (err) {
            console.error("RESTORE TX FAILED:", err);
            throw err;
          }
        },
        { timeout: 120_000, maxWait: 15_000 }
      );

      res.json({
        success: true,
        message: "Complete inventory backup restored successfully",
        sourceVersion,
        upgradedFromV1: sourceVersion === "1.0",
        checks: { stockBalanceDrift: 0 },
        restoredCounts: {
          categories: (inventoryData.categories || []).length,
          parties: (inventoryData.parties || []).length,
          productGroups: (inventoryData.productGroups || []).length,
          productVariations: (inventoryData.productVariations || []).length,
          sales: (inventoryData.sales || []).length,
          saleLines: (inventoryData.saleLines || []).length,
          purchases: (inventoryData.purchases || []).length,
          purchaseLines: (inventoryData.purchaseLines || []).length,
          stockMovements: (inventoryData.stockMovements || []).length,
          images: (inventoryData.images || []).length,
        },
      });
    }
  );

  // Delete all data: empties the company (catalog, stock, documents, contacts, images) while the
  // users, company profile and audit log stay. The caller must type the phrase back.
  r.post("/wipe", async (req, res) => {
    const auth = req.auth!;
    if (req.body?.confirm !== WIPE_PHRASE) {
      throw new AppError(400, "CONFIRMATION_REQUIRED", `Type "${WIPE_PHRASE}" to confirm`);
    }
    const companyId = auth.companyId;
    await prisma.$transaction(
      async (tx) => {
        for (const [table, trigger] of RESTORE_TRIGGERS) {
          await tx.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
        }
        await wipeCompanyData(tx, companyId);
        await tx.company.update({ where: { id: companyId }, data: { warehousingEnabled: false } });
        await audit(tx, {
          companyId,
          actorId: auth.userId,
          action: "DATA_WIPE",
          entityType: "Company",
          entityId: companyId,
          requestId: req.requestId,
        });
        await tx.$executeRawUnsafe("SET CONSTRAINTS ALL IMMEDIATE");
        for (const [table, trigger] of RESTORE_TRIGGERS) {
          await tx.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
        }
      },
      { timeout: 120_000, maxWait: 15_000 }
    );
    // Image files live under STORAGE_ROOT/<companyId>/; their rows are gone, so remove them too.
    await rm(path.resolve(root, companyId), { recursive: true, force: true });
    res.json({ success: true });
  });

  return r;
}
