"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { RATE_ENTRY_UNITS, rateFromDefault, rateLabel, rateToDefault, type LengthUnit } from "@/lib/measure";
import { useLengthView } from "@/lib/lengthView";

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
  hasError,
  title,
  followLengthView,
  error,
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
  hasError?: boolean;
  title?: string;
  /**
   * When true, only show the separate unit dropdown when the scope's length view is "both" (m+ft).
   * When "m" or "ft", locks entry to that single unit and hides the separate dropdown.
   */
  followLengthView?: boolean;
  /** Optional validation error message shown under the input */
  error?: ReactNode;
}) {
  const lengthView = useLengthView();
  const base = rateLabel(unit)!;
  const start = preferredUnit && RATE_ENTRY_UNITS[unit].includes(preferredUnit) ? preferredUnit : base;
  const effectiveStart =
    followLengthView && (lengthView === "m" || lengthView === "ft") && RATE_ENTRY_UNITS[unit].includes(lengthView)
      ? lengthView
      : start;
  const textIn = (v: string, u: string) => (u === base ? v : v === "" ? "" : show(rateFromDefault(Number(v), u, unit)));
  const [entry, setEntry] = useState(effectiveStart);
  const [text, setText] = useState(() => textIn(value, effectiveStart));
  const [showInfo, setShowInfo] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);
  const reported = useRef(value);

  // Close mobile popover when clicking or tapping outside.
  useEffect(() => {
    if (!showInfo) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) {
        setShowInfo(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [showInfo]);

  // Follow outside changes (a supplier rate picked, a reset) — not the echo of our own typing.
  useEffect(() => {
    if (value === reported.current) return;
    reported.current = value;
    setText(textIn(value, entry));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // When followLengthView is true and the length view is a single unit ("m" or "ft"),
  // lock the entry unit to that view.
  useEffect(() => {
    if (!followLengthView) return;
    if (lengthView === "m" || lengthView === "ft") {
      if (RATE_ENTRY_UNITS[unit].includes(lengthView)) {
        setEntry(lengthView);
        setText(textIn(reported.current, lengthView));
      }
    }
  }, [followLengthView, lengthView, unit]); // eslint-disable-line react-hooks/exhaustive-deps

  // A product switching unit (another variation picked), or the remembered unit arriving, starts
  // again per the preferred unit (the product's own rate unit when none applies).
  useEffect(() => {
    if (followLengthView && (lengthView === "m" || lengthView === "ft") && RATE_ENTRY_UNITS[unit].includes(lengthView)) {
      setEntry(lengthView);
      setText(textIn(reported.current, lengthView));
    } else {
      setEntry(start);
      setText(textIn(reported.current, start));
    }
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

  const showDropdown = !followLengthView || lengthView === "both";
  const converted = entry !== base && value !== "";
  const box = compact ? "h-8 text-xs sm:h-9 sm:text-sm" : "h-10";

  return (
    <div ref={infoRef} className={`relative inline-flex flex-col ${compact ? "items-end" : "w-full items-stretch"} group/rate`}>
      {label && !compact && (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      )}
      <div className="flex items-center gap-1 sm:gap-1.5">
        <span className="text-xs sm:text-sm text-slate-500 font-medium">₹</span>
        <input autoComplete="off"
          id={id}
          className={`input ${box} ${compact ? "w-20 sm:w-24" : "w-full min-w-0 flex-1"} text-right font-semibold ${
            hasError ? "border-rose-500 bg-rose-50 text-rose-900 focus:border-rose-600 focus:ring-rose-500" : ""
          }`}
          title={title ?? (converted ? `Saved as ₹${value} / ${base}` : undefined)}
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
        {showDropdown ? (
          <select
            className={`input ${compact ? "h-8 text-xs py-0.5 pl-1.5 pr-4 sm:h-9 sm:text-sm sm:pl-2 sm:pr-5" : "h-10"} w-auto`}
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
        ) : (
          <span className={`${compact ? "text-xs sm:text-sm" : "text-sm"} font-medium ${disabled ? "text-slate-400" : "text-slate-600"} whitespace-nowrap`}>
            / {entry}
          </span>
        )}
        {converted && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowInfo((prev) => !prev);
            }}
            className="inline-flex h-4 w-4 sm:h-5 sm:w-5 items-center justify-center rounded-full text-slate-400 hover:text-brand-600 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label={`Saved as ₹${value} / ${base}`}
            title={`Saved as ₹${value} / ${base}`}
          >
            <svg className="h-3 w-3 sm:h-3.5 sm:w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-7-4a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM9 9a.75.75 0 0 0 0 1.5h.253a.25.25 0 0 1 .244.304l-.459 2.066A1.75 1.75 0 0 0 10.747 15H11a.75.75 0 0 0 0-1.5h-.253a.25.25 0 0 1-.244-.304l.459-2.066A1.75 1.75 0 0 0 9.253 9H9Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Extra info: on laptop, shows on hover; on mobile, toggled via info button */}
      {converted && (
        <div
          role="tooltip"
          className={`absolute right-0 top-full z-30 mt-1 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white shadow-lg ring-1 ring-slate-800 transition-all ${
            showInfo
              ? "flex items-center gap-1.5 opacity-100"
              : "hidden md:group-hover/rate:flex opacity-0 md:group-hover/rate:opacity-100 pointer-events-none md:pointer-events-auto"
          }`}
        >
          <span className="text-slate-400 font-normal">Saved as:</span>
          <span className="font-semibold text-slate-100">₹{value} / {base}</span>
          {showInfo && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowInfo(false);
              }}
              className="ml-1 text-slate-400 hover:text-white"
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mt-0.5 text-[10px] font-medium leading-tight text-rose-600 text-right" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
