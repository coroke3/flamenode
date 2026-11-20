/**
 * MIG-0650 U03d-2d: CURRENT SA-085 hidden member carry-over SQL plans.
 *
 * SQL is unchanged from the legacy Next writer. The authenticated caller
 * controls which hidden members are eligible; these helpers only guard their
 * exact snapshot and restrict cleanup to matching hidden rows within videoId.
 * The caller owns the atomic D1 batch, expectedChanges and strict audit.
 */
import { sql } from "drizzle-orm";
import { videoMembers } from "@flamenode/db/schema";
import {
  compareSqliteBinaryText,
  toVideoMemberSnapshotRow,
} from "./memberSetSnapshot.ts";

export function buildHiddenCarryRowsGuardSql(
  videoId: string,
  rows: readonly (typeof videoMembers.$inferSelect)[],
) {
  const expectedRows = [...rows]
    .map(toVideoMemberSnapshotRow)
    .sort((left, right) => compareSqliteBinaryText(left.id, right.id));
  const idsPayload = JSON.stringify(expectedRows.map((row) => row.id));
  const expectedJson = JSON.stringify(expectedRows);
  return sql`
    SELECT CASE
      WHEN (
        SELECT COALESCE(json_group_array(json(row_json)), json('[]'))
        FROM (
          SELECT json_object(
            'id', id,
            'video_id', video_id,
            'x_user_id', x_user_id,
            'name', name,
            'role', role,
            'comment', comment,
            'order_index', order_index,
            'can_edit', can_edit,
            'is_public_member', is_public_member,
            'edit_granted_by_auth_user_id', edit_granted_by_auth_user_id,
            'edit_granted_at', edit_granted_at,
            'edit_updated_at', edit_updated_at
          ) AS row_json
          FROM video_members
          WHERE video_id = ${videoId}
            AND is_public_member = 0
            AND id IN (
              SELECT CAST(value AS TEXT) FROM json_each(${idsPayload})
            )
          ORDER BY id ASC
        )
      ) = json(${expectedJson})
      THEN 1
      ELSE json_extract('video-hidden-member-conflict', '$')
    END
  `;
}

export function buildHiddenCarryRowsDeleteSql(
  videoId: string,
  rows: readonly (typeof videoMembers.$inferSelect)[],
) {
  const idsPayload = JSON.stringify(rows.map((row) => row.id));
  return sql`
    DELETE FROM video_members
    WHERE video_id = ${videoId}
      AND is_public_member = 0
      AND id IN (
        SELECT CAST(value AS TEXT) FROM json_each(${idsPayload})
      )
  `;
}

