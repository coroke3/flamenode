import { sql } from "drizzle-orm";
import type { videoMembers } from "@flamenode/db/schema";
import {
  compareSqliteBinaryText,
  toVideoMemberSnapshotRow,
  VIDEO_MEMBER_ROW_JSON_SQL,
} from "./memberSetSnapshot.ts";

type VideoMemberRow = typeof videoMembers.$inferSelect;

/**
 * MIG-0650 U01: canonical D1 compare-and-swap precondition for collaborator
 * permissions. Pure SQL construction, with no host / Next / D1 side effects.
 *
 * The snapshot and the X ID filter deliberately match CURRENT SA-082..084:
 * a case-insensitive X ID selection, then an exact member row comparison.
 */
export function buildPermissionSetGuardSql(
  videoId: string,
  xids: readonly string[],
  expectedRows: readonly VideoMemberRow[],
) {
  const xidsPayload = JSON.stringify([...xids].sort());
  const expectedPayload = JSON.stringify(
    [...expectedRows]
      .sort((left, right) => compareSqliteBinaryText(left.id, right.id))
      .map(toVideoMemberSnapshotRow),
  );
  return sql`
    SELECT CASE
      WHEN (
        SELECT COALESCE(json_group_array(json(row_json)), json('[]'))
        FROM (
          SELECT ${VIDEO_MEMBER_ROW_JSON_SQL} AS row_json
          FROM video_members
          WHERE video_id = ${videoId}
            AND x_user_id IS NOT NULL
            AND lower(x_user_id) IN (
              SELECT lower(CAST(value AS TEXT)) FROM json_each(${xidsPayload})
            )
          ORDER BY id ASC
        )
      ) = json(${expectedPayload})
      THEN 1
      ELSE json_extract('video-permission-set-conflict', '$')
    END
  `;
}

/** Exact hidden-editor count, preventing a concurrent member edit from
 * silently bypassing CURRENT's MAX_VIDEO_HIDDEN_EDITORS budget. */
export function buildHiddenEditorCountGuardSql(videoId: string, expectedCount: number) {
  return sql`
    SELECT CASE
      WHEN (
        SELECT COUNT(*) FROM video_members
        WHERE video_id = ${videoId} AND is_public_member = 0
      ) = ${expectedCount}
      THEN 1
      ELSE json_extract('video-hidden-editor-count-conflict', '$')
    END
  `;
}
