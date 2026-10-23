import { normalizeXId } from "./format.ts";

/**
 * X ID merge/revert relation-state planner (moved unchanged from
 * src/lib/xid/mergeSafety.ts). Pure data: the D1 CAS that compares rows with
 * these states stays in the CURRENT adapter (`xIdMergeStateMatchesSql`).
 */
type SnapshotRow = Record<string, unknown>;

export type XIdMergeSnapshotState = {
  x_users: SnapshotRow[];
  active_users: SnapshotRow[];
  account_links: SnapshotRow[];
  videos: SnapshotRow[];
  video_chapters: SnapshotRow[];
  video_members: SnapshotRow[];
  slots: SnapshotRow[];
  slot_reservation_groups: SnapshotRow[];
  video_moderation_cases: SnapshotRow[];
  video_interactions: SnapshotRow[];
  event_staff: SnapshotRow[];
  aliases: SnapshotRow[];
};

type SnapshotLike = {
  source_x_user: SnapshotRow;
  target_x_user: SnapshotRow;
  active_users: readonly SnapshotRow[];
  account_links: readonly SnapshotRow[];
  videos: readonly SnapshotRow[];
  video_chapters: readonly SnapshotRow[];
  video_members: readonly SnapshotRow[];
  slots: readonly SnapshotRow[];
  slot_reservation_groups?: readonly SnapshotRow[];
  video_moderation_cases?: readonly SnapshotRow[];
  video_interactions: readonly SnapshotRow[];
  event_staff: readonly SnapshotRow[];
  aliases: readonly SnapshotRow[];
};

function cloneRows(rows: readonly SnapshotRow[] | undefined): SnapshotRow[] {
  return (rows ?? []).map((row) => ({ ...row }));
}

function key(...parts: unknown[]): string {
  return parts.map((part) => String(part ?? "")).join("\u0000");
}

/** The exact relation set captured before a merge. */
export function buildXIdMergeBeforeState(
  snapshot: SnapshotLike,
): XIdMergeSnapshotState {
  return {
    x_users: [
      { id: snapshot.source_x_user.id, approval_status: snapshot.source_x_user.approval_status },
      { id: snapshot.target_x_user.id, approval_status: snapshot.target_x_user.approval_status },
    ],
    active_users: cloneRows(snapshot.active_users),
    account_links: cloneRows(snapshot.account_links),
    videos: cloneRows(snapshot.videos),
    video_chapters: cloneRows(snapshot.video_chapters),
    video_members: cloneRows(snapshot.video_members),
    slots: cloneRows(snapshot.slots),
    slot_reservation_groups: cloneRows(snapshot.slot_reservation_groups),
    video_moderation_cases: cloneRows(snapshot.video_moderation_cases),
    video_interactions: cloneRows(snapshot.video_interactions),
    event_staff: cloneRows(snapshot.event_staff),
    aliases: cloneRows(snapshot.aliases),
  };
}

/**
 * Build the relation set which the current merge SQL is allowed to produce.
 * The result is deliberately a data-only contract: both merge preconditions and
 * revert preconditions compare D1 rows with this exact set inside their batch.
 */
export function buildXIdMergeAfterState(
  snapshot: SnapshotLike,
  input: { sourceXUserId: string; targetXUserId: string; now: number },
): XIdMergeSnapshotState {
  const before = buildXIdMergeBeforeState(snapshot);
  const source = input.sourceXUserId;
  const target = input.targetXUserId;

  const sourceInteractions = before.video_interactions.filter(
    (row) => row.x_user_id === source,
  );
  const targetInteractionKeys = new Set(
    before.video_interactions
      .filter((row) => row.x_user_id === target)
      .map((row) => key(row.video_id, row.interaction_type)),
  );
  const video_interactions = before.video_interactions.flatMap((row) => {
    if (row.x_user_id !== source) return [{ ...row }];
    return targetInteractionKeys.has(key(row.video_id, row.interaction_type))
      ? []
      : [{ ...row, x_user_id: target }];
  });

  const targetStaffByEvent = new Map(
    before.event_staff
      .filter((row) => row.x_user_id === target)
      .map((row) => [String(row.event_id), row] as const),
  );
  const event_staff = before.event_staff.flatMap((row) => {
    if (row.x_user_id === source) {
      return targetStaffByEvent.has(String(row.event_id))
        ? []
        : [{ ...row, x_user_id: target, updated_at: input.now }];
    }
    if (
      row.x_user_id === target &&
      before.event_staff.some(
        (sourceRow) =>
          sourceRow.x_user_id === source &&
          sourceRow.event_id === row.event_id &&
          sourceRow.permission_preset === "owner",
      ) &&
      row.permission_preset !== "owner"
    ) {
      return [{ ...row, permission_preset: "owner", updated_at: input.now }];
    }
    return [{ ...row }];
  });

  const targetAliasIds = new Set(
    before.aliases
      .filter((row) => row.x_user_id === target)
      .map((row) => String(row.alias_x_id)),
  );
  const aliases: SnapshotRow[] = before.aliases
    .filter((row) => row.alias_x_id !== source)
    .filter(
      (row) =>
        !(
          row.x_user_id === source &&
          targetAliasIds.has(String(row.alias_x_id))
        ),
    )
    .map((row) =>
      row.x_user_id === source ? { ...row, x_user_id: target } : { ...row },
    );
  if (!aliases.some((row) => row.x_user_id === target && row.alias_x_id === source)) {
    aliases.push({ x_user_id: target, alias_x_id: source });
  }

  const targetLinks = new Map(
    before.account_links
      .filter((row) => row.x_user_id === target)
      .map((row) => [String(row.auth_user_id), { ...row }] as const),
  );
  for (const sourceLink of before.account_links.filter(
    (row) => row.x_user_id === source,
  )) {
    const authUserId = String(sourceLink.auth_user_id);
    const existing = targetLinks.get(authUserId);
    if (!existing) {
      targetLinks.set(authUserId, {
        ...sourceLink,
        x_user_id: target,
        updated_at: input.now,
      });
      continue;
    }
    targetLinks.set(authUserId, {
      ...existing,
      link_role:
        existing.link_role === "owner" || sourceLink.link_role === "owner"
          ? "owner"
          : "manager",
      created_by_request_id:
        existing.created_by_request_id ?? sourceLink.created_by_request_id ?? null,
      updated_at: input.now,
    });
  }

  const active_users = before.active_users.map((row) => ({
    ...row,
    active_x_user_id:
      normalizeXId(String(row.active_x_user_id ?? "")) === source
        ? target
        : row.active_x_user_id,
  }));

  return {
    x_users: [
      { id: source, approval_status: "rejected" },
      {
        id: snapshot.target_x_user.id,
        approval_status: snapshot.target_x_user.approval_status,
      },
    ],
    active_users,
    account_links: Array.from(targetLinks.values()),
    videos: before.videos.map((row) => ({
      ...row,
      creator_x_user_id: target,
      updated_at: input.now,
    })),
    video_chapters: before.video_chapters.map((row) => ({
      ...row,
      x_user_id: target,
      updated_at: input.now,
    })),
    video_members: before.video_members.map((row) => ({
      ...row,
      x_user_id: target,
    })),
    slots: before.slots.map((row) => ({
      ...row,
      x_user_id: row.x_user_id === source ? target : row.x_user_id,
      reserved_x_id_snapshot:
        normalizeXId(String(row.reserved_x_id_snapshot ?? "")) === source
          ? target
          : row.reserved_x_id_snapshot,
      updated_at: input.now,
      version: Number(row.version ?? 0) + 1,
    })),
    slot_reservation_groups: before.slot_reservation_groups.map((row) => ({
      ...row,
      x_user_id: target,
      updated_at: input.now,
      version: Number(row.version ?? 0) + 1,
    })),
    video_moderation_cases: before.video_moderation_cases.map((row) => ({
      ...row,
      related_x_user_id: target,
    })),
    video_interactions,
    event_staff,
    aliases,
  };
}
