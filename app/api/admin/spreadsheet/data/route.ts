
import { NextResponse } from "next/server";
import {
  deleteSpreadsheetRow,
  fetchSpreadsheetPage,
  insertSpreadsheetRow,
  updateSpreadsheetCell,
} from "@/lib/admin/spreadsheet/query";
import {
  readSpreadsheetJsonBody,
  requireSpreadsheetAdmin,
  requireSpreadsheetAdminWrite,
  spreadsheetErrorResponse,
} from "@/lib/admin/spreadsheet/routeHandler";
import {
  clampSpreadsheetPageLimit,
  getSpreadsheetPageSize,
  normalizeSpreadsheetPage,
} from "@/lib/admin/spreadsheet/settings";
import { isRecord } from "@/lib/admin/spreadsheet/validation";

export async function GET(req: Request): Promise<Response> {
  const guard = await requireSpreadsheetAdmin();
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const table = (url.searchParams.get("table") ?? "").trim();
  if (!table) {
    return NextResponse.json({ error: "unknown_table" }, { status: 400 });
  }

  const page = normalizeSpreadsheetPage(
    Number(url.searchParams.get("page") ?? "1"),
  );
  const limitParam = url.searchParams.get("limit");
  const limit =
    limitParam != null && limitParam !== ""
      ? clampSpreadsheetPageLimit(Number(limitParam))
      : getSpreadsheetPageSize();

  try {
    const data = await fetchSpreadsheetPage({ table, page, limit });
    return NextResponse.json(data);
  } catch (e) {
    return spreadsheetErrorResponse(e);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  const guard = await requireSpreadsheetAdminWrite(req);
  if (!guard.ok) return guard.response;

  let body: {
    table?: string;
    primaryKey?: Record<string, string>;
    column?: string;
    value?: string | null;
  };
  try {
    body = await readSpreadsheetJsonBody(req);
  } catch (e) {
    return spreadsheetErrorResponse(e);
  }

  const table = (body.table ?? "").trim();
  const column = (body.column ?? "").trim();
  if (!table || !column || !body.primaryKey) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!isRecord(body.primaryKey)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    await updateSpreadsheetCell({
      table,
      column,
      primaryKey: body.primaryKey as Record<string, string>,
      value: body.value ?? null,
      operatorId: guard.session.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return spreadsheetErrorResponse(e);
  }
}

export async function POST(req: Request): Promise<Response> {
  const guard = await requireSpreadsheetAdminWrite(req);
  if (!guard.ok) return guard.response;

  let body: { table?: string; row?: Record<string, string | null> };
  try {
    body = await readSpreadsheetJsonBody(req);
  } catch (e) {
    return spreadsheetErrorResponse(e);
  }

  const table = (body.table ?? "").trim();
  if (!table || !body.row) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!isRecord(body.row)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    await insertSpreadsheetRow({
      table,
      row: body.row as Record<string, string | null>,
      operatorId: guard.session.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return spreadsheetErrorResponse(e);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const guard = await requireSpreadsheetAdminWrite(req);
  if (!guard.ok) return guard.response;

  let body: { table?: string; primaryKey?: Record<string, string> };
  try {
    body = await readSpreadsheetJsonBody(req);
  } catch (e) {
    return spreadsheetErrorResponse(e);
  }

  const table = (body.table ?? "").trim();
  if (!table || !body.primaryKey) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!isRecord(body.primaryKey)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    await deleteSpreadsheetRow({
      table,
      primaryKey: body.primaryKey as Record<string, string>,
      operatorId: guard.session.userId,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return spreadsheetErrorResponse(e);
  }
}
