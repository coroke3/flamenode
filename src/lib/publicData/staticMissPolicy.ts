import { and, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import { events, videos, xUsers } from "../db/schema";
import { resolveVideoPrimaryKey } from "../db/videoIdLookup";
import type { StaticRebuildTargetType } from "../staticRebuild/types";
import { publicListableXApprovalWhere } from "../utils/publicXUserWhere";

export type {
  PublicStaticTargetProbe,
} from "./publicStaticTargetProbe";
export {
  probePublicStaticTarget,
  publicStaticTargetExists,
} from "./publicStaticTargetProbe";

const MAX_PUBLIC_TARGET_ID_LENGTH = 128;

function normalizeTargetId(targetId: string): string | null {
  const normalized = targetId.trim();
  return normalized && normalized.length <= MAX_PUBLIC_TARGET_ID_LENGTH
    ? normalized
    : null;
}

/**
 * @deprecated probePublicStaticTarget を使用してください。
 */
export async function legacyPublicStaticTargetExists(
  db: DB,
  targetType: StaticRebuildTargetType,
  targetId: string,
): Promise<boolean> {
  if (targetType !== "event" && targetType !== "video" && targetType !== "user") {
    return true;
  }

  const normalized = normalizeTargetId(targetId);
  if (!normalized) return false;

  if (targetType === "event") {
    const rows = await db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.id, normalized),
          eq(events.visibility_status, "public"),
        )!,
      )
      .limit(1);
    return rows.length === 1;
  }

  if (targetType === "video") {
    const resolvedId = await resolveVideoPrimaryKey(db, normalized, {
      andWhere: eq(videos.visibility_status, "public"),
    });
    return resolvedId !== null;
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
  return rows.length === 1;
}
