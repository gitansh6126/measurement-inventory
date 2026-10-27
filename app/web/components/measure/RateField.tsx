"use client";

import { useEffect, useRef, useState } from "react";
import { RATE_ENTRY_UNITS, rateFromDefault, rateLabel, rateToDefault, type LengthUnit } from "@/lib/measure";

// A Measured rate typed per any unit (owner decision 2026-10-16, migration 0028). The value is
// always whole rupees per the product's rate unit — per m for metric products, per ft for feet +
// inches products — and that is what is reported and saved. Picking another unit shows the same
// rate per that unit; typing there converts back (rounded to the whole rupee) with a "= ₹x / ft"
// note, so what is stored is never in doubt. `preferredUnit` (the user's remembered sale or
// purchase rate unit) is where the field starts; `onUnitChange` reports a new pick.

const show = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "");

export function RateField({
  unit,
  value,
  onChange,
  id,
  label,
  compact,
  disabled,
  placeholder,
  preferredUnit,
  onUnitChange,
}: {
  unit: LengthUnit;
  /** Whole rupees per the rate unit, as a string ("" while empty). */
  value: string;
  /** Reports whole rupees per the rate unit ("" while empty or invalid). */
  onChange: (value: string) => void;
  id?: string;
  label?: string;
  compact?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Rate unit to start in (ignored when the product does not offer it). */
  preferredUnit?: string;
  onUnitChange?: (unit: string) => void;
}) {
  const base = rateLabel(unit)!;
  const start = preferredUnit && RATE_ENTRY_UNITS[unit].includes(preferredUnit) ? preferredUnit : base;
  const textIn = (v: string, u: string) => (u === base ? v : v === "" ? "" : show(rateFromDefault(Number(v), u, unit)));
  const [entry, setEntry] = useState(start);
  const [text, setText] = useState(() => textIn(value, start));
  const reported = useRef(value);

  // Follow outside changes (a supplier rate picked, a reset) — not the echo of our own typing.
  useEffect(() => {
    if (value === reported.current) return;
    reported.current = value;
    setText(textIn(value, entry));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // A product switching unit (another variation picked), or the remembered unit arriving, starts
  // again per the preferred unit (the product's own rate unit when none applies).
  useEffect(() => {
    setEntry(start);
    setText(textIn(reported.current, start));
  }, [base, start]); // eslint-disable-line react-hooks/exhaustive-deps

  const report = (t: string, u: string) => {
    let v = "";
    if (u === base) v = /^\d{1,10}$/.test(t) ? t : "";
    else if (/^\d{1,9}(\.\d{1,2})?$/.test(t)) {
      const n = rateToDefault(Number(t), u, unit);
      v = Number.isFinite(n) ? String(n) : "";
    }
    reported.current = v;
    onChange(v);
  };

  const converted = entry !== base && value !== "";
  const box = compact ? "h-9 text-sm" : "h-10";

  return (
    <div>
      {label && !compact && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-slate-500">₹</span>
        <input
          id={id}
          className={`input ${box} ${compact ? "w-24" : "w-full min-w-0 flex-1"} text-right font-semibold`}
          inputMode={entry === base ? "numeric" : "decimal"}
          aria-label={label ?? `Rate per ${entry}`}
          placeholder={placeholder ?? "0"}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            const t = e.target.value.replace(entry === base ? /[^\d]/g : /[^\d.]/g, "");
            setText(t);
            report(t, entry);
          }}
        />
        <select
          className={`input ${box} w-auto`}
          aria-label={`${label ?? "Rate"} unit`}
          disabled={disabled}
          value={entry}
          onChange={(e) => {
            const u = e.target.value;
            setEntry(u);
            // Show the stored rate per the new unit; nothing changes until a new rate is typed.
            setText(textIn(value, u));
            onUnitChange?.(u);
          }}
        >
          {RATE_ENTRY_UNITS[unit].map((u) => (
            <option key={u} value={u}>
              / {u}
            </option>
          ))}
        </select>
      </div>
      {converted && (
        <p className="mt-1 text-xs text-slate-500">
          Saved as ₹{value} / {base}
        </p>
      )}
    </div>
  );
}
