"use client";

import { useCallback } from "react";
import { RATE_ENTRY_UNITS, entryOptions, type LengthUnit } from "./measure";
import { usePreference } from "./usePreference";

/**
 * The length and rate units a user last picked when entering Measured lines, remembered
 * separately for sales and for purchases (per user, server-side). Kept per base unit because
 * metre and feet + inches products offer different units. Entry only — stored lengths and
 * rates never change unit.
 */
export type EntryMode = "sale" | "purchase";

type PerBase = Partial<Record<LengthUnit, string>>;
interface EntryUnitsPref {
  length?: PerBase;
  rate?: PerBase;
}

export function useEntryUnits(mode: EntryMode) {
  const pref = usePreference<EntryUnitsPref>(`measure.units.${mode}`, {});
  const { value, save } = pref;

  const lengthUnit = (base: LengthUnit) => {
    const u = value.length?.[base];
    return u && entryOptions(base).includes(u) ? u : undefined;
  };
  const rateUnit = (base: LengthUnit) => {
    const u = value.rate?.[base];
    return u && RATE_ENTRY_UNITS[base].includes(u) ? u : undefined;
  };

  const setLengthUnit = useCallback(
    (base: LengthUnit, u: string) => {
      if (value.length?.[base] !== u) void save({ ...value, length: { ...value.length, [base]: u } });
    },
    [value, save],
  );
  const setRateUnit = useCallback(
    (base: LengthUnit, u: string) => {
      if (value.rate?.[base] !== u) void save({ ...value, rate: { ...value.rate, [base]: u } });
    },
    [value, save],
  );

  return { lengthUnit, rateUnit, setLengthUnit, setRateUnit };
}
