import { normalizeXId } from "../utils/xid.ts";

export type SlotViewerRelation =
  | "active"
  | "unassigned"
  | "account_other"
  | "none";

/**
 * Relation used only while submitting a reserved slot.
 *
 * A reservation may be opened from a different Discord account when the
 * currently approved Active X ID is the same as the reservation snapshot.
 * Other slot operations continue to use SlotViewerRelation and remain bound
 * to the reserving auth account.
 */
export type SlotSubmissionRelation = SlotViewerRelation | "x_id_only";

function normalizeSlotXId(value: string | null | undefined): string | null {
  const normalized = normalizeXId(value);
  return normalized.length > 0 ? normalized : null;
}

export function resolveSlotViewerRelation(input: {
  reservedByUserId: string | null;
  slotXUserId: string | null;
  authUserId: string | null;
  activeXId: string | null;
}): SlotViewerRelation {
  if (!input.authUserId) return "none";
  if (input.reservedByUserId !== input.authUserId) return "none";

  const slotX = normalizeSlotXId(input.slotXUserId);
  const activeX = normalizeSlotXId(input.activeXId);

  if (slotX !== null && activeX !== null && slotX === activeX) return "active";
  if (slotX === null) return "unassigned";
  return "account_other";
}

export function resolveSlotSubmissionRelation(input: {
  reservedByUserId: string | null;
  slotXUserId: string | null;
  authUserId: string | null;
  activeXId: string | null;
}): SlotSubmissionRelation {
  if (!input.authUserId) return "none";

  const slotX = normalizeSlotXId(input.slotXUserId);
  const activeX = normalizeSlotXId(input.activeXId);
  if (
    slotX !== null &&
    activeX !== null &&
    slotX === activeX &&
    input.reservedByUserId !== input.authUserId &&
    Boolean(input.reservedByUserId?.trim())
  ) {
    return "x_id_only";
  }

  if (input.reservedByUserId !== input.authUserId) return "none";
  if (slotX !== null && activeX !== null && slotX === activeX) return "active";
  if (slotX === null) return "unassigned";
  return "account_other";
}

export function canActAsSlotActor(relation: SlotViewerRelation): boolean {
  return relation === "active" || relation === "unassigned";
}

export function canActAsSlotSubmitter(
  relation: SlotSubmissionRelation,
): boolean {
  return (
    relation === "active" ||
    relation === "unassigned" ||
    relation === "x_id_only"
  );
}

export type SlotGroupIdentityResult =
  | { ok: true; targetXId: string | null; adoptNullRows: boolean }
  | {
      ok: false;
      reason: "different_active_x" | "mixed_non_null_x" | "mixed_auth_user";
    };

function normalizeReservedByUserId(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveSlotGroupIdentity(input: {
  reservedByUserIds: readonly (string | null)[];
  slotXUserIds: readonly (string | null)[];
  authUserId: string;
  activeXId: string | null;
  /** Submission-only exception for a different Discord account with the same X ID. */
  allowAuthMismatchWhenXIdMatches?: boolean;
}): SlotGroupIdentityResult {
  const slotXs = input.slotXUserIds.map(normalizeSlotXId);
  const activeX = normalizeSlotXId(input.activeXId);
  const reservedDistinct = new Set(
    input.reservedByUserIds.map(normalizeReservedByUserId),
  );
  if (reservedDistinct.size > 1) {
    return { ok: false, reason: "mixed_auth_user" };
  }

  const allowAuthMismatch =
    input.allowAuthMismatchWhenXIdMatches === true &&
    activeX !== null &&
    slotXs.length > 0 &&
    input.reservedByUserIds.every(
      (reservedByUserId) => normalizeReservedByUserId(reservedByUserId) !== null,
    ) &&
    slotXs.every((slotX) => slotX !== null && slotX === activeX);
  for (const reservedByUserId of input.reservedByUserIds) {
    if (
      normalizeReservedByUserId(reservedByUserId) !== input.authUserId &&
      !allowAuthMismatch
    ) {
      return { ok: false, reason: "mixed_auth_user" };
    }
  }

  const nonNullSlotXs = slotXs.filter((slotX): slotX is string => slotX !== null);
  const distinctNonNull = new Set(nonNullSlotXs);
  const hasNullRows = slotXs.some((slotX) => slotX === null);

  if (distinctNonNull.size >= 2) {
    return { ok: false, reason: "mixed_non_null_x" };
  }

  if (distinctNonNull.size === 1) {
    const slotX = nonNullSlotXs[0]!;
    if (activeX === null || activeX !== slotX) {
      return { ok: false, reason: "different_active_x" };
    }
    return { ok: true, targetXId: slotX, adoptNullRows: hasNullRows };
  }

  if (activeX !== null) {
    return { ok: true, targetXId: activeX, adoptNullRows: true };
  }
  return { ok: true, targetXId: null, adoptNullRows: false };
}
