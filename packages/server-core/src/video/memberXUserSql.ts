/**
 * MIG-0650 U03d-2f: CURRENT SA-085 pending X-user batch SQL planner.
 *
 * SQL is copied from the Next writer without changing ON CONFLICT semantics:
 * a concurrent existing X user must not be downgraded from approved or
 * overwritten. The authenticated caller keeps control of atomic D1 batch,
 * expected changes, audit and post-commit Queue.
 */
import { sql, type SQL } from "drizzle-orm";
import { xUsers } from "@flamenode/db/schema";

export function buildVideoMemberXUserBatchSql(
  rows: readonly (typeof xUsers.$inferInsert)[],
): SQL {
  if (rows.length === 0) throw new Error("video_member_x_user_batch_empty");
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
      `;
}
