"use client";

import { Restricted } from "@/components/Restricted";
import { TransactionBuilder } from "@/components/TransactionBuilder";

export default function Page() {
  return (
    <Restricted permission="purchase.create">
      <TransactionBuilder mode="purchase" />
    </Restricted>
  );
}
