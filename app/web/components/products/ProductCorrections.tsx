"use client";

import { useState } from "react";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import type { Product } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";

interface UsageView {
  product: { unused: boolean; usage: string };
  variations: { id: string; unused: boolean; usage: string }[];
}

/**
 * Fixing daily mistakes on a saved product (docs\CORRECTIONS-AUDIT-2026-10-27.md, P1 + P2):
 * rename an attribute or one of its values everywhere, and delete a variation or the whole
 * product while nothing uses it yet. Anything already used keeps Archive.
 */
export function ProductCorrections({ product, onChanged, onDeleted }: { product: Product; onChanged: () => void; onDeleted: () => void }) {
  const usage = useApi<UsageView>(`/products/${product.id}/usage`);
  const hasAttributes = (product.productType === "variable" || product.productType === "measured") && product.attributes.length > 0;
  const [attribute, setAttribute] = useState(product.attributes[0]?.name ?? "");
  const [value, setValue] = useState("");
  const [newText, setNewText] = useState("");
  const [updateCodes, setUpdateCodes] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const def = product.attributes.find((d) => d.name === attribute);
  const renamingValue = value !== "";

  async function run(fn: () => Promise<string>, after: () => void) {
    setMsg(null);
    setBusy(true);
    try {
      const text = await fn();
      setMsg({ kind: "success", text });
      after();
    } catch (e) {
      setMsg({ kind: "error", text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  const rename = () =>
    run(
      async () => {
        if (!newText.trim()) throw new Error(renamingValue ? "Type the new value" : "Type the new attribute name");
        const body = renamingValue
          ? { attribute, value, newValue: newText.trim(), updateCodes, version: product.version }
          : { attribute, newName: newText.trim(), updateCodes, version: product.version };
        const res = await api<{ renamed: string; variationsChanged: number }>(`/products/${product.id}/attributes/rename`, { method: "POST", body });
        return `${res.renamed} (${res.variationsChanged} variation${res.variationsChanged === 1 ? "" : "s"} updated).`;
      },
      () => {
        if (!renamingValue) setAttribute(newText.trim());
        setValue("");
        setNewText("");
        onChanged();
      },
    );

  const deleteVariation = (id: string, label: string) => {
    if (!window.confirm(`Delete variation ${label}? It was never used, so it is removed for good.`)) return;
    void run(
      async () => {
        await api(`/products/${product.id}/variations/${id}`, { method: "DELETE" });
        return `Variation ${label} deleted.`;
      },
      () => {
        void usage.reload();
        onChanged();
      },
    );
  };

  const deleteProduct = () => {
    if (!window.confirm(`Delete ${product.name} with all its variations? It was never used, so it is removed for good.`)) return;
    void run(
      async () => {
        await api(`/products/${product.id}`, { method: "DELETE" });
        return `${product.name} deleted.`;
      },
      onDeleted,
    );
  };

  const multi = product.productType === "variable" || product.productType === "measured";
  const usageOf = (id: string) => usage.data?.variations.find((v) => v.id === id);

  return (
    <section className="card grid gap-4 p-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Fix mistakes</h2>
        <p className="text-sm text-slate-500">Typing errors can be renamed everywhere. Something created by mistake can be deleted while nothing uses it yet; once used, archive it instead. Old bills always keep the names they were saved with.</p>
      </div>
      <Alert message={msg?.text} kind={msg?.kind} />

      {hasAttributes && (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Rename an attribute or a value</h3>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
            <div>
              <label className="label" htmlFor="fix-attr">Attribute</label>
              <select id="fix-attr" className="input" value={attribute} onChange={(e) => { setAttribute(e.target.value); setValue(""); setNewText(""); }}>
                {product.attributes.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="fix-value">What to rename</label>
              <select id="fix-value" className="input" value={value} onChange={(e) => { setValue(e.target.value); setNewText(""); }}>
                <option value="">The attribute name itself</option>
                {!def?.isQuality && def?.values.map((v) => <option key={v} value={v}>Value: {v}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="fix-new">New {renamingValue ? "value" : "name"}</label>
              <input id="fix-new" className="input" maxLength={renamingValue ? 80 : 60} placeholder={renamingValue ? value : attribute} value={newText} onChange={(e) => setNewText(e.target.value)} />
            </div>
            <button type="button" className="btn-primary" disabled={busy || !attribute} onClick={rename}>Rename</button>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={updateCodes} onChange={(e) => setUpdateCodes(e.target.checked)} />
            Also update Short Names and Official SKUs that were generated automatically (codes typed by hand are kept)
          </label>
        </div>
      )}

      {multi && product.variations.length > 1 && (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Delete a variation created by mistake</h3>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {product.variations.map((v) => {
              const u = usageOf(v.id);
              const label = Object.values(v.attributes).join(" / ") || v.shortName;
              return (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    <span className="font-medium text-slate-900">{label}</span>
                    <span className="ml-2 font-mono text-xs text-slate-500">{v.shortName}</span>
                    {!v.active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">archived</span>}
                  </span>
                  {!u ? (
                    <span className="text-xs text-slate-400">Checking…</span>
                  ) : u.unused ? (
                    <button type="button" className="btn-secondary text-rose-600" disabled={busy} onClick={() => deleteVariation(v.id, label)}>Delete</button>
                  ) : (
                    <span className="text-xs text-slate-500" title="Used variations can only be archived">Used: {u.usage}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50/50 px-3 py-2">
        <div className="text-sm">
          <div className="font-semibold text-rose-800">Delete this product</div>
          <div className="text-rose-900/80">
            {!usage.data ? "Checking whether it is used…" : usage.data.product.unused ? "Never used: it can be deleted with all its variations." : `Cannot be deleted, it is used (${usage.data.product.usage}). Archive it instead.`}
          </div>
        </div>
        <button type="button" className="btn bg-rose-700 text-white hover:bg-rose-800" disabled={busy || !usage.data?.product.unused} onClick={deleteProduct}>Delete product</button>
      </div>
    </section>
  );
}
