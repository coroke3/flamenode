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
import type { DB } from "@/lib/db/client";
import {
  auditLogs,
  eventCustomQuestions,
  eventStaff,
  events,
  legacyImportBatchItems,
  legacyImportBatches,
  videoCustomAnswers,
  videoEvents,
  videoMembers,
  videoYoutubeMetadata,
  videos,
  xUsers,
} from "@/lib/db/schema";
import { replaceVideoSoftwareLabels } from "@/lib/db/software";
import { enqueueStaticRebuildMany } from "@/lib/staticRebuild/enqueue";
import { generateId } from "@/lib/utils/id";
import { PARSER_VERSION, SCHEMA_VERSION, MAX_CHUNK_SIZE, MAX_IN_CLAUSE } from "./constants";
import type {
  CanonicalEventStaff,
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

export async function applyLegacyImportPlan(
  db: DB,
  plan: LegacyImportPlan,
  options: ApplyOptions,
  operatorId: string,
): Promise<ApplyResult> {
  const now = Math.floor(Date.now() / 1000);
  const strategy = options.strategy;
  const errors: string[] = [];
  const counts: ApplyResult["counts"] = {
    events: { create: 0, replace: 0, skip: 0, failed: 0 },
    videos: { create: 0, replace: 0, skip: 0, failed: 0 },
    xUsers: { create: 0 },
    members: 0,
    staff: 0,
  };

  const rebuildEventIds = new Set<string>();
  const processedVideoIds: string[] = [];

  // ----------------------------------------------------------
  // 1) バッチ記録 (status="planned") - apply 失敗しても記録が残る
  // ----------------------------------------------------------
  try {
    await db.insert(legacyImportBatches).values({
      id: options.batchId,
      status: "planned",
      file_count: options.fileCount,
      file_names_json: options.fileNamesJson ?? null,
      file_hash: options.fileHash,
      plan_hash: options.planHash,
      parser_version: PARSER_VERSION,
      schema_version: SCHEMA_VERSION,
      strategy_json: JSON.stringify({
        strategy,
        importMode: options.importMode,
        enqueueStaticRebuild: options.enqueueStaticRebuild,
      }),
      counts_json: null,
      warning_count: plan.warnings.length,
      error_count: plan.errors.length,
      executed_by_user_id: operatorId,
      created_at: now,
      applied_at: null,
      failed_at: null,
      error_summary: null,
    }).onConflictDoNothing();
  } catch (e) {
    errors.push(`batch_create: ${stringifyError(e)}`);
  }

  // ----------------------------------------------------------
  // 2) 既存 ID チェック
  // ----------------------------------------------------------
  const eventIds = plan.events.map((e) => e.id);
  const videoIds = plan.videos.map((v) => v.id);

  const existingEventIds = new Set<string>();
  for (const chunk of chunked(eventIds, MAX_IN_CLAUSE)) {
    const rows = await db.select({ id: events.id }).from(events).where(inArray(events.id, chunk));
    for (const r of rows) existingEventIds.add(r.id);
  }
  const existingVideoIds = new Set<string>();
  for (const chunk of chunked(videoIds, MAX_IN_CLAUSE)) {
    const rows = await db.select({ id: videos.id }).from(videos).where(inArray(videos.id, chunk));
    for (const r of rows) existingVideoIds.add(r.id);
  }

  let importedEventIds = new Set<string>();
  let importedVideoIds = new Set<string>();
  if (strategy === "replace_imported") {
    [importedEventIds, importedVideoIds] = await Promise.all([
      fetchImportedIds(db, eventIds),
      fetchImportedIds(db, videoIds),
    ]);
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

  for (const xu of plan.xUsers) {
    if (existingXIds.has(xu.id.toLowerCase())) continue;
    try {
      await db.insert(xUsers).values({
        id: xu.id,
        x_name: xu.x_name,
        profile_text: xu.profile_text,
        portfolio_contact: xu.portfolio_contact,
        youtube_channel_url: xu.youtube_channel_url,
        other_social_links: xu.other_social_links,
        approval_status: "pending",
        approval_requested_at: now,
      }).onConflictDoNothing();
      counts.xUsers.create++;
    } catch (e) {
      errors.push(`x_user ${xu.id}: ${stringifyError(e)}`);
    }
  }

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
      if (!exists) {
        await db.insert(events).values({
          id: ev.id,
          title: ev.title,
          event_type: ev.event_type,
          explanation: ev.explanation,
          icon_url: ev.icon_url,
          img_url: ev.img_url,
          start_time: ev.start_time,
          end_time: ev.end_time,
          visibility_status: ev.visibility_status,
          representative_x_user_id: ev.representative_x_user_id,
          public_api_enabled: 0,
          public_api_updated_at: null,
          created_at: now,
          updated_at: now,
        });
        counts.events.create++;
      } else {
        await db.update(events).set({
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
        }).where(eq(events.id, ev.id));
        counts.events.replace++;
      }

      // event_staff
      const staffRows = plan.eventStaff.filter((s) => s.event_id === ev.id);
      if (exists && strategy === "replace_imported") {
        await db.delete(eventStaff).where(eq(eventStaff.event_id, ev.id));
      }
      for (const staff of staffRows) {
        await upsertEventStaff(db, staff);
        counts.staff++;
      }

      // event_custom_questions
      const qRows = plan.eventCustomQuestions.filter((q) => q.event_id === ev.id);
      for (const q of qRows) {
        try {
          await db.insert(eventCustomQuestions).values({
            id: q.id,
            event_id: q.event_id,
            question_key: q.question_key,
            label: q.label,
            description: q.description,
            type: q.type,
            required: q.required,
            options_json: q.options_json,
            placeholder: q.placeholder,
            max_length: q.max_length,
            sort_order: q.sort_order,
            is_active: q.is_active,
            visibility: q.visibility,
            created_at: now,
            updated_at: now,
          }).onConflictDoNothing();
        } catch {
          // 既存質問はスキップ
        }
      }

      rebuildEventIds.add(ev.id);

      // batch item 記録
      await recordBatchItem(db, options.batchId, "events", ev.id, !exists ? "create" : "replace", now);
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
      if (!exists) {
        await db.insert(videos).values({
          id: vi.id,
          title: vi.title,
          submitted_by_user_id: operatorId,
          creator_x_user_id: vi.creator_x_user_id,
          creator_display_name: vi.creator_display_name,
          creator_display_name_yomi: vi.creator_display_name_yomi,
          creator_icon_url: vi.creator_icon_url,
          collaboration_type: vi.collaboration_type,
          source_type: vi.source_type,
          youtube_video_id: vi.youtube_video_id,
          music: vi.music,
          credit: vi.credit,
          music_reference_url: vi.music_reference_url,
          intro_comment: vi.intro_comment,
          closing_comment: vi.closing_comment,
          highlights: vi.highlights,
          primary_event_id: vi.primary_event_id,
          scheduling_type: vi.scheduling_type,
          scheduled_time: vi.scheduled_time,
          visibility_status: vi.visibility_status,
          app_like_count: 0,
          score: 0,
          score_updated_at: null,
          created_at: vi.created_at ?? now,
          updated_at: now,
        });
        counts.videos.create++;
      } else {
        await db.update(videos).set({
          title: vi.title,
          creator_x_user_id: vi.creator_x_user_id,
          creator_display_name: vi.creator_display_name,
          creator_display_name_yomi: vi.creator_display_name_yomi,
          creator_icon_url: vi.creator_icon_url,
          collaboration_type: vi.collaboration_type,
          youtube_video_id: vi.youtube_video_id,
          music: vi.music,
          credit: vi.credit,
          music_reference_url: vi.music_reference_url,
          intro_comment: vi.intro_comment,
          closing_comment: vi.closing_comment,
          highlights: vi.highlights,
          primary_event_id: vi.primary_event_id,
          scheduling_type: vi.scheduling_type,
          scheduled_time: vi.scheduled_time,
          visibility_status: vi.visibility_status,
          updated_at: now,
        }).where(eq(videos.id, vi.id));
        counts.videos.replace++;
      }

      // video_members (洗い替え)
      if (exists) {
        await db.delete(videoMembers).where(eq(videoMembers.video_id, vi.id));
      }
      const members = plan.videoMembers.filter((m) => m.video_id === vi.id);
      for (const m of members) {
        try {
          await db.insert(videoMembers).values({
            id: m.id,
            video_id: m.video_id,
            x_user_id: m.x_user_id,
            name: m.name,
            role: m.role,
            order_index: m.order_index,
            chapters_json: m.chapters_json,
            is_public_member: 1,
            can_edit: 0,
            user_id: null,
            edit_granted_by_user_id: null,
            edit_granted_at: null,
            edit_updated_at: null,
          }).onConflictDoNothing();
          counts.members++;
        } catch {
          // 重複 PK は許容
        }
      }

      // video_events
      if (exists) {
        await db.delete(videoEvents).where(eq(videoEvents.video_id, vi.id));
      }
      const veRows = plan.videoEvents.filter((ve) => ve.video_id === vi.id);
      for (const ve of veRows) {
        await db.insert(videoEvents).values({ video_id: ve.video_id, event_id: ve.event_id })
          .onConflictDoNothing();
        rebuildEventIds.add(ve.event_id);
      }

      // video_custom_answers
      const answerRows = plan.videoCustomAnswers.filter((a) => a.video_id === vi.id);
      if (exists && answerRows.length > 0) {
        await db.delete(videoCustomAnswers).where(eq(videoCustomAnswers.video_id, vi.id));
      }
      for (const ans of answerRows) {
        try {
          await db.insert(videoCustomAnswers).values({
            video_id: ans.video_id,
            event_id: ans.event_id,
            question_id: ans.question_id,
            answer_text: ans.answer_text,
            answer_json: null,
            created_at: now,
            updated_at: now,
          }).onConflictDoNothing();
        } catch {
          // スキップ
        }
      }

      // 使用ソフト (video_softwares テーブル)
      if (extra && extra.softwareLabels.length > 0) {
        try {
          await replaceVideoSoftwareLabels(db, vi.id, extra.softwareLabels.join(", "));
        } catch (e) {
          errors.push(`video_softwares ${vi.id}: ${stringifyError(e)}`);
        }
      }

      // youtube_metadata
      if (vi.youtube_video_id) {
        try {
          await db.insert(videoYoutubeMetadata).values({
            video_id: vi.id,
            youtube_video_id: vi.youtube_video_id,
            sync_status: "pending",
            view_count: 0,
            updated_at: now,
          }).onConflictDoNothing();
        } catch {
          // 既存は放置
        }
      }

      processedVideoIds.push(vi.id);

      // batch item 記録
      await recordBatchItem(db, options.batchId, "videos", vi.id, !exists ? "create" : "replace", now);
    } catch (e) {
      counts.videos.failed++;
      errors.push(`video ${vi.id}: ${stringifyError(e)}`);
    }
  }

  // ----------------------------------------------------------
  // 6) 静的 JSON 再生成キュー
  // ----------------------------------------------------------
  if (options.enqueueStaticRebuild && options.importMode !== "draft") {
    const eventIdList = [...rebuildEventIds];
    const rebuildItems: Parameters<typeof enqueueStaticRebuildMany>[1] = [
      { targetType: "events_index", targetId: "global", reason: "legacy_import", priority: "low" },
      { targetType: "search_index", targetId: "global", reason: "legacy_import", priority: "low" },
    ];
    if (options.importMode !== "archive") {
      rebuildItems.push({
        targetType: "list_recent",
        targetId: "global",
        reason: "legacy_import",
        priority: "low",
      });
    }
    for (const eventId of eventIdList) {
      rebuildItems.push({ targetType: "event", targetId: eventId, reason: "legacy_import", priority: "low" });
    }
    try {
      await enqueueStaticRebuildMany(db, rebuildItems);
    } catch (e) {
      errors.push(`static_rebuild_queue: ${stringifyError(e)}`);
    }
  }

  // ----------------------------------------------------------
  // 7) 監査ログ (audit_logs)
  // ----------------------------------------------------------
  try {
    await db.insert(auditLogs).values({
      id: generateId("al"),
      table_name: "legacy_import",
      target_id: options.batchId,
      operation: "SYSTEM",
      before_json: null,
      after_json: JSON.stringify({
        strategy,
        importMode: options.importMode,
        counts,
        errorCount: errors.length,
      }),
      changed_keys_json: null,
      inverse_patch_json: null,
      actor_user_id: operatorId,
      actor_snapshot_json: null,
      reason: "legacy_import",
      context: null,
      retention_class: "long_audit",
      restore_strategy: "none",
      restore_status: "not_restorable",
      payload_size_bytes: 0,
      expires_at: null,
      created_at: now,
    });
  } catch (e) {
    errors.push(`audit_log: ${stringifyError(e)}`);
  }

  // ----------------------------------------------------------
  // 8) バッチ status 更新
  // ----------------------------------------------------------
  const batchStatus = errors.length > 0 ? "failed" : "applied";
  try {
    await db.update(legacyImportBatches).set({
      status: batchStatus,
      counts_json: JSON.stringify(counts),
      error_count: errors.length,
      applied_at: batchStatus === "applied" ? now : null,
      failed_at: batchStatus === "failed" ? now : null,
      error_summary: errors.length > 0 ? errors.slice(0, 5).join("\n") : null,
    }).where(eq(legacyImportBatches.id, options.batchId));
  } catch (e) {
    errors.push(`batch_update: ${stringifyError(e)}`);
  }

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

async function upsertEventStaff(
  db: DB,
  staff: CanonicalEventStaff,
): Promise<void> {
  try {
    const preset = staff.permission_preset as
      | "owner"
      | "manager"
      | "slot_manager"
      | "content_editor"
      | "reviewer"
      | "xid_reviewer"
      | "public_staff"
      | "custom";
    await db.insert(eventStaff).values({
      id: staff.id,
      event_id: staff.event_id,
      x_user_id: staff.x_user_id,
      user_id: null,
      display_name: staff.display_name,
      role: "editor" as "editor",
      permission_preset: preset,
      custom_permission_keys_json: null,
      is_public: staff.is_public,
      public_role_label: staff.public_role_label,
      internal_note: null,
      approved_by_user_id: null,
      approved_at: null,
    }).onConflictDoNothing();
  } catch {
    // 重複はスキップ
  }
}

async function recordBatchItem(
  db: DB,
  batchId: string,
  targetTable: string,
  targetId: string,
  action: string,
  now: number,
): Promise<void> {
  try {
    await db.insert(legacyImportBatchItems).values({
      batch_id: batchId,
      target_table: targetTable,
      target_id: targetId,
      action,
      source_key: null,
      status: "ok",
      warning_count: 0,
      created_at: now,
    }).onConflictDoNothing();
  } catch {
    // 記録失敗は本体処理に影響しない
  }
}
