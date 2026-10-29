"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { WarehouseStockChips } from "@/components/cart/TakeFromPopup";
import { EyeIcon } from "@/components/icons";
import { useCan } from "@/components/MeContext";
import { VariationOrderCell } from "@/components/VariationOrderCell";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { fmtSellRate } from "@/lib/measure";
import type { GroupSet, SetStatus, SetTypeRow } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { moved, useRowOrder } from "@/lib/useRowOrder";
import { useWarehouses } from "@/lib/useWarehouses";

// V3.1 grouped products shown like variation products (owner, 2026-10-23): a grouped row expands
// into child rows, one per *set type* — sets with the same parts, the way a variation is one
// combination of options. Each child row has the parts, how many sets, and where they are. Used by
// Stock In (table + grid drawer) and the Products list. No set or piece codes are shown.
// V3.1 (0038, G-A): with `categoryId` only the sets in that category are counted and listed (the
// grouped product is in it, or a fitted part is).
// 0041 (owner 2026-10-28): rows come from GET /api/sets/types — the product's standard sets
// (shown at 0 stock too) and every other set type in stock — each with its own selling price,
// minimum selling price and minimum stock. Stock In passes `cells` to edit them.

type SetsRes = { sets: GroupSet[]; counts: Record<SetStatus, number> };
const urlOf = (groupId: string, categoryId?: string) =>
  `/sets?groupId=${groupId}&status=IN_STOCK${categoryId ? `&categoryId=${encodeURIComponent(categoryId)}` : ""}`;

/** Sets in stock of one grouped product (purchase sheet: what is already in the shop). */
export function useSetsInStock(groupId: string, categoryId?: string) {
  return useApi<SetsRes>(urlOf(groupId, categoryId));
}

/** Set types of one grouped product, counted in one warehouse ("" = all). */
export function useSetTypes(groupId: string, warehouseId = "", categoryId?: string) {
  const qs = new URLSearchParams({ ...(warehouseId ? { warehouseId } : {}), ...(categoryId ? { categoryId } : {}) }).toString();
  return useApi<{ types: SetTypeRow[] }>(groupId ? `/sets/types/${groupId}${qs ? `?${qs}` : ""}` : null);
}

/** Short name of a set type: its standard-set name, else its parts' values. */
export const setTypeName = (t: SetTypeRow) => t.name || t.contents.map((c) => c.value).join(" · ") || "Main part only";

/** Violet badge on the parent row, like "4 variations". */
export function SetTypesBadge({ groupId, warehouseId = "", categoryId }: { groupId: string; warehouseId?: string; categoryId?: string }) {
  const { data } = useSetTypes(groupId, warehouseId, categoryId);
  if (!data) return null;
  const n = data.types.length;
  return (
    <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
      {n} set type{n === 1 ? "" : "s"}
    </span>
  );
}

/** Selling price range over the set types (parent rows; the grouped product has no own price). */
export function SetTypesPriceRange({ groupId, field = "salePrice" }: { groupId: string; field?: "salePrice" | "minSalePrice" }) {
  const { data } = useSetTypes(groupId);
  if (!data) return <span className="text-slate-400">…</span>;
  const prices = data.types.map((t) => Number(t[field])).filter((n) => n > 0);
  if (!prices.length) return <span className="text-slate-400">—</span>;
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  return <>{lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`}</>;
}

/**
 * The child table. `columns`: one column per part (Stock In, like its attribute columns).
 * `chips`: the parts as "Part: value" chips. `heads` / `cells` replace the stock and price
 * columns (Stock In's editable cells); without them the stock, prices and minimum stock are shown.
 */
export function SetTypesTable({
  groupId,
  warehouseId = "",
  layout,
  productHref,
  categoryId,
  heads,
  cells,
}: {
  groupId: string;
  warehouseId?: string;
  layout: "columns" | "chips";
  productHref?: string;
  categoryId?: string;
  heads?: ReactNode;
  cells?: (t: SetTypeRow) => ReactNode;
}) {
  const { data, error } = useSetTypes(groupId, warehouseId, categoryId);
  const wh = useWarehouses();
  // V3.2 A2: the row order (drag, ↑ ↓ or position), saved per product and the same on Stock In,
  // Products and the drawer. The full list is needed: a warehouse or category shows only some.
  const canOrder = useCan("product.write");
  const full = useSetTypes(canOrder ? groupId : "");
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState("");
  const shownKeys = (data?.types ?? []).map((t) => t.typeKey);
  async function moveType(from: number, to: number) {
    if (!full.data || ordering || to < 0 || to >= shownKeys.length || from === to) return;
    const re = moved(shownKeys, from, to);
    let i = 0;
    const next = full.data.types.map((t) => (shownKeys.includes(t.typeKey) ? re[i++]! : t.typeKey));
    setOrdering(true);
    setOrderError("");
    try {
      await api(`/sets/types/${groupId}/order`, { method: "PUT", body: { typeKeys: next } });
    } catch (e) {
      setOrderError(errorText(e));
    } finally {
      setOrdering(false);
    }
  }
  const order = useRowOrder(shownKeys, (from, to) => void moveType(from, to));
  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading sets…</p>;
  const types = data.types;
  if (!types.length) return <p className="text-sm text-slate-500">No standard sets and no sets in stock{warehouseId ? ` in ${wh.codeOf(warehouseId)}` : ""}.</p>;
  const parts = [...new Set(types.flatMap((t) => t.contents.map((c) => c.name)))];
  const showWh = wh.enabled && !warehouseId && !cells;
  const hasNamedSets = types.some((t) => !!t.name || t.standard);
  const orderable = canOrder && types.length > 1 && !!full.data;
  return (
    <>
    {orderError && <p className="mb-1 text-sm text-rose-600">{orderError}</p>}
    <table className="table table-stack rounded-md bg-white">
      <thead>
        <tr>
          {orderable ? <th>Order</th> : <th className="w-10">#</th>}
          {hasNamedSets && <th>Set</th>}
          {layout === "columns" ? (
            parts.map((c) => {
              const [pname, role] = c.includes(" · ") ? c.split(" · ") : [c, undefined];
              return (
                <th key={c} data-label={c} className="text-xs">
                  <div className="max-w-[6.5rem]">
                    {role ? (
                      <span className="block font-semibold text-slate-900" title={c}>
                        {role}
                        <span className="block text-[10px] font-normal text-slate-500 truncate">{pname}</span>
                      </span>
                    ) : (
                      <span className="block font-semibold text-slate-900 truncate" title={c}>{c}</span>
                    )}
                  </div>
                </th>
              );
            })
          ) : (
            <th>Set parts</th>
          )}
          {heads ?? (
            <>
              <th>Stock on Hand</th>
              <th className="text-right">Selling Price</th>
              <th className="text-right">Min Selling</th>
              <th>Min Stock</th>
            </>
          )}
          {showWh && <th>In warehouses</th>}
          {productHref && <th className="text-right">Actions</th>}
        </tr>
      </thead>
      <tbody>
        {types.map((t, i) => {
          const low = t.count <= t.lowStockThreshold;
          const drag = orderable ? order.rowProps(t.typeKey) : null;
          return (
            <tr key={t.typeKey} className={drag?.className} onDragOver={drag?.onDragOver} onDrop={drag?.onDrop}>
              {drag ? (
                <VariationOrderCell
                  label={setTypeName(t)}
                  index={i}
                  count={types.length}
                  disabled={ordering}
                  onMove={(from, to) => void moveType(from, to)}
                  {...order.handleProps(t.typeKey)}
                />
              ) : (
                <td className="stack-hide text-slate-400">{i + 1}</td>
              )}
              {hasNamedSets && (
                <td className="whitespace-nowrap">
                  <span className="font-medium text-slate-800">{t.name || "—"}</span>
                  {t.standard && <span className="ml-1.5 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">Standard</span>}
                </td>
              )}
              {layout === "columns" ? (
                parts.map((c) => {
                  const v = t.contents.find((x) => x.name === c)?.value;
                  return (
                    <td key={c} className={v ? "font-medium text-slate-800" : "text-slate-400"}>
                      {v ?? "—"}
                    </td>
                  );
                })
              ) : (
                <td className="md:min-w-[15rem]">
                  <div className="flex flex-wrap gap-1">
                    {t.contents.length ? (
                      t.contents.map((c) => (
                        <span key={c.name} className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-700">
                          {c.name}: <b>{c.value}</b>
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-400">Main part only</span>
                    )}
                  </div>
                </td>
              )}
              {cells ? (
                cells(t)
              ) : (
                <>
                  <td>
                    <span className={`font-semibold ${t.count === 0 ? "text-rose-600" : low ? "text-amber-700" : "text-emerald-700"}`}>
                      {t.count} <span className="text-xs font-normal text-slate-400">set{t.count === 1 ? "" : "s"}</span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap text-right font-medium text-slate-800">{fmtSellRate(null, t.minSalePrice, t.salePrice, "Sell: ")}</td>
                  <td className="whitespace-nowrap text-right text-slate-600">{Number(t.minSalePrice) > 0 ? money(t.minSalePrice) : "—"}</td>
                  <td className="text-slate-600">{t.lowStockThreshold}</td>
                </>
              )}
              {showWh && (
                <td>
                  <WarehouseStockChips rows={Object.entries(t.byWarehouse).map(([warehouseId, quantity]) => ({ warehouseId, code: wh.codeOf(warehouseId), quantity }))} />
                </td>
              )}
              {productHref && (
                <td>
                  <div className="flex justify-end">
                    <Link href={productHref} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-brand-700" title="View sets" aria-label="View sets">
                      <EyeIcon className="h-4 w-4" />
                    </Link>
                  </div>
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
    </>
  );
}

/** The child row under a grouped parent row (`<tr><td colSpan>`), like a variation product's. */
export function SetTypeRows({ colSpan, ...props }: { colSpan: number } & Parameters<typeof SetTypesTable>[0]) {
  return (
    <tr>
      <td colSpan={colSpan} className="bg-slate-50/70 !p-0">
        <div className="child-panel">
          <SetTypesTable {...props} />
        </div>
      </td>
    </tr>
  );
}

/** Sets in stock in one warehouse (the Stock In warehouse filter). */
export function SetCountIn({ groupId, warehouseId, categoryId }: { groupId: string; warehouseId: string; categoryId?: string }) {
  const { data } = useSetTypes(groupId, warehouseId, categoryId);
  if (!data) return <span className="text-slate-400">…</span>;
  const n = data.types.reduce((s, t) => s + t.count, 0);
  return <span className={n > 0 ? "text-slate-900" : "text-rose-600"}>{n} set{n === 1 ? "" : "s"}</span>;
}

