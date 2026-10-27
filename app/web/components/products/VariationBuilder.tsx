"use client";

import {
  autoOfficialSku,
  autoShortName,
  comboKey,
  composeSubValue,
  normalizeShortName,
  normAttrVals,
  type AttributeDraft,
  type Attributes,
} from "@rs-v31/shared";
import { useMemo, useRef, useState } from "react";
import { Combobox } from "@/components/Combobox";
import { Alert } from "@/components/ui";
import { ImageEditorModal, type EditorImageItem } from "@/components/products/ImageEditorModal";

// Port of main v2 index.html VariationBuilder (D-21 version), restyled with marble UI (D23):
// 1 Define Attributes (name, unit, Sub Var, Quality) → 2 Create Variation (pick or type each value;
// a new value becomes data for the next variation; V3.2 merged main v2's separate Data step)
// → 3 Variation Details (image).
// V1 differences: attribute names are fixed once saved variations exist (D14), and variation
// images are URLs (no file upload yet).

export interface Combo {
  key: string;
  attrs: Attributes;
  shortName: string;
  shortNameTouched: boolean;
  sku: string;
  image: string;
  /** Measured products: default roll length as typed (W4; purchase pre-fill only). */
  rollLength?: string;
}

/** A variation already saved on the product (read-only in the builder). */
export interface SavedCombo {
  id?: string;
  key: string;
  attrs: Attributes;
  shortName: string;
  officialSku: string | null;
  active: boolean;
  image?: string | null;
}

export const newAttr = (quality = false): AttributeDraft =>
  quality
    ? { name: "Quality", unit: "", values: [], abbrMap: {}, isQuality: true, sub: false, subName: "", subUnit: "", pairs: [], stars: [] }
    : { name: "", unit: "", values: [""], abbrMap: {}, isQuality: false, sub: false, subName: "", subUnit: "", pairs: [], stars: [] };

/** Definitions as stored: names trimmed, values normalised (main v2 normAttrVals), abbreviations pruned. */
export function storedDefs(defs: AttributeDraft[]) {
  return defs
    .filter((d) => d.name.trim())
    .map((d) => {
      const values = normAttrVals(d);
      const abbrMap = Object.fromEntries(Object.entries(d.abbrMap ?? {}).filter(([k, v]) => values.includes(k) && String(v).trim()));
      return { name: d.name.trim(), unit: d.isQuality ? "" : (d.unit ?? "").trim(), values, abbrMap, isQuality: !!d.isQuality, sub: !!d.sub, subName: d.subName ?? "", subUnit: d.subUnit ?? "" };
    });
}

/** Builder drafts from stored definitions (sub values split back into pairs, quality into stars). */
export function draftsFromStored(defs: AttributeDraft[]): AttributeDraft[] {
  return defs.map((d) => {
    const base = { ...newAttr(!!d.isQuality), ...d, abbrMap: { ...(d.abbrMap ?? {}) } };
    if (d.isQuality) {
      const parsedStars = (d.stars && d.stars.length)
        ? d.stars.slice()
        : (d.values || []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5);
      const stars = parsedStars.sort((a, b) => a - b);
      return { ...base, stars, values: stars.map(String) };
    }
    if (d.sub) {
      const unit = (d.subUnit ?? "").trim();
      const pairs = (d.values || []).map((v) => {
        const m = /^(.*?) \((.*)\)$/.exec(v);
        if (!m) return { a: v, b: "" };
        const inner = unit && m[2]!.endsWith(" " + unit) ? m[2]!.slice(0, -unit.length - 1) : m[2]!;
        return { a: m[1]!, b: inner };
      });
      return { ...base, pairs: pairs.length ? pairs : [{ a: "", b: "" }] };
    }
    return { ...base, values: [...(d.values || [""])] };
  });
}

/** Regenerates codes for combos the user has not edited (main v2 shortNameTouched latch). */
export function refreshCombos(combos: Combo[], base: string, defs: AttributeDraft[]): Combo[] {
  const stored = storedDefs(defs);
  return combos.map((c) => ({
    ...c,
    shortName: c.shortNameTouched ? c.shortName : normalizeShortName(autoShortName(base, c.attrs, stored)),
    sku: autoOfficialSku(base, c.attrs, stored),
  }));
}

const STEPS = ["Define Attributes", "Create Variation", "Variation Details"];

export function VariationBuilder({
  base,
  defs,
  setDefs,
  combos,
  setCombos,
  saved = [],
  onUpdateSavedImage,
  rollLengthLabel,
}: {
  base: string;
  defs: AttributeDraft[];
  setDefs: (fn: (d: AttributeDraft[]) => AttributeDraft[]) => void;
  combos: Combo[];
  setCombos: (fn: (c: Combo[]) => Combo[]) => void;
  saved?: SavedCombo[];
  onUpdateSavedImage?: (variationId: string, imageUrl: string) => void;
  /** Measured products (W4): shows a "Default roll" column with this header, e.g. "Default roll (m)". */
  rollLengthLabel?: string;
}) {
  const [step, setStep] = useState(1);
  const [activeTab, setActiveTab] = useState(0);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [subPicks, setSubPicks] = useState<Record<string, string>>({});
  const [abbrs, setAbbrs] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const locked = saved.length > 0;
  const [varEditorOpen, setVarEditorOpen] = useState(false);
  const [varEditorImages, setVarEditorImages] = useState<EditorImageItem[]>([]);
  const [isVarDragging, setIsVarDragging] = useState(false);
  const varFileInputRef = useRef<HTMLInputElement>(null);

  const allConfigurable = useMemo(
    () => [
      ...saved.map((s) => ({
        type: "saved" as const,
        id: s.id ?? s.key,
        key: s.key,
        attrs: s.attrs,
        shortName: s.shortName,
        sku: s.officialSku,
        image: s.image ?? "",
      })),
      ...combos.map((c) => ({
        type: "new" as const,
        id: c.key,
        key: c.key,
        attrs: c.attrs,
        shortName: c.shortName,
        sku: c.sku,
        image: c.image ?? "",
      })),
    ],
    [saved, combos]
  );

  const currentVar = allConfigurable[activeTab] || allConfigurable[0];

  const handleVarFiles = (files: FileList | File[]) => {
    const file = Array.from(files).find((f) => f.type.startsWith("image/"));
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setVarEditorImages([
        {
          id: `var-${Date.now()}`,
          source: reader.result as string,
          name: file.name,
        },
      ]);
      setVarEditorOpen(true);
    };
    reader.readAsDataURL(file);
  };

  const setAttr = (i: number, patch: Partial<AttributeDraft>) => setDefs((prev) => prev.map((d, ix) => (ix === i ? { ...d, ...patch } : d)));
  const toggleSub = (i: number) =>
    setDefs((prev) => prev.map((d, ix) => (ix !== i ? d : d.sub ? { ...d, sub: false, subName: "", subUnit: "", pairs: [] } : { ...d, sub: true, subName: "", subUnit: "", pairs: [{ a: "", b: "" }] })));
  const toggleQuality = (i: number) =>
    setDefs((prev) =>
      prev.map((d, ix) => {
        if (ix !== i) return d;
        if (d.isQuality) {
          return { ...d, isQuality: false, unit: "", stars: [], values: [""] };
        }
        return {
          ...d,
          name: d.name.trim() ? d.name : "Quality",
          isQuality: true,
          unit: "",
          sub: false,
          subName: "",
          subUnit: "",
          pairs: [],
          stars: [],
          values: [],
        };
      }),
    );

  // ---- Step transitions (main v2 goStep2 / confirmAndOpenDetails)
  const goStep2 = () => {
    if (!defs.some((d) => d.name.trim())) return setMessage({ kind: "error", text: "Define at least one attribute name (e.g. Size, Material) first" });
    if (defs.some((d) => !d.name.trim())) return setMessage({ kind: "error", text: "Name or remove every attribute before continuing" });
    const names = defs.map((d) => d.name.trim().toLowerCase()).filter(Boolean);
    if (new Set(names).size !== names.length) return setMessage({ kind: "error", text: "Two attributes have the same name" });
    setMessage(null);
    setStep(2);
  };
  const goStep3 = () => {
    if (!combos.length && !saved.length) return setMessage({ kind: "error", text: "Create at least one variation before continuing" });
    setMessage(null);
    setActiveTab(0);
    setStep(3);
  };

  // ---- Step 2: Data and Create Variation in one. Each attribute is a pick-or-type box; a typed
  // value joins that attribute's data when the variation is created, so the next variation offers it.
  const named = defs.filter((d) => d.name.trim());
  const uniq = (xs: string[]) => [...new Set(xs.map((x) => String(x ?? "").trim()).filter(Boolean))];
  /** An existing value that matches case-insensitively wins over the typed spelling. */
  const canonical = (options: string[], typed: string) => {
    const t = typed.trim();
    return options.find((o) => o.toLowerCase() === t.toLowerCase()) ?? t;
  };
  const mainOptions = (d: AttributeDraft) => (d.sub ? uniq((d.pairs ?? []).map((p) => p.a)) : normAttrVals(d));
  const subOptions = (d: AttributeDraft) => uniq((d.pairs ?? []).map((p) => p.b));
  /** The value stored on the variation for the current picks ("" when nothing is picked). */
  const pickedValue = (d: AttributeDraft, p = picks, sp = subPicks) => {
    const k = d.name.trim();
    const a = (p[k] ?? "").trim();
    if (!a) return "";
    return d.sub ? composeSubValue(a, sp[k] ?? "", d.subUnit) : a;
  };
  // The Abbr box shows the abbreviation saved for the picked value; editing it applies on create.
  const pick = (d: AttributeDraft, main?: string | null, sub?: string | null) => {
    const k = d.name.trim();
    const p = { ...picks };
    const sp = { ...subPicks };
    if (main !== undefined) { if (main) p[k] = main; else delete p[k]; }
    if (sub !== undefined) { if (sub) sp[k] = sub; else delete sp[k]; }
    setPicks(p);
    setSubPicks(sp);
    const v = pickedValue(d, p, sp);
    setAbbrs((prev) => ({ ...prev, [k]: v ? String(d.abbrMap?.[v] ?? "") : "" }));
  };

  /** Definitions with the picked values (and abbreviations) added where they are new. */
  const withPicks = (prev: AttributeDraft[]): AttributeDraft[] =>
    prev.map((d) => {
      const k = d.name.trim();
      const v = pickedValue(d);
      if (!k || !v) return d;
      const abbrMap = { ...(d.abbrMap ?? {}) };
      const t = (abbrs[k] ?? "").trim().toUpperCase();
      if (t) abbrMap[v] = t;
      else delete abbrMap[v];
      if (normAttrVals(d).includes(v)) return { ...d, abbrMap };
      if (d.isQuality) {
        const stars = [...(d.stars ?? []), Number(v)].sort((a, b) => a - b);
        return { ...d, abbrMap, stars, values: stars.map(String) };
      }
      if (d.sub) {
        const pairs = [...(d.pairs ?? []).filter((x) => x.a.trim() || x.b.trim()), { a: picks[k]!.trim(), b: (subPicks[k] ?? "").trim() }];
        return { ...d, abbrMap, pairs };
      }
      return { ...d, abbrMap, values: [...(d.values ?? []).filter((x) => String(x).trim()), v] };
    });

  const createVariation = () => {
    if (defs.some((d) => !d.name.trim())) return setMessage({ kind: "error", text: "Name or remove every attribute before creating variations" });
    const attrs: Attributes = {};
    for (const d of named) {
      const v = pickedValue(d);
      if (!v) return setMessage({ kind: "error", text: `Pick or type a value for ${d.name} first` });
      attrs[d.name.trim()] = v;
    }
    const key = comboKey(attrs);
    if (combos.some((c) => c.key === key) || saved.some((s) => s.key === key)) return setMessage({ kind: "error", text: "That combination is already created" });
    const nextDefs = withPicks(defs);
    const stored = storedDefs(nextDefs);
    const combo: Combo = {
      key,
      attrs,
      shortName: normalizeShortName(autoShortName(base, attrs, stored)),
      shortNameTouched: false,
      sku: autoOfficialSku(base, attrs, stored),
      image: "",
    };
    setDefs(() => nextDefs);
    setCombos((prev) => [...prev, combo]);
    // Picks stay so the next variation only needs the attribute that differs.
    setMessage({ kind: "success", text: "Variation created" });
  };
  const removeVariation = (c: Combo) => {
    if (!window.confirm(`Remove this variation?\n${Object.values(c.attrs).join(" / ") || c.shortName}`)) return;
    const rest = combos.filter((x) => x.key !== c.key);
    const inUse = (k: string, v: string) => saved.some((s) => s.attrs[k] === v) || rest.some((x) => x.attrs[k] === v);
    setDefs((prev) =>
      prev.map((d) => {
        const k = d.name.trim();
        const v = c.attrs[k];
        if (!v || inUse(k, v)) return d;
        const abbrMap = { ...(d.abbrMap ?? {}) };
        delete abbrMap[v];
        if (d.isQuality) {
          const stars = (d.stars ?? []).filter((n) => String(n) !== v);
          return { ...d, abbrMap, stars, values: stars.map(String) };
        }
        if (d.sub) return { ...d, abbrMap, pairs: (d.pairs ?? []).filter((p) => composeSubValue(p.a, p.b, d.subUnit) !== v) };
        return { ...d, abbrMap, values: (d.values ?? []).filter((x) => String(x).trim() !== v) };
      }),
    );
    setCombos(() => rest);
  };

  const label = (d: AttributeDraft, i: number) => {
    let l = d.unit ? `${d.name} (${d.unit})` : d.name;
    if (d.subName) l += ` / ${d.subName}${d.subUnit ? ` (${d.subUnit})` : ""}`;
    return l || `Attribute ${i + 1}`;
  };
  const stars = (n: number | string) => "★".repeat(Math.min(5, Number(n) || 0));
  const showVal = (attr: string, v: string) => (named.find((d) => d.name.trim() === attr)?.isQuality ? stars(v) : v);
  const chip = "inline-flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs";
  const toolBtn = (on: boolean, tone: "violet" | "amber") =>
    `btn border text-xs ${on ? (tone === "violet" ? "border-violet-300 bg-violet-50 text-violet-700" : "border-amber-300 bg-amber-50 text-amber-700") : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <h4 className="font-semibold text-slate-900">Variable Product Builder</h4>
      <div className="mt-2 flex flex-wrap gap-2" role="tablist" aria-label="Builder steps">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={step === i + 1}
            onClick={() => setStep(i + 1)}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold transition ${step === i + 1 ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${step === i + 1 ? "bg-white/25" : "bg-slate-100"}`}>{i + 1}</span>
            {s}
          </button>
        ))}
      </div>

      <div className="mt-3">
        <Alert message={message?.text} kind={message?.kind} />

        {step === 1 && (
          <div className="grid gap-3">
            <p className="text-sm text-slate-500">
              Define the attributes that make up your variations, e.g. Size, Material, Rope Construction. Use <b>Sub Var</b> for a secondary option (e.g. Core: Fibre/Steel) and the <b>star</b> for a Quality grade attribute.
            </p>
            {locked && <p className="text-xs text-amber-700">This product has saved variations: attribute names are fixed. You can add new data values.</p>}
            {defs.map((d, i) => (
              <div key={i} className="card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input className="input min-w-[10rem] flex-1" placeholder={`Attribute ${i + 1} (e.g. Size)`} value={d.name} disabled={locked} aria-label={`Attribute ${i + 1} name`} onChange={(e) => setAttr(i, { name: e.target.value })} />
                  {!d.isQuality && <input className="input w-28" placeholder="Unit (mm)" value={d.unit ?? ""} aria-label={`Attribute ${i + 1} unit`} onChange={(e) => setAttr(i, { unit: e.target.value })} />}
                  {!d.isQuality && (
                    <button type="button" disabled={locked} className={toolBtn(!!d.sub, "violet")} onClick={() => toggleSub(i)} title="Add a secondary (sub) option — e.g. Core Fibre/Steel">
                      {d.sub ? "−" : "+"} Sub Var
                    </button>
                  )}
                  <button type="button" disabled={locked} className={toolBtn(!!d.isQuality, "amber")} onClick={() => toggleQuality(i)} title="Quality rating attribute (5 stars)">
                    {d.isQuality ? "★" : "☆"} Quality
                  </button>
                  {!locked && (
                    <button type="button" className="btn-danger px-2" onClick={() => setDefs((prev) => prev.filter((_, ix) => ix !== i))} aria-label={`Remove attribute ${i + 1}`}>
                      ×
                    </button>
                  )}
                </div>
                {d.sub && !d.isQuality && (
                  <div className="mt-2 flex flex-wrap gap-2 border-l-2 border-violet-200 pl-3">
                    <input className="input min-w-[10rem] flex-1" placeholder="Sub attribute name (e.g. Core)" value={d.subName ?? ""} disabled={locked} onChange={(e) => setAttr(i, { subName: e.target.value })} />
                    <input className="input w-28" placeholder="Sub unit" value={d.subUnit ?? ""} disabled={locked} onChange={(e) => setAttr(i, { subUnit: e.target.value })} />
                  </div>
                )}
              </div>
            ))}
            {!locked && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" onClick={() => setDefs((prev) => [...prev, newAttr()])}>+ Add Attribute</button>
                <button
                  type="button"
                  className="btn-secondary border-dashed"
                  onClick={() =>
                    setDefs((prev) => {
                      const emptyIndex = prev.findIndex(
                        (d) =>
                          !d.name.trim() &&
                          !d.isQuality &&
                          !d.sub &&
                          !d.unit?.trim() &&
                          !(d.values ?? []).some((v) => v.trim()) &&
                          !(d.pairs ?? []).some((p) => p.a.trim() || p.b.trim()),
                      );
                      return emptyIndex < 0
                        ? [...prev, newAttr(true)]
                        : prev.map((d, ix) => (ix === emptyIndex ? newAttr(true) : d));
                    })
                  }
                >
                  <span className="text-amber-500">★</span> Add Quality Attribute
                </button>
              </div>
            )}
            <div className="flex justify-end">
              <button type="button" className="btn-primary" onClick={goStep2}>Continue — Create Variation →</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3">
            <p className="text-sm text-slate-500">
              Pick a value for each attribute from its list, or type a new one and choose <b>Add</b>, then press <b>Create Variation</b>.
              A new value is saved as data for the next variation{combos.length ? <> — <b>{combos.length}</b> created so far</> : null}. <b>Abbr</b> is the
              optional short form used in the Short Name and Official SKU. New variations start at <b>price 0 and min stock 0</b>: set those from <b>Stock In</b> after saving.
            </p>
            <div className="card grid gap-3 p-3">
              {named.map((d, i) => {
                const k = d.name.trim();
                const main = picks[k] ?? null;
                const mains = mainOptions(d);
                const subs = subOptions(d);
                return (
                  <div key={k} className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[10rem] flex-1">
                      <span className="label">{d.sub ? `${d.name}${d.unit ? ` (${d.unit})` : ""}` : label(d, i)}</span>
                      <Combobox
                        value={main}
                        selectedLabel={main ?? undefined}
                        options={
                          d.isQuality
                            ? [1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: `${n} star ${stars(n)}` }))
                            : mains.map((v) => ({ id: v, label: v }))
                        }
                        onSelect={(v) => pick(d, v)}
                        onCreate={d.isQuality ? undefined : (q) => pick(d, canonical(mains, q))}
                        createLabel={(q) => `Add “${q}” to ${d.name}`}
                        placeholder={d.isQuality ? "Select stars…" : `Select or type ${d.name || "value"}…`}
                      />
                    </div>
                    {d.sub && (
                      <div className="min-w-[10rem] flex-1">
                        <span className="label">{d.subName || "Sub"}{d.subUnit ? ` (${d.subUnit})` : ""}</span>
                        <Combobox
                          value={subPicks[k] ?? null}
                          selectedLabel={subPicks[k]}
                          options={subs.map((v) => ({ id: v, label: v }))}
                          onSelect={(v) => pick(d, undefined, v)}
                          onCreate={(q) => pick(d, undefined, canonical(subs, q))}
                          createLabel={(q) => `Add “${q}” to ${d.subName || "Sub"}`}
                          placeholder={`Select or type ${d.subName || "sub value"}…`}
                        />
                      </div>
                    )}
                    <input
                      className="input w-24 uppercase"
                      value={abbrs[k] ?? ""}
                      disabled={!pickedValue(d)}
                      placeholder="Abbr"
                      aria-label={`${d.name} abbreviation`}
                      title="Optional abbreviation used in the auto-generated Short Name and Official SKU. Leave blank to use the data as-is."
                      onChange={(e) => setAbbrs((prev) => ({ ...prev, [k]: e.target.value.toUpperCase() }))}
                    />
                  </div>
                );
              })}
              <button type="button" className="btn-primary justify-self-start" onClick={createVariation} disabled={!named.length}>+ Create Variation</button>
            </div>

            {!combos.length && !saved.length && <Alert message="No variations yet — pick a value for each attribute and press Create Variation." />}

            {(saved.length > 0 || combos.length > 0) && (
              <div className="card overflow-hidden">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Created variations ({saved.length + combos.length})
                </div>
                {saved.map((s) => (
                  <div key={s.key} className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm text-slate-500">
                    <span className="flex flex-1 flex-wrap gap-1">
                      {Object.entries(s.attrs).map(([k, v]) => <span key={k} className={chip}>{k}: <b>{showVal(k, v)}</b></span>)}
                    </span>
                    <span className="font-mono text-xs">{s.shortName}</span>
                    <span className="font-mono text-xs text-slate-400">{s.officialSku ?? "—"}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">{s.active ? "saved" : "archived"}</span>
                  </div>
                ))}
                {combos.map((c) => (
                  <div key={c.key} className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0">
                    <span className="flex flex-1 flex-wrap gap-1">
                      {Object.entries(c.attrs).map(([k, v]) => {
                        const attrDef = named.find((d) => d.name.trim() === k);
                        const unit = !attrDef?.isQuality ? attrDef?.unit : null;
                        return (
                          <span key={k} className={chip}>
                            {k}: <b>{showVal(k, v)}</b>
                            {unit ? <span className="text-slate-400">{unit}</span> : null}
                          </span>
                        );
                      })}
                    </span>
                    <input
                      className="input w-48 font-mono text-xs uppercase"
                      value={c.shortName}
                      aria-label={`Short Name for ${Object.values(c.attrs).join(" / ")}`}
                      onChange={(e) => setCombos((pr) => pr.map((x) => (x.key === c.key ? { ...x, shortName: e.target.value.toUpperCase(), shortNameTouched: true } : x)))}
                    />
                    <span className="w-36 truncate font-mono text-xs text-slate-500" title="Official SKU (auto-generated)">{c.sku || "—"}</span>
                    {rollLengthLabel && (
                      <input
                        className="input w-28 text-right text-xs"
                        inputMode="decimal"
                        placeholder={rollLengthLabel}
                        title={`${rollLengthLabel}: pre-fills the purchase roll entry only`}
                        aria-label={`${rollLengthLabel} for ${Object.values(c.attrs).join(" / ")}`}
                        value={c.rollLength ?? ""}
                        onChange={(e) => setCombos((pr) => pr.map((x) => (x.key === c.key ? { ...x, rollLength: e.target.value.replace(/[^\d.]/g, "") } : x)))}
                      />
                    )}
                    <button type="button" className="btn-danger px-2" onClick={() => removeVariation(c)} aria-label="Remove this variation">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-between">
              <button type="button" className="btn-secondary" onClick={() => setStep(1)}>← Back</button>
              <button type="button" className="btn-primary" onClick={goStep3}>Continue →</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-500">Fine-tune each variation — give it a dedicated image.</p>
              <button type="button" className="btn-secondary" onClick={() => setStep(2)}>← Back to Create Variation</button>
            </div>
            {allConfigurable.length === 0 ? (
              <p className="text-sm text-slate-500">No variations to configure — create variations in Step 2 first.</p>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex shrink-0 gap-1 overflow-x-auto sm:w-56 sm:flex-col" role="tablist" aria-label="Variations">
                  {allConfigurable.map((c, i) => (
                    <button
                      key={c.id || c.key}
                      type="button"
                      role="tab"
                      aria-selected={i === activeTab}
                      onClick={() => setActiveTab(i)}
                      className={`whitespace-nowrap rounded-md px-3 py-1.5 text-left text-sm flex items-center justify-between gap-2 ${
                        i === activeTab
                          ? "bg-brand-600 text-white"
                          : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <span className="truncate">{Object.entries(c.attrs).map(([k, v]) => showVal(k, v)).join(" / ") || c.shortName}</span>
                      {c.type === "saved" && (
                        <span className={`shrink-0 rounded px-1 text-[10px] ${i === activeTab ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-500"}`}>
                          Saved
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {currentVar && (
                  <div className="card min-w-0 flex-1 p-3">
                    <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                      <div className="flex items-center gap-2">
                        <b className="text-sm text-slate-800">{Object.entries(currentVar.attrs).map(([k, v]) => `${k}: ${showVal(k, v)}`).join(" / ")}</b>
                        {currentVar.type === "saved" && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">Saved Variation</span>
                        )}
                      </div>
                      <span className="rounded bg-slate-900 px-2 py-0.5 font-mono text-xs text-white">{currentVar.shortName}</span>
                    </div>
                    <input
                      ref={varFileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files?.length) {
                          handleVarFiles(e.target.files);
                          e.target.value = "";
                        }
                      }}
                    />

                    <div className="flex items-center gap-4">
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsVarDragging(true);
                        }}
                        onDragLeave={(e) => {
                          e.preventDefault();
                          setIsVarDragging(false);
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setIsVarDragging(false);
                          if (e.dataTransfer.files?.length) handleVarFiles(e.dataTransfer.files);
                        }}
                        onClick={() => varFileInputRef.current?.click()}
                        className={`group relative flex h-20 w-20 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-dashed transition ${
                          isVarDragging
                            ? "border-brand-500 bg-brand-50"
                            : "border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-slate-100"
                        }`}
                        title="Click or drop an image file here"
                      >
                        {currentVar.image ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={currentVar.image} alt="" className="h-full w-full object-cover" />
                            <div className="absolute inset-0 flex items-center justify-center bg-slate-900/60 opacity-0 transition group-hover:opacity-100">
                              <span className="text-[10px] font-medium text-white">Change</span>
                            </div>
                          </>
                        ) : (
                          <div className="text-center">
                            <span className="text-xl text-slate-400">+</span>
                            <span className="block text-[9px] text-slate-400">Upload</span>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 space-y-1">
                        <span className="label">Variation image</span>
                        {currentVar.image ? (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setVarEditorImages([
                                  {
                                    id: `var-${currentVar.id}`,
                                    source: currentVar.image,
                                    name: `${currentVar.shortName} Image`,
                                  },
                                ]);
                                setVarEditorOpen(true);
                              }}
                              className="btn-secondary px-2.5 py-1 text-xs"
                            >
                              Crop / Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (currentVar.type === "new") {
                                  setCombos((pr) => pr.map((x) => (x.key === currentVar.key ? { ...x, image: "" } : x)));
                                } else if (onUpdateSavedImage && currentVar.id) {
                                  onUpdateSavedImage(currentVar.id, "");
                                }
                              }}
                              className="btn-link text-xs text-rose-600 hover:underline"
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => varFileInputRef.current?.click()}
                            className="btn-primary text-xs"
                          >
                            Upload Image
                          </button>
                        )}
                        <p className="text-xs text-slate-500">
                          Direct upload or drag & drop. Cropped to square in popup editor.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <ImageEditorModal
        open={varEditorOpen}
        onClose={() => setVarEditorOpen(false)}
        context="variation"
        images={varEditorImages}
        onComplete={(urls) => {
          if (urls.length && currentVar) {
            const uploadedUrl = urls[0]!;
            if (currentVar.type === "new") {
              setCombos((pr) =>
                pr.map((x) => (x.key === currentVar.key ? { ...x, image: uploadedUrl } : x))
              );
            } else if (onUpdateSavedImage && currentVar.id) {
              onUpdateSavedImage(currentVar.id, uploadedUrl);
            }
          }
        }}
      />
    </div>
  );
}
