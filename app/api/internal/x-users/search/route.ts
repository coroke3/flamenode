import { NextResponse } from "next/server";
import { and, eq, like, or, asc, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDatabase } from "@/lib/cloudflare";
import { xUsers } from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";

export const dynamic = "force-dynamic";

/**
 * 内部用 X ID 検索 API (メンバー候補補完用)。
 *
 * - 認証必須 (ログイン無しは 401)
 * - 公開フィールドのみ返す (id, x_name, icon_url, approval_status)
 * - 検索パラメータ: ?q=foo&limit=20&offset=0&onlyApproved=1
 * - q 未指定または空: 直近作成順 (created_at 不在のため id 順) 20 件
 *
 * 公開 API でないため scripts/check-public-api-leaks.mjs の対象には含めない。
 * URL に `/internal/` プレフィックスを付けて公開 API と隔離する。
 */
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const MAX_OFFSET = 5000;
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
  const normalizedQ = normalizeXId(rawQ);
  const onlyApproved = url.searchParams.get("onlyApproved") === "1";
  const limitRaw = Number(url.searchParams.get("limit") ?? "");
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(Math.floor(limitRaw), MAX_LIMIT)
      : DEFAULT_LIMIT;
  const offsetRaw = Number(url.searchParams.get("offset") ?? "");
  const offset =
    Number.isFinite(offsetRaw) && offsetRaw > 0
      ? Math.min(Math.floor(offsetRaw), MAX_OFFSET)
      : 0;

  // SQL ワイルドカード (% _) はそのまま使えるよう trim のみ。LIKE 検索の前後に % を付与。
  const conds: SQL<unknown>[] = [];
  if (rawQ) {
    const term = `%${rawQ.toLowerCase()}%`;
    const xTerm = `%${(normalizedQ || rawQ).toLowerCase()}%`;
    conds.push(
      or(
        like(sql<string>`lower(${xUsers.id})`, xTerm),
        like(sql<string>`lower(${xUsers.x_name})`, term),
      )!,
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
    .limit(limit + 1)
    .offset(offset);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);

  return NextResponse.json(
    {
      items,
      query: rawQ,
      limit,
      offset,
      nextOffset: hasMore ? offset + items.length : null,
      hasMore,
      hint:
        hasMore
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
