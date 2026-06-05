import { NextResponse } from "next/server";
import type { SpreadsheetDelimiterMode } from "@/lib/admin/spreadsheet/paste";
import { prepareSpreadsheetImportRows } from "@/lib/admin/spreadsheet/importPrep";
import {
  readSpreadsheetJsonBody,
  requireSpreadsheetAdmin,
  spreadsheetErrorResponse,
} from "@/lib/admin/spreadsheet/routeHandler";
import {
  applySpreadsheetImport,
  type SpreadsheetImportMode,
} from "@/lib/admin/spreadsheet/query";
import { resolveSpreadsheetTableContext } from "@/lib/admin/spreadsheet/tableContext";

export async function POST(req: Request): Promise<Response> {
  const guard = await requireSpreadsheetAdmin();
  if (!guard.ok) return guard.response;

  let body: {
    table?: string;
    mode?: SpreadsheetImportMode;
    text?: string;
    rows?: Record<string, string | null>[];
    hasHeader?: boolean;
    delimiter?: SpreadsheetDelimiterMode;
    dryRun?: boolean;
  };
  try {
    body = await readSpreadsheetJsonBody(req);
  } catch (e) {
    return spreadsheetErrorResponse(e);
  }

  const table = (body.table ?? "").trim();
  if (!table) {
    return NextResponse.json({ error: "unknown_table" }, { status: 400 });
  }

  const mode: SpreadsheetImportMode =
    body.mode === "upsert" ? "upsert" : "insert";
  const hasHeader = body.hasHeader !== false;
  const delimiter: SpreadsheetDelimiterMode =
    body.delimiter === "csv" || body.delimiter === "tsv"
      ? body.delimiter
      : "auto";

  try {
    const ctx = await resolveSpreadsheetTableContext(table);
    if (ctx.def.mode !== "editable") {
      return NextResponse.json({ error: "table_readonly" }, { status: 400 });
    }

    const { rows, warnings, mappedColumns } = prepareSpreadsheetImportRows({
      text: body.text,
      rows: body.rows,
      columnNames: ctx.columnNames,
      hasHeader,
      delimiter,
    });

    if (body.dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        rowCount: rows.length,
        mappedColumns,
        warnings,
        preview: rows.slice(0, 20),
      });
    }

    const result = await applySpreadsheetImport(
      {
        table,
        mode,
        rows,
        operatorId: guard.session.userId,
      },
      ctx,
    );

    return NextResponse.json({
      ok: true,
      ...result,
      mappedColumns,
      warnings,
    });
  } catch (e) {
    return spreadsheetErrorResponse(e);
  }
}
