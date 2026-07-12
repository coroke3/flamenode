export const runtime = "edge";

import { NextResponse } from "next/server";
import type { SpreadsheetDelimiterMode } from "@/lib/admin/spreadsheet/paste";
import {
  assertSpreadsheetImportColumns,
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
import { SPREADSHEET_IMPORT_MAX_BATCH_ROWS } from "@/lib/admin/spreadsheet/constants";
import {
  buildSpreadsheetImportPreviewBinding,
  issueSpreadsheetImportPreviewToken,
  requireSpreadsheetImportPreviewSecret,
  verifySpreadsheetImportPreviewToken,
} from "@/lib/admin/spreadsheet/importPreviewToken";
import { resolveSpreadsheetTableContext } from "@/lib/admin/spreadsheet/tableContext";
import { isSpreadsheetColumnEditable } from "@/lib/admin/spreadsheet/registry";
import { getDatabase, getEnv } from "@/lib/cloudflare";
import { spreadsheetImportRuns, systemSettings } from "@/lib/db/schema";
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

    const { rows, warnings, mappedColumns, invalidColumns } = prepareSpreadsheetImportRows({
      text: body.text,
      rows: body.rows,
      columnNames: ctx.columnNames,
      hasHeader,
      delimiter,
    });
    const importedColumns = new Set(
      mappedColumns.length > 0 ? mappedColumns : rows.flatMap((row) => Object.keys(row)),
    );
    const readonlyColumns = [...importedColumns].filter((column) => {
      const meta = ctx.columns.find((item) => item.name === column);
      return meta && !isSpreadsheetColumnEditable(ctx.def, column);
    });
    assertSpreadsheetImportColumns({
      mappedColumns: mappedColumns.length > 0 ? mappedColumns : [...importedColumns],
      invalidColumns,
      columnNames: ctx.columnNames,
      readonlyColumns,
    });
    const writableRows = rows;
    const importWarnings = [...warnings];
    if (writableRows.length > SPREADSHEET_IMPORT_MAX_BATCH_ROWS) {
      importWarnings.push(
        `一括反映は ${SPREADSHEET_IMPORT_MAX_BATCH_ROWS} 行までです。500 行まではプレビューできますが、分割して反映してください。`,
      );
    }
    const secret = requireSpreadsheetImportPreviewSecret(
      getEnv().SPREADSHEET_IMPORT_PREVIEW_SECRET,
    );
    const previewBinding = await buildSpreadsheetImportPreviewBinding({
      operatorUserId: guard.session.userId,
      table: ctx.def.table,
      mode,
      columns: ctx.columnNames,
      primaryKeys: ctx.primaryKeys,
      schemaColumns: ctx.columns,
      rows: writableRows,
    });

    if (body.dryRun) {
      const issued = await issueSpreadsheetImportPreviewToken(
        previewBinding,
        secret,
      );
      const db = getDatabase();
      if (!db) throw new Error("db_unavailable");
      await db.insert(spreadsheetImportRuns).values({
        nonce: issued.claims.nonce,
        operator_user_id: issued.claims.operatorUserId,
        table_name: issued.claims.table,
        mode: issued.claims.mode,
        payload_hash: issued.claims.payloadHash,
        schema_fingerprint: issued.claims.schemaFingerprint,
        expires_at: issued.claims.expiresAt,
        consumed_at: null,
        created_at: issued.claims.issuedAt,
      });
      return NextResponse.json({
        ok: true,
        dryRun: true,
        previewToken: issued.token,
        applyMaxRows: SPREADSHEET_IMPORT_MAX_BATCH_ROWS,
        rowCount: writableRows.length,
        mappedColumns,
        warnings: importWarnings,
        preview: writableRows.slice(0, 20),
      });
    }

    if (!body.previewToken) {
      return NextResponse.json(
        { error: "preview_required" },
        { status: 409 },
      );
    }
    const previewRun = await verifySpreadsheetImportPreviewToken(
      body.previewToken,
      secret,
      previewBinding,
    );
    if (!previewRun) {
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
        previewRun,
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
