import { PUBLIC_LISTABLE_X_APPROVAL_SQL_IN } from "../utils/publicXUser.ts";
import { COUNTABLE_PUBLIC_VIDEO_SQL } from "./countablePublicVideoSql.ts";

export const DEGRADED_USERS_PAGE_SIZE = 48;

/** `/user` degraded: 相関サブクエリなし・LIMIT 48。 */
export function buildDegradedUsersPageSql(): string {
  return `
    SELECT
      xu.id AS x_id,
      COALESCE(NULLIF(TRIM(xu.x_name), ''), xu.id) AS x_name,
      COALESCE(NULLIF(TRIM(xu.icon_url), ''), li.icon_url) AS icon_url
    FROM x_users AS xu
    LEFT JOIN (
      SELECT x_id, icon_url
      FROM (
        SELECT
          v.creator_x_user_id AS x_id,
          v.creator_icon_url AS icon_url,
          ROW_NUMBER() OVER (
            PARTITION BY v.creator_x_user_id
            ORDER BY v.scheduled_time DESC, v.created_at DESC
          ) AS row_num
        FROM videos AS v
        WHERE ${COUNTABLE_PUBLIC_VIDEO_SQL}
          AND v.collaboration_type = 'individual'
          AND v.creator_icon_url IS NOT NULL
      )
      WHERE row_num = 1
    ) AS li ON li.x_id = xu.id
    WHERE xu.approval_status IN (${PUBLIC_LISTABLE_X_APPROVAL_SQL_IN})
      AND (
        ? = ''
        OR LOWER(xu.id) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(xu.x_name, '')) LIKE ? ESCAPE '\\'
      )
    ORDER BY xu.id
    LIMIT ? OFFSET ?`;
}
