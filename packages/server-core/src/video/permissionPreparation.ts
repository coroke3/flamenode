import { prepareCollaboratorPermissionIntents, type CollaboratorPermissionIntent } from "@flamenode/domain/video";
import { normalizeXId } from "@flamenode/domain/xid";
import { MAX_COLLABORATOR_PERMISSION_BATCH } from "@flamenode/domain/video/atomicLimits";
import type { ServerCoreDb } from "../db.ts";
import { canonicalizePermissionIntents } from "./permissionCanonicalize.ts";
import { loadPermissionMembersRead } from "./permissionMembersRead.ts";
import { loadPermissionGrantProfiles } from "./permissionProfiles.ts";
import { evaluatePermissionPlanPreflight, planVideoPermissionChanges } from "./permissionPlan.ts";

/**
 * Shared, non-authorizing SA-082..084 preflight for CURRENT and future Hono.
 * The host MUST authenticate and authorize video.permissions before calling.
 * Nothing is written here; callers must commit the later DML, audit, notices
 * and static rebuild queue as one strict atomic transaction.
 */
export async function preparePermissionWrite(
  db: ServerCoreDb,
  input: {
    videoId: string;
    actorId: string;
    intents: readonly CollaboratorPermissionIntent[];
    notify: boolean;
    now: number;
    makeMemberId: () => string;
  },
) {
  // Enforce the request cap before alias canonicalization can read D1.
  // The post-alias domain guard remains a second boundary for direct callers.
  if (input.intents.length > MAX_COLLABORATOR_PERMISSION_BATCH) {
    return { kind: "error" as const, message: "権限指定が多すぎます。" };
  }
  const canonicalIntents = await canonicalizePermissionIntents(db, input.intents);
  const prepared = prepareCollaboratorPermissionIntents(canonicalIntents);
  if (!prepared.ok) return { kind: "error" as const, message: prepared.message };
  const intents = prepared.intents;
  const xids = Array.from(intents.keys());
  if (xids.length === 0) {
    return {
      kind: "terminal" as const,
      result: { ok: true as const, message: "変更対象がありません。", granted: [], revoked: [], unchanged: 0 },
    };
  }

  const membersRead = await loadPermissionMembersRead(db, input.videoId, xids);
  if (!membersRead.ok) return { kind: "error" as const, message: membersRead.message };
  const { existingRows, rowsByXid, currentHiddenEditorCount } = membersRead;

  const grantXids = xids.filter((xid) => intents.get(xid)?.intent === "on");
  const existingProfiles = await loadPermissionGrantProfiles(db, grantXids);
  const rejectedProfileIds = existingProfiles
    .filter((row) => row.approval_status === "rejected")
    .map((row) => normalizeXId(row.id));
  if (rejectedProfileIds.length > 0) {
    return {
      kind: "error" as const,
      message: `拒否済みの X ID には編集権限を付与できません: ${rejectedProfileIds.map((xid) => `@${xid}`).join("、")}`,
    };
  }
  const existingProfileIds = new Set(existingProfiles.map((row) => normalizeXId(row.id)));
  const plan = planVideoPermissionChanges({
    intents, rowsByXid, existingProfileIds,
    actorId: input.actorId, videoId: input.videoId, now: input.now,
    notify: input.notify, makeMemberId: input.makeMemberId, currentHiddenEditorCount,
  });
  const decision = evaluatePermissionPlanPreflight(plan);
  if (decision.kind !== "write_required") {
    return { kind: "terminal" as const, result: decision.result };
  }
  return {
    kind: "write_required" as const,
    xids, existingRows, currentHiddenEditorCount, plan,
  };
}
