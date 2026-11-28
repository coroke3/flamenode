import { getTableColumns, sql } from "drizzle-orm";
import {
  events, eventStaff, eventCustomQuestions, videos, videoEvents, videoMembers,
  videoChapters, videoSoftwares, videoYoutubeMetadata, videoCustomAnswers, publicVisibilityFences,
} from "@flamenode/db/schema";
import {
  isValidPreloadedActorSnapshotJson,
  isValidPreloadedAuditSettings,
  type PreloadedAuditContext,
} from "../audit/logger.ts";
import { mutateWithAudit } from "../audit/mutate.ts";
import type { ServerCoreDb } from "../db.ts";
import type { QueueWakeHostLoader } from "../ports.ts";
import type { QueueWakeKind } from "../queues/wakeBudget.ts";
import { sendYoutubeSyncPendingWakeBestEffort } from "../queues/youtubeSyncWake.ts";
import {
  MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO,
  type CanonicalLegacyPlan,
  type LegacyImportStrategy,
} from "./normalize.ts";
import type { LegacyImportApplyProgress } from "./previewStore.ts";
import {
  MAX_LEGACY_EVENT_STAFF_PER_EVENT,
  MAX_LEGACY_IMPORT_STEP_BYTES,
  MAX_LEGACY_IMPORT_SELECTED_ROWS,
  MAX_LEGACY_VIDEO_EVENTS_PER_VIDEO,
  MAX_LEGACY_VIDEO_MEMBERS_PER_VIDEO,
  MAX_LEGACY_VIDEO_CHAPTERS_PER_VIDEO,
  MAX_LEGACY_VIDEO_SOFTWARES_PER_VIDEO,
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
const existingFenceJson = canonicalRowJson(getTableColumns(publicVisibilityFences), "public_visibility_fences");

type LegacyImportFenceIdentity = {
  entityType: "event" | "video";
  entityId: string;
  fenceToken: string;
};
type LegacyImportFenceSnapshot = LegacyImportFenceIdentity & {
  previousState: "blocked" | "release_pending" | "released" | null;
  raw: string | null;
};

const LEGACY_FENCE_CONFLICT = "旧形式インポートの公開フェンスの所有権を確認できません。";

function validateLegacyFenceSnapshot(identity: LegacyImportFenceIdentity, raw: string | null) {
  if ((identity.entityType !== "event" && identity.entityType !== "video") ||
      !identity.entityId || !identity.fenceToken ||
      new TextEncoder().encode(JSON.stringify(identity)).byteLength > MAX_LEGACY_IMPORT_STEP_BYTES) {
    return fixedFailure(LEGACY_FENCE_CONFLICT);
  }
  if (raw === null) return null;
  if (new TextEncoder().encode(raw).byteLength > MAX_LEGACY_IMPORT_STEP_BYTES) {
    return fixedFailure(LEGACY_FENCE_CONFLICT);
  }
  const row = parseJsonRecord(raw, LEGACY_FENCE_CONFLICT);
  if (row.entity_type !== identity.entityType || row.entity_id !== identity.entityId ||
      typeof row.fence_token !== "string" || !row.fence_token ||
      (row.state !== "blocked" && row.state !== "release_pending" && row.state !== "released") ||
      !Number.isSafeInteger(row.updated_at) ||
      ["reason", "requirements_json", "requested_by_auth_user_id"].some((key) =>
        row[key] !== null && typeof row[key] !== "string") ||
      ["blocked_at", "release_requested_at"].some((key) =>
        row[key] !== null && !Number.isSafeInteger(row[key]))) {
    return fixedFailure(LEGACY_FENCE_CONFLICT);
  }
  // Never seize an active foreign token, or reuse an already released token.
  // Reusing an active matching token still needs manifest and release-worker
  // coordination; this read alone authorizes no transition.
  if (row.state === "released" ? row.fence_token === identity.fenceToken
    : row.fence_token !== identity.fenceToken) {
    return fixedFailure(LEGACY_FENCE_CONFLICT);
  }
  return row.state;
}

/**
 * U02ar: bounded D1 ownership snapshot, without mutating the fence or R2.
 * A caller must supply a proposed token, not infer ownership from a row.
 */
export async function readLegacyImportFenceSnapshot(
  db: ServerCoreDb,
  identity: LegacyImportFenceIdentity,
): Promise<LegacyImportFenceSnapshot> {
  validateLegacyFenceSnapshot(identity, null);
  const rows = await db.all(sql`
    WITH candidates AS (
      SELECT ${existingFenceJson} AS payload
      FROM public_visibility_fences
      WHERE entity_type = ${identity.entityType} AND entity_id = ${identity.entityId}
      LIMIT 2
    )
    SELECT CASE WHEN length(CAST(payload AS BLOB)) <= ${MAX_LEGACY_IMPORT_STEP_BYTES}
      THEN payload ELSE NULL END AS payload
    FROM candidates
  `) as Array<{ payload: string | null }>;
  if (rows.length > 1 || (rows.length === 1 && typeof rows[0].payload !== "string")) {
    return fixedFailure(LEGACY_FENCE_CONFLICT);
  }
  const raw = rows[0]?.payload ?? null;
  const previousState = validateLegacyFenceSnapshot(identity, raw);
  return { ...identity, previousState, raw };
}

/**
 * Unexecuted same-batch CAS: compare the entire row (including requirements,
 * state, timestamps and actor), or require continued absence. Must precede
 * the future audited canonical mutation and fence write in the same D1 batch.
 * No transition, R2 compensation, or cross-writer lock is implemented here.
 */
export function buildLegacyImportFenceAssertion(db: ServerCoreDb, snapshot: LegacyImportFenceSnapshot) {
  const state = validateLegacyFenceSnapshot(snapshot, snapshot.raw);
  if (state !== snapshot.previousState) return fixedFailure(LEGACY_FENCE_CONFLICT);
  const predicate = snapshot.raw === null ? sql`
    NOT EXISTS (
      SELECT 1 FROM public_visibility_fences
      WHERE entity_type = ${snapshot.entityType} AND entity_id = ${snapshot.entityId}
    )
  ` : sql`
    (SELECT COUNT(*) FROM public_visibility_fences
      WHERE entity_type = ${snapshot.entityType} AND entity_id = ${snapshot.entityId}) = 1
    AND EXISTS (
      SELECT 1 FROM public_visibility_fences
      WHERE entity_type = ${snapshot.entityType} AND entity_id = ${snapshot.entityId}
        AND ${existingFenceJson} = ${snapshot.raw}
    )
  `;
  return db.run(sql`
    SELECT CASE WHEN (${predicate}) THEN 1
      ELSE json_extract('legacy_import_fence_snapshot_mismatch', '$') END
  `);
}

/**
 * U02as: read-only evidence for recovering a freshly precommitted R2 block
 * after an unsuccessful or ambiguous D1 batch. A missing marker alone is
 * NEVER proof of rollback. Compare the complete previous canonical entity
 * and fence row in the same D1 read. A pre-existing active token is not a
 * newly installed block and must never be released by this recovery path.
 *
 * Even "rollback_candidate" is NOT permission to remove a manifest entry:
 * shared-writer exclusion and a conditional R2 release must still be proved.
 * This helper does not write D1/R2, advance progress, or send queue wakes.
 */
export async function inspectLegacyImportFenceRecovery(input: {
  db: ServerCoreDb;
  before: LegacyImportFenceSnapshot;
  beforeEntityJson: string;
  step: { runDigest: string; planHash: string; stage: "events" | "videos"; index: number };
  d1Outcome: "confirmed_rollback" | "unknown";
}): Promise<"retain" | "rollback_candidate"> {
  const { db, before, step, beforeEntityJson } = input;
  const stage = before.entityType === "event" ? "events" : "videos";
  // A network error, timeout, or ambiguous provider response is never
  // upgraded to a definite rollback by this snapshot inspection.
  if (input.d1Outcome !== "confirmed_rollback" ||
      before.previousState === "blocked" || before.previousState === "release_pending") {
    return "retain";
  }
  const state = validateLegacyFenceSnapshot(before, before.raw);
  if (state !== before.previousState || step.stage !== stage ||
      !/^[a-f0-9]{24}$/.test(step.runDigest) || !/^[a-f0-9]{64}$/.test(step.planHash) ||
      !Number.isSafeInteger(step.index) || step.index < 0 ||
      typeof beforeEntityJson !== "string" ||
      new TextEncoder().encode(beforeEntityJson).byteLength > MAX_LEGACY_IMPORT_STEP_BYTES) {
    return "retain";
  }
  const previous = parseJsonRecord(beforeEntityJson, LEGACY_FENCE_CONFLICT);
  if (previous.id !== before.entityId ||
      typeof previous.visibility_status !== "string") return "retain";
  const targetId = step.runDigest + ":" + step.planHash.slice(0, 24) + ":" + stage + ":" + step.index;
  const table = before.entityType === "event" ? "events" : "videos";
  const entityJson = before.entityType === "event"
    ? existingEventJson : canonicalRowJson(getTableColumns(videos), "videos");
  const fenceUnchanged = before.raw === null ? sql`
    NOT EXISTS (SELECT 1 FROM public_visibility_fences
      WHERE entity_type = ${before.entityType} AND entity_id = ${before.entityId})
  ` : sql`
    (SELECT COUNT(*) FROM public_visibility_fences
      WHERE entity_type = ${before.entityType} AND entity_id = ${before.entityId}) = 1
    AND EXISTS (SELECT 1 FROM public_visibility_fences
      WHERE entity_type = ${before.entityType} AND entity_id = ${before.entityId}
        AND ${existingFenceJson} = ${before.raw})
  `;
  // Any record at the step identity, including one with unexpected context
  // or malformed payload, is enough to prevent a release candidate. Do not
  // interpret its presence as a valid committed receipt; replay owns that.
  const rows = await db.all(sql`
    SELECT
      CASE WHEN EXISTS (
        SELECT 1 FROM audit_logs WHERE table_name = ${STEP_AUDIT_TABLE}
          AND target_id = ${targetId}
      ) THEN 1 ELSE 0 END AS has_receipt,
      CASE WHEN EXISTS (
        SELECT 1 FROM ${sql.raw(table)} WHERE id = ${before.entityId}
          AND ${entityJson} = ${beforeEntityJson}
      ) THEN 1 ELSE 0 END AS entity_unchanged,
      CASE WHEN (${fenceUnchanged}) THEN 1 ELSE 0 END AS fence_unchanged
  `) as Array<{ has_receipt: number; entity_unchanged: number; fence_unchanged: number }>;
  const row = rows[0];
  return rows.length === 1 && row?.has_receipt === 0 &&
    row.entity_unchanged === 1 && row.fence_unchanged === 1
    ? "rollback_candidate" : "retain";
}

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
  | { kind: "video"; action: "created" | "replaced" | "skipped" };

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

function entitySnapshotTargetId(kind: "event" | "video", id: string): string {
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

/**
 * U02ak: bounded, I/O-free (except local SHA-256) new-video write projection.
 * Keep the object field order byte-for-byte equal to CURRENT's managedVideoSnapshot
 * and related-row projections, so future replace_imported provenance works across
 * Next and Hono. The caller must obtain the creator/catalog snapshot from D1 and
 * atomically assert it, question definitions, relation existence and row absence
 * before using this projection. This helper alone authorizes no writes.
 */
export async function projectLegacyVideoCreate(input: {
  plan: CanonicalLegacyPlan;
  videoId: string;
  creator: { profile_text: string | null; other_social_links: string | null } | null;
  softwareIds: ReadonlyMap<string, string>;
  now: number;
}) {
  const { plan, videoId, creator, softwareIds, now } = input;
  const matches = plan.videos.filter((row) => row.id === videoId);
  if (matches.length !== 1 || !Number.isSafeInteger(now) || now < 0) {
    return fixedFailure("旧形式インポートの作品planが不正です。");
  }
  const video = matches[0];
  const relations = plan.videoEvents.filter((row) => row.video_id === videoId);
  const members = plan.videoMembers.filter((row) => row.video_id === videoId);
  const chapters = plan.videoChapters.filter((row) => row.video_id === videoId);
  const softwareLabels = plan.videoSoftwares.filter((row) => row.video_id === videoId);
  const answers = plan.videoCustomAnswers.filter((row) => row.video_id === videoId);
  const unique = <T>(rows: readonly T[], key: (row: T) => string) =>
    new Set(rows.map(key)).size === rows.length;
  if (
    relations.length > MAX_LEGACY_VIDEO_EVENTS_PER_VIDEO ||
    members.length > MAX_LEGACY_VIDEO_MEMBERS_PER_VIDEO ||
    chapters.length > MAX_LEGACY_VIDEO_CHAPTERS_PER_VIDEO ||
    softwareLabels.length > MAX_LEGACY_VIDEO_SOFTWARES_PER_VIDEO ||
    answers.length > MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO ||
    !unique(relations, (row) => row.event_id) ||
    !unique(members, (row) => row.id) ||
    !unique(chapters, (row) => row.id) ||
    !unique(answers, (row) => JSON.stringify([row.event_id, row.question_id]))
  ) {
    return fixedFailure("旧形式インポートの作品関連行が重複または上限超過です。");
  }
  const relationIds = new Set(relations.map((row) => row.event_id));
  const questionIds = new Set(answers.map((row) => row.question_id));
  const plannedQuestions = plan.eventCustomQuestions.filter((row) => questionIds.has(row.id));
  if (
    plannedQuestions.length !== questionIds.size ||
    !unique(plannedQuestions, (row) => row.id) ||
    answers.some((answer) => !relationIds.has(answer.event_id) ||
      !plannedQuestions.some((q) => q.id === answer.question_id &&
        q.event_id === answer.event_id && q.question_key === answer.question_key))
  ) {
    return fixedFailure("旧形式インポートの作品カスタム質問snapshotが不正です。");
  }
  if (new TextEncoder().encode(JSON.stringify({
    video, relations, members, chapters, softwareLabels, answers, plannedQuestions,
  })).byteLength > MAX_LEGACY_IMPORT_STEP_BYTES) {
    return fixedFailure("旧形式インポートの作品ステップが上限超過です。");
  }
  // Explicit order is part of the CURRENT SHA-256 receipt contract.
  const managed = {
    id: video.id,
    primary_event_id: video.primary_event_id,
    creator_x_user_id: video.creator_x_user_id,
    submitted_by_user_id: SYSTEM_USER_ID,
    collaboration_type: video.collaboration_type,
    part: null,
    source_type: video.source_type,
    creator_display_name: video.creator_display_name,
    creator_display_name_yomi: video.creator_display_name_yomi,
    creator_icon_url: video.creator_icon_url,
    creator_youtube_channel_url: video.creator_youtube_channel_url,
    creator_profile_text: video.creator_profile_text ?? creator?.profile_text ?? null,
    creator_other_social_links: video.creator_other_social_links ?? creator?.other_social_links ?? null,
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
    scheduling_type: "manual" as const,
    scheduled_time: video.scheduled_time,
    created_at: video.created_at,
  };
  const nextEvents = relations.map((row) => ({
    video_id: row.video_id, event_id: row.event_id,
  })).sort((left, right) => left.event_id.localeCompare(right.event_id));
  const nextMembers = members.map((row) => ({
    id: row.id, video_id: row.video_id, x_user_id: row.x_user_id,
    name: row.name, role: row.role, comment: null, order_index: row.order_index,
    can_edit: 0, is_public_member: 1, edit_granted_by_auth_user_id: null,
    edit_granted_at: null, edit_updated_at: null,
  })).sort((left, right) => left.id.localeCompare(right.id));
  const nextChapters = chapters.map((row) => ({
    id: row.id, video_id: row.video_id, x_user_id: row.x_user_id,
    chapter_time: row.chapter_time, chapter_label: row.chapter_label, note: row.note,
    visibility: "public" as const, created_at: now, updated_at: now,
  })).sort((left, right) => left.id.localeCompare(right.id));
  const nextSoftwares = softwareLabels.map((row) => {
    const softwareId = softwareIds.get(normalizeSoftwareName(row.label));
    if (!softwareId) return fixedFailure("旧形式インポートの使用ソフトがcatalogに存在しません。");
    return { video_id: videoId, software_id: softwareId, raw_label: row.label };
  }).sort((left, right) => left.software_id.localeCompare(right.software_id));
  if (!unique(nextSoftwares, (row) => row.software_id)) {
    return fixedFailure("旧形式インポートの使用ソフトIDが重複しています。");
  }
  const nextMetadata = video.youtube_video_id ? [{
    video_id: videoId, youtube_privacy_status: null, youtube_availability_status: null,
    duration_seconds: null, view_count: 0, synced_at: null, sync_status: "pending" as const,
    sync_error: null, updated_at: now,
  }] : [];
  const nextAnswers = answers.map((row) => ({
    video_id: row.video_id, event_id: row.event_id, question_id: row.question_id,
    answer_text: row.answer_text, answer_json: row.answer_json,
    created_at: now, updated_at: now,
  })).sort((left, right) =>
    left.event_id.localeCompare(right.event_id) || left.question_id.localeCompare(right.question_id),
  );
  const rebuildEventIds = [...new Set(
    [video.primary_event_id, ...nextEvents.map((row) => row.event_id)]
      .filter((eventId): eventId is string => !!eventId),
  )];
  const rebuildTargets = [
    { target_type: "video", target_id: videoId, priority: "high" },
    ...["top_recommended", "top_latest", "top_nostalgic", "top_stats", "recommend_core",
      "list_recent", "list_popular", "search_index"].map((target_type) =>
        ({ target_type, target_id: "global", priority: "normal" })),
    ...(video.creator_x_user_id
      ? [{ target_type: "user", target_id: video.creator_x_user_id, priority: "normal" }]
      : []),
    ...rebuildEventIds.flatMap((eventId) => ["event_base", "event_slots", "event_release"]
      .map((target_type) => ({ target_type, target_id: eventId, priority: "high" }))),
  ].map((row) => ({ ...row, reason: "legacy_import" }));
  // Fallback creator fields may come from D1 rather than the bounded preview.
  // Bound the final projection as well, before hashing or building SQL.
  const projected = {
    managed, nextEvents, nextMembers, nextChapters, nextSoftwares, nextMetadata,
    nextAnswers, plannedQuestions, rebuildTargets,
  };
  if (new TextEncoder().encode(JSON.stringify(projected)).byteLength > MAX_LEGACY_IMPORT_STEP_BYTES) {
    return fixedFailure("旧形式インポートの作品書込snapshotが上限超過です。");
  }
  const [managed_digest, events_digest, members_digest, chapters_digest,
    softwares_digest, metadata_digest, custom_answers_digest] = await Promise.all([
    managed, nextEvents, nextMembers, nextChapters, nextSoftwares, nextMetadata, nextAnswers,
  ].map(snapshotDigest));
  return {
    ...projected,
    snapshotProof: {
      entity_kind: "video" as const, managed_digest, events_digest, members_digest,
      chapters_digest, softwares_digest, metadata_digest, custom_answers_digest,
    },
    youtubeWakeRequired: !!video.youtube_video_id,
  };
}

const VIDEO_REPLACEMENT_SNAPSHOT_SETS = [
  { kind: "video", table: "videos", columns: getTableColumns(videos), lookup: "id", sort1: "id", sort2: null, cap: 1 },
  { kind: "events", table: "video_events", columns: getTableColumns(videoEvents), lookup: "video_id", sort1: "event_id", sort2: null, cap: MAX_LEGACY_VIDEO_EVENTS_PER_VIDEO },
  { kind: "members", table: "video_members", columns: getTableColumns(videoMembers), lookup: "video_id", sort1: "id", sort2: null, cap: MAX_LEGACY_VIDEO_MEMBERS_PER_VIDEO },
  { kind: "chapters", table: "video_chapters", columns: getTableColumns(videoChapters), lookup: "video_id", sort1: "id", sort2: null, cap: MAX_LEGACY_VIDEO_CHAPTERS_PER_VIDEO },
  { kind: "softwares", table: "video_softwares", columns: getTableColumns(videoSoftwares), lookup: "video_id", sort1: "software_id", sort2: null, cap: MAX_LEGACY_VIDEO_SOFTWARES_PER_VIDEO },
  { kind: "metadata", table: "video_youtube_metadata", columns: getTableColumns(videoYoutubeMetadata), lookup: "video_id", sort1: "video_id", sort2: null, cap: 1 },
  { kind: "answers", table: "video_custom_answers", columns: getTableColumns(videoCustomAnswers), lookup: "video_id", sort1: "event_id", sort2: "question_id", cap: MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO },
] as const;

/**
 * U02am: read-only provenance check for an existing imported video.
 * Retain raw SQL JSON as the future same-batch full-row CAS input, but hash
 * CURRENT's managed projection and ordered related-row JSON objects. All
 * identifiers below are static schema metadata. No caller-controlled SQL.
 */
export async function readLegacyVideoReplacementSnapshot(db: ServerCoreDb, videoId: string) {
  const targetId = entitySnapshotTargetId("video", videoId);
  const sets = VIDEO_REPLACEMENT_SNAPSHOT_SETS;
  // ORDER BY uses SQLite BINARY ordering, the same as CURRENT's support read.
  // Every table has its own cap+1 sentinel. The global byte cap also covers
  // the proof and unmanaged video columns used by the later CAS.
  const sources = sets.map((set) => sql`
    SELECT * FROM (
      SELECT ${set.kind} AS kind,
        ${canonicalRowJson(set.columns, set.table)} AS payload,
        ${sql.raw(set.sort1)} AS sort1,
        ${set.sort2 ? sql.raw(set.sort2) : sql`''`} AS sort2
      FROM ${sql.raw(set.table)}
      WHERE ${sql.raw(set.lookup)} = ${videoId}
      ORDER BY sort1, sort2
      LIMIT ${set.cap + 1}
    )
  `);
  const proofSource = sql`
    SELECT * FROM (
      SELECT 'proof' AS kind,
        json_object('id', id, 'target_id', target_id, 'context', context,
          'after_json', after_json, 'created_at', created_at) AS payload,
        id AS sort1, '' AS sort2
      FROM audit_logs
      WHERE table_name = ${ENTITY_SNAPSHOT_AUDIT_TABLE}
        AND target_id = ${targetId}
        AND context = ${ENTITY_SNAPSHOT_AUDIT_CONTEXT}
        AND created_at = (
          SELECT MAX(created_at) FROM audit_logs
          WHERE table_name = ${ENTITY_SNAPSHOT_AUDIT_TABLE}
            AND target_id = ${targetId}
            AND context = ${ENTITY_SNAPSHOT_AUDIT_CONTEXT}
        )
      ORDER BY id
      LIMIT 2
    )
  `;
  const readRows = await db.all(sql`
    WITH snapshot AS (
      ${sql.join([...sources, proofSource], sql` UNION ALL `)}
    )
    SELECT kind,
      CASE WHEN SUM(length(CAST(payload AS BLOB))) OVER () <= ${MAX_LEGACY_IMPORT_STEP_BYTES}
        THEN payload ELSE NULL END AS payload
    FROM snapshot
    ORDER BY kind, sort1, sort2
  `) as unknown as ReadRow[];

  const error = "旧形式インポートの作品置換snapshotを確認できません。";
  const proofRows = readRows.filter((row) => row.kind === "proof");
  const knownKinds = new Set<string>(["proof", ...sets.map((set) => set.kind)]);
  if (readRows.some((row) => !knownKinds.has(row.kind) || typeof row.payload !== "string") ||
      proofRows.length !== 1 ||
      sets.some((set) => readRows.filter((row) => row.kind === set.kind).length > set.cap)) {
    return fixedFailure(error);
  }
  // Reject inconsistent or oversized provider payloads as well as SQL overflow.
  if (new TextEncoder().encode(JSON.stringify(readRows)).byteLength > MAX_LEGACY_IMPORT_STEP_BYTES) {
    return fixedFailure(error);
  }
  const payloads = (kind: string) => readRows.filter((row) => row.kind === kind)
    .map((row) => row.payload as string);
  const records = (kind: string) => payloads(kind).map((payload) => parseJsonRecord(payload, error));
  const videoRows = records("video");
  if (videoRows.length !== 1 || videoRows[0].id !== videoId ||
      videoRows[0].submitted_by_user_id !== SYSTEM_USER_ID ||
      !Number.isSafeInteger(videoRows[0].created_at) ||
      (videoRows[0].visibility_status !== "private" && videoRows[0].visibility_status !== "public")) {
    return fixedFailure(error);
  }
  const video = videoRows[0];
  const beforeEvents = records("events");
  const beforeMembers = records("members");
  const beforeChapters = records("chapters");
  const beforeSoftwares = records("softwares");
  const beforeMetadata = records("metadata");
  const beforeAnswers = records("answers");
  const unique = (rows: Record<string, unknown>[], keys: string[]) =>
    rows.every((row) => row.video_id === videoId && keys.every((key) => typeof row[key] === "string")) &&
    new Set(rows.map((row) => JSON.stringify(keys.map((key) => row[key])))).size === rows.length;
  if (!unique(beforeEvents, ["event_id"]) || !unique(beforeMembers, ["id"]) ||
      !unique(beforeChapters, ["id"]) || !unique(beforeSoftwares, ["software_id"]) ||
      !unique(beforeMetadata, ["video_id"]) || !unique(beforeAnswers, ["event_id", "question_id"])) {
    return fixedFailure(error);
  }
  // This field order is exactly CURRENT managedVideoSnapshot.
  const managedKeys = [
    "id", "primary_event_id", "creator_x_user_id", "submitted_by_user_id",
    "collaboration_type", "part", "source_type", "creator_display_name",
    "creator_display_name_yomi", "creator_icon_url", "creator_youtube_channel_url",
    "creator_profile_text", "creator_other_social_links", "title", "music", "credit",
    "music_reference_url", "closing_comment", "youtube_video_id", "intro_comment",
    "highlights", "production_story", "visibility_status", "scheduling_type",
    "scheduled_time", "created_at",
  ];
  if (managedKeys.some((key) => !Object.prototype.hasOwnProperty.call(video, key))) {
    return fixedFailure(error);
  }
  const managed = Object.fromEntries(managedKeys.map((key) => [key, video[key]]));
  const audit = parseJsonRecord(proofRows[0].payload, error);
  if (typeof audit.id !== "string" || audit.target_id !== targetId ||
      audit.context !== ENTITY_SNAPSHOT_AUDIT_CONTEXT ||
      typeof audit.after_json !== "string" || !Number.isSafeInteger(audit.created_at)) {
    return fixedFailure(error);
  }
  const proof = parseJsonRecord(audit.after_json, error);
  const [managed_digest, events_digest, members_digest, chapters_digest,
    softwares_digest, metadata_digest, custom_answers_digest] = await Promise.all([
    managed, beforeEvents, beforeMembers, beforeChapters, beforeSoftwares, beforeMetadata, beforeAnswers,
  ].map(snapshotDigest));
  const expected = {
    entity_kind: "video", managed_digest, events_digest, members_digest, chapters_digest,
    softwares_digest, metadata_digest, custom_answers_digest,
  };
  if (Object.entries(expected).some(([key, value]) => proof[key] !== value)) {
    return fixedFailure("旧形式インポートの作品の最新状態が監査snapshotと一致しません。");
  }
  return {
    video, beforeEvents, beforeMembers, beforeChapters, beforeSoftwares, beforeMetadata, beforeAnswers,
    audit, proof: expected,
    // Preserve unmodified payloads for a later transaction-time CAS.
    raw: Object.fromEntries([...sets.map((set) => set.kind), "proof"].map((kind) => [kind, payloads(kind)])),
  };
}

/**
 * U02an: construct an unexecuted transaction-time CAS assertion for a proven
 * existing video. The read-only provenance helper supplies the raw SQL JSON;
 * callers must put this assertion before all replacement writes in the SAME
 * D1 batch. In particular an entity digest does not cover unmanaged fields,
 * so comparing just the seven digests cannot substitute for this assertion.
 * This helper does not authorize a replacement, mutate any rows, or send wakes.
 */
export function buildLegacyVideoReplacementAssertion(
  db: ServerCoreDb,
  snapshot: Awaited<ReturnType<typeof readLegacyVideoReplacementSnapshot>>,
) {
  const videoId = snapshot.video.id;
  const targetId = typeof videoId === "string" ? entitySnapshotTargetId("video", videoId) : null;
  const error = "旧形式インポートの作品置換snapshotを確認できません。";
  if (!targetId || snapshot.audit.target_id !== targetId ||
      snapshot.audit.context !== ENTITY_SNAPSHOT_AUDIT_CONTEXT ||
      typeof snapshot.audit.id !== "string" ||
      typeof snapshot.audit.after_json !== "string" ||
      !Number.isSafeInteger(snapshot.audit.created_at) ||
      !Array.isArray(snapshot.raw.video) || snapshot.raw.video.length !== 1 ||
      !Array.isArray(snapshot.raw.proof) || snapshot.raw.proof.length !== 1) {
    return fixedFailure(error);
  }
  const clauses = VIDEO_REPLACEMENT_SNAPSHOT_SETS.map((set) => {
    const raw = snapshot.raw[set.kind];
    if (!Array.isArray(raw) || raw.length > set.cap ||
        raw.some((row) => typeof row !== "string") ||
        new Set(raw).size !== raw.length) {
      return fixedFailure(error);
    }
    const payload = JSON.stringify(raw);
    if (new TextEncoder().encode(payload).byteLength > MAX_LEGACY_IMPORT_STEP_BYTES) {
      return fixedFailure(error);
    }
    // Compare the exact same SQL JSON text as the original read, including
    // all unmanaged columns. Count equality catches insertions/deletions;
    // the anti-join catches changed rows. Static schema identifiers only.
    const table = sql.raw(set.table);
    const lookup = sql.raw(set.lookup);
    const currentJson = canonicalRowJson(set.columns, set.table);
    return sql`
      (SELECT COUNT(*) FROM ${table} WHERE ${lookup} = ${videoId})
        = json_array_length(${payload})
      AND NOT EXISTS (
        SELECT 1 FROM json_each(${payload}) AS expected
        WHERE NOT EXISTS (
          SELECT 1 FROM ${table} WHERE ${lookup} = ${videoId}
            AND ${currentJson} = expected.value
        )
      )
    `;
  });
  return db.run(sql`
    SELECT CASE WHEN
      ${sql.join(clauses, sql` AND `)}
      AND EXISTS (
        SELECT 1 FROM audit_logs AS proof
        WHERE proof.id = ${snapshot.audit.id}
          AND proof.table_name = ${ENTITY_SNAPSHOT_AUDIT_TABLE}
          AND proof.target_id = ${targetId}
          AND proof.context = ${ENTITY_SNAPSHOT_AUDIT_CONTEXT}
          AND proof.after_json IS ${snapshot.audit.after_json}
          AND proof.created_at = ${snapshot.audit.created_at as number}
          AND NOT EXISTS (
            SELECT 1 FROM audit_logs AS competing
            WHERE competing.table_name = proof.table_name
              AND competing.target_id = proof.target_id
              AND competing.context = proof.context
              AND (competing.created_at > proof.created_at OR
                (competing.created_at = proof.created_at AND competing.id <> proof.id))
          )
      )
    THEN 1 ELSE json_extract('legacy_import_video_replacement_snapshot_mismatch', '$') END
  `);
}

const CUSTOM_ANSWER_AUDIT_CONTEXT = "legacy_import:custom-answer";
type ExistingVideoAnswer = typeof videoCustomAnswers.$inferSelect;
type AnswerReplacementProof = {
  id: string;
  target_id: string;
  context: typeof CUSTOM_ANSWER_AUDIT_CONTEXT;
  after_json: string;
  created_at: number;
};
const ANSWER_SNAPSHOT_KEYS = [
  "video_id", "event_id", "question_id", "answer_text", "answer_json", "created_at", "updated_at",
] as const;

function answerAuditTarget(row: Pick<ExistingVideoAnswer, "video_id" | "event_id" | "question_id">): string {
  return [row.video_id, row.event_id, row.question_id].map(encodeURIComponent).join(":");
}

function parseExistingVideoAnswer(row: Record<string, unknown>, videoId: string): ExistingVideoAnswer {
  if (row.video_id !== videoId || typeof row.event_id !== "string" ||
      typeof row.question_id !== "string" ||
      (row.answer_text !== null && typeof row.answer_text !== "string") ||
      (row.answer_json !== null && typeof row.answer_json !== "string") ||
      !Number.isSafeInteger(row.created_at) || !Number.isSafeInteger(row.updated_at)) {
    return fixedFailure("旧形式インポートのカスタム質問回答snapshotが不正です。");
  }
  // Explicit CURRENT field order for the video entity's answer digest.
  return {
    video_id: videoId, event_id: row.event_id, question_id: row.question_id,
    answer_text: row.answer_text as string | null, answer_json: row.answer_json as string | null,
    created_at: row.created_at as number, updated_at: row.updated_at as number,
  };
}

/**
 * U02ao: prepare answer changes only, without executing any writes.
 * CURRENT retains omitted/identical answers and their timestamps. Only
 * a changed existing answer needs a separate, unique latest import audit.
 * The caller must use the full video CAS and the proof assertion in the
 * same audited D1 batch before applying any returned writes.
 */
export async function prepareLegacyVideoReplacementAnswers(input: {
  db: ServerCoreDb;
  snapshot: Awaited<ReturnType<typeof readLegacyVideoReplacementSnapshot>>;
  projection: Awaited<ReturnType<typeof projectLegacyVideoCreate>>;
  now: number;
}) {
  const { db, snapshot, projection, now } = input;
  const videoId = projection.managed.id;
  const error = "旧形式インポートのカスタム質問回答の置換snapshotを確認できません。";
  if (snapshot.video.id !== videoId || !Number.isSafeInteger(now) || now < 0 ||
      snapshot.beforeAnswers.length > MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO ||
      projection.nextAnswers.length > MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO) {
    return fixedFailure(error);
  }
  const before = snapshot.beforeAnswers.map((row) => parseExistingVideoAnswer(row, videoId));
  const incoming = projection.nextAnswers.map((row) => parseExistingVideoAnswer(row, videoId));
  const beforeByTarget = new Map(before.map((row) => [answerAuditTarget(row), row]));
  if (beforeByTarget.size !== before.length ||
      new Set(incoming.map(answerAuditTarget)).size !== incoming.length) {
    return fixedFailure(error);
  }
  const post = new Map(beforeByTarget);
  const replaced: Array<{ before: ExistingVideoAnswer; after: ExistingVideoAnswer }> = [];
  const created: ExistingVideoAnswer[] = [];
  for (const row of incoming) {
    const target = answerAuditTarget(row);
    const current = beforeByTarget.get(target);
    if (current && current.answer_text === row.answer_text && current.answer_json === row.answer_json) {
      continue;
    }
    const after = { ...row, created_at: current?.created_at ?? now, updated_at: now };
    if (current) replaced.push({ before: current, after });
    else created.push(after);
    post.set(target, after);
  }
  const allowedEvents = new Set(projection.nextEvents.map((row) => row.event_id));
  const nextAnswers = [...post.values()].sort((left, right) =>
    left.event_id.localeCompare(right.event_id) || left.question_id.localeCompare(right.question_id));
  if (nextAnswers.length > MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO ||
      nextAnswers.some((row) => !allowedEvents.has(row.event_id)) ||
      new TextEncoder().encode(JSON.stringify({ before, nextAnswers })).byteLength > MAX_LEGACY_IMPORT_STEP_BYTES) {
    return fixedFailure(error);
  }
  const proofs: AnswerReplacementProof[] = [];
  if (replaced.length > 0) {
    const expected = new Map(replaced.map(({ before: row }) => [answerAuditTarget(row), row]));
    const targets = JSON.stringify([...expected.keys()]);
    // Latest means latest across ALL audit contexts, not only import.
    // A later manual audit or a tie must refuse replacement.
    const rows = await db.all(sql`
      WITH latest_rows AS (
        SELECT json_object('id', a.id, 'target_id', a.target_id,
          'context', a.context, 'after_json', a.after_json, 'created_at', a.created_at) AS payload
        FROM audit_logs AS a
        WHERE a.table_name = 'video_custom_answers'
          AND a.target_id IN (SELECT value FROM json_each(${targets}))
          AND a.created_at = (
            SELECT MAX(b.created_at) FROM audit_logs AS b
            WHERE b.table_name = a.table_name AND b.target_id = a.target_id
          )
        ORDER BY a.target_id, a.id
        LIMIT ${replaced.length * 2 + 1}
      )
      SELECT 'answer_proof' AS kind,
        CASE WHEN SUM(length(CAST(payload AS BLOB))) OVER () <= ${MAX_LEGACY_IMPORT_STEP_BYTES}
          THEN payload ELSE NULL END AS payload
      FROM latest_rows
    `) as unknown as ReadRow[];
    if (rows.length !== expected.size || rows.some((row) => row.kind !== "answer_proof" || typeof row.payload !== "string") ||
        new TextEncoder().encode(JSON.stringify(rows)).byteLength > MAX_LEGACY_IMPORT_STEP_BYTES) {
      return fixedFailure(error);
    }
    const seen = new Set<string>();
    for (const row of rows) {
      const proof = parseJsonRecord(row.payload, error);
      if (typeof proof.target_id !== "string" || seen.has(proof.target_id) ||
          typeof proof.id !== "string" || proof.context !== CUSTOM_ANSWER_AUDIT_CONTEXT ||
          typeof proof.after_json !== "string" || !Number.isSafeInteger(proof.created_at)) {
        return fixedFailure(error);
      }
      const current = expected.get(proof.target_id);
      const after = parseJsonRecord(proof.after_json, error);
      if (!current || ANSWER_SNAPSHOT_KEYS.some((key) => after[key] !== current[key])) {
        return fixedFailure(error);
      }
      seen.add(proof.target_id);
      proofs.push({
        id: proof.id, target_id: proof.target_id, context: CUSTOM_ANSWER_AUDIT_CONTEXT,
        after_json: proof.after_json, created_at: proof.created_at as number,
      });
    }
  }
  return { replaced, created, nextAnswers, proofs, custom_answers_digest: await snapshotDigest(nextAnswers) };
}

/** Construct an unexecuted assertion that the separate answer proofs still own the latest state. */
export function buildLegacyAnswerReplacementAssertion(
  db: ServerCoreDb,
  prepared: Awaited<ReturnType<typeof prepareLegacyVideoReplacementAnswers>>,
) {
  const error = "旧形式インポートのカスタム質問回答の置換snapshotを確認できません。";
  const targets = new Set(prepared.replaced.map(({ before }) => answerAuditTarget(before)));
  if (prepared.proofs.length !== targets.size || targets.size !== prepared.replaced.length ||
      prepared.proofs.length > MAX_LEGACY_CUSTOM_ANSWERS_PER_VIDEO ||
      new Set(prepared.proofs.map((row) => row.target_id)).size !== targets.size ||
      prepared.proofs.some((row) => !targets.has(row.target_id) || row.context !== CUSTOM_ANSWER_AUDIT_CONTEXT ||
        typeof row.id !== "string" || typeof row.after_json !== "string" || !Number.isSafeInteger(row.created_at))) {
    return fixedFailure(error);
  }
  const payload = JSON.stringify(prepared.proofs);
  if (new TextEncoder().encode(payload).byteLength > MAX_LEGACY_IMPORT_STEP_BYTES) {
    return fixedFailure(error);
  }
  return db.run(sql`
    SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM json_each(${payload}) AS expected
      WHERE NOT EXISTS (
        SELECT 1 FROM audit_logs AS proof
        WHERE proof.table_name = 'video_custom_answers'
          AND proof.id = json_extract(expected.value, '$.id')
          AND proof.target_id = json_extract(expected.value, '$.target_id')
          AND proof.context = ${CUSTOM_ANSWER_AUDIT_CONTEXT}
          AND proof.after_json IS json_extract(expected.value, '$.after_json')
          AND proof.created_at = json_extract(expected.value, '$.created_at')
          AND NOT EXISTS (
            SELECT 1 FROM audit_logs AS competing
            WHERE competing.table_name = proof.table_name
              AND competing.target_id = proof.target_id
              AND (competing.created_at > proof.created_at OR
                (competing.created_at = proof.created_at AND competing.id <> proof.id))
          )
      )
    ) THEN 1 ELSE json_extract('legacy_import_answer_proof_mismatch', '$') END
  `);
}

/** New creation, private-to-private proven replacement, and marker-only skip/empty. */
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
    if (!video || outcome.kind !== "video") {
      return fixedFailure("旧形式インポートの作品進捗が不正です。");
    }
    const shouldSkip = input.strategy === "skip_existing" &&
      input.progress.skipExistingVideoIds.includes(video.id);
    if ((shouldSkip && outcome.action !== "skipped") ||
        (!shouldSkip && outcome.action !== "created" &&
          !(outcome.action === "replaced" && input.strategy === "replace_imported" &&
            video.visibility_status === "private"))) {
      return fixedFailure("旧形式インポートの作品進捗が不正です。");
    }
    next.counts[`${outcome.action}Videos`] += 1;
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
  } else if (outcomeRecord.kind === "video" &&
    (outcomeRecord.action === "skipped" || outcomeRecord.action === "created" || outcomeRecord.action === "replaced")) {
    outcome = { kind: "video", action: outcomeRecord.action };
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
 * Empty/preview-confirmed skipped and new-video creation steps are supported.
 * Only proven private-to-private video replacement is enabled. Public video replacement
 * and visibility-changing replacements remain fail closed.
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

  // Resolve the support request without issuing a second D1 read for a video.
  // A malformed support plan must not prevent recovery of an already-committed
  // step. Bind an empty array on invalid input and reject it only on the
  // fresh-write branch, after receipt validation.
  const expectedExistingForSkip = !!plannedVideo && input.strategy === "skip_existing" &&
    input.progress.skipExistingVideoIds.includes(plannedVideo.id);
  const allowExistingVideoReplacement = readReplacement && plannedVideo?.visibility_status === "private";
  const videoSoftwareNames = plannedVideo && !expectedExistingForSkip
    ? [...new Set(input.plan.videoSoftwares.filter((row) => row.video_id === plannedVideo.id)
      .map((row) => normalizeSoftwareName(row.label)))]
    : [];
  const videoNamesPayload = JSON.stringify(videoSoftwareNames);
  const videoSupportInputValid = videoSoftwareNames.length <= MAX_LEGACY_VIDEO_SOFTWARES_PER_VIDEO &&
    new TextEncoder().encode(videoNamesPayload).byteLength <= MAX_LEGACY_IMPORT_STEP_BYTES;

  // One bounded D1 read: receipt plus the stage-specific existing-state
  // snapshot. Video support rows are only selected for a fresh candidate write.
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
          ), eligible_support AS (
            SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM marker_rows)
              AND ${!expectedExistingForSkip && videoSupportInputValid ? 1 : 0} = 1
              AND (NOT EXISTS (SELECT 1 FROM video_rows) OR ${allowExistingVideoReplacement ? 1 : 0} = 1)
          ), video_support AS (
            SELECT 'creator' AS kind,
              json_object('id', id, 'profile_text', profile_text,
                'other_social_links', other_social_links) AS payload
              FROM x_users WHERE id = ${plannedVideo.creator_x_user_id}
                AND EXISTS (SELECT 1 FROM eligible_support)
            UNION ALL
            SELECT 'software' AS kind,
              json_object('id', id, 'normalized_name', normalized_name) AS payload
              FROM software_catalog
              WHERE normalized_name IN (
                SELECT value FROM json_each(${videoSupportInputValid ? videoNamesPayload : "[]"})
              ) AND EXISTS (SELECT 1 FROM eligible_support)
            LIMIT ${MAX_LEGACY_VIDEO_SOFTWARES_PER_VIDEO + 2}
          )
          SELECT 'marker' AS kind, payload FROM marker_rows
          UNION ALL
          SELECT 'video' AS kind, payload FROM video_rows
          UNION ALL
          SELECT kind,
            CASE WHEN SUM(length(CAST(payload AS BLOB))) OVER () <= ${MAX_LEGACY_IMPORT_STEP_BYTES}
              THEN payload ELSE NULL END AS payload
            FROM video_support
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
  const creatorRows = readRows.filter((row) => row.kind === "creator");
  const catalogRows = readRows.filter((row) => row.kind === "software");
  const videoSupportCount = creatorRows.length + catalogRows.length;
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
      eventRows.length + videoRows.length + videoSupportCount +
      eventStaffSnapshotRows.length + replacementRowCount !== readRows.length
  ) {
    return fixedFailure("旧形式インポートのステップ監査を確認できません。");
  }
  if (
    markerRows.length > 1 ||
    principalRows.length > 1 ||
    existingRows.length > maxExistingRows ||
    eventRows.length > 1 ||
    videoRows.length > 1 ||
    creatorRows.length > 1 ||
    catalogRows.length > MAX_LEGACY_VIDEO_SOFTWARES_PER_VIDEO ||
    (videoSupportCount > 0 && (
      stage !== "videos" || !plannedVideo || markerRows.length !== 0 ||
      expectedExistingForSkip || !videoSupportInputValid ||
      (videoRows.length > 0 && !allowExistingVideoReplacement)
    )) ||
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
    if (plannedVideo) {
      if (input.strategy === "skip_existing" && expectedExistingForSkip !== (videoRows.length === 1)) {
        return fixedFailure("作品の存在状態がプレビュー時点から変更されたため、再プレビューが必要です。");
      }
      if (!expectedExistingForSkip) {
        const video = plannedVideo;
        let replacement: Awaited<ReturnType<typeof readLegacyVideoReplacementSnapshot>> | null = null;
        if (videoRows.length !== 0) {
          if (input.strategy !== "replace_imported" || video.visibility_status !== "private") {
            return fixedFailure("既存作品の置換条件を満たしていません。");
          }
          replacement = await readLegacyVideoReplacementSnapshot(input.db, video.id);
          if (replacement.video.visibility_status !== "private") {
            return fixedFailure("公開状態を変更する作品置換はHono側でまだ利用できません。");
          }
        }
        // The creator/catalog snapshot came from the same query as the
        // receipt and video ID. All consumed fields are still rechecked by
        // stateAssertion in the atomic D1 batch.
        const softwareNames = videoSoftwareNames;
        if (!videoSupportInputValid ||
            creatorRows.length !== (video.creator_x_user_id ? 1 : 0) ||
            catalogRows.length !== softwareNames.length) {
          return fixedFailure("旧形式インポートの作成者または使用ソフトsnapshotが不正です。");
        }
        const creatorSnapshot = creatorRows.length
          ? parseJsonRecord(creatorRows[0].payload, "旧形式インポートの作成者snapshotが不正です。")
          : null;
        if (creatorSnapshot && (
          creatorSnapshot.id !== video.creator_x_user_id ||
          (creatorSnapshot.profile_text !== null && typeof creatorSnapshot.profile_text !== "string") ||
          (creatorSnapshot.other_social_links !== null && typeof creatorSnapshot.other_social_links !== "string")
        )) {
          return fixedFailure("旧形式インポートの作成者snapshotが不正です。");
        }
        const creator = creatorSnapshot ? {
          profile_text: creatorSnapshot.profile_text as string | null,
          other_social_links: creatorSnapshot.other_social_links as string | null,
        } : null;
        const catalog = catalogRows.map((row) =>
          parseJsonRecord(row.payload, "旧形式インポートの使用ソフトsnapshotが不正です。"));
        const softwareIds = new Map<string, string>();
        for (const row of catalog) {
          if (typeof row.id !== "string" || typeof row.normalized_name !== "string" ||
              !softwareNames.includes(row.normalized_name) || softwareIds.has(row.normalized_name)) {
            return fixedFailure("旧形式インポートの使用ソフトsnapshotが不正です。");
          }
          softwareIds.set(row.normalized_name, row.id);
        }
        const now = Math.floor(Date.now() / 1000);
        const projection = await projectLegacyVideoCreate({
          plan: input.plan, videoId: video.id, creator, softwareIds, now,
        });
        const {
          nextEvents, nextMembers, nextChapters, nextSoftwares, nextMetadata,
          plannedQuestions, rebuildTargets, youtubeWakeRequired,
        } = projection;
        const answerChanges = replacement
          ? await prepareLegacyVideoReplacementAnswers({ db: input.db, snapshot: replacement, projection, now })
          : null;
        const managed = replacement
          ? { ...projection.managed, created_at: replacement.video.created_at as number }
          : projection.managed;
        const nextAnswers = answerChanges?.nextAnswers ?? projection.nextAnswers;
        const answersToInsert = answerChanges
          ? [...answerChanges.replaced.map(({ after }) => after), ...answerChanges.created]
          : nextAnswers;
        const snapshotProof = replacement ? {
          ...projection.snapshotProof,
          managed_digest: await snapshotDigest(managed),
          custom_answers_digest: answerChanges!.custom_answers_digest,
        } : projection.snapshotProof;
        if (new TextEncoder().encode(JSON.stringify({
          managed, nextEvents, nextMembers, nextChapters, nextSoftwares, nextMetadata,
          nextAnswers, plannedQuestions, rebuildTargets,
        })).byteLength > MAX_LEGACY_IMPORT_STEP_BYTES) {
          return fixedFailure("旧形式インポートの作品書込snapshotが上限超過です。");
        }
        const eventIds = [...new Set(
          [video.primary_event_id, ...nextEvents.map((row) => row.event_id)]
            .filter((id): id is string => !!id),
        )];
        const xUserIds = [...new Set(
          [video.creator_x_user_id, ...nextMembers.map((row) => row.x_user_id),
            ...nextChapters.map((row) => row.x_user_id)]
            .filter((id): id is string => !!id),
        )];
        const relationPayload = JSON.stringify(eventIds);
        const xUserPayload = JSON.stringify(xUserIds);
        const catalogPayload = JSON.stringify(catalog);
        const questionSnapshotPayload = JSON.stringify(plannedQuestions);
        // Refuse orphan support rows rather than deleting data for an absent video.
        // Assert every consumed relation/definition/fallback again in the same
        // atomic batch; no stale snapshot can authorize insertion or a receipt.
        const absenceCondition = replacement ? sql`1 = 1` : sql`
            NOT EXISTS (SELECT 1 FROM videos WHERE id = ${video.id})
            AND NOT EXISTS (SELECT 1 FROM video_events WHERE video_id = ${video.id})
            AND NOT EXISTS (SELECT 1 FROM video_members WHERE video_id = ${video.id})
            AND NOT EXISTS (SELECT 1 FROM video_chapters WHERE video_id = ${video.id})
            AND NOT EXISTS (SELECT 1 FROM video_softwares WHERE video_id = ${video.id})
            AND NOT EXISTS (SELECT 1 FROM video_youtube_metadata WHERE video_id = ${video.id})
            AND NOT EXISTS (SELECT 1 FROM video_custom_answers WHERE video_id = ${video.id})
        `;
        const stateAssertion = input.db.run(sql`
          SELECT CASE WHEN
            (${absenceCondition})
            AND EXISTS (SELECT 1 FROM "user"
              WHERE id = ${SYSTEM_USER_ID} AND name = 'Legacy import system'
                AND email IS NULL AND "emailVerified" IS NULL AND image IS NULL
                AND discord_id IS NULL AND role = 'user' AND can_create_events = 0
                AND is_notification_enabled = 0 AND is_tos_accepted = 0
                AND accepted_terms_version_id IS NULL AND terms_reaccept_required = 0
                AND is_banned = 0 AND active_x_user_id IS NULL
                AND onboarding_completed_at IS NULL AND last_guild_check IS NULL)
            AND (${video.youtube_video_id} IS NULL OR ${video.youtube_video_id} = ''
              OR NOT EXISTS (SELECT 1 FROM videos
                WHERE youtube_video_id = ${video.youtube_video_id}
                  AND id <> ${video.id}
                  AND visibility_status NOT IN ('archived', 'voided')))
            AND NOT EXISTS (
              SELECT 1 FROM json_each(${relationPayload}) AS incoming
                WHERE NOT EXISTS (SELECT 1 FROM events WHERE id = incoming.value)
            )
            AND NOT EXISTS (
              SELECT 1 FROM json_each(${xUserPayload}) AS incoming
                WHERE NOT EXISTS (SELECT 1 FROM x_users WHERE id = incoming.value)
            )
            AND (${video.creator_x_user_id} IS NULL OR EXISTS (
              SELECT 1 FROM x_users WHERE id = ${video.creator_x_user_id}
                AND profile_text IS ${creator?.profile_text ?? null}
                AND other_social_links IS ${creator?.other_social_links ?? null}
            ))
            AND NOT EXISTS (
              SELECT 1 FROM json_each(${catalogPayload}) AS incoming
                WHERE NOT EXISTS (SELECT 1 FROM software_catalog
                  WHERE id = json_extract(incoming.value, '$.id')
                    AND normalized_name = json_extract(incoming.value, '$.normalized_name'))
            )
            AND NOT EXISTS (
              SELECT 1 FROM json_each(${questionSnapshotPayload}) AS incoming
                WHERE NOT EXISTS (SELECT 1 FROM event_custom_questions AS q
                  WHERE q.id = json_extract(incoming.value, '$.id')
                    AND q.event_id = json_extract(incoming.value, '$.event_id')
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
                    AND q.visibility = json_extract(incoming.value, '$.visibility'))
            )
          THEN 1 ELSE json_extract('legacy_import_video_create_snapshot_mismatch', '$') END
        `);
        // JSON1 batching keeps the full related-row set within D1's bind cap.
        // Table/column names below are static constants, never preview data.
        const inserts = [
          { table: "videos", columns: [
            "id", "primary_event_id", "creator_x_user_id", "submitted_by_user_id",
            "collaboration_type", "part", "source_type", "creator_display_name",
            "creator_display_name_yomi", "creator_icon_url", "creator_youtube_channel_url",
            "creator_profile_text", "creator_other_social_links", "title", "music", "credit",
            "music_reference_url", "closing_comment", "youtube_video_id", "intro_comment",
            "highlights", "production_story", "visibility_status", "scheduling_type",
            "scheduled_time", "created_at", "app_like_count", "score", "score_updated_at", "updated_at",
          ], rows: [{ ...managed, app_like_count: 0, score: 0, score_updated_at: null, updated_at: now }] },
          { table: "video_events", columns: ["video_id", "event_id"], rows: nextEvents },
          { table: "video_members", columns: [
            "id", "video_id", "x_user_id", "name", "role", "comment", "order_index",
            "can_edit", "is_public_member", "edit_granted_by_auth_user_id", "edit_granted_at", "edit_updated_at",
          ], rows: nextMembers },
          { table: "video_chapters", columns: [
            "id", "video_id", "x_user_id", "chapter_time", "chapter_label", "note", "visibility", "created_at", "updated_at",
          ], rows: nextChapters },
          { table: "video_softwares", columns: ["video_id", "software_id", "raw_label"], rows: nextSoftwares },
          { table: "video_youtube_metadata", columns: [
            "video_id", "youtube_privacy_status", "youtube_availability_status", "duration_seconds",
            "view_count", "synced_at", "sync_status", "sync_error", "updated_at",
          ], rows: nextMetadata },
          { table: "video_custom_answers", columns: [
            "video_id", "event_id", "question_id", "answer_text", "answer_json", "created_at", "updated_at",
          ], rows: answersToInsert },
        ].filter((entry) => entry.rows.length > 0 && (!replacement || entry.table !== "videos"));
        const mutationPlan: Array<{ statement: ReturnType<ServerCoreDb["run"]>; count: number }> = [];
        if (replacement) {
          // The full-row CAS is evaluated before this UPDATE in the same batch.
          // created_at, app_like_count, score, score_updated_at and id are never updated.
          const updatePayload = JSON.stringify({ ...managed, updated_at: now });
          const managedColumns = Object.keys(managed)
            .filter((key) => key !== "id" && key !== "created_at").concat("updated_at");
          // managed was constructed from the explicit static projection above.
          // Bind JSON once in a scalar CTE. Keys originate only from the static managed projection.
          const updateAssignments = managedColumns.map((column) =>
            sql.raw(column + " = (SELECT json_extract(payload, '$." + column + "') FROM incoming)"));
          mutationPlan.push({
            statement: input.db.run(sql`
              WITH incoming AS (SELECT ${updatePayload} AS payload)
              UPDATE videos SET ${sql.join(updateAssignments, sql`, `)}
              WHERE videos.id = ${video.id}
            `),
            count: 1,
          });
          const relatedDeletes = [
            { table: "video_events", count: replacement.beforeEvents.length },
            { table: "video_members", count: replacement.beforeMembers.length },
            { table: "video_chapters", count: replacement.beforeChapters.length },
            { table: "video_softwares", count: replacement.beforeSoftwares.length },
            { table: "video_youtube_metadata", count: replacement.beforeMetadata.length },
          ];
          for (const entry of relatedDeletes) {
            if (entry.count > 0) mutationPlan.push({
              statement: input.db.run(sql`DELETE FROM ${sql.raw(entry.table)} WHERE video_id = ${video.id}`),
              count: entry.count,
            });
          }
          if (answerChanges && answerChanges.replaced.length > 0) {
            const changedKeys = JSON.stringify(answerChanges.replaced.map(({ before }) => ({
              event_id: before.event_id, question_id: before.question_id,
            })));
            mutationPlan.push({
              statement: input.db.run(sql`
                DELETE FROM video_custom_answers WHERE video_id = ${video.id}
                  AND (event_id, question_id) IN (
                    SELECT json_extract(value, '$.event_id'), json_extract(value, '$.question_id')
                    FROM json_each(${changedKeys})
                  )
              `),
              count: answerChanges.replaced.length,
            });
          }
        }
        for (const { table, columns, rows } of inserts) mutationPlan.push({
          statement: input.db.run(sql`
            INSERT INTO ${sql.raw(table)} (${sql.raw(columns.join(", "))})
            SELECT ${sql.raw(columns.map((column) => "json_extract(value, '$." + column + "')").join(", "))}
            FROM json_each(${JSON.stringify(rows)})
          `),
          count: rows.length,
        });
        // Preserve CURRENT's rebuild target set for this non-public slice.
        const queueRows = rebuildTargets.map((row, index) => ({
          id: legacyImportRebuildQueueId(identity.targetId, index), ...row,
        }));
        const queuePayload = JSON.stringify(queueRows);
        const queueMutation = input.db.run(sql`
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
        `);
        const outcome = { kind: "video", action: replacement ? "replaced" : "created" } as const;
        const nextProgress = nextVideoProgress(input, outcome);
        const answerTarget = answerAuditTarget;
        const sentKinds = new Set<QueueWakeKind>();
        await mutateWithAudit(input.db, {
          preMutationAssertions: [
            markerAbsenceAssertion, stateAssertion,
            ...(replacement ? [buildLegacyVideoReplacementAssertion(input.db, replacement)] : []),
            ...(answerChanges?.proofs.length ? [buildLegacyAnswerReplacementAssertion(input.db, answerChanges)] : []),
          ],
          mutationStatements: [...mutationPlan.map((entry) => entry.statement), queueMutation],
          expectedMutationChanges: [...mutationPlan.map((entry) => entry.count), queueRows.length],
          audits: [
            {
              table_name: "videos", target_id: video.id, operation: replacement ? "UPDATE" as const : "CREATE" as const,
              before: replacement?.video ?? null,
              after: {
                ...video, created_at: managed.created_at,
                event_ids: nextEvents.map((row) => row.event_id),
                member_ids: nextMembers.map((row) => row.id),
                chapter_ids: nextChapters.map((row) => row.id),
                software_ids: nextSoftwares.map((row) => row.software_id),
                custom_answer_ids: nextAnswers.map(answerTarget),
              },
              actor_user_id: input.actorAuthUserId,
              reason: "旧形式作品を新正本へ変換", context: "legacy_import",
              retention_class: "long_audit" as const, restore_strategy: replacement ? "none" as const : "delete_created" as const,
              strict: true,
            },
            {
              table_name: ENTITY_SNAPSHOT_AUDIT_TABLE,
              target_id: entitySnapshotTargetId("video", video.id),
              operation: "SYSTEM" as const, before: null, after: snapshotProof,
              actor_user_id: input.actorAuthUserId,
              reason: "旧形式作品の置換可能snapshotを確定", context: ENTITY_SNAPSHOT_AUDIT_CONTEXT,
              retention_class: "long_audit" as const, restore_strategy: "none" as const,
              strict: true,
            },
            ...(answerChanges?.replaced ?? []).map(({ before, after }) => ({
              table_name: "video_custom_answers", target_id: answerTarget(before),
              operation: "UPDATE" as const, before, after,
              actor_user_id: input.actorAuthUserId,
              reason: "旧形式動画のカスタム質問回答を置換", context: CUSTOM_ANSWER_AUDIT_CONTEXT,
              retention_class: "long_audit" as const, restore_strategy: "update_before" as const,
              strict: true,
            })),
            ...(answerChanges?.created ?? nextAnswers).map((row) => ({
              table_name: "video_custom_answers", target_id: answerTarget(row),
              operation: "CREATE" as const, before: null, after: row,
              actor_user_id: input.actorAuthUserId,
              reason: "旧形式動画のカスタム質問回答を作成", context: "legacy_import:custom-answer",
              retention_class: "long_audit" as const, restore_strategy: "delete_created" as const,
              strict: true,
            })),
            buildMarkerAudit(nextProgress, outcome),
          ],
          callerQueryCount: 3 + (replacement ? 1 : 0) + (answerChanges?.proofs.length ? 1 : 0),
          preloaded: input.preloaded,
          staticRebuildWakeSource: "import",
          wakeSentKinds: sentKinds,
        }, input.loadWakeHost);
        if (youtubeWakeRequired) {
          try {
            await sendYoutubeSyncPendingWakeBestEffort("import", sentKinds, await input.loadWakeHost());
          } catch {
            // The pending metadata is durable. A wake failure never makes a
            // committed D1 step look uncommitted or authorize a duplicate write.
          }
        }
        return { progress: nextProgress, complete: nextProgress.stage === "complete" };
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
