import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import AdmZip from "adm-zip";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db.js";
import { getEnv } from "../../src/env.js";
import { ORIGIN, PASSWORD, app, makeCompany, makeUser, signIn } from "./helpers.js";

describe("complete inventory backup (ZIP archive)", () => {
  it("guards endpoints with admin permission", async () => {
    const co = await makeCompany();
    const staff = await makeUser(co.id, "sales_staff");
    const staffClient = await signIn(staff.email);

    // Unauthenticated
    const unauth = await request(app()).get("/api/backup");
    expect(unauth.status).toBe(401);

    // Forbidden for staff
    const res = await staffClient.get("/api/backup");
    expect(res.status).toBe(403);

    const restoreRes = await staffClient.post("/api/backup/restore").send(Buffer.from("fake"));
    expect(restoreRes.status).toBe(403);
  });

  it("exports complete ZIP archive with inventory.json, images/, and manifest.json, and restores into target company", async () => {
    const env = getEnv();
    const storageRoot = path.resolve(env.storageRoot);

    // 1. Setup Source Company with Category, Product, Variation, Image, and Movement
    const srcCompany = await makeCompany();
    const admin = await makeUser(srcCompany.id, "admin");
    const adminClient = await signIn(admin.email);

    // Create a dummy image file in storage
    const fakeImgBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const imgStorageKey = `${srcCompany.id}/2026-10/test-wire.jpg`;
    const fullImgPath = path.resolve(storageRoot, imgStorageKey);
    await mkdir(path.dirname(fullImgPath), { recursive: true });
    await writeFile(fullImgPath, fakeImgBytes);

    const imgRow = await prisma.image.create({
      data: {
        companyId: srcCompany.id,
        storageKey: imgStorageKey,
        mimeType: "image/jpeg",
        bytes: fakeImgBytes.length,
        width: 100,
        height: 100,
        sha256: "fake-sha256",
        createdById: admin.id,
      },
    });

    const cat = await prisma.category.create({
      data: { companyId: srcCompany.id, name: `Cables ${Date.now()}` },
    });
    const party = await prisma.party.create({
      data: { companyId: srcCompany.id, name: "Industrial Supplies Co", type: "BOTH", city: "Ahmedabad" },
    });
    const group = await prisma.productGroup.create({
      data: {
        companyId: srcCompany.id,
        name: "Galvanized Wire",
        productType: "simple",
        baseShortName: "GW",
        unit: "kg",
        imageUrl: `/api/images/${imgRow.id}`,
        gallery: [`/api/images/${imgRow.id}`],
        categoryId: cat.id,
      },
    });
    const variation = await prisma.productVariation.create({
      data: {
        companyId: srcCompany.id,
        groupId: group.id,
        shortName: "GW-100",
        officialSku: "SKU-GW-100",
        attributeKey: "",
        imageUrl: `/api/images/${imgRow.id}`,
        salePrice: 200,
        purchaseCost: 140,
      },
    });
    await prisma.stockMovement.create({
      data: {
        companyId: srcCompany.id,
        variationId: variation.id,
        movementType: "OPENING",
        quantity: 50,
        unit: "kg",
        reason: "Initial stock",
      },
    });
    await prisma.documentCounter.create({
      data: {
        companyId: srcCompany.id,
        docType: "SAL",
        fiscalYear: "2026-27",
        lastValue: 3,
      },
    });

    // 2. Download Backup (ZIP by default)
    const backupRes = await adminClient
      .get("/api/backup")
      .buffer(true)
      .parse((res, callback) => {
        const data: Buffer[] = [];
        res.on("data", (chunk) => data.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(data)));
      });

    expect(backupRes.status).toBe(200);
    expect(backupRes.header["content-type"]).toBe("application/zip");
    expect(backupRes.header["content-disposition"]).toMatch(/\.zip"$/);

    const zipBuffer = backupRes.body as Buffer;
    expect(zipBuffer.length).toBeGreaterThan(0);

    // Unpack ZIP archive to verify contents
    const zip = new AdmZip(zipBuffer);
    const manifestEntry = zip.getEntry("manifest.json");
    const inventoryEntry = zip.getEntry("inventory.json");
    const imageEntry = zip.getEntry(`images/${imgRow.id}.jpg`);

    expect(manifestEntry).not.toBeNull();
    expect(inventoryEntry).not.toBeNull();
    expect(imageEntry).not.toBeNull();

    const manifest = JSON.parse(manifestEntry!.getData().toString("utf8"));
    expect(manifest.format).toBe("RS_INVENTORY_ZIP_BACKUP");
    expect(manifest.recordCounts.productGroups).toBeGreaterThanOrEqual(1);
    expect(manifest.recordCounts.productVariations).toBeGreaterThanOrEqual(1);
    expect(manifest.imageMappings.length).toBe(1);
    expect(manifest.imageMappings[0].id).toBe(imgRow.id);

    // 3. Inspect Endpoint Verification
    const inspectRes = await adminClient
      .post("/api/backup/inspect")
      .set("Content-Type", "application/zip")
      .send(zipBuffer);

    expect(inspectRes.status).toBe(200);
    expect(inspectRes.body.valid).toBe(true);
    expect(inspectRes.body.format).toBe("ZIP");
    expect(inspectRes.body.manifest.recordCounts.productGroups).toBeGreaterThanOrEqual(1);

    // 4. Create Target Company and Restore from ZIP
    const targetCompany = await makeCompany();
    const targetAdmin = await makeUser(targetCompany.id, "admin");
    const targetAdminClient = await signIn(targetAdmin.email);

    // Unconfirmed restore must fail
    const unconfirmed = await targetAdminClient
      .post("/api/backup/restore")
      .set("Content-Type", "application/zip")
      .send(zipBuffer);
    expect(unconfirmed.status).toBe(400);

    // Confirmed restore with ?confirm=true
    const restoreRes = await targetAdminClient
      .post("/api/backup/restore?confirm=true")
      .set("Content-Type", "application/zip")
      .send(zipBuffer);

    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.success).toBe(true);
    expect(restoreRes.body.restoredCounts.productGroups).toBeGreaterThanOrEqual(1);
    expect(restoreRes.body.restoredCounts.productVariations).toBeGreaterThanOrEqual(1);
    expect(restoreRes.body.restoredCounts.images).toBe(1);

    // 5. Verify records in target company
    const restoredProducts = await prisma.productGroup.findMany({
      where: { companyId: targetCompany.id },
      include: { variations: true },
    });
    expect(restoredProducts.length).toBe(1);
    expect(restoredProducts[0]?.name).toBe("Galvanized Wire");
    expect(restoredProducts[0]?.variations.length).toBe(1);
    expect(restoredProducts[0]?.variations[0]?.shortName).toBe("GW-100");

    // Check that image record was created and image URL rewritten
    const restoredImages = await prisma.image.findMany({
      where: { companyId: targetCompany.id },
    });
    expect(restoredImages.length).toBe(1);
    expect(restoredProducts[0]?.imageUrl).toBe(`/api/images/${restoredImages[0]?.id}`);

    // Verify append-only triggers remain enforced post-restore
    const restoredMovements = await prisma.stockMovement.findMany({
      where: { companyId: targetCompany.id },
    });
    expect(restoredMovements.length).toBe(1);
    await expect(
      prisma.stockMovement.delete({ where: { id: restoredMovements[0]!.id } })
    ).rejects.toThrow(/append-only/);
  });
});
