"use client";

import { Restricted } from "@/components/Restricted";
import { TransactionBuilder } from "@/components/TransactionBuilder";

export default function Page() {
  return (
    <Restricted permission="sale.create">
      <TransactionBuilder mode="sale" />
    </Restricted>
  );
}
