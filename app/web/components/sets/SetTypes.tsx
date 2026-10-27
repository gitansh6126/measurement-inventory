"use client";

import Link from "next/link";
import { WarehouseStockChips } from "@/components/cart/TakeFromPopup";
import { EyeIcon } from "@/components/icons";
import type { GroupSet, SetContentRow, SetStatus, WarehouseQty } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { useWarehouses } from "@/lib/useWarehouses";

// V3.1 grouped products shown like variation products (owner, 2026-10-23): a grouped row expands
// into child rows, one per *set type* — sets with the same parts, the way a variation is one
// combination of options. Each child row has the parts, how many sets, and where they are. Used by
// Stock In (table + grid drawer) and the Products list. No set or piece codes are shown.
// V3.1 (0038, G-A): with `categoryId` only the sets in that category are counted and listed (the
// grouped product is in it, or a fitted part is).

type SetsRes = { sets: GroupSet[]; counts: Record<SetStatus, number> };
const urlOf = (groupId: string, categoryId?: string) =>
  `/sets?groupId=${groupId}&status=IN_STOCK${categoryId ? `&categoryId=${encodeURIComponent(categoryId)}` : ""}`;

export interface SetType {
  key: string;
  contents: SetContentRow[];
  count: number;
  byWarehouse: WarehouseQty[];
}

/** Sets in stock of one grouped product (one cached request shared by badge, count and rows). */
export function useSetsInStock(groupId: string, categoryId?: string) {
  return useApi<SetsRes>(urlOf(groupId, categoryId));
}

/** Groups sets by their parts (like variations by their options), optionally in one warehouse. */
export function setTypesOf(sets: readonly GroupSet[], warehouseId: string, codeOf: (id: string) => string): SetType[] {
  const types = new Map<string, SetType>();
  for (const s of sets) {
    if (warehouseId && s.warehouseId !== warehouseId) continue;
    const key = s.contents.map((c) => `${c.name}=${c.value}`).join("|");
    const t = types.get(key) ?? { key, contents: s.contents, count: 0, byWarehouse: [] };
    t.count += 1;
    if (s.warehouseId) {
      const w = t.byWarehouse.find((x) => x.warehouseId === s.warehouseId);
      if (w) w.quantity += 1;
      else t.byWarehouse.push({ warehouseId: s.warehouseId, code: codeOf(s.warehouseId), quantity: 1 });
    }
    types.set(key, t);
  }
  return [...types.values()].sort((a, b) => valuesOf(a).localeCompare(valuesOf(b), undefined, { numeric: true }));
}
const valuesOf = (t: SetType) => t.contents.map((c) => c.value).join(" ");

/** Violet badge on the parent row, like "4 variations". */
export function SetTypesBadge({ groupId, warehouseId = "", categoryId }: { groupId: string; warehouseId?: string; categoryId?: string }) {
  const { data } = useSetsInStock(groupId, categoryId);
  const wh = useWarehouses();
  if (!data) return null;
  const n = setTypesOf(data.sets, warehouseId, wh.codeOf).length;
  return (
    <span className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">
      {n} set type{n === 1 ? "" : "s"}
    </span>
  );
}

/** Sets in stock in one warehouse (the Stock In warehouse filter). */
export function SetCountIn({ groupId, warehouseId, categoryId }: { groupId: string; warehouseId: string; categoryId?: string }) {
  const { data } = useSetsInStock(groupId, categoryId);
  if (!data) return <span className="text-slate-400">…</span>;
  const n = data.sets.filter((s) => s.warehouseId === warehouseId).length;
  return <span className={n > 0 ? "text-slate-900" : "text-rose-600"}>{n} set{n === 1 ? "" : "s"}</span>;
}

/**
 * The child table. `columns`: one column per part (Stock In, like its attribute columns).
 * `chips`: the parts as "Part: value" chips (Products list, like "Variation Attributes").
 */
export function SetTypesTable({
  groupId,
  warehouseId = "",
  layout,
  productHref,
  categoryId,
}: {
  groupId: string;
  warehouseId?: string;
  layout: "columns" | "chips";
  productHref?: string;
  categoryId?: string;
}) {
  const { data, error } = useSetsInStock(groupId, categoryId);
  const wh = useWarehouses();
  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!data) return <p className="text-sm text-slate-500">Loading sets…</p>;
  const types = setTypesOf(data.sets, warehouseId, wh.codeOf);
  if (!types.length) return <p className="text-sm text-slate-500">No sets in stock{warehouseId ? ` in ${wh.codeOf(warehouseId)}` : ""}.</p>;
  const parts = [...new Set(types.flatMap((t) => t.contents.map((c) => c.name)))];
  const showWh = wh.enabled && !warehouseId;
  const main = data.sets[0]?.parts.find((p) => p.role === "MAIN")?.productName;
  return (
    <>
      <table className="table rounded-md bg-white">
        <thead>
          <tr>
            <th className="w-10">#</th>
            {layout === "columns" ? parts.map((c) => <th key={c}>{c}</th>) : <th>Set parts</th>}
            <th>Stock on Hand</th>
            {showWh && <th>In warehouses</th>}
            {productHref && <th className="text-right">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {types.map((t, i) => (
            <tr key={t.key}>
              <td className="text-slate-400">{i + 1}</td>
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
                <td>
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
              <td>
                <span className="font-semibold text-emerald-700">
                  {t.count} <span className="text-xs font-normal text-slate-400">set{t.count === 1 ? "" : "s"}</span>
                </span>
              </td>
              {showWh && (
                <td>
                  <WarehouseStockChips rows={t.byWarehouse} />
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
          ))}
        </tbody>
      </table>
      {main && <p className="mt-1.5 text-xs text-slate-500">Each set: {main} with the parts shown. Sets with the same parts are one row.</p>}
    </>
  );
}

/** The child row under a grouped parent row (`<tr><td colSpan>`), like a variation product's. */
export function SetTypeRows({ colSpan, ...props }: { colSpan: number } & Parameters<typeof SetTypesTable>[0]) {
  return (
    <tr>
      <td colSpan={colSpan} className="bg-slate-50/70 px-4 py-3">
        <SetTypesTable {...props} />
      </td>
    </tr>
  );
}
