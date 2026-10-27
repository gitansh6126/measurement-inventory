-- AlterTable
ALTER TABLE "product_groups" ADD COLUMN     "gallery" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "images" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "images_storage_key_key" ON "images"("storage_key");

-- CreateIndex
CREATE INDEX "images_company_id_idx" ON "images"("company_id");

-- AddForeignKey
ALTER TABLE "images" ADD CONSTRAINT "images_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written invariants
-- ---------------------------------------------------------------------------
ALTER TABLE "images" ADD CONSTRAINT "images_mime_known" CHECK ("mime_type" IN ('image/jpeg', 'image/png', 'image/webp'));
ALTER TABLE "images" ADD CONSTRAINT "images_size_limits" CHECK ("bytes" > 0 AND "bytes" <= 5242880 AND "width" BETWEEN 1 AND 4096 AND "height" BETWEEN 1 AND 4096);
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_gallery_limit" CHECK (cardinality("gallery") <= 10);
