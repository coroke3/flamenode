export const runtime = "edge";

import { NextResponse } from "next/server";
import type { SpreadsheetDelimiterMode } from "@/lib/admin/spreadsheet/paste";
import {
  buildReadonlyImportColumnWarnings,
  omitReadonlyImportColumns,
  prepareSpreadsheetImportRows,
} from "@/lib/admin/spreadsheet/importPrep";
import {
  readSpreadsheetJsonBody,
  requireSpreadsheetAdmin,
  spreadsheetErrorResponse,
} from "@/lib/admin/spreadsheet/routeHandler";
import {
  applySpreadsheetImport,
  type SpreadsheetImportMode,
} from "@/lib/admin/spreadsheet/query";
import { buildSpreadsheetImportPreviewToken } from "@/lib/admin/spreadsheet/importPreviewToken";
import { resolveSpreadsheetTableContext } from "@/lib/admin/spreadsheet/tableContext";
import {
  applySpreadsheetForcedInsertValues,
  isSpreadsheetColumnEditable,
} from "@/lib/admin/spreadsheet/registry";
import { getDatabase } from "@/lib/cloudflare";
import { systemSettings } from "@/lib/db/schema";
import { isWriteBlocked } from "@/lib/operationMode/policy";
import { resolveOperationMode } from "@/lib/operationMode/resolve";

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
    previewToken?: string;
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
    const readonlyColumns = ctx.columns
      .map((column) => column.name)
      .filter((column) => !isSpreadsheetColumnEditable(ctx.def, column));
    const readonlyWarnings = buildReadonlyImportColumnWarnings({
      rows,
      mappedColumns,
      readonlyColumns,
    });
    const writableRows = omitReadonlyImportColumns({
      rows,
      readonlyColumns,
    }).map((row) => applySpreadsheetForcedInsertValues(ctx.def.table, row));
    const importWarnings = [...warnings, ...readonlyWarnings];
    const previewToken = await buildSpreadsheetImportPreviewToken({
      table: ctx.def.table,
      mode,
      columns: ctx.columnNames,
      primaryKeys: ctx.primaryKeys,
      rows: writableRows,
    });

    if (body.dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        previewToken,
        rowCount: writableRows.length,
        mappedColumns,
        warnings: importWarnings,
        preview: writableRows.slice(0, 20),
      });
    }

    if (!body.previewToken || body.previewToken !== previewToken) {
      return NextResponse.json(
        { error: "preview_required" },
        { status: 409 },
      );
    }

    const blocked = await getSpreadsheetImportWriteBlockReason();
    if (blocked) {
      return NextResponse.json(
        { error: "cost_guard", message: blocked },
        { status: 423 },
      );
    }

    const result = await applySpreadsheetImport(
      {
        table,
        mode,
        rows: writableRows,
        operatorId: guard.session.userId,
      },
      ctx,
    );

    return NextResponse.json({
      ok: true,
      ...result,
      mappedColumns,
      warnings: importWarnings,
    });
  } catch (e) {
    return spreadsheetErrorResponse(e);
  }
}

async function getSpreadsheetImportWriteBlockReason(): Promise<string | null> {
  const db = getDatabase();
  if (!db) return null;
  const rows = await db.select().from(systemSettings).limit(1);
  const mode = resolveOperationMode(rows[0]);
  if (mode === "maintenance") {
    return "Spreadsheet import apply is disabled during maintenance. Dry run is still available.";
  }
  if (isWriteBlocked(mode)) {
    return `Spreadsheet import apply is disabled in ${mode} mode. Dry run is still available.`;
  }
  return null;
}
