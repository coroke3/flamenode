/**
 * applyLegacyImportPlan: 正規化済みプランを D1 に書き込む。
 *
 * DB canonical ルール準拠:
 * - events: 廃止フラグ列に書かない (visibility_status のみ)
 * - videos: 廃止列に書かない (video_softwares テーブルを使用)
 * - event_staff: permission_preset のみ (bitmask 不使用)
 * - x_users: approval_status = "imported"
 * - 監査ログ: audit_logs テーブルのみ
 * - バッチ記録: legacy_import_batches + legacy_import_batch_items
 */

import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DB } from "@/lib/db/client";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { mutateWithAudit } from "@/lib/audit/mutate";
import {
  eventCustomQuestions,
  eventStaff,
  events,
  legacyImportBatchItems,
  legacyImportBatches,
  slots,
  softwareAliases,
  softwareCatalog,
  videoCustomAnswers,
  videoEvents,
  videoMembers,
  videoSoftwares,
  videoYoutubeMetadata,
  videos,
  users,
  xUsers,
} from "@/lib/db/schema";
import { buildReplaceEventStaffWithProtection } from "@/lib/event/eventOwnership";
import { generateId } from "@/lib/utils/id";
import {
  buildVideoMemberBulkInsertSql,
  buildVideoMemberSetGuardSql,
  buildVideoMemberSetSnapshot,
} from "@/lib/video/memberSetSnapshot";
import {
  MAX_D1_AUDIT_ENTRIES,
  MAX_D1_AUDIT_PAYLOAD_BYTES,
  MAX_D1_BATCH_STATEMENTS,
  MAX_IN_CLAUSE,
} from "./constants";
import { stableSha256 } from "./hash";
import type {
  CanonicalVideo,
  CanonicalXUser,
  DryRunResult,
  ImportStrategy,
  LegacyImportPlan,
} from "./types";

export interface ApplyOptions {
  strategy: ImportStrategy;
  importMode: string;
  enqueueStaticRebuild: boolean;
  batchId: string;
  fileHash: string;
  planHash: string;
  /** preview claim 時に発行した lease。apply 本体はこの値を持つ実行だけを受け付ける。 */
  leaseToken: string;
  fileNamesJson?: string;
  fileCount: number;
}

export interface ApplyResult {
  ok: boolean;
  message: string;
  counts: DryRunResult["counts"];
  errors: string[];
  batchId: string;
}
/** 実行した管理者を作品投稿者にしないための、ログイン不能な移行専用 principal。 */
const LEGACY_IMPORT_SYSTEM_USER_ID = "system_legacy_import";

function chunked<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function stringifyError(e: unknown): string {
  if (e instanceof Error) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

async function fetchImportedIds(db: DB, ids: string[]): Promise<Set<string>> {
  const imported = new Set<string>();
  for (const chunk of chunked(ids, MAX_IN_CLAUSE)) {
    const rows = await db
      .select({ target_id: legacyImportBatchItems.target_id })
      .from(legacyImportBatchItems)
      .where(inArray(legacyImportBatchItems.target_id, chunk));
    for (const r of rows) imported.add(r.target_id);
  }
  return imported;
}

async function fetchExistingIds<T extends { id: string }>(
  db: DB,
  table: { id: { name: string } },
  ids: string[],
  selector: (db: DB, chunk: string[]) => Promise<{ id: string }[]>,
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (const chunk of chunked(ids, MAX_IN_CLAUSE)) {
    const rows = await selector(db, chunk);
    for (const r of rows) existing.add(r.id);
  }
  return existing;
}
function normalizeSoftwareName(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function legacySoftwareCatalogId(normalizedName: string): string {
  const slug = normalizedName.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return `sw_imp_${slug || "unknown"}`;
}

type LegacyXUserAtomicWork = {
  mutationStatements: BatchItem<"sqlite">[];
  expectedMutationChanges: Array<number | null>;
  audits: WriteAuditLogInput[];
  createdIds: string[];
};

/**
 * canonical X user の新規作成を親 mutation と同じ D1 batch に積む。
 * 既存 X ID は更新しない。競合が起きた場合は changes() assertion で batch 全体を rollback する。
 */
function buildLegacyXUserAtomicWork(args: {
  db: DB;
  xUsersById: ReadonlyMap<
    string,
    CanonicalXUser
  >;
  referencedIds: Iterable<
    string | null | undefined
  >;
  existingXIds: ReadonlySet<string>;
  actorUserId: string;
  now: number;
  auditTargetId: string;
}): LegacyXUserAtomicWork {
  const requestedIds = [
    ...new Set(
      Array.from(
        args.referencedIds,
        (id) => id?.toLowerCase() ?? "",
      ).filter(Boolean),
    ),
  ].sort();

  const rows: Array<Record<string, unknown>> = [];

  for (const id of requestedIds) {
    if (args.existingXIds.has(id)) continue;

    const xUser = args.xUsersById.get(id);
    if (!xUser) {
      throw new Error(
        `Referenced X ID is missing from the canonical import plan: ${id}`,
      );
    }

    rows.push({
      id: xUser.id,
      x_name: xUser.x_name,
      icon_url: null,
      profile_text: xUser.profile_text,
      portfolio_contact:
        xUser.portfolio_contact,
      youtube_channel_url:
        xUser.youtube_channel_url,
      other_social_links:
        xUser.other_social_links,
      creative_start_date: null,
      linked_user_id: null,
      verification_token: null,
      token_expires_at: null,
      approval_status: "imported",
      approval_requested_at: args.now,
    });
  }

  if (rows.length === 0) {
    return {
      mutationStatements: [],
      expectedMutationChanges: [],
      audits: [],
      createdIds: [],
    };
  }

  const payload = JSON.stringify(rows);

  return {
    mutationStatements: [
      args.db.run(sql`
        INSERT INTO x_users (
          id,
          x_name,
          icon_url,
          profile_text,
          portfolio_contact,
          youtube_channel_url,
          other_social_links,
          creative_start_date,
          linked_user_id,
          verification_token,
          token_expires_at,
          approval_status,
          approval_requested_at
        )
        SELECT
          json_extract(value, '$.id'),
          json_extract(value, '$.x_name'),
          json_extract(value, '$.icon_url'),
          json_extract(value, '$.profile_text'),
          json_extract(value, '$.portfolio_contact'),
          json_extract(value, '$.youtube_channel_url'),
          json_extract(value, '$.other_social_links'),
          json_extract(value, '$.creative_start_date'),
          json_extract(value, '$.linked_user_id'),
          json_extract(value, '$.verification_token'),
          json_extract(value, '$.token_expires_at'),
          json_extract(value, '$.approval_status'),
          json_extract(value, '$.approval_requested_at')
        FROM json_each(${payload})
      `),
    ],
    expectedMutationChanges: [rows.length],
    audits: [
      {
        table_name: "x_users_import_batch",
        target_id: args.auditTargetId,
        operation: "CREATE",
        before: null,
        after: {
          id: args.auditTargetId,
          rows,
        },
        actor_user_id: args.actorUserId,
        reason: "legacy_import",
        context: "legacy_import",
        retention_class: "long_audit",
        restore_strategy: "none",
        strict: true,
      },
    ],
    createdIds: rows.map((row) =>
      String(row.id),
    ),
  };
}

function buildLegacyVideoSnapshot(
  video: CanonicalVideo,
  existing: typeof videos.$inferSelect | null,
  now: number,
): typeof videos.$inferSelect {
  if (existing) {
    return {
      ...existing,
      primary_event_id: video.primary_event_id,
      creator_x_user_id: video.creator_x_user_id,
      submitted_by_user_id: LEGACY_IMPORT_SYSTEM_USER_ID,
      collaboration_type: video.collaboration_type,
      part: null,
      source_type: video.source_type,
      creator_display_name: video.creator_display_name,
      creator_display_name_yomi: video.creator_display_name_yomi,
      creator_icon_url: video.creator_icon_url,
      creator_youtube_channel_url: null,
      title: video.title,
      music: video.music,
      credit: video.credit,
      music_reference_url: video.music_reference_url,
      closing_comment: video.closing_comment,
      youtube_video_id: video.youtube_video_id,
      intro_comment: video.intro_comment,
      highlights: video.highlights,
      production_story: null,
      visibility_status: video.visibility_status,
      scheduling_type: video.scheduling_type,
      scheduled_time: video.scheduled_time,
      updated_at: now,
    };
  }
  return {
    id: video.id,
    primary_event_id: video.primary_event_id,
    creator_x_user_id: video.creator_x_user_id,
    submitted_by_user_id: LEGACY_IMPORT_SYSTEM_USER_ID,
    collaboration_type: video.collaboration_type,
    part: null,
    source_type: video.source_type,
    creator_display_name: video.creator_display_name,
    creator_display_name_yomi: video.creator_display_name_yomi,
    creator_icon_url: video.creator_icon_url,
    creator_youtube_channel_url: null,
    title: video.title,
    music: video.music,
    credit: video.credit,
    music_reference_url: video.music_reference_url,
    closing_comment: video.closing_comment,
    youtube_video_id: video.youtube_video_id,
    intro_comment: video.intro_comment,
    highlights: video.highlights,
    production_story: null,
    visibility_status: video.visibility_status,
    scheduling_type: video.scheduling_type,
    scheduled_time: video.scheduled_time,
    app_like_count: 0,
    score: 0,
    score_updated_at: null,
    created_at: video.created_at ?? now,
    updated_at: now,
  };
}

type LegacyVideoAtomicResult = {
  createdXIds: string[];
  memberCount: number;
  eventIds: string[];
  mutationStatements: BatchItem<"sqlite">[];
  expectedMutationChanges: Array<number | null>;
  audits: WriteAuditLogInput[];
};

type LegacyVideoBeforeRows = {
  members: Array<typeof videoMembers.$inferSelect>;
  events: Array<typeof videoEvents.$inferSelect>;
  answers: Array<typeof videoCustomAnswers.$inferSelect>;
  metadata: Array<typeof videoYoutubeMetadata.$inferSelect>;
  softwares: Array<typeof videoSoftwares.$inferSelect>;
  slots: Array<typeof slots.$inferSelect>;
};

/**
 * 作品本体と replace 型の関連行を単一の D1 batch に閉じ込める。
 * legacy import はこの入口以外から videos / members / relations を変更しない。
 */
async function buildLegacyVideoAtomicWork(args: {
  db: DB;
  video: CanonicalVideo;
  existing: typeof videos.$inferSelect | null;
  members: readonly LegacyImportPlan["videoMembers"][number][];
  eventRows: readonly LegacyImportPlan["videoEvents"][number][];
  answers: readonly LegacyImportPlan["videoCustomAnswers"][number][];
  softwareLabels: readonly string[];
  xUsersById: ReadonlyMap<string, CanonicalXUser>;
  existingXIds: ReadonlySet<string>;
  actorUserId: string;
  batchId: string;
  now: number;
  beforeRows: LegacyVideoBeforeRows;
}): Promise<LegacyVideoAtomicResult> {
  const afterVideo = buildLegacyVideoSnapshot(args.video, args.existing, args.now);
  const beforeMembers = args.existing
    ? args.beforeRows.members
        .filter(
          (member) =>
            member.is_public_member === 1,
        )
        .sort(
          (left, right) =>
            left.order_index -
              right.order_index ||
            left.id.localeCompare(right.id),
        )
    : [];
  const beforeEventRows = args.existing ? args.beforeRows.events : [];
  const beforeAnswers = args.existing ? args.beforeRows.answers : [];
  const beforeMetadataRows = args.existing ? args.beforeRows.metadata : [];
  const beforeSoftwareRows = args.existing ? args.beforeRows.softwares : [];
  const beforeSlots = args.existing ? args.beforeRows.slots : [];

  const legacySlotId = `slot_imp_${args.video.id}`;
  if (beforeSlots.some((slot) => slot.id !== legacySlotId)) {
    throw new Error("replace_imported cannot replace a video with non-legacy slots.");
  }
  if (
    afterVideo.scheduling_type === "slotted" &&
    (!afterVideo.primary_event_id || afterVideo.scheduled_time === null)
  ) {
    throw new Error("Slotted legacy video requires primary_event_id and scheduled_time.");
  }

  const afterMembers: Array<typeof videoMembers.$inferSelect> = args.members.map((member) => ({
    id: member.id,
    video_id: member.video_id,
    x_user_id: member.x_user_id,
    name: member.name,
    role: member.role,
    comment: null,
    order_index: member.order_index,
    user_id: null,
    can_edit: 0,
    is_public_member: 1,
    edit_granted_by_user_id: null,
    edit_granted_at: null,
    edit_updated_at: null,
    chapters_json: member.chapters_json,
  }));
  const afterAnswers: Array<typeof videoCustomAnswers.$inferSelect> = args.answers.map((answer) => ({
    video_id: answer.video_id,
    event_id: answer.event_id,
    question_id: answer.question_id,
    answer_text: answer.answer_text,
    answer_json: null,
    created_at: args.now,
    updated_at: args.now,
  }));
  const afterMetadata: typeof videoYoutubeMetadata.$inferSelect | null =
    afterVideo.youtube_video_id
      ? {
          video_id: afterVideo.id,
          youtube_video_id: afterVideo.youtube_video_id,
          youtube_privacy_status: null,
          youtube_availability_status: null,
          duration_seconds: null,
          view_count: 0,
          synced_at: null,
          sync_status: "pending",
          sync_error: null,
          updated_at: args.now,
        }
      : null;
  const afterSlot: typeof slots.$inferSelect | null =
    afterVideo.scheduling_type === "slotted"
      ? {
          id: legacySlotId,
          event_id: afterVideo.primary_event_id!,
          reserved_by_user_id: LEGACY_IMPORT_SYSTEM_USER_ID,
          x_user_id: afterVideo.creator_x_user_id,
          display_name: afterVideo.creator_display_name,
          slot_kind: "time",
          slot_label: null,
          start_time: afterVideo.scheduled_time,
          sort_order: 0,
          reservation_group_id: null,
          priority_reclaim_video_id: null,
          priority_reclaim_until: null,
          video_id: afterVideo.id,
          status: "submitted",
          updated_at: args.now,
          version: 1,
        }
      : null;
  const labels = [...new Set(args.softwareLabels.map((label) => label.trim()).filter(Boolean))];
  const xUserWork = buildLegacyXUserAtomicWork({
    db: args.db,
    xUsersById: args.xUsersById,
    referencedIds: [
      afterVideo.creator_x_user_id,
      ...afterMembers.map((member) => member.x_user_id),
    ],
    existingXIds: args.existingXIds,
    actorUserId: args.actorUserId,
    now: args.now,
    auditTargetId: `video:${args.video.id}`,
  });

  const mutationStatements: BatchItem<"sqlite">[] = [...xUserWork.mutationStatements];
  const expectedMutationChanges: Array<number | null> = [
    ...xUserWork.expectedMutationChanges,
  ];
  const audits: WriteAuditLogInput[] = [...xUserWork.audits];
  const append = (statement: BatchItem<"sqlite">, expected: number | null = null) => {
    mutationStatements.push(statement);
    expectedMutationChanges.push(expected);
  };
  const auditRelation = (
    tableName: string,
    beforeRows: readonly unknown[],
    afterRows: readonly unknown[],
  ) => {
    if (!args.existing && afterRows.length === 0) return;
    if (args.existing && beforeRows.length === 0 && afterRows.length === 0) return;
    audits.push({
      table_name: tableName,
      target_id: args.video.id,
      operation: args.existing ? "MERGE" : "CREATE",
      before: args.existing ? { rows: beforeRows } : null,
      after: { rows: afterRows },
      actor_user_id: args.actorUserId,
      reason: "legacy_import",
      context: "legacy_import",
      retention_class: "long_audit",
      restore_strategy: "none",
      strict: true,
    });
  };

  // The technical principal is created in the same batch as the imported video.
  append(args.db.run(sql`
    INSERT OR IGNORE INTO "user" (id, name, role, can_create_events, is_notification_enabled)
    VALUES (
      ${LEGACY_IMPORT_SYSTEM_USER_ID}, 'Legacy import system', 'user', 0, 0
    )
  `));
  if (args.existing) {
    append(args.db.run(sql`
      UPDATE videos
      SET primary_event_id = ${afterVideo.primary_event_id},
          creator_x_user_id = ${afterVideo.creator_x_user_id},
          submitted_by_user_id = ${afterVideo.submitted_by_user_id},
          collaboration_type = ${afterVideo.collaboration_type}, part = ${afterVideo.part},
          source_type = ${afterVideo.source_type},
          creator_display_name = ${afterVideo.creator_display_name},
          creator_display_name_yomi = ${afterVideo.creator_display_name_yomi},
          creator_icon_url = ${afterVideo.creator_icon_url},
          creator_youtube_channel_url = ${afterVideo.creator_youtube_channel_url},
          title = ${afterVideo.title}, music = ${afterVideo.music}, credit = ${afterVideo.credit},
          music_reference_url = ${afterVideo.music_reference_url},
          closing_comment = ${afterVideo.closing_comment},
          youtube_video_id = ${afterVideo.youtube_video_id}, intro_comment = ${afterVideo.intro_comment},
          highlights = ${afterVideo.highlights}, production_story = ${afterVideo.production_story},
          visibility_status = ${afterVideo.visibility_status},
          scheduling_type = ${afterVideo.scheduling_type}, scheduled_time = ${afterVideo.scheduled_time},
          updated_at = ${afterVideo.updated_at}
      WHERE id = ${afterVideo.id} AND updated_at = ${args.existing.updated_at}
    `), 1);
  } else {
    append(args.db.run(sql`
      INSERT INTO videos (
        id, primary_event_id, creator_x_user_id, submitted_by_user_id, collaboration_type,
        part, source_type, creator_display_name, creator_display_name_yomi, creator_icon_url,
        creator_youtube_channel_url, title, music, credit, music_reference_url, closing_comment,
        youtube_video_id, intro_comment, highlights, production_story, visibility_status,
        scheduling_type, scheduled_time, app_like_count, score, score_updated_at, created_at, updated_at
      ) VALUES (
        ${afterVideo.id}, ${afterVideo.primary_event_id}, ${afterVideo.creator_x_user_id},
        ${afterVideo.submitted_by_user_id}, ${afterVideo.collaboration_type}, ${afterVideo.part},
        ${afterVideo.source_type}, ${afterVideo.creator_display_name},
        ${afterVideo.creator_display_name_yomi}, ${afterVideo.creator_icon_url},
        ${afterVideo.creator_youtube_channel_url}, ${afterVideo.title}, ${afterVideo.music},
        ${afterVideo.credit}, ${afterVideo.music_reference_url}, ${afterVideo.closing_comment},
        ${afterVideo.youtube_video_id}, ${afterVideo.intro_comment}, ${afterVideo.highlights},
        ${afterVideo.production_story}, ${afterVideo.visibility_status}, ${afterVideo.scheduling_type},
        ${afterVideo.scheduled_time}, ${afterVideo.app_like_count}, ${afterVideo.score},
        ${afterVideo.score_updated_at}, ${afterVideo.created_at}, ${afterVideo.updated_at}
      )
    `));
  }
  audits.push({
    table_name: "videos",
    target_id: afterVideo.id,
    operation: args.existing ? "UPDATE" : "CREATE",
    before: args.existing,
    after: afterVideo,
    actor_user_id: args.actorUserId,
    reason: "legacy_import",
    context: "legacy_import",
    retention_class: "long_audit",
    restore_strategy: args.existing ? "update_before" : "delete_created",
    strict: true,
  });

  const beforeMemberSnapshot =
    buildVideoMemberSetSnapshot(
      args.video.id,
      beforeMembers,
    );

  const afterMemberSnapshot =
    buildVideoMemberSetSnapshot(
      args.video.id,
      afterMembers,
    );

  append(
    args.db.run(
      buildVideoMemberSetGuardSql(
        args.video.id,
        beforeMemberSnapshot.rows,
      ),
    ),
    null,
  );

  if (beforeMembers.length > 0) {
    append(
      args.db.run(sql`
        DELETE FROM video_members
        WHERE video_id = ${args.video.id}
          AND is_public_member = 1
      `),
      beforeMembers.length,
    );
  }

  if (afterMemberSnapshot.rows.length > 0) {
    append(
      args.db.run(
        buildVideoMemberBulkInsertSql(
          afterMemberSnapshot.rows,
        ),
      ),
      afterMemberSnapshot.rows.length,
    );
  }

  audits.push({
    table_name: "video_members_set",
    target_id: args.video.id,
    operation: args.existing
      ? "MERGE"
      : "CREATE",
    before: beforeMemberSnapshot,
    after: afterMemberSnapshot,
    actor_user_id: args.actorUserId,
    reason: "legacy_import",
    context: "legacy_import",
    retention_class: "restorable",
    restore_strategy: "custom_adapter",
    strict: true,
  });

  if (beforeEventRows.length > 0) append(args.db.run(sql`DELETE FROM video_events WHERE video_id = ${args.video.id}`), beforeEventRows.length);
  for (const relation of args.eventRows) {
    append(args.db.run(sql`
      INSERT INTO video_events (video_id, event_id)
      VALUES (${relation.video_id}, ${relation.event_id})
    `));
  }
  auditRelation("video_events", beforeEventRows, args.eventRows);

  if (beforeAnswers.length > 0) append(args.db.run(sql`DELETE FROM video_custom_answers WHERE video_id = ${args.video.id}`), beforeAnswers.length);
  for (const answer of afterAnswers) {
    append(args.db.run(sql`
      INSERT INTO video_custom_answers (
        video_id, event_id, question_id, answer_text, answer_json, created_at, updated_at
      ) VALUES (
        ${answer.video_id}, ${answer.event_id}, ${answer.question_id}, ${answer.answer_text},
        ${answer.answer_json}, ${answer.created_at}, ${answer.updated_at}
      )
    `));
  }
  auditRelation("video_custom_answers", beforeAnswers, afterAnswers);

  if (beforeSoftwareRows.length > 0) append(args.db.run(sql`DELETE FROM video_softwares WHERE video_id = ${args.video.id}`), beforeSoftwareRows.length);
  for (const [orderIndex, label] of labels.entries()) {
    const normalizedName = normalizeSoftwareName(label);
    const candidateId = legacySoftwareCatalogId(normalizedName);
    append(args.db.run(sql`
      INSERT OR IGNORE INTO software_catalog (id, name, normalized_name)
      SELECT ${candidateId}, ${label}, ${normalizedName}
      WHERE NOT EXISTS (
        SELECT 1 FROM software_aliases WHERE normalized_alias = ${normalizedName}
      )
    `));
    append(args.db.run(sql`
      INSERT INTO video_softwares (video_id, software_id, raw_label, order_index)
      SELECT
        ${args.video.id},
        COALESCE(
          (SELECT software_id FROM software_aliases WHERE normalized_alias = ${normalizedName}),
          (SELECT id FROM software_catalog WHERE normalized_name = ${normalizedName})
        ),
        ${label}, ${orderIndex}
      WHERE COALESCE(
        (SELECT software_id FROM software_aliases WHERE normalized_alias = ${normalizedName}),
        (SELECT id FROM software_catalog WHERE normalized_name = ${normalizedName})
      ) IS NOT NULL
    `), 1);
  }
  auditRelation(
    "video_softwares",
    beforeSoftwareRows,
    labels.map((raw_label, order_index) => ({ video_id: args.video.id, raw_label, order_index })),
  );

  if (beforeMetadataRows.length > 0) append(args.db.run(sql`DELETE FROM video_youtube_metadata WHERE video_id = ${args.video.id}`), beforeMetadataRows.length);
  if (afterMetadata) {
    append(args.db.run(sql`
      INSERT INTO video_youtube_metadata (
        video_id, youtube_video_id, youtube_privacy_status, youtube_availability_status,
        duration_seconds, view_count, synced_at, sync_status, sync_error, updated_at
      ) VALUES (
        ${afterMetadata.video_id}, ${afterMetadata.youtube_video_id},
        ${afterMetadata.youtube_privacy_status}, ${afterMetadata.youtube_availability_status},
        ${afterMetadata.duration_seconds}, ${afterMetadata.view_count}, ${afterMetadata.synced_at},
        ${afterMetadata.sync_status}, ${afterMetadata.sync_error}, ${afterMetadata.updated_at}
      )
    `));
  }
  auditRelation("video_youtube_metadata", beforeMetadataRows, afterMetadata ? [afterMetadata] : []);

  if (beforeSlots.length > 0) append(args.db.run(sql`DELETE FROM slots WHERE video_id = ${args.video.id}`), beforeSlots.length);
  if (afterSlot) {
    append(args.db.run(sql`
      INSERT INTO slots (
        id, event_id, reserved_by_user_id, x_user_id, display_name, slot_kind, slot_label,
        start_time, sort_order, reservation_group_id, priority_reclaim_video_id,
        priority_reclaim_until, video_id, status, updated_at, version
      ) VALUES (
        ${afterSlot.id}, ${afterSlot.event_id}, ${afterSlot.reserved_by_user_id},
        ${afterSlot.x_user_id}, ${afterSlot.display_name}, ${afterSlot.slot_kind},
        ${afterSlot.slot_label}, ${afterSlot.start_time}, ${afterSlot.sort_order},
        ${afterSlot.reservation_group_id}, ${afterSlot.priority_reclaim_video_id},
        ${afterSlot.priority_reclaim_until}, ${afterSlot.video_id}, ${afterSlot.status},
        ${afterSlot.updated_at}, ${afterSlot.version}
      )
    `));
  }
  auditRelation("slots", beforeSlots, afterSlot ? [afterSlot] : []);

  append(args.db.run(sql`
    INSERT OR IGNORE INTO legacy_import_batch_items (
      batch_id, target_table, target_id, action, source_key, status, warning_count, created_at
    ) VALUES (
      ${args.batchId}, 'videos', ${args.video.id}, ${args.existing ? "replace" : "create"},
      NULL, 'ok', 0, ${args.now}
    )
  `));

  return {
    createdXIds: xUserWork.createdIds,
    memberCount: afterMembers.length,
    eventIds: [...new Set(args.eventRows.map((relation) => relation.event_id))],
    mutationStatements,
    expectedMutationChanges,
    audits,
  };
}

export async function applyLegacyImportPlan(
  db: DB,
  requestPlan: LegacyImportPlan,
  options: ApplyOptions,
  operatorId: string,
): Promise<ApplyResult> {
  const now = Math.floor(Date.now() / 1000);
  const stagedBatch = (
    await db
      .select({
        status: legacyImportBatches.status,
        executed_by_user_id: legacyImportBatches.executed_by_user_id,
        file_hash: legacyImportBatches.file_hash,
        plan_hash: legacyImportBatches.plan_hash,
        canonical_plan_json: legacyImportBatches.canonical_plan_json,
        preview_expires_at: legacyImportBatches.preview_expires_at,
        lease_token: legacyImportBatches.lease_token,
        lease_expires_at: legacyImportBatches.lease_expires_at,
      })
      .from(legacyImportBatches)
      .where(eq(legacyImportBatches.id, options.batchId))
      .limit(1)
  )[0];
  if (
    !stagedBatch ||
    stagedBatch.status !== "applying" ||
    stagedBatch.executed_by_user_id !== operatorId ||
    stagedBatch.file_hash !== options.fileHash ||
    stagedBatch.plan_hash !== options.planHash ||
    !stagedBatch.canonical_plan_json ||
    !stagedBatch.preview_expires_at ||
    stagedBatch.preview_expires_at < now ||
    stagedBatch.lease_token !== options.leaseToken ||
    !stagedBatch.lease_expires_at ||
    stagedBatch.lease_expires_at < now
  ) {
    throw new Error("Legacy import requires a claimed preview record.");
  }
  let plan: LegacyImportPlan;
  try {
    plan = JSON.parse(stagedBatch.canonical_plan_json) as LegacyImportPlan;
  } catch {
    throw new Error("Legacy import preview has no valid canonical plan.");
  }
  if (
    !Array.isArray(plan.events) ||
    !Array.isArray(plan.videos) ||
    !Array.isArray(plan.eventStaff) ||
    !Array.isArray(plan.xUsers)
  ) {
    throw new Error("Legacy import preview canonical plan is malformed.");
  }
  if (await stableSha256(plan) !== options.planHash) {
    throw new Error("Legacy import preview canonical plan hash does not match.");
  }
  if (await stableSha256(requestPlan) !== options.planHash) {
    throw new Error("Legacy import request plan hash does not match its preview.");
  }
  const strategy = options.strategy;
  if (plan.errors.length > 0) {
    throw new Error("Validation errors prevent legacy import apply.");
  }
  const errors: string[] = [];
  const counts: ApplyResult["counts"] = {
    events: { create: 0, replace: 0, skip: 0, failed: 0 },
    videos: { create: 0, replace: 0, skip: 0, failed: 0 },
    xUsers: { create: 0 },
    members: 0,
    staff: 0,
  };

  const rebuildEventIds = new Set<string>();
  const mutationStatements: BatchItem<"sqlite">[] = [];
  const expectedMutationChanges: Array<number | null> = [];
  const audits: WriteAuditLogInput[] = [];

  // ----------------------------------------------------------
  // 1) バッチ記録 (status="planned") - apply 失敗しても記録が残る
  // ----------------------------------------------------------
  // ----------------------------------------------------------
  // 2) 既存 ID チェック
  // ----------------------------------------------------------
  const eventIds = plan.events.map((e) => e.id);
  const videoIds = plan.videos.map((v) => v.id);

  const existingEventsById = new Map<string, typeof events.$inferSelect>();
  for (const chunk of chunked(eventIds, MAX_IN_CLAUSE)) {
    const rows = await db.select().from(events).where(inArray(events.id, chunk));
    for (const row of rows) existingEventsById.set(row.id, row);
  }
  const existingEventIds = new Set(existingEventsById.keys());
  const existingVideosById = new Map<string, typeof videos.$inferSelect>();
  for (const chunk of chunked(videoIds, MAX_IN_CLAUSE)) {
    const rows = await db.select().from(videos).where(inArray(videos.id, chunk));
    for (const row of rows) existingVideosById.set(row.id, row);
  }
  const existingVideoIds = new Set(existingVideosById.keys());

  let importedEventIds = new Set<string>();
  let importedVideoIds = new Set<string>();
  if (strategy === "replace_imported") {
    importedEventIds = await fetchImportedIds(db, eventIds);
    importedVideoIds = await fetchImportedIds(db, videoIds);
  }

  // ----------------------------------------------------------
  // 3) X ユーザー（未承認として取り込み、運営レビュー後に利用可能にする）
  // ----------------------------------------------------------
  const existingXIds = new Set<string>();
  const xIdList = plan.xUsers.map((x) => x.id);
  for (const chunk of chunked(xIdList, MAX_IN_CLAUSE)) {
    const rows = await db
      .select({ id: xUsers.id })
      .from(xUsers)
      .where(inArray(sql<string>`lower(${xUsers.id})`, chunk.map((id) => id.toLowerCase())));
    for (const r of rows) existingXIds.add(r.id.toLowerCase());
  }
  const xUsersById = new Map(plan.xUsers.map((xUser) => [xUser.id.toLowerCase(), xUser]));
  const createdXIds = new Set<string>();

  const groupRows = <T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> => {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
      const id = key(row);
      grouped.set(id, [...(grouped.get(id) ?? []), row]);
    }
    return grouped;
  };
  const allEventStaff = eventIds.length > 0
    ? await db.select().from(eventStaff).where(inArray(eventStaff.event_id, eventIds))
    : [];
  const allEventQuestions = eventIds.length > 0
    ? await db.select().from(eventCustomQuestions).where(inArray(eventCustomQuestions.event_id, eventIds))
    : [];
  const allVideoMembers = videoIds.length > 0
    ? await db.select().from(videoMembers).where(inArray(videoMembers.video_id, videoIds))
    : [];
  const allVideoEvents = videoIds.length > 0
    ? await db.select().from(videoEvents).where(inArray(videoEvents.video_id, videoIds))
    : [];
  const allVideoAnswers = videoIds.length > 0
    ? await db.select().from(videoCustomAnswers).where(inArray(videoCustomAnswers.video_id, videoIds))
    : [];
  const allVideoMetadata = videoIds.length > 0
    ? await db.select().from(videoYoutubeMetadata).where(inArray(videoYoutubeMetadata.video_id, videoIds))
    : [];
  const allVideoSoftwares = videoIds.length > 0
    ? await db.select().from(videoSoftwares).where(inArray(videoSoftwares.video_id, videoIds))
    : [];
  const allVideoSlots = videoIds.length > 0
    ? await db.select().from(slots).where(inArray(slots.video_id, videoIds))
    : [];
  const eventStaffByEvent = groupRows(allEventStaff, (row) => row.event_id);
  const eventQuestionsByEvent = groupRows(allEventQuestions, (row) => row.event_id);
  const videoMembersByVideo = groupRows(allVideoMembers, (row) => row.video_id);
  const videoEventsByVideo = groupRows(allVideoEvents, (row) => row.video_id);
  const videoAnswersByVideo = groupRows(allVideoAnswers, (row) => row.video_id);
  const videoMetadataByVideo = groupRows(allVideoMetadata, (row) => row.video_id);
  const videoSoftwaresByVideo = groupRows(allVideoSoftwares, (row) => row.video_id);
  const videoSlotsByVideo = groupRows(allVideoSlots, (row) => row.video_id ?? "");

  // ----------------------------------------------------------
  // 4) events
  // ----------------------------------------------------------
  for (const ev of plan.events) {
    const exists = existingEventIds.has(ev.id);
    let shouldWrite = false;

    if (!exists) {
      shouldWrite = true;
    } else if (strategy === "replace_imported" && importedEventIds.has(ev.id)) {
      shouldWrite = true;
    }

    if (!shouldWrite) {
      counts.events.skip++;
      continue;
    }

    try {
      const existingEvent = existingEventsById.get(ev.id) ?? null;
      if (exists && !existingEvent) {
        throw new Error("Existing event snapshot is unavailable.");
      }
      const afterEvent: typeof events.$inferSelect = existingEvent
        ? {
            ...existingEvent,
            title: ev.title,
            event_type: ev.event_type,
            explanation: ev.explanation,
            icon_url: ev.icon_url,
            img_url: ev.img_url,
            start_time: ev.start_time,
            end_time: ev.end_time,
            visibility_status: ev.visibility_status,
            representative_x_user_id: ev.representative_x_user_id,
            updated_at: now,
          }
        : {
            id: ev.id,
            title: ev.title,
            event_type: ev.event_type,
            explanation: ev.explanation,
            icon_url: ev.icon_url,
            img_url: ev.img_url,
            accent_color: null,
            representative_x_user_id: ev.representative_x_user_id,
            visibility_status: ev.visibility_status,
            allow_user_video_event_links: 0,
            allow_unslotted_posts: 0,
            allow_user_video_edits: 0,
            user_video_edit_permission_keys_json: null,
            slot_type: "time",
            slot_visibility_mode: "public_name",
            start_time: ev.start_time,
            end_time: ev.end_time,
            entry_start_time: null,
            entry_end_time: null,
            created_at: now,
            updated_at: now,
            max_slots_per_video: 1,
            max_consecutive_slots_per_entry: 3,
            review_settings: null,
            editable_fields: null,
            repeat_rules: null,
            slot_part_gap_minutes: 15,
            parts_json: null,
            public_api_enabled: 0,
            public_api_updated_at: null,
          };
      const eventMutation = existingEvent
        ? db.run(sql`
            UPDATE events
            SET title = ${afterEvent.title}, event_type = ${afterEvent.event_type},
                explanation = ${afterEvent.explanation}, icon_url = ${afterEvent.icon_url},
                img_url = ${afterEvent.img_url}, start_time = ${afterEvent.start_time},
                end_time = ${afterEvent.end_time}, visibility_status = ${afterEvent.visibility_status},
                representative_x_user_id = ${afterEvent.representative_x_user_id},
                updated_at = ${afterEvent.updated_at}
            WHERE id = ${afterEvent.id} AND updated_at = ${existingEvent.updated_at}
          `)
        : db.run(sql`
            INSERT INTO events (
              id, title, event_type, explanation, icon_url, img_url, accent_color,
              representative_x_user_id, visibility_status, allow_user_video_event_links,
              allow_unslotted_posts, allow_user_video_edits,
              user_video_edit_permission_keys_json, slot_type, slot_visibility_mode,
              start_time, end_time, entry_start_time, entry_end_time, created_at, updated_at,
              max_slots_per_video, max_consecutive_slots_per_entry, review_settings,
              editable_fields, repeat_rules, slot_part_gap_minutes, parts_json,
              public_api_enabled, public_api_updated_at
            ) VALUES (
              ${afterEvent.id}, ${afterEvent.title}, ${afterEvent.event_type},
              ${afterEvent.explanation}, ${afterEvent.icon_url}, ${afterEvent.img_url},
              ${afterEvent.accent_color}, ${afterEvent.representative_x_user_id},
              ${afterEvent.visibility_status}, ${afterEvent.allow_user_video_event_links},
              ${afterEvent.allow_unslotted_posts}, ${afterEvent.allow_user_video_edits},
              ${afterEvent.user_video_edit_permission_keys_json}, ${afterEvent.slot_type},
              ${afterEvent.slot_visibility_mode}, ${afterEvent.start_time}, ${afterEvent.end_time},
              ${afterEvent.entry_start_time}, ${afterEvent.entry_end_time}, ${afterEvent.created_at},
              ${afterEvent.updated_at}, ${afterEvent.max_slots_per_video},
              ${afterEvent.max_consecutive_slots_per_entry}, ${afterEvent.review_settings},
              ${afterEvent.editable_fields}, ${afterEvent.repeat_rules},
              ${afterEvent.slot_part_gap_minutes}, ${afterEvent.parts_json},
              ${afterEvent.public_api_enabled}, ${afterEvent.public_api_updated_at}
            )
          `);

      // event_staff
      const staffRows = plan.eventStaff.filter((s) => s.event_id === ev.id);
      const eventXUserWork = buildLegacyXUserAtomicWork({
        db,
        xUsersById,
        referencedIds: [
          ev.representative_x_user_id,
          ...staffRows.map((staff) => staff.x_user_id),
        ],
        existingXIds,
        actorUserId: operatorId,
        now,
        auditTargetId: `event:${ev.id}`,
      });
      if (exists && strategy === "replace_imported") {
        const existingStaffRows = eventStaffByEvent.get(ev.id) ?? [];
        if (existingStaffRows.some((row) => !row.id.startsWith(`legacy_es_${ev.id}_`))) {
          throw new Error(
            "replace_imported cannot replace staff that was not created by the legacy importer.",
          );
        }
      }
      const qRows = plan.eventCustomQuestions.filter((q) => q.event_id === ev.id);
      const beforeQuestionRows = existingEvent
        ? eventQuestionsByEvent.get(ev.id) ?? []
        : [];
      const afterQuestionRows: Array<typeof eventCustomQuestions.$inferSelect> = qRows.map(
        (question) => ({
          id: question.id,
          event_id: question.event_id,
          question_key: question.question_key,
          label: question.label,
          description: question.description,
          type: question.type,
          required: question.required,
          options_json: question.options_json,
          placeholder: question.placeholder,
          max_length: question.max_length,
          sort_order: question.sort_order,
          is_active: question.is_active,
          visibility: question.visibility,
          created_at: now,
          updated_at: now,
        }),
      );
      const questionMutationStatements = [];
      const questionExpectedChanges: Array<number | null> = [];
      const questionAudits = [];
      if (existingEvent) {
        const questionVersionPredicates = beforeQuestionRows.map(
          (question) => sql`
            EXISTS (
              SELECT 1 FROM event_custom_questions
              WHERE id = ${question.id} AND event_id = ${ev.id}
                AND updated_at = ${question.updated_at}
            )
          `,
        );
        const exactQuestionSet =
          beforeQuestionRows.length === 0
            ? sql`NOT EXISTS (SELECT 1 FROM event_custom_questions WHERE event_id = ${ev.id})`
            : sql`
                (SELECT COUNT(*) FROM event_custom_questions WHERE event_id = ${ev.id}) = ${beforeQuestionRows.length}
                AND ${sql.join(questionVersionPredicates, sql` AND `)}
              `;
        questionMutationStatements.push(
          db.run(sql`
            SELECT CASE
              WHEN (${exactQuestionSet}) THEN 1
              ELSE json_extract('not-valid-json', '$')
            END
          `),
          db.run(sql`DELETE FROM event_custom_questions WHERE event_id = ${ev.id}`),
        );
        questionExpectedChanges.push(null, beforeQuestionRows.length);
        questionAudits.push(
          ...beforeQuestionRows.map((question) => ({
            table_name: "event_custom_questions",
            target_id: question.id,
            operation: "DELETE" as const,
            before: question,
            after: null,
            actor_user_id: operatorId,
            reason: "legacy_import",
            context: "legacy_import",
            retention_class: "long_audit" as const,
            restore_strategy: "recreate_deleted" as const,
            strict: true,
          })),
        );
      }
      for (const question of afterQuestionRows) {
        questionMutationStatements.push(db.run(sql`
          INSERT INTO event_custom_questions (
            id, event_id, question_key, label, description, type, required,
            options_json, placeholder, max_length, sort_order, is_active,
            visibility, created_at, updated_at
          ) VALUES (
            ${question.id}, ${question.event_id}, ${question.question_key},
            ${question.label}, ${question.description}, ${question.type},
            ${question.required}, ${question.options_json}, ${question.placeholder},
            ${question.max_length}, ${question.sort_order}, ${question.is_active},
            ${question.visibility}, ${question.created_at}, ${question.updated_at}
          )
        `));
        questionExpectedChanges.push(1);
        questionAudits.push({
          table_name: "event_custom_questions",
          target_id: question.id,
          operation: "CREATE" as const,
          before: null,
          after: question,
          actor_user_id: operatorId,
          reason: "legacy_import",
          context: "legacy_import",
          retention_class: "long_audit" as const,
          restore_strategy: "delete_created" as const,
          strict: true,
        });
      }
      questionMutationStatements.push(db.run(sql`
        INSERT OR IGNORE INTO legacy_import_batch_items (
          batch_id, target_table, target_id, action, source_key, status, warning_count, created_at
        ) VALUES (
          ${options.batchId}, 'events', ${ev.id}, ${existingEvent ? "replace" : "create"},
          NULL, 'ok', 0, ${now}
        )
      `));
      questionExpectedChanges.push(null);
      const staffWork = await buildReplaceEventStaffWithProtection({
        db,
        eventId: ev.id,
        actorUserId: operatorId,
        reason: "legacy_import",
        context: "legacy_import",
        now,
        replacements: staffRows.map((staff) => ({
          id: staff.id,
          values: {
            user_id: null,
            x_user_id: staff.x_user_id,
            display_name: staff.display_name,
            permission_preset: staff.permission_preset,
            custom_permission_keys_json: null,
            is_public: staff.is_public,
            public_role_label: staff.public_role_label,
            internal_note: null,
          },
        })),
        atomicExtras: {
          mutationStatements: [
            ...eventXUserWork.mutationStatements,
            eventMutation,
            ...questionMutationStatements,
          ],
          expectedMutationChanges: [
            ...eventXUserWork.expectedMutationChanges,
            1,
            ...questionExpectedChanges,
          ],
          audits: [
            ...eventXUserWork.audits,
            {
              table_name: "events",
              target_id: afterEvent.id,
              operation: existingEvent ? "UPDATE" : "CREATE",
              before: existingEvent,
              after: afterEvent,
              actor_user_id: operatorId,
              reason: "legacy_import",
              context: "legacy_import",
              retention_class: "long_audit",
              restore_strategy: existingEvent ? "update_before" : "delete_created",
              strict: true,
            },
            ...questionAudits,
          ],
        },
      });
      mutationStatements.push(...staffWork.mutationStatements);
      expectedMutationChanges.push(...staffWork.expectedMutationChanges);
      audits.push(...staffWork.audits);
      for (const xUserId of eventXUserWork.createdIds) {
        existingXIds.add(xUserId);
        createdXIds.add(xUserId);
      }
      counts.xUsers.create = createdXIds.size;
      if (existingEvent) counts.events.replace++;
      else counts.events.create++;
      counts.staff += staffRows.length;

      rebuildEventIds.add(ev.id);
    } catch (e) {
      counts.events.failed++;
      errors.push(`event ${ev.id}: ${stringifyError(e)}`);
    }
  }

  // ----------------------------------------------------------
  // 5) videos
  // ----------------------------------------------------------
  for (const vi of plan.videos) {
    const exists = existingVideoIds.has(vi.id);
    let shouldWrite = false;

    if (!exists) {
      shouldWrite = true;
    } else if (strategy === "replace_imported" && importedVideoIds.has(vi.id)) {
      shouldWrite = true;
    }

    if (!shouldWrite) {
      counts.videos.skip++;
      continue;
    }

    const extra = plan.videoNormExtras.find((e) => e.video_id === vi.id);

    try {
      const result = await buildLegacyVideoAtomicWork({
        db,
        video: vi,
        existing: existingVideosById.get(vi.id) ?? null,
        members: plan.videoMembers.filter((member) => member.video_id === vi.id),
        eventRows: plan.videoEvents.filter((relation) => relation.video_id === vi.id),
        answers: plan.videoCustomAnswers.filter((answer) => answer.video_id === vi.id),
        softwareLabels: extra?.softwareLabels ?? [],
        xUsersById,
        existingXIds,
        actorUserId: operatorId,
        batchId: options.batchId,
        now,
        beforeRows: {
          members: videoMembersByVideo.get(vi.id) ?? [],
          events: videoEventsByVideo.get(vi.id) ?? [],
          answers: videoAnswersByVideo.get(vi.id) ?? [],
          metadata: videoMetadataByVideo.get(vi.id) ?? [],
          softwares: videoSoftwaresByVideo.get(vi.id) ?? [],
          slots: videoSlotsByVideo.get(vi.id) ?? [],
        },
      });
      mutationStatements.push(...result.mutationStatements);
      expectedMutationChanges.push(...result.expectedMutationChanges);
      audits.push(...result.audits);
      for (const xUserId of result.createdXIds) {
        existingXIds.add(xUserId);
        createdXIds.add(xUserId);
      }
      counts.xUsers.create = createdXIds.size;
      counts.members += result.memberCount;
      if (exists) counts.videos.replace++;
      else counts.videos.create++;
      for (const eventId of result.eventIds) rebuildEventIds.add(eventId);

      // video_members (洗い替え)
          // 重複 PK は許容

      // video_events

      // video_custom_answers
          // スキップ

      // 使用ソフト (video_softwares テーブル)

      // youtube_metadata
          // 既存は放置

      // batch item 記録
    } catch (e) {
      counts.videos.failed++;
      errors.push(`video ${vi.id}: ${stringifyError(e)}`);
    }
  }

  // ----------------------------------------------------------
  // 6) 静的 JSON 再生成キュー
  // ----------------------------------------------------------
  if (options.enqueueStaticRebuild && options.importMode !== "draft") {
    const rebuildTargets = [
      ["events_index", "global"],
      ["search_index", "global"],
      ...(options.importMode !== "archive" ? [["list_recent", "global"]] : []),
      ...[...rebuildEventIds].map((eventId) => ["event", eventId]),
    ] as const;
    for (const [targetType, targetId] of rebuildTargets) {
      mutationStatements.push(db.run(sql`
        INSERT OR IGNORE INTO static_rebuild_queue (
          id, target_type, target_id, reason, priority, status, attempt_count,
          requested_by_user_id, created_at, updated_at
        ) VALUES (
          ${generateId("srb")}, ${targetType}, ${targetId}, 'legacy_import',
          'low', 'pending', 0, ${operatorId}, ${now}, ${now}
        )
      `));
      expectedMutationChanges.push(null);
    }
  }

  // ----------------------------------------------------------
  // 7) 監査ログ (audit_logs)
  // ----------------------------------------------------------
  audits.push({
    table_name: "legacy_import",
    target_id: options.batchId,
    operation: "SYSTEM",
    before: null,
    after: { strategy, importMode: options.importMode, counts, errorCount: errors.length },
    actor_user_id: operatorId,
    reason: "legacy_import",
    context: null,
    retention_class: "long_audit",
    restore_strategy: "none",
    strict: true,
  });

  // ----------------------------------------------------------
  // 8) バッチ status 更新
  // ----------------------------------------------------------
  if (errors.length > 0) throw new Error(errors.join("\n"));
  if (mutationStatements.length === 0) {
    mutationStatements.push(db.run(sql`SELECT 1`));
    expectedMutationChanges.push(null);
  }
  const assertionCount = expectedMutationChanges.filter((value) => value !== null).length;
  if (mutationStatements.length + assertionCount + 4 > MAX_D1_BATCH_STATEMENTS) {
    throw new Error("Legacy import finalize exceeds the D1 batch statement limit.");
  }
  if (audits.length > MAX_D1_AUDIT_ENTRIES) {
    throw new Error("Legacy import finalize exceeds the audit entry limit.");
  }
  const auditPayloadBytes = new TextEncoder().encode(JSON.stringify(
    audits.map((audit) => ({ before: audit.before ?? null, after: audit.after ?? null })),
  )).length;
  if (auditPayloadBytes > MAX_D1_AUDIT_PAYLOAD_BYTES) {
    throw new Error("Legacy import finalize exceeds the audit payload limit.");
  }
  await mutateWithAudit(db, {
    mutationStatements,
    expectedMutationChanges,
    audits,
    postAuditStatements: [
      db.update(legacyImportBatches).set({
        status: "applied",
        counts_json: JSON.stringify(counts),
        error_count: 0,
        applied_at: now,
        failed_at: null,
        error_summary: null,
        lease_token: null,
        lease_expires_at: null,
        consumed_at: now,
      }).where(and(
        eq(legacyImportBatches.id, options.batchId),
        eq(legacyImportBatches.status, "applying"),
        eq(legacyImportBatches.lease_token, options.leaseToken),
      )!),
      db.run(sql`
        SELECT CASE WHEN changes() = 1 THEN 1 ELSE json_extract('not-valid-json', '$') END
      `),
    ],
  });

  return {
    ok: errors.length === 0,
    message:
      errors.length > 0
        ? `取り込み中に ${errors.length} 件のエラーが発生しました。`
        : `取り込み完了: events ${counts.events.create + counts.events.replace}, videos ${
            counts.videos.create + counts.videos.replace
          }`,
    counts,
    errors,
    batchId: options.batchId,
  };
}

/**
 * preview/apply の途中で失効した lease を bounded に失敗へ確定する。
 * canonical table や audit を削除せず、次の preview/apply 要求の前に最大20件だけ回収する。
 */
export async function cleanupExpiredLegacyImportBatches(
  db: DB,
  now = Math.floor(Date.now() / 1000),
  limit = LEGACY_IMPORT_EXPIRY_CLEANUP_LIMIT,
): Promise<void> {
  const boundedLimit = Math.max(1, Math.min(limit, 20));
  await db.run(sql`
    UPDATE legacy_import_batches
    SET status = 'failed',
        failed_at = ${now},
        error_count = CASE WHEN error_count < 1 THEN 1 ELSE error_count END,
        error_summary = COALESCE(error_summary, 'preview or apply lease expired'),
        lease_token = NULL,
        lease_expires_at = NULL,
        consumed_at = ${now}
    WHERE id IN (
      SELECT id
      FROM legacy_import_batches
      WHERE (
        (status = 'previewed' AND preview_expires_at IS NOT NULL AND preview_expires_at < ${now})
        OR (status = 'applying' AND lease_expires_at IS NOT NULL AND lease_expires_at < ${now})
      )
      ORDER BY created_at ASC
      LIMIT ${boundedLimit}
    )
  `);
}

/** 呼び出し側が一回の回収で消費してよい失効preview数。 */
export const LEGACY_IMPORT_EXPIRY_CLEANUP_LIMIT = 20;
