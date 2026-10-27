"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

function PartiesNewRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const role = searchParams.get("role");
    if (role === "supplier") {
      router.replace("/suppliers?new=true");
    } else {
      router.replace("/customers?new=true");
    }
  }, [router, searchParams]);

  return null;
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PartiesNewRedirect />
    </Suspense>
  );
}