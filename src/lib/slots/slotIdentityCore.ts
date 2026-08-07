import { normalizeXId } from "../utils/xid.ts";

export type SlotViewerRelation =
  | "active"
  | "unassigned"
  | "account_other"
  | "none";

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

export function canActAsSlotActor(relation: SlotViewerRelation): boolean {
  return relation === "active" || relation === "unassigned";
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
}): SlotGroupIdentityResult {
  const reservedDistinct = new Set(
    input.reservedByUserIds.map(normalizeReservedByUserId),
  );
  if (reservedDistinct.size > 1) {
    return { ok: false, reason: "mixed_auth_user" };
  }

  for (const reservedByUserId of input.reservedByUserIds) {
    if (normalizeReservedByUserId(reservedByUserId) !== input.authUserId) {
      return { ok: false, reason: "mixed_auth_user" };
    }
  }

  const slotXs = input.slotXUserIds.map(normalizeSlotXId);
  const nonNullSlotXs = slotXs.filter((slotX): slotX is string => slotX !== null);
  const distinctNonNull = new Set(nonNullSlotXs);
  const hasNullRows = slotXs.some((slotX) => slotX === null);
  const activeX = normalizeSlotXId(input.activeXId);

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
