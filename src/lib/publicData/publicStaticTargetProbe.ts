import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { events, videos, xUsers } from "../db/schema";
import { resolveVideoPrimaryKey } from "../db/videoIdLookup";
import type { StaticRebuildTargetType } from "../staticRebuild/types";
import { publicListableXApprovalWhere } from "../utils/publicXUserWhere";

const MAX_PUBLIC_TARGET_ID_LENGTH = 128;

export type PublicStaticTargetProbe =
  | { state: "public"; canonicalTargetId: string }
  | { state: "not_public"; canonicalTargetId: string }
  | { state: "missing" }
  | { state: "unknown"; errorCode: string };

function normalizeTargetId(targetId: string): string | null {
  const normalized = targetId.trim();
  return normalized && normalized.length <= MAX_PUBLIC_TARGET_ID_LENGTH
    ? normalized
    : null;
}

/**
 * Public R2 miss 時の対象判定。DB 障害は missing へ変換しない。
 */
export async function probePublicStaticTarget(
  db: DB,
  targetType: StaticRebuildTargetType,
  targetId: string,
): Promise<PublicStaticTargetProbe> {
  if (
    targetType !== "event" &&
    targetType !== "video" &&
    targetType !== "user"
  ) {
    return { state: "public", canonicalTargetId: targetId };
  }

  const normalized = normalizeTargetId(targetId);
  if (!normalized) return { state: "missing" };

  try {
    if (targetType === "event") {
      const rows = await db
        .select({ id: events.id, visibility_status: events.visibility_status })
        .from(events)
        .where(eq(events.id, normalized))
        .limit(1);
      if (rows.length === 0) return { state: "missing" };
      return rows[0].visibility_status === "public"
        ? { state: "public", canonicalTargetId: rows[0].id }
        : { state: "not_public", canonicalTargetId: rows[0].id };
    }

    if (targetType === "video") {
      const resolvedId = await resolveVideoPrimaryKey(db, normalized);
      if (!resolvedId) return { state: "missing" };
      const rows = await db
        .select({
          id: videos.id,
          visibility_status: videos.visibility_status,
        })
        .from(videos)
        .where(eq(videos.id, resolvedId))
        .limit(1);
      if (rows.length === 0) return { state: "missing" };
      return rows[0].visibility_status === "public"
        ? { state: "public", canonicalTargetId: rows[0].id }
        : { state: "not_public", canonicalTargetId: rows[0].id };
    }

    const canonicalXId = normalized.toLowerCase();
    const rows = await db
      .select({ id: xUsers.id })
      .from(xUsers)
      .where(
        and(
          sql`lower(${xUsers.id}) = ${canonicalXId}`,
          publicListableXApprovalWhere(),
        )!,
      )
      .limit(1);
    if (rows.length === 0) {
      const exists = await db
        .select({ id: xUsers.id })
        .from(xUsers)
        .where(sql`lower(${xUsers.id}) = ${canonicalXId}`)
        .limit(1);
      if (exists.length === 0) return { state: "missing" };
      return { state: "not_public", canonicalTargetId: exists[0].id };
    }
    return { state: "public", canonicalTargetId: rows[0].id };
  } catch (error) {
    return {
      state: "unknown",
      errorCode:
        error instanceof Error ? error.name : "public_target_probe_failed",
    };
  }
}
