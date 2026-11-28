import { sql } from "drizzle-orm";
import {
  isValidPreloadedActorSnapshotJson,
  isValidPreloadedAuditSettings,
  type PreloadedAuditContext,
} from "@flamenode/server-core/audit/logger";
import { mutateWithAudit } from "@flamenode/server-core/audit/mutate";
import type { ServerCoreDb } from "@flamenode/server-core/db";
import type { CanonicalLegacyPlan, LegacyImportStrategy } from "@flamenode/server-core/legacyImport/normalize";
import type { LegacyImportApplyProgress } from "@flamenode/server-core/legacyImport/previewStore";
import {
  legacyImportReceiptMatchesProgress,
  legacyImportSkipSnapshotFingerprint,
} from "@flamenode/server-core/legacyImport/progress";

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
  const outcome = value.outcome;
  if (
    typeof value.run_digest !== "string" ||
    typeof value.plan_hash !== "string" ||
    typeof value.stage !== "string" ||
    !Number.isSafeInteger(value.index) ||
    !outcome || typeof outcome !== "object" || Array.isArray(outcome) ||
    (outcome as Record<string, unknown>).kind !== "system_user" ||
    typeof value.next_stage !== "string" ||
    !Number.isSafeInteger(value.next_index) ||
    !value.next_counts || typeof value.next_counts !== "object" ||
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
  if (input.progress.stage !== "system_user" || input.progress.index !== 0) {
    return fixedFailure("旧形式インポートのこの段階はHono側でまだ利用できません。");
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
    targetId: digest + ":" + input.planHash.slice(0, 24) + ":system_user:0",
    runDigest: digest,
    planHash: input.planHash,
    stage: "system_user",
    index: 0,
  };

  // One bounded D1 read: at most two receipts, or the reserved principal only
  // when no receipt exists. This combines both CURRENT reads into one query.
  const rows = await input.db.all(sql`
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
  `) as unknown as ReadRow[];

  const markerRows = rows.filter((row) => row.kind === "marker");
  const principalRows = rows.filter((row) => row.kind === "principal");
  if (markerRows.length + principalRows.length !== rows.length) {
    return fixedFailure("旧形式インポートのステップ監査を確認できません。");
  }
  if (markerRows.length > 1 || principalRows.length > 1) {
    return fixedFailure("旧形式インポートのステップ監査が重複しています。");
  }

  if (markerRows.length === 1) {
    const stored = parseJsonRecord(markerRows[0].payload, "旧形式インポートのステップ監査が破損しています。");
    const receipt = parseReceipt(stored);
    const expected = nextSystemUserProgress(
      input.progress,
      input.strategy === "skip_existing" ? input.progress.skipExistingEventIds : [],
      input.strategy === "skip_existing" ? input.progress.skipExistingVideoIds : [],
    );
    if (!legacyImportReceiptMatchesProgress(receipt, identity, expected)) {
      return fixedFailure("旧形式インポートのステップ監査と進捗が一致しません。");
    }
    return { progress: expected, complete: false };
  }

  let createPrincipal = true;
  if (principalRows.length === 1) {
    const principal = parseJsonRecord(principalRows[0].payload, "旧形式インポート専用principalを確認できません。");
    if (!validSystemPrincipal(principal)) {
      return fixedFailure("旧形式インポート専用principalの予約IDが別用途で使用されています。");
    }
    createPrincipal = false;
  }

  // On first execution CURRENT uses the validated R2 progress snapshot as-is.
  const nextProgress = nextSystemUserProgress(
    input.progress,
    input.progress.skipExistingEventIds,
    input.progress.skipExistingVideoIds,
  );
  const markerAfter = {
    run_digest: identity.runDigest,
    plan_hash: identity.planHash,
    stage: identity.stage,
    index: identity.index,
    outcome: { kind: "system_user" },
    next_stage: nextProgress.stage,
    next_index: nextProgress.index,
    next_counts: nextProgress.counts,
    skip_event_snapshot_fingerprint: legacyImportSkipSnapshotFingerprint(nextProgress.skipExistingEventIds),
    skip_video_snapshot_fingerprint: legacyImportSkipSnapshotFingerprint(nextProgress.skipExistingVideoIds),
  };
  const markerAudit = {
    table_name: STEP_AUDIT_TABLE,
    target_id: identity.targetId,
    operation: "SYSTEM" as const,
    before: null,
    after: markerAfter,
    actor_user_id: input.actorAuthUserId,
    reason: "旧形式インポート継続ステップを確定",
    context: STEP_AUDIT_CONTEXT,
    retention_class: "long_audit" as const,
    restore_strategy: "none" as const,
    strict: true,
  };
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
    preMutationAssertions: [
      input.db.run(sql`
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
      `),
    ],
    mutationStatements: [mutation],
    expectedMutationChanges: createPrincipal ? [1] : [null],
    audits,
    callerQueryCount: 3,
    preloaded: input.preloaded,
  });

  return { progress: nextProgress, complete: false };
}
