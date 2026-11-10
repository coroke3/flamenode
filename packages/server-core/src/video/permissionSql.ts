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

/** CURRENT collaborator x_users upsert: never revive a rejected X identity. */
export function buildXUsersBulkInsertSql(rows: readonly (typeof import("@flamenode/db/schema").xUsers.$inferInsert)[]) {
  const payload = JSON.stringify(rows);
  return sql`
    INSERT INTO x_users (
      id,
      x_name,
      icon_url,
      profile_text,
      portfolio_contact,
      youtube_channel_url,
      other_social_links,
      creative_start_date,
      approval_status
    )
    SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.x_name'),
      json_extract(value, '$.icon_url'),
      json_extract(value, '$.profile_text'),
      json_extract(value, '$.portfolio_contact'),
      json_extract(value, '$.youtube_channel_url'),
      json_extract(value, '$.other_social_links'),
      json_extract(value, '$.creative_start_date'),
      json_extract(value, '$.approval_status')
    FROM json_each(${payload})
    WHERE 1 = 1
    ON CONFLICT(id) DO UPDATE SET
      id = excluded.id
    WHERE COALESCE(x_users.approval_status, 'pending') <> 'rejected'
  `;
}

/** SQL bulk permission mutation; exact member-set CAS must run in same D1 batch. */
export function buildMemberPermissionBulkUpdateSql(rows: readonly VideoMemberRow[]) {
  const payload = JSON.stringify(rows.map(toVideoMemberSnapshotRow));
  return sql`
    WITH patches AS (
      SELECT
        json_extract(value, '$.id') AS id,
        json_extract(value, '$.can_edit') AS can_edit,
        json_extract(value, '$.edit_granted_by_auth_user_id') AS edit_granted_by_auth_user_id,
        json_extract(value, '$.edit_granted_at') AS edit_granted_at,
        json_extract(value, '$.edit_updated_at') AS edit_updated_at
      FROM json_each(${payload})
    )
    UPDATE video_members
    SET
      can_edit = (SELECT can_edit FROM patches WHERE patches.id = video_members.id),
      edit_granted_by_auth_user_id = (
        SELECT edit_granted_by_auth_user_id FROM patches WHERE patches.id = video_members.id
      ),
      edit_granted_at = (SELECT edit_granted_at FROM patches WHERE patches.id = video_members.id),
      edit_updated_at = (SELECT edit_updated_at FROM patches WHERE patches.id = video_members.id)
    WHERE id IN (SELECT id FROM patches)
  `;
}

/** CAS-compatible hidden-member removal, always constrained by video_id. */
export function buildHiddenMemberBulkDeleteSql(videoId: string, ids: readonly string[]) {
  const payload = JSON.stringify(ids);
  return sql`
    DELETE FROM video_members
    WHERE video_id = ${videoId}
      AND is_public_member = 0
      AND id IN (
        SELECT CAST(value AS TEXT) FROM json_each(${payload})
      )
  `;
}
