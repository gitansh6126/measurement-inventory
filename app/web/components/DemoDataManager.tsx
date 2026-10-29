"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BoxesIcon,
  CartIcon,
  DatabaseIcon,
  LayersIcon,
  PackageIcon,
  TrashIcon,
  TruckIcon,
  WarehouseIcon,
  WarnIcon,
} from "@/components/icons";
import { Alert, Modal, StatCell, StatStrip } from "@/components/ui";
import { api } from "@/lib/api";
import { errorText, useApi } from "@/lib/useApi";

export interface DemoStatus {
  enabled: boolean;
  environment: string;
  demoResetEnabled: boolean;
  isEmpty: boolean;
  counts: {
    products: number;
    variations: number;
    categories: number;
    sales: number;
    purchases: number;
    warehouses: number;
    sets: number;
    parties: number;
    stockMovements: number;
  };
}

export function DemoDataManager({
  onDone,
  title = "Demo Data Management",
  subtitle = "Toggle between clean/empty data and rich demo sample data",
  compact = false,
}: {
  onDone?: () => unknown;
  title?: string;
  subtitle?: string;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: status, reload, error: loadError } = useApi<DemoStatus>("/demo/status");

  const [confirmCleanOpen, setConfirmCleanOpen] = useState(false);
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState("");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleClean() {
    setBusy(true);
    setBusyText("Clearing all data…");
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await api<{ success: boolean; message: string }>("/demo/clean", {
        method: "POST",
      });
      setConfirmCleanOpen(false);
      setSuccessMsg(res.message || "All inventory data emptied. Clean state active.");
      await reload();
      queryClient.invalidateQueries();
      window.dispatchEvent(new Event("rs:warehouses-changed"));
      await onDone?.();
    } catch (err) {
      setErrorMsg(`Failed to clean data: ${errorText(err)}`);
    } finally {
      setBusy(false);
      setBusyText("");
    }
  }

  async function handleApply() {
    setBusy(true);
    setBusyText("Applying demo dataset (this takes 2–3 seconds)…");
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await api<{
        success: boolean;
        message: string;
        counts: Record<string, number>;
      }>("/demo/apply", {
        method: "POST",
      });
      setConfirmApplyOpen(false);
      const c = res.counts;
      setSuccessMsg(
        res.message ||
          `Demo data applied: ${c.products || 11} products, ${c.sales || 6} sales, ${c.warehouses || 2} warehouses seeded.`
      );
      await reload();
      queryClient.invalidateQueries();
      window.dispatchEvent(new Event("rs:warehouses-changed"));
      await onDone?.();
    } catch (err) {
      setErrorMsg(`Failed to apply demo data: ${errorText(err)}`);
    } finally {
      setBusy(false);
      setBusyText("");
    }
  }

  if (loadError) {
    return <Alert kind="error">{loadError}</Alert>;
  }

  if (!status) {
    return <div className="card p-5 text-sm text-slate-500">Loading demo data status…</div>;
  }

  return (
    <div className="card space-y-5 p-6 border-slate-200">
      {/* Header with Active State Badge */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {status.isEmpty ? (
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 border border-slate-200">
                Clean / Empty State
              </span>
            ) : (
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 border border-emerald-200">
                Demo Data Active
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-slate-400">
            ENV: {status.environment}
          </span>
        </div>
      </div>

      {/* Notifications */}
      {successMsg && <Alert kind="success">{successMsg}</Alert>}
      {errorMsg && <Alert kind="error">{errorMsg}</Alert>}
      {busy && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3.5 text-xs text-sky-800 flex items-center gap-2">
          <svg className="animate-spin h-4 w-4 text-sky-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span className="font-medium">{busyText}</span>
        </div>
      )}

      {/* Current Data Overview */}
      {!compact && (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Current Workspace Content
          </div>
          <StatStrip cols={4}>
            <StatCell
              icon={<PackageIcon className="h-4 w-4" />}
              label="Products"
              value={status.counts.products}
              sub={`${status.counts.variations} variations`}
              tone="blue"
            />
            <StatCell
              icon={<BoxesIcon className="h-4 w-4" />}
              label="Stock Movements"
              value={status.counts.stockMovements}
              sub="ledger entries"
              tone="orange"
            />
            <StatCell
              icon={<CartIcon className="h-4 w-4" />}
              label="Orders & Sales"
              value={status.counts.sales + status.counts.purchases}
              sub={`${status.counts.sales} sales, ${status.counts.purchases} purchases`}
              tone="green"
            />
            <StatCell
              icon={<WarehouseIcon className="h-4 w-4" />}
              label="Facilities & Sets"
              value={status.counts.warehouses}
              sub={`${status.counts.sets} sets assembled`}
              tone="violet"
            />
          </StatStrip>
        </div>
      )}

      {/* Two Action Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* ACTION 1: CLEAN / EMPTY DATA */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 flex flex-col justify-between hover:border-slate-300 transition-colors">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-slate-900 font-medium text-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-100 text-rose-600">
                <TrashIcon className="h-4 w-4" />
              </span>
              <span>Clean / Empty Data</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Clear all products, inventory, transactions, orders, contacts, and warehouses.
              Leaves a blank workspace so you can test adding fresh products or recording clean orders.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">Users stay signed in</span>
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setSuccessMsg(null);
                setConfirmCleanOpen(true);
              }}
              disabled={busy || status.isEmpty}
              className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 text-rose-700 hover:bg-rose-50 hover:border-rose-300 disabled:opacity-40"
            >
              <TrashIcon className="h-3.5 w-3.5" />
              {status.isEmpty ? "Already Empty" : "Empty Data"}
            </button>
          </div>
        </div>

        {/* ACTION 2: APPLY DEMO DATA */}
        <div className="rounded-xl border border-brand-200 bg-brand-50/30 p-4 flex flex-col justify-between hover:border-brand-300 transition-colors">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-slate-900 font-medium text-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
                <DatabaseIcon className="h-4 w-4" />
              </span>
              <span>Apply Demo Data</span>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Populate the complete sample inventory dataset: counted products, measured metric &amp; imperial reels,
              chain hoist sets with standard types, warehouses (Main Godown + Shop), supplier price cards, and sample orders.
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-brand-200/60 flex items-center justify-between">
            <span className="text-[11px] text-brand-700 font-medium">1-Click Full Seed</span>
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setSuccessMsg(null);
                setConfirmApplyOpen(true);
              }}
              disabled={busy}
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50"
            >
              <DatabaseIcon className="h-3.5 w-3.5" />
              Apply Demo Data
            </button>
          </div>
        </div>
      </div>

      {/* CONFIRMATION MODAL: CLEAN / EMPTY DATA */}
      <Modal open={confirmCleanOpen} title="Reset to Clean / Empty Data?" onClose={() => !busy && setConfirmCleanOpen(false)}>
        <div className="space-y-4 text-sm text-slate-700">
          <p>
            This action will clear all products, stock records, sales, purchases, warehouses, and contacts in this workspace.
          </p>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
            <WarnIcon className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
            <span>
              Your user account and login remain intact. You will be able to start with a clean slate or apply demo data again anytime.
            </span>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setConfirmCleanOpen(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger flex items-center gap-2"
              onClick={handleClean}
              disabled={busy}
            >
              {busy ? "Emptying…" : "Yes, Empty All Data"}
            </button>
          </div>
        </div>
      </Modal>

      {/* CONFIRMATION MODAL: APPLY DEMO DATA */}
      <Modal open={confirmApplyOpen} title="Apply RS Demo Dataset?" onClose={() => !busy && setConfirmApplyOpen(false)}>
        <div className="space-y-4 text-sm text-slate-700">
          <p>
            This will populate your workspace with the comprehensive RS demo dataset, including:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-xs text-slate-600">
            <li>Counted &amp; Variable products (Hoists, Clamps, Shackles with ratings)</li>
            <li>Measured stock (Wire Rope on Reels, Alloy Chain on Drums in Metres &amp; Feet)</li>
            <li>Chain Hoist Sets with standard configured types</li>
            <li>Two warehouses (W1 Main Godown + W2 Shop) with inventory shifts</li>
            <li>Customers, suppliers, and vendor price revision history</li>
            <li>Sample sales orders, delivery dispatches, shortage orders, and procurement</li>
          </ul>
          <p className="text-xs text-slate-500">
            Any existing workspace data will be refreshed with the fresh demo dataset. Takes ~2–3 seconds.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setConfirmApplyOpen(false)}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary flex items-center gap-2"
              onClick={handleApply}
              disabled={busy}
            >
              {busy ? "Applying…" : "Yes, Apply Demo Data"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
