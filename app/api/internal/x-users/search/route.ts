import { NextResponse } from "next/server";
import { and, eq, like, or, asc, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { xUsers } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

/**
 * 内部用 X ID 検索 API (メンバー候補補完用)。
 *
 * - 認証必須 (ログイン無しは 401)
 * - 公開フィールドのみ返す (id, x_name, icon_url, approval_status)
 * - 検索パラメータ: ?q=foo&limit=20&onlyApproved=1
 * - q 未指定または空: 直近作成順 (created_at 不在のため id 順) 20 件
 *
 * 公開 API でないため scripts/check-public-api-leaks.mjs の対象には含めない。
 * URL に `/internal/` プレフィックスを付けて公開 API と隔離する。
 */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_QUERY_LENGTH = 64;

export async function GET(request: Request): Promise<Response> {
  const session = await auth().catch(() => null);
  const u = session?.user as { id?: string } | undefined;
  if (!u?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = getDatabase();
  if (!db) {
    return NextResponse.json({ error: "db_unavailable" }, { status: 503 });
  }

  const url = new URL(request.url);
  const rawQ = (url.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const onlyApproved = url.searchParams.get("onlyApproved") === "1";
  const limitRaw = Number(url.searchParams.get("limit") ?? "");
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
      : DEFAULT_LIMIT;

  // SQL ワイルドカード (% _) はそのまま使えるよう trim のみ。LIKE 検索の前後に % を付与。
  const conds: SQL<unknown>[] = [];
  if (rawQ) {
    const term = `%${rawQ}%`;
    conds.push(
      or(like(xUsers.id, term), like(xUsers.x_name, term))!,
    );
  }
  if (onlyApproved) {
    conds.push(eq(xUsers.approval_status, "approved"));
  }
  const where =
    conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

  const base = db
    .select({
      id: xUsers.id,
      x_name: xUsers.x_name,
      icon_url: xUsers.icon_url,
      approval_status: xUsers.approval_status,
    })
    .from(xUsers);
  const rows = await (where ? base.where(where) : base)
    .orderBy(asc(xUsers.id))
    .limit(limit);

  return NextResponse.json(
    {
      items: rows,
      query: rawQ,
      limit,
      hint:
        rows.length === limit
          ? "結果が上限件数に達しています。q を絞り込んでください。"
          : null,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

// SQL 集計関数の参照を保持 (将来の COUNT/集計拡張用)
void sql;
