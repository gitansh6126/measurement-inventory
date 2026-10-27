"use client";

import { Suspense } from "react";
import { OrderList } from "@/components/orders/OrderList";
import { Restricted } from "@/components/Restricted";
import { TableSkeleton } from "@/components/ui";

export default function Page() {
  return (
    <Restricted permission="sale.view">
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <OrderList kind="SALE" />
      </Suspense>
    </Restricted>
  );
}
