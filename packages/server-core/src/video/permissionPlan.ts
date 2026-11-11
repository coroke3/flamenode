import type { videoMembers, xUsers } from "@flamenode/db/schema";
import { compareSqliteBinaryText } from "./memberSetSnapshot.ts";

/**
 * SA-082..084: CPU-only change planner shared by CURRENT and Hono. This
 * must only run AFTER canonical alias resolution, rejected-X preflight and
 * bounded D1 member reads. Its output is not authorization: the caller must
 * enforce the same atomic D1 CAS, change counts, audit, outbox and Queue batch.
 */
type VideoMemberRow = typeof videoMembers.$inferSelect;
type Intent = { displayName: string; intent: "on" | "off" };

export function planVideoPermissionChanges(input: {
  intents: ReadonlyMap<string, Intent>;
  rowsByXid: ReadonlyMap<string, readonly VideoMemberRow[]>;
  existingProfileIds: ReadonlySet<string>;
  actorId: string;
  videoId: string;
  now: number;
  notify: boolean;
  makeMemberId: () => string;
  currentHiddenEditorCount: number;
}) {
  const { intents, rowsByXid, actorId, videoId, now, notify, makeMemberId, currentHiddenEditorCount } = input;
  const existingProfileIds = new Set(input.existingProfileIds);
  const updateRows: VideoMemberRow[] = [];
  const insertHiddenRows: VideoMemberRow[] = [];
  const deleteHiddenIds: string[] = [];
  const newXUsers: Array<typeof xUsers.$inferInsert> = [];
  const grantedNames: string[] = [];
  const revokedNames: string[] = [];
  const notifyXids: string[] = [];
  let unchanged = 0;
  let nextHiddenEditorCount = currentHiddenEditorCount;

  for (const [xid, intentInfo] of intents) {
    const label = `${intentInfo.displayName} @${xid}`;
    const rowsForXid = rowsByXid.get(xid) ?? [];
    const publicRows = rowsForXid.filter((row) => row.is_public_member === 1);
    const hiddenRows = rowsForXid.filter((row) => row.is_public_member === 0);
    const hadEffectiveEdit = rowsForXid.some((row) => row.can_edit === 1);

    if (intentInfo.intent === "on") {
      if (!existingProfileIds.has(xid)) {
        newXUsers.push({
          id: xid,
          x_name: intentInfo.displayName || `@${xid}`,
          icon_url: null,
          profile_text: null,
          portfolio_contact: null,
          youtube_channel_url: null,
          other_social_links: null,
          creative_start_date: null,
          approval_status: "pending",
        });
        existingProfileIds.add(xid);
      }

      if (publicRows.length > 0) {
        const permissionSource = [...rowsForXid].sort(
          (left, right) =>
            right.can_edit - left.can_edit ||
            Number(right.edit_updated_at ?? 0) - Number(left.edit_updated_at ?? 0) ||
            compareSqliteBinaryText(left.id, right.id),
        )[0]!;

        for (const target of publicRows) {
          if (target.can_edit === 1) continue;
          updateRows.push({
            ...target,
            can_edit: 1,
            edit_granted_by_auth_user_id:
              permissionSource.can_edit === 1
                ? permissionSource.edit_granted_by_auth_user_id
                : actorId,
            edit_granted_at:
              permissionSource.can_edit === 1 && permissionSource.edit_granted_at != null
                ? permissionSource.edit_granted_at
                : now,
            edit_updated_at: now,
          });
        }
        for (const hidden of hiddenRows) {
          deleteHiddenIds.push(hidden.id);
          nextHiddenEditorCount -= 1;
        }
      } else if (hiddenRows.length > 0) {
        const target = hiddenRows[0]!;
        if (target.can_edit !== 1) {
          updateRows.push({
            ...target,
            can_edit: 1,
            edit_granted_by_auth_user_id: actorId,
            edit_granted_at: target.edit_granted_at ?? now,
            edit_updated_at: now,
          });
        }
        for (const duplicate of hiddenRows.slice(1)) {
          deleteHiddenIds.push(duplicate.id);
          nextHiddenEditorCount -= 1;
        }
      } else {
        insertHiddenRows.push({
          id: makeMemberId(),
          video_id: videoId,
          x_user_id: xid,
          name: intentInfo.displayName || `@${xid}`,
          role: null,
          comment: null,
          order_index: 9999,
          can_edit: 1,
          is_public_member: 0,
          edit_granted_by_auth_user_id: actorId,
          edit_granted_at: now,
          edit_updated_at: now,
        });
        nextHiddenEditorCount += 1;
      }

      if (hadEffectiveEdit) {
        unchanged += 1;
      } else {
        grantedNames.push(label);
        if (notify) notifyXids.push(xid);
      }
      continue;
    }

    for (const row of publicRows) {
      if (row.can_edit !== 1) continue;
      updateRows.push({ ...row, can_edit: 0, edit_updated_at: now });
    }
    for (const hidden of hiddenRows) {
      deleteHiddenIds.push(hidden.id);
      nextHiddenEditorCount -= 1;
    }
    if (hadEffectiveEdit) revokedNames.push(label);
    else unchanged += 1;
  }

  return {
    updateRows, insertHiddenRows, deleteHiddenIds, newXUsers,
    grantedNames, revokedNames, notifyXids, unchanged, nextHiddenEditorCount,
  };
}
