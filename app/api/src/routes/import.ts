import { IMPORT_KINDS, IMPORT_KIND_LABEL, importFields, type ImportKind } from "@rs-v31/shared/import";
import express, { Router, type Request, type RequestHandler } from "express";
import { requirePermission } from "../lib/auth.js";
import { AppError } from "../lib/errors.js";
import { checkImport, commitImport, importBody, type ImportCtx } from "../lib/import.js";
import type { Permission } from "../lib/permissions.js";
import { readSheets, writeXlsx } from "../lib/sheet.js";

// /api/import — V3.1 import (docs\IMPORT-V3.1.md): blank templates, reading an uploaded sheet,
// checking matched rows and importing them. Each kind needs the same permission as the screen
// that records it by hand.

const PERMISSION: Record<ImportKind, Permission> = {
  products: "product.write",
  stock: "stock.adjust",
  purchases: "purchase.create",
  sales: "sale.create",
};

// Template headers for the option columns: the header is the option's name.
const OPTION_HEADER: Record<string, string> = { option1: "Size", option2: "Brand", option3: "Colour" };

const MAX_UPLOAD = 5 * 1024 * 1024;

const kindOf = (req: Request): ImportKind => {
  const k = String(req.params.kind) as ImportKind;
  if (!IMPORT_KINDS.includes(k)) throw new AppError(404, "NOT_FOUND", "Unknown import");
  return k;
};
const ctx = (req: Request): ImportCtx => ({ companyId: req.auth!.companyId, actorId: req.auth!.userId, requestId: req.requestId, role: req.auth!.role });
const allowed: RequestHandler = (req, res, next) => requirePermission(PERMISSION[kindOf(req)])(req, res, next);

export function importRoutes() {
  const r = Router();

  /** Blank template: the header row, one demo line, and a sheet explaining each column. */
  r.get("/templates/:kind", allowed, (req, res) => {
    const kind = kindOf(req);
    const fields = importFields(kind);
    const headers = fields.map((f) => OPTION_HEADER[f.key] ?? f.label);
    const xlsx = writeXlsx([
      { name: IMPORT_KIND_LABEL[kind], header: true, rows: [headers, fields.map((f) => f.demo)], widths: headers.map((h) => Math.max(12, h.length + 4)) },
      {
        name: "How to fill",
        header: true,
        widths: [20, 12, 70],
        rows: [
          ["Column", "Needed", "What to enter"],
          ...fields.map((f, i) => [headers[i]!, f.required ? "Yes" : f.key === "product" ? "Yes*" : "", f.option ? `${f.hint}. Rename the header to your option (Size, Grade…) or leave it blank.` : f.hint]),
          [],
          ["*", "", "Product name, or the Item code of an existing item."],
          ["", "", "Delete the demo line before importing your own rows. Blank columns can be deleted."],
        ],
      },
    ]);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${kind}-import-template.xlsx"`);
    res.send(xlsx);
  });

  /** Reads an uploaded .xlsx / .csv; the browser does the column matching. */
  r.post("/read", express.raw({ type: () => true, limit: MAX_UPLOAD }), requirePermission("catalog.view"), (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new AppError(400, "NO_FILE", "Choose a file to upload");
    // Rows keep their sheet positions (row n = index n - 1) so messages can name Excel's row numbers.
    res.json({ sheets: readSheets(req.body) });
  });

  r.post("/:kind/check", allowed, async (req, res) => {
    res.json(await checkImport(kindOf(req), ctx(req), importBody.parse(req.body)));
  });

  r.post("/:kind/commit", allowed, async (req, res) => {
    res.status(201).json(await commitImport(kindOf(req), ctx(req), importBody.parse(req.body)));
  });

  return r;
}
