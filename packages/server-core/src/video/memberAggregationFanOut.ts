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
