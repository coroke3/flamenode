import "server-only";

import { eq, inArray, or, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  eventStaff,
  slots,
  videoChapters,
  videoInteractions,
  videoMembers,
  videos,
  xUserAccountLinks,
  xUserAliases,
  xUsers,
} from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";

export const X_ID_MERGE_REVERT_WINDOW_SECONDS = 7 * 24 * 60 * 60;

export type XIdMergeRestoreSnapshot = {
  version: 1;
  source_x_user_id: string;
  target_x_user_id: string;
  captured_at: number;
  source_x_user: typeof xUsers.$inferSelect;
  target_x_user: typeof xUsers.$inferSelect;
  account_links: Array<typeof xUserAccountLinks.$inferSelect>;
  videos: Array<typeof videos.$inferSelect>;
  video_chapters: Array<typeof videoChapters.$inferSelect>;
  video_members: Array<typeof videoMembers.$inferSelect>;
  slots: Array<typeof slots.$inferSelect>;
  video_interactions: Array<typeof videoInteractions.$inferSelect>;
  event_staff: Array<typeof eventStaff.$inferSelect>;
  aliases: Array<typeof xUserAliases.$inferSelect>;
};

export type XIdMergeExecutionResult = {
  counts: Record<string, number>;
  restoreSnapshotJson: string;
  revertDeadlineAt: number;
};

function parseSnapshot(raw: string): XIdMergeRestoreSnapshot {
  const parsed = JSON.parse(raw) as Partial<XIdMergeRestoreSnapshot>;
  if (
    parsed.version !== 1 ||
    !parsed.source_x_user_id ||
    !parsed.target_x_user_id ||
    !Array.isArray(parsed.account_links) ||
    !Array.isArray(parsed.videos) ||
    !Array.isArray(parsed.video_chapters) ||
    !Array.isArray(parsed.video_members) ||
    !Array.isArray(parsed.slots) ||
    !Array.isArray(parsed.video_interactions) ||
    !Array.isArray(parsed.event_staff) ||
    !Array.isArray(parsed.aliases)
  ) {
    throw new Error("restore_snapshot_json の形式が不正です。");
  }
  return parsed as XIdMergeRestoreSnapshot;
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
  if (!source || !target) throw new Error("統合元または統合先の X ID が見つかりません。");

  const [accountLinks, creatorVideos, chapters, members, slotRows, interactions, staffRows, aliases] =
    await Promise.all([
      db
        .select()
        .from(xUserAccountLinks)
        .where(inArray(xUserAccountLinks.x_user_id, [sourceXUserId, targetXUserId])),
      db.select().from(videos).where(eq(videos.creator_x_user_id, sourceXUserId)),
      db.select().from(videoChapters).where(eq(videoChapters.x_user_id, sourceXUserId)),
      db.select().from(videoMembers).where(eq(videoMembers.x_user_id, sourceXUserId)),
      db.select().from(slots).where(eq(slots.x_user_id, sourceXUserId)),
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
    ]);

  return {
    version: 1,
    source_x_user_id: sourceXUserId,
    target_x_user_id: targetXUserId,
    captured_at: Math.floor(Date.now() / 1000),
    source_x_user: source,
    target_x_user: target,
    account_links: accountLinks,
    videos: creatorVideos,
    video_chapters: chapters,
    video_members: members,
    slots: slotRows,
    video_interactions: interactions,
    event_staff: staffRows,
    aliases,
  };
}

export async function executeXIdMerge(
  db: DB,
  input: {
    sourceXUserId: string;
    targetXUserId: string;
    actorAuthUserId: string;
  },
): Promise<XIdMergeExecutionResult> {
  const snapshot = await captureXIdMergeRestoreSnapshot(
    db,
    input.sourceXUserId,
    input.targetXUserId,
  );
  const source = input.sourceXUserId;
  const target = input.targetXUserId;
  const now = Math.floor(Date.now() / 1000);

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

  const counts = {
    videos: snapshot.videos.length,
    video_chapters: snapshot.video_chapters.length,
    video_members: snapshot.video_members.length,
    slots: snapshot.slots.length,
    video_interactions: sourceInteractions.length,
    event_staff: sourceStaff.length,
    x_user_aliases: sourceAliases.length,
    x_user_account_links: sourceLinks.length,
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
    db.run(sql`UPDATE videos SET creator_x_user_id = ${target} WHERE creator_x_user_id = ${source}`),
    db.run(sql`UPDATE video_chapters SET x_user_id = ${target} WHERE x_user_id = ${source}`),
    db.run(sql`UPDATE video_members SET x_user_id = ${target} WHERE x_user_id = ${source}`),
    db.run(sql`UPDATE slots SET x_user_id = ${target} WHERE x_user_id = ${source}`),
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
  ];

  await mutateWithAudit(db, {
    mutationStatements: statements,
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
      sourceInteractions.length - interactionCollisions.length,
      sourceStaff.length - collidedStaff.length,
      sourceAliases.length - aliasCollisions.length,
      null,
      null,
      sourceLinks.length,
    ],
    audits: [
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
          counts,
          collision_counts: {
            video_interactions: interactionCollisions.length,
            event_staff: collidedStaff.length,
            promoted_event_staff: promotedTargetStaff.length,
            x_user_aliases: aliasCollisions.length,
          },
        },
        actor_user_id: input.actorAuthUserId,
        reason: "管理者による X ID 統合",
        context: "x-id-merge",
        retention_class: "long_audit",
        restore_strategy: "none",
      },
      {
        table_name: "x_user_account_links",
        target_id: `${source}->${target}`,
        operation: "MERGE",
        before: { account_links: snapshot.account_links },
        after: { source_x_user_id: source, target_x_user_id: target },
        actor_user_id: input.actorAuthUserId,
        reason: "X名義統合に伴う認証ユーザーリンク移行",
        context: "x-id-merge:account-links",
        retention_class: "long_audit",
        restore_strategy: "none",
      },
    ],
  });

  return {
    counts,
    restoreSnapshotJson: JSON.stringify(snapshot),
    revertDeadlineAt: now + X_ID_MERGE_REVERT_WINDOW_SECONDS,
  };
}

export async function restoreXIdMerge(
  db: DB,
  input: {
    restoreSnapshotJson: string;
    actorAuthUserId: string;
  },
): Promise<Record<string, number>> {
  const snapshot = parseSnapshot(input.restoreSnapshotJson);
  const source = snapshot.source_x_user_id;
  const target = snapshot.target_x_user_id;
  const snapshotJson = JSON.stringify(snapshot);

  const statements = [
    db.run(sql`
      UPDATE videos SET creator_x_user_id = ${source}
      WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(${snapshotJson}, '$.videos'))
    `),
    db.run(sql`
      UPDATE video_chapters SET x_user_id = ${source}
      WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(${snapshotJson}, '$.video_chapters'))
    `),
    db.run(sql`
      UPDATE video_members SET x_user_id = ${source}
      WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(${snapshotJson}, '$.video_members'))
    `),
    db.run(sql`
      UPDATE slots SET x_user_id = ${source}
      WHERE id IN (SELECT json_extract(value, '$.id') FROM json_each(${snapshotJson}, '$.slots'))
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
      INSERT OR REPLACE INTO video_interactions
        (x_user_id, video_id, interaction_type, created_at)
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
      INSERT OR IGNORE INTO x_user_aliases (x_user_id, alias_x_id)
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
  ];

  await mutateWithAudit(db, {
    mutationStatements: statements,
    expectedMutationChanges: statements.map(() => null),
    audits: [
      {
        table_name: "x_users",
        target_id: source,
        operation: "RESTORE",
        before: { merged_into_x_user_id: target },
        after: {
          source_x_user_id: source,
          target_x_user_id: target,
          restored_from_snapshot_at: snapshot.captured_at,
        },
        actor_user_id: input.actorAuthUserId,
        reason: "X ID統合の期限内差し戻し",
        context: "x-id-merge-revert",
        retention_class: "long_audit",
        restore_strategy: "none",
      },
    ],
  });

  return {
    videos: snapshot.videos.length,
    video_chapters: snapshot.video_chapters.length,
    video_members: snapshot.video_members.length,
    slots: snapshot.slots.length,
    video_interactions: snapshot.video_interactions.length,
    event_staff: snapshot.event_staff.length,
    x_user_aliases: snapshot.aliases.length,
    x_user_account_links: snapshot.account_links.length,
  };
}
