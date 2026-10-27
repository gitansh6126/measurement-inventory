"use client";

import { Suspense } from "react";
import { DocumentHistory } from "@/components/DocumentHistory";
import { Restricted } from "@/components/Restricted";
import { TableSkeleton } from "@/components/ui";

export default function Page() {
  return (
    <Restricted permission="purchase.view">
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <DocumentHistory mode="purchase" />
      </Suspense>
    </Restricted>
  );
}
