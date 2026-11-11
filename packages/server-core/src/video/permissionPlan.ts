import type { videoMembers, xUsers } from "@flamenode/db/schema";
import { MAX_VIDEO_HIDDEN_EDITORS } from "@flamenode/domain/video/atomicLimits";
import { compareSqliteBinaryText, toVideoMemberSnapshotRow } from "./memberSetSnapshot.ts";

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

/**
 * Enforce CURRENT's post-plan net hidden editor limit and no-op response.
 * A caller may return a terminal result immediately; otherwise it must run
 * the complete atomic permission/audit/outbox/rebuild batch.
 */
export function evaluatePermissionPlanPreflight(
  plan: ReturnType<typeof planVideoPermissionChanges>,
):
  | { kind: "limit_exceeded"; result: { ok: false; message: string } }
  | { kind: "no_changes"; result: {
      ok: true; message: string; granted: string[]; revoked: string[]; unchanged: number;
    } }
  | { kind: "write_required" } {
  if (
    plan.insertHiddenRows.length > 0 &&
    plan.nextHiddenEditorCount > MAX_VIDEO_HIDDEN_EDITORS
  ) {
    return {
      kind: "limit_exceeded",
      result: {
        ok: false,
        message: `非公開編集者は最大${MAX_VIDEO_HIDDEN_EDITORS}人です。これ以上編集権を付与できません。`,
      },
    };
  }
  if (
    plan.updateRows.length === 0 &&
    plan.insertHiddenRows.length === 0 &&
    plan.deleteHiddenIds.length === 0 &&
    plan.newXUsers.length === 0
  ) {
    return {
      kind: "no_changes",
      result: {
        ok: true,
        message: `編集権限を反映しました（付与 0 / 解除 0 / 変更なし ${plan.unchanged}）`,
        granted: [],
        revoked: [],
        unchanged: plan.unchanged,
      },
    };
  }
  return { kind: "write_required" };
}

/**
 * SA-082..084 exact strict audit payloads. Unlike the public member-set
 * snapshot, CURRENT permission audit sorts by SQLite BINARY member ID alone
 * and serializes the Drizzle logical column order. Do not use order_index.
 */
export function buildPermissionMemberAuditSnapshots(
  videoId: string,
  existingRows: readonly VideoMemberRow[],
  plan: Pick<ReturnType<typeof planVideoPermissionChanges>,
    "updateRows" | "deleteHiddenIds" | "insertHiddenRows">,
) {
  const afterById = new Map(existingRows.map((row) => [row.id, row]));
  for (const row of plan.updateRows) afterById.set(row.id, row);
  for (const id of plan.deleteHiddenIds) afterById.delete(id);
  for (const row of plan.insertHiddenRows) afterById.set(row.id, row);
  const snapshot = (rows: readonly VideoMemberRow[]) => ({
    id: videoId,
    rows: [...rows]
      .sort((left, right) => compareSqliteBinaryText(left.id, right.id))
      .map(toVideoMemberSnapshotRow),
  });
  return {
    before: snapshot(existingRows),
    after: snapshot([...afterById.values()]),
  };
}
