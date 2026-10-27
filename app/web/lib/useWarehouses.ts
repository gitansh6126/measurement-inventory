"use client";

import { useMemo } from "react";
import type { LineSplit, WarehouseList, WarehouseQty } from "./types";
import { useApi } from "./useApi";

/**
 * V3.1 warehouses (docs\WAREHOUSE-V3-PLAN.md). `enabled` is false until an admin creates the first
 * warehouse; screens then show nothing about warehouses (WH-0). Cached like every GET.
 */
export function useWarehouses() {
  const { data, reload, error } = useApi<WarehouseList>("/warehouses");
  return useMemo(() => {
    const warehouses = data?.warehouses ?? [];
    const byId = new Map(warehouses.map((w) => [w.id, w]));
    return {
      loaded: !!data,
      enabled: !!data?.enabled,
      warehouses,
      active: warehouses.filter((w) => w.active),
      defaultWarehouse: warehouses.find((w) => w.isDefault) ?? null,
      codeOf: (id: string | null | undefined) => (id ? (byId.get(id)?.code ?? "?") : ""),
      byId,
      reload,
      error,
    };
  }, [data, reload, error]);
}

/** "W1 3 · W2 2" — warehouses holding stock (zero rows dropped). */
export function warehouseChips(rows: readonly WarehouseQty[] | null | undefined) {
  return (rows ?? []).filter((r) => r.quantity !== 0);
}

/** Free stock of a variation in each warehouse (balance minus stock fitted in sets). */
export function freeByWarehouse(rows: readonly WarehouseQty[] | null | undefined): WarehouseQty[] {
  return (rows ?? []).map((r) => ({ ...r, quantity: Math.round((r.quantity - (r.inSets ?? 0)) * 1000) / 1000 })).filter((r) => r.quantity > 0);
}

/**
 * Take-from suggestion, same rule as the API (lib\warehouses.ts suggestSaleSplits): default
 * warehouse first, then the largest; what nobody covers stays on the first picked warehouse.
 */
export function suggestSplits(free: readonly WarehouseQty[], quantity: number, defaultId: string | null): LineSplit[] {
  const ordered = [...free].filter((s) => s.quantity > 0).sort((a, b) => (a.warehouseId === defaultId ? -1 : b.warehouseId === defaultId ? 1 : b.quantity - a.quantity));
  const out = new Map<string, number>();
  let left = Math.round(quantity * 1000);
  for (const s of ordered) {
    if (left <= 0) break;
    const take = Math.min(left, Math.round(s.quantity * 1000));
    out.set(s.warehouseId, take);
    left -= take;
  }
  if (left > 0) {
    const target = ordered[0]?.warehouseId ?? defaultId;
    if (target) out.set(target, (out.get(target) ?? 0) + left);
  }
  return [...out].map(([warehouseId, m]) => ({ warehouseId, quantity: m / 1000 }));
}

export const splitTotal = (splits: readonly LineSplit[]) => splits.reduce((s, x) => s + Math.round(x.quantity * 1000), 0) / 1000;
