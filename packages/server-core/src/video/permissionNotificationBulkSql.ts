import { sql } from "drizzle-orm";
import type { notificationOutbox } from "@flamenode/db/schema";

type OutboxRow = typeof notificationOutbox.$inferSelect;

/**
 * SA-082..084 bulk permission notification SQL, shared by CURRENT and Hono.
 * This ONLY constructs an unexecuted prepared SQL statement. The host must
 * validate payloads and recipients, create per-grant transition dedupe keys,
 * and append the statement to the SAME strict D1 batch as permission CAS,
 * mutation and audit. A conflicting outbox dedupe is idempotently ignored.
 *
 * Preserve the exact CURRENT JSON1 columns and bind shape. Never inline JSON.
 */
export function buildPermissionNotificationBulkInsertSql(
  rows: readonly OutboxRow[],
) {
  if (rows.length === 0 || rows.length > 200) {
    throw new Error("permission_notification_bulk_rows_out_of_range");
  }
  const payload = JSON.stringify(rows);
  return sql`
    INSERT OR IGNORE INTO notification_outbox (
      id,
      recipient_user_id,
      type,
      payload_json,
      delivery_route,
      correlation_id,
      status,
      attempt_count,
      processing_started_at,
      lease_token,
      lease_expires_at,
      next_attempt_at,
      last_error,
      processed_at,
      event_id,
      dedupe_key,
      created_at
    )
    SELECT
      json_extract(value, '$.id'),
      json_extract(value, '$.recipient_user_id'),
      json_extract(value, '$.type'),
      json_extract(value, '$.payload_json'),
      json_extract(value, '$.delivery_route'),
      json_extract(value, '$.correlation_id'),
      json_extract(value, '$.status'),
      json_extract(value, '$.attempt_count'),
      json_extract(value, '$.processing_started_at'),
      json_extract(value, '$.lease_token'),
      json_extract(value, '$.lease_expires_at'),
      json_extract(value, '$.next_attempt_at'),
      json_extract(value, '$.last_error'),
      json_extract(value, '$.processed_at'),
      json_extract(value, '$.event_id'),
      json_extract(value, '$.dedupe_key'),
      json_extract(value, '$.created_at')
    FROM json_each(${payload})
  `;
}
