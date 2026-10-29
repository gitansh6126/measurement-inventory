"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useCan } from "@/components/MeContext";
import type { Party } from "@/components/PartyModal";
import { Alert, Avatar, EmptyState, SearchInput, Segmented, TableSkeleton } from "@/components/ui";
import { PlusIcon } from "@/components/icons";
import { ProductThumb } from "@/components/ProductThumb";
import { RateField } from "@/components/measure/RateField";
import { LengthViewToggle } from "@/components/measure/LengthViewToggle";
import { PriceHistoryModal } from "@/components/vendor/PriceHistoryModal";
import type { RailProduct } from "@/components/vendor/ProductRail";
import { api } from "@/lib/api";
import { dateTime, variationLabel } from "@/lib/format";
import { fmtRate, rateLabel, type LengthUnit } from "@/lib/measure";
import type { AttributeDef } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { useEntryUnits } from "@/lib/useEntryUnits";

interface CompareRate {
  supplierId: string;
  supplierName: string;
  rate: string;
  active: boolean;
  effectiveAt: string;
}

interface CompareRow {
  variationId: string;
  unit: string;
  lengthUnit: LengthUnit | null;
  attributeDefinitions: AttributeDef[];
  shortName: string;
  attributes: Record<string, string>;
  purchaseCost: string;
  rates: CompareRate[];
  supplierCount: number;
  best: { supplierId: string; supplierName: string; rate: string } | null;
}

interface CompareResponse {
  rows: CompareRow[];
  total: number;
}

/** One supplier's line under a variation; `rate` is null when that supplier has not quoted it. */
interface Line {
  supplierId: string;
  supplierName: string;
  city: string | null;
  phone: string | null;
  rate: CompareRate | null;
  isBest: boolean;
}

/** Pending edits are keyed by variation and supplier. */
const cellKey = (variationId: string, supplierId: string) => `${variationId}:${supplierId}`;

/**
 * Vendor Pricing > By product: Rebuilt to mirror By Supplier view with full business workflow.
 *
 * For simple products: lists all quoting suppliers directly in the rate table with Best quote,
 * Last Price, New Price (+ Same), Status (Active/Paused), Save, and History.
 *
 * For variable products: variations act as expandable parent rows with key stats (Best rate,
 * Purchase cost, Quote count); expanding opens child tables of suppliers for that
 * variation.
 *
 * Full batch saving ("Save All Records"), instant status toggles, LengthUnit conversion support,
 * and scope switching ("Quoted only" vs "All suppliers") match the By Supplier experience.
 */
export function ProductRateSheet({
  product,
  onDirtyChange,
}: {
  product: NonNullable<RailProduct>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const canManage = useCan("vendor_pricing.manage");
  const purchaseUnits = useEntryUnits("purchase");

  // 1. Load active suppliers
  const suppliersApi = useApi<{ parties: Party[] }>("/parties?role=supplier");
  const suppliers = useMemo(
    () => (suppliersApi.data?.parties ?? []).filter((s) => s.active),
    [suppliersApi.data]
  );
  const supplierById = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s])),
    [suppliers]
  );

  // 2. Load variation comparison data for this product
  const [page, setPage] = useState(1);
  const pageSize = 100;
  const compareApi = useApi<CompareResponse>(
    `/vendor-prices/compare?productId=${encodeURIComponent(product.id)}&minSuppliers=0&includePaused=1&page=${page}&pageSize=${pageSize}`
  );
  const rows = useMemo(() => compareApi.data?.rows ?? [], [compareApi.data]);
  const total = compareApi.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const lu = rows[0]?.lengthUnit ?? null;
  const multi = rows.length > 1 || total > 1;

  // 3. Filters, Scope & Expand states
  const [scope, setScope] = useState<"quoted" | "all">("quoted");
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // 4. Edits & Save state
  const [newPrices, setNewPrices] = useState<Record<string, string>>({});
  const [statusOverrides, setStatusOverrides] = useState<Record<string, boolean>>({});
  const [savingRows, setSavingRows] = useState<Record<string, boolean>>({});
  const [savingAll, setSavingAll] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  // 5. History modal state
  const [historyVar, setHistoryVar] = useState<{
    variationId: string;
    supplierId: string;
    title: string;
  } | null>(null);

  const editedCount = Object.values(newPrices).filter((v) => v.trim() !== "").length;
  useEffect(() => onDirtyChange?.(editedCount > 0), [editedCount, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  function setPrice(variationId: string, supplierId: string, val: string) {
    setNewPrices((prev) => ({ ...prev, [cellKey(variationId, supplierId)]: val }));
  }

  function clearKey(key: string) {
    setNewPrices((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  const label = (r: CompareRow) => variationLabel(r, r.attributeDefinitions) || r.shortName;

  /** Generate supplier lines for a variation based on scope and filter */
  function linesFor(r: CompareRow): Line[] {
    const quoted = [...r.rates].sort((a, b) =>
      a.active !== b.active ? (a.active ? -1 : 1) : Number(a.rate) - Number(b.rate)
    );
    const lines: Line[] = quoted.map((x) => {
      const isBest = r.supplierCount > 1 && !!x.active && r.best?.supplierId === x.supplierId;
      const supp = supplierById.get(x.supplierId);
      return {
        supplierId: x.supplierId,
        supplierName: x.supplierName,
        city: supp?.city ?? null,
        phone: supp?.phone ?? null,
        rate: x,
        isBest,
      };
    });

    if (scope === "all") {
      const have = new Set(quoted.map((x) => x.supplierId));
      for (const s of suppliers) {
        if (!have.has(s.id)) {
          lines.push({
            supplierId: s.id,
            supplierName: s.name,
            city: s.city ?? null,
            phone: s.phone ?? null,
            rate: null,
            isBest: false,
          });
        }
      }
    }

    const q = filter.trim().toLowerCase();
    if (!q) return lines;
    return lines.filter(
      (l) =>
        l.supplierName.toLowerCase().includes(q) ||
        (l.city && l.city.toLowerCase().includes(q)) ||
        (l.phone && l.phone.toLowerCase().includes(q))
    );
  }

  // Filter variations when search filter is active
  const filteredRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const vLabel = label(r).toLowerCase();
      const sName = r.shortName.toLowerCase();
      const attrMatch = Object.values(r.attributes).some((v) => v.toLowerCase().includes(q));
      if (vLabel.includes(q) || sName.includes(q) || attrMatch) return true;
      const lines = linesFor(r);
      return lines.length > 0;
    });
  }, [rows, filter, scope, suppliers]);

  // Header summary statistics
  const summary = useMemo(() => {
    const quoting = new Set<string>();
    const bests: number[] = [];
    let priced = 0;
    for (const r of rows) {
      for (const x of r.rates) {
        if (x.active) quoting.add(x.supplierId);
      }
      if (r.best) {
        priced++;
        bests.push(Number(r.best.rate));
      }
    }
    const lo = bests.length ? String(Math.min(...bests)) : null;
    const hi = bests.length ? String(Math.max(...bests)) : null;
    return { suppliers: quoting.size, priced, lo, hi };
  }, [rows]);

  // "Same": copy last recorded rate or default cost into input
  function copySame(r: CompareRow, l: Line) {
    const target = l.rate?.rate ?? (Number(r.purchaseCost) > 0 ? r.purchaseCost : null);
    if (!target) return;
    const rounded = String(Math.round(Number(target)));
    setPrice(r.variationId, l.supplierId, rounded);
  }

  // Toggle single status (Active / Paused)
  async function toggleStatus(r: CompareRow, l: Line) {
    const key = cellKey(r.variationId, l.supplierId);
    const currentActive = statusOverrides[key] ?? l.rate?.active ?? true;
    const newActive = !currentActive;

    setStatusOverrides((prev) => ({ ...prev, [key]: newActive }));

    // If rate already exists on server and no pending rate typed, update immediately
    if (l.rate && (!newPrices[key] || newPrices[key].trim() === "")) {
      try {
        await api("/vendor-prices", {
          method: "PUT",
          body: {
            supplierId: l.supplierId,
            variationId: r.variationId,
            rate: String(Math.round(Number(l.rate.rate))),
            active: newActive,
          },
        });
        await compareApi.reload();
      } catch (err) {
        setStatusOverrides((prev) => ({ ...prev, [key]: currentActive }));
        setMsg({ kind: "error", text: errorText(err) });
      }
    }
  }

  // Save single row
  async function saveSingleRow(r: CompareRow, l: Line) {
    const key = cellKey(r.variationId, l.supplierId);
    const val = newPrices[key]?.trim();
    if (!val || !/^\d{1,10}$/.test(val) || Number(val) <= 0) {
      setMsg({ kind: "error", text: "Enter a rate above 0" });
      return;
    }
    const targetActive = statusOverrides[key] ?? l.rate?.active ?? true;

    setSavingRows((prev) => ({ ...prev, [key]: true }));
    setMsg(null);
    try {
      await api("/vendor-prices", {
        method: "PUT",
        body: {
          supplierId: l.supplierId,
          variationId: r.variationId,
          rate: val,
          active: targetActive,
        },
      });
      clearKey(key);
      setMsg({
        kind: "success",
        text: `Saved rate ₹${val}${!targetActive ? " (still paused)" : ""} for ${product.name} · ${r.shortName} · ${l.supplierName}`,
      });
      await compareApi.reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    } finally {
      setSavingRows((prev) => ({ ...prev, [key]: false }));
    }
  }

  // Save All Records in batch
  async function saveAllRecords() {
    const records: Array<{ variationId: string; supplierId: string; rate: string; active: boolean }> = [];

    const known = new Map<string, boolean>();
    for (const r of rows) {
      for (const x of r.rates) {
        known.set(cellKey(r.variationId, x.supplierId), x.active);
      }
    }

    for (const [key, val] of Object.entries(newPrices)) {
      if (val.trim() !== "" && /^\d{1,10}$/.test(val.trim()) && Number(val.trim()) > 0) {
        const [variationId, supplierId] = key.split(":") as [string, string];
        const active = statusOverrides[key] ?? known.get(key) ?? true;
        records.push({
          variationId,
          supplierId,
          rate: val.trim(),
          active,
        });
      }
    }

    if (records.length === 0) {
      setMsg({ kind: "error", text: "No valid rates entered to save (rates must be above 0)." });
      return;
    }

    setSavingAll(true);
    setMsg(null);
    try {
      const res = await api<{ count: number; unchanged: number }>("/vendor-prices/batch", {
        method: "PUT",
        body: { records },
      });
      setNewPrices({});
      setStatusOverrides({});
      setMsg({
        kind: "success",
        text: `Successfully saved ${res.count} price(s)${res.unchanged > 0 ? ` (${res.unchanged} unchanged)` : ""}!`,
      });
      await compareApi.reload();
    } catch (err) {
      setMsg({ kind: "error", text: errorText(err) });
    } finally {
      setSavingAll(false);
    }
  }

  function toggleExpandAll(open: boolean) {
    const next: Record<string, boolean> = {};
    for (const r of rows) {
      next[r.variationId] = open;
    }
    setExpanded(next);
  }

  function openHistory(r: CompareRow, l: Line) {
    setHistoryVar({
      variationId: r.variationId,
      supplierId: l.supplierId,
      title: `${product.name}${multi ? ` · ${r.shortName}` : ""} · ${l.supplierName}`,
    });
  }

  const unitNote = lu ? `₹ / ${rateLabel(lu)}` : rows[0]?.unit ? `₹ per ${rows[0].unit}` : "₹";

  /** Stats pill for single-variation product or variation parent row */
  function compareStats(r: CompareRow) {
    const multi = r.supplierCount > 1;
    return (
      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs">
        <span className="text-right">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
            {multi ? "Best quote" : "Supplier quote"}
          </span>
          {r.best ? (
            <span className={multi ? "font-semibold text-emerald-700" : "font-semibold text-slate-800"}>
              {fmtRate(lu, r.best.rate)} <span className="font-normal text-slate-500">· {r.best.supplierName}</span>
            </span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </span>
        <span className="text-right">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">Purchase cost</span>
          <span className="text-slate-600">{Number(r.purchaseCost) > 0 ? fmtRate(lu, r.purchaseCost) : "—"}</span>
        </span>
      </div>
    );
  }

  /** Render supplier row inside either simple table or variable child table */
  function renderSupplierRow(r: CompareRow, l: Line, showExpanderBullet: boolean = false) {
    const key = cellKey(r.variationId, l.supplierId);
    const entered = newPrices[key] ?? "";
    const isSaving = savingRows[key] ?? false;
    const active = statusOverrides[key] ?? l.rate?.active ?? true;

    return (
      <tr
        key={l.supplierId}
        className={
          l.rate
            ? l.rate.active
              ? l.isBest
                ? "bg-emerald-50/40 hover:bg-emerald-50/70"
                : "hover:bg-slate-50/70"
              : "opacity-60 bg-slate-50/40"
            : "hover:bg-slate-50/50"
        }
      >
        {showExpanderBullet && <td className="stack-hide text-center text-slate-300">•</td>}

        <td>
          <div className="flex items-center gap-2.5">
            <Avatar name={l.supplierName} seed={l.supplierId} size="sm" muted={!l.rate} />
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 truncate">{l.supplierName}</div>
              <div className="text-[11px] text-slate-400">
                {product.name} {multi ? `· ${r.shortName}` : ""}
              </div>
            </div>
          </div>
        </td>

        <td className="text-slate-600 text-xs">
          {[l.city, l.phone].filter(Boolean).join(" · ") || "—"}
        </td>

        <td className="text-right">
          {l.rate ? (
            <div>
              <div
                className={`font-semibold ${
                  l.rate.active ? (l.isBest ? "text-emerald-700" : "text-slate-900") : "text-slate-400 line-through"
                }`}
              >
                {fmtRate(lu, l.rate.rate)}
              </div>
              {l.rate.effectiveAt && (
                <div className="text-[10px] text-slate-400">{dateTime(l.rate.effectiveAt)}</div>
              )}
            </div>
          ) : (
            <span className="text-xs text-slate-400 italic">Not set</span>
          )}
        </td>

        <td className="text-right">
          <div className="inline-flex items-center gap-1.5 justify-end">
            {!active && l.rate && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                Paused
              </span>
            )}
            {lu ? (
              <RateField
                compact
                unit={lu}
                label={`Rate for ${l.supplierName}`}
                placeholder="Enter ₹"
                value={entered}
                disabled={!canManage}
                onChange={(val) => setPrice(r.variationId, l.supplierId, val)}
                preferredUnit={purchaseUnits.rateUnit(lu)}
                onUnitChange={(u) => purchaseUnits.setRateUnit(lu, u)}
              />
            ) : (
              <input
                type="text"
                inputMode="numeric"
                placeholder="Enter ₹"
                value={entered}
                disabled={!canManage}
                onChange={(e) => setPrice(r.variationId, l.supplierId, e.target.value.replace(/[^\d]/g, ""))}
                className={`input w-28 text-right font-medium py-1 text-sm ${
                  entered ? "border-brand-500 ring-1 ring-brand-500 bg-brand-50/20" : ""
                }`}
              />
            )}
            <button
              type="button"
              onClick={() => copySame(r, l)}
              disabled={!canManage}
              className="rounded border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-200 active:scale-95"
              title="Copy last recorded rate or default cost"
            >
              Same
            </button>
          </div>
        </td>

        <td className="text-center">
          {l.rate || entered ? (
            canManage ? (
              <button
                type="button"
                onClick={() => void toggleStatus(r, l)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
                  active
                    ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                    : "bg-slate-200 text-slate-600 hover:bg-slate-300"
                }`}
              >
                {active ? "Active" : "Paused"}
              </button>
            ) : (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                }`}
              >
                {active ? "Active" : "Paused"}
              </span>
            )
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
              Not set
            </span>
          )}
        </td>

        <td className="text-center">
          <div className="inline-flex items-center gap-1">
            {canManage && (
              <button
                type="button"
                disabled={!entered || isSaving}
                onClick={() => void saveSingleRow(r, l)}
                className="rounded bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-40"
              >
                {isSaving ? "…" : "Save"}
              </button>
            )}
            <button
              type="button"
              disabled={!l.rate}
              onClick={() => openHistory(r, l)}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              History
            </button>
          </div>
        </td>
      </tr>
    );
  }

  const single = !multi ? rows[0] : undefined;

  return (
    <div className="space-y-4">
      {/* Top Product Header Card */}
      <div className="card hidden flex-wrap items-center justify-between gap-3 p-3.5 lg:flex">
        <div className="flex min-w-0 items-center gap-3">
          <ProductThumb
            src={product.imageUrl}
            name={product.name}
            className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 text-[8px]"
          />
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Rate sheet</div>
            <div className="truncate text-base font-bold text-slate-900">{product.name}</div>
            <div className="flex flex-wrap gap-x-3 text-xs text-slate-500">
              <span>{product.category?.name ?? "Uncategorized"}</span>
              {multi ? (
                <span>
                  {summary.priced}/{total} variations priced
                </span>
              ) : (
                <span>Single item</span>
              )}
              <span>
                {summary.suppliers} supplier{summary.suppliers === 1 ? "" : "s"} quoting
              </span>
              <span>{unitNote}</span>
            </div>
          </div>
        </div>
        {single ? (
          compareStats(single)
        ) : summary.lo && summary.hi ? (
          <div className="text-right text-xs">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {summary.suppliers > 1 ? "Best rates" : "Supplier rate"}
            </span>
            <span className={summary.suppliers > 1 ? "font-semibold text-emerald-700" : "font-semibold text-slate-800"}>
              {summary.lo === summary.hi ? fmtRate(lu, summary.lo) : fmtRate(lu, summary.lo, summary.hi)}
            </span>
          </div>
        ) : (
          <span className="text-xs text-slate-400">Rates pre-fill purchase orders automatically</span>
        )}
      </div>

      {/* Main Content Area */}
      <div className="card overflow-hidden">
        {/* Toolbar matching By Supplier */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-full sm:w-64">
              <SearchInput
                value={filter}
                onChange={setFilter}
                placeholder="Filter suppliers or variations…"
              />
            </div>

            {/* Scope: Quoted only vs All suppliers */}
            <Segmented
              label="Scope"
              value={scope}
              onChange={(v) => setScope(v as "quoted" | "all")}
              options={[
                { value: "quoted", label: "Quoted only", title: "Only suppliers with existing quotes" },
                { value: "all", label: "All suppliers", title: "Every active supplier to enter a first rate" },
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {multi && (
              <>
                <button
                  type="button"
                  onClick={() => toggleExpandAll(true)}
                  className="btn-secondary py-1 text-xs"
                  title="Expand all variations"
                >
                  Expand all
                </button>
                <button
                  type="button"
                  onClick={() => toggleExpandAll(false)}
                  className="btn-secondary py-1 text-xs"
                  title="Collapse all variations"
                >
                  Collapse all
                </button>
              </>
            )}

            {canManage && scope !== "all" && (
              <button
                type="button"
                className="btn-secondary py-1 text-xs"
                onClick={() => setScope("all")}
              >
                <PlusIcon className="h-3.5 w-3.5" /> Add supplier to product
              </button>
            )}
          </div>
        </div>

        <Alert message={msg?.text ?? (compareApi.error || undefined)} kind={msg?.kind ?? "error"} />

        {/* Table Content */}
        {compareApi.loading && !compareApi.data ? (
          <TableSkeleton rows={8} />
        ) : filteredRows.length === 0 ? (
          <div className="py-12 text-center">
            <EmptyState
              title={
                filter
                  ? "No suppliers or variations match your filter"
                  : `No supplier rates recorded for ${product.name} yet`
              }
              action={
                scope === "quoted" && (
                  <button className="btn-primary mt-3 text-xs" onClick={() => setScope("all")}>
                    Show All Suppliers
                  </button>
                )
              }
            >
              <p className="mt-1 text-xs text-slate-500">
                Switch to &apos;All suppliers&apos; to view all active suppliers and record rates for this product.
              </p>
            </EmptyState>
          </div>
        ) : !multi ? (
          /* Simple Product: 1 Single Variation Table */
          <div className="overflow-x-auto">
            <table className="table table-stack table-sticky-0">
              <thead>
                <tr>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-10 text-center" />
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Supplier</th>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-36">City / Contact</th>
                  <th
                    data-label="Last Price"
                    className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-44 text-right"
                  >
                    Last Price {lu && <LengthViewToggle className="ml-1" />}
                  </th>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-64 text-right">
                    New Price (₹)
                  </th>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-28 text-center">
                    Status
                  </th>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-36 text-center">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {linesFor(rows[0]!).map((l) => renderSupplierRow(rows[0]!, l, true))}
              </tbody>
            </table>
          </div>
        ) : (
          /* Variable Product: Variations as parent rows with child tables */
          <div className="overflow-x-auto">
            <table className="table table-stack table-sticky-0">
              <thead>
                <tr>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-10 text-center" />
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0]">Variation</th>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-36">Short Code</th>
                  <th
                    data-label="Best Rate"
                    className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-44 text-right"
                  >
                    Best Rate {lu && <LengthViewToggle className="ml-1" />}
                  </th>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-32 text-right">
                    Purchase Cost
                  </th>
                  <th className="sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] w-40 text-center">
                    Suppliers
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const isExpanded = expanded[r.variationId] ?? false;
                  const lines = linesFor(r);

                  return (
                    <Fragment key={r.variationId}>
                      {/* Parent Row */}
                      <tr
                        className="cursor-pointer bg-white hover:bg-slate-50/80 transition-colors"
                        onClick={() => setExpanded((o) => ({ ...o, [r.variationId]: !isExpanded }))}
                      >
                        <td className="stack-hide text-center">
                          <button
                            type="button"
                            className="text-brand-600 font-bold text-base"
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? "Collapse" : "Expand"} ${label(r)}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpanded((o) => ({ ...o, [r.variationId]: !isExpanded }));
                            }}
                          >
                            {isExpanded ? "⊖" : "⊕"}
                          </button>
                        </td>
                        <td>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900">{label(r)}</span>
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                              {r.supplierCount} quote{r.supplierCount === 1 ? "" : "s"}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="font-mono text-xs text-slate-600">{r.shortName}</span>
                        </td>
                        <td className="text-right">
                          {r.best ? (
                            <div>
                              <div className={`font-semibold ${r.supplierCount > 1 ? "text-emerald-700" : "text-slate-900"}`}>
                                {fmtRate(lu, r.best.rate)}
                              </div>
                              <div className="text-[10px] text-slate-400">{r.best.supplierName}</div>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400 italic">No quotes</span>
                          )}
                        </td>
                        <td className="text-right text-xs text-slate-600">
                          {Number(r.purchaseCost) > 0 ? fmtRate(lu, r.purchaseCost) : "—"}
                        </td>
                        <td className="text-center text-xs text-slate-400">
                          {isExpanded ? "Click to collapse" : "Click to view suppliers"}
                        </td>
                      </tr>

                      {/* Child Rows Table (when expanded) */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} className="bg-slate-50/70 p-4 border-y border-slate-200">
                            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
                              <table className="table table-stack">
                                <thead>
                                  <tr>
                                    <th className="bg-slate-100 text-slate-700">Supplier</th>
                                    <th className="bg-slate-100 text-slate-700">City / Contact</th>
                                    <th
                                      data-label="Last Price"
                                      className="bg-slate-100 text-slate-700 text-right w-44"
                                    >
                                      Last Price {lu && <LengthViewToggle className="ml-1" />}
                                    </th>
                                    <th className="bg-slate-100 text-slate-700 text-right w-64">New Price (₹)</th>
                                    <th className="bg-slate-100 text-slate-700 text-center w-28">Status</th>
                                    <th className="bg-slate-100 text-slate-700 text-center w-36">Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lines.length === 0 ? (
                                    <tr>
                                      <td colSpan={6} className="py-6 text-center text-xs text-slate-400">
                                        No suppliers match this filter
                                      </td>
                                    </tr>
                                  ) : (
                                    lines.map((l) => renderSupplierRow(r, l, false))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 bg-white px-4 py-3">
            <span className="text-xs text-slate-500">
              Showing <b>{(page - 1) * pageSize + 1}</b> – <b>{Math.min(page * pageSize, total)}</b> of <b>{total}</b> variations
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-xs text-slate-600 px-2">
                Page <b>{page}</b> of <b>{totalPages}</b>
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Floating Save All Bar */}
      {canManage && editedCount > 0 && (
        <div className="fixed bottom-20 inset-x-0 mx-auto max-w-lg z-30 px-3 lg:bottom-4 lg:px-0">
          <div className="flex items-center justify-between rounded-xl bg-slate-900 px-5 py-3 text-white shadow-xl">
            <div>
              <div className="text-sm font-semibold">
                {editedCount} unsaved price change{editedCount === 1 ? "" : "s"}
              </div>
              <div className="text-xs text-slate-400">Save all changes in one batch</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setNewPrices({})}
                className="rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Discard
              </button>
              <button
                type="button"
                disabled={savingAll}
                onClick={saveAllRecords}
                className="btn-primary py-1.5 px-4 text-xs"
              >
                {savingAll ? "Saving…" : "Save All Records"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price History Modal */}
      {historyVar && (
        <PriceHistoryModal
          title={historyVar.title}
          variationId={historyVar.variationId}
          supplierId={historyVar.supplierId}
          lengthUnit={lu}
          onClose={() => setHistoryVar(null)}
        />
      )}
    </div>
  );
}
