"use client";

import { useMemo } from "react";
import { useCan } from "@/components/MeContext";
import { useApi } from "@/lib/useApi";

export interface SupplierRateSuggestion {
  variationId: string;
  supplierRate: string | null;
  cheapest: {
    rate: string;
    supplierId: string;
    supplierName: string;
  } | null;
  effectiveCost: string;
  suggested: string;
  /** Every active supplier rate, cheapest first. */
  rates: { supplierId: string; supplierName: string; rate: string; effectiveAt: string }[];
}

export function useSupplierRates(variationIds: string[], supplierId?: string | null) {
  const seesVendor = useCan("vendor_pricing.view");
  const uniqueIds = useMemo(
    () => [...new Set(variationIds.filter(Boolean))],
    [variationIds]
  );
  const idsParam = uniqueIds.join(",");

  const url =
    seesVendor && idsParam
      ? `/vendor-prices/best?variationIds=${idsParam}${supplierId ? `&supplierId=${supplierId}` : ""}`
      : null;

  const { data, loading, error, reload } = useApi<{ suggestions: SupplierRateSuggestion[] }>(url);

  const suggestions = useMemo(() => {
    const map = new Map<string, SupplierRateSuggestion>();
    for (const s of data?.suggestions ?? []) {
      map.set(s.variationId, s);
    }
    return map;
  }, [data?.suggestions]);

  return {
    suggestions,
    list: data?.suggestions ?? [],
    loading,
    error,
    reload,
  };
}
