"use client";

import { Suspense } from "react";
import { PartyList } from "@/components/PartyList";
import { Restricted } from "@/components/Restricted";
import { TableSkeleton } from "@/components/ui";

export default function Page() {
  return (
    <Restricted permission="purchase.view">
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <PartyList mode="supplier" />
      </Suspense>
    </Restricted>
  );
}