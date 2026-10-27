"use client";

import type { SetContentRow, SetDetail } from "@/lib/types";

// V3.1 grouped products: the one clean way a set's contents are shown on every screen —
// part name on the left, what is fitted on the right ("Load Chain Grade 80 → 8 mm · 3 m").
// No set codes, piece codes, short names or SKUs (owner, 2026-10-22); codes stay for search only.

/** One-line form for tables and documents: "Load Chain Grade 80 8 mm · 3 m, Safety Hook 1 Ton". */
export const contentsText = (rows: readonly SetContentRow[]) => rows.map((r) => (r.value === "Fitted" ? r.name : `${r.name} ${r.value}`)).join(", ") || "Main part only";

export function SetContents({ rows, className = "" }: { rows: readonly SetContentRow[]; className?: string }) {
  if (!rows.length) return <div className={`text-xs text-slate-400 ${className}`}>Main part only</div>;
  return (
    <dl className={`grid gap-0.5 text-xs ${className}`}>
      {rows.map((r, i) => (
        <div key={`${r.name}-${i}`} className="flex justify-between gap-3">
          <dt className="text-slate-500">{r.name}</dt>
          <dd className="text-right font-medium text-slate-800">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The sets on a cart or order line: one block per set ("Set 1 · W1" when there are several or
 * a note). Older carts saved before `setDetails` existed fall back to their one-line summaries.
 */
export function SetDetailsList({ details, summaries, className = "" }: { details?: readonly SetDetail[]; summaries?: readonly string[]; className?: string }) {
  if (!details?.length) {
    return (
      <ul className={`text-xs text-slate-500 ${className}`}>
        {(summaries ?? []).map((s, j) => (
          <li key={j}>{s || "Main part only"}</li>
        ))}
      </ul>
    );
  }
  const many = details.length > 1;
  return (
    <ul className={`grid gap-1.5 ${className}`}>
      {details.map((d, j) => (
        <li key={j} className="border-l-2 border-slate-200 pl-2">
          {(many || d.note) && <div className="text-[11px] font-semibold text-slate-500">{[many ? `Set ${j + 1}` : "", d.note ?? ""].filter(Boolean).join(" · ")}</div>}
          <SetContents rows={d.rows} />
        </li>
      ))}
    </ul>
  );
}
