/**
 * MIG-0650 U03d-2e: CURRENT SA-085 permission carry precedence.
 *
 * This is a pure selection stage only. Identity resolution/validation remains
 * the caller's responsibility: do not infer trust in an alias or grant rights.
 * Hidden rows selected for cleanup are a separate, strictly scoped set.
 */
import { videoMembers } from "@flamenode/db/schema";
import { compareSqliteBinaryText } from "./memberSetSnapshot.ts";

type MemberRow = typeof videoMembers.$inferSelect;

export function selectVideoMemberPermissionCarry(
  carryRows: readonly MemberRow[],
  xIdSet: ReadonlySet<string>,
  canonicalIdentity: (raw: string | null | undefined) => string,
): {
  hiddenCarryRows: MemberRow[];
  permissionCarryByXId: Map<string, MemberRow>;
} {
  const hiddenCarryRows = carryRows.filter(
    (row) =>
      row.is_public_member === 0 &&
      Boolean(canonicalIdentity(row.x_user_id)) &&
      xIdSet.has(canonicalIdentity(row.x_user_id)),
  );

  const permissionCarryByXId = new Map<
    string,
    MemberRow
  >();
  for (const row of [...carryRows].sort(
    (left, right) =>
      right.can_edit - left.can_edit ||
      right.is_public_member - left.is_public_member ||
      compareSqliteBinaryText(left.id, right.id),
  )) {
    const xId = canonicalIdentity(row.x_user_id);
    if (xId && !permissionCarryByXId.has(xId)) {
      permissionCarryByXId.set(xId, row);
    }
  }

  return { hiddenCarryRows, permissionCarryByXId };
}
