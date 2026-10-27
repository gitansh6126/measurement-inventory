"use client";

import { useParams } from "next/navigation";
import { PartyProfile } from "@/components/PartyProfile";
import { Restricted } from "@/components/Restricted";

export default function Page() {
  const id = String(useParams().id);
  return (
    <Restricted permission="purchase.view">
      <PartyProfile mode="supplier" id={id} />
    </Restricted>
  );
}
