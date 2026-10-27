import type { ColumnDef, ExportRow } from "./inventoryColumns";

// Inventory PDF (V2 plan §1.10): built in the browser from the complete filtered data, so a large
// export never ties up the API. Landscape A4 for wide tables, report title and date, the column
// header repeated on every page, and "Page x of y" in the footer. Libraries load on demand.

export async function downloadInventoryPdf(opts: { title: string; subtitle?: string; columns: ColumnDef[]; rows: ExportRow[]; filename: string }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const landscape = opts.columns.length > 5;
  const doc = new jsPDF({ orientation: landscape ? "landscape" : "portrait", unit: "pt", format: "a4" });
  const when = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

  const head = [opts.columns.map((c) => c.label.replace("₹", "Rs"))];
  const body = opts.rows.map((r) =>
    // Child (variation) rows leave the product cell blank under their bold parent row.
    // jsPDF's built-in fonts have no rupee glyph; values are plain numbers already.
    opts.columns.map((c, i) => (i === 0 && r.child ? "" : c.value(r.product, r.variation))),
  );
  if (body.length === 0) body.push(opts.columns.map((_, i) => (i === 0 ? "No rows match these filters" : "")));

  autoTable(doc, {
    head,
    body,
    startY: 64,
    margin: { top: 64, bottom: 36, left: 28, right: 28 },
    styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: Object.fromEntries(opts.columns.map((c, i) => [i, c.align === "right" ? { halign: "right" } : {}])),
    showHead: "everyPage",
    didParseCell: (data) => {
      if (data.section === "body") {
        const r = opts.rows[data.row.index];
        if (r && !r.child && r.product.productType === "variable") data.cell.styles.fontStyle = "bold";
      }
    },
    didDrawPage: () => {
      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      doc.text(opts.title, 28, 32);
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`${opts.subtitle ? `${opts.subtitle}  ·  ` : ""}Generated ${when}  ·  ${opts.rows.length} rows`, 28, 46);
    },
  });

  // Footer with total page count, drawn after the table so "of N" is known.
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Page ${i} of ${pages}`, w - 28, h - 16, { align: "right" });
    doc.text("RS Machinery — Inventory", 28, h - 16);
  }
  doc.save(opts.filename);
}
