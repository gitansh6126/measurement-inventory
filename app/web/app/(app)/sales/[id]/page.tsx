"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { DocumentView } from "@/components/DocumentView";
import { Restricted } from "@/components/Restricted";
import { TableSkeleton } from "@/components/ui";

export default function Page() {
  const id = String(useParams().id);
  return (
    <Restricted permission="sale.view">
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <DocumentView mode="sale" id={id} />
      </Suspense>
    </Restricted>
  );
}
