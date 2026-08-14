import "server-only";

import { eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { users, xUserAccountLinks } from "@/lib/db/schema";
import { normalizeXId } from "@/lib/utils/xid";

export type AdminXUserEnrichment = {
  primary_auth_user_id: string | null;
  primary_auth_user_name: string | null;
  linked_auth_user_count: number;
  active_holder_count: number;
};

const EMPTY_ENRICHMENT: AdminXUserEnrichment = {
  primary_auth_user_id: null,
  primary_auth_user_name: null,
  linked_auth_user_count: 0,
  active_holder_count: 0,
};

type LinkRow = {
  x_user_id: string;
  auth_user_id: string;
  /** leftJoinで孤児リンクを区別するための存在フラグ。 */
  auth_user_exists: string | null;
  auth_user_name: string | null;
  active_x_user_id: string | null;
  link_role: "owner" | "manager";
  created_at: number;
};

/**
 * 表示対象の X ID だけを対象に、連携ユーザーと Active holder を一括解決する。
 *
 * 旧実装の行ごとの相関サブクエリと同じ選択規則を維持する:
 * owner 優先 → created_at 昇順 → auth_user_id 昇順。
 * Active X の保存値は legacy の大文字を許容するため、比較だけ normalizeXId で行う。
 */
export async function loadAdminXUserEnrichment(
  db: DB,
  xUserIds: readonly string[],
): Promise<Map<string, AdminXUserEnrichment>> {
  const ids = Array.from(new Set(xUserIds.filter(Boolean)));
  const result = new Map<string, AdminXUserEnrichment>();
  for (const id of ids) result.set(id, { ...EMPTY_ENRICHMENT });
  if (ids.length === 0) return result;

  // Query B: 表示対象 X ID のリンクと認証ユーザーを一括取得する。
  // leftJoin で、legacy の孤児リンクも linked_auth_user_count と primary ID に残す。
  const linkRows = (await db
    .select({
      x_user_id: xUserAccountLinks.x_user_id,
      auth_user_id: xUserAccountLinks.auth_user_id,
      auth_user_exists: users.id,
      auth_user_name: users.name,
      active_x_user_id: users.active_x_user_id,
      link_role: xUserAccountLinks.link_role,
      created_at: xUserAccountLinks.created_at,
    })
    .from(xUserAccountLinks)
    .leftJoin(users, eq(users.id, xUserAccountLinks.auth_user_id))
    .where(inArray(xUserAccountLinks.x_user_id, ids))) as LinkRow[];

  const linksByX = new Map<string, LinkRow[]>();
  for (const row of linkRows) {
    const rows = linksByX.get(row.x_user_id) ?? [];
    rows.push(row);
    linksByX.set(row.x_user_id, rows);
  }
  // Query B already joins users, so derive active holder counts from the same
  // bounded result instead of scanning x_user_account_links/users again.
  const activeHolders = new Set<string>();
  const activeHolderUsers = new Map<string, Set<string>>();

  for (const [xId, rows] of linksByX) {
    rows.sort((a, b) => {
      const roleDiff = (a.link_role === "owner" ? 0 : 1) - (b.link_role === "owner" ? 0 : 1);
      if (roleDiff !== 0) return roleDiff;
      if (a.created_at !== b.created_at) return a.created_at - b.created_at;
      // SQLite の既定 BINARY collation（ORDER BY auth_user_id）と同じ比較。
      if (a.auth_user_id < b.auth_user_id) return -1;
      if (a.auth_user_id > b.auth_user_id) return 1;
      return 0;
    });
    const primary = rows[0];
    // 旧SQLはIDを孤児リンクを含めて選ぶ一方、nameはINNER JOINで
    // 孤児を除外して最初の実在ユーザーを選んでいた。この差を維持する。
    const primaryName = rows.find((row) => row.auth_user_exists !== null);
    for (const row of rows) {
      if (
        row.auth_user_exists !== null &&
        row.active_x_user_id !== null &&
        row.active_x_user_id !== undefined &&
        normalizeXId(row.active_x_user_id) === normalizeXId(row.x_user_id)
      ) {
        activeHolders.add(row.x_user_id);
        const holders = activeHolderUsers.get(row.x_user_id) ?? new Set<string>();
        holders.add(row.auth_user_id);
        activeHolderUsers.set(row.x_user_id, holders);
      }
    }
    result.set(xId, {
      primary_auth_user_id: primary?.auth_user_id ?? null,
      primary_auth_user_name: primaryName?.auth_user_name ?? null,
      linked_auth_user_count: rows.length,
      active_holder_count: activeHolderUsers.get(xId)?.size ?? 0,
    });
  }

  // Query B above already contains the joined user state; no second D1 query
  // is needed to derive these holder counts.
  for (const xId of activeHolders) {
    const holders = activeHolderUsers.get(xId) ?? new Set<string>();
    const current = result.get(xId) ?? { ...EMPTY_ENRICHMENT };
    result.set(xId, { ...current, active_holder_count: holders.size });
  }

  return result;
}
