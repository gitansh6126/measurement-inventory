"use client";

import { LengthField } from "@/components/measure/LengthField";
import Link from "next/link";
import type { LengthUnit } from "@/lib/measure";

// Length card of a Measured product (wireframes W2–W3): metres or feet + inches, pack name,
// default roll length (purchase pre-fill only). Decimal places and the scrap-below length (DM-7)
// are company-wide per length unit and set in Settings.

export interface MeasureDraft {
  lengthUnit: LengthUnit;
  rollName: string;
  /** Base units (m, or inches for ft + in); NaN = empty. */
  defaultRollLength: number;
}

export const newMeasureDraft = (): MeasureDraft => ({ lengthUnit: "m", rollName: "Roll", defaultRollLength: NaN });

const PACK_NAMES = ["Roll", "Reel", "Coil", "Drum"];

export function MeasurementCard({
  value,
  onChange,
  isEdit,
  unitChanged,
}: {
  value: MeasureDraft;
  onChange: (v: MeasureDraft) => void;
  isEdit: boolean;
  /** Edit screen: the unit differs from the saved one (DM-8 conversion). */
  unitChanged?: boolean;
}) {
  const set = (patch: Partial<MeasureDraft>) => onChange({ ...value, ...patch });
  const pack = value.rollName || "Roll";
  const base = value.lengthUnit;
  return (
    <div className="grid gap-4">
      <div>
        <div className="text-sm font-semibold text-slate-900">Length</div>
        <p className="text-xs text-slate-500">
          Measured products are sold by length. Every sale is cut from one single {pack.toLowerCase()} or cut piece; pieces are never joined.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="label">Length unit *</span>
          <div className="flex gap-2" role="radiogroup" aria-label="Length unit">
            {(
              [
                ["m", "Metres"],
                ["ft_in", "Feet + inches"],
              ] as const
            ).map(([u, t]) => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={base === u}
                onClick={() => set({ lengthUnit: u, defaultRollLength: NaN })}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold ${base === u ? "bg-brand-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"}`}
              >
                {t}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {base === "m" ? "Also accepts cm, mm, ft and in; converted on entry." : "Stored in inches and shown as 41 ft 8 in; metres are converted on entry."}
          </p>
          {isEdit && unitChanged && (
            <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
              Changing the unit converts every roll and rate of this product. It is refused while stock exists (conversion is not available yet).
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="m-pack">Pack name</label>
          <input autoComplete="off" id="m-pack" className="input" list="m-pack-names" maxLength={30} value={value.rollName} onChange={(e) => set({ rollName: e.target.value })} />
          <datalist id="m-pack-names">
            {PACK_NAMES.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div>
          <LengthField
            id="m-default"
            base={base}
            decimals={3}
            label={`Default ${pack.toLowerCase()} length`}
            value={Number.isFinite(value.defaultRollLength) ? value.defaultRollLength : null}
            onChange={(v) => set({ defaultRollLength: v })}
          />
          <p className="mt-1 text-xs text-slate-500">
            Pre-fill only: each {pack.toLowerCase()}&apos;s real length is typed when it is received.
            {base === "ft_in" && Number.isFinite(value.defaultRollLength) && <> = {value.defaultRollLength} in · {(value.defaultRollLength * 0.0254).toFixed(2)} m</>}
          </p>
        </div>
      </div>
      <p className="text-xs text-slate-500">Price, cost and minimum stock are set per {base === "m" ? "metre" : "inch"} in Inventory, not on this form. Decimal places shown and
        the scrap-below length apply to all measured products and are set in{" "}
        <Link href="/settings" className="font-semibold text-brand-700 hover:underline">Settings</Link>.
      </p>
    </div>
  );
}
