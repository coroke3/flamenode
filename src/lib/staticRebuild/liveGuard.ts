import "server-only";
import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/cloudflare";
import {
  isolateMicroCacheGet,
  isolateMicroCacheSet,
} from "@/lib/api/isolateMicroCache";
import type { DB } from "@/lib/db/client";
import { isLiveApiEnabled } from "@/lib/operationMode/policy";
import { resolvePublicOperationMode } from "@/lib/operationMode/publicMode";

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
  routeName: string,
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

    // 許可判定は毎request行い、通過後だけ同一isolate内5秒のbody(string)を再利用する。
    // 成功した非nullの結果だけを保持し、not_found / errorはcacheしない。
    const microCacheKey = `live:${routeName}:${id}`;
    let body = isolateMicroCacheGet(microCacheKey);
    if (body === null) {
      const payload = await load(db, id);
      if (!payload) {
        return jsonErrorResponse(
          { error: "not_found", message: "イベントが見つかりません。" },
          404,
        );
      }
      body = JSON.stringify(payload);
      isolateMicroCacheSet(microCacheKey, body);
    }

    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": liveApiCacheControl(),
      },
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
  // env / isolate(30s) / KV複製を優先し、どちらも無いときだけD1を1回読む。
  // 以後はisolate cacheに載るため、polling毎のsystem_settings読取りは発生しない。
  return isLiveApiEnabled(
    await resolvePublicOperationMode({ allowD1: true, db }),
  );
}

export function liveApiCacheControl(): string {
  return "public, s-maxage=5, stale-while-revalidate=30";
}
