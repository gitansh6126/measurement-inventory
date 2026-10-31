"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useCan } from "@/components/MeContext";
import { EditIcon, PlusIcon, ShiftIcon, WarehouseIcon } from "@/components/icons";
import { Alert, EmptyState, Field, Menu, Modal, PageHeader, TableSkeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { money, qty } from "@/lib/format";
import type { Warehouse } from "@/lib/types";
import { errorText } from "@/lib/useApi";
import { useWarehouses } from "@/lib/useWarehouses";

// V3.1 Warehouses page (docs\WAREHOUSE-V3-PLAN.md §4.1). Warehousing is off until the first
// warehouse is created; that one takes all current stock and becomes the default (WH-1).
// Warehouses are never deleted: an empty, non-default one can be deactivated (WH-2).

export default function WarehousesPage() {
  const canManage = useCan("warehouse.manage");
  const canSeeCost = useCan("vendor_pricing.view");
  const router = useRouter();
  const wh = useWarehouses();
  const [modal, setModal] = useState<{ warehouse: Warehouse | null } | null>(null);
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function act(w: Warehouse, path: string, done: string) {
    setFlash(null);
    try {
      await api(`/warehouses/${w.id}/${path}`, { method: "POST", body: {} });
      setFlash({ kind: "success", text: done });
      await wh.reload();
    } catch (e) {
      setFlash({ kind: "error", text: errorText(e) });
    }
  }

  if (!canManage) {
    return (
      <div>
        <PageHeader title="Warehouses" />
        <Alert message="Only an admin manages warehouses." />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Warehouses"
        subtitle={wh.enabled ? `${wh.active.length} active of ${wh.warehouses.length} · default ${wh.defaultWarehouse?.code ?? "—"}` : "Warehousing is not set up"}
        actions={
          wh.enabled ? (
            <div className="flex items-center gap-2">
              <Link href="/shifts/new" className="btn-secondary">
                <ShiftIcon className="h-4 w-4" /> New shift
              </Link>
              <button type="button" className="btn-primary" onClick={() => setModal({ warehouse: null })}>
                <PlusIcon className="h-4 w-4" /> Add warehouse
              </button>
            </div>
          ) : null
        }
      />
      <Alert message={flash?.text} kind={flash?.kind} />
      <Alert message={wh.error} />

      {!wh.loaded ? (
        <div className="card">
          <TableSkeleton />
        </div>
      ) : !wh.enabled ? (
        <div className="card">
          <EmptyState
            icon={<WarehouseIcon className="h-6 w-6" />}
            title="Create your first warehouse"
            action={
              <button type="button" className="btn-primary" onClick={() => setModal({ warehouse: null })}>
                <PlusIcon className="h-4 w-4" /> Create first warehouse
              </button>
            }
          >
            All current stock, rolls and sets will be placed in it and it becomes the default. After that every purchase, sale and stock change names a
            warehouse, and you can add more warehouses and shift stock between them. This cannot be undone (the warehouse can be renamed).
          </EmptyState>
        </div>
      ) : (
        <div className="card overflow-x-auto lg:overflow-x-visible">
          <table className="table table-stack">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th className="text-right">Items</th>
                <th className="text-right">Rolls</th>
                <th className="text-right">Sets</th>
                {canSeeCost && <th className="text-right">Stock value</th>}
                <th>Status</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {wh.warehouses.map((w) => (
                <tr key={w.id} className={`cursor-pointer hover:bg-slate-50 ${w.active ? "" : "opacity-60"}`} onClick={() => router.push(`/inventory?warehouse=${w.id}`)} title="Open Stock In for this warehouse">
                  <td className="font-mono font-semibold text-slate-900">{w.code}</td>
                  <td>
                    <div className="font-medium text-slate-900">{w.name}</div>
                    {w.address && <div className="text-xs text-slate-500">{w.address}</div>}
                  </td>
                  <td className="text-right tabular-nums">{qty(w.items)}</td>
                  <td className="text-right tabular-nums">{qty(w.rolls)}</td>
                  <td className="text-right tabular-nums">{qty(w.sets)}</td>
                  {canSeeCost && <td className="text-right tabular-nums">{money(w.stockValue)}</td>}
                  <td>
                    {w.isDefault && <span className="mr-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">Default</span>}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${w.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{w.active ? "Active" : "Inactive"}</span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Menu
                      compact
                      items={[
                        { label: "Rename / edit", icon: <EditIcon className="h-4 w-4" />, onClick: () => setModal({ warehouse: w }) },
                        ...(w.active && !w.isDefault ? [{ label: "Make default", onClick: () => act(w, "default", `${w.code} is now the default warehouse`) }] : []),
                        ...(w.active && !w.isDefault ? [{ label: "Deactivate", danger: true, onClick: () => act(w, "deactivate", `${w.code} deactivated`) }] : []),
                        ...(!w.active ? [{ label: "Activate", onClick: () => act(w, "activate", `${w.code} activated`) }] : []),
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <WarehouseModal
          warehouse={modal.warehouse}
          first={!wh.enabled}
          onClose={() => setModal(null)}
          onSaved={async (text) => {
            setModal(null);
            setFlash({ kind: "success", text });
            await wh.reload();
            window.dispatchEvent(new Event("rs:warehouses-changed"));
          }}
        />
      )}
    </div>
  );
}

function WarehouseModal({ warehouse, first, onClose, onSaved }: { warehouse: Warehouse | null; first: boolean; onClose: () => void; onSaved: (text: string) => void }) {
  const [code, setCode] = useState(warehouse?.code ?? (first ? "W1" : ""));
  const [name, setName] = useState(warehouse?.name ?? (first ? "Main Godown" : ""));
  const [address, setAddress] = useState(warehouse?.address ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const body = { code: code.trim().toUpperCase(), name: name.trim(), address: address.trim() || null };
      if (warehouse) {
        await api(`/warehouses/${warehouse.id}`, { method: "PATCH", body: { ...body, version: warehouse.version } });
        onSaved(`${body.code} saved`);
      } else {
        await api("/warehouses", { method: "POST", body });
        onSaved(first ? `Warehousing is on: all stock is now in ${body.code} ${body.name}` : `${body.code} ${body.name} added (empty)`);
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={warehouse ? `Edit ${warehouse.code}` : first ? "Create first warehouse" : "Add warehouse"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert message={error} />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Code">
            <input className="input font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} maxLength={10} required placeholder="W2" />
          </Field>
          <Field label="Name" className="col-span-2">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required placeholder="Shop" />
          </Field>
        </div>
        <Field label="Address (optional)">
          <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={300} />
        </Field>
        {first && (
          <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>
              All current stock, rolls and sets go into this warehouse. This takes a moment; other users should stop billing until it finishes. It cannot be
              undone.
            </span>
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy || (first && !confirmed)}>
            {busy ? "Saving…" : warehouse ? "Save" : first ? "Create and place all stock" : "Add warehouse"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
