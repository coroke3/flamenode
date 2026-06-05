import "server-only";

import { NextResponse } from "next/server";
import {
  spreadsheetErrorMessage,
  spreadsheetHttpStatus,
} from "./errors";
import {
  requireAdminSpreadsheetApi,
  type AdminSpreadsheetSession,
} from "./guard";

/** スプレッドシート API 共通のエラーレスポンス */
export function spreadsheetErrorResponse(error: unknown): NextResponse {
  const message = spreadsheetErrorMessage(error);
  return NextResponse.json(
    { error: message },
    { status: spreadsheetHttpStatus(message) },
  );
}

export type SpreadsheetGuardResult =
  | { ok: true; session: AdminSpreadsheetSession }
  | { ok: false; response: NextResponse };

/** 管理者ガード（失敗時はそのまま return できる response を返す） */
export async function requireSpreadsheetAdmin(): Promise<SpreadsheetGuardResult> {
  const guard = await requireAdminSpreadsheetApi();
  if (!guard.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: guard.error },
        { status: guard.status },
      ),
    };
  }
  return { ok: true, session: guard.session };
}

/** JSON ボディ読み込み（失敗時は invalid_json） */
export async function readSpreadsheetJsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error("invalid_json");
  }
}
