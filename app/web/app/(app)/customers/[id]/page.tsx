"use client";

import { useParams } from "next/navigation";
import { PartyProfile } from "@/components/PartyProfile";
import { Restricted } from "@/components/Restricted";

export default function Page() {
  const id = String(useParams().id);
  return (
    <Restricted permission="sale.view">
      <PartyProfile mode="customer" id={id} />
    </Restricted>
  );
}
