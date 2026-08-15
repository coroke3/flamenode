import "server-only";

import { and, desc, inArray, isNotNull, sql } from "drizzle-orm";
import type { XLinkRequestRow } from "@/components/admin/XLinkRequestTable";
import type { DB } from "@/lib/db/client";
import { videos, xUsers } from "@/lib/db/schema";
import { D1_MAX_BIND_PARAMETERS } from "@/lib/audit/mutateBudget";
import { normalizeXId } from "@/lib/utils/xid";

export type XLinkPendingBaseRow = {
  id: string;
  requested_x_id: string | null;
  requested_by_auth_user_id: string;
  discord_name: string | null;
  discord_image: string | null;
  requested_at: number;
  request_type: string;
  target_x_user_id: string | null;
};

function chunkIds(ids: string[], size = D1_MAX_BIND_PARAMETERS): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

/** pending行のX名義表示を相関サブクエリなしで一括解決する。 */
export async function enrichXLinkPendingRows(
  db: DB,
  pendingBase: XLinkPendingBaseRow[],
  options: { includeVideoIconFallback?: boolean } = {},
): Promise<XLinkRequestRow[]> {
  const xIds = new Set<string>();
  for (const row of pendingBase) {
    const requested = normalizeXId(row.requested_x_id);
    const target = normalizeXId(row.target_x_user_id);
    if (requested) xIds.add(requested);
    if (target) xIds.add(target);
  }

  const xUserById = new Map<
    string,
    { x_name: string; icon_url: string | null; approval_status: string | null }
  >();
  const idList = Array.from(xIds);
  const addXUserRows = (
    rows: Array<{
      id: string;
      x_name: string;
      icon_url: string | null;
      approval_status: string | null;
    }>,
  ) => {
    for (const row of rows) {
      const normalizedId = normalizeXId(row.id);
      if (!normalizedId || xUserById.has(normalizedId)) continue;
      xUserById.set(normalizedId, {
        x_name: row.x_name,
        icon_url: row.icon_url,
        approval_status: row.approval_status,
      });
    }
  };
  for (const chunk of chunkIds(idList)) {
    if (chunk.length === 0) continue;
    // Canonical IDs use the primary-key lookup. Legacy casing/whitespace is
    // handled only for IDs not found by that indexed path, avoiding a full
    // x_users scan on every normal moderation request.
    const canonicalRows = await db
      .select({
        id: xUsers.id,
        x_name: xUsers.x_name,
        icon_url: xUsers.icon_url,
        approval_status: xUsers.approval_status,
      })
      .from(xUsers)
      .where(inArray(xUsers.id, chunk));
    addXUserRows(canonicalRows);

    const unresolved = chunk.filter((id) => !xUserById.has(id));
    if (unresolved.length > 0) {
      const legacyRows = await db
        .select({
          id: xUsers.id,
          x_name: xUsers.x_name,
          icon_url: xUsers.icon_url,
          approval_status: xUsers.approval_status,
        })
        .from(xUsers)
        .where(inArray(sql<string>`lower(trim(${xUsers.id}))`, unresolved));
      addXUserRows(legacyRows);
    }
  }

  // X ID申請画面は canonical x_users.icon_url が未設定の既存IDでも、
  // 過去作品に保存された creator_icon_url を補助表示に利用する。
  // このfallbackはこの画面専用で、署名対象ではない。ManageXIcon側で
  // xicons/x-icons の承認済みinternal URLだけ署名し、external HTTPS以外は
  // fail-closedでプレースホルダーへ戻す。
  const videoIconByXId = new Map<string, string>();
  if (options.includeVideoIconFallback) {
    const needingIcon = idList.filter((id) => !xUserById.get(id)?.icon_url);
    for (const chunk of chunkIds(needingIcon)) {
      if (chunk.length === 0) continue;
      const addVideoIconRows = (
        rows: Array<{
          creator_x_user_id: string | null;
          creator_icon_url: string | null;
          created_at: number;
        }>,
      ) => {
        for (const row of rows) {
          const xId = normalizeXId(row.creator_x_user_id);
          if (xId && row.creator_icon_url && !videoIconByXId.has(xId)) {
            videoIconByXId.set(xId, row.creator_icon_url);
          }
        }
      };
      const canonicalVideoRows = await db
        .select({
          creator_x_user_id: videos.creator_x_user_id,
          creator_icon_url: videos.creator_icon_url,
          created_at: videos.created_at,
        })
        .from(videos)
        .where(
          and(
            inArray(videos.creator_x_user_id, chunk),
            isNotNull(videos.creator_icon_url),
          )!,
        )
        .orderBy(desc(videos.created_at));

      addVideoIconRows(canonicalVideoRows);
      const unresolved = chunk.filter((id) => !videoIconByXId.has(id));
      if (unresolved.length > 0) {
        const legacyVideoRows = await db
          .select({
            creator_x_user_id: videos.creator_x_user_id,
            creator_icon_url: videos.creator_icon_url,
            created_at: videos.created_at,
          })
          .from(videos)
          .where(
            and(
              inArray(
                sql<string>`lower(trim(${videos.creator_x_user_id}))`,
                unresolved,
              ),
              isNotNull(videos.creator_icon_url),
            )!,
          )
          .orderBy(desc(videos.created_at));
        addVideoIconRows(legacyVideoRows);
      }
    }
  }

  const resolveIcon = (xId: string): string | null =>
    xUserById.get(xId)?.icon_url ?? videoIconByXId.get(xId) ?? null;

  return pendingBase.map((row) => {
    const requestedXId = normalizeXId(row.requested_x_id);
    const targetXId = normalizeXId(row.target_x_user_id);
    const requestedXUser = requestedXId ? xUserById.get(requestedXId) : undefined;
    return {
      id: row.id,
      requested_x_id: requestedXId || "",
      requested_by_auth_user_id: row.requested_by_auth_user_id,
      discord_name: row.discord_name,
      discord_image: row.discord_image,
      requested_at: row.requested_at,
      request_type: row.request_type as XLinkRequestRow["request_type"],
      target_x_user_id: row.target_x_user_id,
      requested_x_name: requestedXUser?.x_name ?? null,
      requested_icon_url: requestedXId
        ? resolveIcon(requestedXId)
        : null,
      requested_approval_status: requestedXId
        ? xUserById.get(requestedXId)?.approval_status ?? null
        : null,
      target_icon_url: targetXId
        ? resolveIcon(targetXId)
        : null,
      target_approval_status: targetXId
        ? xUserById.get(targetXId)?.approval_status ?? null
        : null,
    };
  });
}
