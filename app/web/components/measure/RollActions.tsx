"use client";

import { useState } from "react";
import { LengthField } from "@/components/measure/LengthField";
import { Alert, Modal } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtLen, pieceName, rollWord, type MeasureMeta } from "@/lib/measure";
import { errorText } from "@/lib/useApi";
import { useWarehouses } from "@/lib/useWarehouses";
import { useLengthView } from "@/lib/lengthView";

// Roll operations (wireframes W9–W11): add rolls (opening / found stock), open, cut, write off,
// correct length and edit details. Every length change goes through /api/measure and is
// recorded in the roll's history; nothing here changes stock by typing a number (BR-18).
// Pieces are named by variation, kind and length; roll codes are not shown (owner design 2026-10-16).

export interface PieceTarget {
  id: string;
  code: string;
  kind: "CLOSED" | "OPEN" | "CUT";
  remainingLength: number;
  originalLength: number;
  notes: string | null;
  /** Variation label, for titles and messages. */
  variation?: string;
}

const lenOk = (n: number) => Number.isFinite(n) && n > 0;
const nameOf = (piece: PieceTarget, meta: MeasureMeta) => pieceName(piece, meta, piece.variation);

/** A bar of what stays (solid) against what is cut (hatched). */
export function CutBar({ total, cut }: { total: number; cut: number }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (cut / total) * 100)) : 0;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-emerald-200" aria-hidden>
      <div className="h-full bg-emerald-500" style={{ width: `${100 - pct}%` }} />
      <div className="h-full bg-[repeating-linear-gradient(45deg,#f59e0b_0,#f59e0b_4px,#fde68a_4px,#fde68a_8px)]" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// W9: Add rolls
// ---------------------------------------------------------------------------

interface RollRow {
  count: number;
  /** Length on the rack now (what stock counts). */
  length: number;
  /** Open rolls only: full length when new; NaN = not known (same as now). */
  original: number;
  kind: "CLOSED" | "OPEN";
}

export function AddRollsModal({
  open,
  onClose,
  onDone,
  variationId,
  title,
  meta,
  defaultLength,
  warehouseId,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
  variationId: string;
  title: string;
  meta: MeasureMeta;
  defaultLength: number | null;
  /** V3.1: warehouse pre-selected (the Stock In filter); default warehouse otherwise. */
  warehouseId?: string | null;
}) {
  useLengthView();
  const wh = useWarehouses();
  const [chosenWarehouse, setWarehouse] = useState(warehouseId ?? "");
  const warehouse = chosenWarehouse || wh.defaultWarehouse?.id || "";
  const blank = (prev?: RollRow): RollRow => ({ count: 1, length: prev?.length ?? defaultLength ?? NaN, original: prev?.original ?? NaN, kind: prev?.kind ?? "CLOSED" });
  const [rows, setRows] = useState<RollRow[]>(() => [blank()]);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const word = rollWord(meta);
  const totalPieces = rows.reduce((s, r) => s + (Number.isFinite(r.count) && r.count > 0 ? r.count : 0), 0);
  const total = rows.reduce((s, r) => s + (lenOk(r.length) && r.count > 0 ? r.length * r.count : 0), 0);
  const anyOpen = rows.some((r) => r.kind === "OPEN");
  const addRow = () => setRows((r) => [...r, blank(r[r.length - 1])]);
  const patch = (i: number, p: Partial<RollRow>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));

  async function save() {
    setError("");
    if (rows.some((r) => !lenOk(r.length))) return setError(`Enter the length of every ${word}`);
    if (rows.some((r) => !r.count || r.count < 1)) return setError(`Enter a valid quantity of ${rollWord(meta, 2)}`);
    if (rows.some((r) => r.kind === "OPEN" && lenOk(r.original) && r.original < r.length)) return setError(`The full length of an open ${word} cannot be less than what is left`);
    setSaving(true);
    try {
      const rolls = rows.flatMap((r) =>
        Array.from({ length: Math.max(1, Math.floor(r.count || 1)) }, () => ({
          length: Math.round(r.length * 1000) / 1000,
          kind: r.kind,
          ...(r.kind === "OPEN" && lenOk(r.original) ? { originalLength: Math.round(r.original * 1000) / 1000 } : {}),
        }))
      );
      const res = await api<{ pieces: { code: string }[] }>(`/measure/variations/${variationId}/rolls`, {
        method: "POST",
        body: {
          rolls,
          note: note || null,
          ...(wh.enabled && warehouse ? { warehouseId: warehouse } : {}),
        },
      });
      onDone(`Added ${res.pieces.length} ${rollWord(meta, res.pieces.length)} (${fmtLen(total, meta)}) to ${title}`);
      setRows([blank()]);
      setNote("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Add ${rollWord(meta, 2)} · ${title}`} wide>
      <p className="mb-3 text-sm text-slate-500">
        Opening or found stock: specify quantity, length, and condition of physical {rollWord(meta, 2)}. Purchases receive {rollWord(meta, 2)} themselves.
      </p>
      <div className="max-h-[50vh] overflow-auto rounded-xl border border-slate-200">
        <table className="table table-stack">
          <thead>
            <tr>
              <th>#</th>
              <th className="w-24">No. of {rollWord(meta, 2)}</th>
              <th>{anyOpen ? "Length now" : "Length"}</th>
              <th>Condition</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="text-slate-500"><span className="capitalize md:hidden">{word} </span>{i + 1}</td>
                <td>
                  <input autoComplete="off"
                    type="number"
                    min={1}
                    step={1}
                    className="input h-9 w-20 text-center text-sm font-semibold"
                    value={Number.isFinite(r.count) ? r.count : ""}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      patch(i, { count: isNaN(val) ? 1 : Math.max(1, val) });
                    }}
                    aria-label={`Number of ${word}s for row ${i + 1}`}
                  />
                </td>
                <td className="stack-full">
                  <LengthField compact base={meta.lengthUnit} decimals={meta.decimals} label={`${word} ${i + 1} length`} value={Number.isFinite(r.length) ? r.length : null} onChange={(v) => patch(i, { length: v })} onEnter={addRow} autoFocus={i > 0 && i === rows.length - 1} />
                  {r.kind === "OPEN" && (
                    <div className="mt-2">
                      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Full length when new (optional)</span>
                      <LengthField compact base={meta.lengthUnit} decimals={meta.decimals} label={`${word} ${i + 1} full length when new`} value={Number.isFinite(r.original) ? r.original : null} onChange={(v) => patch(i, { original: v })} />
                      {lenOk(r.original) && lenOk(r.length) && r.original >= r.length && <p className="mt-0.5 text-[11px] text-slate-500">{fmtLen(r.original - r.length, meta)} used of {fmtLen(r.original, meta)}</p>}
                    </div>
                  )}
                </td>
                <td>
                  <select className="input h-9 w-auto text-sm" value={r.kind} aria-label={`${word} ${i + 1} condition`} onChange={(e) => patch(i, { kind: e.target.value as RollRow["kind"] })}>
                    <option value="CLOSED">Closed (sealed)</option>
                    <option value="OPEN">Open (in use)</option>
                  </select>
                </td>

                <td>
                  <button type="button" className="text-slate-400 hover:text-rose-600 disabled:opacity-30" disabled={rows.length === 1} aria-label={`Remove row ${i + 1}`} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex items-center gap-3 text-sm">
        <button type="button" className="btn-secondary" onClick={addRow}>
          + Add row
        </button>
        <span className="text-xs text-slate-500">
          Enter in a length adds the next row with the same length.{anyOpen && ` For an open ${word}, Length now is what is left (counted as stock); the full length is optional and shows how much was used.`}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        {wh.enabled && (
          <div>
            <label className="label" htmlFor="add-warehouse">Warehouse</label>
            <select id="add-warehouse" className="input w-auto" value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
              {wh.active.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} · {w.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="min-w-[12rem] flex-1">
          <label className="label" htmlFor="add-note">Note</label>
          <input autoComplete="off" id="add-note" className="input" maxLength={200} placeholder="e.g. Opening count 14 Oct" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <Alert message={error} />
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-800">
          {totalPieces} {rollWord(meta, totalPieces)} · Total {fmtLen(total, meta)}
        </span>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={save}>
            {saving ? "Saving…" : `Save ${totalPieces} ${rollWord(meta, totalPieces)}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// W10: Open / Cut
// ---------------------------------------------------------------------------

export function CutModal({ piece, meta, open, onClose, onDone, openOnly }: { piece: PieceTarget; meta: MeasureMeta; open: boolean; onClose: () => void; onDone: (message: string) => void; openOnly?: boolean }) {
  useLengthView();
  const [mode, setMode] = useState<"one" | "many">("one");
  const [lengths, setLengths] = useState<number[]>([NaN]);
  const [reason, setReason] = useState("Pre-cut for stock");
  const [leftover, setLeftover] = useState<"keep" | "writeoff" | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [withCut, setWithCut] = useState(!openOnly);

  const valid = lengths.filter(lenOk);
  const total = valid.reduce((s, l) => s + l, 0);
  const after = Math.round((piece.remainingLength - total) * 1000) / 1000;
  const scrap = meta.scrapBelow ?? 0;
  const scrapLeft = withCut && valid.length > 0 && after > 0 && scrap > 0 && after < scrap;

  async function save() {
    setError("");
    setSaving(true);
    try {
      if (openOnly && !withCut) {
        await api(`/measure/pieces/${piece.id}/open`, { method: "POST" });
        onDone(`${nameOf(piece, meta)} is now open`);
        return;
      }
      if (!valid.length || valid.length !== lengths.length) throw new Error("Enter every length to cut");
      if (total > piece.remainingLength) throw new Error(`Cutting ${fmtLen(total, meta)} needs more than the ${fmtLen(piece.remainingLength, meta)} left`);
      if (scrapLeft && !leftover) throw new Error("Choose what to do with the leftover");
      const res = await api<{ pieces: { code: string }[] }>(`/measure/pieces/${piece.id}/cut`, {
        method: "POST",
        body: { lengths: valid.map((l) => Math.round(l * 1000) / 1000), writeOffLeftover: scrapLeft && leftover === "writeoff", reason: reason || null },
      });
      onDone(`Cut ${res.pieces.length} ${res.pieces.length === 1 ? "piece" : "pieces"} (${fmtLen(total, meta)}) from ${nameOf(piece, meta)}`);
    } catch (e) {
      setError(e instanceof Error && !("status" in e) ? e.message : errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`${openOnly ? "Open" : "Cut"} · ${nameOf(piece, meta)}`}>
      <div className="mb-3 grid gap-2 rounded-lg bg-slate-50 p-3 text-sm">
        <div className="flex justify-between">
          <span>{piece.kind === "CLOSED" ? "Closed" : piece.kind === "OPEN" ? "Open" : "Cut piece"} · now</span>
          <b>{fmtLen(piece.remainingLength, meta)}</b>
        </div>
        {withCut && <CutBar total={piece.remainingLength} cut={total} />}
        {withCut && valid.length > 0 && (
          <div className="flex justify-between text-xs text-slate-600">
            <span>Cut {fmtLen(total, meta)}</span>
            <span className={after < 0 ? "font-semibold text-rose-600" : ""}>stays {fmtLen(after, meta)}</span>
          </div>
        )}
      </div>
      {openOnly && (
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={withCut} onChange={(e) => setWithCut(e.target.checked)} /> Make a first cut now
        </label>
      )}
      {withCut && (
        <>
          <div className="mb-3 flex gap-2" role="radiogroup" aria-label="Cut mode">
            {(
              [
                ["one", "Cut one length"],
                ["many", "Cut into several"],
              ] as const
            ).map(([m, t]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${mode === m ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-200"}`}
                onClick={() => {
                  setMode(m);
                  if (m === "one") setLengths((l) => [l[0] ?? NaN]);
                }}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="grid gap-2">
            {lengths.map((l, i) => (
              <div key={i} className="flex items-end gap-2">
                <LengthField
                  base={meta.lengthUnit}
                  decimals={meta.decimals}
                  label={mode === "one" ? "Cut length" : `Piece ${i + 1}`}
                  value={Number.isFinite(l) ? l : null}
                  onChange={(v) => setLengths((x) => x.map((y, j) => (j === i ? v : y)))}
                  onEnter={mode === "many" ? () => setLengths((x) => [...x, x[x.length - 1] ?? NaN]) : undefined}
                  autoFocus={i === lengths.length - 1}
                />
                {mode === "many" && lengths.length > 1 && (
                  <button type="button" className="mb-2 text-slate-400 hover:text-rose-600" aria-label={`Remove piece ${i + 1}`} onClick={() => setLengths((x) => x.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                )}
              </div>
            ))}
            {mode === "many" && (
              <button type="button" className="btn-secondary w-fit" onClick={() => setLengths((x) => [...x, x[x.length - 1] ?? NaN])}>
                + Add piece
              </button>
            )}
            <p className="text-xs text-slate-500">Max {fmtLen(piece.remainingLength, meta)}</p>
          </div>
          <div className="mt-3">
            <label className="label" htmlFor="cut-reason">Reason</label>
            <input autoComplete="off" id="cut-reason" className="input" list="cut-reasons" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
            <datalist id="cut-reasons">
              <option value="Pre-cut for stock" />
              <option value="Customer order" />
              <option value="Remove damaged end" />
            </datalist>
          </div>
          {scrapLeft && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
              Cutting leaves {fmtLen(after, meta)}, below the {fmtLen(scrap, meta)} scrap limit.
              <div className="mt-2 flex gap-2">
                <button type="button" className={`btn-secondary ${leftover === "writeoff" ? "!border-amber-600 !bg-amber-100" : ""}`} onClick={() => setLeftover("writeoff")}>
                  Write off {fmtLen(after, meta)}
                </button>
                <button type="button" className={`btn-secondary ${leftover === "keep" ? "!border-amber-600 !bg-amber-100" : ""}`} onClick={() => setLeftover("keep")}>
                  Keep as cut piece
                </button>
              </div>
            </div>
          )}
        </>
      )}
      <Alert message={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={save}>
          {saving ? "Saving…" : openOnly && !withCut ? `Open ${rollWord(meta)}` : valid.length ? `Cut ${fmtLen(total, meta)}` : "Cut"}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// W11: Write off / Correct length
// ---------------------------------------------------------------------------

const WRITE_OFF_REASONS = ["Damaged", "Scrap", "Sample", "Lost"];

export function WriteOffModal({ piece, meta, open, onClose, onDone }: { piece: PieceTarget; meta: MeasureMeta; open: boolean; onClose: () => void; onDone: (message: string) => void }) {
  useLengthView();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    setError("");
    setSaving(true);
    try {
      await api(`/measure/pieces/${piece.id}/write-off`, { method: "POST", body: { reason } });
      onDone(`${nameOf(piece, meta)} written off`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Write off · ${nameOf(piece, meta)}`}>
      <p className="mb-3 text-sm text-slate-600">
        Removes <b>{fmtLen(piece.remainingLength, meta)}</b> from stock. The piece becomes Used up and stays in history.
      </p>
      <label className="label" htmlFor="wo-reason">Reason *</label>
      <div className="mb-2 flex flex-wrap gap-2">
        {WRITE_OFF_REASONS.map((r) => (
          <button key={r} type="button" className={`rounded-full px-3 py-1 text-xs font-semibold ${reason.startsWith(r) ? "bg-rose-600 text-white" : "bg-white ring-1 ring-slate-200"}`} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <input autoComplete="off" id="wo-reason" className="input" maxLength={200} placeholder="e.g. Damaged — kinked" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Alert message={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn bg-rose-600 text-white hover:bg-rose-700" disabled={saving || reason.trim().length < 3} onClick={save}>
          {saving ? "Saving…" : `Write off ${fmtLen(piece.remainingLength, meta)}`}
        </button>
      </div>
    </Modal>
  );
}

export function CorrectModal({ piece, meta, open, onClose, onDone }: { piece: PieceTarget; meta: MeasureMeta; open: boolean; onClose: () => void; onDone: (message: string) => void }) {
  useLengthView();
  const [length, setLength] = useState(NaN);
  const [zero, setZero] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const measured = zero ? 0 : length;
  const diff = Number.isFinite(measured) ? Math.round((measured - piece.remainingLength) * 1000) / 1000 : NaN;
  async function save() {
    setError("");
    if (!Number.isFinite(measured) || measured < 0) return setError("Enter the measured length");
    setSaving(true);
    try {
      await api(`/measure/pieces/${piece.id}/correct`, { method: "POST", body: { length: Math.round(measured * 1000) / 1000, note } });
      onDone(`${nameOf(piece, meta)} corrected to ${fmtLen(measured, meta)}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Correct length · ${nameOf(piece, meta)}`}>
      <div className="mb-3 flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <span>System says</span>
        <b>{fmtLen(piece.remainingLength, meta)}</b>
      </div>
      {!zero && <LengthField base={meta.lengthUnit} decimals={meta.decimals} label="Measured length *" value={Number.isFinite(length) ? length : null} onChange={setLength} autoFocus />}
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} /> Nothing usable is left (0)
      </label>
      {Number.isFinite(diff) && (
        <p className={`mt-2 text-sm font-semibold ${diff < 0 ? "text-rose-600" : diff > 0 ? "text-emerald-700" : "text-slate-500"}`}>
          Difference {diff > 0 ? "+" : diff < 0 ? "−" : ""}
          {fmtLen(Math.abs(diff), meta)} (stock adjustment)
        </p>
      )}
      <div className="mt-3">
        <label className="label" htmlFor="corr-note">Note *</label>
        <input autoComplete="off" id="corr-note" className="input" maxLength={200} placeholder="e.g. Stock count 14 Oct" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="mt-1 text-xs text-slate-500">The measured length cannot be more than the original {fmtLen(piece.originalLength, meta)}.</p>
      <Alert message={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving || note.trim().length < 3 || !Number.isFinite(measured)} onClick={save}>
          {saving ? "Saving…" : Number.isFinite(measured) ? `Save ${fmtLen(measured, meta)}` : "Save"}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Edit details (notes)
// ---------------------------------------------------------------------------

export function EditPieceModal({ piece, open, onClose, onDone }: { piece: PieceTarget; open: boolean; onClose: () => void; onDone: (message: string) => void }) {
  useLengthView();
  const [f, setF] = useState({ notes: piece.notes ?? "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function save() {
    setError("");
    const body: Record<string, string | null> = {};
    if (f.notes.trim() !== (piece.notes ?? "")) body.notes = f.notes.trim() || null;
    if (!Object.keys(body).length) return onClose();
    setSaving(true);
    try {
      await api(`/measure/pieces/${piece.id}`, { method: "PATCH", body });
      onDone("Details updated");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Edit details${piece.variation ? ` · ${piece.variation}` : ""}`}>
      <div className="grid gap-3">
        <div>
          <label className="label" htmlFor="ed-notes">Notes</label>
          <textarea id="ed-notes" className="input" rows={2} maxLength={300} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </div>
        <p className="text-xs text-slate-500">Lengths change only through Cut, Write off and Correct length.</p>
      </div>
      <Alert message={error} />
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}
