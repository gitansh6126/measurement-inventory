import { describe, expect, it } from "vitest";
import { suggestMapping } from "@rs-v31/shared/import";
import { readSheets, writeXlsx } from "../../src/lib/sheet.js";
import { parseDate } from "../../src/lib/import.js";

describe("import sheets", () => {
  it("writes an xlsx and reads it back", () => {
    const buf = writeXlsx([{ name: "Stock", header: true, rows: [["Product", "Size", "Length"], ["Wire Rope & Co", "20X36", 1968.504]] }]);
    const [s] = readSheets(buf);
    expect(s!.name).toBe("Stock");
    expect(s!.rows).toEqual([["Product", "Size", "Length"], ["Wire Rope & Co", "20X36", "1968.504"]]);
  });

  it("reads csv with quotes and semicolons", () => {
    const [s] = readSheets(Buffer.from('﻿Name;Qty\n"Bolt; M8";5\r\n"Say ""hi""";2\n'));
    expect(s!.rows).toEqual([["Name", "Qty"], ["Bolt; M8", "5"], ['Say "hi"', "2"]]);
  });

  it("parses Indian dates", () => {
    expect(parseDate("01/10/2026")).toBe("2026-10-01");
    expect(parseDate("2026-10-01")).toBe("2026-10-01");
    expect(parseDate("5-Oct-26")).toBe("2026-10-05");
    expect(parseDate("31/02/2026")).toBeNull();
  });

  it("matches the wire rope sheet's columns", () => {
    const headers = ["Sr", "Code", "Location", "Size", "Dia (mm)", "Category", "Brand", "Bundle (m)", "Sealed pack", "Cut (ft)", "Est. remaining (ft)", "Bundle (ft)", "Remaining (ft)", "Notes"];
    const m = suggestMapping("stock", headers);
    expect(m).toMatchObject({ rollNo: 1, warehouse: 2, option1: 3, category: 5, option2: 6, rollKind: 8, length: 12, notes: 13 });
  });
});
