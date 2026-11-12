import { parseVideoMemberSetSnapshot } from "./memberSetSnapshot.ts";
import { normalizeXId } from "@flamenode/domain/xid";

type VideoMemberAuditPlan = {
  audits: ReadonlyArray<{ table_name: string; before?: unknown }>;
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
