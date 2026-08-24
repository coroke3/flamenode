import "server-only";

import { and, eq, getTableColumns, inArray, or, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import {
  auditLogs,
  eventCustomQuestions,
  eventStaff,
  events,
  softwareCatalog,
  users,
  videoChapters,
  videoCustomAnswers,
  videoEvents,
  videoMembers,
  videoSoftwares,
  videoYoutubeMetadata,
  videos,
  xUsers,
} from "@/lib/db/schema";
import { mutateWithAudit } from "@/lib/audit/mutate";
import type { WriteAuditLogInput } from "@/lib/audit/types";
import { expectedRowCondition } from "@/lib/audit/adapters";
import {
  MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO,
  type CanonicalLegacyPlan,
  type LegacyImportStrategy,
} from "./normalize";
import { compositeAuditTargetId } from "@/lib/video/atomicWritePlanCore";
import type {
  StaticRebuildPriority,
  StaticRebuildTargetType,
} from "@/lib/staticRebuild/types";
import type {
  LegacyImportApplyProgress,
  LegacyImportApplyStage,
} from "./previewStore";
import { legacyImportRebuildQueueId } from "./rebuildQueueCore";
import { sendYoutubeSyncPendingWakeBestEffort } from "@/lib/queues/youtubeSyncWake";
import type { QueueWakeKind } from "@/lib/queues/wakeBudget";
import { deletePublicJsonCaches } from "@/lib/publicData/publicCache";
import {
  eventBaseObjectKey,
  eventComposedObjectKey,
  eventSlotsObjectKey,
  eventReleaseObjectKey,
} from "@/lib/publicData/staticEventDetailCore";
import { invalidateEventExportCache } from "@/lib/api/eventExportCache";
import {
  compensateEventVisibilityFenceOnD1Failure,
  planEventVisibilityTransition,
  preCommitEventVisibilityTransition,
} from "@/lib/event/eventVisibilityTransition";
import {
  compensateDepublicizationFenceOnD1Failure,
  planVideoVisibilityFenceTransition,
  preCommitVideoVisibilityDepublicization,
} from "@/lib/video/videoVisibilityTransition";

const LEGACY_IMPORT_SYSTEM_USER_ID = "system_legacy_import";
const MAX_IDS_PER_QUERY = 80;
export const LEGACY_IMPORT_X_USER_STEP_SIZE = 40;
export const LEGACY_IMPORT_SOFTWARE_STEP_SIZE = 40;
export const LEGACY_IMPORT_QUESTION_STEP_SIZE = 6;
const MAX_EVENT_CUSTOM_QUESTIONS = 18;
const LEGACY_CUSTOM_ANSWER_AUDIT_CONTEXT = "legacy_import:custom-answer";
const LEGACY_IMPORT_STEP_AUDIT_CONTEXT = "legacy_import:step";
const LEGACY_IMPORT_STEP_AUDIT_TABLE = "legacy_import_steps";
const LEGACY_ENTITY_SNAPSHOT_AUDIT_CONTEXT = "legacy_import:entity-snapshot";
const LEGACY_ENTITY_SNAPSHOT_AUDIT_TABLE = "legacy_import_entity_snapshots";

type ApplyOptions = {
  actorAuthUserId: string;
  strategy: LegacyImportStrategy;
  stepTargetId: string;
  marker?: (outcome: LegacyImportStepOutcome) => LegacyImportStepMarker;
};

type LegacyRebuildTarget = {
  targetType: StaticRebuildTargetType;
  targetId: string;
  priority: StaticRebuildPriority;
  reason?: string;
};

const REBUILD_PRIORITY_RANK: Record<StaticRebuildPriority, number> = {
  high: 3,
  normal: 2,
  low: 1,
};

/**
 * 公開R2 JSONの再生成予約を本体mutationと同じD1 batchへ含める。
 * active targetはUPDATEしてprocessing leaseを無効化せず、updated_atを進めることで
 * Worker完了時の再queue判定に載せる。1 JSON payload / 1 SQLにまとめ、D1 query予算も固定する。
 */
function legacyRebuildQueueMutation(
  db: DB,
  targets: readonly LegacyRebuildTarget[],
  options: Pick<ApplyOptions, "actorAuthUserId" | "stepTargetId">,
  now: number,
) {
  const byTarget = new Map<string, LegacyRebuildTarget>();
  for (const target of targets) {
    const key = `${target.targetType}:${target.targetId}`;
    const current = byTarget.get(key);
    if (!current || REBUILD_PRIORITY_RANK[target.priority] > REBUILD_PRIORITY_RANK[current.priority]) {
      byTarget.set(key, target);
    }
  }
  const rows = [...byTarget.values()].map((target, index) => ({
    id: legacyImportRebuildQueueId(options.stepTargetId, index),
    target_type: target.targetType,
    target_id: target.targetId,
    priority: target.priority,
    reason: target.reason ?? "legacy_import",
  }));
  const payload = JSON.stringify(rows);
  return {
    statement: db.run(sql`
      INSERT INTO static_rebuild_queue (
        id, target_type, target_id, reason, priority, status,
        attempt_count, requested_by_user_id, created_at, updated_at
      )
      SELECT
        json_extract(incoming.value, '$.id'),
        json_extract(incoming.value, '$.target_type'),
        json_extract(incoming.value, '$.target_id'),
        json_extract(incoming.value, '$.reason'),
        json_extract(incoming.value, '$.priority'),
        'pending', 0, ${options.actorAuthUserId}, ${now}, ${now}
      FROM json_each(${payload}) AS incoming
      WHERE 1 = 1
      ON CONFLICT(target_type, target_id) WHERE status IN ('pending', 'processing')
      DO UPDATE SET
        reason = CASE
          WHEN static_rebuild_queue.reason = 'video_visibility_update'
               AND excluded.reason <> 'video_visibility_update'
            THEN static_rebuild_queue.reason
          ELSE excluded.reason
        END,
        priority = CASE
          WHEN static_rebuild_queue.priority = 'high' OR excluded.priority = 'high' THEN 'high'
          WHEN static_rebuild_queue.priority = 'normal' OR excluded.priority = 'normal' THEN 'normal'
          ELSE 'low'
        END,
        requested_by_user_id = excluded.requested_by_user_id,
        updated_at = MAX(static_rebuild_queue.updated_at + 1, excluded.updated_at)
    `),
    expectedChanges: rows.length,
  };
}

export type LegacyApplyResult = {
  created: { events: number; videos: number; xUsers: number; authUsers: number; softwares: number };
  replaced: { events: number; videos: number };
  skipped: { events: number; videos: number };
  customQuestions: { created: number; reused: number };
  warnings: string[];
};

type LegacyImportStepOutcome =
  | { kind: "none" }
  | { kind: "system_user"; skipExistingEventIds: string[]; skipExistingVideoIds: string[] }
  | { kind: "x_users"; created: number; createdAuthUsers: number }
  | { kind: "softwares"; created: number }
  | { kind: "event"; action: "created" | "replaced" | "skipped" }
  | { kind: "custom_questions"; created: number; reused: number }
  | { kind: "video"; action: "created" | "replaced" | "skipped" };

type LegacyImportStepMarkerIdentity = {
  targetId: string;
  runDigest: string;
  planHash: string;
  stage: LegacyImportApplyStage;
  index: number;
};

type LegacyImportStepMarker = LegacyImportStepMarkerIdentity & {
  nextProgress: LegacyImportApplyProgress;
  outcome: LegacyImportStepOutcome;
};

type StoredLegacyImportStepOutcome =
  | { kind: "none" }
  | { kind: "system_user" }
  | Exclude<LegacyImportStepOutcome, { kind: "none" } | { kind: "system_user" }>;

type StoredLegacyImportStepMarker = Omit<LegacyImportStepMarkerIdentity, "targetId"> & {
  outcome: StoredLegacyImportStepOutcome;
  nextStage: LegacyImportApplyStage;
  nextIndex: number;
  nextCounts: LegacyImportApplyProgress["counts"];
  skipEventSnapshotFingerprint: string;
  skipVideoSnapshotFingerprint: string;
};

export type LegacyImportStepResult = {
  progress: LegacyImportApplyProgress;
  complete: boolean;
};

function chunks<T>(values: readonly T[], size = MAX_IDS_PER_QUERY): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
}

function cloneProgress(progress: LegacyImportApplyProgress): LegacyImportApplyProgress {
  return {
    ...progress,
    counts: { ...progress.counts },
    skipExistingEventIds: [...progress.skipExistingEventIds],
    skipExistingVideoIds: [...progress.skipExistingVideoIds],
  };
}

function skipSnapshotFingerprint(ids: readonly string[]): string {
  let hash = 0xcbf29ce484222325n;
  const canonical = [...ids].sort().join("\u0000");
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= BigInt(canonical.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `${ids.length}:${hash.toString(16).padStart(16, "0")}`;
}

async function snapshotDigest(value: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(value));
}

function entitySnapshotTargetId(kind: "event" | "video", id: string): string {
  return `${kind}:${encodeURIComponent(id)}`;
}

function nextStageProgress(
  plan: CanonicalLegacyPlan,
  current: LegacyImportApplyProgress,
  outcome: LegacyImportStepOutcome,
): LegacyImportApplyProgress {
  const next = cloneProgress(current);
  switch (current.stage) {
    case "system_user":
      if (outcome.kind !== "system_user") throw new Error("旧形式インポートの進捗結果が不正です。");
      next.skipExistingEventIds = [...outcome.skipExistingEventIds].sort();
      next.skipExistingVideoIds = [...outcome.skipExistingVideoIds].sort();
      next.stage = "x_users";
      next.index = 0;
      break;
    case "x_users": {
      if (plan.xUsers.length === 0 && outcome.kind === "none") {
        next.stage = "softwares";
        next.index = 0;
        break;
      }
      if (outcome.kind !== "x_users") throw new Error("旧形式インポートのX名義進捗が不正です。");
      next.counts.createdXUsers += outcome.created;
      next.counts.createdAuthUsers += outcome.createdAuthUsers;
      const groupCount = Math.ceil(plan.xUsers.length / LEGACY_IMPORT_X_USER_STEP_SIZE);
      if (current.index + 1 < groupCount) next.index += 1;
      else {
        next.stage = "softwares";
        next.index = 0;
      }
      break;
    }
    case "softwares": {
      if (plannedSoftwareCatalogRows(plan).length === 0 && outcome.kind === "none") {
        next.stage = "events";
        next.index = 0;
        break;
      }
      if (outcome.kind !== "softwares") throw new Error("旧形式インポートの使用ソフト進捗が不正です。");
      next.counts.createdSoftwares += outcome.created;
      const groupCount = Math.ceil(
        plannedSoftwareCatalogRows(plan).length / LEGACY_IMPORT_SOFTWARE_STEP_SIZE,
      );
      if (current.index + 1 < groupCount) next.index += 1;
      else {
        next.stage = "events";
        next.index = 0;
      }
      break;
    }
    case "events":
      if (plan.events.length === 0 && outcome.kind === "none") {
        next.stage = "custom_questions";
        next.index = 0;
        break;
      }
      if (outcome.kind !== "event") throw new Error("旧形式インポートのイベント進捗が不正です。");
      next.counts[`${outcome.action}Events`] += 1;
      if (current.index + 1 < plan.events.length) next.index += 1;
      else {
        next.stage = "custom_questions";
        next.index = 0;
      }
      break;
    case "custom_questions": {
      if (plan.eventCustomQuestions.length === 0 && outcome.kind === "none") {
        next.stage = "videos";
        next.index = 0;
        break;
      }
      if (outcome.kind !== "custom_questions") {
        throw new Error("旧形式インポートのカスタム質問進捗が不正です。");
      }
      next.counts.createdCustomQuestions += outcome.created;
      next.counts.reusedCustomQuestions += outcome.reused;
      const groupCount = Math.ceil(
        plan.eventCustomQuestions.length / LEGACY_IMPORT_QUESTION_STEP_SIZE,
      );
      if (current.index + 1 < groupCount) next.index += 1;
      else {
        next.stage = "videos";
        next.index = 0;
      }
      break;
    }
    case "videos":
      if (plan.videos.length === 0 && outcome.kind === "none") {
        next.stage = "complete";
        next.index = 0;
        break;
      }
      if (outcome.kind !== "video") throw new Error("旧形式インポートの作品進捗が不正です。");
      next.counts[`${outcome.action}Videos`] += 1;
      if (current.index + 1 < plan.videos.length) next.index += 1;
      else {
        next.stage = "complete";
        next.index = 0;
      }
      break;
    case "complete":
      if (outcome.kind !== "none") throw new Error("完了済みインポートの進捗結果が不正です。");
      break;
  }
  return next;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildStepMarkerIdentity(
  previewToken: string,
  planHash: string,
  progress: LegacyImportApplyProgress,
): Promise<LegacyImportStepMarkerIdentity> {
  const runDigest = (await sha256Hex(previewToken)).slice(0, 24);
  return {
    targetId: `${runDigest}:${planHash.slice(0, 24)}:${progress.stage}:${progress.index}`,
    runDigest,
    planHash,
    stage: progress.stage,
    index: progress.index,
  };
}

function completeStepMarker(
  identity: LegacyImportStepMarkerIdentity,
  plan: CanonicalLegacyPlan,
  progress: LegacyImportApplyProgress,
  outcome: LegacyImportStepOutcome,
): LegacyImportStepMarker {
  return {
    ...identity,
    outcome,
    nextProgress: nextStageProgress(plan, progress, outcome),
  };
}

function stepMarkerAudit(marker: LegacyImportStepMarker, actorAuthUserId: string) {
  const storedOutcome: StoredLegacyImportStepOutcome = marker.outcome.kind === "system_user"
    ? { kind: "system_user" }
    : marker.outcome;
  return {
    table_name: LEGACY_IMPORT_STEP_AUDIT_TABLE,
    target_id: marker.targetId,
    operation: "SYSTEM" as const,
    before: null,
    after: {
      run_digest: marker.runDigest,
      plan_hash: marker.planHash,
      stage: marker.stage,
      index: marker.index,
      outcome: storedOutcome,
      next_stage: marker.nextProgress.stage,
      next_index: marker.nextProgress.index,
      next_counts: marker.nextProgress.counts,
      skip_event_snapshot_fingerprint: skipSnapshotFingerprint(marker.nextProgress.skipExistingEventIds),
      skip_video_snapshot_fingerprint: skipSnapshotFingerprint(marker.nextProgress.skipExistingVideoIds),
    },
    actor_user_id: actorAuthUserId,
    reason: "旧形式インポート継続ステップを確定",
    context: LEGACY_IMPORT_STEP_AUDIT_CONTEXT,
    retention_class: "long_audit" as const,
    restore_strategy: "none" as const,
    strict: true,
  };
}

async function writeStepMarkerOnly(
  db: DB,
  marker: LegacyImportStepMarker,
  actorAuthUserId: string,
): Promise<void> {
  await mutateWithAudit(db, {
    mutationStatements: [
      db.run(sql`
        SELECT CASE WHEN 1 THEN 1
        ELSE json_extract('legacy_import_step_marker', '$') END
      `),
    ],
    expectedMutationChanges: [null],
    audits: [stepMarkerAudit(marker, actorAuthUserId)],
  });
}

function parseStepMarkerOutcome(raw: string | null): StoredLegacyImportStepMarker | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      run_digest?: string;
      plan_hash?: string;
      stage?: LegacyImportApplyStage;
      index?: number;
      outcome?: StoredLegacyImportStepOutcome;
      next_stage?: LegacyImportApplyStage;
      next_index?: number;
      next_counts?: LegacyImportApplyProgress["counts"];
      skip_event_snapshot_fingerprint?: string;
      skip_video_snapshot_fingerprint?: string;
    };
    if (
      typeof parsed.run_digest !== "string" ||
      typeof parsed.plan_hash !== "string" ||
      typeof parsed.stage !== "string" ||
      !Number.isSafeInteger(parsed.index) ||
      !parsed.outcome ||
      typeof parsed.outcome.kind !== "string" ||
      typeof parsed.next_stage !== "string" ||
      !Number.isSafeInteger(parsed.next_index) ||
      !parsed.next_counts ||
      typeof parsed.skip_event_snapshot_fingerprint !== "string" ||
      typeof parsed.skip_video_snapshot_fingerprint !== "string"
    ) return null;
    return {
      runDigest: parsed.run_digest,
      planHash: parsed.plan_hash,
      stage: parsed.stage,
      index: parsed.index!,
      outcome: parsed.outcome,
      nextStage: parsed.next_stage,
      nextIndex: parsed.next_index!,
      nextCounts: parsed.next_counts,
      skipEventSnapshotFingerprint: parsed.skip_event_snapshot_fingerprint,
      skipVideoSnapshotFingerprint: parsed.skip_video_snapshot_fingerprint,
    };
  } catch {
    return null;
  }
}

async function recoveredStepMarker(
  db: DB,
  identity: LegacyImportStepMarkerIdentity,
  plan: CanonicalLegacyPlan,
  strategy: LegacyImportStrategy,
  progress: LegacyImportApplyProgress,
): Promise<LegacyImportApplyProgress | null> {
  const rows = await db
    .select({ afterJson: auditLogs.after_json })
    .from(auditLogs)
    .where(and(
      eq(auditLogs.table_name, LEGACY_IMPORT_STEP_AUDIT_TABLE),
      eq(auditLogs.target_id, identity.targetId),
      eq(auditLogs.context, LEGACY_IMPORT_STEP_AUDIT_CONTEXT),
    ))
    .limit(2);
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error("旧形式インポートのステップ監査が重複しています。");
  const recovered = parseStepMarkerOutcome(rows[0].afterJson);
  if (!recovered) throw new Error("旧形式インポートのステップ監査が破損しています。");
  const recoveredOutcome: LegacyImportStepOutcome = recovered.outcome.kind === "system_user"
    ? {
        kind: "system_user",
        skipExistingEventIds: strategy === "skip_existing" ? progress.skipExistingEventIds : [],
        skipExistingVideoIds: strategy === "skip_existing" ? progress.skipExistingVideoIds : [],
      }
    : recovered.outcome;
  const expectedProgress = nextStageProgress(plan, progress, recoveredOutcome);
  if (
    recovered.runDigest !== identity.runDigest ||
    recovered.planHash !== identity.planHash ||
    recovered.stage !== identity.stage ||
    recovered.index !== identity.index ||
    recovered.nextStage !== expectedProgress.stage ||
    recovered.nextIndex !== expectedProgress.index ||
    JSON.stringify(recovered.nextCounts) !== JSON.stringify(expectedProgress.counts) ||
    recovered.skipEventSnapshotFingerprint !== skipSnapshotFingerprint(expectedProgress.skipExistingEventIds) ||
    recovered.skipVideoSnapshotFingerprint !== skipSnapshotFingerprint(expectedProgress.skipExistingVideoIds)
  ) {
    throw new Error("旧形式インポートのステップ監査と進捗が一致しません。");
  }
  return expectedProgress;
}

function answerKey(videoId: string, eventId: string, questionId: string): string {
  return `${videoId}:${eventId}:${questionId}`;
}

async function existingPlanIdsSnapshot(
  db: DB,
  videoIds: readonly string[],
  eventIds: readonly string[],
): Promise<{ videoIds: string[]; eventIds: string[] }> {
  if (videoIds.length === 0 && eventIds.length === 0) return { videoIds: [], eventIds: [] };
  const videoPayload = JSON.stringify([...new Set(videoIds)]);
  const eventPayload = JSON.stringify([...new Set(eventIds)]);
  const [snapshot] = await db
    .select({
      videosJson: sql<string>`COALESCE((
        SELECT json_group_array(id) FROM videos
        WHERE id IN (SELECT value FROM json_each(${videoPayload}))
      ), '[]')`,
      eventsJson: sql<string>`COALESCE((
        SELECT json_group_array(id) FROM events
        WHERE id IN (SELECT value FROM json_each(${eventPayload}))
      ), '[]')`,
    })
    .from(sql`(SELECT 1) AS legacy_import_existing_snapshot`)
    .limit(1);
  if (!snapshot) throw new Error("旧形式インポートの既存ID snapshotを取得できませんでした。");
  return {
    videoIds: parseJsonArray<string>(snapshot.videosJson).sort(),
    eventIds: parseJsonArray<string>(snapshot.eventsJson).sort(),
  };
}

function normalizeSoftwareName(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function stableSoftwareId(normalizedName: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalizedName.length; index += 1) {
    hash ^= normalizedName.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `sw_imp_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

async function ensureSystemUser(
  db: DB,
  options: ApplyOptions,
  markerOutcome?: LegacyImportStepOutcome,
): Promise<void> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.id, LEGACY_IMPORT_SYSTEM_USER_ID))
    .limit(1);
  if (existing[0]) {
    const principal = existing[0];
    const validPrincipal =
      principal.name === "Legacy import system" &&
      principal.email === null &&
      principal.emailVerified === null &&
      principal.image === null &&
      principal.discord_id === null &&
      principal.role === "user" &&
      principal.can_create_events === 0 &&
      principal.is_notification_enabled === 0 &&
      principal.is_tos_accepted === 0 &&
      principal.accepted_terms_version_id === null &&
      principal.terms_reaccept_required === 0 &&
      principal.is_banned === 0 &&
      principal.active_x_user_id === null &&
      principal.onboarding_completed_at === null &&
      principal.last_guild_check === null;
    if (!validPrincipal) {
      throw new Error("旧形式インポート専用principalの予約IDが別用途で使用されています。");
    }
    if (options.marker && markerOutcome) {
      await writeStepMarkerOnly(db, options.marker(markerOutcome), options.actorAuthUserId);
    }
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  await mutateWithAudit(db, {
    mutationStatements: [
      db.run(sql`
        INSERT INTO "user" (
          id, name, role, can_create_events, is_notification_enabled,
          is_tos_accepted, is_banned, created_at
        ) VALUES (
          ${LEGACY_IMPORT_SYSTEM_USER_ID}, 'Legacy import system', 'user', 0, 0, 0, 0, ${now}
        )
      `),
    ],
    expectedMutationChanges: [1],
    audits: [
      {
        table_name: "user",
        target_id: LEGACY_IMPORT_SYSTEM_USER_ID,
        operation: "CREATE",
        before: null,
        after: { id: LEGACY_IMPORT_SYSTEM_USER_ID, technical_principal: true },
        actor_user_id: options.actorAuthUserId,
        reason: "旧形式インポート専用principalを作成",
        context: "legacy_import",
        retention_class: "long_audit",
        restore_strategy: "delete_created",
      },
      ...(options.marker && markerOutcome
        ? [stepMarkerAudit(options.marker(markerOutcome), options.actorAuthUserId)]
        : []),
    ],
  });
}

async function ensureXUserGroup(
  db: DB,
  rows: CanonicalLegacyPlan["xUsers"],
  options: ApplyOptions,
): Promise<number> {
  if (rows.length === 0) return 0;
  const existing = new Set<string>();
  const found = await db
    .select({ id: xUsers.id })
    .from(xUsers)
    .where(inArray(xUsers.id, rows.map((row) => row.id)));
  found.forEach((row) => existing.add(row.id));
  const missing = rows.filter((row) => !existing.has(row.id));
  if (missing.length > 0) {
    const payload = JSON.stringify(missing);
    const now = Math.floor(Date.now() / 1000);
    const rebuildQueue = legacyRebuildQueueMutation(
      db,
      [{
        targetType: "users_index",
        targetId: "global",
        priority: "low",
        reason: "legacy_import_x_users",
      }],
      options,
      now,
    );
    await mutateWithAudit(db, {
      mutationStatements: [
        db.run(sql`
          INSERT INTO x_users (
            id, x_name, icon_url, profile_text, portfolio_contact,
            youtube_channel_url, other_social_links, creative_start_date, approval_status
          )
          SELECT
            json_extract(value, '$.id'),
            json_extract(value, '$.x_name'),
            json_extract(value, '$.icon_url'),
            NULL,
            NULL,
            json_extract(value, '$.youtube_channel_url'),
            json_extract(value, '$.other_social_links'),
            NULL,
            'imported'
          FROM json_each(${payload})
        `),
        rebuildQueue.statement,
      ],
      expectedMutationChanges: [missing.length, rebuildQueue.expectedChanges],
      audits: [
        {
          table_name: "x_users_import_batch",
          target_id: `legacy:${missing[0]?.id ?? "empty"}`,
          operation: "CREATE",
          before: null,
          after: { ids: missing.map((row) => row.id) },
          actor_user_id: options.actorAuthUserId,
          reason: "旧形式からX名義を新正本へ作成",
          context: "legacy_import",
          retention_class: "long_audit",
          restore_strategy: "none",
        },
      ],
    });
  }
  return missing.length;
}

function plannedSoftwareCatalogRows(plan: CanonicalLegacyPlan): Array<{
  id: string;
  name: string;
  normalized_name: string;
}> {
  const normalizedToLabel = new Map<string, string>();
  plan.videoSoftwares.forEach(({ label }) => {
    const normalized = normalizeSoftwareName(label);
    if (normalized) normalizedToLabel.set(normalized, label.trim());
  });
  return [...normalizedToLabel].map(([normalized_name, name]) => ({
    id: stableSoftwareId(normalized_name),
    name,
    normalized_name,
  }));
}

async function ensureSoftwareCatalogGroup(
  db: DB,
  rows: ReturnType<typeof plannedSoftwareCatalogRows>,
  options: ApplyOptions,
): Promise<number> {
  if (rows.length === 0) return 0;
  const found = await db
    .select({ normalized_name: softwareCatalog.normalized_name })
    .from(softwareCatalog)
    .where(inArray(softwareCatalog.normalized_name, rows.map((row) => row.normalized_name)));
  const existing = new Set(found.map((row) => row.normalized_name));
  const missing = rows.filter((row) => !existing.has(row.normalized_name));
  const now = Math.floor(Date.now() / 1000);
  if (missing.length > 0) {
    const payload = JSON.stringify(missing);
    await mutateWithAudit(db, {
      mutationStatements: [
        db.run(sql`
          INSERT INTO software_catalog (
            id, name, normalized_name, category, usage_count,
            is_active, is_verified, created_at, updated_at
          )
          SELECT
            json_extract(value, '$.id'),
            json_extract(value, '$.name'),
            json_extract(value, '$.normalized_name'),
            NULL, 0, 1, 0, ${now}, ${now}
          FROM json_each(${payload})
        `),
      ],
      expectedMutationChanges: [missing.length],
      audits: [
        {
          table_name: "software_catalog_import_batch",
          target_id: `legacy:${missing[0]?.id ?? "empty"}`,
          operation: "CREATE",
          before: null,
          after: { rows: missing },
          actor_user_id: options.actorAuthUserId,
          reason: "旧形式の使用ソフトを新正本辞書へ追加",
          context: "legacy_import",
          retention_class: "long_audit",
          restore_strategy: "none",
        },
        ...(options.marker
          ? [stepMarkerAudit(
              options.marker({ kind: "softwares", created: missing.length }),
              options.actorAuthUserId,
            )]
          : []),
      ],
    });
  } else if (options.marker) {
    await writeStepMarkerOnly(
      db,
      options.marker({ kind: "softwares", created: 0 }),
      options.actorAuthUserId,
    );
  }
  return missing.length;
}

type PlannedQuestion = CanonicalLegacyPlan["eventCustomQuestions"][number];
type QuestionSnapshot = typeof eventCustomQuestions.$inferSelect;
type VideoExistenceSnapshot = {
  videoIds: readonly string[];
  existingVideoIds: readonly string[];
};

function sameQuestionDefinition(current: QuestionSnapshot, planned: PlannedQuestion): boolean {
  return (
    current.id === planned.id &&
    current.event_id === planned.event_id &&
    current.question_key === planned.question_key &&
    current.label === planned.label &&
    current.description === planned.description &&
    current.type === planned.type &&
    current.required === planned.required &&
    current.options_json === planned.options_json &&
    current.placeholder === planned.placeholder &&
    current.max_length === planned.max_length &&
    current.sort_order === planned.sort_order &&
    current.is_active === planned.is_active &&
    current.visibility === planned.visibility
  );
}

async function ensureLegacyCustomQuestions(
  db: DB,
  questions: readonly PlannedQuestion[],
  options: ApplyOptions,
  videoSnapshot?: VideoExistenceSnapshot,
): Promise<{ created: number; reused: number }> {
  if (questions.length === 0) {
    if (options.marker) {
      await writeStepMarkerOnly(
        db,
        options.marker({ kind: "custom_questions", created: 0, reused: 0 }),
        options.actorAuthUserId,
      );
    }
    return { created: 0, reused: 0 };
  }

  const eventIds = [...new Set(questions.map((question) => question.event_id))];
  const questionIds = [...new Set(questions.map((question) => question.id))];
  const existing = new Map<string, QuestionSnapshot>();
  const rowsByEvent = await db
    .select()
    .from(eventCustomQuestions)
    .where(inArray(eventCustomQuestions.event_id, eventIds));
  rowsByEvent.forEach((row) => existing.set(row.id, row));
  const rowsById = await db
    .select()
    .from(eventCustomQuestions)
    .where(inArray(eventCustomQuestions.id, questionIds));
  rowsById.forEach((row) => existing.set(row.id, row));

  const byEventKey = new Map(
    [...existing.values()].map((row) => [`${row.event_id}:${row.question_key}`, row]),
  );
  const missing: PlannedQuestion[] = [];
  let reused = 0;
  for (const question of questions) {
    const currentByKey = byEventKey.get(`${question.event_id}:${question.question_key}`);
    const currentById = existing.get(question.id);
    if (currentByKey) {
      if (currentByKey.id !== question.id || !sameQuestionDefinition(currentByKey, question)) {
        throw new Error(
          `イベント ${question.event_id} の質問 ${question.question_key} は既存定義と一致しません。`,
        );
      }
      reused += 1;
      continue;
    }
    if (currentById) {
      throw new Error(`カスタム質問ID ${question.id} は別のイベントまたは質問で使用されています。`);
    }
    missing.push(question);
  }

  if (missing.length > 0) {
    const now = Math.floor(Date.now() / 1000);
    const rows: QuestionSnapshot[] = missing.map(({ source_key: _sourceKey, ...question }) => ({
      ...question,
      created_at: now,
      updated_at: now,
    }));
    const missingPayload = JSON.stringify(missing);
    const expectedExistingVideoIds = new Set(videoSnapshot?.existingVideoIds ?? []);
    const videoSnapshotPayload = JSON.stringify(
      [...new Set(videoSnapshot?.videoIds ?? [])]
        .sort()
        .map((id) => ({ id, exists: expectedExistingVideoIds.has(id) ? 1 : 0 })),
    );
    const hasVideoSnapshot = (videoSnapshot?.videoIds.length ?? 0) > 0;
    await mutateWithAudit(db, {
      mutationStatements: [
        ...(hasVideoSnapshot
          ? [db.run(sql`
              SELECT CASE WHEN NOT EXISTS (
                SELECT 1
                FROM json_each(${videoSnapshotPayload}) AS incoming
                WHERE CAST(json_extract(incoming.value, '$.exists') AS INTEGER) <>
                  CASE WHEN EXISTS (
                    SELECT 1 FROM videos
                    WHERE id = json_extract(incoming.value, '$.id')
                  ) THEN 1 ELSE 0 END
              ) THEN 1
              ELSE json_extract('legacy_import_video_snapshot_mismatch', '$') END
            `)]
          : []),
        db.run(sql`
          SELECT CASE WHEN NOT EXISTS (
            SELECT 1
            FROM (
              SELECT
                json_extract(value, '$.event_id') AS event_id,
                COUNT(*) AS incoming_count
              FROM json_each(${missingPayload})
              GROUP BY json_extract(value, '$.event_id')
            ) AS incoming
            WHERE (
              SELECT COUNT(*)
              FROM event_custom_questions AS current
              WHERE current.event_id = incoming.event_id
            ) + incoming.incoming_count > ${MAX_EVENT_CUSTOM_QUESTIONS}
          ) THEN 1
          ELSE json_extract('legacy_import_question_limit_exceeded', '$') END
        `),
        db.insert(eventCustomQuestions).values(rows),
      ],
      expectedMutationChanges: [
        ...(hasVideoSnapshot ? [null] : []),
        null,
        rows.length,
      ],
      audits: [
        ...rows.map((row) => ({
          table_name: "event_custom_questions",
          target_id: row.id,
          operation: "CREATE" as const,
          before: null,
          after: row,
          actor_user_id: options.actorAuthUserId,
          reason: "旧形式動画の未対応項目をカスタム質問として作成",
          context: "legacy_import:custom-question",
          retention_class: "long_audit" as const,
          restore_strategy: "delete_created" as const,
          strict: true,
        })),
        ...(options.marker
          ? [stepMarkerAudit(
              options.marker({ kind: "custom_questions", created: missing.length, reused }),
              options.actorAuthUserId,
            )]
          : []),
      ],
    });
  } else if (options.marker) {
    await writeStepMarkerOnly(
      db,
      options.marker({ kind: "custom_questions", created: 0, reused }),
      options.actorAuthUserId,
    );
  }

  return { created: missing.length, reused };
}

type ExistingCustomAnswer = typeof videoCustomAnswers.$inferSelect;
type CustomAnswerAuditProof = {
  id: string;
  target_id: string;
  context: string | null;
  after_json: string | null;
  created_at: number;
};

function answerMatchesAuditSnapshot(current: ExistingCustomAnswer, raw: string | null): boolean {
  if (!raw) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const snapshot = parsed as Record<string, unknown>;
  return (
    snapshot.video_id === current.video_id &&
    snapshot.event_id === current.event_id &&
    snapshot.question_id === current.question_id &&
    snapshot.answer_text === current.answer_text &&
    snapshot.answer_json === current.answer_json &&
    snapshot.created_at === current.created_at &&
    snapshot.updated_at === current.updated_at
  );
}

async function latestImportedCustomAnswerProofs(
  db: DB,
  currentRows: readonly ExistingCustomAnswer[],
): Promise<Map<string, CustomAnswerAuditProof>> {
  if (currentRows.length === 0) return new Map();
  const currentByTarget = new Map(currentRows.map((row) => [
    compositeAuditTargetId(row.video_id, row.event_id, row.question_id),
    row,
  ]));
  const rows = await db
    .select({
      id: auditLogs.id,
      target_id: auditLogs.target_id,
      context: auditLogs.context,
      after_json: auditLogs.after_json,
      created_at: auditLogs.created_at,
    })
    .from(auditLogs)
    .where(and(
      eq(auditLogs.table_name, "video_custom_answers"),
      inArray(auditLogs.target_id, [...currentByTarget.keys()]),
      sql`${auditLogs.created_at} = (
        SELECT MAX(latest.created_at)
        FROM audit_logs AS latest
        WHERE latest.table_name = 'video_custom_answers'
          AND latest.target_id = ${auditLogs.target_id}
      )`,
    ))
    .limit(currentRows.length * 2 + 1);
  const grouped = new Map<string, CustomAnswerAuditProof[]>();
  for (const row of rows) {
    const group = grouped.get(row.target_id) ?? [];
    group.push(row);
    grouped.set(row.target_id, group);
  }
  const proofs = new Map<string, CustomAnswerAuditProof>();
  for (const [targetId, current] of currentByTarget) {
    const latest = grouped.get(targetId) ?? [];
    if (
      latest.length !== 1 ||
      latest[0].context !== LEGACY_CUSTOM_ANSWER_AUDIT_CONTEXT ||
      !answerMatchesAuditSnapshot(current, latest[0].after_json)
    ) {
      throw new Error(
        `カスタム質問回答 ${targetId} の最新状態を旧形式インポート由来と確認できません。`,
      );
    }
    proofs.set(targetId, latest[0]);
  }
  return proofs;
}

type EventAuditProof = {
  id: string;
  target_id: string;
  context: string | null;
  after_json: string | null;
  created_at: number;
};

async function loadEventSupportSnapshot(
  db: DB,
  eventId: string,
): Promise<{
  existingEvent: typeof events.$inferSelect | null;
  staff: Array<typeof eventStaff.$inferSelect>;
  latestAudits: EventAuditProof[];
}> {
  const snapshotTargetId = entitySnapshotTargetId("event", eventId);
  const [snapshot] = await db
    .select({
      existingEvent: { ...getTableColumns(events) },
      staffJson: sql<string>`COALESCE((
        SELECT json_group_array(json_object(
          'id', current.id,
          'event_id', current.event_id,
          'x_user_id', current.x_user_id,
          'display_name', current.display_name,
          'permission_preset', current.permission_preset,
          'custom_permission_keys_json', current.custom_permission_keys_json,
          'is_public', current.is_public,
          'public_role_label', current.public_role_label,
          'approved_by_auth_user_id', current.approved_by_auth_user_id,
          'approved_at', current.approved_at,
          'created_at', current.created_at,
          'updated_at', current.updated_at
        ))
        FROM (
          SELECT * FROM event_staff
          WHERE event_id = ${eventId}
          ORDER BY id
        ) AS current
      ), '[]')`,
      auditJson: sql<string>`COALESCE((
        SELECT json_group_array(json_object(
          'id', latest.id,
          'target_id', latest.target_id,
          'context', latest.context,
          'after_json', latest.after_json,
          'created_at', latest.created_at
        ))
        FROM (
          SELECT id, target_id, context, after_json, created_at
          FROM audit_logs
          WHERE table_name = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_TABLE}
            AND target_id = ${snapshotTargetId}
            AND context = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_CONTEXT}
            AND created_at = (
              SELECT MAX(candidate.created_at)
              FROM audit_logs AS candidate
              WHERE candidate.table_name = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_TABLE}
                AND candidate.target_id = ${snapshotTargetId}
                AND candidate.context = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_CONTEXT}
            )
          ORDER BY id
          LIMIT 2
        ) AS latest
      ), '[]')`,
    })
    .from(sql`(SELECT 1) AS legacy_import_event_snapshot`)
    .leftJoin(events, eq(events.id, eventId))
    .limit(1);
  if (!snapshot) throw new Error("イベント適用前のDB snapshotを取得できませんでした。");
  return {
    existingEvent: snapshot.existingEvent,
    staff: parseJsonArray<typeof eventStaff.$inferSelect>(snapshot.staffJson),
    latestAudits: parseJsonArray<EventAuditProof>(snapshot.auditJson),
  };
}

function managedEventSnapshot(
  event: Pick<
    typeof events.$inferSelect,
    "id" | "title" | "event_type" | "explanation" | "icon_url" | "img_url" |
    "visibility_status" | "start_time" | "end_time" | "created_at"
  >,
) {
  return {
    id: event.id,
    title: event.title,
    event_type: event.event_type,
    explanation: event.explanation,
    icon_url: event.icon_url,
    img_url: event.img_url,
    visibility_status: event.visibility_status,
    start_time: event.start_time,
    end_time: event.end_time,
    created_at: event.created_at,
  };
}

async function eventMatchesAuditSnapshot(
  current: typeof events.$inferSelect,
  currentStaff: readonly (typeof eventStaff.$inferSelect)[],
  raw: string | null,
): Promise<boolean> {
  if (!raw) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const after = parsed as Record<string, unknown>;
  const [managedDigest, staffDigest] = await Promise.all([
    snapshotDigest(managedEventSnapshot(current)),
    snapshotDigest([...currentStaff].sort((left, right) => left.id.localeCompare(right.id))),
  ]);
  return after.managed_digest === managedDigest && after.staff_digest === staffDigest;
}

async function applyEvent(
  db: DB,
  event: CanonicalLegacyPlan["events"][number],
  staffRows: CanonicalLegacyPlan["eventStaff"],
  expectedExistingForSkip: boolean,
  options: ApplyOptions,
): Promise<"created" | "replaced" | "skipped"> {
  const support = await loadEventSupportSnapshot(db, event.id);
  const existing = support.existingEvent;
  if (options.strategy === "skip_existing") {
    if (expectedExistingForSkip && !existing) {
      throw new Error(`イベント ${event.id} はプレビュー時点から削除されたため、再プレビューが必要です。`);
    }
    if (!expectedExistingForSkip && existing) {
      throw new Error(`イベント ${event.id} はプレビュー後に作成されたため、再プレビューが必要です。`);
    }
    if (expectedExistingForSkip) {
      if (options.marker) {
        await writeStepMarkerOnly(
          db,
          options.marker({ kind: "event", action: "skipped" }),
          options.actorAuthUserId,
        );
      }
      return "skipped";
    }
  }
  if (existing && options.strategy === "create_only") {
    throw new Error(`イベント ${event.id} は既に存在します。`);
  }
  const beforeStaff = existing ? support.staff : [];
  const auditProof = existing && support.latestAudits.length === 1
    ? support.latestAudits[0]
    : null;
  const auditSnapshotMatches = existing && auditProof
    ? await eventMatchesAuditSnapshot(existing, beforeStaff, auditProof.after_json)
    : false;
  if (
    existing &&
    (!auditProof ||
      auditProof.context !== LEGACY_ENTITY_SNAPSHOT_AUDIT_CONTEXT ||
      !auditSnapshotMatches)
  ) {
    throw new Error(`イベント ${event.id} の最新状態を旧形式インポート由来と確認できないため置換できません。`);
  }
  const now = Math.floor(Date.now() / 1000);
  const nextStaff: Array<typeof eventStaff.$inferSelect> = staffRows
    .map((row) => ({
      id: row.id,
      event_id: row.event_id,
      x_user_id: row.x_user_id,
      display_name: row.display_name,
      permission_preset: row.permission_preset,
      custom_permission_keys_json: null,
      is_public: row.is_public,
      public_role_label: row.public_role_label,
      approved_by_auth_user_id: options.actorAuthUserId,
      approved_at: now,
      created_at: now,
      updated_at: now,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const ownerCount = nextStaff.filter((row) => row.permission_preset === "owner").length;
  if (ownerCount !== 1) {
    throw new Error(
      `イベント ${event.id} の owner はちょうど1人必要です（現在 ${ownerCount} 人）。`,
    );
  }
  const payload = JSON.stringify(nextStaff);
  const beforeStaffPayload = JSON.stringify(beforeStaff);
  const auditProofPayload = JSON.stringify(auditProof ? [auditProof] : []);
  const snapshotTargetId = entitySnapshotTargetId("event", event.id);
  const nextManagedEvent = managedEventSnapshot({
    ...event,
    created_at: existing?.created_at ?? now,
  });
  const [nextManagedEventDigest, nextStaffDigest] = await Promise.all([
    snapshotDigest(nextManagedEvent),
    snapshotDigest(nextStaff),
  ]);
  const visibilityTransition = existing
    ? planEventVisibilityTransition({
        db,
        eventId: event.id,
        previousStatus: existing.visibility_status,
        nextStatus: event.visibility_status,
        actorUserId: options.actorAuthUserId,
        reason: "legacy_import_visibility",
        now,
      })
    : {
        mutationStatements: [],
        expectedMutationChanges: [],
        fenceToken: null,
        depublicizedFromPublic: false,
      };
  const rebuildReason = visibilityTransition.fenceToken
    ? "event_visibility_update"
    : undefined;
  const rebuildQueue = legacyRebuildQueueMutation(
    db,
    [
      { targetType: "event_base", targetId: event.id, priority: "high", reason: rebuildReason },
      { targetType: "event_slots", targetId: event.id, priority: "high", reason: rebuildReason },
      { targetType: "event_release", targetId: event.id, priority: "high", reason: rebuildReason },
      { targetType: "events_index", targetId: "global", priority: "low", reason: rebuildReason },
      { targetType: "search_index", targetId: "global", priority: "low", reason: rebuildReason },
    ],
    options,
    now,
  );
  const mutationStatements = [
    ...(existing
      ? [db.run(sql`
          SELECT CASE WHEN
            (SELECT COUNT(*) FROM event_staff WHERE event_id = ${event.id})
              = json_array_length(${beforeStaffPayload})
            AND (
              SELECT COUNT(*)
              FROM event_staff AS current
              INNER JOIN json_each(${beforeStaffPayload}) AS incoming
                ON current.id = json_extract(incoming.value, '$.id')
               AND current.event_id = json_extract(incoming.value, '$.event_id')
               AND current.x_user_id IS json_extract(incoming.value, '$.x_user_id')
               AND current.display_name = json_extract(incoming.value, '$.display_name')
               AND current.permission_preset = json_extract(incoming.value, '$.permission_preset')
               AND current.custom_permission_keys_json IS json_extract(incoming.value, '$.custom_permission_keys_json')
               AND current.is_public = json_extract(incoming.value, '$.is_public')
               AND current.public_role_label IS json_extract(incoming.value, '$.public_role_label')
               AND current.approved_by_auth_user_id IS json_extract(incoming.value, '$.approved_by_auth_user_id')
               AND current.approved_at IS json_extract(incoming.value, '$.approved_at')
               AND current.created_at = json_extract(incoming.value, '$.created_at')
               AND current.updated_at = json_extract(incoming.value, '$.updated_at')
              WHERE current.event_id = ${event.id}
            ) = json_array_length(${beforeStaffPayload})
            AND (
              SELECT COUNT(*)
              FROM audit_logs AS current_audit
              INNER JOIN json_each(${auditProofPayload}) AS proof
                ON current_audit.id = json_extract(proof.value, '$.id')
               AND current_audit.target_id = json_extract(proof.value, '$.target_id')
               AND current_audit.context IS json_extract(proof.value, '$.context')
               AND current_audit.after_json IS json_extract(proof.value, '$.after_json')
               AND current_audit.created_at = json_extract(proof.value, '$.created_at')
              WHERE current_audit.table_name = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_TABLE}
                AND current_audit.context = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_CONTEXT}
                AND NOT EXISTS (
                  SELECT 1 FROM audit_logs AS competing
                  WHERE competing.table_name = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_TABLE}
                    AND competing.target_id = current_audit.target_id
                    AND competing.context = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_CONTEXT}
                    AND (
                      competing.created_at > current_audit.created_at
                      OR (
                        competing.created_at = current_audit.created_at
                        AND competing.id <> current_audit.id
                      )
                    )
                )
            ) = 1
          THEN 1 ELSE json_extract('legacy_import_event_snapshot_mismatch', '$') END
        `)]
      : []),
    existing
      ? db.update(events)
          .set({
            title: event.title,
            event_type: event.event_type,
            explanation: event.explanation,
            icon_url: event.icon_url,
            img_url: event.img_url,
            visibility_status: event.visibility_status,
            start_time: event.start_time,
            end_time: event.end_time,
            updated_at: now,
          })
          .where(and(eq(events.id, event.id), expectedRowCondition({ expectedCurrent: existing })))
      : db.run(sql`
          INSERT INTO events (
            id, title, event_type, explanation, icon_url, img_url, accent_color,
            visibility_status, allow_user_video_event_links, allow_unslotted_posts,
            allow_user_video_edits, slot_type, slot_visibility_mode, start_time, end_time,
            entry_start_time, entry_end_time, created_at, updated_at, max_slots_per_video,
            slot_part_gap_minutes, public_api_enabled
          ) VALUES (
            ${event.id}, ${event.title}, ${event.event_type}, ${event.explanation}, ${event.icon_url},
            ${event.img_url}, NULL, ${event.visibility_status}, 0, 0, 0, 'time', 'public_name',
            ${event.start_time}, ${event.end_time}, NULL, NULL, ${now}, ${now}, 1, 15, 0
          )
        `),
    ...visibilityTransition.mutationStatements,
    ...(existing && beforeStaff.length > 0
      ? [db.run(sql`DELETE FROM event_staff WHERE event_id = ${event.id}`)]
      : []),
    ...(nextStaff.length > 0
      ? [db.run(sql`
          INSERT INTO event_staff (
            id, event_id, x_user_id, display_name, permission_preset,
            custom_permission_keys_json, is_public, public_role_label,
            approved_by_auth_user_id, approved_at, created_at, updated_at
          )
          SELECT
            json_extract(value, '$.id'), json_extract(value, '$.event_id'),
            json_extract(value, '$.x_user_id'), json_extract(value, '$.display_name'),
            json_extract(value, '$.permission_preset'), json_extract(value, '$.custom_permission_keys_json'),
            json_extract(value, '$.is_public'), json_extract(value, '$.public_role_label'),
            json_extract(value, '$.approved_by_auth_user_id'), json_extract(value, '$.approved_at'),
            json_extract(value, '$.created_at'), json_extract(value, '$.updated_at')
          FROM json_each(${payload})
        `)]
      : []),
    rebuildQueue.statement,
  ];
  const expected = [
    ...(existing ? [null] : []),
    1,
    ...visibilityTransition.expectedMutationChanges,
    ...(existing && beforeStaff.length > 0 ? [beforeStaff.length] : []),
    ...(nextStaff.length > 0 ? [nextStaff.length] : []),
    rebuildQueue.expectedChanges,
  ];
  if (visibilityTransition.fenceToken) {
    try {
      await preCommitEventVisibilityTransition({
        eventId: event.id,
        fenceToken: visibilityTransition.fenceToken,
        reason: "legacy_import_visibility",
      });
    } catch (error) {
      try {
        await compensateEventVisibilityFenceOnD1Failure(db, {
          eventId: event.id,
          fenceToken: visibilityTransition.fenceToken,
          allowNonPublicRollback: !visibilityTransition.depublicizedFromPublic,
        });
      } catch (compensationError) {
        console.warn("[legacy-import] event visibility precommit compensation failed", compensationError);
      }
      throw error;
    }
  }
  try {
    await mutateWithAudit(db, {
      mutationStatements,
      expectedMutationChanges: expected,
      audits: [
      {
        table_name: "events",
        target_id: event.id,
        operation: existing ? "UPDATE" : "CREATE",
        before: existing,
        after: { ...event, staff: staffRows },
        actor_user_id: options.actorAuthUserId,
        reason: "旧形式イベントを新正本へ変換",
        context: "legacy_import",
        retention_class: "long_audit",
        restore_strategy: existing ? "none" : "delete_created",
      },
      {
        table_name: LEGACY_ENTITY_SNAPSHOT_AUDIT_TABLE,
        target_id: snapshotTargetId,
        operation: "SYSTEM",
        before: null,
        after: {
          entity_kind: "event",
          managed_digest: nextManagedEventDigest,
          staff_digest: nextStaffDigest,
        },
        actor_user_id: options.actorAuthUserId,
        reason: "旧形式イベントの置換可能snapshotを確定",
        context: LEGACY_ENTITY_SNAPSHOT_AUDIT_CONTEXT,
        retention_class: "long_audit",
        restore_strategy: "none",
        strict: true,
      },
      ...(options.marker
        ? [stepMarkerAudit(
            options.marker({ kind: "event", action: existing ? "replaced" : "created" }),
            options.actorAuthUserId,
          )]
        : []),
      ],
      staticRebuildWakeSource: "import",
    });
  } catch (error) {
    if (visibilityTransition.fenceToken) {
      try {
        await compensateEventVisibilityFenceOnD1Failure(db, {
          eventId: event.id,
          fenceToken: visibilityTransition.fenceToken,
          allowNonPublicRollback: !visibilityTransition.depublicizedFromPublic,
        });
      } catch (compensationError) {
        console.warn("[legacy-import] event visibility mutation compensation failed", compensationError);
      }
    }
    throw error;
  }
  if (visibilityTransition.fenceToken) {
    await deletePublicJsonCaches([
      eventComposedObjectKey(event.id),
      eventBaseObjectKey(event.id),
      eventSlotsObjectKey(event.id),
      eventReleaseObjectKey(event.id),
    ]);
    await invalidateEventExportCache(event.id);
  }
  return existing ? "replaced" : "created";
}

function parseJsonArray<T>(raw: string | null): T[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("旧形式インポートのDB snapshotが不正です。");
  return parsed as T[];
}

async function loadVideoSupportSnapshot(
  db: DB,
  videoId: string,
  relationIds: readonly string[],
  softwareLabels: readonly string[],
): Promise<{
  existingVideo: typeof videos.$inferSelect | null;
  relationEventCount: number;
  beforeEventCount: number;
  beforeMemberCount: number;
  beforeChapterCount: number;
  beforeSoftwareCount: number;
  beforeMetadataCount: number;
  beforeEvents: Array<typeof videoEvents.$inferSelect>;
  beforeMembers: Array<typeof videoMembers.$inferSelect>;
  beforeChapters: Array<typeof videoChapters.$inferSelect>;
  beforeSoftwares: Array<typeof videoSoftwares.$inferSelect>;
  beforeMetadata: Array<typeof videoYoutubeMetadata.$inferSelect>;
  beforeCustomAnswers: ExistingCustomAnswer[];
  latestVideoAudits: EventAuditProof[];
  softwareIds: Map<string, string>;
}> {
  const relationPayload = JSON.stringify([...new Set(relationIds)]);
  const normalizedSoftwareNames = [...new Set(
    softwareLabels.map(normalizeSoftwareName).filter(Boolean),
  )];
  const softwarePayload = JSON.stringify(normalizedSoftwareNames);
  const snapshotTargetId = entitySnapshotTargetId("video", videoId);
  const [snapshot] = await db
    .select({
      existingVideo: { ...getTableColumns(videos) },
      relationEventCount: sql<number>`(
        SELECT COUNT(*) FROM events
        WHERE id IN (SELECT value FROM json_each(${relationPayload}))
      )`,
      eventsJson: sql<string>`COALESCE((
        SELECT json_group_array(json_object(
          'video_id', current.video_id,
          'event_id', current.event_id
        ))
        FROM (
          SELECT * FROM video_events WHERE video_id = ${videoId} ORDER BY event_id
        ) AS current
      ), '[]')`,
      membersJson: sql<string>`COALESCE((
        SELECT json_group_array(json_object(
          'id', current.id,
          'video_id', current.video_id,
          'x_user_id', current.x_user_id,
          'name', current.name,
          'role', current.role,
          'comment', current.comment,
          'order_index', current.order_index,
          'can_edit', current.can_edit,
          'is_public_member', current.is_public_member,
          'edit_granted_by_auth_user_id', current.edit_granted_by_auth_user_id,
          'edit_granted_at', current.edit_granted_at,
          'edit_updated_at', current.edit_updated_at
        ))
        FROM (
          SELECT * FROM video_members WHERE video_id = ${videoId} ORDER BY id
        ) AS current
      ), '[]')`,
      chaptersJson: sql<string>`COALESCE((
        SELECT json_group_array(json_object(
          'id', current.id,
          'video_id', current.video_id,
          'x_user_id', current.x_user_id,
          'chapter_time', current.chapter_time,
          'chapter_label', current.chapter_label,
          'note', current.note,
          'visibility', current.visibility,
          'created_at', current.created_at,
          'updated_at', current.updated_at
        ))
        FROM (
          SELECT * FROM video_chapters WHERE video_id = ${videoId} ORDER BY id
        ) AS current
      ), '[]')`,
      softwaresJson: sql<string>`COALESCE((
        SELECT json_group_array(json_object(
          'video_id', current.video_id,
          'software_id', current.software_id,
          'raw_label', current.raw_label
        ))
        FROM (
          SELECT * FROM video_softwares WHERE video_id = ${videoId} ORDER BY software_id
        ) AS current
      ), '[]')`,
      metadataJson: sql<string>`COALESCE((
        SELECT json_group_array(json_object(
          'video_id', current.video_id,
          'youtube_privacy_status', current.youtube_privacy_status,
          'youtube_availability_status', current.youtube_availability_status,
          'duration_seconds', current.duration_seconds,
          'view_count', current.view_count,
          'synced_at', current.synced_at,
          'sync_status', current.sync_status,
          'sync_error', current.sync_error,
          'updated_at', current.updated_at
        ))
        FROM (
          SELECT * FROM video_youtube_metadata WHERE video_id = ${videoId}
        ) AS current
      ), '[]')`,
      answersJson: sql<string>`COALESCE((
        SELECT json_group_array(json_object(
          'video_id', current.video_id,
          'event_id', current.event_id,
          'question_id', current.question_id,
          'answer_text', current.answer_text,
          'answer_json', current.answer_json,
          'created_at', current.created_at,
          'updated_at', current.updated_at
        ))
        FROM (
          SELECT * FROM video_custom_answers
          WHERE video_id = ${videoId}
          ORDER BY event_id, question_id
          LIMIT ${MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO + 1}
        ) AS current
      ), '[]')`,
      softwareJson: sql<string>`COALESCE((
        SELECT json_group_array(json_object(
          'id', id,
          'normalized_name', normalized_name
        ))
        FROM software_catalog
        WHERE normalized_name IN (SELECT value FROM json_each(${softwarePayload}))
      ), '[]')`,
      latestVideoAuditJson: sql<string>`COALESCE((
        SELECT json_group_array(json_object(
          'id', latest.id,
          'target_id', latest.target_id,
          'context', latest.context,
          'after_json', latest.after_json,
          'created_at', latest.created_at
        ))
        FROM (
          SELECT id, target_id, context, after_json, created_at
          FROM audit_logs
          WHERE table_name = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_TABLE}
            AND target_id = ${snapshotTargetId}
            AND context = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_CONTEXT}
            AND created_at = (
              SELECT MAX(candidate.created_at)
              FROM audit_logs AS candidate
              WHERE candidate.table_name = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_TABLE}
                AND candidate.target_id = ${snapshotTargetId}
                AND candidate.context = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_CONTEXT}
            )
          ORDER BY id
          LIMIT 2
        ) AS latest
      ), '[]')`,
    })
    .from(sql`(SELECT 1) AS legacy_import_snapshot`)
    .leftJoin(videos, eq(videos.id, videoId))
    .limit(1);
  if (!snapshot) throw new Error("作品適用前のDB snapshotを取得できませんでした。");
  const softwareRows = parseJsonArray<{ id: string; normalized_name: string }>(snapshot.softwareJson);
  const beforeEvents = parseJsonArray<typeof videoEvents.$inferSelect>(snapshot.eventsJson);
  const beforeMembers = parseJsonArray<typeof videoMembers.$inferSelect>(snapshot.membersJson);
  const beforeChapters = parseJsonArray<typeof videoChapters.$inferSelect>(snapshot.chaptersJson);
  const beforeSoftwares = parseJsonArray<typeof videoSoftwares.$inferSelect>(snapshot.softwaresJson);
  const beforeMetadata = parseJsonArray<typeof videoYoutubeMetadata.$inferSelect>(snapshot.metadataJson);
  return {
    existingVideo: snapshot.existingVideo,
    relationEventCount: Number(snapshot.relationEventCount),
    beforeEventCount: beforeEvents.length,
    beforeMemberCount: beforeMembers.length,
    beforeChapterCount: beforeChapters.length,
    beforeSoftwareCount: beforeSoftwares.length,
    beforeMetadataCount: beforeMetadata.length,
    beforeEvents,
    beforeMembers,
    beforeChapters,
    beforeSoftwares,
    beforeMetadata,
    beforeCustomAnswers: parseJsonArray<ExistingCustomAnswer>(snapshot.answersJson),
    latestVideoAudits: parseJsonArray<EventAuditProof>(snapshot.latestVideoAuditJson),
    softwareIds: new Map(softwareRows.map((row) => [row.normalized_name, row.id])),
  };
}

function managedVideoSnapshot(
  video: Pick<
    typeof videos.$inferSelect,
    "id" | "primary_event_id" | "creator_x_user_id" | "submitted_by_user_id" |
    "collaboration_type" | "part" | "source_type" | "creator_display_name" |
    "creator_display_name_yomi" | "creator_icon_url" | "creator_youtube_channel_url" |
    "creator_profile_text" | "creator_other_social_links" |
    "title" | "music" | "credit" | "music_reference_url" | "closing_comment" |
    "youtube_video_id" | "intro_comment" | "highlights" | "production_story" |
    "visibility_status" | "scheduling_type" | "scheduled_time" | "created_at"
  >,
) {
  return {
    id: video.id,
    primary_event_id: video.primary_event_id,
    creator_x_user_id: video.creator_x_user_id,
    submitted_by_user_id: video.submitted_by_user_id,
    collaboration_type: video.collaboration_type,
    part: video.part,
    source_type: video.source_type,
    creator_display_name: video.creator_display_name,
    creator_display_name_yomi: video.creator_display_name_yomi,
    creator_icon_url: video.creator_icon_url,
    creator_youtube_channel_url: video.creator_youtube_channel_url,
    creator_profile_text: video.creator_profile_text,
    creator_other_social_links: video.creator_other_social_links,
    title: video.title,
    music: video.music,
    credit: video.credit,
    music_reference_url: video.music_reference_url,
    closing_comment: video.closing_comment,
    youtube_video_id: video.youtube_video_id,
    intro_comment: video.intro_comment,
    highlights: video.highlights,
    production_story: video.production_story,
    visibility_status: video.visibility_status,
    scheduling_type: video.scheduling_type,
    scheduled_time: video.scheduled_time,
    created_at: video.created_at,
  };
}

async function videoMatchesAuditSnapshot(
  current: typeof videos.$inferSelect,
  support: Awaited<ReturnType<typeof loadVideoSupportSnapshot>>,
  raw: string | null,
): Promise<boolean> {
  if (!raw) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const after = parsed as Record<string, unknown>;
  const [managed, eventRows, memberRows, chapterRows, softwareRows, metadataRows, answerRows] =
    await Promise.all([
      snapshotDigest(managedVideoSnapshot(current)),
      snapshotDigest(support.beforeEvents),
      snapshotDigest(support.beforeMembers),
      snapshotDigest(support.beforeChapters),
      snapshotDigest(support.beforeSoftwares),
      snapshotDigest(support.beforeMetadata),
      snapshotDigest(support.beforeCustomAnswers),
    ]);
  return (
    after.managed_digest === managed &&
    after.events_digest === eventRows &&
    after.members_digest === memberRows &&
    after.chapters_digest === chapterRows &&
    after.softwares_digest === softwareRows &&
    after.metadata_digest === metadataRows &&
    after.custom_answers_digest === answerRows
  );
}

function resolveLegacyCreatorSnapshot(
  video: Pick<
    CanonicalLegacyPlan["videos"][number],
    "creator_profile_text" | "creator_other_social_links" | "creator_x_user_id"
  >,
  xUser: Pick<typeof xUsers.$inferSelect, "profile_text" | "other_social_links"> | null,
): Pick<typeof videos.$inferSelect, "creator_profile_text" | "creator_other_social_links"> {
  return {
    creator_profile_text: video.creator_profile_text ?? xUser?.profile_text ?? null,
    creator_other_social_links: video.creator_other_social_links ?? xUser?.other_social_links ?? null,
  };
}

async function applyVideo(
  db: DB,
  video: CanonicalLegacyPlan["videos"][number],
  relations: CanonicalLegacyPlan["videoEvents"],
  members: CanonicalLegacyPlan["videoMembers"],
  chapters: CanonicalLegacyPlan["videoChapters"],
  softwareLabels: CanonicalLegacyPlan["videoSoftwares"],
  customAnswers: CanonicalLegacyPlan["videoCustomAnswers"],
  plannedQuestions: readonly PlannedQuestion[],
  expectedExistingForSkip: boolean,
  options: ApplyOptions,
  wakeSentKinds?: Set<QueueWakeKind>,
): Promise<"created" | "replaced" | "skipped"> {
  const support = await loadVideoSupportSnapshot(
    db,
    video.id,
    relations.map((relation) => relation.event_id),
    softwareLabels.map((row) => row.label),
  );
  const existing = support.existingVideo;
  if (options.strategy === "skip_existing") {
    if (expectedExistingForSkip && !existing) {
      throw new Error(`作品 ${video.id} はプレビュー時点から削除されたため、再プレビューが必要です。`);
    }
    if (!expectedExistingForSkip && existing) {
      throw new Error(`作品 ${video.id} はプレビュー後に作成されたため、再プレビューが必要です。`);
    }
    if (expectedExistingForSkip) {
      if (options.marker) {
        await writeStepMarkerOnly(
          db,
          options.marker({ kind: "video", action: "skipped" }),
          options.actorAuthUserId,
        );
      }
      return "skipped";
    }
  }
  if (existing && options.strategy === "create_only") throw new Error(`作品 ${video.id} は既に存在します。`);
  if (existing && existing.submitted_by_user_id !== LEGACY_IMPORT_SYSTEM_USER_ID) {
    throw new Error(`作品 ${video.id} は旧形式インポート由来ではないため置換できません。`);
  }
  const videoAuditProof = existing && support.latestVideoAudits.length === 1
    ? support.latestVideoAudits[0]
    : null;
  const videoAuditSnapshotMatches = existing && videoAuditProof
    ? await videoMatchesAuditSnapshot(existing, support, videoAuditProof.after_json)
    : false;
  if (
    existing &&
    (!videoAuditProof ||
      videoAuditProof.context !== LEGACY_ENTITY_SNAPSHOT_AUDIT_CONTEXT ||
      !videoAuditSnapshotMatches)
  ) {
    throw new Error(`作品 ${video.id} の最新状態を旧形式インポート由来と確認できないため置換できません。`);
  }
  if (support.relationEventCount !== new Set(relations.map((row) => row.event_id)).size) {
    throw new Error(`作品 ${video.id} の所属イベントが存在しません。`);
  }
  const beforeCustomAnswers = support.beforeCustomAnswers;
  if (beforeCustomAnswers.length > MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO) {
    throw new Error(
      `作品 ${video.id} の既存カスタム質問回答が最大${MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO}件を超えています。`,
    );
  }
  if (!existing && beforeCustomAnswers.length > 0) {
    throw new Error(`作品 ${video.id} のカスタム質問回答が既に存在します。`);
  }

  const [creatorXUser] = video.creator_x_user_id
    ? await db
        .select({
          profile_text: xUsers.profile_text,
          other_social_links: xUsers.other_social_links,
        })
        .from(xUsers)
        .where(eq(xUsers.id, video.creator_x_user_id))
        .limit(1)
    : [];
  const creatorSnapshot = resolveLegacyCreatorSnapshot(video, creatorXUser ?? null);

  const softwareRows = softwareLabels.map((row) => {
    const normalized = normalizeSoftwareName(row.label);
    const softwareId = support.softwareIds.get(normalized);
    if (!softwareId) throw new Error(`使用ソフト「${row.label}」がcatalogに存在しません。`);
    return { video_id: video.id, software_id: softwareId, raw_label: row.label };
  });

  const now = Math.floor(Date.now() / 1000);
  const nextEvents = [...relations].sort((left, right) => left.event_id.localeCompare(right.event_id));
  const nextMembers: Array<typeof videoMembers.$inferSelect> = members
    .map((row) => ({
      id: row.id,
      video_id: row.video_id,
      x_user_id: row.x_user_id,
      name: row.name,
      role: row.role,
      comment: null,
      order_index: row.order_index,
      can_edit: 0,
      is_public_member: 1,
      edit_granted_by_auth_user_id: null,
      edit_granted_at: null,
      edit_updated_at: null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const nextChapters: Array<typeof videoChapters.$inferSelect> = chapters
    .map((row) => ({
      id: row.id,
      video_id: row.video_id,
      x_user_id: row.x_user_id,
      chapter_time: row.chapter_time,
      chapter_label: row.chapter_label,
      note: row.note,
      visibility: "public" as const,
      created_at: now,
      updated_at: now,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const nextSoftwares = [...softwareRows]
    .sort((left, right) => left.software_id.localeCompare(right.software_id));
  const nextMetadata: Array<typeof videoYoutubeMetadata.$inferSelect> = video.youtube_video_id
    ? [{
        video_id: video.id,
        youtube_privacy_status: null,
        youtube_availability_status: null,
        duration_seconds: null,
        view_count: 0,
        synced_at: null,
        sync_status: "pending",
        sync_error: null,
        updated_at: now,
      }]
    : [];
  const rebuildEventIds = [...new Set(
    [video.primary_event_id, ...nextEvents.map((row) => row.event_id)]
      .filter((eventId): eventId is string => !!eventId),
  )];
  const visibilityTransition = existing
    ? planVideoVisibilityFenceTransition(db, {
        videoId: video.id,
        previousStatus: existing.visibility_status,
        nextStatus: video.visibility_status,
        actorUserId: options.actorAuthUserId,
        reason: "legacy_import_visibility",
        now,
      })
    : {
        mutationStatements: [],
        expectedMutationChanges: [],
        fenceToken: null,
        depublicizedFromPublic: false,
      };
  const videoRebuildReason = visibilityTransition.fenceToken
    ? "video_visibility_update"
    : undefined;
  const rebuildQueue = legacyRebuildQueueMutation(
    db,
    [
      { targetType: "video", targetId: video.id, priority: "high", reason: videoRebuildReason },
      { targetType: "top_recommended", targetId: "global", priority: "normal" },
      { targetType: "top_latest", targetId: "global", priority: "normal" },
      { targetType: "top_nostalgic", targetId: "global", priority: "normal" },
      { targetType: "top_stats", targetId: "global", priority: "normal" },
      { targetType: "recommend_core", targetId: "global", priority: "normal" },
      { targetType: "list_recent", targetId: "global", priority: "normal" },
      { targetType: "list_popular", targetId: "global", priority: "normal" },
      { targetType: "search_index", targetId: "global", priority: "normal" },
      ...(video.creator_x_user_id
        ? [{ targetType: "user" as const, targetId: video.creator_x_user_id, priority: "normal" as const }]
        : []),
      ...rebuildEventIds.flatMap((eventId) => [
        {
          targetType: "event_base" as const,
          targetId: eventId,
          priority: "high" as const,
          reason: videoRebuildReason,
        },
        {
          targetType: "event_slots" as const,
          targetId: eventId,
          priority: "high" as const,
          reason: videoRebuildReason,
        },
        {
          targetType: "event_release" as const,
          targetId: eventId,
          priority: "high" as const,
          reason: videoRebuildReason,
        },
      ]),
    ],
    options,
    now,
  );
  const relationPayload = JSON.stringify(nextEvents);
  const memberPayload = JSON.stringify(nextMembers);
  const chapterPayload = JSON.stringify(nextChapters);
  const softwarePayload = JSON.stringify(nextSoftwares);
  const existingCustomAnswersByKey = new Map(
    beforeCustomAnswers.map((answer) => [
      answerKey(answer.video_id, answer.event_id, answer.question_id),
      answer,
    ]),
  );
  const replacedCustomAnswers: Array<{
    before: typeof videoCustomAnswers.$inferSelect;
    after: typeof videoCustomAnswers.$inferSelect;
  }> = [];
  const createdCustomAnswers: Array<typeof videoCustomAnswers.$inferSelect> = [];
  for (const answer of customAnswers) {
    const key = answerKey(answer.video_id, answer.event_id, answer.question_id);
    const before = existingCustomAnswersByKey.get(key);
    if (before && before.answer_text === answer.answer_text && before.answer_json === answer.answer_json) {
      continue;
    }
    const after = {
      video_id: answer.video_id,
      event_id: answer.event_id,
      question_id: answer.question_id,
      answer_text: answer.answer_text,
      answer_json: answer.answer_json,
      created_at: before?.created_at ?? now,
      updated_at: now,
    } satisfies typeof videoCustomAnswers.$inferSelect;
    if (before) replacedCustomAnswers.push({ before, after });
    else createdCustomAnswers.push(after);
  }
  if (replacedCustomAnswers.length > 0) {
    if (options.strategy !== "replace_imported") {
      throw new Error(`作品 ${video.id} のカスタム質問回答は既に存在します。`);
    }
  }
  const postAnswerRows = new Map<string, { event_id: string; question_id: string }>(
    beforeCustomAnswers.map((answer) => [
      answerKey(answer.video_id, answer.event_id, answer.question_id),
      answer,
    ]),
  );
  customAnswers.forEach((answer) => {
    postAnswerRows.set(answerKey(answer.video_id, answer.event_id, answer.question_id), answer);
  });
  if (postAnswerRows.size > MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO) {
    throw new Error(
      `作品 ${video.id} の既存分を含むカスタム質問回答が最大${MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO}件を超えます。`,
    );
  }
  const nextEventIds = new Set(relations.map((relation) => relation.event_id));
  for (const answer of postAnswerRows.values()) {
    if (!nextEventIds.has(answer.event_id)) {
      throw new Error(
        `作品 ${video.id} のカスタム質問回答 ${answer.question_id} は適用後のイベント関連に含まれません。`,
      );
    }
  }
  const auditProofs = await latestImportedCustomAnswerProofs(
    db,
    replacedCustomAnswers.map(({ before }) => before),
  );
  const customAnswerRows = [
    ...replacedCustomAnswers.map(({ after }) => after),
    ...createdCustomAnswers,
  ];
  const nextCustomAnswersByKey = new Map(
    beforeCustomAnswers.map((answer) => [
      answerKey(answer.video_id, answer.event_id, answer.question_id),
      answer,
    ]),
  );
  customAnswerRows.forEach((answer) => {
    nextCustomAnswersByKey.set(
      answerKey(answer.video_id, answer.event_id, answer.question_id),
      answer,
    );
  });
  const nextCustomAnswers = [...nextCustomAnswersByKey.values()].sort((left, right) =>
    left.event_id.localeCompare(right.event_id) || left.question_id.localeCompare(right.question_id),
  );
  const plannedQuestionsById = new Map(plannedQuestions.map((question) => [question.id, question]));
  const questionSnapshotRows = [...new Set(customAnswers.map((answer) => answer.question_id))].map(
    (questionId) => {
      const snapshot = plannedQuestionsById.get(questionId);
      if (!snapshot) throw new Error(`カスタム質問 ${questionId} のsnapshotがありません。`);
      return snapshot;
    },
  );
  const questionSnapshotPayload = JSON.stringify(questionSnapshotRows);
  const answerSnapshotPayload = JSON.stringify(beforeCustomAnswers);
  const auditProofPayload = JSON.stringify([...auditProofs.values()]);
  const beforeEventsPayload = JSON.stringify(support.beforeEvents);
  const beforeMembersPayload = JSON.stringify(support.beforeMembers);
  const beforeChaptersPayload = JSON.stringify(support.beforeChapters);
  const beforeSoftwaresPayload = JSON.stringify(support.beforeSoftwares);
  const beforeMetadataPayload = JSON.stringify(support.beforeMetadata);
  const videoAuditProofPayload = JSON.stringify(videoAuditProof ? [videoAuditProof] : []);
  const snapshotTargetId = entitySnapshotTargetId("video", video.id);
  const nextManagedVideo = managedVideoSnapshot({
    ...video,
    ...creatorSnapshot,
    submitted_by_user_id: LEGACY_IMPORT_SYSTEM_USER_ID,
    part: null,
    scheduling_type: "manual",
    created_at: existing?.created_at ?? video.created_at,
  });
  const [
    nextManagedVideoDigest,
    nextEventsDigest,
    nextMembersDigest,
    nextChaptersDigest,
    nextSoftwaresDigest,
    nextMetadataDigest,
    nextCustomAnswersDigest,
  ] = await Promise.all([
    snapshotDigest(nextManagedVideo),
    snapshotDigest(nextEvents),
    snapshotDigest(nextMembers),
    snapshotDigest(nextChapters),
    snapshotDigest(nextSoftwares),
    snapshotDigest(nextMetadata),
    snapshotDigest(nextCustomAnswers),
  ]);
  const videoSnapshotCondition = existing
    ? sql`
        COALESCE((
          SELECT json_group_array(json_object(
            'video_id', current.video_id,
            'event_id', current.event_id
          ))
          FROM (
            SELECT * FROM video_events WHERE video_id = ${video.id} ORDER BY event_id
          ) AS current
        ), '[]') = ${beforeEventsPayload}
        AND COALESCE((
          SELECT json_group_array(json_object(
            'id', current.id,
            'video_id', current.video_id,
            'x_user_id', current.x_user_id,
            'name', current.name,
            'role', current.role,
            'comment', current.comment,
            'order_index', current.order_index,
            'can_edit', current.can_edit,
            'is_public_member', current.is_public_member,
            'edit_granted_by_auth_user_id', current.edit_granted_by_auth_user_id,
            'edit_granted_at', current.edit_granted_at,
            'edit_updated_at', current.edit_updated_at
          ))
          FROM (
            SELECT * FROM video_members WHERE video_id = ${video.id} ORDER BY id
          ) AS current
        ), '[]') = ${beforeMembersPayload}
        AND COALESCE((
          SELECT json_group_array(json_object(
            'id', current.id,
            'video_id', current.video_id,
            'x_user_id', current.x_user_id,
            'chapter_time', current.chapter_time,
            'chapter_label', current.chapter_label,
            'note', current.note,
            'visibility', current.visibility,
            'created_at', current.created_at,
            'updated_at', current.updated_at
          ))
          FROM (
            SELECT * FROM video_chapters WHERE video_id = ${video.id} ORDER BY id
          ) AS current
        ), '[]') = ${beforeChaptersPayload}
        AND COALESCE((
          SELECT json_group_array(json_object(
            'video_id', current.video_id,
            'software_id', current.software_id,
            'raw_label', current.raw_label
          ))
          FROM (
            SELECT * FROM video_softwares WHERE video_id = ${video.id} ORDER BY software_id
          ) AS current
        ), '[]') = ${beforeSoftwaresPayload}
        AND COALESCE((
          SELECT json_group_array(json_object(
            'video_id', current.video_id,
            'youtube_privacy_status', current.youtube_privacy_status,
            'youtube_availability_status', current.youtube_availability_status,
            'duration_seconds', current.duration_seconds,
            'view_count', current.view_count,
            'synced_at', current.synced_at,
            'sync_status', current.sync_status,
            'sync_error', current.sync_error,
            'updated_at', current.updated_at
          ))
          FROM (
            SELECT * FROM video_youtube_metadata WHERE video_id = ${video.id}
          ) AS current
        ), '[]') = ${beforeMetadataPayload}
        AND (
          SELECT COUNT(*)
          FROM audit_logs AS current_audit
          INNER JOIN json_each(${videoAuditProofPayload}) AS proof
            ON current_audit.id = json_extract(proof.value, '$.id')
           AND current_audit.target_id = json_extract(proof.value, '$.target_id')
           AND current_audit.context IS json_extract(proof.value, '$.context')
           AND current_audit.after_json IS json_extract(proof.value, '$.after_json')
           AND current_audit.created_at = json_extract(proof.value, '$.created_at')
          WHERE current_audit.table_name = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_TABLE}
            AND current_audit.context = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_CONTEXT}
            AND NOT EXISTS (
              SELECT 1 FROM audit_logs AS competing
              WHERE competing.table_name = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_TABLE}
                AND competing.target_id = current_audit.target_id
                AND competing.context = ${LEGACY_ENTITY_SNAPSHOT_AUDIT_CONTEXT}
                AND (
                  competing.created_at > current_audit.created_at
                  OR (
                    competing.created_at = current_audit.created_at
                    AND competing.id <> current_audit.id
                  )
                )
            )
        ) = 1
      `
    : sql`1 = 1`;
  const statements = [
    existing
      ? db.update(videos)
          .set({
            primary_event_id: video.primary_event_id,
            creator_x_user_id: video.creator_x_user_id,
            submitted_by_user_id: LEGACY_IMPORT_SYSTEM_USER_ID,
            collaboration_type: video.collaboration_type,
            part: null,
            source_type: video.source_type,
            creator_display_name: video.creator_display_name,
            creator_display_name_yomi: video.creator_display_name_yomi,
            creator_icon_url: video.creator_icon_url,
            creator_youtube_channel_url: video.creator_youtube_channel_url,
            creator_profile_text: creatorSnapshot.creator_profile_text,
            creator_other_social_links: creatorSnapshot.creator_other_social_links,
            title: video.title,
            music: video.music,
            credit: video.credit,
            music_reference_url: video.music_reference_url,
            closing_comment: video.closing_comment,
            youtube_video_id: video.youtube_video_id,
            intro_comment: video.intro_comment,
            highlights: video.highlights,
            production_story: video.production_story,
            visibility_status: video.visibility_status,
            scheduling_type: "manual",
            scheduled_time: video.scheduled_time,
            updated_at: now,
          })
          .where(and(eq(videos.id, video.id), expectedRowCondition({ expectedCurrent: existing })))
      : db.run(sql`
          INSERT INTO videos (
            id, primary_event_id, creator_x_user_id, submitted_by_user_id, collaboration_type,
            part, source_type, creator_display_name, creator_display_name_yomi, creator_icon_url,
            creator_youtube_channel_url, creator_profile_text, creator_other_social_links,
            title, music, credit, music_reference_url, closing_comment,
            youtube_video_id, intro_comment, highlights, production_story, visibility_status,
            scheduling_type, scheduled_time, app_like_count, score, score_updated_at, created_at, updated_at
          ) VALUES (
            ${video.id}, ${video.primary_event_id}, ${video.creator_x_user_id},
            ${LEGACY_IMPORT_SYSTEM_USER_ID}, ${video.collaboration_type}, NULL, ${video.source_type},
            ${video.creator_display_name}, ${video.creator_display_name_yomi}, ${video.creator_icon_url},
            ${video.creator_youtube_channel_url}, ${creatorSnapshot.creator_profile_text},
            ${creatorSnapshot.creator_other_social_links}, ${video.title}, ${video.music}, ${video.credit},
            ${video.music_reference_url}, ${video.closing_comment}, ${video.youtube_video_id},
            ${video.intro_comment}, ${video.highlights}, ${video.production_story},
            ${video.visibility_status}, 'manual', ${video.scheduled_time}, 0, 0, NULL,
            ${video.created_at}, ${now}
          )
        `),
    ...visibilityTransition.mutationStatements,
    ...(questionSnapshotRows.length
      ? [db.run(sql`
          SELECT CASE WHEN (
            SELECT COUNT(*)
            FROM event_custom_questions AS q
            INNER JOIN json_each(${questionSnapshotPayload}) AS incoming
              ON q.id = json_extract(incoming.value, '$.id')
            WHERE q.event_id = json_extract(incoming.value, '$.event_id')
              AND q.question_key = json_extract(incoming.value, '$.question_key')
              AND q.label = json_extract(incoming.value, '$.label')
              AND q.description IS json_extract(incoming.value, '$.description')
              AND q.type = json_extract(incoming.value, '$.type')
              AND q.required = json_extract(incoming.value, '$.required')
              AND q.options_json IS json_extract(incoming.value, '$.options_json')
              AND q.placeholder IS json_extract(incoming.value, '$.placeholder')
              AND q.max_length IS json_extract(incoming.value, '$.max_length')
              AND q.sort_order = json_extract(incoming.value, '$.sort_order')
              AND q.is_active = json_extract(incoming.value, '$.is_active')
              AND q.visibility = json_extract(incoming.value, '$.visibility')
          ) = json_array_length(${questionSnapshotPayload})
          THEN 1 ELSE json_extract('legacy_import_question_snapshot_mismatch', '$') END
        `)]
      : []),
    db.run(sql`
      SELECT CASE WHEN
        ${videoSnapshotCondition}
        AND (SELECT COUNT(*) FROM video_custom_answers WHERE video_id = ${video.id})
          = json_array_length(${answerSnapshotPayload})
        AND (
          SELECT COUNT(*)
          FROM video_custom_answers AS current
          INNER JOIN json_each(${answerSnapshotPayload}) AS incoming
            ON current.video_id = json_extract(incoming.value, '$.video_id')
           AND current.event_id = json_extract(incoming.value, '$.event_id')
           AND current.question_id = json_extract(incoming.value, '$.question_id')
           AND current.answer_text IS json_extract(incoming.value, '$.answer_text')
           AND current.answer_json IS json_extract(incoming.value, '$.answer_json')
           AND current.created_at = json_extract(incoming.value, '$.created_at')
           AND current.updated_at = json_extract(incoming.value, '$.updated_at')
          WHERE current.video_id = ${video.id}
        ) = json_array_length(${answerSnapshotPayload})
        AND (
          SELECT COUNT(*)
          FROM audit_logs AS current_audit
          INNER JOIN json_each(${auditProofPayload}) AS proof
            ON current_audit.id = json_extract(proof.value, '$.id')
           AND current_audit.target_id = json_extract(proof.value, '$.target_id')
           AND current_audit.context IS json_extract(proof.value, '$.context')
           AND current_audit.after_json IS json_extract(proof.value, '$.after_json')
           AND current_audit.created_at = json_extract(proof.value, '$.created_at')
          WHERE current_audit.table_name = 'video_custom_answers'
            AND NOT EXISTS (
              SELECT 1 FROM audit_logs AS competing
              WHERE competing.table_name = 'video_custom_answers'
                AND competing.target_id = current_audit.target_id
                AND (
                  competing.created_at > current_audit.created_at
                  OR (
                    competing.created_at = current_audit.created_at
                    AND competing.id <> current_audit.id
                  )
                )
            )
        ) = json_array_length(${auditProofPayload})
      THEN 1 ELSE json_extract('legacy_import_custom_answer_snapshot_mismatch', '$') END
    `),
    ...(support.beforeEventCount ? [db.run(sql`DELETE FROM video_events WHERE video_id = ${video.id}`)] : []),
    ...(support.beforeMemberCount ? [db.run(sql`DELETE FROM video_members WHERE video_id = ${video.id}`)] : []),
    ...(support.beforeChapterCount ? [db.run(sql`DELETE FROM video_chapters WHERE video_id = ${video.id}`)] : []),
    ...(support.beforeSoftwareCount ? [db.run(sql`DELETE FROM video_softwares WHERE video_id = ${video.id}`)] : []),
    ...(support.beforeMetadataCount ? [db.run(sql`DELETE FROM video_youtube_metadata WHERE video_id = ${video.id}`)] : []),
    ...(replacedCustomAnswers.length
      ? [db.delete(videoCustomAnswers).where(or(...replacedCustomAnswers.map(({ before }) =>
          and(
            eq(videoCustomAnswers.video_id, before.video_id),
            eq(videoCustomAnswers.event_id, before.event_id),
            eq(videoCustomAnswers.question_id, before.question_id),
            expectedRowCondition({ expectedCurrent: before }),
          ),
        )))]
      : []),
    ...(customAnswerRows.length
      ? [db.insert(videoCustomAnswers).values(customAnswerRows)]
      : []),
    ...(relations.length
      ? [db.run(sql`
          INSERT INTO video_events (video_id, event_id)
          SELECT json_extract(value, '$.video_id'), json_extract(value, '$.event_id')
          FROM json_each(${relationPayload})
        `)]
      : []),
    ...(members.length
      ? [db.run(sql`
          INSERT INTO video_members (
            id, video_id, x_user_id, name, role, comment, order_index,
            can_edit, is_public_member, edit_granted_by_auth_user_id,
            edit_granted_at, edit_updated_at
          )
          SELECT
            json_extract(value, '$.id'), json_extract(value, '$.video_id'),
            json_extract(value, '$.x_user_id'), json_extract(value, '$.name'),
            json_extract(value, '$.role'), NULL, json_extract(value, '$.order_index'),
            0, 1, NULL, NULL, NULL
          FROM json_each(${memberPayload})
        `)]
      : []),
    ...(chapters.length
      ? [db.run(sql`
          INSERT INTO video_chapters (
            id, video_id, x_user_id, chapter_time, chapter_label,
            note, visibility, created_at, updated_at
          )
          SELECT
            json_extract(value, '$.id'), json_extract(value, '$.video_id'),
            json_extract(value, '$.x_user_id'), json_extract(value, '$.chapter_time'),
            json_extract(value, '$.chapter_label'), json_extract(value, '$.note'),
            'public', ${now}, ${now}
          FROM json_each(${chapterPayload})
        `)]
      : []),
    ...(softwareRows.length
      ? [db.run(sql`
          INSERT INTO video_softwares (video_id, software_id, raw_label)
          SELECT
            json_extract(value, '$.video_id'), json_extract(value, '$.software_id'),
            json_extract(value, '$.raw_label')
          FROM json_each(${softwarePayload})
        `)]
      : []),
    ...(video.youtube_video_id
      ? [db.run(sql`
          INSERT INTO video_youtube_metadata (
            video_id, youtube_privacy_status, youtube_availability_status,
            duration_seconds, view_count, synced_at, sync_status, sync_error, updated_at
          ) VALUES (${video.id}, NULL, NULL, NULL, 0, NULL, 'pending', NULL, ${now})
        `)]
      : []),
    rebuildQueue.statement,
  ];
  const expected = [
    1,
    ...visibilityTransition.expectedMutationChanges,
    ...(questionSnapshotRows.length ? [null] : []),
    null,
    ...(support.beforeEventCount ? [support.beforeEventCount] : []),
    ...(support.beforeMemberCount ? [support.beforeMemberCount] : []),
    ...(support.beforeChapterCount ? [support.beforeChapterCount] : []),
    ...(support.beforeSoftwareCount ? [support.beforeSoftwareCount] : []),
    ...(support.beforeMetadataCount ? [support.beforeMetadataCount] : []),
    ...(replacedCustomAnswers.length ? [replacedCustomAnswers.length] : []),
    ...(customAnswerRows.length ? [customAnswerRows.length] : []),
    ...(relations.length ? [relations.length] : []),
    ...(members.length ? [members.length] : []),
    ...(chapters.length ? [chapters.length] : []),
    ...(softwareRows.length ? [softwareRows.length] : []),
    ...(video.youtube_video_id ? [1] : []),
    rebuildQueue.expectedChanges,
  ];
  if (visibilityTransition.fenceToken) {
    try {
      await preCommitVideoVisibilityDepublicization({
        videoId: video.id,
        fenceToken: visibilityTransition.fenceToken,
        reason: "legacy_import_visibility",
      });
    } catch (error) {
      try {
        await compensateDepublicizationFenceOnD1Failure(db, {
          videoId: video.id,
          fenceToken: visibilityTransition.fenceToken,
          traceId: `legacy-import:${options.stepTargetId}:${video.id}`,
          allowNonPublicRollback: !visibilityTransition.depublicizedFromPublic,
        });
      } catch (compensationError) {
        console.warn("[legacy-import] video visibility precommit compensation failed", compensationError);
      }
      throw error;
    }
  }
  try {
    await mutateWithAudit(db, {
      mutationStatements: statements,
      expectedMutationChanges: expected,
      audits: [
      {
        table_name: "videos",
        target_id: video.id,
        operation: existing ? "UPDATE" : "CREATE",
        before: existing,
        after: {
          ...video,
          created_at: nextManagedVideo.created_at,
          event_ids: nextEvents.map((row) => row.event_id),
          member_ids: nextMembers.map((row) => row.id),
          chapter_ids: nextChapters.map((row) => row.id),
          software_ids: nextSoftwares.map((row) => row.software_id),
          custom_answer_ids: nextCustomAnswers.map((row) =>
            compositeAuditTargetId(row.video_id, row.event_id, row.question_id),
          ),
        },
        actor_user_id: options.actorAuthUserId,
        reason: "旧形式作品を新正本へ変換",
        context: "legacy_import",
        retention_class: "long_audit",
        restore_strategy: existing ? "none" : "delete_created",
      },
      {
        table_name: LEGACY_ENTITY_SNAPSHOT_AUDIT_TABLE,
        target_id: snapshotTargetId,
        operation: "SYSTEM",
        before: null,
        after: {
          entity_kind: "video",
          managed_digest: nextManagedVideoDigest,
          events_digest: nextEventsDigest,
          members_digest: nextMembersDigest,
          chapters_digest: nextChaptersDigest,
          softwares_digest: nextSoftwaresDigest,
          metadata_digest: nextMetadataDigest,
          custom_answers_digest: nextCustomAnswersDigest,
        },
        actor_user_id: options.actorAuthUserId,
        reason: "旧形式作品の置換可能snapshotを確定",
        context: LEGACY_ENTITY_SNAPSHOT_AUDIT_CONTEXT,
        retention_class: "long_audit",
        restore_strategy: "none",
        strict: true,
      },
      ...replacedCustomAnswers.map(({ before, after }) => ({
        table_name: "video_custom_answers",
        target_id: compositeAuditTargetId(before.video_id, before.event_id, before.question_id),
        operation: "UPDATE" as const,
        before,
        after,
        actor_user_id: options.actorAuthUserId,
        reason: "旧形式動画のカスタム質問回答を置換",
        context: LEGACY_CUSTOM_ANSWER_AUDIT_CONTEXT,
        retention_class: "long_audit" as const,
        restore_strategy: "update_before" as const,
        strict: true,
      })),
      ...createdCustomAnswers.map((after) => ({
        table_name: "video_custom_answers",
        target_id: compositeAuditTargetId(after.video_id, after.event_id, after.question_id),
        operation: "CREATE" as const,
        before: null,
        after,
        actor_user_id: options.actorAuthUserId,
        reason: "旧形式動画のカスタム質問回答を作成",
        context: LEGACY_CUSTOM_ANSWER_AUDIT_CONTEXT,
        retention_class: "long_audit" as const,
        restore_strategy: "delete_created" as const,
        strict: true,
      })),
      ...(options.marker
        ? [stepMarkerAudit(
            options.marker({ kind: "video", action: existing ? "replaced" : "created" }),
            options.actorAuthUserId,
          )]
        : []),
      ],
      staticRebuildWakeSource: "import",
      wakeSentKinds,
    });
  } catch (error) {
    if (visibilityTransition.fenceToken) {
      try {
        await compensateDepublicizationFenceOnD1Failure(db, {
          videoId: video.id,
          fenceToken: visibilityTransition.fenceToken,
          traceId: `legacy-import:${options.stepTargetId}:${video.id}`,
          allowNonPublicRollback: !visibilityTransition.depublicizedFromPublic,
        });
      } catch (compensationError) {
        console.warn("[legacy-import] video visibility mutation compensation failed", compensationError);
      }
    }
    throw error;
  }
  if (visibilityTransition.fenceToken) {
    const cacheIds = new Set([
      existing?.youtube_video_id ?? existing?.id ?? video.id,
      video.youtube_video_id ?? video.id,
    ]);
    await deletePublicJsonCaches([
      ...[...cacheIds].map((id) => `videos/${id}.json`),
      ...rebuildEventIds.flatMap((eventId) => [
        eventComposedObjectKey(eventId),
        eventBaseObjectKey(eventId),
        eventSlotsObjectKey(eventId),
        eventReleaseObjectKey(eventId),
      ]),
    ]);
  }
  return existing ? "replaced" : "created";
}

function assertProgressForPlan(
  plan: CanonicalLegacyPlan,
  progress: LegacyImportApplyProgress,
): void {
  const softwareCount = plannedSoftwareCatalogRows(plan).length;
  const limits: Record<LegacyImportApplyStage, number> = {
    system_user: 1,
    x_users: Math.max(1, Math.ceil(plan.xUsers.length / LEGACY_IMPORT_X_USER_STEP_SIZE)),
    softwares: Math.max(1, Math.ceil(softwareCount / LEGACY_IMPORT_SOFTWARE_STEP_SIZE)),
    events: Math.max(1, plan.events.length),
    custom_questions: Math.max(
      1,
      Math.ceil(plan.eventCustomQuestions.length / LEGACY_IMPORT_QUESTION_STEP_SIZE),
    ),
    videos: Math.max(1, plan.videos.length),
    complete: 1,
  };
  if (!Number.isSafeInteger(progress.index) || progress.index < 0 || progress.index >= limits[progress.stage]) {
    throw new Error("旧形式インポートの進捗位置がplanの範囲外です。");
  }
}

function questionsNeededForSkipStrategy(
  plan: CanonicalLegacyPlan,
  questions: readonly PlannedQuestion[],
  skipExistingVideoIds: readonly string[],
): { questions: PlannedQuestion[]; relevantVideoIds: string[] } {
  if (questions.length === 0) return { questions: [], relevantVideoIds: [] };
  const questionIds = new Set(questions.map((question) => question.id));
  const relevantAnswers = plan.videoCustomAnswers.filter((answer) => questionIds.has(answer.question_id));
  const videoIds = [...new Set(relevantAnswers.map((answer) => answer.video_id))].sort();
  if (videoIds.length === 0) return { questions: [], relevantVideoIds: [] };
  const existingIds = new Set(skipExistingVideoIds);
  const neededQuestionIds = new Set(
    relevantAnswers
      .filter((answer) => !existingIds.has(answer.video_id))
      .map((answer) => answer.question_id),
  );
  return {
    questions: questions.filter((question) => neededQuestionIds.has(question.id)),
    relevantVideoIds: videoIds,
  };
}

export function legacyApplyResultFromProgress(
  plan: CanonicalLegacyPlan,
  progress: LegacyImportApplyProgress,
): LegacyApplyResult {
  return {
    created: {
      events: progress.counts.createdEvents,
      videos: progress.counts.createdVideos,
      xUsers: progress.counts.createdXUsers,
      authUsers: progress.counts.createdAuthUsers,
      softwares: progress.counts.createdSoftwares,
    },
    replaced: {
      events: progress.counts.replacedEvents,
      videos: progress.counts.replacedVideos,
    },
    skipped: {
      events: progress.counts.skippedEvents,
      videos: progress.counts.skippedVideos,
    },
    customQuestions: {
      created: progress.counts.createdCustomQuestions,
      reused: progress.counts.reusedCustomQuestions,
    },
    warnings: [...plan.warnings],
  };
}

export async function applyLegacyImportPlanStep(
  db: DB,
  plan: CanonicalLegacyPlan,
  input: {
    actorAuthUserId: string;
    strategy: LegacyImportStrategy;
    previewToken: string;
    planHash: string;
    progress: LegacyImportApplyProgress;
  },
): Promise<LegacyImportStepResult> {
  if (plan.errors.length > 0) throw new Error(plan.errors.join("\n"));
  assertProgressForPlan(plan, input.progress);
  if (input.progress.stage === "complete") {
    return { progress: input.progress, complete: true };
  }

  const identity = await buildStepMarkerIdentity(input.previewToken, input.planHash, input.progress);
  const recovered = await recoveredStepMarker(db, identity, plan, input.strategy, input.progress);
  if (recovered) return { progress: recovered, complete: recovered.stage === "complete" };
  const marker = (outcome: LegacyImportStepOutcome): LegacyImportStepMarker =>
    completeStepMarker(identity, plan, input.progress, outcome);
  const options: ApplyOptions = {
    actorAuthUserId: input.actorAuthUserId,
    strategy: input.strategy,
    stepTargetId: identity.targetId,
    marker,
  };
  let outcome: LegacyImportStepOutcome;

  switch (input.progress.stage) {
    case "system_user": {
      outcome = {
        kind: "system_user",
        skipExistingEventIds: input.progress.skipExistingEventIds,
        skipExistingVideoIds: input.progress.skipExistingVideoIds,
      };
      await ensureSystemUser(db, options, outcome);
      break;
    }
    case "x_users": {
      if (plan.xUsers.length === 0) {
        outcome = { kind: "none" };
        await writeStepMarkerOnly(db, marker(outcome), options.actorAuthUserId);
        break;
      }
      const rows = plan.xUsers.slice(
        input.progress.index * LEGACY_IMPORT_X_USER_STEP_SIZE,
        (input.progress.index + 1) * LEGACY_IMPORT_X_USER_STEP_SIZE,
      );
      const created = await ensureXUserGroup(db, rows, options);
      // Discord未ログインの空認証ユーザーは作らない。X名義(x_users)とevent_staff ownerのみ正本。
      outcome = { kind: "x_users", created, createdAuthUsers: 0 };
      await writeStepMarkerOnly(db, marker(outcome), options.actorAuthUserId);
      break;
    }
    case "softwares": {
      const allRows = plannedSoftwareCatalogRows(plan);
      if (allRows.length === 0) {
        outcome = { kind: "none" };
        await writeStepMarkerOnly(db, marker(outcome), options.actorAuthUserId);
        break;
      }
      const rows = allRows.slice(
        input.progress.index * LEGACY_IMPORT_SOFTWARE_STEP_SIZE,
        (input.progress.index + 1) * LEGACY_IMPORT_SOFTWARE_STEP_SIZE,
      );
      outcome = {
        kind: "softwares",
        created: await ensureSoftwareCatalogGroup(db, rows, options),
      };
      break;
    }
    case "events": {
      if (plan.events.length === 0) {
        outcome = { kind: "none" };
        await writeStepMarkerOnly(db, marker(outcome), options.actorAuthUserId);
        break;
      }
      const event = plan.events[input.progress.index];
      const action = await applyEvent(
        db,
        event,
        plan.eventStaff.filter((row) => row.event_id === event.id),
        input.progress.skipExistingEventIds.includes(event.id),
        options,
      );
      outcome = { kind: "event", action };
      break;
    }
    case "custom_questions": {
      if (plan.eventCustomQuestions.length === 0) {
        outcome = { kind: "none" };
        await writeStepMarkerOnly(db, marker(outcome), options.actorAuthUserId);
        break;
      }
      const sourceQuestions = plan.eventCustomQuestions.slice(
        input.progress.index * LEGACY_IMPORT_QUESTION_STEP_SIZE,
        (input.progress.index + 1) * LEGACY_IMPORT_QUESTION_STEP_SIZE,
      );
      const filtered = input.strategy === "skip_existing"
        ? questionsNeededForSkipStrategy(
            plan,
            sourceQuestions,
            input.progress.skipExistingVideoIds,
          )
        : { questions: [...sourceQuestions], relevantVideoIds: [] };
      const result = await ensureLegacyCustomQuestions(
        db,
        filtered.questions,
        options,
        input.strategy === "skip_existing"
          ? {
              videoIds: filtered.relevantVideoIds,
              existingVideoIds: input.progress.skipExistingVideoIds,
            }
          : undefined,
      );
      outcome = { kind: "custom_questions", ...result };
      break;
    }
    case "videos": {
      if (plan.videos.length === 0) {
        outcome = { kind: "none" };
        await writeStepMarkerOnly(db, marker(outcome), options.actorAuthUserId);
        break;
      }
      const video = plan.videos[input.progress.index];
      const answers = plan.videoCustomAnswers.filter((row) => row.video_id === video.id);
      const questionIds = new Set(answers.map((answer) => answer.question_id));
      const wakeSentKinds = new Set<QueueWakeKind>();
      const action = await applyVideo(
        db,
        video,
        plan.videoEvents.filter((row) => row.video_id === video.id),
        plan.videoMembers.filter((row) => row.video_id === video.id),
        plan.videoChapters.filter((row) => row.video_id === video.id),
        plan.videoSoftwares.filter((row) => row.video_id === video.id),
        answers,
        plan.eventCustomQuestions.filter((question) => questionIds.has(question.id)),
        input.progress.skipExistingVideoIds.includes(video.id),
        options,
        wakeSentKinds,
      );
      if (video.youtube_video_id && action !== "skipped") {
        await sendYoutubeSyncPendingWakeBestEffort("import", wakeSentKinds);
      }
      outcome = { kind: "video", action };
      break;
    }
  }
  const progress = nextStageProgress(plan, input.progress, outcome);
  return { progress, complete: progress.stage === "complete" };
}
