"use client";

import { useState, type DragEvent } from "react";

// V3.2 A2: drag-to-reorder for a child table (measured variation rows, set-type rows), the same
// behaviour as the variation rows on Products and Stock In: drag the ⋮⋮ handle, a line shows
// where the row lands, dropping calls `onMove(from, to)` with indexes into `ids`.

export function useRowOrder(ids: readonly string[], onMove: (from: number, to: number) => void) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [target, setTarget] = useState<{ id: string; position: "before" | "after" } | null>(null);
  const clear = () => {
    setDragged(null);
    setTarget(null);
  };

  /** Props for the row `<tr>` of `id`. */
  const rowProps = (id: string) => ({
    className: [dragged === id ? "row-dragging bg-light border shadow-sm" : "", target?.id === id && dragged !== id ? (target.position === "before" ? "drop-indicator-top" : "drop-indicator-bottom") : ""]
      .filter(Boolean)
      .join(" "),
    onDragOver: (e: DragEvent<HTMLTableRowElement>) => {
      if (!dragged || !ids.includes(dragged) || dragged === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const position = e.clientY < rect.top + rect.height / 2 ? "before" : "after";
      if (target?.id !== id || target.position !== position) setTarget({ id, position });
    },
    onDrop: (e: DragEvent<HTMLTableRowElement>) => {
      e.preventDefault();
      const from = dragged ? ids.indexOf(dragged) : -1;
      const at = ids.indexOf(id);
      if (from >= 0 && at >= 0 && from !== at) {
        const position = target?.position ?? (at > from ? "after" : "before");
        const to = position === "before" ? (from < at ? at - 1 : at) : from < at ? at : at + 1;
        if (to !== from) onMove(from, to);
      }
      clear();
    },
  });

  /** Drag handlers for the row's VariationOrderCell. */
  const handleProps = (id: string) => ({
    onDragStart: (e: DragEvent<HTMLButtonElement>) => {
      setDragged(id);
      setTarget(null);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    },
    onDragEnd: clear,
  });

  return { rowProps, handleProps };
}

/** `ids` with the item at `from` moved to `to`. */
export function moved<T>(ids: readonly T[], from: number, to: number): T[] {
  const next = [...ids];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
