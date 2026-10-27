"use client";

import type { ReactNode } from "react";
import { TableSkeleton } from "@/components/ui";
import type { ViewMode } from "@/lib/useViewMode";

// The one switch point between Grid (cards) and Table (catalog browse §2.0): both views draw
// the same `rows`, so switching never reloads, and filters, paging and selection stay put.

export interface Column<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  className?: string;
}

export function DataView<T>({
  rows,
  view,
  rowKey,
  renderCard,
  columns,
  onOpen,
  rowClassName,
  empty,
  gridClassName = "grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4",
  containerClassName,
  label,
}: {
  /** null while the first load is running. */
  rows: T[] | null;
  view: ViewMode;
  rowKey: (row: T) => string;
  renderCard: (row: T) => ReactNode;
  columns: Column<T>[];
  /** Clicking a table row does what tapping its card does. */
  onOpen?: (row: T) => void;
  rowClassName?: (row: T) => string;
  empty?: ReactNode;
  gridClassName?: string;
  containerClassName?: string;
  /** Accessible name of the table. */
  label: string;
}) {
  if (rows === null) return <TableSkeleton rows={4} />;
  if (rows.length === 0) return <>{empty}</>;

  if (view === "grid") {
    return (
      <div className={gridClassName}>
        {rows.map((r) => (
          <div key={rowKey(r)} className="min-w-0">
            {renderCard(r)}
          </div>
        ))}
      </div>
    );
  }

  const align = (a?: Column<T>["align"]) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "");
  return (
    <div className={`card table-scroll table-container overflow-auto ${containerClassName ?? "max-h-[60vh]"}`}>
      <table className="table table-sticky-0" aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id} className={`sticky !top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_#e2e8f0] ${align(c.align)}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onOpen ? () => onOpen(r) : undefined}
              className={`${onOpen ? "cursor-pointer hover:bg-brand-50/50" : ""} ${rowClassName?.(r) ?? ""}`}
            >
              {columns.map((c) => (
                <td key={c.id} className={`${align(c.align)} ${c.className ?? ""}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Stops a click inside a table row (a button or input) from also opening the row. */
export const stop = (e: React.SyntheticEvent) => e.stopPropagation();
