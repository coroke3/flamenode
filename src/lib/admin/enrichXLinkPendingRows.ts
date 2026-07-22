import "server-only";

import { and, desc, inArray, isNotNull } from "drizzle-orm";
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

  const xUserById = new Map<string, { x_name: string; icon_url: string | null }>();
  const idList = Array.from(xIds);
  for (const chunk of chunkIds(idList)) {
    if (chunk.length === 0) continue;
    const xUserRows = await db
      .select({
        id: xUsers.id,
        x_name: xUsers.x_name,
        icon_url: xUsers.icon_url,
      })
      .from(xUsers)
      .where(inArray(xUsers.id, chunk));
    for (const row of xUserRows) {
      xUserById.set(row.id, { x_name: row.x_name, icon_url: row.icon_url });
    }
  }

  const videoIconByXId = new Map<string, string>();
  if (options.includeVideoIconFallback) {
    const needingIcon = idList.filter((id) => !xUserById.get(id)?.icon_url);
    for (const chunk of chunkIds(needingIcon)) {
      if (chunk.length === 0) continue;
      const videoRows = await db
        .select({
          creator_x_user_id: videos.creator_x_user_id,
          creator_icon_url: videos.creator_icon_url,
        })
        .from(videos)
        .where(
          and(
            inArray(videos.creator_x_user_id, chunk),
            isNotNull(videos.creator_icon_url),
          )!,
        )
        .orderBy(desc(videos.created_at));
      for (const row of videoRows) {
        const xId = normalizeXId(row.creator_x_user_id);
        if (xId && row.creator_icon_url && !videoIconByXId.has(xId)) {
          videoIconByXId.set(xId, row.creator_icon_url);
        }
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
      requested_icon_url: requestedXId ? resolveIcon(requestedXId) : null,
      target_icon_url: targetXId ? resolveIcon(targetXId) : null,
    };
  });
}
