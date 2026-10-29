"use client";

import { Combobox } from "@/components/Combobox";
import { Field } from "@/components/ui";
import { UNIT_SUGGESTIONS, type Product } from "@/lib/types";
import { useApi } from "@/lib/useApi";

// V3.1 grouped product (set) form steps 2–3 (docs\GROUPED-PRODUCTS-V3-PLAN.md §2): the main
// component is always created new and is always Simple (D2, D3); by-products are linked as
// products — existing, or a new Simple product typed here (D5) — required or optional (D6).
// No variation, quantity or length is fixed here: those are chosen per set at purchase (D7, D8).
// The same product may be added more than once (a hoist with two chains); a label tells them apart.

export interface MainDraft {
  name: string;
  shortName: string;
  unit: string;
}

export interface ByproductDraft {
  key: string;
  mode: "existing" | "new";
  productId: string | null;
  required: boolean;
  label: string;
  newName: string;
  newShortName: string;
  newUnit: string;
}

export const newMainDraft = (): MainDraft => ({ name: "", shortName: "", unit: "Nos" });

let seq = 0;
export const newByproductDraft = (): ByproductDraft => ({
  key: `bp-${++seq}`,
  mode: "existing",
  productId: null,
  required: true,
  label: "",
  newName: "",
  newShortName: "",
  newUnit: "Nos",
});

const TYPE_LABEL: Record<string, string> = { simple: "Simple", variable: "Variable", measured: "Measured" };

/** Request body part for POST /api/products (productType "grouped"). */
export function groupedBodyParts(main: MainDraft, rows: readonly ByproductDraft[], categoryId: string | null) {
  if (!rows.length) throw new Error("Add at least one by-product in step 3");
  return {
    main: { name: main.name.trim(), shortName: main.shortName.trim().toUpperCase(), unit: main.unit.trim() },
    byproducts: rows.map((r, i) => {
      if (r.mode === "existing") {
        if (!r.productId) throw new Error(`By-product ${i + 1}: choose a product or switch to "Create new"`);
        return { productId: r.productId, required: r.required, label: r.label.trim() || null };
      }
      if (!r.newName.trim() || !r.newShortName.trim()) throw new Error(`By-product ${i + 1}: enter the new product's name and Short Name`);
      return {
        required: r.required,
        newProduct: { productType: "simple", name: r.newName.trim(), shortName: r.newShortName.trim().toUpperCase(), unit: r.newUnit.trim() || "Nos", categoryId, imageUrl: null },
      };
    }),
  };
}

export function GroupedSetCard({
  main,
  setMain,
  rows,
  setRows,
  isPage,
}: {
  main: MainDraft;
  setMain: (m: MainDraft) => void;
  rows: ByproductDraft[];
  setRows: (fn: (r: ByproductDraft[]) => ByproductDraft[]) => void;
  isPage: boolean;
}) {
  // Possible by-products: active Simple / Variable / Measured products (the list already hides
  // main components of other sets).
  const list = useApi<{ products: Product[] }>("/products?status=active&pageSize=200");
  const options = (list.data?.products ?? [])
    .filter((p) => p.productType !== "grouped")
    .map((p) => ({
      id: p.id,
      label: p.name,
      sublabel: `${TYPE_LABEL[p.productType] ?? p.productType} · ${p.variations.length} variation${p.variations.length === 1 ? "" : "s"}`,
      keywords: p.variations.map((v) => v.shortName).join(" "),
    }));
  const update = (key: string, patch: Partial<ByproductDraft>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const units = (u: string) => [...new Set([...UNIT_SUGGESTIONS, u].filter(Boolean))].map((x) => ({ id: x, label: x }));

  return (
    <>
      <section className={isPage ? "card p-6" : ""}>
        <h2 className="text-base font-semibold text-slate-900">Step 2 · Main component</h2>
        <p className="mb-4 mt-0.5 text-xs text-slate-500">
          Always a new Simple product, created with this set (e.g. the hoist body). It is 1 per set and in V3 is not sold, bought or stocked on its own.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name *" className="sm:col-span-3">
            <input className="input" required maxLength={150} placeholder="e.g. Hoist Body 1 Ton" value={main.name} onChange={(e) => setMain({ ...main, name: e.target.value })} />
          </Field>
          <Field label="Short Name *">
            <input
              className="input font-mono uppercase"
              required
              maxLength={80}
              placeholder="e.g. HB-1T"
              value={main.shortName}
              onChange={(e) => setMain({ ...main, shortName: e.target.value.toUpperCase() })}
            />
          </Field>
          <div>
            <span className="label">Unit *</span>
            <Combobox
              value={main.unit}
              options={units(main.unit)}
              onSelect={(u) => setMain({ ...main, unit: u ?? "" })}
              onCreate={(q) => setMain({ ...main, unit: q.trim() })}
              createLabel={(q) => `Use unit “${q}”`}
              required
            />
          </div>
        </div>
      </section>

      <section className={isPage ? "card p-6" : ""}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Step 3 · By-products</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Parts that go into every set (e.g. the chain, a hook). Variation and length are picked per set when you buy or enter sets.
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => setRows((rs) => [...rs, newByproductDraft()])} disabled={rows.length >= 10}>
            + Add by-product
          </button>
        </div>

        {rows.length === 0 && <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">Add at least one by-product.</p>}

        <ul className="mt-4 grid gap-3">
          {rows.map((r, i) => (
            <li key={r.key} className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-slate-800">By-product {i + 1}</span>
                <div className="flex overflow-hidden rounded-lg border border-slate-200 text-xs" role="radiogroup" aria-label={`By-product ${i + 1} source`}>
                  {(["existing", "new"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={r.mode === m}
                      onClick={() => update(r.key, { mode: m })}
                      className={`px-3 py-1.5 ${r.mode === m ? "bg-brand-500 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
                    >
                      {m === "existing" ? "Existing product" : "Create new (Simple)"}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={r.required} onChange={(e) => update(r.key, { required: e.target.checked })} />
                  Required in every set
                </label>
                <button type="button" className="ml-auto text-xs text-red-600 hover:underline" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                  Remove
                </button>
              </div>

              {r.mode === "existing" && (
                <Combobox
                  value={r.productId}
                  options={options}
                  onSelect={(id) => update(r.key, { productId: id })}
                  placeholder={list.loading ? "Loading products…" : "Search Simple, Variable or Measured products…"}
                  emptyText="No matching product — use “Create new”"
                />
              )}
              {r.mode === "existing" && r.productId && rows.filter((x) => x.mode === "existing" && x.productId === r.productId).length > 1 && (
                <Field label="Label (tells repeats apart)" className="mt-3">
                  <input
                    className="input"
                    maxLength={60}
                    placeholder={`e.g. Load chain / Hand chain — blank = #${rows.filter((x) => x.mode === "existing" && x.productId === r.productId).findIndex((x) => x.key === r.key) + 1}`}
                    value={r.label}
                    onChange={(e) => update(r.key, { label: e.target.value })}
                  />
                </Field>
              )}
              {r.mode === "new" && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Name *" className="sm:col-span-3">
                    <input className="input" maxLength={150} placeholder="e.g. Safety Hook 1 Ton" value={r.newName} onChange={(e) => update(r.key, { newName: e.target.value })} />
                  </Field>
                  <Field label="Short Name *">
                    <input className="input font-mono uppercase" maxLength={80} placeholder="e.g. SH-1T" value={r.newShortName} onChange={(e) => update(r.key, { newShortName: e.target.value.toUpperCase() })} />
                  </Field>
                  <div>
                    <span className="label">Unit</span>
                    <Combobox value={r.newUnit} options={units(r.newUnit)} onSelect={(u) => update(r.key, { newUnit: u ?? "" })} onCreate={(q) => update(r.key, { newUnit: q.trim() })} createLabel={(q) => `Use unit “${q}”`} />
                  </div>
                  <p className="text-xs text-slate-500 sm:col-span-3">Variable or Measured parts: create them on the Products page first, then pick them here.</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
