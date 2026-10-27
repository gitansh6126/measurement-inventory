"use client";

import { Checkout } from "@/components/Checkout";
import { Restricted } from "@/components/Restricted";

export default function Page() {
  return (
    <Restricted permission="sale.create">
      <Checkout mode="sale" />
    </Restricted>
  );
}
