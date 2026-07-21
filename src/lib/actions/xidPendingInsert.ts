import { sql, type SQL } from "drizzle-orm";

export type PendingXIdRequestRow = {
  id: string;
  request_type: "new_link" | "existing_link" | "alias" | "merge" | "revert_merge";
  requested_by_auth_user_id: string;
  requested_x_id: string | null;
  source_x_user_id: string | null;
  target_x_user_id: string | null;
  parent_request_id: string | null;
  restore_snapshot_json: string | null;
  revert_deadline_at: number | null;
  status: "pending";
  requested_at: number;
  updated_at: number;
};

function nullableColumnEquals(column: string, value: string | null): SQL {
  const identifier = sql.raw(column);
  return value === null
    ? sql`${identifier} IS NULL`
    : sql`${identifier} = ${value}`;
}

function pendingRequestCondition(row: Pick<PendingXIdRequestRow,
  "request_type" | "requested_by_auth_user_id" | "requested_x_id" | "source_x_user_id" | "target_x_user_id"
>): SQL {
  return sql`
    requested_by_auth_user_id = ${row.requested_by_auth_user_id}
    AND request_type = ${row.request_type}
    AND status = 'pending'
    AND ${nullableColumnEquals("requested_x_id", row.requested_x_id)}
    AND ${nullableColumnEquals("source_x_user_id", row.source_x_user_id)}
    AND ${nullableColumnEquals("target_x_user_id", row.target_x_user_id)}
  `;
}

/** Build the atomic pending-request insert used by the X ID action. */
export function buildPendingXIdRequestInsert(row: PendingXIdRequestRow): SQL {
  const condition = pendingRequestCondition(row);
  return sql`
    INSERT INTO x_identity_requests (
      id, request_type, requested_by_auth_user_id, requested_x_id,
      source_x_user_id, target_x_user_id, parent_request_id,
      restore_snapshot_json, revert_deadline_at, status, requested_at, updated_at
    )
    SELECT
      ${row.id}, ${row.request_type}, ${row.requested_by_auth_user_id}, ${row.requested_x_id},
      ${row.source_x_user_id}, ${row.target_x_user_id}, ${row.parent_request_id},
      ${row.restore_snapshot_json}, ${row.revert_deadline_at}, ${row.status},
      ${row.requested_at}, ${row.updated_at}
    WHERE NOT EXISTS (
      SELECT 1 FROM x_identity_requests WHERE ${condition}
    )
    AND (
      SELECT COUNT(*) FROM x_identity_requests
      WHERE requested_by_auth_user_id = ${row.requested_by_auth_user_id}
        AND status = 'pending'
    ) < 5
  `.inlineParams();
}
