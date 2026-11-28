import { getTableColumns, sql } from "drizzle-orm";
import { events, eventStaff, eventCustomQuestions } from "@flamenode/db/schema";
import {
  isValidPreloadedActorSnapshotJson,
  isValidPreloadedAuditSettings,
  type PreloadedAuditContext,
} from "../audit/logger.ts";
import { mutateWithAudit } from "../audit/mutate.ts";
import type { ServerCoreDb } from "../db.ts";
import type { QueueWakeHostLoader } from "../ports.ts";
import type { CanonicalLegacyPlan, LegacyImportStrategy } from "./normalize.ts";
import type { LegacyImportApplyProgress } from "./previewStore.ts";
import {
  MAX_LEGACY_EVENT_STAFF_PER_EVENT,
  MAX_LEGACY_IMPORT_STEP_BYTES,
  MAX_LEGACY_IMPORT_SELECTED_ROWS,
} from "./cpuBudget.ts";
import {
  LEGACY_IMPORT_SOFTWARE_STEP_SIZE,
  LEGACY_IMPORT_QUESTION_STEP_SIZE,
  LEGACY_IMPORT_X_USER_STEP_SIZE,
  legacyImportReceiptMatchesProgress,
  legacyImportSkipSnapshotFingerprint,
} from "./progress.ts";

const SYSTEM_USER_ID = "system_legacy_import";
const STEP_AUDIT_TABLE = "legacy_import_steps";
const STEP_AUDIT_CONTEXT = "legacy_import:step";
const ENTITY_SNAPSHOT_AUDIT_TABLE = "legacy_import_entity_snapshots";
const ENTITY_SNAPSHOT_AUDIT_CONTEXT = "legacy_import:entity-snapshot";

// SQL identifiers and JSON keys come only from the static canonical schema;
// never interpolate a plan field or provider payload into SQL text.
function canonicalRowJson(columns: Record<string, { name: string }>, table: string) {
  const fields = Object.entries(columns).map(([key, column]) =>
    "'" + key.replaceAll("'", "''") + "', " +
    '"' + table.replaceAll('"', '""') + '"."' + column.name.replaceAll('"', '""') + '"',
  );
  return sql.raw("json_object(" + fields.join(", ") + ")");
}
const existingEventJson = canonicalRowJson(getTableColumns(events), "events");
const existingStaffJson = canonicalRowJson(getTableColumns(eventStaff), "event_staff");
const existingQuestionJson = canonicalRowJson(getTableColumns(eventCustomQuestions), "event_custom_questions");
// CURRENT legacy import limit (distinct from the interactive new-question limit).
const MAX_EVENT_CUSTOM_QUESTIONS = 18;
type PlannedQuestion = CanonicalLegacyPlan["eventCustomQuestions"][number];

function questionGroup(input: ApplyInput): {
  questions: PlannedQuestion[];
  videoSnapshot: Array<{ id: string; exists: number }>;
} {
  const start = input.progress.index * LEGACY_IMPORT_QUESTION_STEP_SIZE;
  const questions = input.plan.eventCustomQuestions.slice(start, start + LEGACY_IMPORT_QUESTION_STEP_SIZE);
  if (input.strategy !== "skip_existing") return { questions, videoSnapshot: [] };
  const ids = new Set(questions.map((row) => row.id));
  const skipped = new Set(input.progress.skipExistingVideoIds);
  const answers = input.plan.videoCustomAnswers.filter((row) => ids.has(row.question_id));
  const needed = new Set(answers.filter((row) => !skipped.has(row.video_id)).map((row) => row.question_id));
  const videoSnapshot = [...new Set(answers.map((row) => row.video_id))].sort()
    .map((id) => ({ id, exists: skipped.has(id) ? 1 : 0 }));
  if (videoSnapshot.length > MAX_LEGACY_IMPORT_SELECTED_ROWS ||
      new TextEncoder().encode(JSON.stringify(videoSnapshot)).byteLength > MAX_LEGACY_IMPORT_STEP_BYTES) {
    return fixedFailure("旧形式インポートのカスタム質問作品snapshotが上限超過です。");
  }
  return { questions: questions.filter((row) => needed.has(row.id)), videoSnapshot };
}

function sameQuestionDefinition(current: Record<string, unknown>, planned: PlannedQuestion): boolean {
  return current.id === planned.id &&
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
    current.visibility === planned.visibility;
}

type ApplyInput = {
  db: ServerCoreDb;
  preloaded: PreloadedAuditContext;
  plan: CanonicalLegacyPlan;
  strategy: LegacyImportStrategy;
  previewToken: string;
  planHash: string;
  actorAuthUserId: string;
  progress: LegacyImportApplyProgress;
  loadWakeHost: QueueWakeHostLoader;
};
type ReadRow = { kind: string; payload: string | null };
type StepIdentity = {
  targetId: string;
  runDigest: string;
  planHash: string;
  stage: string;
  index: number;
};

type StoredStepOutcome =
  | { kind: "system_user" }
  | { kind: "none" }
  | { kind: "x_users"; created: number; createdAuthUsers: number }
  | { kind: "softwares"; created: number }
  | { kind: "event"; action: "created" | "replaced" | "skipped" }
  | { kind: "custom_questions"; created: number; reused: number }
  | { kind: "video"; action: "skipped" };

type PlannedSoftwareRow = { id: string; name: string; normalized_name: string };

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

function plannedSoftwareCatalogRows(plan: CanonicalLegacyPlan): PlannedSoftwareRow[] {
  const normalizedToLabel = new Map<string, string>();
  plan.videoSoftwares.forEach(({ label }) => {
    const normalized = normalizeSoftwareName(label);
    if (normalized) normalizedToLabel.set(normalized, label.trim());
  });
  return [...normalizedToLabel].map(([normalized_name, name]) => ({
    id: stableSoftwareId(normalized_name), name, normalized_name,
  }));
}

function fixedFailure(message: string): never {
  throw new Error(message);
}

async function runDigest(previewToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(previewToken));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("").slice(0, 24);
}

async function snapshotDigest(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function entitySnapshotTargetId(kind: "event", id: string): string {
  return `${kind}:${encodeURIComponent(id)}`;
}

function nextSystemUserProgress(
  progress: LegacyImportApplyProgress,
  eventIds: readonly string[],
  videoIds: readonly string[],
): LegacyImportApplyProgress {
  return {
    ...progress,
    counts: { ...progress.counts },
    skipExistingEventIds: [...eventIds].sort(),
    skipExistingVideoIds: [...videoIds].sort(),
    stage: "x_users",
    index: 0,
  };
}


function nextXUsersProgress(
  plan: CanonicalLegacyPlan,
  progress: LegacyImportApplyProgress,
  outcome: StoredStepOutcome,
): LegacyImportApplyProgress {
  const next: LegacyImportApplyProgress = {
    ...progress,
    counts: { ...progress.counts },
    skipExistingEventIds: [...progress.skipExistingEventIds],
    skipExistingVideoIds: [...progress.skipExistingVideoIds],
  };
  if (plan.xUsers.length === 0) {
    if (outcome.kind !== "none") {
      return fixedFailure("旧形式インポートのX名義進捗が不正です。");
    }
    next.stage = "softwares";
    next.index = 0;
    return next;
  }
  if (outcome.kind !== "x_users" || outcome.createdAuthUsers !== 0) {
    return fixedFailure("旧形式インポートのX名義進捗が不正です。");
  }
  const groupRows = plan.xUsers.slice(
    progress.index * LEGACY_IMPORT_X_USER_STEP_SIZE,
    (progress.index + 1) * LEGACY_IMPORT_X_USER_STEP_SIZE,
  );
  if (outcome.created > groupRows.length) {
    return fixedFailure("旧形式インポートのX名義進捗が不正です。");
  }
  next.counts.createdXUsers += outcome.created;
  next.counts.createdAuthUsers += outcome.createdAuthUsers;
  const groupCount = Math.ceil(plan.xUsers.length / LEGACY_IMPORT_X_USER_STEP_SIZE);
  if (progress.index + 1 < groupCount) next.index += 1;
  else {
    next.stage = "softwares";
    next.index = 0;
  }
  return next;
}

function nextSoftwareProgress(
  plan: CanonicalLegacyPlan,
  progress: LegacyImportApplyProgress,
  outcome: StoredStepOutcome,
): LegacyImportApplyProgress {
  const next: LegacyImportApplyProgress = {
    ...progress,
    counts: { ...progress.counts },
    skipExistingEventIds: [...progress.skipExistingEventIds],
    skipExistingVideoIds: [...progress.skipExistingVideoIds],
  };
  const rows = plannedSoftwareCatalogRows(plan);
  if (rows.length === 0) {
    if (outcome.kind !== "none") return fixedFailure("旧形式インポートの使用ソフト進捗が不正です。");
    next.stage = "events";
    next.index = 0;
    return next;
  }
  if (outcome.kind !== "softwares") return fixedFailure("旧形式インポートの使用ソフト進捗が不正です。");
  const groupRows = rows.slice(
    progress.index * LEGACY_IMPORT_SOFTWARE_STEP_SIZE,
    (progress.index + 1) * LEGACY_IMPORT_SOFTWARE_STEP_SIZE,
  );
  if (outcome.created > groupRows.length) return fixedFailure("旧形式インポートの使用ソフト進捗が不正です。");
  next.counts.createdSoftwares += outcome.created;
  const groupCount = Math.ceil(rows.length / LEGACY_IMPORT_SOFTWARE_STEP_SIZE);
  if (progress.index + 1 < groupCount) next.index += 1;
  else {
    next.stage = "events";
    next.index = 0;
  }
  return next;
}

function nextEventProgress(
  plan: CanonicalLegacyPlan,
  progress: LegacyImportApplyProgress,
  outcome: StoredStepOutcome,
): LegacyImportApplyProgress {
  const next: LegacyImportApplyProgress = {
    ...progress,
    counts: { ...progress.counts },
    skipExistingEventIds: [...progress.skipExistingEventIds],
    skipExistingVideoIds: [...progress.skipExistingVideoIds],
  };
  if (plan.events.length === 0) {
    if (outcome.kind !== "none") return fixedFailure("旧形式インポートのイベント進捗が不正です。");
    next.stage = "custom_questions";
    next.index = 0;
    return next;
  }
  if (
    outcome.kind !== "event" ||
    !["created", "replaced", "skipped"].includes(outcome.action)
  ) {
    return fixedFailure("旧形式インポートのイベント進捗が不正です。");
  }
  next.counts[`${outcome.action}Events`] += 1;
  if (progress.index + 1 < plan.events.length) next.index += 1;
  else {
    next.stage = "custom_questions";
    next.index = 0;
  }
  return next;
}

function nextQuestionProgress(
  plan: CanonicalLegacyPlan,
  progress: LegacyImportApplyProgress,
  outcome: StoredStepOutcome,
  effectiveCount: number,
): LegacyImportApplyProgress {
  const next = {
    ...progress,
    counts: { ...progress.counts },
    skipExistingEventIds: [...progress.skipExistingEventIds],
    skipExistingVideoIds: [...progress.skipExistingVideoIds],
  };
  if (plan.eventCustomQuestions.length === 0) {
    if (outcome.kind !== "none") return fixedFailure("旧形式インポートのカスタム質問進捗が不正です。");
  } else {
    if (outcome.kind !== "custom_questions" ||
        !Number.isSafeInteger(outcome.created) || outcome.created < 0 ||
        !Number.isSafeInteger(outcome.reused) || outcome.reused < 0 ||
        outcome.created + outcome.reused !== effectiveCount) {
      return fixedFailure("旧形式インポートのカスタム質問進捗が不正です。");
    }
    next.counts.createdCustomQuestions += outcome.created;
    next.counts.reusedCustomQuestions += outcome.reused;
  }
  const groupCount = Math.max(1, Math.ceil(plan.eventCustomQuestions.length / LEGACY_IMPORT_QUESTION_STEP_SIZE));
  if (progress.index + 1 < groupCount) next.index += 1;
  else {
    next.stage = "videos";
    next.index = 0;
  }
  return next;
}

/** The U02aj video boundary only permits marker-only empty/confirmed-skip steps. */
function nextVideoProgress(
  input: ApplyInput,
  outcome: StoredStepOutcome,
): LegacyImportApplyProgress {
  const next: LegacyImportApplyProgress = {
    ...input.progress,
    counts: { ...input.progress.counts },
    skipExistingEventIds: [...input.progress.skipExistingEventIds],
    skipExistingVideoIds: [...input.progress.skipExistingVideoIds],
  };
  if (input.plan.videos.length === 0) {
    if (outcome.kind !== "none") return fixedFailure("旧形式インポートの作品進捗が不正です。");
  } else {
    const video = input.plan.videos[input.progress.index];
    if (
      outcome.kind !== "video" || outcome.action !== "skipped" ||
      input.strategy !== "skip_existing" || !video ||
      !input.progress.skipExistingVideoIds.includes(video.id)
    ) {
      return fixedFailure("旧形式インポートの作品進捗が不正です。");
    }
    next.counts.skippedVideos += 1;
  }
  if (input.progress.index + 1 < input.plan.videos.length) next.index += 1;
  else {
    next.stage = "complete";
    next.index = 0;
  }
  return next;
}

const LEGACY_STEP_TARGET_PATTERN =
  /^[a-f0-9]{24}:[a-f0-9]{24}:(?:system_user|x_users|softwares|events|custom_questions|videos):\d+$/;

function legacyImportRebuildQueueId(stepTargetId: string, targetIndex: number): string {
  if (!LEGACY_STEP_TARGET_PATTERN.test(stepTargetId)) {
    return fixedFailure("legacy_import_rebuild_step_target_invalid");
  }
  if (!Number.isSafeInteger(targetIndex) || targetIndex < 0) {
    return fixedFailure("legacy_import_rebuild_target_index_invalid");
  }
  return "legacy_import_" + stepTargetId.replaceAll(":", "_") + "_" + targetIndex;
}

function parseJsonRecord(raw: unknown, message: string): Record<string, unknown> {
  if (typeof raw !== "string") return fixedFailure(message);
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return fixedFailure(message);
    return value as Record<string, unknown>;
  } catch {
    return fixedFailure(message);
  }
}

function validSystemPrincipal(value: Record<string, unknown>): boolean {
  return value.name === "Legacy import system" &&
    value.email === null &&
    value.emailVerified === null &&
    value.image === null &&
    value.discord_id === null &&
    value.role === "user" &&
    value.can_create_events === 0 &&
    value.is_notification_enabled === 0 &&
    value.is_tos_accepted === 0 &&
    value.accepted_terms_version_id === null &&
    value.terms_reaccept_required === 0 &&
    value.is_banned === 0 &&
    value.active_x_user_id === null &&
    value.onboarding_completed_at === null &&
    value.last_guild_check === null;
}

function parseReceipt(value: Record<string, unknown>) {
  const rawOutcome = value.outcome;
  if (!rawOutcome || typeof rawOutcome !== "object" || Array.isArray(rawOutcome)) {
    return fixedFailure("旧形式インポートのステップ監査が破損しています。");
  }
  const outcomeRecord = rawOutcome as Record<string, unknown>;
  let outcome: StoredStepOutcome;
  if (outcomeRecord.kind === "system_user") {
    outcome = { kind: "system_user" };
  } else if (outcomeRecord.kind === "none") {
    outcome = { kind: "none" };
  } else if (
    outcomeRecord.kind === "x_users" &&
    Number.isSafeInteger(outcomeRecord.created) &&
    (outcomeRecord.created as number) >= 0 &&
    Number.isSafeInteger(outcomeRecord.createdAuthUsers) &&
    (outcomeRecord.createdAuthUsers as number) >= 0
  ) {
    outcome = {
      kind: "x_users",
      created: outcomeRecord.created as number,
      createdAuthUsers: outcomeRecord.createdAuthUsers as number,
    };
  } else if (
    outcomeRecord.kind === "softwares" &&
    Number.isSafeInteger(outcomeRecord.created) &&
    (outcomeRecord.created as number) >= 0
  ) {
    outcome = { kind: "softwares", created: outcomeRecord.created as number };
  } else if (
    outcomeRecord.kind === "custom_questions" &&
    Number.isSafeInteger(outcomeRecord.created) &&
    (outcomeRecord.created as number) >= 0 &&
    Number.isSafeInteger(outcomeRecord.reused) &&
    (outcomeRecord.reused as number) >= 0
  ) {
    outcome = {
      kind: "custom_questions",
      created: outcomeRecord.created as number,
      reused: outcomeRecord.reused as number,
    };
  } else if (outcomeRecord.kind === "video" && outcomeRecord.action === "skipped") {
    outcome = { kind: "video", action: "skipped" };
  } else if (
    outcomeRecord.kind === "event" &&
    ["created", "replaced", "skipped"].includes(String(outcomeRecord.action))
  ) {
    outcome = {
      kind: "event",
      action: outcomeRecord.action as "created" | "replaced" | "skipped",
    };
  } else {
    return fixedFailure("旧形式インポートのステップ監査が破損しています。");
  }
  if (
    typeof value.run_digest !== "string" ||
    typeof value.plan_hash !== "string" ||
    typeof value.stage !== "string" ||
    !Number.isSafeInteger(value.index) ||
    typeof value.next_stage !== "string" ||
    !Number.isSafeInteger(value.next_index) ||
    !value.next_counts ||
    typeof value.next_counts !== "object" ||
    Array.isArray(value.next_counts) ||
    typeof value.skip_event_snapshot_fingerprint !== "string" ||
    typeof value.skip_video_snapshot_fingerprint !== "string"
  ) {
    return fixedFailure("旧形式インポートのステップ監査が破損しています。");
  }
  return {
    runDigest: value.run_digest,
    planHash: value.plan_hash,
    stage: value.stage,
    index: value.index as number,
    outcome,
    nextStage: value.next_stage,
    nextIndex: value.next_index as number,
    nextCounts: value.next_counts,
    skipEventSnapshotFingerprint: value.skip_event_snapshot_fingerprint,
    skipVideoSnapshotFingerprint: value.skip_video_snapshot_fingerprint,
  };
}

/**
 * Bounded real Hono D1 apply units for RH-002.
 * system_user, x_users, software catalog, event create/preview-confirmed skip,
 * proven imported-event same-visibility replacement and custom question steps.
 * Empty/preview-confirmed skipped video steps are supported; visibility-changing
 * event replacements and video create/replace mutations remain fail closed.
 */
export async function legacyImportD1ApplyStep(
  input: ApplyInput,
): Promise<{ progress: LegacyImportApplyProgress; complete: boolean }> {
  if (input.plan.errors.length > 0) return fixedFailure(input.plan.errors.join("\n"));
  const stage = input.progress.stage;
  if (stage !== "system_user" && stage !== "x_users" && stage !== "softwares" && stage !== "events" && stage !== "custom_questions" && stage !== "videos") {
    return fixedFailure("旧形式インポートのこの段階はHono側でまだ利用できません。");
  }
  if (stage === "system_user" && input.progress.index !== 0) {
    return fixedFailure("旧形式インポートの進捗位置が不正です。");
  }
  if (stage === "x_users") {
    const groupCount = Math.max(
      1,
      Math.ceil(input.plan.xUsers.length / LEGACY_IMPORT_X_USER_STEP_SIZE),
    );
    if (
      !Number.isSafeInteger(input.progress.index) ||
      input.progress.index < 0 ||
      input.progress.index >= groupCount
    ) {
      return fixedFailure("旧形式インポートの進捗位置が不正です。");
    }
  }

  const allSoftwareRows = stage === "softwares" ? plannedSoftwareCatalogRows(input.plan) : [];
  if (stage === "softwares") {
    const groupCount = Math.max(1, Math.ceil(allSoftwareRows.length / LEGACY_IMPORT_SOFTWARE_STEP_SIZE));
    if (!Number.isSafeInteger(input.progress.index) || input.progress.index < 0 || input.progress.index >= groupCount) {
      return fixedFailure("旧形式インポートの進捗位置が不正です。");
    }
  }
  if (stage === "events") {
    const groupCount = Math.max(1, input.plan.events.length);
    if (!Number.isSafeInteger(input.progress.index) || input.progress.index < 0 || input.progress.index >= groupCount) {
      return fixedFailure("旧形式インポートのイベント進捗位置が不正です。");
    }
  }

  if (stage === "custom_questions") {
    const groupCount = Math.max(1, Math.ceil(input.plan.eventCustomQuestions.length / LEGACY_IMPORT_QUESTION_STEP_SIZE));
    if (!Number.isSafeInteger(input.progress.index) || input.progress.index < 0 || input.progress.index >= groupCount) {
      return fixedFailure("旧形式インポートのカスタム質問進捗位置が不正です。");
    }
  }
  if (stage === "videos" && (
    !Number.isSafeInteger(input.progress.index) || input.progress.index < 0 ||
    input.progress.index >= Math.max(1, input.plan.videos.length)
  )) {
    return fixedFailure("旧形式インポートの作品進捗位置が不正です。");
  }

  const actorJson = input.preloaded.actorSnapshotJsonById?.[input.actorAuthUserId];
  if (
    !isValidPreloadedAuditSettings(input.preloaded.settings) ||
    !isValidPreloadedActorSnapshotJson(actorJson)
  ) {
    return fixedFailure("監査に必要な認証済みリクエスト情報を取得できません。");
  }

  const digest = await runDigest(input.previewToken);
  const identity: StepIdentity = {
    targetId:
      digest + ":" + input.planHash.slice(0, 24) + ":" + stage + ":" + input.progress.index,
    runDigest: digest,
    planHash: input.planHash,
    stage,
    index: input.progress.index,
  };
  const plannedXUserRows = stage === "x_users"
    ? input.plan.xUsers.slice(
        input.progress.index * LEGACY_IMPORT_X_USER_STEP_SIZE,
        (input.progress.index + 1) * LEGACY_IMPORT_X_USER_STEP_SIZE,
      )
    : [];
  const plannedSoftwareRows = stage === "softwares"
    ? allSoftwareRows.slice(
        input.progress.index * LEGACY_IMPORT_SOFTWARE_STEP_SIZE,
        (input.progress.index + 1) * LEGACY_IMPORT_SOFTWARE_STEP_SIZE,
      )
    : [];
  const plannedEvent = stage === "events" && input.plan.events.length > 0
    ? input.plan.events[input.progress.index]
    : null;
  const plannedVideo = stage === "videos" && input.plan.videos.length > 0
    ? input.plan.videos[input.progress.index]
    : null;
  const eventIdForRead = plannedEvent?.id ?? "";
  const readReplacement = input.strategy === "replace_imported";
  const replacementTargetId = entitySnapshotTargetId("event", eventIdForRead);
  const { questions, videoSnapshot } = stage === "custom_questions"
    ? questionGroup(input)
    : { questions: [], videoSnapshot: [] };
  const questionPayload = JSON.stringify(questions);
  if (stage === "custom_questions" && (
      questions.length > LEGACY_IMPORT_QUESTION_STEP_SIZE ||
      new Set(questions.map((row) => row.id)).size !== questions.length ||
      new Set(questions.map((row) => JSON.stringify([row.event_id, row.question_key]))).size !== questions.length ||
      new TextEncoder().encode(questionPayload).byteLength > MAX_LEGACY_IMPORT_STEP_BYTES
  )) {
    return fixedFailure("旧形式インポートのカスタム質問planが不正または上限超過です。");
  }

  // One bounded D1 read per request: receipt plus the reserved principal or a
  // 40-row X/software normalized-name existence snapshot.
  // One bounded D1 read per request: receipt plus the stage-specific existing-state snapshot.
  const readRows = stage === "videos"
    ? !plannedVideo
      ? await input.db.all(sql`
          SELECT 'marker' AS kind, after_json AS payload FROM audit_logs
           WHERE table_name = ${STEP_AUDIT_TABLE}
             AND target_id = ${identity.targetId}
             AND context = ${STEP_AUDIT_CONTEXT}
           LIMIT 2
        `) as unknown as ReadRow[]
      : await input.db.all(sql`
          WITH marker_rows AS (
            SELECT after_json AS payload FROM audit_logs
             WHERE table_name = ${STEP_AUDIT_TABLE}
               AND target_id = ${identity.targetId}
               AND context = ${STEP_AUDIT_CONTEXT}
             LIMIT 2
          ), video_rows AS (
            SELECT id AS payload FROM videos
             WHERE id = ${plannedVideo.id}
               AND NOT EXISTS (SELECT 1 FROM marker_rows)
             LIMIT 2
          )
          SELECT 'marker' AS kind, payload FROM marker_rows
          UNION ALL
          SELECT 'video' AS kind, payload FROM video_rows
        `) as unknown as ReadRow[]
    : stage === "custom_questions"
    ? questions.length === 0
      ? await input.db.all(sql`
          SELECT 'marker' AS kind, after_json AS payload
            FROM audit_logs
           WHERE table_name = ${STEP_AUDIT_TABLE}
             AND target_id = ${identity.targetId}
             AND context = ${STEP_AUDIT_CONTEXT}
           LIMIT 2
        `) as unknown as ReadRow[]
      : await input.db.all(sql`
          WITH marker_rows AS (
            SELECT after_json AS payload FROM audit_logs
             WHERE table_name = ${STEP_AUDIT_TABLE}
               AND target_id = ${identity.targetId}
               AND context = ${STEP_AUDIT_CONTEXT}
             LIMIT 2
          ), existing_rows AS (
            SELECT ${existingQuestionJson} AS payload FROM event_custom_questions
             WHERE NOT EXISTS (SELECT 1 FROM marker_rows)
               AND (
                 id IN (SELECT json_extract(value, '$.id') FROM json_each(${questionPayload}))
                 OR (event_id, question_key) IN (
                   SELECT json_extract(value, '$.event_id'), json_extract(value, '$.question_key')
                     FROM json_each(${questionPayload})
                 )
               )
             LIMIT ${questions.length * 2 + 1}
          )
          SELECT 'marker' AS kind, payload FROM marker_rows
          UNION ALL
          SELECT 'existing' AS kind,
            CASE WHEN SUM(length(CAST(payload AS BLOB))) OVER () <= ${MAX_LEGACY_IMPORT_STEP_BYTES}
              THEN payload ELSE NULL END
            FROM existing_rows
        `) as unknown as ReadRow[]
    : stage === "system_user"
    ? await input.db.all(sql`
        WITH marker_rows AS (
          SELECT after_json AS payload
            FROM audit_logs
           WHERE table_name = ${STEP_AUDIT_TABLE}
             AND target_id = ${identity.targetId}
             AND context = ${STEP_AUDIT_CONTEXT}
           LIMIT 2
        ),
        principal_rows AS (
          SELECT json_object(
            'name', name,
            'email', email,
            'emailVerified', "emailVerified",
            'image', image,
            'discord_id', discord_id,
            'role', role,
            'can_create_events', can_create_events,
            'is_notification_enabled', is_notification_enabled,
            'is_tos_accepted', is_tos_accepted,
            'accepted_terms_version_id', accepted_terms_version_id,
            'terms_reaccept_required', terms_reaccept_required,
            'is_banned', is_banned,
            'active_x_user_id', active_x_user_id,
            'onboarding_completed_at', onboarding_completed_at,
            'last_guild_check', last_guild_check
          ) AS payload
            FROM "user"
           WHERE id = ${SYSTEM_USER_ID}
             AND NOT EXISTS (SELECT 1 FROM marker_rows)
           LIMIT 1
        )
        SELECT 'marker' AS kind, payload FROM marker_rows
        UNION ALL
        SELECT 'principal' AS kind, payload FROM principal_rows
      `) as unknown as ReadRow[]
    : stage === "x_users"
      ? await input.db.all(sql`
          WITH marker_rows AS (
            SELECT after_json AS payload
              FROM audit_logs
             WHERE table_name = ${STEP_AUDIT_TABLE}
               AND target_id = ${identity.targetId}
               AND context = ${STEP_AUDIT_CONTEXT}
             LIMIT 2
          ),
          existing_rows AS (
            SELECT id AS payload
              FROM x_users
             WHERE id IN (
               SELECT CAST(json_extract(value, '$.id') AS TEXT)
                 FROM json_each(${JSON.stringify(plannedXUserRows)})
             )
               AND NOT EXISTS (SELECT 1 FROM marker_rows)
             LIMIT ${LEGACY_IMPORT_X_USER_STEP_SIZE}
          )
          SELECT 'marker' AS kind, payload FROM marker_rows
          UNION ALL
          SELECT 'existing' AS kind, payload FROM existing_rows
        `) as unknown as ReadRow[]
      : stage === "softwares"
        ? await input.db.all(sql`
            WITH marker_rows AS (
              SELECT after_json AS payload
                FROM audit_logs
               WHERE table_name = ${STEP_AUDIT_TABLE}
                 AND target_id = ${identity.targetId}
                 AND context = ${STEP_AUDIT_CONTEXT}
               LIMIT 2
            ),
            existing_rows AS (
              SELECT normalized_name AS payload
                FROM software_catalog
               WHERE normalized_name IN (
                 SELECT CAST(json_extract(value, '$.normalized_name') AS TEXT)
                   FROM json_each(${JSON.stringify(plannedSoftwareRows)})
               )
                 AND NOT EXISTS (SELECT 1 FROM marker_rows)
               LIMIT ${LEGACY_IMPORT_SOFTWARE_STEP_SIZE}
            )
            SELECT 'marker' AS kind, payload FROM marker_rows
            UNION ALL
            SELECT 'existing' AS kind, payload FROM existing_rows
          `) as unknown as ReadRow[]
        : input.plan.events.length === 0
          ? await input.db.all(sql`
              SELECT 'marker' AS kind, after_json AS payload
                FROM audit_logs
               WHERE table_name = ${STEP_AUDIT_TABLE}
                 AND target_id = ${identity.targetId}
                 AND context = ${STEP_AUDIT_CONTEXT}
               LIMIT 2
            `) as unknown as ReadRow[]
          : await input.db.all(sql`
              WITH marker_rows AS (
                SELECT after_json AS payload
                  FROM audit_logs
                 WHERE table_name = ${STEP_AUDIT_TABLE}
                   AND target_id = ${identity.targetId}
                   AND context = ${STEP_AUDIT_CONTEXT}
                 LIMIT 2
              ),
              event_rows AS (
                SELECT id AS payload
                  FROM events
                 WHERE id = ${eventIdForRead}
                   AND NOT EXISTS (SELECT 1 FROM marker_rows)
                 LIMIT 2
              ),
              staff_rows AS (
                SELECT id AS payload
                  FROM event_staff
                 WHERE event_id = ${eventIdForRead}
                   AND NOT EXISTS (SELECT 1 FROM marker_rows)
                 LIMIT 1
              )
              , replacement_event AS (
                SELECT ${existingEventJson} AS payload
                  FROM events
                 WHERE id = ${eventIdForRead}
                   AND ${readReplacement ? 1 : 0} = 1
                   AND NOT EXISTS (SELECT 1 FROM marker_rows)
                 LIMIT 1
              ), replacement_staff AS (
                SELECT ${existingStaffJson} AS payload
                  FROM event_staff
                 WHERE event_id = ${eventIdForRead}
                   AND EXISTS (SELECT 1 FROM replacement_event)
                 ORDER BY id
                 LIMIT ${MAX_LEGACY_EVENT_STAFF_PER_EVENT + 1}
              ), replacement_audits AS (
                SELECT json_object(
                  'id', id, 'target_id', target_id, 'context', context,
                  'after_json', after_json, 'created_at', created_at
                ) AS payload
                  FROM audit_logs
                 WHERE table_name = ${ENTITY_SNAPSHOT_AUDIT_TABLE}
                   AND target_id = ${replacementTargetId}
                   AND context = ${ENTITY_SNAPSHOT_AUDIT_CONTEXT}
                   AND EXISTS (SELECT 1 FROM replacement_event)
                   AND created_at = (
                     SELECT MAX(created_at) FROM audit_logs
                      WHERE table_name = ${ENTITY_SNAPSHOT_AUDIT_TABLE}
                        AND target_id = ${replacementTargetId}
                        AND context = ${ENTITY_SNAPSHOT_AUDIT_CONTEXT}
                   )
                 ORDER BY id
                 LIMIT 2
              )
              SELECT 'marker' AS kind, payload FROM marker_rows
              UNION ALL
              SELECT 'event' AS kind, payload FROM event_rows
              UNION ALL
              SELECT 'staff' AS kind, payload FROM staff_rows
              UNION ALL
              SELECT 'replacement_event' AS kind,
                CASE WHEN length(CAST(payload AS BLOB)) <= ${MAX_LEGACY_IMPORT_STEP_BYTES}
                  THEN payload ELSE NULL END FROM replacement_event
              UNION ALL
              SELECT 'replacement_staff' AS kind,
                CASE WHEN SUM(length(CAST(payload AS BLOB))) OVER () <= ${MAX_LEGACY_IMPORT_STEP_BYTES}
                  THEN payload ELSE NULL END FROM replacement_staff
              UNION ALL
              SELECT 'replacement_audit' AS kind,
                CASE WHEN length(CAST(payload AS BLOB)) <= ${MAX_LEGACY_IMPORT_STEP_BYTES}
                  THEN payload ELSE NULL END FROM replacement_audits
            `) as unknown as ReadRow[];

  const markerRows = readRows.filter((row) => row.kind === "marker");
  const principalRows = readRows.filter((row) => row.kind === "principal");
  const existingRows = readRows.filter((row) => row.kind === "existing");
  const eventRows = readRows.filter((row) => row.kind === "event");
  const videoRows = readRows.filter((row) => row.kind === "video");
  const eventStaffSnapshotRows = readRows.filter((row) => row.kind === "staff");
  const replacementEventRows = readRows.filter((row) => row.kind === "replacement_event");
  const replacementStaffRows = readRows.filter((row) => row.kind === "replacement_staff");
  const replacementAuditRows = readRows.filter((row) => row.kind === "replacement_audit");
  const replacementRowCount = replacementEventRows.length +
    replacementStaffRows.length + replacementAuditRows.length;
  const maxExistingRows = stage === "x_users"
    ? plannedXUserRows.length
    : stage === "softwares"
      ? plannedSoftwareRows.length
      : stage === "custom_questions"
        ? questions.length * 2
        : 0;
  if (
    markerRows.length + principalRows.length + existingRows.length +
      eventRows.length + videoRows.length + eventStaffSnapshotRows.length + replacementRowCount !== readRows.length
  ) {
    return fixedFailure("旧形式インポートのステップ監査を確認できません。");
  }
  if (
    markerRows.length > 1 ||
    principalRows.length > 1 ||
    existingRows.length > maxExistingRows ||
    eventRows.length > 1 ||
    videoRows.length > 1 ||
    (videoRows.length > 0 && (stage !== "videos" || !plannedVideo || markerRows.length > 0 || videoRows[0].payload !== plannedVideo.id)) ||
    eventStaffSnapshotRows.length > 1 ||
    replacementEventRows.length > 1 ||
    replacementStaffRows.length > MAX_LEGACY_EVENT_STAFF_PER_EVENT ||
    replacementAuditRows.length > 2 ||
    (replacementRowCount > 0 && (stage !== "events" || !readReplacement || eventRows.length !== 1 || markerRows.length !== 0)) ||
    (stage === "events" && readReplacement && eventRows.length === 1 && replacementEventRows.length !== 1) ||
    (stage === "system_user" && existingRows.length !== 0) ||
    (stage !== "system_user" && principalRows.length !== 0) ||
    (stage !== "events" && (eventRows.length !== 0 || eventStaffSnapshotRows.length !== 0)) ||
    (markerRows.length === 1 && (
      principalRows.length !== 0 || existingRows.length !== 0 ||
      eventRows.length !== 0 || eventStaffSnapshotRows.length !== 0
    ))
  ) {
    return fixedFailure("旧形式インポートのステップ監査または既存ID snapshotが不正です。");
  }

  if (markerRows.length === 1) {
    const stored = parseJsonRecord(
      markerRows[0].payload,
      "旧形式インポートのステップ監査が破損しています。",
    );
    const receipt = parseReceipt(stored);
    const expected = stage === "system_user"
      ? receipt.outcome.kind === "system_user"
        ? nextSystemUserProgress(
            input.progress,
            input.strategy === "skip_existing" ? input.progress.skipExistingEventIds : [],
            input.strategy === "skip_existing" ? input.progress.skipExistingVideoIds : [],
          )
        : fixedFailure("旧形式インポートのステップ監査と進捗が一致しません。")
      : stage === "x_users"
        ? nextXUsersProgress(input.plan, input.progress, receipt.outcome)
        : stage === "softwares"
          ? nextSoftwareProgress(input.plan, input.progress, receipt.outcome)
          : stage === "custom_questions"
            ? nextQuestionProgress(input.plan, input.progress, receipt.outcome, questions.length)
            : stage === "videos"
              ? nextVideoProgress(input, receipt.outcome)
              : nextEventProgress(input.plan, input.progress, receipt.outcome);
    if (!legacyImportReceiptMatchesProgress(receipt, identity, expected)) {
      return fixedFailure("旧形式インポートのステップ監査と進捗が一致しません。");
    }
    return { progress: expected, complete: expected.stage === "complete" };
  }

  const markerAbsenceAssertion = input.db.run(sql`
    SELECT CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM audit_logs
         WHERE table_name = ${STEP_AUDIT_TABLE}
           AND target_id = ${identity.targetId}
           AND context = ${STEP_AUDIT_CONTEXT}
      )
      THEN 1
      ELSE json_extract('not-valid-json', '$')
    END
  `);

  const buildMarkerAudit = (
    nextProgress: LegacyImportApplyProgress,
    outcome: StoredStepOutcome,
  ) => ({
    table_name: STEP_AUDIT_TABLE,
    target_id: identity.targetId,
    operation: "SYSTEM" as const,
    before: null,
    after: {
      run_digest: identity.runDigest,
      plan_hash: identity.planHash,
      stage: identity.stage,
      index: identity.index,
      outcome: outcome.kind === "system_user" ? { kind: "system_user" } : outcome,
      next_stage: nextProgress.stage,
      next_index: nextProgress.index,
      next_counts: nextProgress.counts,
      skip_event_snapshot_fingerprint: legacyImportSkipSnapshotFingerprint(
        nextProgress.skipExistingEventIds,
      ),
      skip_video_snapshot_fingerprint: legacyImportSkipSnapshotFingerprint(
        nextProgress.skipExistingVideoIds,
      ),
    },
    actor_user_id: input.actorAuthUserId,
    reason: "旧形式インポート継続ステップを確定",
    context: STEP_AUDIT_CONTEXT,
    retention_class: "long_audit" as const,
    restore_strategy: "none" as const,
    strict: true,
  });

  if (stage === "system_user") {
    let createPrincipal = true;
    if (principalRows.length === 1) {
      const principal = parseJsonRecord(
        principalRows[0].payload,
        "旧形式インポート専用principalを確認できません。",
      );
      if (!validSystemPrincipal(principal)) {
        return fixedFailure("旧形式インポート専用principalの予約IDが別用途で使用されています。");
      }
      createPrincipal = false;
    }
    const outcome = { kind: "system_user" } as const;
    const nextProgress = nextSystemUserProgress(
      input.progress,
      input.progress.skipExistingEventIds,
      input.progress.skipExistingVideoIds,
    );
    const markerAudit = buildMarkerAudit(nextProgress, outcome);
    const mutation = createPrincipal
      ? input.db.run(sql`
          INSERT INTO "user" (
            id, name, role, can_create_events, is_notification_enabled,
            is_tos_accepted, is_banned, created_at
          ) VALUES (
            ${SYSTEM_USER_ID}, 'Legacy import system', 'user', 0, 0, 0, 0,
            ${Math.floor(Date.now() / 1000)}
          )
        `)
      : input.db.run(sql`
          SELECT CASE WHEN 1 THEN 1
          ELSE json_extract('legacy_import_step_marker', '$') END
        `);
    const audits = createPrincipal
      ? [
          {
            table_name: "user",
            target_id: SYSTEM_USER_ID,
            operation: "CREATE" as const,
            before: null,
            after: { id: SYSTEM_USER_ID, technical_principal: true },
            actor_user_id: input.actorAuthUserId,
            reason: "旧形式インポート専用principalを作成",
            context: "legacy_import",
            retention_class: "long_audit" as const,
            restore_strategy: "delete_created" as const,
          },
          markerAudit,
        ]
      : [markerAudit];
    await mutateWithAudit(input.db, {
      preMutationAssertions: [markerAbsenceAssertion],
      mutationStatements: [mutation],
      expectedMutationChanges: createPrincipal ? [1] : [null],
      audits,
      callerQueryCount: 3,
      preloaded: input.preloaded,
    });
    return { progress: nextProgress, complete: false };
  }

  if (stage === "x_users") {
    if (input.plan.xUsers.length === 0) {
      const outcome = { kind: "none" } as const;
      const nextProgress = nextXUsersProgress(input.plan, input.progress, outcome);
      await mutateWithAudit(input.db, {
        preMutationAssertions: [markerAbsenceAssertion],
        mutationStatements: [
          input.db.run(sql`
            SELECT CASE WHEN 1 THEN 1
            ELSE json_extract('legacy_import_step_marker', '$') END
          `),
        ],
        expectedMutationChanges: [null],
        audits: [buildMarkerAudit(nextProgress, outcome)],
        callerQueryCount: 3,
        preloaded: input.preloaded,
      });
      return { progress: nextProgress, complete: false };
    }
  
    const existingIds = new Set<string>();
    for (const row of existingRows) {
      if (typeof row.payload !== "string" || row.payload.length === 0) {
        return fixedFailure("旧形式インポートの既存X名義ID snapshotが不正です。");
      }
      existingIds.add(row.payload);
    }
    if (existingIds.size !== existingRows.length) {
      return fixedFailure("旧形式インポートの既存X名義ID snapshotが重複しています。");
    }
    const missing = plannedXUserRows.filter((row) => !existingIds.has(row.id));
    const outcome = {
      kind: "x_users",
      created: missing.length,
      createdAuthUsers: 0,
    } as const;
    const nextProgress = nextXUsersProgress(input.plan, input.progress, outcome);
    const markerAudit = buildMarkerAudit(nextProgress, outcome);
  
    if (missing.length === 0) {
      await mutateWithAudit(input.db, {
        preMutationAssertions: [markerAbsenceAssertion],
        mutationStatements: [
          input.db.run(sql`
            SELECT CASE WHEN 1 THEN 1
            ELSE json_extract('legacy_import_step_marker', '$') END
          `),
        ],
        expectedMutationChanges: [null],
        audits: [markerAudit],
        callerQueryCount: 3,
        preloaded: input.preloaded,
      });
      return { progress: nextProgress, complete: false };
    }
  
    const now = Math.floor(Date.now() / 1000);
    const xUserPayload = JSON.stringify(missing);
    const queuePayload = JSON.stringify([{
      id: legacyImportRebuildQueueId(identity.targetId, 0),
      target_type: "users_index",
      target_id: "global",
      reason: "legacy_import_x_users",
      priority: "low",
    }]);
    await mutateWithAudit(input.db, {
      preMutationAssertions: [markerAbsenceAssertion],
      mutationStatements: [
        input.db.run(sql`
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
          FROM json_each(${xUserPayload})
        `),
        input.db.run(sql`
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
            'pending', 0, ${input.actorAuthUserId}, ${now}, ${now}
          FROM json_each(${queuePayload}) AS incoming
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
      ],
      expectedMutationChanges: [missing.length, 1],
      audits: [
        {
          table_name: "x_users_import_batch",
          target_id: "legacy:" + missing[0].id,
          operation: "CREATE" as const,
          before: null,
          after: { ids: missing.map((row) => row.id) },
          actor_user_id: input.actorAuthUserId,
          reason: "旧形式からX名義を新正本へ作成",
          context: "legacy_import",
          retention_class: "long_audit" as const,
          restore_strategy: "none" as const,
        },
        markerAudit,
      ],
      callerQueryCount: 3,
      preloaded: input.preloaded,
      staticRebuildWakeSource: "import",
    }, input.loadWakeHost);
    return { progress: nextProgress, complete: false };
  }

  
  if (stage === "events") {
    if (input.plan.events.length === 0) {
      const outcome = { kind: "none" } as const;
      const nextProgress = nextEventProgress(input.plan, input.progress, outcome);
      await mutateWithAudit(input.db, {
        preMutationAssertions: [markerAbsenceAssertion],
        mutationStatements: [
          input.db.run(sql`
            SELECT CASE WHEN 1 THEN 1
            ELSE json_extract('legacy_import_step_marker', '$') END
          `),
        ],
        expectedMutationChanges: [null],
        audits: [buildMarkerAudit(nextProgress, outcome)],
        callerQueryCount: 3,
        preloaded: input.preloaded,
      });
      return { progress: nextProgress, complete: false };
    }

    const event = plannedEvent;
    if (!event) return fixedFailure("旧形式インポートのイベント進捗位置が不正です。");
    if (eventRows.length === 1 && eventRows[0].payload !== event.id) {
      return fixedFailure("旧形式インポートの既存イベントsnapshotが不正です。");
    }
    if (eventStaffSnapshotRows.some((row) => typeof row.payload !== "string" || row.payload.length === 0)) {
      return fixedFailure("旧形式インポートの既存イベントスタッフsnapshotが不正です。");
    }
    const expectedExistingForSkip = input.progress.skipExistingEventIds.includes(event.id);
    let beforeEvent: Record<string, unknown> | null = null;
    let beforeStaff: Record<string, unknown>[] = [];
    let auditProof: Record<string, unknown> | null = null;
    if (eventRows.length === 1) {
      if (input.strategy === "skip_existing" && expectedExistingForSkip) {
        const outcome = { kind: "event", action: "skipped" } as const;
        const nextProgress = nextEventProgress(input.plan, input.progress, outcome);
        const eventStillExistsAssertion = input.db.run(sql`
          SELECT CASE WHEN EXISTS (
            SELECT 1 FROM events WHERE id = ${event.id}
          ) THEN 1 ELSE json_extract('legacy_import_event_disappeared_after_snapshot', '$') END
        `);
        await mutateWithAudit(input.db, {
          preMutationAssertions: [markerAbsenceAssertion, eventStillExistsAssertion],
          mutationStatements: [
            input.db.run(sql`
              SELECT CASE WHEN 1 THEN 1
              ELSE json_extract('legacy_import_step_marker', '$') END
            `),
          ],
          expectedMutationChanges: [null],
          audits: [buildMarkerAudit(nextProgress, outcome)],
          callerQueryCount: 3,
          preloaded: input.preloaded,
        });
        return { progress: nextProgress, complete: false };
      }
      if (input.strategy === "skip_existing" && !expectedExistingForSkip) {
        return fixedFailure(`イベント ${event.id} はプレビュー後に作成されたため、再プレビューが必要です。`);
      }
      if (input.strategy === "create_only") {
        return fixedFailure(`イベント ${event.id} は既に存在します。`);
      }
      if (!readReplacement || replacementEventRows.length !== 1 || replacementAuditRows.length !== 1) {
        return fixedFailure("旧形式イベントの最新snapshotを一意に確認できません。");
      }
      const eventPayload = replacementEventRows[0].payload;
      beforeEvent = parseJsonRecord(eventPayload, "旧形式イベントsnapshotが不正です。");
      beforeStaff = replacementStaffRows.map((row) =>
        parseJsonRecord(row.payload, "旧形式イベントスタッフsnapshotが不正です。"),
      );
      auditProof = parseJsonRecord(replacementAuditRows[0].payload, "旧形式イベント監査snapshotが不正です。");
      if (
        beforeEvent.id !== event.id ||
        typeof beforeEvent.created_at !== "number" ||
        !["public", "private"].includes(String(beforeEvent.visibility_status)) ||
        beforeStaff.some((row) => row.event_id !== event.id || typeof row.id !== "string") ||
        new Set(beforeStaff.map((row) => row.id)).size !== beforeStaff.length ||
        typeof auditProof.id !== "string" ||
        auditProof.target_id !== replacementTargetId ||
        auditProof.context !== ENTITY_SNAPSHOT_AUDIT_CONTEXT ||
        typeof auditProof.created_at !== "number" ||
        typeof auditProof.after_json !== "string" ||
        new TextEncoder().encode(JSON.stringify({ event: beforeEvent, staff: beforeStaff })).byteLength >
          MAX_LEGACY_IMPORT_STEP_BYTES
      ) {
        return fixedFailure("旧形式イベントの既存snapshotが不正または上限超過です。");
      }
      const proof = parseJsonRecord(auditProof.after_json, "旧形式イベント監査digestが不正です。");
      // CURRENT's digest includes only managed event fields, but staff is the
      // complete ordered snapshot. The D1 CAS below compares every event column.
      const managed = {
        id: beforeEvent.id, title: beforeEvent.title, event_type: beforeEvent.event_type,
        explanation: beforeEvent.explanation, icon_url: beforeEvent.icon_url, img_url: beforeEvent.img_url,
        visibility_status: beforeEvent.visibility_status, start_time: beforeEvent.start_time,
        end_time: beforeEvent.end_time, created_at: beforeEvent.created_at,
      };
      beforeStaff.sort((left, right) => String(left.id).localeCompare(String(right.id)));
      const [managedDigest, staffDigest] = await Promise.all([
        snapshotDigest(managed), snapshotDigest(beforeStaff),
      ]);
      if (proof.managed_digest !== managedDigest || proof.staff_digest !== staffDigest) {
        return fixedFailure("イベントの最新状態を旧形式インポート由来と確認できないため置換できません。");
      }
      // U02ah only permits same-status replacement. The visibility-changing
      // path remains fail closed until precommit/compensation is integrated.
      if (beforeEvent.visibility_status !== event.visibility_status) {
        return fixedFailure("公開状態が変わる既存イベントの置換はR2補償統合まで利用できません。");
      }
    }
    if (input.strategy === "skip_existing" && expectedExistingForSkip) {
      return fixedFailure(`イベント ${event.id} はプレビュー時点から削除されたため、再プレビューが必要です。`);
    }
    if (!beforeEvent && eventStaffSnapshotRows.length > 0) {
      return fixedFailure("イベント本体のない既存スタッフ行があるため、イベントを作成できません。");
    }

    const now = Math.floor(Date.now() / 1000);
    const nextStaff = input.plan.eventStaff
      .filter((row) => row.event_id === event.id)
      .map((row) => ({
        id: row.id,
        event_id: row.event_id,
        x_user_id: row.x_user_id,
        display_name: row.display_name,
        permission_preset: row.permission_preset,
        custom_permission_keys_json: null,
        is_public: row.is_public,
        public_role_label: row.public_role_label,
        approved_by_auth_user_id: input.actorAuthUserId,
        approved_at: now,
        created_at: now,
        updated_at: now,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    if (new Set(nextStaff.map((row) => row.id)).size !== nextStaff.length) {
      return fixedFailure("イベントスタッフIDが重複しています。");
    }
    const ownerCount = nextStaff.filter((row) => row.permission_preset === "owner").length;
    if (ownerCount !== 1) {
      return fixedFailure(`イベント ${event.id} の owner はちょうど1人必要です（現在 ${ownerCount} 人）。`);
    }
    const staffPayload = JSON.stringify(nextStaff);
    const managedEvent = {
      id: event.id,
      title: event.title,
      event_type: event.event_type,
      explanation: event.explanation,
      icon_url: event.icon_url,
      img_url: event.img_url,
      visibility_status: event.visibility_status,
      start_time: event.start_time,
      end_time: event.end_time,
      created_at: beforeEvent?.created_at ?? now,
    };
    const [managedDigest, staffDigest] = await Promise.all([
      snapshotDigest(managedEvent),
      snapshotDigest(nextStaff),
    ]);
    const snapshotTargetId = entitySnapshotTargetId("event", event.id);
    const queueRows = [
      { target_type: "event_base", target_id: event.id, reason: "legacy_import", priority: "high" },
      { target_type: "event_slots", target_id: event.id, reason: "legacy_import", priority: "high" },
      { target_type: "event_release", target_id: event.id, reason: "legacy_import", priority: "high" },
      { target_type: "events_index", target_id: "global", reason: "legacy_import", priority: "low" },
      { target_type: "search_index", target_id: "global", reason: "legacy_import", priority: "low" },
    ].map((row, index) => ({
      id: legacyImportRebuildQueueId(identity.targetId, index),
      ...row,
    }));
    const queuePayload = JSON.stringify(queueRows);
    const outcome = { kind: "event", action: beforeEvent ? "replaced" : "created" } as const;
    const nextProgress = nextEventProgress(input.plan, input.progress, outcome);
    // Compare the exact JSON text emitted by the same canonical SQL projection.
    // Bind the list as JSON strings, not dynamic SQL or one bind per staff field.
    const beforeStaffPayload = JSON.stringify(replacementStaffRows.map((row) => row.payload));
    const eventStateAssertion = beforeEvent && auditProof
      ? input.db.run(sql`
          SELECT CASE WHEN
            EXISTS (SELECT 1 FROM events WHERE id = ${event.id}
              AND ${existingEventJson} = ${replacementEventRows[0].payload})
            AND (SELECT COUNT(*) FROM event_staff WHERE event_id = ${event.id})
              = json_array_length(${beforeStaffPayload})
            AND (
              SELECT COUNT(*) FROM event_staff
              INNER JOIN json_each(${beforeStaffPayload}) AS snapshot
                ON ${existingStaffJson} = snapshot.value
              WHERE event_staff.event_id = ${event.id}
            ) = json_array_length(${beforeStaffPayload})
            AND EXISTS (
              SELECT 1 FROM audit_logs AS proof
               WHERE proof.id = ${auditProof.id as string}
                 AND proof.table_name = ${ENTITY_SNAPSHOT_AUDIT_TABLE}
                 AND proof.target_id = ${replacementTargetId}
                 AND proof.context = ${ENTITY_SNAPSHOT_AUDIT_CONTEXT}
                 AND proof.after_json IS ${auditProof.after_json as string}
                 AND proof.created_at = ${auditProof.created_at as number}
                 AND NOT EXISTS (
                   SELECT 1 FROM audit_logs AS competing
                    WHERE competing.table_name = proof.table_name
                      AND competing.target_id = proof.target_id
                      AND competing.context = proof.context
                      AND (competing.created_at > proof.created_at
                        OR (competing.created_at = proof.created_at AND competing.id <> proof.id))
                 )
            )
          THEN 1 ELSE json_extract('legacy_import_event_snapshot_mismatch', '$') END
        `)
      : input.db.run(sql`
          SELECT CASE WHEN
            NOT EXISTS (SELECT 1 FROM events WHERE id = ${event.id})
            AND NOT EXISTS (SELECT 1 FROM event_staff WHERE event_id = ${event.id})
          THEN 1 ELSE json_extract('legacy_import_event_exists_after_snapshot', '$') END
        `);
    await mutateWithAudit(input.db, {
      preMutationAssertions: [markerAbsenceAssertion, eventStateAssertion],
      mutationStatements: [
        beforeEvent
          ? input.db.run(sql`
              UPDATE events SET
                title = ${event.title}, event_type = ${event.event_type},
                explanation = ${event.explanation}, icon_url = ${event.icon_url},
                img_url = ${event.img_url}, visibility_status = ${event.visibility_status},
                start_time = ${event.start_time}, end_time = ${event.end_time}, updated_at = ${now}
              WHERE id = ${event.id}
            `)
          : input.db.run(sql`
          INSERT INTO events (
            id, title, event_type, explanation, icon_url, img_url, accent_color,
            visibility_status, allow_user_video_event_links, allow_unslotted_posts,
            allow_user_video_edits, slot_type, slot_visibility_mode, start_time, end_time,
            entry_start_time, entry_end_time, created_at, updated_at, max_slots_per_video,
            slot_part_gap_minutes, public_api_enabled
          ) VALUES (
            ${event.id}, ${event.title}, ${event.event_type}, ${event.explanation},
            ${event.icon_url}, ${event.img_url}, NULL, ${event.visibility_status},
            0, 0, 0, 'time', 'public_name', ${event.start_time}, ${event.end_time},
            NULL, NULL, ${now}, ${now}, 1, 15, 0
          )
        `),
        ...(beforeEvent && beforeStaff.length > 0
          ? [input.db.run(sql`DELETE FROM event_staff WHERE event_id = ${event.id}`)]
          : []),
        input.db.run(sql`
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
          FROM json_each(${staffPayload})
        `),
        input.db.run(sql`
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
            'pending', 0, ${input.actorAuthUserId}, ${now}, ${now}
          FROM json_each(${queuePayload}) AS incoming
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
      ],
      expectedMutationChanges: [1, ...(beforeEvent && beforeStaff.length > 0 ? [beforeStaff.length] : []), nextStaff.length, queueRows.length],
      audits: [
        {
          table_name: "events",
          target_id: event.id,
          operation: beforeEvent ? "UPDATE" as const : "CREATE" as const,
          before: beforeEvent,
          after: { ...event, staff: input.plan.eventStaff.filter((row) => row.event_id === event.id) },
          actor_user_id: input.actorAuthUserId,
          reason: "旧形式イベントを新正本へ変換",
          context: "legacy_import",
          retention_class: "long_audit" as const,
          restore_strategy: beforeEvent ? "none" as const : "delete_created" as const,
        },
        {
          table_name: ENTITY_SNAPSHOT_AUDIT_TABLE,
          target_id: snapshotTargetId,
          operation: "SYSTEM" as const,
          before: null,
          after: {
            entity_kind: "event",
            managed_digest: managedDigest,
            staff_digest: staffDigest,
          },
          actor_user_id: input.actorAuthUserId,
          reason: "旧形式イベントの置換可能snapshotを確定",
          context: ENTITY_SNAPSHOT_AUDIT_CONTEXT,
          retention_class: "long_audit" as const,
          restore_strategy: "none" as const,
          strict: true,
        },
        buildMarkerAudit(nextProgress, outcome),
      ],
      callerQueryCount: 3,
      preloaded: input.preloaded,
      staticRebuildWakeSource: "import",
    }, input.loadWakeHost);
    // The audited D1 batch commits queue rows first; mutateWithAudit then sends one
    // best-effort wake. Receipt replay never re-sends after an R2 progress CAS failure.
    return { progress: nextProgress, complete: false };
  }

  if (stage === "custom_questions") {
    const existing = existingRows.map((row) => ({
      payload: row.payload,
      row: parseJsonRecord(row.payload, "旧形式インポートのカスタム質問snapshotが不正です。"),
    }));
    if (existing.some(({ row }) => typeof row.id !== "string") ||
        new Set(existing.map(({ row }) => row.id)).size !== existing.length) {
      return fixedFailure("旧形式インポートのカスタム質問snapshotが重複しています。");
    }
    const missing: PlannedQuestion[] = [];
    const reusedPayloads: string[] = [];
    for (const question of questions) {
      const matches = existing.filter(({ row }) => row.id === question.id ||
        (row.event_id === question.event_id && row.question_key === question.question_key));
      if (matches.length === 0) {
        missing.push(question);
      } else {
        const match = matches[0];
        if (matches.length !== 1 || !sameQuestionDefinition(match.row, question) ||
            typeof match.payload !== "string") {
          return fixedFailure("既存のカスタム質問IDまたは定義が一致しません。");
        }
        reusedPayloads.push(match.payload);
      }
    }
    const outcome: StoredStepOutcome = input.plan.eventCustomQuestions.length === 0
      ? { kind: "none" }
      : { kind: "custom_questions", created: missing.length, reused: reusedPayloads.length };
    const nextProgress = nextQuestionProgress(input.plan, input.progress, outcome, questions.length);
    const now = Math.floor(Date.now() / 1000);
    const rows = missing.map(({ source_key: _sourceKey, ...question }) => ({
      ...question, created_at: now, updated_at: now,
    }));
    const missingPayload = JSON.stringify(rows);
    const reusedPayload = JSON.stringify(reusedPayloads);
    const videoPayload = JSON.stringify(videoSnapshot);
    const assertions = [
      markerAbsenceAssertion,
      ...(questions.length > 0 ? [input.db.run(sql`
        SELECT CASE WHEN
          NOT EXISTS (
            SELECT 1 FROM json_each(${questionPayload}) AS incoming
             WHERE NOT EXISTS (
               SELECT 1 FROM events WHERE id = json_extract(incoming.value, '$.event_id')
             )
          )
          AND NOT EXISTS (
            SELECT 1 FROM json_each(${reusedPayload}) AS incoming
             WHERE NOT EXISTS (
               SELECT 1 FROM event_custom_questions
                WHERE id = json_extract(incoming.value, '$.id')
                  AND ${existingQuestionJson} = incoming.value
             )
          )
          AND NOT EXISTS (
            SELECT 1 FROM json_each(${missingPayload}) AS incoming
             WHERE EXISTS (
               SELECT 1 FROM event_custom_questions
                WHERE id = json_extract(incoming.value, '$.id')
                   OR (event_id = json_extract(incoming.value, '$.event_id')
                     AND question_key = json_extract(incoming.value, '$.question_key'))
             )
          )
          AND NOT EXISTS (
            SELECT 1 FROM (
              SELECT json_extract(value, '$.event_id') AS event_id, COUNT(*) AS incoming_count
                FROM json_each(${missingPayload})
               GROUP BY json_extract(value, '$.event_id')
            ) AS incoming
             WHERE (SELECT COUNT(*) FROM event_custom_questions AS current
                     WHERE current.event_id = incoming.event_id) + incoming.incoming_count
                   > ${MAX_EVENT_CUSTOM_QUESTIONS}
          )
        THEN 1 ELSE json_extract('legacy_import_question_snapshot_mismatch', '$') END
      `)] : []),
      ...(rows.length > 0 && videoSnapshot.length > 0 ? [input.db.run(sql`
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM json_each(${videoPayload}) AS incoming
           WHERE CAST(json_extract(incoming.value, '$.exists') AS INTEGER) <>
             CASE WHEN EXISTS (
               SELECT 1 FROM videos WHERE id = json_extract(incoming.value, '$.id')
             ) THEN 1 ELSE 0 END
        ) THEN 1 ELSE json_extract('legacy_import_video_snapshot_mismatch', '$') END
      `)] : []),
    ];
    const mutation = rows.length === 0
      ? input.db.run(sql`SELECT 1`)
      : input.db.run(sql`
          INSERT INTO event_custom_questions (
            id, event_id, question_key, label, description, type, required,
            options_json, placeholder, max_length, sort_order, is_active, visibility,
            created_at, updated_at
          )
          SELECT
            json_extract(value, '$.id'), json_extract(value, '$.event_id'),
            json_extract(value, '$.question_key'), json_extract(value, '$.label'),
            json_extract(value, '$.description'), json_extract(value, '$.type'),
            json_extract(value, '$.required'), json_extract(value, '$.options_json'),
            json_extract(value, '$.placeholder'), json_extract(value, '$.max_length'),
            json_extract(value, '$.sort_order'), json_extract(value, '$.is_active'),
            json_extract(value, '$.visibility'), json_extract(value, '$.created_at'),
            json_extract(value, '$.updated_at')
          FROM json_each(${missingPayload})
        `);
    await mutateWithAudit(input.db, {
      preMutationAssertions: assertions,
      mutationStatements: [mutation],
      expectedMutationChanges: [rows.length > 0 ? rows.length : null],
      audits: [
        ...rows.map((row) => ({
          table_name: "event_custom_questions",
          target_id: row.id,
          operation: "CREATE" as const,
          before: null,
          after: row,
          actor_user_id: input.actorAuthUserId,
          reason: "旧形式動画の未対応項目をカスタム質問として作成",
          context: "legacy_import:custom-question",
          retention_class: "long_audit" as const,
          restore_strategy: "delete_created" as const,
          strict: true,
        })),
        buildMarkerAudit(nextProgress, outcome),
      ],
      callerQueryCount: 3,
      preloaded: input.preloaded,
    });
    return { progress: nextProgress, complete: false };
  }

  if (stage === "videos") {
    const expectedExistingForSkip = plannedVideo &&
      input.strategy === "skip_existing" &&
      input.progress.skipExistingVideoIds.includes(plannedVideo.id);
    if (plannedVideo) {
      if (input.strategy === "skip_existing" && expectedExistingForSkip !== (videoRows.length === 1)) {
        return fixedFailure("作品の存在状態がプレビュー時点から変更されたため、再プレビューが必要です。");
      }
      if (!expectedExistingForSkip) {
        // Neither create nor replace may reach a D1 write, receipt or Queue wake
        // before the full video support snapshot and side effects are migrated.
        return fixedFailure("旧形式インポートの作品作成・置換はHono側でまだ利用できません。");
      }
    }
    const outcome: StoredStepOutcome = plannedVideo
      ? { kind: "video", action: "skipped" }
      : { kind: "none" };
    const nextProgress = nextVideoProgress(input, outcome);
    const assertions = [
      markerAbsenceAssertion,
      ...(plannedVideo ? [input.db.run(sql`
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM videos WHERE id = ${plannedVideo.id}
        ) THEN 1 ELSE json_extract('legacy_import_video_disappeared_after_snapshot', '$') END
      `)] : []),
    ];
    await mutateWithAudit(input.db, {
      preMutationAssertions: assertions,
      mutationStatements: [input.db.run(sql`SELECT 1`)],
      expectedMutationChanges: [null],
      audits: [buildMarkerAudit(nextProgress, outcome)],
      callerQueryCount: 3,
      preloaded: input.preloaded,
    });
    return { progress: nextProgress, complete: nextProgress.stage === "complete" };
  }

  if (stage !== "softwares") {
    return fixedFailure("旧形式インポートのこの段階はHono側でまだ利用できません。");
  }
  if (allSoftwareRows.length === 0) {
    const outcome = { kind: "none" } as const;
    const nextProgress = nextSoftwareProgress(input.plan, input.progress, outcome);
    await mutateWithAudit(input.db, {
      preMutationAssertions: [markerAbsenceAssertion],
      mutationStatements: [
        input.db.run(sql`
          SELECT CASE WHEN 1 THEN 1
          ELSE json_extract('legacy_import_step_marker', '$') END
        `),
      ],
      expectedMutationChanges: [null],
      audits: [buildMarkerAudit(nextProgress, outcome)],
      callerQueryCount: 3,
      preloaded: input.preloaded,
    });
    return { progress: nextProgress, complete: false };
  }

  const existingSoftwareNames = new Set<string>();
  for (const row of existingRows) {
    if (typeof row.payload !== "string" || row.payload.length === 0) {
      return fixedFailure("旧形式インポートの既存使用ソフトsnapshotが不正です。");
    }
    existingSoftwareNames.add(row.payload);
  }
  if (existingSoftwareNames.size !== existingRows.length) {
    return fixedFailure("旧形式インポートの既存使用ソフトsnapshotが重複しています。");
  }
  const missing = plannedSoftwareRows.filter((row) => !existingSoftwareNames.has(row.normalized_name));
  const outcome = { kind: "softwares", created: missing.length } as const;
  const nextProgress = nextSoftwareProgress(input.plan, input.progress, outcome);
  const markerAudit = buildMarkerAudit(nextProgress, outcome);

  if (missing.length === 0) {
    await mutateWithAudit(input.db, {
      preMutationAssertions: [markerAbsenceAssertion],
      mutationStatements: [
        input.db.run(sql`
          SELECT CASE WHEN 1 THEN 1
          ELSE json_extract('legacy_import_step_marker', '$') END
        `),
      ],
      expectedMutationChanges: [null],
      audits: [markerAudit],
      callerQueryCount: 3,
      preloaded: input.preloaded,
    });
    return { progress: nextProgress, complete: false };
  }

  const now = Math.floor(Date.now() / 1000);
  const softwarePayload = JSON.stringify(missing);
  await mutateWithAudit(input.db, {
    preMutationAssertions: [markerAbsenceAssertion],
    mutationStatements: [
      input.db.run(sql`
        INSERT INTO software_catalog (
          id, name, normalized_name, category, usage_count,
          is_active, is_verified, created_at, updated_at
        )
        SELECT
          json_extract(value, '$.id'),
          json_extract(value, '$.name'),
          json_extract(value, '$.normalized_name'),
          NULL, 0, 1, 0, ${now}, ${now}
        FROM json_each(${softwarePayload})
      `),
    ],
    expectedMutationChanges: [missing.length],
    audits: [
      {
        table_name: "software_catalog_import_batch",
        target_id: "legacy:" + missing[0].id,
        operation: "CREATE" as const,
        before: null,
        after: { rows: missing },
        actor_user_id: input.actorAuthUserId,
        reason: "旧形式の使用ソフトを新正本辞書へ追加",
        context: "legacy_import",
        retention_class: "long_audit" as const,
        restore_strategy: "none" as const,
      },
      markerAudit,
    ],
    callerQueryCount: 3,
    preloaded: input.preloaded,
  });
  return { progress: nextProgress, complete: false };
}
