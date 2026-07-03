import "server-only";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDatabase } from "@/lib/cloudflare";
import type { DB } from "@/lib/db/client";
import { systemSettings } from "@/lib/db/schema";

/** live API の GET ハンドラ共通: DB 未接続・cost guard・クエリ失敗を JSON で返す（画面全体の 500 回避）。 */
export async function handleLiveApiGet<T>(
  eventId: string,
  load: (db: DB, eventId: string) => Promise<T | null>,
): Promise<Response> {
  const id = eventId.trim();
  if (!id || id.length > 128) {
    return NextResponse.json(
      { error: "invalid_event_id", message: "イベントIDが不正です。" },
      { status: 400 },
    );
  }

  const db = getDatabase();
  if (!db) {
    return NextResponse.json(
      { error: "db_unavailable", message: "データベースに接続できません。" },
      { status: 503 },
    );
  }

  try {
    if (!(await liveApiAllowed(db))) {
      return NextResponse.json(
        {
          error: "live_api_disabled",
          message: "ライブ更新 API は現在無効です（メンテナンスまたは静的配信モード）。",
        },
        { status: 503 },
      );
    }

    const payload = await load(db, id);
    if (!payload) {
      return NextResponse.json(
        { error: "not_found", message: "イベントが見つかりません。" },
        { status: 404 },
      );
    }

    return NextResponse.json(payload, {
      headers: { "Cache-Control": liveApiCacheControl() },
    });
  } catch (err) {
    console.error("[live-api] GET failed", { eventId: id, err });
    return NextResponse.json(
      {
        error: "live_api_error",
        message: "ライブデータの取得に失敗しました。しばらくしてから再度お試しください。",
      },
      { status: 503 },
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
  const mode = row?.operation_mode ?? "normal";
  return mode !== "static_only" && mode !== "maintenance";
}

export function liveApiCacheControl(): string {
  return "public, s-maxage=5, stale-while-revalidate=30";
}
