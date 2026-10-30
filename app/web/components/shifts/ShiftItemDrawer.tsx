"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProductThumb } from "@/components/ProductThumb";
import { contentsText } from "@/components/sets/SetContents";
import { SearchInput, Segmented } from "@/components/ui";
import { formatVariationAttributesString, qty, variationLabel } from "@/lib/format";
import { fmtLen, metaOf, rollWord } from "@/lib/measure";
import type { GroupSet, StockProduct, StockVariation } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { freeByWarehouse, warehouseChips } from "@/lib/useWarehouses";
import { useLengthView } from "@/lib/lengthView";

// V3.1 shift item drawer: the sale/purchase ProductDrawer flow (attribute pills, Check Stock
// table, quantity stepper, bottom sheet) applied to New shift. Only stock free in the From
// warehouse can be picked; measured products pick whole rolls, grouped products whole sets.

export interface Piece {
  id: string;
  code: string;
  kind: "CLOSED" | "OPEN" | "CUT";
  status: "ACTIVE" | "USED_UP";
  remainingLength: number;
  warehouseId: string | null;
  setId: string | null;
}
interface PiecesResponse {
  product: { lengthUnit: "m" | "ft_in"; decimals: number | null; rollName: string | null };
  variations: { id: string; pieces: Piece[] }[];
}

export type Line =
  | { kind: "item"; key: string; product: StockProduct; variation: StockVariation; quantity: number }
  | { kind: "piece"; key: string; product: StockProduct; variation: StockVariation; piece: Piece; label: string }
  | { kind: "set"; key: string; product: StockProduct; set: GroupSet };

/** Free stock of a variation in one warehouse (balance minus stock fitted in sets). */
export const freeIn = (v: StockVariation, warehouseId: string) => freeByWarehouse(v.byWarehouse).find((w) => w.warehouseId === warehouseId)?.quantity ?? 0;

const pill = (selected: boolean, ok: boolean) =>
  `rounded-full border px-4 py-1.5 text-sm font-medium transition-all duration-150 select-none active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 ${
    selected
      ? "border-brand-600 bg-brand-600 text-white shadow-xs"
      : ok
        ? "cursor-pointer border-slate-300 bg-white text-slate-700 hover:border-brand-500 hover:bg-brand-50/50 hover:text-brand-600"
        : "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300 opacity-60"
  }`;

export function ShiftItemDrawer({
  product,
  from,
  fromCode,
  lines,
  setLines,
  focusVariationId,
  onClose: close,
}: {
  product: StockProduct;
  from: string;
  fromCode: string;
  lines: Line[];
  setLines: (l: Line[]) => void;
  /** Opened from a shift line or Stock In: start on this variation. */
  focusVariationId?: string | null;
  onClose: () => void;
}) {
  useLengthView();
  const kind = product.productType === "measured" ? "measured" : product.productType === "grouped" ? "grouped" : "counted";
  const active = useMemo(() => product.variations.filter((v) => v.active), [product]);
  const free = useCallback((v: StockVariation) => freeIn(v, from), [from]);
  const withPills = kind !== "grouped" && product.attributes.length > 0 && active.length > 1;

  const initial =
    active.find((v) => v.id === focusVariationId) ??
    (active.length === 1 ? active[0] : active.filter((v) => free(v) > 0).length === 1 ? active.find((v) => free(v) > 0) : undefined);
  const [pick, setPick] = useState<Record<string, string>>(initial && kind === "counted" ? { ...initial.attributes } : {});
  const [tab, setTab] = useState<"form" | "stock">("form");
  const [filter, setFilter] = useState("");
  const existing = (v: StockVariation | undefined) => (v ? lines.find((l) => l.kind === "item" && l.key === v.id) : undefined);
  const [qtyVal, setQtyVal] = useState(() => {
    const l = existing(initial);
    return l?.kind === "item" ? l.quantity : 1;
  });
  const [error, setError] = useState("");

  // Slide the sheet back down before unmounting (same as ProductDrawer).
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const onClose = useCallback(() => {
    if (closeTimer.current !== undefined) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return close();
    setClosing(true);
    closeTimer.current = window.setTimeout(close, 200);
  }, [close]);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const matches = (v: StockVariation, skip?: string) => product.attributes.every((a) => a.name === skip || !pick[a.name] || v.attributes[a.name] === pick[a.name]);
  // A value is choosable when some variation with it (and the other picks) has free stock in From.
  const possible = (attr: string, value: string) => active.some((v) => v.attributes[attr] === value && matches(v, attr) && (kind !== "counted" || free(v) > 0));
  const chosen: StockVariation | undefined =
    kind !== "counted" ? undefined : product.productType === "variable" ? active.find((v) => product.attributes.every((a) => v.attributes[a.name] === pick[a.name])) : active[0];
  const max = chosen ? free(chosen) : 0;
  const current = existing(chosen);

  // A different variation starts from its own line (or 1).
  useEffect(() => {
    if (!chosen) return;
    const l = lines.find((x) => x.kind === "item" && x.key === chosen.id);
    setQtyVal(l?.kind === "item" ? l.quantity : Math.min(1, freeIn(chosen, from)) || 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen?.id]);

  function choose(v: StockVariation) {
    setPick({ ...v.attributes });
    setError("");
    setTab("form");
  }

  function commit() {
    if (!chosen) return setError(product.productType === "variable" ? "Choose a value for every option" : "This product has no active variation");
    if (max <= 0) return setError(`None free in ${fromCode}`);
    if (qtyVal < 1 || qtyVal > max) return setError(`Enter 1 to ${qty(max)}`);
    const line: Line = { kind: "item", key: chosen.id, product, variation: chosen, quantity: qtyVal };
    setLines(current ? lines.map((l) => (l.key === chosen.id ? line : l)) : [...lines, line]);
    onClose();
  }

  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return active;
    return active.filter(
      (v) => v.shortName.toLowerCase().includes(term) || v.officialSku?.toLowerCase().includes(term) || Object.values(v.attributes).some((val) => val.toLowerCase().includes(term))
    );
  }, [active, filter]);

  const picked = lines.filter((l) => l.product.id === product.id).length;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={`Shift: ${product.name}`}>
      <button className={`absolute inset-0 bg-slate-900/40 motion-reduce:animate-none ${closing ? "animate-fade-out" : "animate-fade-in"}`} aria-label="Close" onClick={onClose} />
      <div className={`relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl will-change-transform motion-reduce:animate-none sm:max-w-3xl ${closing ? "animate-sheet-out" : "animate-sheet-in"}`}>
        <div className="flex shrink-0 items-start gap-3 px-5 pt-5 pb-4">
          <ProductThumb src={chosen?.imageUrl ?? product.imageUrl} name={product.name} className="h-16 w-16 shrink-0 rounded-lg text-[9px]" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{current ? "Edit shift line" : `Shift from ${fromCode}`}</div>
            <h2 className="text-lg font-bold text-slate-900">{product.name}</h2>
            {chosen && product.productType === "variable" && <div className="text-xs text-slate-500">{formatVariationAttributesString(chosen.attributes, product.attributes)}</div>}
          </div>
          <button
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-xl leading-none text-slate-400 transition-all duration-150 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 active:scale-90"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {kind === "counted" && active.length > 1 && (
          <div className="mx-5 mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <Segmented
              label="View Mode"
              value={tab}
              onChange={(t) => {
                setError("");
                setTab(t);
              }}
              options={[
                { value: "form", label: current ? "Edit line" : "Add to shift" },
                { value: "stock", label: `Check stock (${active.length})` },
              ]}
            />
            {tab === "stock" && (
              <span className="text-xs text-slate-500">
                Free in {fromCode}: <b className="text-slate-800">{qty(active.reduce((s, v) => s + free(v), 0))}</b> {product.unit}
              </span>
            )}
          </div>
        )}

        {tab === "stock" ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5">
            {active.length > 5 && (
              <div className="mb-2 shrink-0">
                <SearchInput value={filter} onChange={setFilter} placeholder="Filter by attribute…" />
              </div>
            )}
            <div className="max-h-[50vh] min-h-0 w-full flex-1 overflow-auto rounded-lg border border-slate-200">
              <table className="table table-stack table-stack-all min-w-full">
                <thead className="sticky top-0 z-10 bg-slate-50">
                  <tr>
                    {product.attributes.map((a) => (
                      <th key={a.name} className="bg-slate-50">
                        {a.name}
                        {a.unit ? ` (${a.unit})` : ""}
                      </th>
                    ))}
                    <th className="bg-slate-50 text-right">Free in {fromCode}</th>
                    <th className="bg-slate-50 text-right">Other warehouses</th>
                    <th className="bg-slate-50 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shown.map((v) => {
                    const f = free(v);
                    const isSelected = chosen?.id === v.id;
                    const inShift = lines.find((l) => l.kind === "item" && l.key === v.id);
                    return (
                      <tr
                        key={v.id}
                        onClick={() => f > 0 && choose(v)}
                        className={`transition-colors duration-150 ${f > 0 ? "cursor-pointer hover:bg-brand-50/50" : "opacity-50"} ${isSelected ? "bg-brand-50 font-medium" : ""}`}
                      >
                        {product.attributes.map((a) => (
                          <td key={a.name} className="whitespace-nowrap text-slate-800">
                            {v.attributes[a.name] ?? "—"}
                          </td>
                        ))}
                        <td className={`whitespace-nowrap text-right font-semibold ${f > 0 ? "text-slate-900" : "text-slate-400"}`}>
                          {qty(f)}
                          {inShift?.kind === "item" && <span className="block text-[11px] font-normal text-brand-700">{qty(inShift.quantity)} in shift</span>}
                        </td>
                        <td className="whitespace-nowrap text-right">
                          <span className="inline-flex flex-wrap justify-end gap-1 text-[11px]">
                            {warehouseChips(v.byWarehouse)
                              .filter((w) => w.warehouseId !== from)
                              .map((w) => (
                                <span key={w.warehouseId} className="rounded bg-slate-100 px-1.5 text-slate-600">
                                  {w.code} {qty(w.quantity)}
                                </span>
                              ))}
                          </span>
                        </td>
                        <td className="whitespace-nowrap text-center" onClick={(e) => e.stopPropagation()}>
                          {f <= 0 ? (
                            <span className="text-xs text-slate-400">None free</span>
                          ) : (
                            <button
                              type="button"
                              className={`cursor-pointer rounded px-3 py-1 text-xs font-semibold transition-all duration-150 active:scale-95 ${
                                isSelected ? "bg-brand-600 text-white hover:bg-brand-700" : "border border-slate-300 bg-white text-slate-700 hover:border-brand-500 hover:text-brand-600"
                              }`}
                              onClick={() => choose(v)}
                            >
                              {isSelected ? "Selected ✓" : "Select"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={product.attributes.length + 3} className="py-12 text-center text-sm text-slate-500">
                        No variations match &ldquo;{filter}&rdquo;
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-5">
            {withPills &&
              product.attributes.map((a) => (
                <div key={a.name} className="mb-4">
                  <div className="label">
                    {a.name}
                    {a.unit ? ` (${a.unit})` : ""}
                  </div>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={a.name}>
                    {a.values
                      .filter((val) => active.some((v) => v.attributes[a.name] === val))
                      .map((val) => {
                        const selected = pick[a.name] === val;
                        const ok = possible(a.name, val);
                        return (
                          <button
                            key={val}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={!ok && !selected}
                            title={ok ? undefined : `None free in ${fromCode}`}
                            onClick={() => {
                              setError("");
                              setPick((p) => (selected ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== a.name)) : { ...p, [a.name]: val }));
                            }}
                            className={pill(selected, ok)}
                          >
                            {val}
                          </button>
                        );
                      })}
                  </div>
                </div>
              ))}

            {kind === "counted" && (
              <>
                {chosen && (
                  <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200/60 bg-slate-50 px-3 py-2 text-sm">
                    <span>
                      Free in {fromCode}: <b className={max > 0 ? "text-slate-900" : "text-rose-600"}>{qty(max)}</b> {product.unit}
                    </span>
                    <span className="inline-flex flex-wrap gap-1 text-[11px]">
                      {warehouseChips(chosen.byWarehouse)
                        .filter((w) => w.warehouseId !== from)
                        .map((w) => (
                          <span key={w.warehouseId} className="rounded bg-slate-100 px-1.5 text-slate-600">
                            {w.code} {qty(w.quantity)}
                          </span>
                        ))}
                    </span>
                    {current?.kind === "item" && <span className="text-xs text-brand-700">{qty(current.quantity)} already in this shift</span>}
                  </div>
                )}
                <div className="label">Quantity to shift</div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex w-fit items-center rounded-lg border border-slate-300 bg-slate-50 shadow-xs">
                    <button
                      type="button"
                      className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-l-lg text-lg font-semibold text-slate-700 transition-all duration-150 hover:bg-rose-50 hover:text-rose-600 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Decrease quantity"
                      disabled={qtyVal <= 1}
                      onClick={() => setQtyVal((q) => Math.max(1, q - 1))}
                    >
                      −
                    </button>
                    <input autoComplete="off"
                      className="h-10 w-16 border-x border-slate-300 bg-white text-center font-semibold outline-none focus:bg-brand-50/20"
                      inputMode="numeric"
                      aria-label="Quantity"
                      value={qtyVal}
                      onChange={(e) => {
                        setError("");
                        setQtyVal(Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1));
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
                    />
                    <button
                      type="button"
                      className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-r-lg text-lg font-semibold text-slate-700 transition-all duration-150 hover:bg-brand-50 hover:text-brand-600 active:scale-90 disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Increase quantity"
                      disabled={!chosen || qtyVal >= max}
                      onClick={() => setQtyVal((q) => Math.min(max, q + 1))}
                    >
                      +
                    </button>
                  </div>
                  {chosen && max > 1 && (
                    <button
                      type="button"
                      className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                        qtyVal === max ? "border-emerald-500 bg-emerald-50 font-medium text-emerald-800" : "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
                      }`}
                      onClick={() => setQtyVal(Math.floor(max))}
                    >
                      All {qty(max)}
                    </button>
                  )}
                </div>
                {chosen && qtyVal > max && <p className="mt-2 text-xs text-rose-600">Only {qty(max)} free in {fromCode}.</p>}
              </>
            )}

            {kind === "measured" && <RollPicker product={product} from={from} lines={lines} setLines={setLines} variations={active.filter((v) => matches(v))} />}
            {kind === "grouped" && <SetPicker product={product} from={from} lines={lines} setLines={setLines} />}

            {error && (
              <p className="mt-3 text-sm text-rose-600" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        <div className="shrink-0 px-5 pt-4 pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <div className="text-sm text-slate-500">
              {kind === "counted"
                ? chosen
                  ? <>Selected: <b className="text-slate-900">{variationLabel(chosen, product.attributes) || chosen.shortName}</b></>
                  : tab === "stock"
                    ? "Select a variation from the table"
                    : "Choose every option"
                : `${picked} ${kind === "measured" ? "roll" : "set"}${picked === 1 ? "" : "s"} in this shift`}
            </div>
            <div className="flex items-center gap-2">
              {kind === "counted" ? (
                tab === "stock" ? (
                  <button type="button" className="btn-primary" disabled={!chosen} onClick={() => setTab("form")}>
                    Continue with selected
                  </button>
                ) : (
                  <button type="button" className="btn-primary" disabled={!chosen || max <= 0} onClick={commit}>
                    {current ? "Update line" : "Add to shift"}
                  </button>
                )
              ) : (
                <button type="button" className="btn-primary" onClick={onClose}>
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RollPicker({ product, from, lines, setLines, variations }: { product: StockProduct; from: string; lines: Line[]; setLines: (l: Line[]) => void; variations: StockVariation[] }) {
  useLengthView();
  const { data } = useApi<PiecesResponse>(`/measure/products/${product.id}/pieces`);
  const meta = useMemo(() => (data ? metaOf({ lengthUnit: data.product.lengthUnit, decimals: data.product.decimals, rollName: data.product.rollName }) : null), [data]);
  if (!data || !meta) return <p className="text-sm text-slate-500">Loading rolls…</p>;
  const rows = data.variations.flatMap((dv) => {
    const v = variations.find((x) => x.id === dv.id);
    return v ? dv.pieces.filter((p) => p.status === "ACTIVE" && p.warehouseId === from && !p.setId).map((p) => ({ v, p, label: `${p.code} · ${fmtLen(p.remainingLength, meta)}` })) : [];
  });
  if (!rows.length) return <p className="text-sm text-slate-500">No free rolls in this warehouse{variations.length < product.variations.length ? " for these options" : ""}.</p>;
  const pickedIds = new Set(lines.map((l) => l.key));
  const allPicked = rows.every((r) => pickedIds.has(r.p.id));
  const toggleAll = () =>
    setLines(
      allPicked
        ? lines.filter((l) => !rows.some((r) => r.p.id === l.key))
        : [...lines, ...rows.filter((r) => !pickedIds.has(r.p.id)).map((r): Line => ({ kind: "piece", key: r.p.id, product, variation: r.v, piece: r.p, label: r.label }))]
    );
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div className="label mb-0 capitalize">
          {rollWord(meta, rows.length)} free here ({rows.length})
        </div>
        <button type="button" className="text-xs font-semibold text-brand-600 hover:underline" onClick={toggleAll}>
          {allPicked ? "Clear all" : "Select all"}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map(({ v, p, label }) => {
          const picked = pickedIds.has(p.id);
          return (
            <label key={p.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${picked ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:border-brand-300"}`}>
              <input
                type="checkbox"
                checked={picked}
                onChange={(e) => setLines(e.target.checked ? [...lines, { kind: "piece", key: p.id, product, variation: v, piece: p, label }] : lines.filter((l) => l.key !== p.id))}
              />
              <span className="font-mono text-xs">{p.code}</span>
              <span className="font-semibold text-slate-800">{fmtLen(p.remainingLength, meta)}</span>
              <span className="ml-auto truncate text-xs text-slate-400">{variationLabel(v, product.attributes)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function SetPicker({ product, from, lines, setLines }: { product: StockProduct; from: string; lines: Line[]; setLines: (l: Line[]) => void }) {
  const { data } = useApi<{ sets: GroupSet[] }>(`/sets?groupId=${product.id}`);
  if (!data) return <p className="text-sm text-slate-500">Loading sets…</p>;
  const sets = data.sets.filter((s) => s.status === "IN_STOCK" && s.warehouseId === from);
  if (!sets.length) return <p className="text-sm text-slate-500">No sets in stock in this warehouse.</p>;
  return (
    <div>
      <div className="label">Sets free here ({sets.length})</div>
      <div className="grid gap-2">
        {sets.map((s) => {
          const picked = lines.some((l) => l.key === s.id);
          return (
            <label key={s.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${picked ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:border-brand-300"}`}>
              <input
                type="checkbox"
                checked={picked}
                onChange={(e) => setLines(e.target.checked ? [...lines, { kind: "set", key: s.id, product, set: s }] : lines.filter((l) => l.key !== s.id))}
              />
              <span className="text-xs text-slate-700">{contentsText(s.contents)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
