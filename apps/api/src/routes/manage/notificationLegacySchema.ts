/**
 * D1 failure alone does not prove a legacy notification schema. The only
 * compatibility case is an existing notification_outbox table with its id
 * column but without event_id. Embedded in the existing retry SELECT, this
 * probe adds zero statements to both healthy and legacy paths.
 *
 * The table name is a fixed constant; no user or provider input enters SQL.
 */
export const LEGACY_NOTIFICATION_EVENT_ID_SQL = `CASE
  WHEN EXISTS (
    SELECT 1 FROM pragma_table_info('notification_outbox') WHERE name = 'id'
  ) AND NOT EXISTS (
    SELECT 1 FROM pragma_table_info('notification_outbox') WHERE name = 'event_id'
  ) THEN 1 ELSE 0 END`;

export function isLegacyNotificationSchema(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    "legacy" in value && value.legacy === 1;
}
