"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const parsePage = (raw: string | null) => {
  const p = parseInt(raw || "1", 10);
  return Number.isFinite(p) && p > 0 ? p : 1;
};

/**
 * List page number kept in `?page=` (page 1 has no param), so a link or Back / Forward
 * opens the same page. `syncUrl: false` (a list embedded in another page) keeps it in
 * state only.
 */
export function useUrlPage({ syncUrl = true }: { syncUrl?: boolean } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [page, setPageState] = useState(() => (syncUrl ? parsePage(searchParams.get("page")) : 1));

  // Browser Back / Forward changes the URL; follow it.
  useEffect(() => {
    if (syncUrl) setPageState(parsePage(searchParams.get("page")));
  }, [searchParams, syncUrl]);

  const setPage = (next: number) => {
    const target = Math.max(1, next);
    setPageState(target);
    if (!syncUrl) return;
    const params = new URLSearchParams(searchParams.toString());
    if (target <= 1) params.delete("page");
    else params.set("page", String(target));
    const qs = params.toString();
    router.push(qs ? `?${qs}` : window.location.pathname);
  };

  return [page, setPage] as const;
}
