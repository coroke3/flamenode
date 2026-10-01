import { normalizeXId } from "../utils/xid.ts";

export type CanonicalAliasResolutionRow = {
  alias_x_id: string | null;
  /** Canonical x_users.id obtained by joining the alias target. */
  target_x_user_id: string | null;
  target_approval_status: string | null;
};

export type CanonicalDirectResolutionRow = {
  id: string;
  approval_status: string | null;
};

export type CanonicalXUserResolutionReason =
  | "empty"
  | "not_found"
  | "rejected_or_invalid"
  | "invalid_alias_target"
  | "ambiguous_alias"
  | "canonical_alias_collision"
  | "resolved_alias"
  | "resolved_canonical";

export type CanonicalXUserResolution = {
  value: string | null;
  reason: CanonicalXUserResolutionReason;
};

/** Only lifecycle states represented by the canonical schema are resolvable. */
export function isUsableCanonicalXUserStatus(
  approvalStatus: string | null | undefined,
): boolean {
  return (
    approvalStatus === "pending" ||
    approvalStatus === "approved" ||
    approvalStatus === "imported"
  );
}

/**
 * Fail-closed identity policy shared by web and Worker callers. A rejected
 * direct row may intentionally be an old merged identity, so a valid alias
 * can resolve it; a live canonical ID and a different alias target cannot.
 */
export function decideCanonicalXUserResolution(input: {
  candidate: string | null | undefined;
  aliases: readonly CanonicalAliasResolutionRow[];
  directRows: readonly CanonicalDirectResolutionRow[];
}): CanonicalXUserResolution {
  const candidate = normalizeXId(input.candidate);
  if (!candidate) return { value: null, reason: "empty" };

  const directRows = input.directRows.filter(
    (row) => normalizeXId(row.id) === candidate,
  );
  const directIds = new Set(directRows.map((row) => normalizeXId(row.id)));
  if (directIds.size > 1 || directRows.length > 1) {
    return { value: null, reason: "canonical_alias_collision" };
  }
  const direct = directRows[0] ?? null;

  const aliases = input.aliases.filter(
    (row) => normalizeXId(row.alias_x_id) === candidate,
  );
  if (aliases.length > 0) {
    if (
      aliases.some(
        (row) =>
          !normalizeXId(row.target_x_user_id) ||
          !isUsableCanonicalXUserStatus(row.target_approval_status),
      )
    ) {
      return { value: null, reason: "invalid_alias_target" };
    }
    const targets = new Set(
      aliases
        .map((row) => normalizeXId(row.target_x_user_id))
        .filter((value): value is string => Boolean(value)),
    );
    if (targets.size !== 1) {
      return { value: null, reason: "ambiguous_alias" };
    }
    const target = Array.from(targets)[0]!;
    if (
      direct &&
      isUsableCanonicalXUserStatus(direct.approval_status) &&
      normalizeXId(direct.id) !== target
    ) {
      return { value: null, reason: "canonical_alias_collision" };
    }
    return { value: target, reason: "resolved_alias" };
  }

  if (!direct) return { value: null, reason: "not_found" };
  if (!isUsableCanonicalXUserStatus(direct.approval_status)) {
    return { value: null, reason: "rejected_or_invalid" };
  }
  return {
    value: normalizeXId(direct.id),
    reason: "resolved_canonical",
  };
}
