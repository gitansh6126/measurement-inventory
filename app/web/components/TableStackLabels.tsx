"use client";

import { useEffect } from "react";

/**
 * Phone tables (globals.css `.table-stack`): copies each column header into its cells'
 * `data-label`, so a row can show as a card of "LABEL ... value" without per-cell labels. The
 * first visible cell of a row is marked `data-stack-head` (the card title, no label) unless the
 * table also has `table-stack-all`. A `<th data-label>` overrides the header text; a `<td data-label>`
 * set in code is left alone.
 */
function labelTable(table: HTMLTableElement) {
  const names: string[] = [];
  for (const th of Array.from(table.tHead?.rows[0]?.cells ?? [])) {
    const text = (th.dataset.label ?? th.textContent ?? "").trim();
    // A button already says what it does; "ACTION" beside it is noise.
    const name = /^(actions?|edit)$/i.test(text) ? "" : text;
    for (let i = 0; i < th.colSpan; i++) names.push(i ? "" : name);
  }
  // `table-stack-all`: every cell keeps its label (rows that start with an attribute, e.g. "Capacity").
  const noHead = table.classList.contains("table-stack-all");
  const groups = [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])];
  for (const group of groups) {
    const isBody = group.tagName === "TBODY";
    for (const row of Array.from(group.rows)) {
      let col = 0;
      let headDone = !isBody || noHead;
      for (const td of Array.from(row.cells)) {
        const isHead = !headDone && td.colSpan === 1 && !td.classList.contains("stack-hide");
        if (isHead) headDone = true;
        if (isHead !== td.hasAttribute("data-stack-head")) td.toggleAttribute("data-stack-head", isHead);
        if (!td.hasAttribute("data-label") || td.hasAttribute("data-label-auto")) {
          // Totals rows (tfoot) carry their own wording ("Gross ... ₹x"), so they get no labels.
          const name = isHead || !isBody || td.colSpan > 1 ? "" : names[col] ?? "";
          if (td.getAttribute("data-label") !== name) td.setAttribute("data-label", name);
          if (!td.hasAttribute("data-label-auto")) td.setAttribute("data-label-auto", "");
        }
        col += td.colSpan;
      }
    }
  }
}

export function TableStackLabels() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      timer = undefined;
      document.querySelectorAll<HTMLTableElement>("table.table-stack").forEach(labelTable);
    };
    // A short timer (not requestAnimationFrame, which stalls in background tabs) batches a burst of changes.
    const schedule = () => {
      if (!timer) timer = setTimeout(run, 30);
    };
    run();
    // Rows come and go as data loads, pages change and popups open (portals under <body>).
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);
  return null;
}
