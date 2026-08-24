import "server-only";

import { eq, inArray, or, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  eventStaff,
  slotReservationGroups,
  slots,
  users,
  videoChapters,
  videoEvents,
  videoInteractions,
  videoMembers,
  videoModerationCases,
  videos,
  xIdentityRequests,
  xUserAccountLinks,
  xUserAliases,
  xUsers,
} from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import { buildStaticRebuildQueueBatch } from "@/lib/staticRebuild/enqueue";
import type { EnqueueStaticRebuildInput } from "@/lib/staticRebuild/types";
import {
  compensateXUserVisibilityOnD1Failure,
  planXUserVisibilityFenceTransition,
  preCommitXUserVisibilityTransition,
} from "./xUserVisibilityTransition";
import { buildEventStaffMergeAudits } from "./mergeAudits";
import { normalizeXId } from "@/lib/utils/xid";

export const X_ID_MERGE_REVERT_WINDOW_SECONDS = 7 * 24 * 60 * 60;

export type XIdMergeRestoreSnapshot = {
  version: 2;
  source_x_user_id: string;
  target_x_user_id: string;
  captured_at: number;
  source_x_user: typeof xUsers.$inferSelect;
  target_x_user: typeof xUsers.$inferSelect;
  active_users: Array<Pick<typeof users.$inferSelect, "id" | "active_x_user_id">>;
  account_links: Array<typeof xUserAccountLinks.$inferSelect>;
  videos: Array<typeof videos.$inferSelect>;
  video_chapters: Array<typeof videoChapters.$inferSelect>;
  /** Linked event IDs for affected videos; optional for pre-fanout snapshots. */
  video_event_links?: Array<typeof videoEvents.$inferSelect>;
  video_members: Array<typeof videoMembers.$inferSelect>;
  slots: Array<typeof slots.$inferSelect>;
  /** Reservation-group identity is an active reference and must follow the merge. */
  slot_reservation_groups?: Array<typeof slotReservationGroups.$inferSelect>;
  /** Moderation cases keep an X-ID relation for operator context. */
  video_moderation_cases?: Array<typeof videoModerationCases.$inferSelect>;
  video_interactions: Array<typeof videoInteractions.$inferSelect>;
  event_staff: Array<typeof eventStaff.$inferSelect>;
  aliases: Array<typeof xUserAliases.$inferSelect>;
};

export type XIdMergeExecutionResult = {
  counts: Record<string, number>;
  restoreSnapshotJson: string;
  revertDeadlineAt: number;
};

type MergeRequestRow = typeof xIdentityRequests.$inferSelect;

function parseSnapshot(raw: string): XIdMergeRestoreSnapshot {
  let parsed: Partial<XIdMergeRestoreSnapshot>;
  try {
    parsed = JSON.parse(raw) as Partial<XIdMergeRestoreSnapshot>;
  } catch {
    throw new Error("restore_snapshot_json をJSONとして解析できません。");
  }
  if (
    parsed.version !== 2 ||
    !parsed.source_x_user_id ||
    !parsed.target_x_user_id ||
    !parsed.source_x_user ||
    !parsed.target_x_user ||
    !Array.isArray(parsed.active_users) ||
    !Array.isArray(parsed.account_links) ||
    !Array.isArray(parsed.videos) ||
    !Array.isArray(parsed.video_chapters) ||
    !Array.isArray(parsed.video_members) ||
    !Array.isArray(parsed.slots) ||
    !Array.isArray(parsed.video_interactions) ||
    !Array.isArray(parsed.event_staff) ||
    !Array.isArray(parsed.aliases)
  ) {
    throw new Error("restore_snapshot_json の形式またはversionが不正です。");
  }
  return {
    ...(parsed as XIdMergeRestoreSnapshot),
    video_event_links: Array.isArray(parsed.video_event_links)
      ? (parsed.video_event_links as Array<typeof videoEvents.$inferSelect>)
      : [],
    slot_reservation_groups: Array.isArray(parsed.slot_reservation_groups)
      ? (parsed.slot_reservation_groups as Array<typeof slotReservationGroups.$inferSelect>)
      : [],
    video_moderation_cases: Array.isArray(parsed.video_moderation_cases)
      ? (parsed.video_moderation_cases as Array<typeof videoModerationCases.$inferSelect>)
      : [],
  };
}

function buildMergeStaticRebuildTargets(opts: {
  snapshot: XIdMergeRestoreSnapshot;
  sourceXUserId: string;
  targetXUserId: string;
  reason: string;
  requestedByUserId: string;
}): EnqueueStaticRebuildInput[] {
  const { snapshot } = opts;
  const targets: EnqueueStaticRebuildInput[] = [
    {
      targetType: "user",
      targetId: opts.sourceXUserId,
      reason: opts.reason,
      priority: "high",
      requestedByUserId: opts.requestedByUserId,
    },
    {
      targetType: "user",
      targetId: opts.targetXUserId,
      reason: opts.reason,
      priority: "normal",
      requestedByUserId: opts.requestedByUserId,
    },
    {
      targetType: "users_index",
      targetId: "global",
      reason: opts.reason,
      priority: "normal",
      requestedByUserId: opts.requestedByUserId,
    },
    // X ID統合はvideo_members / creator履歴 / x_user_aliasesを書き換えるため
    // member suggestions indexも必ず再生成する。
    {
      targetType: "member_suggestions",
      targetId: "global",
      reason: opts.reason,
      priority: "normal",
      requestedByUserId: opts.requestedByUserId,
    },
  ];

  const videoIds = new Set<string>();
  for (const row of snapshot.videos) videoIds.add(row.id);
  for (const row of snapshot.video_chapters) videoIds.add(row.video_id);
  for (const row of snapshot.video_members) videoIds.add(row.video_id);
  for (const row of snapshot.video_moderation_cases ?? []) videoIds.add(row.video_id);
  for (const row of snapshot.video_event_links ?? []) videoIds.add(row.video_id);

  const eventIds = new Set<string>();
  for (const row of snapshot.event_staff) eventIds.add(row.event_id);
  for (const row of snapshot.slots) eventIds.add(row.event_id);
  for (const row of snapshot.slot_reservation_groups ?? []) eventIds.add(row.event_id);
  for (const row of snapshot.videos) {
    if (row.primary_event_id) eventIds.add(row.primary_event_id);
  }
  for (const row of snapshot.video_event_links ?? []) eventIds.add(row.event_id);

  for (const videoId of videoIds) {
    targets.push({
      targetType: "video",
      targetId: videoId,
      reason: opts.reason,
      priority: "high",
      requestedByUserId: opts.requestedByUserId,
    });
  }
  for (const eventId of eventIds) {
    targets.push(
      {
        targetType: "event_base",
        targetId: eventId,
        reason: opts.reason,
        priority: "high",
        requestedByUserId: opts.requestedByUserId,
      },
      {
        targetType: "event_slots",
        targetId: eventId,
        reason: opts.reason,
        priority: "high",
        requestedByUserId: opts.requestedByUserId,
      },
      {
        targetType: "event_release",
        targetId: eventId,
        reason: opts.reason,
        priority: "high",
        requestedByUserId: opts.requestedByUserId,
      },
    );
  }

  // Video cards embed creator/member snapshots. Rebuild their global
  // projections as well; the section producers enqueue their composers after
  // the new source rows are available.
  if (videoIds.size > 0) {
    for (const targetType of [
      "random_video_pool",
      "list_recent",
      "list_popular",
      "search_index",
      "top_recommended",
      "top_latest",
      "top_nostalgic",
      "recommend_core",
    ] as const) {
      targets.push({
        targetType,
        targetId: "global",
        reason: opts.reason,
        priority: "low",
        requestedByUserId: opts.requestedByUserId,
      });
    }
  }

  return targets;
}

function assertMergeRequest(request: MergeRequestRow): {
  source: string;
  target: string;
} {
  if (request.request_type !== "merge" || request.status !== "approved") {
    throw new Error("承認済みの統合申請だけを実行できます。");
  }
  if (!request.source_x_user_id || !request.target_x_user_id) {
    throw new Error("統合元または統合先のX名義がありません。");
  }
  if (request.source_x_user_id === request.target_x_user_id) {
    throw new Error("統合元と統合先が同一です。");
  }
  return { source: request.source_x_user_id, target: request.target_x_user_id };
}

export async function captureXIdMergeRestoreSnapshot(
  db: DB,
  sourceXUserId: string,
  targetXUserId: string,
): Promise<XIdMergeRestoreSnapshot> {
  const [sourceRows, targetRows] = await Promise.all([
    db.select().from(xUsers).where(eq(xUsers.id, sourceXUserId)).limit(1),
    db.select().from(xUsers).where(eq(xUsers.id, targetXUserId)).limit(1),
  ]);
  const source = sourceRows[0];
  const target = targetRows[0];
  if (!source || !target) throw new Error("統合元または統合先のX名義が見つかりません。");
  if (source.approval_status === "rejected" || target.approval_status === "rejected") {
    throw new Error("無効化済みのX名義は統合できません。");
  }
  if (
    !["approved", "imported"].includes(source.approval_status ?? "") ||
    !["approved", "imported"].includes(target.approval_status ?? "")
  ) {
    throw new Error("統合元と統合先は承認済みのX名義である必要があります。");
  }

  const [activeUsers, accountLinks, creatorVideos, chapters, members, slotRows, reservationGroups, moderationCases, interactions, staffRows, aliases, videoEventLinks] =
    await Promise.all([
      db
        .select({ id: users.id, active_x_user_id: users.active_x_user_id })
        .from(users)
        .where(
          sql`lower(trim(ltrim(trim(${users.active_x_user_id}), '@'))) IN (lower(${sourceXUserId}), lower(${targetXUserId}))`,
        ),
      db
        .select()
        .from(xUserAccountLinks)
        .where(inArray(xUserAccountLinks.x_user_id, [sourceXUserId, targetXUserId])),
      db.select().from(videos).where(eq(videos.creator_x_user_id, sourceXUserId)),
      db.select().from(videoChapters).where(eq(videoChapters.x_user_id, sourceXUserId)),
      db.select().from(videoMembers).where(eq(videoMembers.x_user_id, sourceXUserId)),
      db
        .select()
        .from(slots)
        .where(
          or(
            eq(slots.x_user_id, sourceXUserId),
            sql`lower(trim(ltrim(trim(${slots.reserved_x_id_snapshot}), '@'))) = lower(${sourceXUserId})`,
          ),
        ),
      db.select().from(slotReservationGroups).where(eq(slotReservationGroups.x_user_id, sourceXUserId)),
      db.select().from(videoModerationCases).where(eq(videoModerationCases.related_x_user_id, sourceXUserId)),
      db
        .select()
        .from(videoInteractions)
        .where(inArray(videoInteractions.x_user_id, [sourceXUserId, targetXUserId])),
      db
        .select()
        .from(eventStaff)
        .where(inArray(eventStaff.x_user_id, [sourceXUserId, targetXUserId])),
      db
        .select()
        .from(xUserAliases)
        .where(
          or(
            inArray(xUserAliases.x_user_id, [sourceXUserId, targetXUserId]),
            inArray(xUserAliases.alias_x_id, [sourceXUserId, targetXUserId]),
          )!,
        ),
      db
        .select()
        .from(videoEvents)
        .where(sql`
          ${videoEvents.video_id} IN (
            SELECT id FROM videos WHERE creator_x_user_id = ${sourceXUserId}
            UNION
            SELECT video_id FROM video_chapters WHERE x_user_id = ${sourceXUserId}
            UNION
            SELECT video_id FROM video_members WHERE x_user_id = ${sourceXUserId}
            UNION
            SELECT video_id FROM slots
            WHERE video_id IS NOT NULL
              AND (
                x_user_id = ${sourceXUserId}
                OR lower(trim(ltrim(trim(reserved_x_id_snapshot), '@'))) = lower(${sourceXUserId})
              )
          )
        `),
    ]);

  return {
    version: 2,
    source_x_user_id: sourceXUserId,
    target_x_user_id: targetXUserId,
    captured_at: Math.floor(Date.now() / 1000),
    source_x_user: source,
    target_x_user: target,
    active_users: activeUsers,
    account_links: accountLinks,
    videos: creatorVideos,
    video_chapters: chapters,
    video_event_links: videoEventLinks,
    video_members: members,
    slots: slotRows,
    slot_reservation_groups: reservationGroups,
    video_moderation_cases: moderationCases,
    video_interactions: interactions,
    event_staff: staffRows,
    aliases,
  };
}

export async function executeApprovedXIdMergeRequest(
  db: DB,
  input: {
    request: MergeRequestRow;
    actorAuthUserId: string;
  },
): Promise<XIdMergeExecutionResult> {
  const { source, target } = assertMergeRequest(input.request);
  const snapshot = await captureXIdMergeRestoreSnapshot(db, source, target);
  const now = Math.floor(Date.now() / 1000);
  const restoreSnapshotJson = JSON.stringify(snapshot);
  const revertDeadlineAt = now + X_ID_MERGE_REVERT_WINDOW_SECONDS;

  const sourceStaff = snapshot.event_staff.filter((row) => row.x_user_id === source);
  const targetStaffByEvent = new Map(
    snapshot.event_staff
      .filter((row) => row.x_user_id === target)
      .map((row) => [row.event_id, row] as const),
  );
  const collidedStaff = sourceStaff.filter((row) => targetStaffByEvent.has(row.event_id));
  const promotedTargetStaff = collidedStaff
    .filter((row) => row.permission_preset === "owner")
    .map((row) => targetStaffByEvent.get(row.event_id)!)
    .filter((row) => row.permission_preset !== "owner");

  const sourceInteractions = snapshot.video_interactions.filter((row) => row.x_user_id === source);
  const targetInteractionKeys = new Set(
    snapshot.video_interactions
      .filter((row) => row.x_user_id === target)
      .map((row) => `${row.video_id}:${row.interaction_type}`),
  );
  const interactionCollisions = sourceInteractions.filter((row) =>
    targetInteractionKeys.has(`${row.video_id}:${row.interaction_type}`),
  );

  const sourceAliases = snapshot.aliases.filter((row) => row.x_user_id === source);
  const targetAliasIds = new Set(
    snapshot.aliases.filter((row) => row.x_user_id === target).map((row) => row.alias_x_id),
  );
  const aliasCollisions = sourceAliases.filter((row) => targetAliasIds.has(row.alias_x_id));
  const aliasPointingAtSource = snapshot.aliases.filter((row) => row.alias_x_id === source);
  const sourceLinks = snapshot.account_links.filter((row) => row.x_user_id === source);
  const activeSourceUsers = snapshot.active_users.filter(
    (row) => normalizeXId(row.active_x_user_id) === source,
  );

  const counts = {
    videos: snapshot.videos.length,
    video_chapters: snapshot.video_chapters.length,
    video_members: snapshot.video_members.length,
    slots: snapshot.slots.length,
    slot_reservation_groups: snapshot.slot_reservation_groups?.length ?? 0,
    video_moderation_cases: snapshot.video_moderation_cases?.length ?? 0,
    video_interactions: sourceInteractions.length,
    event_staff: sourceStaff.length,
    x_user_aliases: sourceAliases.length,
    x_user_account_links: sourceLinks.length,
    active_users: activeSourceUsers.length,
  };

  const statements = [
    db.run(sql`
      DELETE FROM video_interactions
      WHERE x_user_id = ${source}
        AND EXISTS (
          SELECT 1 FROM video_interactions target_row
          WHERE target_row.x_user_id = ${target}
            AND target_row.video_id = video_interactions.video_id
            AND target_row.interaction_type = video_interactions.interaction_type
        )
    `),
    db.run(sql`
      UPDATE event_staff
      SET permission_preset = 'owner', updated_at = ${now}
      WHERE x_user_id = ${target}
        AND EXISTS (
          SELECT 1 FROM event_staff source_row
          WHERE source_row.x_user_id = ${source}
            AND source_row.event_id = event_staff.event_id
            AND source_row.permission_preset = 'owner'
        )
        AND permission_preset <> 'owner'
    `),
    db.run(sql`
      DELETE FROM event_staff
      WHERE x_user_id = ${source}
        AND EXISTS (
          SELECT 1 FROM event_staff target_row
          WHERE target_row.x_user_id = ${target}
            AND target_row.event_id = event_staff.event_id
        )
    `),
    db.run(sql`DELETE FROM x_user_aliases WHERE alias_x_id = ${source}`),
    db.run(sql`
      DELETE FROM x_user_aliases
      WHERE x_user_id = ${source}
        AND EXISTS (
          SELECT 1 FROM x_user_aliases target_row
          WHERE target_row.x_user_id = ${target}
            AND target_row.alias_x_id = x_user_aliases.alias_x_id
        )
    `),
    db.run(sql`UPDATE videos SET creator_x_user_id = ${target}, updated_at = ${now} WHERE creator_x_user_id = ${source}`),
    db.run(sql`UPDATE video_chapters SET x_user_id = ${target}, updated_at = ${now} WHERE x_user_id = ${source}`),
    db.run(sql`UPDATE video_members SET x_user_id = ${target} WHERE x_user_id = ${source}`),
    db.run(sql`
      UPDATE slots
      SET x_user_id = CASE WHEN x_user_id = ${source} THEN ${target} ELSE x_user_id END,
          reserved_x_id_snapshot = CASE
            WHEN lower(trim(ltrim(trim(reserved_x_id_snapshot), '@'))) = lower(${source})
            THEN ${target}
            ELSE reserved_x_id_snapshot
          END,
          updated_at = ${now},
          version = version + 1
      WHERE x_user_id = ${source}
         OR lower(trim(ltrim(trim(reserved_x_id_snapshot), '@'))) = lower(${source})
    `),
    db.run(sql`UPDATE slot_reservation_groups SET x_user_id = ${target}, updated_at = ${now}, version = version + 1 WHERE x_user_id = ${source}`),
    db.run(sql`UPDATE video_moderation_cases SET related_x_user_id = ${target} WHERE related_x_user_id = ${source}`),
    db.run(sql`UPDATE video_interactions SET x_user_id = ${target} WHERE x_user_id = ${source}`),
    db.run(sql`UPDATE event_staff SET x_user_id = ${target}, updated_at = ${now} WHERE x_user_id = ${source}`),
    db.run(sql`UPDATE x_user_aliases SET x_user_id = ${target} WHERE x_user_id = ${source}`),
    db.run(sql`
      INSERT OR IGNORE INTO x_user_aliases (x_user_id, alias_x_id)
      VALUES (${target}, ${source})
    `),
    db.run(sql`
      INSERT INTO x_user_account_links (
        x_user_id, auth_user_id, link_role, created_by_request_id, created_at, updated_at
      )
      SELECT ${target}, auth_user_id, link_role, created_by_request_id, created_at, ${now}
      FROM x_user_account_links
      WHERE x_user_id = ${source}
      ON CONFLICT (x_user_id, auth_user_id) DO UPDATE SET
        link_role = CASE
          WHEN excluded.link_role = 'owner' OR x_user_account_links.link_role = 'owner'
          THEN 'owner' ELSE 'manager' END,
        created_by_request_id = COALESCE(
          x_user_account_links.created_by_request_id,
          excluded.created_by_request_id
        ),
        updated_at = excluded.updated_at
    `),
    db.run(sql`DELETE FROM x_user_account_links WHERE x_user_id = ${source}`),
    db.run(sql`
      UPDATE "user"
      SET active_x_user_id = ${target}
      WHERE lower(trim(ltrim(trim(active_x_user_id), '@'))) = lower(${source})
    `),
    db.run(sql`
      UPDATE x_users
      SET approval_status = 'rejected'
      WHERE id = ${source}
        AND approval_status IS ${snapshot.source_x_user.approval_status}
        AND EXISTS (
          SELECT 1 FROM x_users
          WHERE id = ${target}
            AND approval_status IS ${snapshot.target_x_user.approval_status}
        )
    `),
    db.run(sql`
      UPDATE x_identity_requests
      SET status = 'done',
          restore_snapshot_json = ${restoreSnapshotJson},
          revert_deadline_at = ${revertDeadlineAt},
          updated_at = ${now}
      WHERE id = ${input.request.id}
        AND request_type = 'merge'
        AND status = 'approved'
        AND updated_at = ${input.request.updated_at}
    `),
  ];

  const visibilityFence = await planXUserVisibilityFenceTransition({
    db,
    xUserId: source,
    previousStatus: snapshot.source_x_user.approval_status,
    nextStatus: "rejected",
    actorUserId: input.actorAuthUserId,
    reason: "x_id_merge_source_rejected",
    now,
  });
  const queue = await buildStaticRebuildQueueBatch(
    db,
    buildMergeStaticRebuildTargets({
      snapshot,
      sourceXUserId: source,
      targetXUserId: target,
      reason: "x_id_merge",
      requestedByUserId: input.actorAuthUserId,
    }),
  );
  const mutationStatements = [
    ...statements,
    ...visibilityFence.mutationStatements,
    ...queue.statements,
  ];

  const promotedTargetStaffIds = new Set(
    promotedTargetStaff.map((row) => row.id),
  );
  const eventStaffAfterRows = snapshot.event_staff.flatMap((row) => {
    if (row.x_user_id === source) {
      if (targetStaffByEvent.has(row.event_id)) return [];
      return [{ ...row, x_user_id: target, updated_at: now }];
    }
    if (row.x_user_id === target && promotedTargetStaffIds.has(row.id)) {
      return [{ ...row, permission_preset: "owner", updated_at: now }];
    }
    return [{ ...row }];
  });
  const eventStaffAudits = buildEventStaffMergeAudits({
    beforeRows: snapshot.event_staff,
    afterRows: eventStaffAfterRows,
    actorUserId: input.actorAuthUserId,
    fromXId: source,
    toXId: target,
  });

  try {
    if (visibilityFence.fenceToken) {
      await preCommitXUserVisibilityTransition({
        xUserId: source,
        fenceToken: visibilityFence.fenceToken,
        reason: "x_id_merge_source_rejected",
      });
    }
    await mutateWithAudit(db, {
      mutationStatements,
    expectedMutationChanges: [
      interactionCollisions.length,
      promotedTargetStaff.length,
      collidedStaff.length,
      aliasPointingAtSource.length,
      aliasCollisions.length,
      snapshot.videos.length,
      snapshot.video_chapters.length,
      snapshot.video_members.length,
      snapshot.slots.length,
      snapshot.slot_reservation_groups?.length ?? 0,
      snapshot.video_moderation_cases?.length ?? 0,
      sourceInteractions.length - interactionCollisions.length,
      sourceStaff.length - collidedStaff.length,
      sourceAliases.length - aliasCollisions.length,
      null,
      null,
      sourceLinks.length,
      activeSourceUsers.length,
      1,
      1,
      ...visibilityFence.expectedMutationChanges,
      ...queue.expectedChanges,
    ],
    audits: [
      ...eventStaffAudits,
      {
        table_name: "x_users",
        target_id: source,
        operation: "MERGE",
        before: {
          source_x_user: snapshot.source_x_user,
          target_x_user: snapshot.target_x_user,
          counts,
        },
        after: {
          source_x_user_id: source,
          merged_into_x_user_id: target,
          source_approval_status: "rejected",
          counts,
          collision_counts: {
            video_interactions: interactionCollisions.length,
            event_staff: collidedStaff.length,
            promoted_event_staff: promotedTargetStaff.length,
            x_user_aliases: aliasCollisions.length,
          },
        },
        actor_user_id: input.actorAuthUserId,
        reason: "承認済みX ID統合申請を原子的に実行",
        context: "x-id-merge",
        retention_class: "long_audit",
        restore_strategy: "none",
      },
      {
        table_name: "x_identity_requests",
        target_id: input.request.id,
        operation: "UPDATE",
        before: input.request,
        after: {
          ...input.request,
          status: "done",
          restore_snapshot_json: "[internal snapshot stored]",
          revert_deadline_at: revertDeadlineAt,
          updated_at: now,
        },
        actor_user_id: input.actorAuthUserId,
        reason: "統合完了・復元情報・差し戻し期限を同時保存",
        context: "x-id-merge:request",
        retention_class: "long_audit",
        restore_strategy: "none",
      },
      {
        table_name: "user",
        target_id: `active-x:${source}->${target}`,
        operation: "UPDATE",
        before: { users: activeSourceUsers },
        after: { active_x_user_id: target, count: activeSourceUsers.length },
        actor_user_id: input.actorAuthUserId,
        reason: "統合元を利用中のアクティブX名義を統合先へ更新",
        context: "x-id-merge:active-x",
        retention_class: "long_audit",
        restore_strategy: "none",
      },
    ],
      staticRebuildWakeSource: queue.statements.length > 0 ? "admin" : undefined,
    });
  } catch (error) {
    if (visibilityFence.fenceToken) {
      await compensateXUserVisibilityOnD1Failure({
        db,
        xUserId: source,
        fenceToken: visibilityFence.fenceToken,
      });
    }
    throw error;
  }

  return { counts, restoreSnapshotJson, revertDeadlineAt };
}

export async function restoreApprovedXIdMergeRevertRequest(
  db: DB,
  input: {
    request: MergeRequestRow;
    parentRequest: MergeRequestRow;
    actorAuthUserId: string;
  },
): Promise<Record<string, number>> {
  if (input.request.request_type !== "revert_merge") {
    throw new Error("差し戻し申請ではありません。");
  }
  if (input.request.status !== "pending" && input.request.status !== "approved") {
    throw new Error("この差し戻し申請は処理できません。");
  }
  if (input.parentRequest.request_type !== "merge" || input.parentRequest.status !== "done") {
    throw new Error("親統合申請が完了状態ではありません。");
  }
  if (input.request.parent_request_id !== input.parentRequest.id) {
    throw new Error("親統合申請が一致しません。");
  }
  if (!input.request.restore_snapshot_json || !input.request.revert_deadline_at) {
    throw new Error("差し戻しに必要な復元情報がありません。");
  }
  const now = Math.floor(Date.now() / 1000);
  if (input.request.revert_deadline_at < now) {
    throw new Error("統合の差し戻し期限を過ぎています。");
  }
  const snapshot = parseSnapshot(input.request.restore_snapshot_json);
  const source = snapshot.source_x_user_id;
  const target = snapshot.target_x_user_id;
  if (
    input.parentRequest.source_x_user_id !== source ||
    input.parentRequest.target_x_user_id !== target
  ) {
    throw new Error("親統合申請と復元snapshotのX名義が一致しません。");
  }
  const snapshotJson = JSON.stringify(snapshot);
  const activeSourceUsers = snapshot.active_users.filter(
    (row) => normalizeXId(row.active_x_user_id) === source,
  );

  const statements = [
    db.run(sql`
      UPDATE videos SET creator_x_user_id = ${source}
      WHERE creator_x_user_id = ${target}
        AND id IN (SELECT json_extract(value, '$.id') FROM json_each(${snapshotJson}, '$.videos'))
    `),
    db.run(sql`
      UPDATE video_chapters SET x_user_id = ${source}
      WHERE x_user_id = ${target}
        AND id IN (SELECT json_extract(value, '$.id') FROM json_each(${snapshotJson}, '$.video_chapters'))
    `),
    db.run(sql`
      UPDATE video_members SET x_user_id = ${source}
      WHERE x_user_id = ${target}
        AND id IN (SELECT json_extract(value, '$.id') FROM json_each(${snapshotJson}, '$.video_members'))
    `),
    db.run(sql`
      UPDATE slots SET
        x_user_id = (
          SELECT json_extract(value, '$.x_user_id')
          FROM json_each(${snapshotJson}, '$.slots')
          WHERE json_extract(value, '$.id') = slots.id
        ),
        reserved_x_id_snapshot = (
          SELECT json_extract(value, '$.reserved_x_id_snapshot')
          FROM json_each(${snapshotJson}, '$.slots')
          WHERE json_extract(value, '$.id') = slots.id
        )
      WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(${snapshotJson}, '$.slots'))
        AND (
          x_user_id = ${target}
          OR lower(trim(ltrim(trim(reserved_x_id_snapshot), '@'))) = lower(${target})
        )
    `),
    db.run(sql`
      UPDATE slot_reservation_groups SET x_user_id = ${source}, version = version + 1
      WHERE x_user_id = ${target}
        AND id IN (
          SELECT json_extract(value, '$.id')
          FROM json_each(${snapshotJson}, '$.slot_reservation_groups')
        )
    `),
    db.run(sql`
      UPDATE video_moderation_cases SET related_x_user_id = ${source}
      WHERE related_x_user_id = ${target}
        AND id IN (
          SELECT json_extract(value, '$.id')
          FROM json_each(${snapshotJson}, '$.video_moderation_cases')
        )
    `),
    db.run(sql`
      DELETE FROM video_interactions
      WHERE x_user_id IN (${source}, ${target})
        AND (video_id, interaction_type) IN (
          SELECT json_extract(value, '$.video_id'), json_extract(value, '$.interaction_type')
          FROM json_each(${snapshotJson}, '$.video_interactions')
        )
    `),
    db.run(sql`
      INSERT INTO video_interactions (x_user_id, video_id, interaction_type, created_at)
      SELECT
        json_extract(value, '$.x_user_id'),
        json_extract(value, '$.video_id'),
        json_extract(value, '$.interaction_type'),
        json_extract(value, '$.created_at')
      FROM json_each(${snapshotJson}, '$.video_interactions')
    `),
    db.run(sql`
      DELETE FROM event_staff
      WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(${snapshotJson}, '$.event_staff'))
         OR (x_user_id IN (${source}, ${target}) AND event_id IN (
           SELECT json_extract(value, '$.event_id') FROM json_each(${snapshotJson}, '$.event_staff')
         ))
    `),
    db.run(sql`
      INSERT INTO event_staff (
        id, event_id, x_user_id, display_name, permission_preset,
        custom_permission_keys_json, is_public, public_role_label,
        approved_by_auth_user_id, approved_at, created_at, updated_at
      )
      SELECT
        json_extract(value, '$.id'),
        json_extract(value, '$.event_id'),
        json_extract(value, '$.x_user_id'),
        json_extract(value, '$.display_name'),
        json_extract(value, '$.permission_preset'),
        json_extract(value, '$.custom_permission_keys_json'),
        json_extract(value, '$.is_public'),
        json_extract(value, '$.public_role_label'),
        json_extract(value, '$.approved_by_auth_user_id'),
        json_extract(value, '$.approved_at'),
        json_extract(value, '$.created_at'),
        json_extract(value, '$.updated_at')
      FROM json_each(${snapshotJson}, '$.event_staff')
    `),
    db.run(sql`
      DELETE FROM x_user_aliases
      WHERE x_user_id IN (${source}, ${target}) OR alias_x_id IN (${source}, ${target})
    `),
    db.run(sql`
      INSERT INTO x_user_aliases (x_user_id, alias_x_id)
      SELECT json_extract(value, '$.x_user_id'), json_extract(value, '$.alias_x_id')
      FROM json_each(${snapshotJson}, '$.aliases')
    `),
    db.run(sql`DELETE FROM x_user_account_links WHERE x_user_id IN (${source}, ${target})`),
    db.run(sql`
      INSERT INTO x_user_account_links (
        x_user_id, auth_user_id, link_role, created_by_request_id, created_at, updated_at
      )
      SELECT
        json_extract(value, '$.x_user_id'),
        json_extract(value, '$.auth_user_id'),
        json_extract(value, '$.link_role'),
        json_extract(value, '$.created_by_request_id'),
        json_extract(value, '$.created_at'),
        json_extract(value, '$.updated_at')
      FROM json_each(${snapshotJson}, '$.account_links')
    `),
    db.run(sql`
      UPDATE "user"
      SET active_x_user_id = (
        SELECT json_extract(value, '$.active_x_user_id')
        FROM json_each(${snapshotJson}, '$.active_users')
        WHERE json_extract(value, '$.id') = "user".id
      )
      WHERE active_x_user_id = ${target}
        AND id IN (SELECT json_extract(value, '$.id') FROM json_each(${snapshotJson}, '$.active_users'))
        AND id IN (
          SELECT json_extract(value, '$.id')
          FROM json_each(${snapshotJson}, '$.active_users')
          WHERE lower(trim(ltrim(trim(json_extract(value, '$.active_x_user_id')), '@'))) = lower(${source})
        )
    `),
    db.run(sql`
      UPDATE x_users
      SET approval_status = ${snapshot.source_x_user.approval_status}
      WHERE id = ${source}
        AND approval_status = 'rejected'
        AND EXISTS (
          SELECT 1 FROM x_users
          WHERE id = ${target}
            AND approval_status IS ${snapshot.target_x_user.approval_status}
        )
    `),
    db.run(sql`
      UPDATE x_identity_requests
      SET status = 'done', updated_at = ${now}
      WHERE id = ${input.request.id}
        AND request_type = 'revert_merge'
        AND status IN ('pending', 'approved')
        AND updated_at = ${input.request.updated_at}
    `),
    db.run(sql`
      UPDATE x_identity_requests
      SET revert_deadline_at = ${now}, updated_at = ${now}
      WHERE id = ${input.parentRequest.id}
        AND request_type = 'merge'
        AND status = 'done'
        AND updated_at = ${input.parentRequest.updated_at}
    `),
  ];

  const visibilityFence = await planXUserVisibilityFenceTransition({
    db,
    xUserId: source,
    previousStatus: "rejected",
    nextStatus: snapshot.source_x_user.approval_status,
    actorUserId: input.actorAuthUserId,
    reason: "x_id_merge_revert_source_restored",
    now,
  });
  const queue = await buildStaticRebuildQueueBatch(
    db,
    buildMergeStaticRebuildTargets({
      snapshot,
      sourceXUserId: source,
      targetXUserId: target,
      reason: "x_id_merge_revert",
      requestedByUserId: input.actorAuthUserId,
    }),
  );
  const mutationStatements = [
    ...statements,
    ...visibilityFence.mutationStatements,
    ...queue.statements,
  ];

  try {
    if (visibilityFence.fenceToken) {
      await preCommitXUserVisibilityTransition({
        xUserId: source,
        fenceToken: visibilityFence.fenceToken,
        reason: "x_id_merge_revert_source_restored",
      });
    }
    await mutateWithAudit(db, {
      mutationStatements,
    expectedMutationChanges: [
      snapshot.videos.length,
      snapshot.video_chapters.length,
      snapshot.video_members.length,
      snapshot.slots.length,
      snapshot.slot_reservation_groups?.length ?? 0,
      snapshot.video_moderation_cases?.length ?? 0,
      null,
      snapshot.video_interactions.length,
      null,
      snapshot.event_staff.length,
      null,
      snapshot.aliases.length,
      null,
      snapshot.account_links.length,
      activeSourceUsers.length,
      1,
      1,
      1,
      ...visibilityFence.expectedMutationChanges,
      ...queue.expectedChanges,
    ],
    audits: [
      {
        table_name: "x_users",
        target_id: source,
        operation: "RESTORE",
        before: { merged_into_x_user_id: target, approval_status: "rejected" },
        after: {
          source_x_user_id: source,
          target_x_user_id: target,
          approval_status: snapshot.source_x_user.approval_status,
          restored_from_snapshot_at: snapshot.captured_at,
        },
        actor_user_id: input.actorAuthUserId,
        reason: "X ID統合を期限内に原子的に差し戻し",
        context: "x-id-merge-revert",
        retention_class: "long_audit",
        restore_strategy: "none",
      },
      {
        table_name: "x_identity_requests",
        target_id: input.request.id,
        operation: "UPDATE",
        before: input.request,
        after: { ...input.request, status: "done", updated_at: now },
        actor_user_id: input.actorAuthUserId,
        reason: "X ID統合の差し戻し完了を同時保存",
        context: "x-id-merge-revert:request",
        retention_class: "long_audit",
        restore_strategy: "none",
      },
    ],
      staticRebuildWakeSource: queue.statements.length > 0 ? "admin" : undefined,
    });
  } catch (error) {
    if (visibilityFence.fenceToken) {
      await compensateXUserVisibilityOnD1Failure({
        db,
        xUserId: source,
        fenceToken: visibilityFence.fenceToken,
      });
    }
    throw error;
  }

  return {
    videos: snapshot.videos.length,
    video_chapters: snapshot.video_chapters.length,
    video_members: snapshot.video_members.length,
    slots: snapshot.slots.length,
    video_interactions: snapshot.video_interactions.length,
    event_staff: snapshot.event_staff.length,
    x_user_aliases: snapshot.aliases.length,
    x_user_account_links: snapshot.account_links.length,
    active_users: activeSourceUsers.length,
  };
}
