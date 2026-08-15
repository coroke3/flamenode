import "server-only";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import { systemSettings } from "@/lib/db/schema";
import { isLiveApiEnabled } from "@/lib/operationMode/policy";
import { resolveOperationMode } from "@/lib/operationMode/resolve";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

function jsonErrorResponse(
  payload: Record<string, unknown>,
  status: number,
): Response {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

/** live API の GET ハンドラ共通: DB 未接続・cost guard・クエリ失敗を JSON で返す（画面全体の 500 回避）。 */
export async function handleLiveApiGet<T>(
  eventId: string,
  load: (db: DB, eventId: string) => Promise<T | null>,
): Promise<Response> {
  const id = eventId.trim();
  if (!id || id.length > 128) {
    return jsonErrorResponse(
      { error: "invalid_event_id", message: "イベントIDが不正です。" },
      400,
    );
  }

  let db: DB | null;
  try {
    db = getDatabase();
  } catch (err) {
    console.error("[live-api] database binding unavailable", {
      eventId: id,
      err,
    });
    return jsonErrorResponse(
      {
        error: "db_unavailable",
        message: "データベースに接続できません。",
      },
      503,
    );
  }
  if (!db) {
    return jsonErrorResponse(
      { error: "db_unavailable", message: "データベースに接続できません。" },
      503,
    );
  }

  try {
    if (!(await liveApiAllowed(db))) {
      return jsonErrorResponse(
        {
          error: "live_api_disabled",
          message: "ライブ更新 API は現在無効です（メンテナンスまたは静的配信モード）。",
        },
        503,
      );
    }

    const payload = await load(db, id);
    if (!payload) {
      return jsonErrorResponse(
        { error: "not_found", message: "イベントが見つかりません。" },
        404,
      );
    }

    return NextResponse.json(payload, {
      headers: { "Cache-Control": liveApiCacheControl() },
    });
  } catch (err) {
    console.error("[live-api] GET failed", { eventId: id, err });
    return jsonErrorResponse(
      {
        error: "live_api_error",
        message: "ライブデータの取得に失敗しました。しばらくしてから再度お試しください。",
      },
      503,
    );
  }
}

export async function liveApiAllowed(db: DB): Promise<boolean> {
  const row = (
    await db
      .select({
        operation_mode: systemSettings.operation_mode,
      })
      .from(systemSettings)
      .where(eq(systemSettings.id, "default"))
      .limit(1)
  )[0];
  return isLiveApiEnabled(resolveOperationMode(row));
}

export function liveApiCacheControl(): string {
  return "public, s-maxage=5, stale-while-revalidate=30";
}
