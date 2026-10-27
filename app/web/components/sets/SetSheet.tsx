"use client";

import type { GroupedInfo, SetContentRow } from "@/lib/types";
import { useWarehouses } from "@/lib/useWarehouses";

// V3.1 set sheet (docs\GROUPED-PRODUCTS-V3-PLAN.md §3): one row per set, picking every
// by-product's variation (and the length of a measured part) plus the set's rate. Shared by the
// admin "Add opening sets" dialog and the purchase cart.

type Byproduct = GroupedInfo["byproducts"][number];

export interface SheetPart {
  variationId: string;
  length: string;
}

export interface SheetRow {
  key: number;
  rate: string;
  notes: string;
  parts: Record<string, SheetPart>;
  /** V3.1 (GW-1): the warehouse this set is in; "" = the header / default warehouse. */
  warehouseId?: string;
}

/** One set as the API takes it (POST /api/sets/opening, purchase line `sets[]`). */
export interface SetBody {
  rate: string;
  notes: string | null;
  parts: { byproductId: string; variationId: string; length?: number }[];
  warehouseId?: string | null;
}

export const variationText = (b: Byproduct, v: Byproduct["variations"][number]) => v.label || b.name;

export function emptyRow(info: GroupedInfo, key: number, rate: string): SheetRow {
  return {
    key,
    rate,
    notes: "",
    parts: Object.fromEntries(
      info.byproducts.map((b) => [b.id, { variationId: b.required && b.variations.length === 1 ? b.variations[0]!.id : "", length: "" }]),
    ),
  };
}

/** Sheet rows from sets already entered (editing a cart line). */
export function rowsFromSets(info: GroupedInfo, sets: readonly SetBody[]): SheetRow[] {
  return sets.map((s, i) => {
    const row = emptyRow(info, i + 1, s.rate);
    row.notes = s.notes ?? "";
    row.warehouseId = s.warehouseId ?? "";
    for (const p of s.parts) row.parts[p.byproductId] = { variationId: p.variationId, length: p.length !== undefined ? String(p.length) : "" };
    return row;
  });
}

/** Validates the rows and returns the API body; throws a readable Error on the first problem. */
export function buildSets(info: GroupedInfo, rows: readonly SheetRow[], opts: { rateRequired: boolean }): SetBody[] {
  if (!rows.length) throw new Error("Add at least one set");
  return rows.map((r, i) => {
    if (opts.rateRequired && !r.rate.trim()) throw new Error(`Set ${i + 1}: enter the rate`);
    return {
      rate: r.rate.trim() || "0",
      notes: r.notes.trim() || null,
      ...(r.warehouseId ? { warehouseId: r.warehouseId } : {}),
      parts: info.byproducts.flatMap((b) => {
        const p = r.parts[b.id] ?? { variationId: "", length: "" };
        if (!p.variationId) {
          if (b.required) throw new Error(`Set ${i + 1}: choose the ${b.name}`);
          return [];
        }
        if (b.productType === "measured") {
          const n = Number(p.length);
          if (!p.length.trim() || !Number.isFinite(n) || n <= 0) throw new Error(`Set ${i + 1}: enter the ${b.name} length`);
          return [{ byproductId: b.id, variationId: p.variationId, length: n }];
        }
        return [{ byproductId: b.id, variationId: p.variationId }];
      }),
    };
  });
}

/** Short contents of one set for a cart line: "8 mm 3 m · Safety Hook 1 Ton". */
export function setSummary(info: GroupedInfo, set: SetBody): string {
  return set.parts
    .map((p) => {
      const b = info.byproducts.find((x) => x.id === p.byproductId);
      const v = b?.variations.find((x) => x.id === p.variationId);
      if (!b || !v) return "";
      const len = p.length !== undefined ? ` ${p.length} ${b.lengthUnit === "ft_in" ? "in" : "m"}` : "";
      return b.productType === "simple" ? b.name : `${variationText(b, v)}${len}`;
    })
    .filter(Boolean)
    .join(" · ");
}

/** A part's clean value: "8 mm · 3 m" (measured), "8 mm" (variable), "Fitted" (simple). */
export function partValue(b: Byproduct, v: Byproduct["variations"][number] | undefined, length?: number | string) {
  if (b.productType === "simple") return "Fitted";
  const len = b.productType === "measured" && length !== undefined && length !== "" ? `${length} ${b.lengthUnit === "ft_in" ? "in" : "m"}` : "";
  return [v ? variationText(b, v) : "", len].filter(Boolean).join(" · ");
}

/** One set's contents part by part, for cart lines (no codes). */
export function setContentRows(info: GroupedInfo, set: SetBody): SetContentRow[] {
  return info.byproducts.flatMap((b) => {
    const p = set.parts.find((x) => x.byproductId === b.id);
    if (!p) return [];
    return [{ name: b.name, value: partValue(b, b.variations.find((x) => x.id === p.variationId), p.length) }];
  });
}

export function SetSheetTable({
  info,
  rows,
  setRows,
  defaultRate,
  rateLabel = "Rate (₹) *",
  defaultWarehouseLabel = "Default",
  showWarehouse = true,
}: {
  info: GroupedInfo;
  rows: SheetRow[];
  setRows: (fn: (rows: SheetRow[]) => SheetRow[]) => void;
  defaultRate: string;
  rateLabel?: string;
  /** What an empty warehouse choice means ("Receive into W1", "Default W1"). */
  defaultWarehouseLabel?: string;
  /** False hides the per-set warehouse column (purchase product picking). */
  showWarehouse?: boolean;
}) {
  const wh = useWarehouses();
  const whCol = wh.enabled && showWarehouse;
  const setPart = (key: number, bp: string, patch: Partial<SheetPart>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, parts: { ...r.parts, [bp]: { ...r.parts[bp]!, ...patch } } } : r)));
  const unitOf = (b: Byproduct) => (b.lengthUnit === "ft_in" ? "in" : "m");
  const nextKey = (rs: SheetRow[]) => (rs.at(-1)?.key ?? 0) + 1;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => setRows((rs) => [...rs, emptyRow(info, nextKey(rs), rs.at(-1)?.rate ?? defaultRate)])} disabled={rows.length >= 100}>
          + Add set
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setRows((rs) => [...rs, { ...rs.at(-1)!, key: nextKey(rs), parts: structuredClone(rs.at(-1)!.parts) }])}
          disabled={!rows.length || rows.length >= 100}
        >
          Copy last set
        </button>
      </div>
      <div className="table-scroll overflow-auto rounded-lg border border-slate-200">
        <table className="table text-xs">
          <thead>
            <tr>
              <th>Set</th>
              <th>Main</th>
              {info.byproducts.map((b) => (
                <th key={b.id}>
                  {b.name} {b.required ? "*" : <span className="font-normal text-slate-400">(optional)</span>}
                </th>
              ))}
              {whCol && <th>Warehouse</th>}
              <th>{rateLabel}</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td className="font-semibold">{i + 1}</td>
                <td className="whitespace-nowrap text-slate-600">{info.main?.name}</td>
                {info.byproducts.map((b) => {
                  const p = r.parts[b.id] ?? { variationId: "", length: "" };
                  return (
                    <td key={b.id} className="min-w-[12rem]">
                      <div className="flex gap-1">
                        <select className="input py-1 text-xs" value={p.variationId} onChange={(e) => setPart(r.key, b.id, { variationId: e.target.value })} aria-label={`Set ${i + 1} ${b.name}`}>
                          <option value="">{b.required ? "Choose…" : "— not fitted —"}</option>
                          {b.variations.map((v) => (
                            <option key={v.id} value={v.id}>
                              {variationText(b, v)}
                            </option>
                          ))}
                        </select>
                        {b.productType === "measured" && (
                          <div className="flex items-center gap-1">
                            <input
                              className="input w-20 py-1 text-xs"
                              inputMode="decimal"
                              placeholder="Length"
                              value={p.length}
                              onChange={(e) => setPart(r.key, b.id, { length: e.target.value })}
                              aria-label={`Set ${i + 1} ${b.name} length`}
                            />
                            <span className="text-slate-400">{unitOf(b)}</span>
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
                {whCol && (
                  <td>
                    <select
                      className="input w-auto py-1 text-xs"
                      value={r.warehouseId ?? ""}
                      onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, warehouseId: e.target.value } : x)))}
                      aria-label={`Set ${i + 1} warehouse`}
                    >
                      <option value="">{defaultWarehouseLabel}</option>
                      {wh.active.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} · {w.name}
                        </option>
                      ))}
                    </select>
                  </td>
                )}
                <td>
                  <input
                    className="input w-24 py-1 text-xs"
                    inputMode="numeric"
                    value={r.rate}
                    onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, rate: e.target.value.replace(/\D/g, "") } : x)))}
                    aria-label={`Set ${i + 1} rate`}
                  />
                </td>
                <td>
                  <input
                    className="input w-36 py-1 text-xs"
                    maxLength={300}
                    value={r.notes}
                    onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, notes: e.target.value } : x)))}
                    aria-label={`Set ${i + 1} note`}
                  />
                </td>
                <td>
                  {rows.length > 1 && (
                    <button type="button" className="text-rose-600 hover:underline" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
