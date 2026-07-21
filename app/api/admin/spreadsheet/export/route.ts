
import { NextResponse } from "next/server";
import { rowsToDelimitedGrid } from "@/lib/admin/spreadsheet/paste";
import { fetchSpreadsheetExport } from "@/lib/admin/spreadsheet/query";
import {
  requireSpreadsheetAdmin,
  spreadsheetErrorResponse,
} from "@/lib/admin/spreadsheet/routeHandler";

export async function GET(req: Request): Promise<Response> {
  const guard = await requireSpreadsheetAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const table = (url.searchParams.get("table") ?? "").trim();
  if (!table) {
    return NextResponse.json({ error: "unknown_table" }, { status: 400 });
  }

  const format = (url.searchParams.get("format") ?? "csv").toLowerCase();
  const delimiter = format === "tsv" ? ("\t" as const) : ("," as const);
  const includeHeader = url.searchParams.get("header") !== "0";
  const ext = delimiter === "\t" ? "tsv" : "csv";
  const mime =
    delimiter === "\t"
      ? "text/tab-separated-values; charset=utf-8"
      : "text/csv; charset=utf-8";

  try {
    const data = await fetchSpreadsheetExport(table);
    const columnNames = data.columns.map((c) => c.name);
    const body = rowsToDelimitedGrid(
      columnNames,
      data.rows,
      delimiter,
      includeHeader,
    );
    const safeTable = table.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `${safeTable}${data.truncated ? "-partial" : ""}.${ext}`;
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Spreadsheet-Truncated": data.truncated ? "1" : "0",
      },
    });
  } catch (e) {
    return spreadsheetErrorResponse(e);
  }
}
