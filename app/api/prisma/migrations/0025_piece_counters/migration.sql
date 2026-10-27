-- CreateTable
CREATE TABLE "piece_counters" (
    "company_id" TEXT NOT NULL,
    "prefix_key" TEXT NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "piece_counters_pkey" PRIMARY KEY ("company_id","prefix_key")
);

-- AddForeignKey
ALTER TABLE "piece_counters" ADD CONSTRAINT "piece_counters_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
