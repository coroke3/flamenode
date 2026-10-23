import { sql } from "drizzle-orm";
import type {
  eventStaff,
  slotReservationGroups,
  slots,
  users,
  videoChapters,
  videoEvents,
  videoInteractions,
  videoMembers,
  videoModerationCases,
  videos,
  xIdentityRequests,
  xUserAccountLinks,
  xUserAliases,
  xUsers,
} from "@flamenode/db/schema";
import { normalizeXId } from "@flamenode/domain/xid";

export const X_ID_MERGE_REVERT_WINDOW_SECONDS = 7 * 24 * 60 * 60;
/** Keep a materialized restore snapshot well below D1's 2MB row/string ceiling. */
export const X_ID_MERGE_SNAPSHOT_MAX_BYTES = 1_000_000;
/** A single relation cannot consume the whole invocation before byte validation. */
export const X_ID_MERGE_SNAPSHOT_MAX_ROWS_PER_RELATION = 500;
export const X_ID_MERGE_SNAPSHOT_MAX_TOTAL_ROWS = 2_000;
/** One JSON1 queue upsert keeps the merge atomic plan bounded. */
export const X_ID_MERGE_STATIC_REBUILD_TARGET_LIMIT = 100;
/** Admin guard (2), request lookup (1), bounded snapshot capture (14). */
export const X_ID_MERGE_CALLER_D1_QUERY_COUNT = 17;
/** Admin guard (2), revert request + parent lookup (2). */
export const X_ID_REVERT_CALLER_D1_QUERY_COUNT = 4;

/**
 * X ID統合後に「統合元が現行参照として残っていない」ことを同じD1
 * mutation内で確認するためのSQL条件。履歴 (x_identity_requests) と
 * alias_x_id は差し戻し・正規化のため意図的に統合元文字列を保持するので、
 * 現行参照だけを対象にする。
 *
 * canonical migration後も予約スナップショットなどには @、大文字、空白を
 * 含む旧表記が残り得るため、各参照は normalizeXId と同じSQLite式で検査する。
 */
export function normalizedXIdSql(column: string, xUserId: string) {
  return sql`lower(trim(ltrim(trim(${sql.raw(column)}), '@'))) = lower(${xUserId})`;
}

export function noActiveSourceReferencesSql(sourceXUserId: string) {
  return sql`
    NOT EXISTS (SELECT 1 FROM "user" WHERE ${normalizedXIdSql("active_x_user_id", sourceXUserId)})
    AND NOT EXISTS (SELECT 1 FROM videos WHERE ${normalizedXIdSql("creator_x_user_id", sourceXUserId)})
    AND NOT EXISTS (SELECT 1 FROM video_members WHERE ${normalizedXIdSql("x_user_id", sourceXUserId)})
    AND NOT EXISTS (SELECT 1 FROM video_chapters WHERE ${normalizedXIdSql("x_user_id", sourceXUserId)})
    AND NOT EXISTS (SELECT 1 FROM slots WHERE
      ${normalizedXIdSql("x_user_id", sourceXUserId)}
      OR ${normalizedXIdSql("reserved_x_id_snapshot", sourceXUserId)}
    )
    AND NOT EXISTS (SELECT 1 FROM slot_reservation_groups WHERE ${normalizedXIdSql("x_user_id", sourceXUserId)})
    AND NOT EXISTS (SELECT 1 FROM video_moderation_cases WHERE ${normalizedXIdSql("related_x_user_id", sourceXUserId)})
    AND NOT EXISTS (SELECT 1 FROM video_interactions WHERE ${normalizedXIdSql("x_user_id", sourceXUserId)})
    AND NOT EXISTS (SELECT 1 FROM event_staff WHERE ${normalizedXIdSql("x_user_id", sourceXUserId)})
    AND NOT EXISTS (SELECT 1 FROM x_user_account_links WHERE ${normalizedXIdSql("x_user_id", sourceXUserId)})
    AND NOT EXISTS (SELECT 1 FROM x_user_aliases WHERE ${normalizedXIdSql("x_user_id", sourceXUserId)})
  `;
}

export type XIdMergeRestoreSnapshot = {
  version: 2;
  source_x_user_id: string;
  target_x_user_id: string;
  captured_at: number;
  source_x_user: typeof xUsers.$inferSelect;
  target_x_user: typeof xUsers.$inferSelect;
  active_users: Array<Pick<typeof users.$inferSelect, "id" | "active_x_user_id">>;
  account_links: Array<typeof xUserAccountLinks.$inferSelect>;
  videos: Array<typeof videos.$inferSelect>;
  video_chapters: Array<typeof videoChapters.$inferSelect>;
  /** Linked event IDs for affected videos; optional for pre-fanout snapshots. */
  video_event_links?: Array<typeof videoEvents.$inferSelect>;
  video_members: Array<typeof videoMembers.$inferSelect>;
  slots: Array<typeof slots.$inferSelect>;
  /** Reservation-group identity is an active reference and must follow the merge. */
  slot_reservation_groups?: Array<typeof slotReservationGroups.$inferSelect>;
  /** Moderation cases keep an X-ID relation for operator context. */
  video_moderation_cases?: Array<typeof videoModerationCases.$inferSelect>;
  video_interactions: Array<typeof videoInteractions.$inferSelect>;
  event_staff: Array<typeof eventStaff.$inferSelect>;
  aliases: Array<typeof xUserAliases.$inferSelect>;
};

export type XIdMergeExecutionResult = {
  counts: Record<string, number>;
  restoreSnapshotJson: string;
  revertDeadlineAt: number;
};

export type MergeRequestRow = typeof xIdentityRequests.$inferSelect;

export function parseSnapshot(raw: string): XIdMergeRestoreSnapshot {
  let parsed: Partial<XIdMergeRestoreSnapshot>;
  try {
    parsed = JSON.parse(raw) as Partial<XIdMergeRestoreSnapshot>;
  } catch {
    throw new Error("restore_snapshot_json をJSONとして解析できません。");
  }
  if (
    parsed.version !== 2 ||
    !parsed.source_x_user_id ||
    !parsed.target_x_user_id ||
    !parsed.source_x_user ||
    !parsed.target_x_user ||
    !Array.isArray(parsed.active_users) ||
    !Array.isArray(parsed.account_links) ||
    !Array.isArray(parsed.videos) ||
    !Array.isArray(parsed.video_chapters) ||
    !Array.isArray(parsed.video_members) ||
    !Array.isArray(parsed.slots) ||
    !Array.isArray(parsed.video_interactions) ||
    !Array.isArray(parsed.event_staff) ||
    !Array.isArray(parsed.aliases)
  ) {
    throw new Error("restore_snapshot_json の形式またはversionが不正です。");
  }
  return {
    ...(parsed as XIdMergeRestoreSnapshot),
    video_event_links: Array.isArray(parsed.video_event_links)
      ? (parsed.video_event_links as Array<typeof videoEvents.$inferSelect>)
      : [],
    slot_reservation_groups: Array.isArray(parsed.slot_reservation_groups)
      ? (parsed.slot_reservation_groups as Array<typeof slotReservationGroups.$inferSelect>)
      : [],
    video_moderation_cases: Array.isArray(parsed.video_moderation_cases)
      ? (parsed.video_moderation_cases as Array<typeof videoModerationCases.$inferSelect>)
      : [],
  };
}

export function assertMergeRequest(request: MergeRequestRow): {
  source: string;
  target: string;
} {
  if (request.request_type !== "merge" || request.status !== "approved") {
    throw new Error("承認済みの統合申請だけを実行できます。");
  }
  if (!request.source_x_user_id || !request.target_x_user_id) {
    throw new Error("統合元または統合先のX名義がありません。");
  }
  // Legacy requests can retain presentation differences such as `@`, case,
  // or surrounding whitespace. Treat those as the same logical identity so
  // a malformed request can never merge an X user into itself.
  const source = normalizeXId(request.source_x_user_id);
  const target = normalizeXId(request.target_x_user_id);
  if (!source || !target) {
    throw new Error("統合元または統合先のX名義を正規化できません。");
  }
  if (source === target) {
    throw new Error("統合元と統合先が同一です。");
  }
  // All subsequent equality predicates address canonical primary keys.  A
  // legacy request can retain presentation-only differences, but must not
  // turn those differences into a failed lookup or a second logical ID.
  return { source, target };
}
