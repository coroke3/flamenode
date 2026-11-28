import { sql } from "drizzle-orm";
import {
  isValidPreloadedActorSnapshotJson,
  isValidPreloadedAuditSettings,
  type PreloadedAuditContext,
} from "../audit/logger.ts";
import { mutateWithAudit } from "../audit/mutate.ts";
import type { ServerCoreDb } from "../db.ts";
import type { CanonicalLegacyPlan, LegacyImportStrategy } from "./normalize.ts";
import type { LegacyImportApplyProgress } from "./previewStore.ts";
import {
  LEGACY_IMPORT_X_USER_STEP_SIZE,
  legacyImportReceiptMatchesProgress,
  legacyImportSkipSnapshotFingerprint,
} from "./progress.ts";

const SYSTEM_USER_ID = "system_legacy_import";
const STEP_AUDIT_TABLE = "legacy_import_steps";
const STEP_AUDIT_CONTEXT = "legacy_import:step";

type ApplyInput = {
  db: ServerCoreDb;
  preloaded: PreloadedAuditContext;
  plan: CanonicalLegacyPlan;
  strategy: LegacyImportStrategy;
  previewToken: string;
  planHash: string;
  actorAuthUserId: string;
  progress: LegacyImportApplyProgress;
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
  | { kind: "x_users"; created: number; createdAuthUsers: number };

function fixedFailure(message: string): never {
  throw new Error(message);
}

async function runDigest(previewToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(previewToken));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("").slice(0, 24);
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
 * First bounded real Hono D1 apply unit for RH-002.
 * This deliberately supports only CURRENT's system_user stage. Later stages
 * fail closed until their own parity units are ported.
 */
export async function legacyImportD1ApplyStep(
  input: ApplyInput,
): Promise<{ progress: LegacyImportApplyProgress; complete: boolean }> {
  if (input.plan.errors.length > 0) return fixedFailure(input.plan.errors.join("\n"));
  const stage = input.progress.stage;
  if (stage !== "system_user" && stage !== "x_users") {
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

  // One bounded D1 read per request: receipt plus either the reserved principal
  // or the current 40-row X-ID existence snapshot.
  const readRows = stage === "system_user"
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
    : await input.db.all(sql`
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
      `) as unknown as ReadRow[];

  const markerRows = readRows.filter((row) => row.kind === "marker");
  const principalRows = readRows.filter((row) => row.kind === "principal");
  const existingRows = readRows.filter((row) => row.kind === "existing");
  if (markerRows.length + principalRows.length + existingRows.length !== readRows.length) {
    return fixedFailure("旧形式インポートのステップ監査を確認できません。");
  }
  if (
    markerRows.length > 1 ||
    principalRows.length > 1 ||
    existingRows.length > plannedXUserRows.length ||
    (stage === "system_user" && existingRows.length !== 0) ||
    (stage === "x_users" && principalRows.length !== 0) ||
    (markerRows.length === 1 && (principalRows.length !== 0 || existingRows.length !== 0))
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
      : nextXUsersProgress(input.plan, input.progress, receipt.outcome);
    if (!legacyImportReceiptMatchesProgress(receipt, identity, expected)) {
      return fixedFailure("旧形式インポートのステップ監査と進捗が一致しません。");
    }
    return { progress: expected, complete: false };
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
  });
  return { progress: nextProgress, complete: false };
}
