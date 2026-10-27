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
// 1 Define Attributes (name, unit, Sub Var, Quality) → 2 Data (values / pairs / stars, abbreviations)
// → 3 Create Variation (one combination per set of dropdown picks) → 4 Variation Details (image).
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

const STEPS = ["Define Attributes", "Data", "Create Variation", "Variation Details"];

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
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const newDataRef = useRef<Record<string, HTMLInputElement | null>>({});
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

  // Values used by saved variations cannot be removed (D14).
  const usedValues: Record<string, Set<string>> = {};
  for (const s of saved) for (const [k, v] of Object.entries(s.attrs)) (usedValues[k] ??= new Set()).add(v);

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

  // ---- Abbreviations (main v2 getAbbr / setAbbr / moveAbbr): keyed by the value exactly as stored.
  const rowKeys = (d: AttributeDraft) => normAttrVals(d);
  const getAbbr = (i: number, value: string, ri: number) => {
    const d = defs[i];
    const v = String(value ?? "").trim();
    if (!d || !v || !d.abbrMap || d.abbrMap[v] == null) return "";
    if (rowKeys(d)[ri] !== v) return "";
    return String(d.abbrMap[v]);
  };
  const setAbbr = (i: number, value: string, text: string) =>
    setDefs((prev) =>
      prev.map((d, ix) => {
        if (ix !== i) return d;
        const k = String(value ?? "").trim();
        if (!k) return d;
        const m = { ...(d.abbrMap ?? {}) };
        const t = String(text ?? "").trim();
        if (t) m[k] = t.toUpperCase();
        else delete m[k];
        return { ...d, abbrMap: m };
      }),
    );
  // An abbreviation follows its value through a rename, but never jumps to another row's value.
  const moveAbbr = (i: number, oldValue: string, newValue: string, nextDef: AttributeDraft) =>
    setDefs((prev) =>
      prev.map((d, ix) => {
        if (ix !== i) return d;
        const from = String(oldValue ?? "").trim();
        const to = String(newValue ?? "").trim();
        if (from === to || !from || !nextDef.abbrMap || nextDef.abbrMap[from] === undefined) return nextDef;
        if (rowKeys(nextDef).includes(from)) return nextDef;
        const m = { ...nextDef.abbrMap };
        const t = m[from];
        delete m[from];
        if (to && String(t).trim()) m[to] = t!;
        return { ...nextDef, abbrMap: m };
      }),
    );

  // "Add Data" appends a row and puts the caret in it.
  const focusNew = (i: number, ri: number) => setTimeout(() => newDataRef.current[`${i}:${ri}`]?.focus(), 0);
  const addValue = (i: number) => {
    setAttr(i, { values: [...(defs[i]!.values ?? []), ""] });
    focusNew(i, defs[i]!.values.length);
  };
  const addPair = (i: number) => {
    setAttr(i, { pairs: [...(defs[i]!.pairs ?? []), { a: "", b: "" }] });
    focusNew(i, (defs[i]!.pairs ?? []).length);
  };

  // ---- Step transitions (main v2 goStep2 / goStep3 / confirmAndOpenDetails)
  const goStep2 = () => {
    if (!defs.some((d) => d.name.trim())) return setMessage({ kind: "error", text: "Define at least one attribute name (e.g. Size, Material) first" });
    if (defs.some((d) => !d.name.trim())) return setMessage({ kind: "error", text: "Name or remove every attribute before continuing" });
    const names = defs.map((d) => d.name.trim().toLowerCase()).filter(Boolean);
    if (new Set(names).size !== names.length) return setMessage({ kind: "error", text: "Two attributes have the same name" });
    setMessage(null);
    setStep(2);
  };
  const goStep3 = () => {
    if (defs.some((d) => !d.name.trim())) return setMessage({ kind: "error", text: "Name or remove every attribute before continuing" });
    const named = defs.filter((d) => d.name.trim());
    if (!named.length || named.some((d) => !normAttrVals(d).length)) return setMessage({ kind: "error", text: "Add at least one value (data) for every attribute" });
    setMessage(null);
    setPicks({});
    setStep(3);
  };
  const goStep4 = () => {
    if (!combos.length && !saved.length) return setMessage({ kind: "error", text: "Create at least one variation before continuing" });
    setMessage(null);
    setActiveTab(0);
    setStep(4);
  };

  // ---- Step 3: create ONE variation from the current picks (no cartesian matrix).
  const named = defs.filter((d) => d.name.trim());
  const stored = storedDefs(defs);
  const createVariation = () => {
    if (defs.some((d) => !d.name.trim())) return setMessage({ kind: "error", text: "Name or remove every attribute before creating variations" });
    const attrs: Attributes = {};
    for (const d of named) {
      const v = picks[d.name.trim()];
      if (!v) return setMessage({ kind: "error", text: `Pick a value for ${d.name} first` });
      attrs[d.name.trim()] = v;
    }
    const key = comboKey(attrs);
    if (combos.some((c) => c.key === key) || saved.some((s) => s.key === key)) return setMessage({ kind: "error", text: "That combination is already created" });
    const combo: Combo = {
      key,
      attrs,
      shortName: normalizeShortName(autoShortName(base, attrs, stored)),
      shortNameTouched: false,
      sku: autoOfficialSku(base, attrs, stored),
      image: "",
    };
    setCombos((prev) => [...prev, combo]);
    setPicks({});
    setMessage({ kind: "success", text: "Variation created" });
  };
  const removeVariation = (c: Combo) => {
    if (!window.confirm(`Remove this variation?\n${Object.values(c.attrs).join(" / ") || c.shortName}`)) return;
    setCombos((prev) => prev.filter((x) => x.key !== c.key));
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
              <button type="button" className="btn-primary" onClick={goStep2}>Continue — Data →</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="grid gap-3">
            <p className="text-sm text-slate-500"><b>Data</b> for each attribute: quality uses a 5-star picker, sub-attributes use main + sub pairs, everything else is a simple value list.</p>
            {defs.map((d, i) => {
              const used = usedValues[d.name.trim()] ?? new Set<string>();
              return (
                <div key={i} className="card p-3">
                  <h6 className="mb-2 text-sm font-semibold text-slate-800">{label(d, i)}</h6>
                  {d.isQuality && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap justify-around gap-2 rounded-lg border border-slate-200 bg-white p-2">
                        {[1, 2, 3, 4, 5].map((n) => {
                          const on = (d.stars ?? []).includes(n);
                          const inUse = used.has(String(n));
                          return (
                            <button
                              key={n}
                              type="button"
                              aria-pressed={on}
                              disabled={on && inUse}
                              onClick={() => {
                                const nextStars = on
                                  ? (d.stars ?? []).filter((x) => x !== n)
                                  : [...(d.stars ?? []), n].sort((a, b) => a - b);
                                setAttr(i, { stars: nextStars, values: nextStars.map(String) });
                              }}
                              className={`flex flex-col items-center rounded-lg px-3 py-1.5 ring-1 ${on ? "bg-amber-50 ring-amber-300" : "ring-slate-200 hover:bg-slate-50"}`}
                            >
                              <span className="text-amber-500">{stars(n)}</span>
                              <span className="text-[10.5px] text-slate-500">{n} star</span>
                            </button>
                          );
                        })}
                      </div>

                      {(d.stars ?? []).length > 0 && (
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                            Quality Star Abbreviations (Optional)
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                            {(d.stars ?? [])
                              .slice()
                              .sort((a, b) => a - b)
                              .map((n, ri) => {
                                const sVal = String(n);
                                return (
                                  <div key={n} className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2">
                                    <span className="text-amber-500 text-sm">{stars(n)}</span>
                                    <span className="text-xs font-medium text-slate-700 whitespace-nowrap">{n} Star</span>
                                    <input
                                      className="input ml-auto w-20 uppercase text-xs"
                                      value={getAbbr(i, sVal, ri)}
                                      placeholder={`${n}S`}
                                      title={`Optional abbreviation used in Short Name and SKU for ${n} star (e.g. ${n}S)`}
                                      onChange={(e) => setAbbr(i, sVal, e.target.value)}
                                    />
                                  </div>
                                );
                              })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {!d.isQuality && d.sub && (
                    <div className="grid gap-2">
                      {(d.pairs ?? []).map((p, pi) => {
                        const cval = composeSubValue(p.a, p.b, d.subUnit);
                        const inUse = used.has(cval);
                        const setPair = (np: { a: string; b: string }) => {
                          const next = { ...d, pairs: (d.pairs ?? []).map((x, xi) => (xi === pi ? np : x)) };
                          moveAbbr(i, cval, composeSubValue(np.a, np.b, d.subUnit), next);
                        };
                        return (
                          <div key={pi} className="flex flex-wrap gap-2">
                            <input ref={(el) => { newDataRef.current[`${i}:${pi}`] = el; }} className="input min-w-[8rem] flex-1" value={p.a} disabled={inUse} placeholder={`${d.name || "Main"} value`} onChange={(e) => setPair({ ...p, a: e.target.value })} />
                            <input className="input min-w-[8rem] flex-1" value={p.b} disabled={inUse} placeholder={`${d.subName || "Sub"} value`} onChange={(e) => setPair({ ...p, b: e.target.value })} />
                            <input className="input w-24 uppercase" value={getAbbr(i, cval, pi)} placeholder="Abbr" title="Optional abbreviation used in the auto-generated Short Name and Official SKU. Leave blank to use the data as-is." onChange={(e) => setAbbr(i, cval, e.target.value)} />
                            {(d.pairs ?? []).length > 1 && !inUse && (
                              <button type="button" className="btn-danger px-2" aria-label="Remove row" onClick={() => setAttr(i, { pairs: (d.pairs ?? []).filter((_, xi) => xi !== pi) })}>×</button>
                            )}
                          </div>
                        );
                      })}
                      <button type="button" className="btn-secondary justify-self-start" onClick={() => addPair(i)}>+ Add Data</button>
                    </div>
                  )}
                  {!d.isQuality && !d.sub && (
                    <div className="grid gap-2">
                      {(d.values ?? []).map((v, vi) => {
                        const inUse = used.has(String(v).trim());
                        return (
                          <div key={vi} className="flex gap-2">
                            <input
                              ref={(el) => { newDataRef.current[`${i}:${vi}`] = el; }}
                              className="input flex-1"
                              value={v}
                              placeholder="Data"
                              disabled={inUse}
                              onChange={(e) => {
                                const nv = e.target.value;
                                moveAbbr(i, v, nv, { ...d, values: d.values.map((x, xi) => (xi === vi ? nv : x)) });
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter") return;
                                e.preventDefault();
                                if (vi === d.values.length - 1 && !String(v).trim()) return;
                                addValue(i);
                              }}
                            />
                            <input className="input w-24 uppercase" value={getAbbr(i, v, vi)} placeholder="Abbr" title="Optional abbreviation used in the auto-generated Short Name and Official SKU. Leave blank to use the data as-is." onChange={(e) => setAbbr(i, v, e.target.value)} />
                            {d.values.length > 1 && !inUse && (
                              <button type="button" className="btn-danger px-2" aria-label="Remove value" onClick={() => setAttr(i, { values: d.values.filter((_, xi) => xi !== vi) })}>×</button>
                            )}
                          </div>
                        );
                      })}
                      <button type="button" className="btn-secondary justify-self-start" onClick={() => addValue(i)}>+ Add Data</button>
                    </div>
                  )}
                </div>
              );
            })}
            <div className="flex justify-between">
              <button type="button" className="btn-secondary" onClick={() => setStep(1)}>← Back</button>
              <button type="button" className="btn-primary" onClick={goStep3}>Continue — Create Variations →</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="grid gap-3">
            <p className="text-sm text-slate-500">
              Pick one value per attribute and press <b>Create Variation</b>. Every option comes from the <b>Data</b> you entered
              {combos.length ? <> — <b>{combos.length}</b> created so far</> : null}. New variations start at <b>price 0 and min stock 0</b>: set those from <b>Stock In</b> after saving.
            </p>
            <div className="card flex flex-wrap items-end gap-3 p-3">
              {named.map((d, i) => {
                const k = d.name.trim();
                return (
                  <div key={k} className="min-w-[10rem] flex-1">
                    <span className="label">{label(d, i)}</span>
                    <Combobox
                      value={picks[k] ?? null}
                      options={normAttrVals(d).map((v) => ({ id: v, label: d.isQuality ? `${v} star ${stars(v)}` : v }))}
                      onSelect={(v) => setPicks((prev) => { const n = { ...prev }; if (v) n[k] = v; else delete n[k]; return n; })}
                      placeholder={`Select ${d.name || "value"}…`}
                    />
                  </div>
                );
              })}
              <button type="button" className="btn-primary" onClick={createVariation} disabled={!named.length}>+ Create Variation</button>
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
              <button type="button" className="btn-secondary" onClick={() => setStep(2)}>← Back to Data</button>
              <button type="button" className="btn-primary" onClick={goStep4}>Continue →</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-500">Fine-tune each variation — give it a dedicated image.</p>
              <button type="button" className="btn-secondary" onClick={() => setStep(3)}>← Back to Create Variation</button>
            </div>
            {allConfigurable.length === 0 ? (
              <p className="text-sm text-slate-500">No variations to configure — create variations in Step 3 first.</p>
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
