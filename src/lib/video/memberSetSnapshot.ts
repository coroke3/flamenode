import { sql, type SQL } from "drizzle-orm";
import { videoMembers } from "@/lib/db/schema";

export type VideoMemberSnapshotRow = {
  id: string;
  video_id: string;
  x_user_id: string | null;
  name: string;
  role: string | null;
  comment: string | null;
  order_index: number;
  can_edit: number;
  is_public_member: number;
  edit_granted_by_auth_user_id: string | null;
  edit_granted_at: number | null;
  edit_updated_at: number | null;
};

export type VideoMemberSetSnapshot = {
  id: string;
  rows: VideoMemberSnapshotRow[];
};

export function toVideoMemberSnapshotRow(
  row: typeof videoMembers.$inferSelect,
): VideoMemberSnapshotRow {
  return {
    id: row.id,
    video_id: row.video_id,
    x_user_id: row.x_user_id,
    name: row.name,
    role: row.role,
    comment: row.comment,
    order_index: row.order_index,
    can_edit: row.can_edit,
    is_public_member: row.is_public_member,
    edit_granted_by_auth_user_id: row.edit_granted_by_auth_user_id,
    edit_granted_at: row.edit_granted_at,
    edit_updated_at: row.edit_updated_at,
  };
}

/** SQLiteの既定BINARY collationに合わせ、locale依存の並び順を使わない。 */
export function compareSqliteBinaryText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortRows(
  rows: readonly VideoMemberSnapshotRow[],
): VideoMemberSnapshotRow[] {
  return [...rows].sort(
    (left, right) =>
      left.order_index - right.order_index ||
      compareSqliteBinaryText(left.id, right.id),
  );
}

export function buildVideoMemberSetSnapshot(
  videoId: string,
  rows: readonly (typeof videoMembers.$inferSelect)[],
): VideoMemberSetSnapshot {
  return {
    id: videoId,
    rows: sortRows(rows.map(toVideoMemberSnapshotRow)),
  };
}

export function parseVideoMemberSetSnapshot(
  value: Record<string, unknown> | null | undefined,
): VideoMemberSetSnapshot | null {
  if (
    !value ||
    typeof value.id !== "string" ||
    !Array.isArray(value.rows)
  ) {
    return null;
  }

  const rows: VideoMemberSnapshotRow[] = [];
  for (const raw of value.rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    if (
      typeof row.id !== "string" ||
      typeof row.video_id !== "string" ||
      typeof row.name !== "string" ||
      typeof row.order_index !== "number" ||
      typeof row.can_edit !== "number" ||
      typeof row.is_public_member !== "number"
    ) {
      return null;
    }

    rows.push({
      id: row.id,
      video_id: row.video_id,
      x_user_id: typeof row.x_user_id === "string" ? row.x_user_id : null,
      name: row.name,
      role: typeof row.role === "string" ? row.role : null,
      comment: typeof row.comment === "string" ? row.comment : null,
      order_index: row.order_index,
      can_edit: row.can_edit,
      is_public_member: row.is_public_member,
      edit_granted_by_auth_user_id:
        typeof row.edit_granted_by_auth_user_id === "string"
          ? row.edit_granted_by_auth_user_id
          : null,
      edit_granted_at:
        typeof row.edit_granted_at === "number" ? row.edit_granted_at : null,
      edit_updated_at:
        typeof row.edit_updated_at === "number" ? row.edit_updated_at : null,
    });
  }

  return { id: value.id, rows: sortRows(rows) };
}

export function buildVideoMemberSetGuardSql(
  videoId: string,
  expectedRows: readonly VideoMemberSnapshotRow[],
): SQL {
  const expectedJson = JSON.stringify(sortRows(expectedRows));
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
            AND is_public_member = 1
          ORDER BY order_index ASC, id ASC
        )
      ) = json(${expectedJson})
      THEN 1
      ELSE json_extract('not-valid-json', '$')
    END
  `;
}

export function buildVideoMemberBulkInsertSql(
  rows: readonly VideoMemberSnapshotRow[],
): SQL {
  if (rows.length === 0) throw new Error("video_member_bulk_insert_empty");
  const payload = JSON.stringify(sortRows(rows));

  return sql`
    INSERT INTO video_members (
      id,
      video_id,
      x_user_id,
      name,
      role,
      comment,
      order_index,
      can_edit,
      is_public_member,
      edit_granted_by_auth_user_id,
      edit_granted_at,
      edit_updated_at
    )
    SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.video_id'),
      json_extract(value, '$.x_user_id'),
      json_extract(value, '$.name'),
      json_extract(value, '$.role'),
      json_extract(value, '$.comment'),
      json_extract(value, '$.order_index'),
      json_extract(value, '$.can_edit'),
      json_extract(value, '$.is_public_member'),
      json_extract(value, '$.edit_granted_by_auth_user_id'),
      json_extract(value, '$.edit_granted_at'),
      json_extract(value, '$.edit_updated_at')
    FROM json_each(${payload})
  `;
}
