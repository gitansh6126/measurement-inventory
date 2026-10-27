import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import { AppError } from "./errors.js";

// V3.1 import: reads .xlsx / .csv uploads and writes the .xlsx templates. A small zip + sheet
// XML reader on node:zlib, so no spreadsheet library is needed. Values come back as text, as the
// sheet shows them: dates as yyyy-mm-dd, numbers without float noise (1968.5039999 → 1968.504).

export interface Sheet {
  name: string;
  rows: string[][];
}

export const MAX_ROWS = 5000;
const MAX_COLS = 60;

// ---------------------------------------------------------------------------
// Zip
// ---------------------------------------------------------------------------

function unzip(buf: Buffer): Map<string, Buffer> {
  // End of central directory: last 22+ bytes, signature 0x06054b50.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw badFile();
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw badFile();
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.(xml|rels)$/i.test(name)) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    out.set(name.replace(/^\/+/, ""), method === 0 ? data : inflateRawSync(data, { maxOutputLength: 50_000_000 }));
  }
  return out;
}

function zip(files: { name: string; data: string }[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = Buffer.from(f.data, "utf8");
    const packed = deflateRawSync(raw);
    const name = Buffer.from(f.name, "utf8");
    const crc = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6); // UTF-8 names
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(head, name, packed);
    central.push(dir, name);
    offset += 30 + name.length + packed.length;
  }
  const dirSize = central.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

const badFile = () => new AppError(400, "BAD_FILE", "This file could not be read. Upload an .xlsx or .csv file.");

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTITIES[e] ?? m),
  );
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1]!)).join("");
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** Column letters → 0-based index ("B" → 1, "AA" → 26). */
function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 1968.5039999999999 → "1968.504"; whole numbers stay whole. */
export function numberText(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return String(Number(n.toPrecision(12)));
}

/** Excel day serial (1900 system) → yyyy-mm-dd. */
function serialDate(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  const d = new Date(Math.round((n - 25569) * 86_400_000));
  return d.toISOString().slice(0, 10);
}

/** Style indexes whose number format is a date. */
function dateStyles(stylesXml: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b[^>]*>/g)) custom.set(Number(attr(m[0], "numFmtId")), unescape(attr(m[0], "formatCode") ?? ""));
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  [...xfs.matchAll(/<xf\b[^>]*\/?>/g)].forEach((m, i) => {
    const id = Number(attr(m[0], "numFmtId") ?? 0);
    const code = custom.get(id)?.replace(/"[^"]*"|\[[^\]]*\]/g, "") ?? "";
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[dy]/i.test(code)) out.add(i);
  });
  return out;
}

function readXlsx(buf: Buffer): Sheet[] {
  const files = unzip(buf);
  const text = (name: string) => files.get(name)?.toString("utf8");
  const workbook = text("xl/workbook.xml");
  if (!workbook) throw badFile();
  const rels = new Map<string, string>();
  for (const m of (text("xl/_rels/workbook.xml.rels") ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
    const target = attr(m[0], "Target") ?? "";
    rels.set(attr(m[0], "Id") ?? "", target.startsWith("/") ? target.slice(1) : `xl/${target}`);
  }
  const shared = [...(text("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]!));
  const dates = dateStyles(text("xl/styles.xml"));

  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescape(attr(m[0], "name") ?? `Sheet${sheets.length + 1}`);
    const xml = text(rels.get(attr(m[0], "r:id") ?? "") ?? "");
    if (!xml) continue;
    const rows: string[][] = [];
    for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const rowNo = Number(attr(r[0], "r") ?? rows.length + 1);
      if (rowNo > MAX_ROWS + 1) throw new AppError(400, "TOO_MANY_ROWS", `A sheet may have at most ${MAX_ROWS} rows; split the file`);
      const cells: string[] = [];
      for (const c of (r[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = c[0];
        const col = colIndex(attr(tag, "r") ?? "");
        if (col < 0 || col >= MAX_COLS) continue;
        const t = attr(tag, "t");
        const inner = c[2] ?? "";
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let value = "";
        if (t === "s") value = shared[Number(v)] ?? "";
        else if (t === "inlineStr") value = texts(inner);
        else if (t === "str" || t === "e") value = unescape(v ?? "");
        else if (t === "b") value = v === "1" ? "TRUE" : "FALSE";
        else if (v !== undefined) value = dates.has(Number(attr(tag, "s") ?? -1)) ? serialDate(v) : numberText(v);
        cells[col] = value.trim();
      }
      rows[rowNo - 1] = Array.from(cells, (x) => x ?? "");
    }
    sheets.push({ name, rows: Array.from(rows, (x) => x ?? []) });
  }
  if (!sheets.length) throw badFile();
  return sheets;
}

function readCsv(text: string): Sheet[] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0]!;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim());
      rows.push(row.slice(0, MAX_COLS));
      row = [];
      cell = "";
      if (rows.length > MAX_ROWS + 1) throw new AppError(400, "TOO_MANY_ROWS", `A file may have at most ${MAX_ROWS} rows; split the file`);
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell.trim());
    rows.push(row.slice(0, MAX_COLS));
  }
  return [{ name: "CSV", rows }];
}

/** An uploaded .xlsx (zip) or .csv / text file → its sheets. */
export function readSheets(buf: Buffer): Sheet[] {
  if (buf.length < 4) throw badFile();
  if (buf.readUInt32LE(0) === 0x04034b50) return readXlsx(buf);
  if (buf.subarray(0, 8).includes(0)) throw badFile(); // .xls and other binary files
  return readCsv(buf.toString("utf8").replace(/^﻿/, ""));
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number) => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : "") + String.fromCharCode(65 + (i % 26));

export interface SheetOut {
  name: string;
  rows: (string | number)[][];
  /** Column widths in characters. */
  widths?: number[];
  /** Bold, shaded first row, frozen while scrolling. */
  header?: boolean;
}

/** A plain .xlsx: inline strings, a bold header style, nothing else. */
export function writeXlsx(sheets: SheetOut[]): Buffer {
  const sheetXml = (s: SheetOut) => {
    const cols = s.widths?.length ? `<cols>${s.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
    const pane = s.header ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
    const rows = s.rows
      .map((r, ri) => {
        const style = s.header && ri === 0 ? ' s="1"' : "";
        const cells = r
          .map((v, ci) => {
            const ref = `${colName(ci)}${ri + 1}`;
            if (v === "" || v === null || v === undefined) return style ? `<c r="${ref}"${style}/>` : "";
            return typeof v === "number" ? `<c r="${ref}"${style}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
          })
          .join("");
        return `<row r="${ri + 1}">${cells}</row>`;
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${rows}</sheetData></worksheet>`;
  };
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  return zip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook ${ns}><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: "xl/styles.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E8F0"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`,
    },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ]);
}
