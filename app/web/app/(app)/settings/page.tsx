"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LengthField } from "@/components/measure/LengthField";
import { Restricted } from "@/components/Restricted";
import { Alert, PageHeader, TableSkeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtLenNative, type LengthUnit } from "@/lib/measure";
import { errorText, useApi } from "@/lib/useApi";

interface UnitSetting {
  decimals: number;
  /** Base units (m, or inches for feet + inches); null = never ask. */
  scrapBelow: number | null;
}
type LengthSettings = Record<LengthUnit, UnitSetting>;

const UNITS: readonly [LengthUnit, string][] = [
  ["m", "Metres"],
  ["ft_in", "Feet + inches"],
];

// Decimal places shown and scrap-below length for every Measured product, per length unit.
// Saving copies them onto all Measured products of that unit.
function LengthSettingsCard({ initial, onSaved }: { initial: LengthSettings; onSaved: () => void }) {
  const [value, setValue] = useState<LengthSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => setValue(initial), [initial]);

  const set = (unit: LengthUnit, patch: Partial<UnitSetting>) => {
    setSaved("");
    setValue((v) => ({ ...v, [unit]: { ...v[unit], ...patch } }));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const res = await api<{ productsUpdated: number }>("/company/length-settings", { method: "PUT", body: value });
      setSaved(`Saved. Applied to ${res.productsUpdated} measured product${res.productsUpdated === 1 ? "" : "s"}.`);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card p-5">
      <h2 className="font-semibold text-slate-900">Measured products</h2>
      <p className="mt-1 text-sm text-slate-500">
        These apply to every measured product of each length unit, including new ones. A leftover shorter than the scrap-below length asks:
        write off as scrap, or keep as a cut piece? Leave it empty to never ask.
      </p>
      <div className="mt-4 grid gap-5">
        {UNITS.map(([unit, title]) => (
          <fieldset key={unit} className="grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold text-slate-700">{title}</legend>
            <div>
              <label className="label" htmlFor={`dec-${unit}`}>Decimal places shown</label>
              <select
                id={`dec-${unit}`}
                className="input w-auto"
                value={value[unit].decimals}
                onChange={(e) => set(unit, { decimals: Number(e.target.value) })}
              >
                {[0, 1, 2, 3].map((d) => (
                  <option key={d} value={d}>
                    {d} {d ? `(${fmtLenNative(12.345, { lengthUnit: unit, decimals: d })})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <LengthField
                id={`scrap-${unit}`}
                base={unit}
                label="Scrap below"
                value={value[unit].scrapBelow}
                onChange={(v) => set(unit, { scrapBelow: Number.isFinite(v) && v > 0 ? v : null })}
              />
            </div>
          </fieldset>
        ))}
      </div>
      {error && <div className="mt-4"><Alert message={error} /></div>}
      <div className="mt-4 flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-sm text-emerald-700">{saved}</span>}
      </div>
    </form>
  );
}

function Settings() {
  const { data, error, reload } = useApi<{ name: string; lengthSettings: LengthSettings }>("/company/settings");
  if (!data) return error ? <Alert message={error} /> : <TableSkeleton rows={4} />;

  return (
    <div className="mx-auto grid max-w-2xl gap-5">
      <PageHeader title="Settings" subtitle={data.name} />
      <LengthSettingsCard initial={data.lengthSettings} onSaved={() => void reload()} />
      <section className="card p-5">
        <h2 className="font-semibold text-slate-900">Selling below recorded stock</h2>
        <p className="mt-1 text-sm text-slate-500">
          V2 always uses Warn &amp; Allow for counted stock. Any seller may confirm a sale below zero after a clear shortage warning,
          and each confirmed case is recorded in the audit log. Stock adjustments cannot go below zero; later purchases reconcile a
          negative balance automatically. This policy is fixed and cannot be changed in Settings.
        </p>
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <Restricted permission="company.settings">
      <Settings />
    </Restricted>
  );
}
