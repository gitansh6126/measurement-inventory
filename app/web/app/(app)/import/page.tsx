"use client";

import { useMemo, useState } from "react";
import {
  IMPORT_KIND_LABEL,
  IMPORT_KINDS,
  importFields,
  suggestMapping,
  unitInHeader,
  type ImportCheckResult,
  type ImportCommitResult,
  type ImportKind,
  type ImportRow,
  type ImportRowStatus,
} from "@rs-v31/shared/import";
import { useCan } from "@/components/MeContext";
import { DownloadIcon } from "@/components/icons";
import { Alert, Modal, PageHeader, Segmented, Switch } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { errorText } from "@/lib/useApi";
import { useWarehouses } from "@/lib/useWarehouses";

// V3.1 import (docs\IMPORT-V3.1.md): template → upload → match columns → check → confirm.
// The API reads the file and checks every row; nothing is saved until the user confirms, and then
// everything is saved together or nothing is.

const PERMISSION: Record<ImportKind, string> = { products: "product.write", stock: "stock.adjust", purchases: "purchase.create", sales: "sale.create" };

const INTRO: Record<ImportKind, string> = {
  products: "Create products and items, or update their prices. Rows with the same product name become one product; options (Size, Brand…) make its items.",
  stock: "Add stock you already have. Counted items: one row per item and warehouse. Measured items (rope, wire, cable): one row per roll or bundle with its length. Products not found are created.",
  purchases: "Record past purchases. Rows with the same bill no. become one purchase; suppliers and products not found are created.",
  sales: "Record past sales. Rows with the same bill no. become one sale; customers not found are created. Items must already exist and be in stock.",
};

interface Sheet {
  name: string;
  rows: string[][];
}
/** Where a field's value comes from: a column, or one value typed for every row. */
interface Source {
  col?: number;
  fixed?: string;
  /** Option fields: the option's name (default: the column header). */
  name?: string;
}

const colLetter = (i: number) => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : "") + String.fromCharCode(65 + (i % 26));
const STATUS_STYLE: Record<ImportRowStatus, string> = {
  ok: "bg-emerald-50 text-emerald-700",
  warning: "bg-amber-50 text-amber-700",
  error: "bg-red-50 text-red-700",
};
const STATUS_LABEL: Record<ImportRowStatus, string> = { ok: "Ready", warning: "Check", error: "Error" };

function storedMapping(kind: ImportKind, headers: string[]): Record<string, Source> | null {
  try {
    const raw = localStorage.getItem(`import-map:${kind}:${headers.join("|")}`);
    return raw ? (JSON.parse(raw) as Record<string, Source>) : null;
  } catch {
    return null;
  }
}
function storeMapping(kind: ImportKind, headers: string[], map: Record<string, Source>) {
  try {
    localStorage.setItem(`import-map:${kind}:${headers.join("|")}`, JSON.stringify(map));
  } catch {
    // Browser storage is only a convenience.
  }
}

export default function ImportPage() {
  const allowed = { products: useCan("product.write"), stock: useCan("stock.adjust"), purchases: useCan("purchase.create"), sales: useCan("sale.create") };
  const canWarehouses = useCan("warehouse.manage");
  const kinds = IMPORT_KINDS.filter((k) => allowed[k]);
  const [kind, setKind] = useState<ImportKind>(kinds[0] ?? "stock");
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(1);
  const [map, setMap] = useState<Record<string, Source>>({});
  const [options, setOptions] = useState({ createProducts: true, createParties: true, createWarehouses: false });
  const [check, setCheck] = useState<ImportCheckResult | null>(null);
  const [filter, setFilter] = useState<"all" | ImportRowStatus>("all");
  const [busy, setBusy] = useState<"" | "read" | "check" | "commit">("");
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<ImportCommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Warehouse names in the sheet that are not a warehouse here → the warehouse code to use instead
  // ("Godam" → W1). Applied to the rows before they are sent.
  const [whAlias, setWhAlias] = useState<Record<string, string>>({});
  const wh = useWarehouses();

  const fields = importFields(kind);
  const sheet = sheets[sheetIndex];
  const headers = useMemo(() => (sheet?.rows[headerRow - 1] ?? []).map((h, i) => h || `Column ${colLetter(i)}`), [sheet, headerRow]);
  const width = useMemo(() => Math.max(headers.length, ...(sheet?.rows ?? []).map((r) => r.length)), [sheet, headers]);

  function autoMap(k: ImportKind, s: Sheet | undefined, hr: number) {
    const hs = (s?.rows[hr - 1] ?? []).map((h) => h ?? "");
    const saved = storedMapping(k, hs);
    if (saved) return saved;
    const cols = suggestMapping(k, hs);
    const next: Record<string, Source> = {};
    for (const [key, col] of Object.entries(cols)) next[key] = { col };
    // "Remaining (ft)" → the lengths are in feet.
    if (next.length?.col !== undefined && !next.lengthIn) {
      const u = unitInHeader(hs[next.length.col] ?? "");
      if (u) next.lengthIn = { fixed: u };
    }
    return next;
  }

  function reset() {
    setCheck(null);
    setDone(null);
    setError(null);
  }

  function changeKind(k: ImportKind) {
    setKind(k);
    setMap(autoMap(k, sheet, headerRow));
    setFilter("all");
    reset();
  }

  async function upload(file: File) {
    reset();
    setBusy("read");
    try {
      const res = await fetch("/api/import/read", { method: "POST", body: file, headers: { "Content-Type": "application/octet-stream" }, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "HTTP_ERROR", data?.error?.message ?? "Could not read the file");
      const list = (data.sheets as Sheet[]).filter((s) => s.rows.some((r) => r.some((x) => x)));
      if (!list.length) throw new ApiError(400, "EMPTY", "The file has no rows");
      setSheets(list);
      setFileName(file.name);
      setSheetIndex(0);
      const hr = list[0]!.rows.findIndex((r) => r.some((x) => x)) + 1;
      setHeaderRow(hr);
      setMap(autoMap(kind, list[0], hr));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  function pickSheet(i: number) {
    setSheetIndex(i);
    const hr = sheets[i]!.rows.findIndex((r) => r.some((x) => x)) + 1;
    setHeaderRow(hr);
    setMap(autoMap(kind, sheets[i], hr));
    reset();
  }

  function setSource(key: string, s: Source | null) {
    setMap((m) => {
      const next = { ...m };
      if (s) next[key] = s;
      else delete next[key];
      return next;
    });
    setCheck(null);
    setDone(null);
  }

  /** The sheet's data rows with the matching applied; rows with nothing in any matched column are left out. */
  const rows = useMemo<ImportRow[]>(() => {
    if (!sheet) return [];
    const out: ImportRow[] = [];
    for (let i = headerRow; i < sheet.rows.length; i++) {
      const r = sheet.rows[i] ?? [];
      const values: Record<string, string> = {};
      const opts: ImportRow["options"] = [];
      let any = false;
      for (const f of fields) {
        const s = map[f.key];
        if (!s) continue;
        const value = (s.col !== undefined ? (r[s.col] ?? "") : (s.fixed ?? "")).trim();
        if (s.col !== undefined && value) any = true;
        if (f.option) opts.push({ name: (s.name ?? (s.col !== undefined ? headers[s.col] : f.label) ?? "").trim(), value });
        else values[f.key] = f.key === "warehouse" && value ? (whAlias[value.toLowerCase()] ?? value) : value;
      }
      if (any) out.push({ rowNo: i + 1, values, options: opts });
    }
    return out;
  }, [sheet, headerRow, fields, map, headers, whAlias]);

  /** Warehouse names used in the sheet's warehouse column that match no warehouse code or name. */
  const unknownWarehouses = useMemo(() => {
    const s = map.warehouse;
    if (!sheet || !s || !wh.enabled || !fields.some((f) => f.key === "warehouse")) return [];
    const known = new Set(wh.warehouses.flatMap((w) => [w.code.toLowerCase(), w.name.toLowerCase()]));
    const names = new Map<string, string>();
    for (let i = headerRow; i < sheet.rows.length; i++) {
      const v = (s.col !== undefined ? (sheet.rows[i]?.[s.col] ?? "") : (s.fixed ?? "")).trim();
      if (v && !known.has(v.toLowerCase()) && !names.has(v.toLowerCase())) names.set(v.toLowerCase(), v);
    }
    return [...names.values()];
  }, [sheet, headerRow, map, wh, fields]);

  const missing = fields.filter((f) => f.required && !map[f.key]);
  const noItem = !map.product && !map.code;

  async function runCheck() {
    setError(null);
    setDone(null);
    setBusy("check");
    try {
      if (sheet) storeMapping(kind, (sheet.rows[headerRow - 1] ?? []).map((h) => h ?? ""), map);
      setCheck(await api<ImportCheckResult>(`/import/${kind}/check`, { method: "POST", body: { rows, options } }));
      setFilter("all");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }

  async function commit() {
    setError(null);
    setBusy("commit");
    try {
      const result = await api<ImportCommitResult>(`/import/${kind}/commit`, { method: "POST", body: { rows, options, skipErrors: true } });
      setDone(result);
      setCheck(result);
      setConfirming(false);
    } catch (e) {
      setError(errorText(e));
      setConfirming(false);
    } finally {
      setBusy("");
    }
  }

  if (!kinds.length) {
    return (
      <div>
        <PageHeader title="Import" />
        <Alert message="You do not have permission to import." />
      </div>
    );
  }

  const shown = check?.rows.filter((r) => filter === "all" || r.status === filter) ?? [];
  const importable = check ? check.counts.ok + check.counts.warning : 0;
  const creates = check?.creates;
  const createLines = creates
    ? [
        creates.products.length && `${creates.products.length} new product${creates.products.length > 1 ? "s" : ""}: ${creates.products.join(", ")}`,
        creates.variations.length && `${creates.variations.length} new item${creates.variations.length > 1 ? "s" : ""}`,
        creates.categories.length && `New categor${creates.categories.length > 1 ? "ies" : "y"}: ${creates.categories.join(", ")}`,
        creates.parties.length && `New ${kind === "sales" ? "customer" : "supplier"}${creates.parties.length > 1 ? "s" : ""}: ${creates.parties.join(", ")}`,
        creates.warehouses.length && `New warehouse${creates.warehouses.length > 1 ? "s" : ""}: ${creates.warehouses.join(", ")}`,
        check!.documents > 0 && `${check!.documents} ${kind === "sales" ? "sale" : "purchase"}${check!.documents > 1 ? "s" : ""} will be recorded`,
      ].filter((x): x is string => !!x)
    : [];

  return (
    <div>
      <PageHeader
        title="Import"
        subtitle="Bring products, stock, purchases and sales in from Excel or CSV"
        actions={
          <a className="btn-secondary" href={`/api/import/templates/${kind}`} download>
            <DownloadIcon className="h-4 w-4" /> Blank {IMPORT_KIND_LABEL[kind].toLowerCase()} template
          </a>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented label="What to import" value={kind} onChange={changeKind} options={kinds.map((k) => ({ value: k, label: IMPORT_KIND_LABEL[k] }))} />
      </div>
      <p className="mb-4 max-w-3xl text-sm text-slate-600">{INTRO[kind]}</p>

      <Alert message={error} />
      {done && <Alert kind="success" message={`${done.message}${done.documentNumbers.length ? ` (${done.documentNumbers.join(", ")})` : ""}`} />}

      {/* 1. File */}
      <section className="card mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">1. Choose the file</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn-primary cursor-pointer">
            {busy === "read" ? "Reading…" : fileName ? "Choose another file" : "Choose .xlsx or .csv"}
            <input
              type="file"
              accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = "";
              }}
            />
          </label>
          {fileName && <span className="text-sm text-slate-700">{fileName}</span>}
          {sheets.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              Sheet
              <select className="input w-auto" value={sheetIndex} onChange={(e) => pickSheet(Number(e.target.value))}>
                {sheets.map((s, i) => (
                  <option key={s.name + i} value={i}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {sheet && (
            <label className="flex items-center gap-2 text-sm">
              Headers in row
              <input autoComplete="off"
                className="input w-20"
                type="number"
                min={1}
                max={sheet.rows.length}
                value={headerRow}
                onChange={(e) => {
                  const hr = Math.min(Math.max(1, Number(e.target.value) || 1), sheet.rows.length);
                  setHeaderRow(hr);
                  setMap(autoMap(kind, sheet, hr));
                  reset();
                }}
              />
            </label>
          )}
          {sheet && <span className="text-xs text-slate-500">{rows.length} data rows</span>}
        </div>
        {!sheet && <p className="mt-3 text-xs text-slate-500">Start from the blank template (top right), or upload your own sheet and match its columns in the next step.</p>}
      </section>

      {/* 2. Column matching */}
      {sheet && (
        <section className="card mb-4 p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-800">2. Match the columns</h2>
          <p className="mb-3 text-xs text-slate-500">Pick the column holding each field, or &quot;Same for every row&quot; to type one value (e.g. Product name = Wire Rope). Fields left as &quot;Not used&quot; are ignored.</p>
          <div className="table-container">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>From your sheet</th>
                  <th>Value / option name</th>
                  <th>First row</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => {
                  const s = map[f.key];
                  const firstRow = sheet.rows[(rows[0]?.rowNo ?? headerRow + 1) - 1] ?? [];
                  const sample = s?.col !== undefined ? firstRow[s.col] : s?.fixed;
                  const needed = f.required || (f.key === "product" && noItem);
                  return (
                    <tr key={f.key}>
                      <td className="align-top">
                        <div className="font-medium text-slate-800">
                          {f.label}
                          {needed && <span className="text-red-600"> *</span>}
                        </div>
                        <div className="max-w-xs text-xs text-slate-500">{f.hint}</div>
                      </td>
                      <td className="stack-full align-top">
                        <select
                          className="input"
                          aria-label={`${f.label} from`}
                          value={s?.col !== undefined ? String(s.col) : s ? "fixed" : ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) setSource(f.key, null);
                            else if (v === "fixed") setSource(f.key, { fixed: "", name: f.option ? "" : undefined });
                            else setSource(f.key, { col: Number(v) });
                          }}
                        >
                          <option value="">— Not used —</option>
                          <option value="fixed">Same for every row…</option>
                          {Array.from({ length: width }, (_, i) => (
                            <option key={i} value={i}>
                              {colLetter(i)} · {headers[i] ?? `Column ${colLetter(i)}`}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="stack-full align-top">
                        {s && s.col === undefined && (
                          <input autoComplete="off" className="input" placeholder={f.option ? "Value for every row" : f.demo || "Value for every row"} value={s.fixed ?? ""} onChange={(e) => setSource(f.key, { ...s, fixed: e.target.value })} />
                        )}
                        {s && f.option && (
                          <input autoComplete="off"
                            className="input mt-1"
                            placeholder="Option name"
                            aria-label={`${f.label} name`}
                            value={s.name ?? (s.col !== undefined ? headers[s.col] : "")}
                            onChange={(e) => setSource(f.key, { ...s, name: e.target.value })}
                          />
                        )}
                      </td>
                      <td className="align-top text-sm text-slate-600">{s ? sample || <span className="text-slate-400">blank</span> : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {unknownWarehouses.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <h3 className="text-sm font-semibold text-slate-800">Warehouses not found</h3>
              <p className="mb-2 text-xs text-slate-600">Your sheet names warehouses that do not exist here. Pick the warehouse each one means.</p>
              <div className="space-y-2">
                {unknownWarehouses.map((name) => (
                  <label key={name} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-32 font-medium">{name}</span>
                    <span className="text-slate-400">→</span>
                    <select
                      className="input w-auto"
                      aria-label={`Warehouse for ${name}`}
                      value={whAlias[name.toLowerCase()] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setWhAlias((a) => {
                          const next = { ...a };
                          if (v) next[name.toLowerCase()] = v;
                          else delete next[name.toLowerCase()];
                          return next;
                        });
                        setCheck(null);
                        setDone(null);
                      }}
                    >
                      <option value="">{options.createWarehouses && canWarehouses ? "Create it as a new warehouse" : "Not matched (rows show an error)"}</option>
                      {wh.active.map((w) => (
                        <option key={w.id} value={w.code}>
                          {w.code} · {w.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {kind !== "sales" && (
              <Switch checked={options.createProducts} onChange={(v) => (setOptions((o) => ({ ...o, createProducts: v })), setCheck(null))} label="Create missing products and items" />
            )}
            {(kind === "sales" || kind === "purchases") && (
              <Switch checked={options.createParties} onChange={(v) => (setOptions((o) => ({ ...o, createParties: v })), setCheck(null))} label={`Create missing ${kind === "sales" ? "customers" : "suppliers"}`} />
            )}
            {kind !== "products" && canWarehouses && (
              <Switch checked={options.createWarehouses} onChange={(v) => (setOptions((o) => ({ ...o, createWarehouses: v })), setCheck(null))} label="Create missing warehouses" />
            )}
          </div>
          {options.createWarehouses && kind !== "products" && (
            <p className="mt-2 text-xs text-amber-700">If warehouses are not set up yet, the first one created holds all current stock and becomes the default.</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" disabled={!rows.length || !!missing.length || noItem || busy !== ""} onClick={runCheck}>
              {busy === "check" ? "Checking…" : `Check ${rows.length} row${rows.length === 1 ? "" : "s"}`}
            </button>
            {(missing.length > 0 || noItem) && (
              <span className="text-xs text-red-600">Match {[...(noItem ? ["Product name or Item code"] : []), ...missing.map((f) => f.label)].join(", ")} first.</span>
            )}
          </div>
        </section>
      )}

      {/* 3. Check and confirm */}
      {check && (
        <section className="card mb-4 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-800">{done ? "Imported" : "3. Check and import"}</h2>
            <Segmented
              label="Show rows"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: `All ${check.rows.length}` },
                { value: "ok", label: `Ready ${check.counts.ok}` },
                { value: "warning", label: `Check ${check.counts.warning}` },
                { value: "error", label: `Errors ${check.counts.error}` },
              ]}
            />
          </div>
          {createLines.length > 0 && (
            <ul className="mb-3 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
              {createLines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          <div className="table-container max-h-[60vh] overflow-auto">
            <table className="table table-stack">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Status</th>
                  <th>What happens</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.rowNo}>
                    <td className="text-slate-500"><span className="md:hidden">Row </span>{r.rowNo}</td>
                    <td>
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td className="text-sm">{r.action || <span className="text-slate-400">—</span>}</td>
                    <td className="text-xs text-slate-600">{r.messages.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!done && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" className="btn-primary" disabled={!importable || busy !== ""} onClick={() => setConfirming(true)}>
                Import {importable} row{importable === 1 ? "" : "s"}
              </button>
              {check.counts.error > 0 && <span className="text-xs text-slate-600">{check.counts.error} row{check.counts.error > 1 ? "s" : ""} with errors will be skipped. Fix them in the sheet and upload again to bring them in.</span>}
            </div>
          )}
        </section>
      )}

      <Modal open={confirming} title={`Import ${IMPORT_KIND_LABEL[kind].toLowerCase()}?`} onClose={() => busy !== "commit" && setConfirming(false)}>
        <div className="space-y-3 text-sm text-slate-700">
          <p>
            {importable} row{importable === 1 ? "" : "s"} from {fileName} will be saved now, all together.
            {check?.counts.error ? ` ${check.counts.error} row${check.counts.error > 1 ? "s" : ""} with errors will be skipped.` : ""}
          </p>
          {createLines.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5">
              {createLines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500">Stock, purchases and sales are recorded like ones entered by hand and can be corrected or cancelled the same way.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={busy === "commit"} onClick={() => setConfirming(false)}>
              Back
            </button>
            <button type="button" className="btn-primary" disabled={busy === "commit"} onClick={commit}>
              {busy === "commit" ? "Importing…" : "Yes, import"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
