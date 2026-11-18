import { parseVideoMemberSetSnapshot } from "./memberSetSnapshot.ts";
import { normalizeXId } from "@flamenode/domain/xid";
import { classifyAdminVideoMemberSave } from "@flamenode/domain/video/adminMemberSubmission";

type VideoMemberAuditPlan = {
  audits: ReadonlyArray<{ table_name: string; before?: unknown; after?: unknown }>;
};

export function extractPreviousPublicMemberXUserIdsFromMembersPlan(
  membersPlan: VideoMemberAuditPlan,
): string[] {
  const audit = membersPlan.audits.find(
    (entry) => entry.table_name === "video_members_set",
  );
  const snapshot = parseVideoMemberSetSnapshot(
    audit?.before as Record<string, unknown> | null | undefined,
  );
  if (!snapshot) return [];
  return [
    ...new Set(
      snapshot.rows
        .map((row) => normalizeXId(row.x_user_id ?? ""))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

/**
 * The member audit can be called directly by either runtime. If an explicit
 * snapshot is corrupt, treating it as "missing" would make the public fanout
 * fall back to raw (possibly aliased) submitted IDs or an empty old-member
 * set. Only intentionally omitted legacy pure-test snapshots may use that
 * compatibility fallback.
 */
function malformedExplicitFanoutSnapshot(snapshot: unknown): boolean {
  const parsed = parseVideoMemberSetSnapshot(
    snapshot as Record<string, unknown> | null | undefined,
  );
  if (!parsed || !snapshot || typeof snapshot !== "object" ||
      !("rows" in snapshot) || !Array.isArray(snapshot.rows)) return true;
  // parseVideoMemberSetSnapshot normalizes invalid optional x_user_id to null.
  // Do not lose a creator invalidation because an audited ID has the wrong type.
  return Array.from(snapshot.rows).some(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return true;
    const raw = row as Record<string, unknown>;
    return !("x_user_id" in raw) ||
      (raw.x_user_id !== null && typeof raw.x_user_id !== "string") ||
      raw.video_id !== parsed.id || raw.is_public_member !== 1;
  });
}

export function collectMemberAggregationAffectedXUserIds(args: {
  previousCreatorXUserId: string | null | undefined;
  nextCreatorXUserId: string | null | undefined;
  previousMemberXUserIds: readonly string[];
  nextMembers: ReadonlyArray<{ x_user_id: string }>;
}): Set<string> {
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => {
    const normalized = normalizeXId(id ?? "");
    if (normalized) ids.add(normalized);
  };
  const previousMembers = new Set(
    args.previousMemberXUserIds
      .map((id) => normalizeXId(id))
      .filter((id): id is string => Boolean(id)),
  );
  const nextMembers = new Set(
    args.nextMembers
      .map((member) => normalizeXId(member.x_user_id))
      .filter((id): id is string => Boolean(id)),
  );
  for (const id of previousMembers) {
    if (!nextMembers.has(id)) add(id);
  }
  for (const id of nextMembers) {
    if (!previousMembers.has(id)) add(id);
  }
  if (
    normalizeXId(args.previousCreatorXUserId ?? "") !==
    normalizeXId(args.nextCreatorXUserId ?? "")
  ) {
    add(args.previousCreatorXUserId);
    add(args.nextCreatorXUserId);
  }
  return ids;
}

/**
 * MIG-0650 U03s: compose the exact CURRENT SA-085 member/chapter audit flags,
 * collaboration metadata transition and public-user aggregate fanout.
 * This is pure: the authenticated host still owns CAS, audit, Queue, D1 and wake.
 */
export function deriveAdminVideoMemberSaveEffects(input: {
  membersPlan: VideoMemberAuditPlan & { statements: ReadonlyArray<unknown> };
  previousCollaborationType: string | null;
  members: ReadonlyArray<{ x_user_id: string }>;
  isCollab: boolean;
  isPublicVideo: boolean;
  creatorXUserId: string | null;
}): {
  nextCollaborationType: "collab" | "individual";
  videoPublicContentChanged: boolean;
  membersPlanChanged: boolean;
  affectedCreatorIds: Set<string>;
} {
  const hasMemberAudit = input.membersPlan.audits.some(
    audit => audit.table_name === "video_members_set",
  );
  const hasChapterAudit = input.membersPlan.audits.some(
    audit => audit.table_name === "video_chapters_member_set",
  );
  const { nextCollaborationType, videoPublicContentChanged } = classifyAdminVideoMemberSave({
    previousCollaborationType: input.previousCollaborationType,
    memberCount: input.members.length,
    isCollab: input.isCollab,
    hasMemberAudit,
    hasChapterAudit,
  });
  // X handles in a submitted form can be aliases. The member replacement
  // planner resolves them before writing, and its strict after-snapshot is
  // the authoritative set that the public user pages actually index.
  // Using the raw form here can omit the canonical creator page while
  // enqueuing an obsolete alias page instead. Both CURRENT and Hono consume
  // the same planner output, so preserve that canonical identity here.
  const memberAudit = hasMemberAudit
    ? input.membersPlan.audits.find(a => a.table_name === "video_members_set")
    : undefined;
  // Real CURRENT member-set writes always include complete before/after
  // snapshots. Explicitly malformed evidence must never be interpreted as an
  // absent snapshot, especially when aliases change canonical X IDs.
  if (input.isPublicVideo && memberAudit &&
      ((memberAudit.before !== undefined &&
        malformedExplicitFanoutSnapshot(memberAudit.before)) ||
       (memberAudit.after !== undefined &&
        malformedExplicitFanoutSnapshot(memberAudit.after)))) {
    throw new RangeError("video_member_fanout_invalid_audit_snapshot");
  }
  const afterSnapshot = parseVideoMemberSetSnapshot(
    memberAudit?.after as Record<string, unknown> | null | undefined,
  );
  const effectiveNextMembers = afterSnapshot
    ? afterSnapshot.rows.map(row => ({ x_user_id: row.x_user_id ?? "" }))
    : input.members;
  const affectedCreatorIds = input.isPublicVideo && hasMemberAudit
    ? collectMemberAggregationAffectedXUserIds({
        previousCreatorXUserId: input.creatorXUserId,
        nextCreatorXUserId: input.creatorXUserId,
        previousMemberXUserIds:
          extractPreviousPublicMemberXUserIdsFromMembersPlan(input.membersPlan),
        nextMembers: effectiveNextMembers,
      })
    : new Set<string>();
  return {
    nextCollaborationType,
    videoPublicContentChanged,
    membersPlanChanged: input.membersPlan.statements.length > 0,
    affectedCreatorIds,
  };
}
