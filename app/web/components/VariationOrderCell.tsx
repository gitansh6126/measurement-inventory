"use client";

import type { DragEvent } from "react";

/**
 * Creates a floating preview clone of the variation table row
 * and sets it as the HTML5 drag image following the user cursor.
 */
export function createDragPreview(event: DragEvent<HTMLElement>) {
  const tr = (event.target as HTMLElement).closest("tr");
  if (!tr || !event.dataTransfer) return;

  const rect = tr.getBoundingClientRect();
  const table = document.createElement("table");
  table.className = "table rounded-md bg-white shadow-xl border border-slate-300 ring-1 ring-blue-500/20";
  table.style.position = "fixed";
  table.style.top = `${rect.top}px`;
  table.style.left = `${rect.left}px`;
  table.style.width = `${rect.width}px`;
  table.style.minWidth = `${rect.width}px`;
  table.style.maxWidth = `${rect.width}px`;
  table.style.pointerEvents = "none";
  table.style.borderCollapse = "separate";
  table.style.borderSpacing = "0";
  table.style.backgroundColor = "#ffffff";
  table.style.zIndex = "99999";
  table.style.boxShadow = "0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.15)";

  const tbody = document.createElement("tbody");
  const clone = tr.cloneNode(true) as HTMLTableRowElement;
  clone.className = "bg-white shadow-sm border-y border-slate-200";
  clone.style.backgroundColor = "#ffffff";

  const originalCells = Array.from(tr.children) as HTMLElement[];
  const cloneCells = Array.from(clone.children) as HTMLElement[];
  originalCells.forEach((orig, idx) => {
    const cloneCell = cloneCells[idx];
    if (cloneCell) {
      const origRect = orig.getBoundingClientRect();
      cloneCell.style.width = `${origRect.width}px`;
      cloneCell.style.minWidth = `${origRect.width}px`;
      cloneCell.style.maxWidth = `${origRect.width}px`;
      cloneCell.style.boxSizing = "border-box";
      cloneCell.style.backgroundColor = "#ffffff";
    }
  });

  tbody.appendChild(clone);
  table.appendChild(tbody);
  document.body.appendChild(table);

  const offsetX = Math.min(Math.max(event.clientX - rect.left, 24), Math.max(rect.width - 24, 24));
  const offsetY = Math.min(Math.max(event.clientY - rect.top, 12), Math.max(rect.height - 12, 12));

  try {
    event.dataTransfer.setDragImage(table, offsetX, offsetY);
  } catch {
    // Fallback if browser restrictions prevent custom drag image
  }

  setTimeout(() => {
    table.remove();
  }, 0);
}

/**
 * 6-dots drag handle icon (2 columns of 3 dots).
 */
export function SixDotsIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="3.5" r="1.25" />
      <circle cx="11" cy="3.5" r="1.25" />
      <circle cx="5" cy="8" r="1.25" />
      <circle cx="11" cy="8" r="1.25" />
      <circle cx="5" cy="12.5" r="1.25" />
      <circle cx="11" cy="12.5" r="1.25" />
    </svg>
  );
}

export function VariationOrderCell({
  label,
  index,
  count,
  disabled,
  onMove,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  label: string;
  index?: number;
  count?: number;
  disabled: boolean;
  onMove?: (from: number, to: number) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: DragEvent<HTMLTableCellElement>) => void;
  onDrop?: (event: DragEvent<HTMLTableCellElement>) => void;
}) {
  return (
    <td
      className="w-8 whitespace-nowrap text-center"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="cursor-grab p-1 text-slate-400 hover:text-slate-700 active:cursor-grabbing disabled:cursor-not-allowed select-none rounded hover:bg-slate-100"
        aria-label={`Drag to reorder ${label}`}
        title="Drag to reorder"
        draggable={!disabled}
        disabled={disabled}
        onDragStart={(event) => {
          createDragPreview(event);
          onDragStart(event);
        }}
        onDragEnd={onDragEnd}
      >
        <SixDotsIcon className="h-4 w-4 fill-current" />
      </button>
    </td>
  );
}
