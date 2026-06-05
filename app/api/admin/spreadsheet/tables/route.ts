import { NextResponse } from "next/server";
import {
  getSpreadsheetSyncWarnings,
  invalidateSpreadsheetTableCache,
  listSpreadsheetTables,
} from "@/lib/admin/spreadsheet/discovery";
import {
  requireSpreadsheetAdmin,
  spreadsheetErrorResponse,
} from "@/lib/admin/spreadsheet/routeHandler";
import { getSpreadsheetPageSize } from "@/lib/admin/spreadsheet/settings";
import { invalidateSpreadsheetColumnCache } from "@/lib/admin/spreadsheet/tableContext";

export async function GET(req: Request): Promise<Response> {
  const guard = await requireSpreadsheetAdmin();
  if (!guard.ok) return guard.response;

  if (new URL(req.url).searchParams.get("refresh") === "1") {
    invalidateSpreadsheetTableCache();
    invalidateSpreadsheetColumnCache();
  }

  try {
    const tables = await listSpreadsheetTables();
    const groups = tables.reduce<Record<string, typeof tables>>((acc, t) => {
      (acc[t.group] ??= []).push(t);
      return acc;
    }, {});

    const { notInSchema, inSchemaNotInDb } = getSpreadsheetSyncWarnings();

    return NextResponse.json({
      tables,
      groups,
      pageSize: getSpreadsheetPageSize(),
      discoveredAt: new Date().toISOString(),
      ...(notInSchema.length > 0 ? { notInSchema } : {}),
      ...(inSchemaNotInDb.length > 0 ? { inSchemaNotInDb } : {}),
    });
  } catch (e) {
    return spreadsheetErrorResponse(e);
  }
}
