"use client";

import { useParams } from "next/navigation";
import { OrderView } from "@/components/orders/OrderView";
import { Restricted } from "@/components/Restricted";

export default function Page() {
  const id = String(useParams().id);
  return (
    <Restricted permission="sale.view">
      <OrderView kind="SALE" id={id} />
    </Restricted>
  );
}
