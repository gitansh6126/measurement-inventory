"use client";

import { comboKey, type AttributeDraft } from "@rs-v31/shared";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Combobox } from "@/components/Combobox";
import { useCan } from "@/components/MeContext";
import { CategoryModal } from "./CategoryModal";
import { HeadCategoryPicker } from "./HeadCategoryPicker";
import { Alert, Field } from "@/components/ui";
import { scrollToAndHighlightField } from "@/lib/formFeedback";
import { api } from "@/lib/api";
import { UNIT_SUGGESTIONS, type CategoryList, type Product, type ProductType } from "@/lib/types";
import { errorText, useApi } from "@/lib/useApi";
import { GroupedSetCard, groupedBodyParts, newByproductDraft, newMainDraft, type ByproductDraft, type MainDraft } from "./GroupedSetCard";
import { DraftStandardSets, saveDraftStandardSets, standardSetsBody, useDraftLinks, type StdDraft } from "@/components/sets/StandardSetsEditor";
import { MeasurementCard, newMeasureDraft, type MeasureDraft } from "./MeasurementCard";
import { ProductImageGallery } from "./ProductImageGallery";
import {
  VariationBuilder,
  draftsFromStored,
  newAttr,
  orderedKeys,
  refreshCombos,
  storedDefs,
  type Combo,
  type SavedCombo,
} from "./VariationBuilder";

const TYPES = [
  { id: "simple" as const, label: "Simple Product", desc: "Single item, one Short Name" },
  {
    id: "variable" as const,
    label: "Variable (Size / Material / Color)",
    desc: "Auto-generate Short Names for every combination",
  },
  // V2 plan §2.4 (DM-1): rolls sold by length, always with variations.
  { id: "measured" as const, label: "Measured", desc: "Rolls cut to length, always with variations" },
  // V3.1: a set = new main component + by-products (docs\GROUPED-PRODUCTS-V3-PLAN.md).
  { id: "grouped" as const, label: "Grouped (Set)", desc: "Main part + by-products sold together, e.g. hoist + chain" },
];

const finite = (n: number) => (Number.isFinite(n) ? n : null);

export interface ProductFormProps {
  product?: Product | null;
  presetCategoryId?: string;
  /** V3.1: a category of a head other than Product Type to tick on a new product. */
  presetHeadCategoryId?: string;
  onSaved: (product: Product, created: boolean) => void;
  onCancel?: () => void;
  isPage?: boolean;
}

export function ProductForm({
  product,
  presetCategoryId,
  presetHeadCategoryId,
  onSaved,
  onCancel,
  isPage = false,
}: ProductFormProps) {
  const isEdit = !!product;
  const cats = useApi<CategoryList>("/categories");
  // V3.1: a Product Type category typed in the dropdown is created on the spot (with an image).
  const canCreateCategory = useCan("category.write");
  const [newType, setNewType] = useState<string | null>(null);
  const [typeNote, setTypeNote] = useState("");
  const [type, setType] = useState<ProductType>("simple");
  const [measure, setMeasure] = useState<MeasureDraft>(newMeasureDraft);
  const [main, setMain] = useState<MainDraft>(newMainDraft);
  const [byproducts, setByproducts] = useState<ByproductDraft[]>(() => [newByproductDraft()]);
  // 0041: step 4 standard sets of a new grouped product, saved right after it is created.
  const [stdRows, setStdRows] = useState<StdDraft[]>([]);
  const stdLinks = useDraftLinks(byproducts);
  const [f, setF] = useState({
    name: "",
    shortName: "",
    sku: "",
    unit: "Piece",
    categoryId: "",
    description: "",
  });
  // V3.1: categories under other heads (any number).
  const [headCats, setHeadCats] = useState<string[]>([]);
  // V3.1 (0038): categories ticked for some variations only → their combination keys.
  const [varScopes, setVarScopes] = useState<Record<string, string[]>>({});
  const [images, setImages] = useState<string[]>([]);
  const [defs, setDefsState] = useState<AttributeDraft[]>([newAttr()]);
  const [combos, setCombosState] = useState<Combo[]>([]);
  // Variation keys (saved and new) in the order arranged in the builder.
  const [varOrder, setVarOrder] = useState<string[]>([]);
  const [savedVariationImages, setSavedVariationImages] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const clearFieldError = (key: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setError("");
  };
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setError("");
    setSaving(false);
    setCombosState([]);
    setVarOrder(product ? product.variations.map((v) => comboKey(v.attributes)) : []);

    if (product) {
      setType(product.productType);
      setF({
        name: product.name,
        shortName: product.baseShortName,
        sku: product.variations[0]?.officialSku ?? "",
        unit: product.unit,
        categoryId: product.category?.id ?? "",
        description: product.description ?? "",
      });
      setHeadCats([...(product.categories ?? []), ...(product.variationCategories ?? [])].map((c) => c.id));
      const keyOf = new Map(product.variations.map((v) => [v.id, comboKey(v.attributes)]));
      setVarScopes(Object.fromEntries((product.variationCategories ?? []).map((c) => [c.id, c.variationIds.flatMap((id) => keyOf.get(id) ?? [])])));
      const initialGallery =
        product.gallery && product.gallery.length > 0
          ? product.gallery
          : product.imageUrl
            ? [product.imageUrl]
            : [];
      setImages(initialGallery);
      const initialVarImages: Record<string, string> = {};
      if (product.variations) {
        for (const v of product.variations) {
          if (v.imageUrl) initialVarImages[v.id] = v.imageUrl;
        }
      }
      setSavedVariationImages(initialVarImages);
      setDefsState(
        product.productType === "variable" || product.productType === "measured"
          ? draftsFromStored(product.attributes as AttributeDraft[])
          : [newAttr()]
      );
      const m = product.measure;
      setMeasure(
        m
          ? { lengthUnit: m.lengthUnit, rollName: m.rollName ?? "", defaultRollLength: m.defaultRollLength ?? NaN }
          : newMeasureDraft()
      );
    } else {
      setType("simple");
      setF({
        name: "",
        shortName: "",
        sku: "",
        unit: "Piece",
        categoryId: presetCategoryId ?? "",
        description: "",
      });
      setHeadCats(presetHeadCategoryId ? [presetHeadCategoryId] : []);
      setVarScopes({});
      setImages([]);
      setSavedVariationImages({});
      setDefsState([newAttr()]);
      setMeasure(newMeasureDraft());
      setMain(newMainDraft());
      setByproducts([newByproductDraft()]);
    }
  }, [product, presetCategoryId, presetHeadCategoryId]);

  // Picking "Grouped (Set)" suggests the unit "Set" (any unit is allowed).
  const chooseType = (t: ProductType) => {
    setType(t);
    if (t === "grouped" && (f.unit === "Piece" || !f.unit)) setF((x) => ({ ...x, unit: "Set" }));
    if (t !== "grouped" && f.unit === "Set") setF((x) => ({ ...x, unit: "Piece" }));
  };

  const saved: SavedCombo[] = useMemo(
    () =>
      product && (product.productType === "variable" || product.productType === "measured")
        ? product.variations.map((v) => ({
            id: v.id,
            key: comboKey(v.attributes),
            attrs: v.attributes,
            shortName: v.shortName,
            officialSku: v.officialSku,
            active: v.active,
            image: savedVariationImages[v.id] !== undefined ? savedVariationImages[v.id] : (v.imageUrl ?? ""),
          }))
        : [],
    [product, savedVariationImages]
  );

  const handleUpdateSavedImage = (vId: string, imgUrl: string) => {
    setSavedVariationImages((prev) => ({ ...prev, [vId]: imgUrl }));
  };

  const setDefs = (fn: (d: AttributeDraft[]) => AttributeDraft[]) => {
    const next = fn(defs);
    setDefsState(next);
    setCombosState((c) => refreshCombos(c, f.shortName, next));
  };

  const setCombos = (fn: (c: Combo[]) => Combo[]) => setCombosState(fn);

  const setBase = (v: string) => {
    const upper = v.toUpperCase();
    setF((x) => ({ ...x, shortName: upper }));
    setCombosState((c) => refreshCombos(c, upper, defs));
  };

  const categoryOptions = [
    ...(cats.data?.categories ?? []).map((c) => ({
      id: c.id,
      label: c.name,
      sublabel: `${c.productCount} products`,
    })),
    ...(product?.category && !cats.data?.categories.some((c) => c.id === product.category!.id)
      ? [{ id: product.category.id, label: product.category.name, sublabel: "inactive" }]
      : []),
  ];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setFieldErrors({});

    // Client-side validations with smooth scroll & pulse to first missing field
    if (!f.name.trim()) {
      setFieldErrors((prev) => ({ ...prev, name: "Product name is required" }));
      setError("Please enter the Product Name");
      scrollToAndHighlightField("field-product-name");
      return;
    }

    if (!f.shortName.trim()) {
      setFieldErrors((prev) => ({ ...prev, shortName: "Short name is required" }));
      setError("Please enter the Short Name / Code");
      scrollToAndHighlightField("field-product-shortname");
      return;
    }

    if (type !== "measured" && !f.unit.trim()) {
      setFieldErrors((prev) => ({ ...prev, unit: "Unit is required" }));
      setError("Please select or type a unit");
      scrollToAndHighlightField("field-product-unit");
      return;
    }

    if (type === "grouped" && !main.name.trim()) {
      setError("Please enter the main component name for this set");
      scrollToAndHighlightField("field-grouped-main");
      return;
    }

    const primaryImage = images.length > 0 ? images[0] : null;
    // V3.1 (0038): "Only some" applies to Variable / Measured products only; else all variations.
    const withScopes = type === "variable" || type === "measured";
    const scoped = withScopes ? Object.fromEntries(Object.entries(varScopes).filter(([id]) => headCats.includes(id))) : {};
    const emptyScope = Object.entries(scoped).find(([, keys]) => keys.length === 0);
    if (emptyScope) {
      setError("A category set to “Only some” has no variation ticked: tick at least one, or choose All variations.");
      scrollToAndHighlightField("field-head-categories");
      return;
    }
    const scopedOf = (key: string) => Object.entries(scoped).filter(([, keys]) => keys.includes(key)).map(([id]) => id);
    const common = {
      name: f.name.trim(),
      unit: f.unit.trim(),
      description: f.description.trim() || null,
      imageUrl: primaryImage,
      gallery: images,
      categoryIds: headCats.filter((id) => !scoped[id]),
    };

    const measured = type === "measured";
    // Default roll per variation is typed in metres, or in feet for feet + inches products.
    const rollOf = (c: (typeof combos)[number]) => {
      const n = Number(c.rollLength);
      if (!measured || !c.rollLength?.trim() || !Number.isFinite(n) || n <= 0) return {};
      return { defaultRollLength: measure.lengthUnit === "ft_in" ? Math.round(n * 12 * 1000) / 1000 : n };
    };
    const keysInOrder = orderedKeys(varOrder, [...saved.map((s) => s.key), ...combos.map((c) => c.key)]);
    const rank = (k: string) => keysInOrder.indexOf(k);
    const newVariations = [...combos].sort((a, b) => rank(a.key) - rank(b.key)).map((c) => ({
      attributes: c.attrs,
      shortName: c.shortName,
      officialSku: c.sku.trim() || null,
      imageUrl: c.image || null,
      ...rollOf(c),
      ...(scopedOf(c.key).length ? { categoryIds: scopedOf(c.key) } : {}),
    }));
    const measureBody = {
      lengthUnit: measure.lengthUnit,
      rollName: measure.rollName.trim() || null,
      defaultRollLength: finite(measure.defaultRollLength),
    };

    setSaving(true);
    try {
      let result: Product;
      if (!isEdit) {
        if ((type === "variable" || type === "measured") && !newVariations.length && !saved.length) {
          const msg = measured ? "A measured product needs at least one variation: create it in step 2 of the builder" : "Create at least one variation in step 2 of the builder";
          setError(msg);
          setSaving(false);
          scrollToAndHighlightField("field-variation-builder");
          return;
        }
        const body =
          type === "grouped"
            ? {
                productType: "grouped",
                ...common,
                categoryId: f.categoryId || null,
                shortName: f.shortName,
                officialSku: f.sku.trim() || null,
                ...groupedBodyParts(main, byproducts, f.categoryId || null),
              }
            : type === "simple"
            ? {
                productType: "simple",
                ...common,
                categoryId: f.categoryId || null,
                shortName: f.shortName,
                officialSku: f.sku.trim() || null,
              }
            : {
                productType: type,
                ...common,
                categoryId: f.categoryId || null,
                baseShortName: f.shortName,
                attributes: storedDefs(defs),
                variations: newVariations,
                ...(measured ? { measure: measureBody } : {}),
              };
        // Checked before the product is created, so a mistake there creates nothing.
        const stdSets = type === "grouped" ? standardSetsBody(stdLinks, stdRows) : [];
        result = (await api<{ product: Product }>("/products", { method: "POST", body })).product;
        if (stdSets.length) {
          try {
            await saveDraftStandardSets(result, byproducts, stdSets);
          } catch {
            // The product exists: finish the standard sets on its edit page instead of creating it twice.
            window.location.assign(`/products/${result.id}/edit#standard-sets`);
            return;
          }
        }
      } else {
        const patch: Record<string, unknown> = { ...common };
        const had = (product!.categories ?? []).map((c) => c.id);
        const wholeNow = common.categoryIds;
        if (had.length === wholeNow.length && had.every((id) => wholeNow.includes(id))) delete patch.categoryIds;
        if (withScopes) {
          // Saved variations only; new ones get theirs when they are added below.
          patch.variationCategories = Object.entries(scoped).map(([categoryId, keys]) => ({
            categoryId,
            variationIds: product!.variations.filter((v) => keys.includes(comboKey(v.attributes))).map((v) => v.id),
          }));
        }
        if ((f.categoryId || null) !== (product!.category?.id ?? null)) {
          patch.categoryId = f.categoryId || null;
        }
        if (product!.productType === "simple" || product!.productType === "grouped") {
          Object.assign(patch, { shortName: f.shortName, officialSku: f.sku.trim() || null });
        } else {
          Object.assign(patch, { baseShortName: f.shortName, attributes: storedDefs(defs) });
        }
        if (product!.productType === "measured") {
          // The unit follows the length unit on the server.
          delete patch.unit;
          patch.measure = measureBody;
        }
        // V2 (plan §1.5): if someone else saved this product meanwhile, the API answers 409
        // VERSION_CONFLICT instead of silently overwriting their change.
        if (product!.version) patch.version = product!.version;
        result = (
          await api<{ product: Product }>(`/products/${product!.id}`, {
            method: "PATCH",
            body: patch,
          })
        ).product;

        if (newVariations.length) {
          result = (
            await api<{ product: Product }>(`/products/${product!.id}/variations`, {
              method: "POST",
              body: { variations: newVariations },
            })
          ).product;
        }

        // New variations are appended on the server: apply the order arranged in the builder.
        if (withScopes && result.variations.length > 1) {
          const sorted = [...result.variations].sort((a, b) => rank(comboKey(a.attributes)) - rank(comboKey(b.attributes)));
          if (keysInOrder.length === sorted.length && sorted.some((v, i) => v.id !== result.variations[i]!.id)) {
            await api(`/products/${product!.id}/variations/order`, { method: "PUT", body: { variationIds: sorted.map((v) => v.id) } });
            result = { ...result, variations: sorted };
          }
        }

        // Update images of any existing variations that changed
        if (product && (product.productType === "variable" || product.productType === "measured") && product.variations) {
          for (const v of product.variations) {
            const nextImg = savedVariationImages[v.id];
            if (nextImg !== undefined && nextImg !== (v.imageUrl ?? "")) {
              await api(`/products/${product.id}/variations/${v.id}`, {
                method: "PATCH",
                body: { imageUrl: nextImg || null },
              });
            }
          }
        }
      }
      onSaved(result, !isEdit);
    } catch (err) {
      const msg = err instanceof Error && !("status" in err) ? err.message : errorText(err);
      setError(msg);
      setSaving(false);

      const lower = msg.toLowerCase();
      if (lower.includes("short name") || lower.includes("short_name")) {
        setFieldErrors((prev) => ({ ...prev, shortName: msg }));
        scrollToAndHighlightField("field-product-shortname");
      } else if (lower.includes("sku") || lower.includes("official_sku")) {
        setFieldErrors((prev) => ({ ...prev, sku: msg }));
        scrollToAndHighlightField("field-product-sku");
      } else if (lower.includes("name") && (lower.includes("product") || lower.includes("taken"))) {
        setFieldErrors((prev) => ({ ...prev, name: msg }));
        scrollToAndHighlightField("field-product-name");
      } else if (lower.includes("variation") || lower.includes("combination")) {
        scrollToAndHighlightField("field-variation-builder");
      } else {
        scrollToAndHighlightField("form-general-error");
      }
    }
  }

  const variable = type === "variable" || type === "measured";
  const measured = type === "measured";
  const grouped = type === "grouped";

  return (
    <form onSubmit={submit} className="grid gap-6">
      {/* Product Type Selection */}
      {!isEdit && (
        <section className={isPage ? "card p-6" : ""}>
          <div className="mb-2 text-sm font-semibold text-slate-800">Select Product Type</div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" role="radiogroup" aria-label="Product type">
            {TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={type === t.id}
                onClick={() => chooseType(t.id)}
                className={`rounded-xl border p-4 text-left transition ${
                  type === t.id
                    ? "border-brand-500 bg-brand-50/70 ring-2 ring-brand-100 shadow-sm"
                    : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="text-sm font-semibold text-slate-900">{t.label}</div>
                <div className="mt-0.5 text-xs text-slate-500">{t.desc}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Basic Identity Details */}
      <section className={isPage ? "card p-6" : ""}>
        {isPage && <h2 className="mb-4 text-base font-semibold text-slate-900">{grouped && !isEdit ? "Step 1 · Set details" : "Basic Information"}</h2>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={grouped ? "Set Name *" : "Product Name *"} className="sm:col-span-2" error={fieldErrors.name} id="field-product-name">
            <input
              id="product-name-input"
              className="input"
              required
              maxLength={150}
              placeholder={grouped ? "e.g. Chain Hoist Set" : "e.g. Wire Rope Slings, D-Shackle"}
              value={f.name}
              onChange={(e) => {
                setF({ ...f, name: e.target.value });
                clearFieldError("name");
              }}
            />
          </Field>

          <Field
            label={variable ? "Base Short Name * (variations auto-extend)" : grouped ? "Set Short Name * (starts every set code)" : "Short Name *"}
            error={fieldErrors.shortName}
            id="field-product-shortname"
          >
            <input
              id="product-shortname-input"
              className="input font-mono uppercase"
              required
              maxLength={80}
              placeholder={variable ? "e.g. WRS" : grouped ? "e.g. CHS" : "e.g. DSH-01"}
              value={f.shortName}
              onChange={(e) => {
                setBase(e.target.value);
                clearFieldError("shortName");
              }}
            />
          </Field>

          {!variable && (
            <Field label="Official SKU (shown on bills)" error={fieldErrors.sku} id="field-product-sku">
              <input
                id="product-sku-input"
                className="input font-mono"
                maxLength={80}
                placeholder="Leave blank if not assigned"
                value={f.sku}
                onChange={(e) => {
                  setF({ ...f, sku: e.target.value });
                  clearFieldError("sku");
                }}
              />
            </Field>
          )}

          {!measured && (
            <div id="field-product-unit">
              <span className="label">Unit *</span>
              <Combobox
                value={f.unit}
                options={[...new Set([...UNIT_SUGGESTIONS, f.unit].filter(Boolean))].map((u) => ({
                  id: u,
                  label: u,
                }))}
                onSelect={(u) => {
                  setF({ ...f, unit: u ?? "" });
                  clearFieldError("unit");
                }}
                onCreate={(q) => {
                  setF({ ...f, unit: q.trim() });
                  clearFieldError("unit");
                }}
                createLabel={(q) => `Use unit “${q}”`}
                placeholder="Select unit…"
                required
              />
              {fieldErrors.unit && (
                <span className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-rose-600 animate-fade-in" role="alert">
                  <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  {fieldErrors.unit}
                </span>
              )}
            </div>
          )}

          <div>
            <span className="label">Category (Product Type)</span>
            <Combobox
              value={f.categoryId || null}
              options={categoryOptions}
              onSelect={(id) => setF({ ...f, categoryId: id ?? "" })}
              onCreate={canCreateCategory ? (q) => setNewType(q) : undefined}
              createLabel={(q) => `Add “${q}” as a new Product Type category`}
              placeholder="No category"
            />
            {typeNote && <p className="mt-1 text-xs text-emerald-700" role="status">{typeNote}</p>}
            {typeof document !== "undefined" &&
              createPortal(
                <CategoryModal
                  open={newType !== null}
                  category={null}
                  head={{ id: null, name: "Product Type" }}
                  initialName={newType ?? undefined}
                  onClose={() => setNewType(null)}
                  onSaved={(c) => {
                    setNewType(null);
                    setF((x) => ({ ...x, categoryId: c.id }));
                    void cats.reload();
                    setTypeNote(`“${c.name}” was added as a new Product Type category and selected.`);
                  }}
                />,
                document.body,
              )}
          </div>

          <div id="field-head-categories" className="sm:col-span-2">
            <HeadCategoryPicker
            value={headCats}
            onChange={setHeadCats}
            current={[...(product?.categories ?? []), ...(product?.variationCategories ?? [])]}
            variations={
              type === "variable" || type === "measured"
                ? [...saved.map((v) => ({ key: v.key, attrs: v.attrs, active: v.active })), ...combos.map((c) => ({ key: c.key, attrs: c.attrs, active: true }))]
                : undefined
            }
            scopes={varScopes}
            onScopesChange={setVarScopes}
          />
          </div>

          <Field label="Description" className="sm:col-span-2">
            <textarea
              className="input min-h-[3.5rem]"
              rows={2}
              maxLength={1000}
              placeholder="Optional notes, specifications, or usage info…"
              value={f.description}
              onChange={(e) => setF({ ...f, description: e.target.value })}
            />
          </Field>
        </div>
      </section>

      {/* Product Images Drag & Drop + Multi-Image System */}
      <section className={isPage ? "card p-6" : ""}>
        <div className="mb-3">
          <div className="text-sm font-semibold text-slate-900">Product Images</div>
          <p className="text-xs text-slate-500">
            Upload multiple photos directly or drop them here. Crop & rotate via the popup editor.
          </p>
        </div>
        <ProductImageGallery images={images} onChange={setImages} disabled={saving} />
      </section>

      {/* Measured: length card (W2–W3) */}
      {measured && (
        <section className={isPage ? "card p-6" : ""}>
          <MeasurementCard value={measure} onChange={setMeasure} isEdit={isEdit} unitChanged={isEdit && product?.measure?.lengthUnit !== measure.lengthUnit} />
        </section>
      )}

      {/* V3.1 grouped product: main component + by-products (new products only) */}
      {grouped && !isEdit && <div id="field-grouped-main"><GroupedSetCard main={main} setMain={setMain} rows={byproducts} setRows={setByproducts} isPage={isPage} /></div>}
      {grouped && !isEdit && <DraftStandardSets byproducts={byproducts} rows={stdRows} setRows={setStdRows} isPage={isPage} />}
      {grouped && isEdit && (
        <section className={isPage ? "card p-6" : ""}>
          <div className="text-sm font-semibold text-slate-900">Set contents</div>
          <p className="mt-1 text-sm text-slate-600">
            Main component: <b>{product?.grouped?.main?.name ?? "—"}</b>. By-products:{" "}
            {product?.grouped?.byproducts.map((b) => `${b.name}${b.required ? "" : " (optional)"}`).join(", ") || "—"}.
          </p>
          <p className="mt-1 text-xs text-slate-500">Change the by-products on the product page → Sets tab.</p>
        </section>
      )}

      {/* Variable Product Builder */}
      {variable && (
        <section id="field-variation-builder" className={isPage ? "card p-6" : ""}>
          <VariationBuilder
            base={f.shortName}
            defs={defs}
            setDefs={setDefs}
            combos={combos}
            setCombos={setCombos}
            saved={saved}
            onUpdateSavedImage={handleUpdateSavedImage}
            order={varOrder}
            setOrder={setVarOrder}
            rollLengthLabel={measured ? `Default ${(measure.rollName || "roll").toLowerCase()} (${measure.lengthUnit === "m" ? "m" : "ft"})` : undefined}
          />
        </section>
      )}

      {error && !isPage && <Alert message={error} />}

      {/* Sticky Actions Bar (Always visible at bottom on long forms) */}
      <div
        className={
          isPage
            ? "sticky bottom-[3.75rem] lg:bottom-0 z-30 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 bg-white/95 backdrop-blur-md border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] flex flex-wrap items-center justify-between gap-3 mt-8 transition-all"
            : "flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4 mt-6"
        }
      >
        <div className="flex items-center gap-2 min-w-0">
          {error ? (
            <div
              id="form-general-error"
              className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-3 py-1.5 rounded-md animate-fade-in max-w-md truncate"
              role="alert"
            >
              <svg className="h-4 w-4 shrink-0 text-rose-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span className="truncate">{error}</span>
            </div>
          ) : (
            <div className="text-xs text-slate-500 hidden sm:block">
              {isEdit ? "Review details above and update product" : "Fill required fields marked with *"}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0 ml-auto">
          {onCancel && (
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn-primary shadow-sm" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Update Product" : grouped ? "Create Set Product" : "Save Product"}
          </button>
        </div>
      </div>
    </form>
  );
}
