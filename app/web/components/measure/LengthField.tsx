"use client";

import { useEffect, useRef, useState } from "react";
import { baseLabel, baseToEntry, entryOptions, fmtLenNative, typedToBase, type LengthUnit } from "@/lib/measure";

// A length typed in any length unit of the product (W14): metres products accept m, cm, mm, ft
// and in; feet + inches products take a feet / inches pair (or in, ft, m). The value reported
// is in the product's base unit; NaN while the field is empty or invalid. `preferredUnit` (the
// user's remembered sale or purchase unit) is where the field starts; `onUnitChange` reports a
// new pick so it can be remembered.

const UNIT_TEXT: Record<string, string> = { "ft+in": "ft + in", m: "m", cm: "cm", mm: "mm", ft: "ft", in: "in" };

const defaultUnit = (base: LengthUnit) => (base === "ft_in" ? "ft+in" : "m");
const startUnit = (base: LengthUnit, preferred?: string) => (preferred && entryOptions(base).includes(preferred) ? preferred : defaultUnit(base));

/** Splits a base-unit value back into the text fields of the entry unit (ft + in pair for "ft+in"). */
function textFor(value: number | null | undefined, base: LengthUnit, unit: string) {
  if (value === null || value === undefined || !Number.isFinite(value)) return { a: "", b: "" };
  if (unit === "ft+in") {
    const ft = Math.floor(value / 12);
    const inch = Math.round((value - ft * 12) * 1000) / 1000;
    return { a: ft ? String(ft) : "", b: inch || !ft ? String(inch) : "" };
  }
  const v = baseToEntry(value, unit, base);
  return { a: Number.isFinite(v) ? String(v) : "", b: "" };
}

export function LengthField({
  base,
  decimals = 3,
  value,
  onChange,
  id,
  label = "Length",
  autoFocus,
  onEnter,
  compact,
  preferredUnit,
  onUnitChange,
}: {
  base: LengthUnit;
  decimals?: number;
  /** Base-unit value; when it changes from outside (e.g. "Whole piece") the fields follow. */
  value: number | null;
  onChange: (baseValue: number) => void;
  id?: string;
  label?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
  compact?: boolean;
  /** Entry unit to start in (ignored when the product does not offer it). */
  preferredUnit?: string;
  onUnitChange?: (unit: string) => void;
}) {
  const [unit, setUnit] = useState(() => startUnit(base, preferredUnit));
  const [t, setT] = useState(() => textFor(value, base, startUnit(base, preferredUnit)));
  const reported = useRef<number | null>(value);

  // Follow outside changes only (not the echo of our own typing).
  useEffect(() => {
    if (Object.is(value, reported.current)) return;
    reported.current = value;
    const u = startUnit(base, preferredUnit);
    setUnit(u);
    setT(textFor(value, base, u));
  }, [value, base]); // eslint-disable-line react-hooks/exhaustive-deps

  // The remembered unit arriving (or changed in another field) moves an untouched field to it.
  useEffect(() => {
    const u = startUnit(base, preferredUnit);
    if (u === unit) return;
    setUnit(u);
    setT(textFor(reported.current, base, u));
  }, [preferredUnit, base]); // eslint-disable-line react-hooks/exhaustive-deps

  const report = (a: string, b: string, u: string) => {
    const v = typedToBase(a, u, base, b);
    reported.current = v;
    onChange(v);
  };
  const clean = (s: string) => s.replace(/[^\d.]/g, "");
  const v = typedToBase(t.a, unit, base, t.b);
  const converted = unit !== "ft+in" && unit !== (base === "m" ? "m" : "in") && Number.isFinite(v);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && onEnter) {
      e.preventDefault();
      onEnter();
    }
  };
  const box = compact ? "h-9 text-sm" : "h-10";

  return (
    <div>
      {!compact && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="flex items-center gap-1.5">
        <input autoComplete="off"
          id={id}
          className={`input ${box} ${unit === "ft+in" ? "w-20" : "w-28"} text-right font-semibold`}
          inputMode="decimal"
          aria-label={unit === "ft+in" ? `${label} feet` : label}
          placeholder={unit === "ft+in" ? "ft" : "0"}
          autoFocus={autoFocus}
          value={t.a}
          onKeyDown={key}
          onChange={(e) => {
            const a = clean(e.target.value);
            setT((x) => ({ ...x, a }));
            report(a, t.b, unit);
          }}
        />
        {unit === "ft+in" && (
          <>
            <span className="text-xs text-slate-500">ft</span>
            <input autoComplete="off"
              className={`input ${box} w-20 text-right font-semibold`}
              inputMode="decimal"
              aria-label={`${label} inches`}
              placeholder="in"
              value={t.b}
              onKeyDown={key}
              onChange={(e) => {
                const b = clean(e.target.value);
                setT((x) => ({ ...x, b }));
                report(t.a, b, unit);
              }}
            />
            <span className="text-xs text-slate-500">in</span>
          </>
        )}
        <select
          className={`input ${box} w-auto`}
          aria-label={`${label} unit`}
          value={unit}
          onChange={(e) => {
            setUnit(e.target.value);
            report(t.a, t.b, e.target.value);
            onUnitChange?.(e.target.value);
          }}
        >
          {entryOptions(base).map((u) => (
            <option key={u} value={u}>
              {UNIT_TEXT[u] ?? u}
            </option>
          ))}
        </select>
      </div>
      {converted && <p className="mt-1 text-xs text-slate-500">= {fmtLenNative(v, { lengthUnit: base, decimals })} ({baseLabel(base)})</p>}
    </div>
  );
}
