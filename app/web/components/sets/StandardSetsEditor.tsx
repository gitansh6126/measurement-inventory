"use client";

import { useEffect, useRef, useState } from "react";
import { variationText } from "@/components/sets/SetSheet";
import { useSetTypes } from "@/components/sets/SetTypes";
import type { ByproductDraft } from "@/components/products/GroupedSetCard";
import { ImageEditorModal, type EditorImageItem } from "@/components/products/ImageEditorModal";
import { SpecsEditor, cleanSpecs } from "@/components/products/SpecsEditor";
import { ProductThumb } from "@/components/ProductThumb";
import { Alert } from "@/components/ui";
import { api } from "@/lib/api";
import { variationLabel } from "@/lib/format";
import type { GroupedInfo, Product, TechSpec } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";

// 0041 standard sets (owner 2026-10-28): the usual combinations of a grouped product, each with
// its parts, selling price, minimum selling price and minimum stock. Stock In shows them as child
// rows even at 0 stock and builds sets from them when the count is raised; the Add sets sheet and
// the purchase set sheet fill rows from them. On Add Product they are step 4 of the same form and
// are saved right after the product (owner 2026-10-29: same page, no extra step); on the edit page
// they are saved on their own (PUT /api/sets/types/:id/standard).
// 0044 (owner 2026-10-30): each standard set also has its own technical specifications and image;
// the product page shows that image and those rows when the set is picked, like a variation.

/** One by-product column: a saved link (edit page) or a step 3 draft (Add Product, id = draft key). */
export interface StdLink {
  id: string;
  name: string;
  required: boolean;
  productType: string;
  lengthUnit: "m" | "ft_in" | null;
  variations: { id: string; label: string }[];
}

export interface StdDraft {
  key: number;
  name: string;
  parts: Record<string, { variationId: string; length: string }>;
  salePrice: string;
  minSalePrice: string;
  lowStockThreshold: string;
  specs: TechSpec[];
  image: string;
}

export interface StandardSetBody {
  name: string | null;
  parts: { byproductId: string; variationId: string; length?: number }[];
  salePrice: string;
  minSalePrice: string;
  lowStockThreshold: number;
  specs: TechSpec[];
  imageUrl: string | null;
}

let seq = 0;
const blank = (): StdDraft => ({ key: ++seq, name: "", parts: {}, salePrice: "", minSalePrice: "", lowStockThreshold: "", specs: [], image: "" });
const unitOf = (lu: "m" | "ft_in" | null) => (lu === "ft_in" ? "in" : "m");

/** A part's chosen variation; a required part with one variation (a Simple part) needs no choice. */
const chosen = (l: StdLink, r: StdDraft) => {
  const id = r.parts[l.id]?.variationId ?? "";
  if (l.variations.some((v) => v.id === id)) return id;
  return l.required && l.variations.length === 1 ? l.variations[0]!.id : "";
};

/** Validates the rows and returns the API body; throws a readable Error. Part ids are the links' ids. */
export function standardSetsBody(links: readonly StdLink[], rows: readonly StdDraft[]): StandardSetBody[] {
  const seen = new Set<string>();
  return rows.map((r, i) => {
    const parts = links.flatMap((l): StandardSetBody["parts"] => {
      const variationId = chosen(l, r);
      if (!variationId) {
        if (l.required) throw new Error(`Standard set ${i + 1}: choose the ${l.name}`);
        return [];
      }
      if (l.productType === "measured") {
        const raw = r.parts[l.id]?.length ?? "";
        const n = Number(raw);
        if (!raw.trim() || !Number.isFinite(n) || n <= 0) throw new Error(`Standard set ${i + 1}: enter the ${l.name} length`);
        return [{ byproductId: l.id, variationId, length: n }];
      }
      return [{ byproductId: l.id, variationId }];
    });
    const key = parts.map((p) => `${p.byproductId}:${p.variationId}:${p.length ?? ""}`).join("|");
    if (seen.has(key)) throw new Error(`Standard set ${i + 1} has the same parts as an earlier one`);
    seen.add(key);
    return {
      name: r.name.trim() || null,
      parts,
      salePrice: r.salePrice || "0",
      minSalePrice: r.minSalePrice || "0",
      lowStockThreshold: Number(r.lowStockThreshold || 0),
      specs: cleanSpecs(r.specs),
      imageUrl: r.image || null,
    };
  });
}

const INTRO =
  "The usual combinations of this set, each with its own selling price, minimum selling price and minimum stock. In Stock In and on a purchase you then only type how many sets; the sets are made from these parts (the parts come in as new stock with the set).";

/** The standard sets as cards or a table (shared by Add Product and the edit page). */
export function StandardSetsFields({ title, intro, links, rows, setRows }: { title: string; intro: string; links: StdLink[]; rows: StdDraft[]; setRows: (fn: (rs: StdDraft[]) => StdDraft[]) => void }) {
  const list = rows;
  const patch = (key: number, p: Partial<StdDraft>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const setPart = (key: number, bp: string, p: Partial<StdDraft["parts"][string]>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, parts: { ...r.parts, [bp]: { ...(r.parts[bp] ?? { variationId: "", length: "" }), ...p } } } : r)));
  const duplicateDraft = (r: StdDraft) => {
    setRows((rs) => [...rs, { ...r, key: ++seq, name: r.name ? `${r.name} (Copy)` : "", parts: structuredClone(r.parts), specs: structuredClone(r.specs) }]);
  };
  // One image editor for all cards: `imageFor` is the set being given an image.
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageFor, setImageFor] = useState<number | null>(null);
  const [editorImages, setEditorImages] = useState<EditorImageItem[]>([]);
  const openFile = (key: number) => {
    setImageFor(key);
    fileRef.current?.click();
  };
  const onFiles = (files: FileList | File[]) => {
    const file = Array.from(files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setEditorImages([{ id: `set-${Date.now()}`, source: reader.result as string, name: file.name }]);
    reader.readAsDataURL(file);
  };

  return (
    <>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        <div className="flex items-center gap-2">

          <button type="button" className="btn-secondary py-1 text-xs" onClick={() => setRows((rs) => [...rs, blank()])} disabled={list.length >= 50}>
            + Add standard set
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs text-slate-500">{intro}</p>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <ImageEditorModal
        open={editorImages.length > 0}
        onClose={() => setEditorImages([])}
        context="set"
        images={editorImages}
        onComplete={(urls) => {
          if (urls[0] && imageFor !== null) patch(imageFor, { image: urls[0] });
          setEditorImages([]);
        }}
      />
            {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-sm text-slate-400">{links.length ? "No standard sets yet (optional)." : "Choose the by-products in step 3 first."}</p>
      ) : (
        <div className="space-y-4">
          {list.map((r, i) => (
            <div key={r.key} className="rounded-xl border border-slate-200/90 bg-white shadow-2xs hover:border-slate-300 transition-all overflow-hidden">
              {/* Header */}
              <div className="bg-slate-50/90 px-3.5 py-2 border-b border-slate-200/80 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-[14rem]">
                  <span className="inline-flex items-center justify-center h-6 px-2.5 rounded-full bg-brand-600 text-white text-xs font-bold tracking-wide">
                    #{i + 1}
                  </span>
                  <input
                    className="input py-1 text-xs font-semibold bg-white max-w-xs"
                    maxLength={80}
                    placeholder={`Standard Set ${i + 1} Name`}
                    value={r.name}
                    onChange={(e) => patch(r.key, { name: e.target.value })}
                    aria-label={`Standard set ${i + 1} name`}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-brand-600 font-medium px-2 py-1 rounded hover:bg-white border border-transparent hover:border-slate-200 transition"
                    onClick={() => duplicateDraft(r)}
                    title="Duplicate preset"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-medium px-2 py-1 rounded hover:bg-rose-50 border border-transparent hover:border-rose-100 transition"
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                    title="Remove preset"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="p-3.5 space-y-3.5">
                {/* 0044: this set's own image (shown when the set is picked on the product page) */}
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => openFile(r.key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files?.length) {
                        setImageFor(r.key);
                        onFiles(e.dataTransfer.files);
                      }
                    }}
                    className="group relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 transition hover:border-brand-400 hover:bg-slate-100"
                    title="Click or drop an image file here"
                    aria-label={`Standard set ${i + 1} image`}
                  >
                    {r.image ? (
                      <ProductThumb src={r.image} name={r.name || `Set ${i + 1}`} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-center text-slate-400">
                        <span className="block text-xl">+</span>
                        <span className="block text-[9px]">Upload</span>
                      </span>
                    )}
                  </button>
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Set image</span>
                    <div className="flex items-center gap-2">
                      {r.image ? (
                        <>
                          <button
                            type="button"
                            className="btn-secondary px-2.5 py-1 text-xs"
                            onClick={() => {
                              setImageFor(r.key);
                              setEditorImages([{ id: `set-${r.key}`, source: r.image, name: `${r.name || `Set ${i + 1}`} image` }]);
                            }}
                          >
                            Crop / Edit
                          </button>
                          <button type="button" className="text-xs text-rose-600 hover:underline" onClick={() => patch(r.key, { image: "" })}>
                            Remove
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => openFile(r.key)}>
                          Upload image
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">Shown when this set is picked on the product page.</p>
                  </div>
                </div>

                {/* Components */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Components & Variations
                    </span>
                    <span className="h-px bg-slate-100 flex-1"></span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {links.map((b) => {
                      const p = r.parts[b.id] ?? { variationId: "", length: "" };
                      const isMeasured = b.productType === "measured";
                      return (
                        <div key={b.id} className="flex flex-col justify-between rounded-lg border border-slate-200/90 bg-slate-50/40 p-2.5 transition focus-within:border-brand-500 focus-within:bg-white focus-within:ring-1 focus-within:ring-brand-500/10">
                          <div>
                            <div className="flex items-center justify-between gap-1 mb-1.5">
                              <label className="text-xs font-semibold text-slate-700 truncate" title={b.name}>
                                {b.name}
                                {b.required ? (
                                  <span className="text-rose-500 font-bold ml-0.5" title="Required">*</span>
                                ) : (
                                  <span className="text-[10px] font-normal text-slate-400 ml-1">(optional)</span>
                                )}
                              </label>
                              {isMeasured && (
                                <span className="shrink-0 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">
                                  {unitOf(b.lengthUnit)}
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1.5 py-0.5">
                              {!b.required && (
                                <button
                                  type="button"
                                  onClick={() => setPart(r.key, b.id, { variationId: "" })}
                                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition cursor-pointer select-none ${
                                    !chosen(b, r)
                                      ? "bg-slate-700 text-white shadow-2xs font-semibold"
                                      : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                                  }`}
                                >
                                  None
                                </button>
                              )}
                              {b.variations.map((v) => {
                                const isSelected = chosen(b, r) === v.id;
                                return (
                                  <button
                                    key={v.id}
                                    type="button"
                                    onClick={() => setPart(r.key, b.id, { variationId: isSelected && !b.required ? "" : v.id })}
                                    className={`rounded-full px-3 py-1 text-xs transition cursor-pointer select-none ${
                                      isSelected
                                        ? "bg-brand-600 text-white font-bold shadow-xs ring-1 ring-brand-600"
                                        : "border border-slate-200 bg-white text-slate-700 font-medium hover:border-brand-500 hover:text-brand-600"
                                    }`}
                                  >
                                    {v.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          {isMeasured && (
                            <div className="mt-2 pt-2 border-t border-slate-200/70">
                              <label className="flex items-center justify-between text-[11px] font-medium text-slate-500 mb-1">
                                <span>Length</span>
                                <span className="text-[10px] text-slate-400">in {unitOf(b.lengthUnit)}</span>
                              </label>
                              <div className="relative flex items-center">
                                <input
                                  className="input py-1.5 pr-8 text-xs font-mono bg-white"
                                  inputMode="decimal"
                                  placeholder="Length"
                                  value={p.length}
                                  onChange={(e) => setPart(r.key, b.id, { length: e.target.value })}
                                  aria-label={`Standard set ${i + 1} ${b.name} length`}
                                />
                                <span className="absolute right-2.5 text-xs font-bold text-slate-400 pointer-events-none">
                                  {unitOf(b.lengthUnit)}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Pricing Details */}
                <div className="border-t border-slate-100 pt-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Pricing & Stock Policy
                    </span>
                    <span className="h-px bg-slate-100 flex-1"></span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="label text-[11px] font-semibold text-slate-600 mb-1">
                        Selling Price (₹)
                      </label>
                      <div className="relative flex items-center">
                        <span className="absolute left-2.5 text-xs font-bold text-slate-400 pointer-events-none">₹</span>
                        <input
                          className="input pl-6 py-1.5 text-xs font-semibold"
                          inputMode="numeric"
                          value={r.salePrice}
                          onChange={(e) => patch(r.key, { salePrice: e.target.value.replace(/\D/g, "") })}
                          aria-label={`Standard set ${i + 1} selling price`}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="label text-[11px] font-semibold text-slate-600 mb-1">
                        Min Selling Price (₹)
                      </label>
                      <div className="relative flex items-center">
                        <span className="absolute left-2.5 text-xs font-bold text-slate-400 pointer-events-none">₹</span>
                        <input
                          className="input pl-6 py-1.5 text-xs font-semibold"
                          inputMode="numeric"
                          value={r.minSalePrice}
                          onChange={(e) => patch(r.key, { minSalePrice: e.target.value.replace(/\D/g, "") })}
                          aria-label={`Standard set ${i + 1} minimum selling price`}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="label text-[11px] font-semibold text-slate-600 mb-1">
                        Min Stock Alert
                      </label>
                      <input
                        className="input py-1.5 text-xs"
                        inputMode="numeric"
                        value={r.lowStockThreshold}
                        onChange={(e) => patch(r.key, { lowStockThreshold: e.target.value.replace(/\D/g, "") })}
                        aria-label={`Standard set ${i + 1} minimum stock`}
                      />
                    </div>
                  </div>
                </div>

                {/* 0044: this set's technical specifications */}
                <div className="border-t border-slate-100 pt-3">
                  <SpecsEditor
                    compact
                    label="Technical specifications of this set"
                    hint="Shown after the product's own rows when this set is picked; the same name replaces the product's value."
                    value={r.specs}
                    onChange={(rows) => patch(r.key, { specs: rows })}
                  />
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            className="w-full btn-secondary py-2 text-xs font-semibold flex items-center justify-center gap-1.5 border-dashed border-slate-300 hover:border-brand-500 hover:text-brand-600 transition cursor-pointer"
            onClick={() => setRows((rs) => [...rs, blank()])}
            disabled={list.length >= 50}
          >
            + Add another standard set
          </button>
        </div>
      )}
    </>
  );
}

/** Add Product, step 4: standard sets of the by-products chosen in step 3, saved with the product. */
export function DraftStandardSets({ byproducts, rows, setRows, isPage }: { byproducts: readonly ByproductDraft[]; rows: StdDraft[]; setRows: (fn: (rs: StdDraft[]) => StdDraft[]) => void; isPage: boolean }) {
  const links = useDraftLinks(byproducts);
  return (
    <section className={isPage ? "card p-6" : ""}>
      <StandardSetsFields title="Step 4 · Standard sets" intro={`${INTRO} Optional; they can be changed later on the edit page.`} links={links} rows={rows} setRows={setRows} />
    </section>
  );
}

/** Columns from the step 3 drafts: an existing product's variations, a new Simple part's one. */
export function useDraftLinks(byproducts: readonly ByproductDraft[]): StdLink[] {
  // Same request as the by-product picker in step 3 (shared cache).
  const list = useApi<{ products: Product[] }>("/products?status=active&pageSize=200");
  const byId = new Map((list.data?.products ?? []).map((p) => [p.id, p]));
  return byproducts.flatMap((r): StdLink[] => {
    if (r.mode === "new") {
      if (!r.newName.trim()) return [];
      return [{ id: r.key, name: r.newName.trim(), required: r.required, productType: "simple", lengthUnit: null, variations: [{ id: "new", label: "Fitted" }] }];
    }
    const p = r.productId ? byId.get(r.productId) : undefined;
    if (!p) return [];
    const same = byproducts.filter((x) => x.mode === "existing" && x.productId === r.productId);
    const label = r.label.trim() || (same.length > 1 ? `#${same.findIndex((x) => x.key === r.key) + 1}` : "");
    return [
      {
        id: r.key,
        name: label ? `${p.name} · ${label}` : p.name,
        required: r.required,
        productType: p.productType,
        lengthUnit: p.measure?.lengthUnit ?? null,
        variations: p.variations
          .filter((v) => v.active)
          .map((v) => ({ id: v.id, label: p.productType === "simple" ? "Fitted" : variationLabel(v, p.attributes) || v.shortName })),
      },
    ];
  });
}

/**
 * After Add Product created a grouped product: its step 4 standard sets, with draft keys turned
 * into the saved by-product links (same order as step 3) and a new Simple part's one variation.
 */
export async function saveDraftStandardSets(product: Product, byproducts: readonly ByproductDraft[], sets: readonly StandardSetBody[]) {
  if (!sets.length || !product.grouped) return;
  const saved = product.grouped.byproducts;
  const linkOf = new Map(byproducts.map((d, i) => [d.key, saved[i]]));
  const body = sets.map((s) => ({
    ...s,
    parts: s.parts.map((p) => {
      const link = linkOf.get(p.byproductId);
      if (!link?.variations[0]) throw new Error("A by-product of a standard set was not saved");
      return { ...p, byproductId: link.id, variationId: p.variationId === "new" ? link.variations[0].id : p.variationId };
    }),
  }));
  await api(`/sets/types/${product.id}/standard`, { method: "PUT", body: { sets: body } });
}

/** Edit page: the saved standard sets, saved on their own. */
export function StandardSetsEditor({ productId, info }: { productId: string; info: GroupedInfo }) {
  const { data, error: loadError } = useSetTypes(productId);
  const [rows, setRows] = useState<StdDraft[] | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [saving, setSaving] = useState(false);
  const links: StdLink[] = info.byproducts.map((b) => ({
    id: b.id,
    name: b.name,
    required: b.required,
    productType: b.productType,
    lengthUnit: b.lengthUnit,
    variations: b.variations.map((v) => ({ id: v.id, label: b.productType === "simple" ? "Fitted" : variationText(b, v) })),
  }));

  // Start from the saved standard sets once loaded.
  useEffect(() => {
    if (!data || rows) return;
    setRows(
      data.types
        .filter((t) => t.standard)
        .map((t) => ({
          key: ++seq,
          name: t.name ?? "",
          parts: Object.fromEntries(t.parts.map((p) => [p.byproductId, { variationId: p.variationId, length: p.length != null ? String(p.length) : "" }])),
          salePrice: String(Number(t.salePrice)),
          minSalePrice: String(Number(t.minSalePrice)),
          lowStockThreshold: String(t.lowStockThreshold),
          specs: t.specs ?? [],
          image: t.imageUrl ?? "",
        })),
    );
  }, [data, rows]);

  async function save() {
    setError("");
    setSaved("");
    try {
      const sets = standardSetsBody(links, rows ?? []);
      setSaving(true);
      await api(`/sets/types/${productId}/standard`, { method: "PUT", body: { sets } });
      setSaved(`${sets.length} standard set${sets.length === 1 ? "" : "s"} saved.`);
    } catch (e) {
      setError(e instanceof Error && !("status" in e) ? e.message : errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="standard-sets" className="card p-6">
      <Alert message={loadError} />
      {!rows ? (
        <p className="text-sm text-slate-500">Loading standard sets…</p>
      ) : (
        <StandardSetsFields title="Standard sets" intro={INTRO} links={links} rows={rows} setRows={(fn) => setRows((rs) => fn(rs ?? []))} />
      )}
      <div className="mt-3">
        <Alert message={error} />
        <Alert kind="success" message={saved} />
      </div>
      <div className="mt-2 flex justify-end">
        <button type="button" className="btn-primary" disabled={saving || !rows} onClick={() => void save()}>
          {saving ? "Saving…" : "Save standard sets"}
        </button>
      </div>
    </section>
  );
}
