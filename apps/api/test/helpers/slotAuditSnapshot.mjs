/** MIG-0656: Test-only equivalent of the canonical actor snapshot already fetched
 * by the parent write guard. Reading node:sqlite directly here models a
 * preloaded guard result: it does not consume a D1 pre-read in the handler.
 * Keep the exact five-field shape shared with audit/logger.ts; incomplete
 * {id,role} fixtures cause a real fallback D1 actor SELECT after #678.
 */
import {
  actorSnapshotFromRow,
  isValidPreloadedActorSnapshotJson,
} from "@flamenode/server-core/audit/logger";

export function canonicalSlotAuditSnapshotJson(sqlite, actorUserId) {
  const row = sqlite.prepare(
    'SELECT u.discord_id, u.name AS discord_name, u.active_x_user_id, '
    + 'u.image AS user_image, x.x_name, x.icon_url AS x_icon_url '
    + 'FROM "user" u LEFT JOIN x_users x ON x.id = u.active_x_user_id '
    + 'WHERE u.id = ? LIMIT 1',
  ).get(actorUserId);
  if (!row) throw new Error("missing_test_actor");
  const snapshot = JSON.stringify(actorSnapshotFromRow(row));
  if (!isValidPreloadedActorSnapshotJson(snapshot)) throw new Error("invalid_test_audit_snapshot");
  return snapshot;
}
