"use client";

import { useState, type DragEvent } from "react";
import type { ColumnDef } from "./inventoryColumns";
import { usePreference } from "./usePreference";

/**
 * Column order + visibility for one screen table (Products, Stock In), shared engine.
 *
 * Stored per signed-in user (usePreference, /api/me/preferences/:key) rather than in the
 * browser's localStorage: the shop PC is shared by several users, and a server preference
 * also follows the user to their phone. Old saves ({ hidden } only) keep working; columns
 * added later are slotted in after their default neighbour, so a saved order never drops them.
 */
export interface TableColumnPrefs {
  hidden: string[];
  order?: string[];
}

/** Saved order with unknown ids dropped and new columns inserted after their default neighbour. */
export function mergeColumnOrder(saved: string[] | undefined, defaults: string[]): string[] {
  if (!saved?.length) return defaults;
  const out = saved.filter((id) => defaults.includes(id));
  defaults.forEach((id, i) => {
    if (out.includes(id)) return;
    const prev = defaults.slice(0, i).reverse().find((d) => out.includes(d));
    out.splice(prev ? out.indexOf(prev) + 1 : 0, 0, id);
  });
  return out;
}

/** Moves `from` before or after `to`; pinned columns never move. */
export function moveColumn(order: string[], from: string, to: string, position: "before" | "after"): string[] {
  if (from === to) return order;
  const next = order.filter((id) => id !== from);
  const at = next.indexOf(to);
  if (at < 0) return order;
  next.splice(position === "before" ? at : at + 1, 0, from);
  return next;
}

export function useTableColumns(key: string, columns: ColumnDef[], defaultHidden: string[]) {
  const pref = usePreference<TableColumnPrefs>(key, { hidden: defaultHidden });
  const hidden = pref.value.hidden ?? defaultHidden;
  const order = mergeColumnOrder(pref.value.order, columns.map((c) => c.id));
  const byId = new Map(columns.map((c) => [c.id, c]));
  const [drag, setDrag] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; position: "before" | "after" } | null>(null);

  const visible = (id: string) => !!byId.get(id)?.fixed || !hidden.includes(id);
  /** Visible column ids in the user's order (optionally only some of them). */
  const shown = (only?: string[]) => order.filter((id) => visible(id) && (!only || only.includes(id)));
  const reorder = (next: string[]) => void pref.save({ hidden, order: next });
  const move = (from: string, to: string, position: "before" | "after") => {
    if (byId.get(from)?.pinned || byId.get(to)?.pinned) return;
    reorder(moveColumn(order, from, to, position));
  };

  /** Props for a draggable <th>: drag a header onto another to move the column. */
  const headerDrag = (id: string) => {
    if (byId.get(id)?.pinned) return {};
    const indicator = drop?.id === id && drag && drag !== id ? (drop.position === "before" ? "col-drop-before" : "col-drop-after") : "";
    return {
      draggable: true,
      className: `cursor-grab select-none ${drag === id ? "opacity-50" : ""} ${indicator}`,
      title: "Drag to move this column",
      onDragStart: (e: DragEvent<HTMLElement>) => {
        setDrag(id);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/x-column", id);
      },
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!drag || drag === id) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        const position = e.clientX < r.left + r.width / 2 ? "before" : "after";
        if (drop?.id !== id || drop.position !== position) setDrop({ id, position });
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault();
        if (drag && drop) move(drag, id, drop.position);
        setDrag(null);
        setDrop(null);
      },
      onDragEnd: () => {
        setDrag(null);
        setDrop(null);
      },
    };
  };

  return {
    order,
    hidden,
    visible,
    shown,
    move,
    headerDrag,
    setHidden: (next: string[]) => void pref.save({ hidden: next, ...(pref.value.order ? { order: pref.value.order } : {}) }),
    reorder,
    reset: () => void pref.save(null),
    error: pref.error,
  };
}
