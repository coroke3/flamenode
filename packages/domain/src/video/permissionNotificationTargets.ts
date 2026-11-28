/**
 * Pure SA-082..084 recipient selection, shared by CURRENT and future Hono.
 * Approval and notification opt-in filtering MUST already be enforced by the
 * D1 recipient loader. Never treat this function as authorization.
 */
export function selectVideoPermissionNotificationTargets(
  links: readonly { x_user_id: string; auth_user_id: string }[],
  actorUserId: string,
  videoId: string,
): Array<{ recipientUserId: string; dedupeKey: string }> {
  const targets = new Map<string, { recipientUserId: string; dedupeKey: string }>();
  for (const link of links) {
    if (link.auth_user_id === actorUserId) continue;
    const dedupeKey = `video_edit_permission_granted:${videoId}:x:${link.x_user_id}:user:${link.auth_user_id}`;
    targets.set(dedupeKey, { recipientUserId: link.auth_user_id, dedupeKey });
  }
  return [...targets.values()];
}
