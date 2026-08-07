import type { VideoAtomicWritePlan } from "./atomicWritePlan.ts";
import type { MemberInput } from "./memberInputs.ts";
import { parseVideoMemberSetSnapshot } from "./memberSetSnapshot.ts";

export function extractPreviousPublicMemberXUserIdsFromMembersPlan(
  membersPlan: VideoAtomicWritePlan,
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
        .map((row) => row.x_user_id?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

export function collectMemberAggregationAffectedXUserIds(args: {
  previousCreatorXUserId: string | null | undefined;
  nextCreatorXUserId: string | null | undefined;
  previousMemberXUserIds: readonly string[];
  nextMembers: ReadonlyArray<Pick<MemberInput, "x_user_id">>;
}): Set<string> {
  const ids = new Set<string>();
  const add = (id: string | null | undefined) => {
    const trimmed = id?.trim();
    if (trimmed) ids.add(trimmed);
  };
  add(args.previousCreatorXUserId);
  add(args.nextCreatorXUserId);
  for (const id of args.previousMemberXUserIds) add(id);
  for (const member of args.nextMembers) add(member.x_user_id);
  return ids;
}
