import {
  REQUIRED_RUNTIME_TABLE_COUNT,
  REQUIRED_SCHEMA_VERSION,
  RUNTIME_CRITICAL_TABLES,
} from "./schemaContract.ts";
import {
  ARTIFACT_SLO_PROBES,
  assertArtifactSloFresh,
  assertTrackedDetailArtifactSloFresh,
  type TrackedDetailArtifactSloRow,
} from "./artifactSlo.ts";
import { evaluateDeepHealthQueueConfiguration } from "./queueEmergency.ts";
import { cancelR2BodyBestEffort } from "../r2Body.ts";
import {
  normalizePublicVisibilityBlockedEntitiesManifest,
  PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
  PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES,
  resolvePublicVisibilityGuardMode,
  type PublicVisibilityBlockedEntitiesManifest,
  type PublicVisibilityGuardMode,
} from "../publicData/publicVisibilityManifestCore.ts";

export { REQUIRED_SCHEMA_VERSION } from "./schemaContract.ts";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const PROBE_KEY = "__flamenode_read_only_health_probe__";
/** Avoid reporting the normal R2-precommit → D1-commit window as stuck. */
export const PUBLIC_VISIBILITY_STUCK_FENCE_GRACE_SECONDS = 5 * 60;
/** Keep the health JSON1 join bounded even if an invalid manifest grows large. */
export const PUBLIC_VISIBILITY_STUCK_FENCE_MAX_CANDIDATES = 200;

type DeepHealthCheckStatus = "ok" | "degraded";

type DeepHealthR2Object = {
  text: () => Promise<string>;
  size?: number;
  body?: unknown;
};

export interface DeepHealthEnv {
  DB: {
    prepare(query: string): {
      first<T = unknown>(): Promise<T | null>;
      bind?: (...params: unknown[]) => {
        first<T = unknown>(): Promise<T | null>;
      };
    };
  };
  KV: {
    get(key: string): Promise<unknown>;
  };
  BUCKET: {
    head(key: string): Promise<unknown>;
    get(key: string): Promise<DeepHealthR2Object | null>;
  };
  BUILD_COMMIT_SHA?: string;
  WORKER_ADMIN_TOKEN?: string;
  FLAMENODE_LOCAL_PREVIEW?: string;
  PUBLIC_VISIBILITY_GUARD_MODE?: string;
  QUEUE_DISPATCH_ENABLED?: string;
  QUEUE_CONTINUATION_ENABLED?: string;
  QUEUE_YOUTUBE_SYNC_ENABLED?: string;
  QUEUE_EMERGENCY_DISABLED?: string;
  QUEUE_EMERGENCY_REASON?: string;
  QUEUE_EMERGENCY_EXPIRES_AT?: string;
  NOTIFICATION_WAKE_QUEUE?: { send?: unknown };
  STATIC_REBUILD_WAKE_QUEUE?: { send?: unknown };
  YOUTUBE_SYNC_WAKE_QUEUE?: { send?: unknown };
}

export type DeepHealthChecks = {
  d1: DeepHealthCheckStatus;
  kv: DeepHealthCheckStatus;
  r2: DeepHealthCheckStatus;
  schema: DeepHealthCheckStatus;
  queues: DeepHealthCheckStatus;
  static_artifacts: DeepHealthCheckStatus;
  public_visibility: DeepHealthCheckStatus;
};

export type DeepHealthResult = {
  ok: boolean;
  status: "ok" | "degraded";
  service: "flamenode-web";
  commit: string;
  checks: DeepHealthChecks;
  public_visibility_guard_mode?: PublicVisibilityGuardMode;
  /** R2 entryがD1の同一token fenceを持たないままgraceを超えた件数。 */
  public_visibility_stuck_fence_candidates?: number;
};

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

export function authorizeDeepHealth(
  request: Request,
  configuredToken: string | undefined,
): Response | null {
  const token = configuredToken?.trim();
  if (!token) {
    return Response.json(
      { ok: false, service: "flamenode-web" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const match = /^Bearer ([^\s]+)$/.exec(
    request.headers.get("Authorization") ?? "",
  );
  if (!match || !constantTimeEqual(match[1], token)) {
    return Response.json(
      { ok: false, service: "flamenode-web" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return null;
}

type PublicVisibilityHealth = {
  status: DeepHealthCheckStatus;
  blocksOverallHealth: boolean;
  stuckFenceCandidateCount: number;
};

type VisibilityFenceMismatchRow = {
  count?: number | null;
};

/**
 * R2 is precommitted before D1 by design.  A manifest-only entry is therefore
 * expected briefly, but after the grace period it is evidence that a failed
 * compensation left public delivery permanently blocked.  Compare exact
 * entity/token pairs in one bounded, read-only JSON1 query.
 */
type StuckFenceCandidateResult = {
  count: number;
  scanLimitExceeded: boolean;
};

async function countStuckVisibilityFenceCandidates(
  db: DeepHealthEnv["DB"],
  manifest: PublicVisibilityBlockedEntitiesManifest,
  nowSec: number,
): Promise<StuckFenceCandidateResult> {
  const candidates = manifest.entities.filter(
    (entry) => nowSec - entry.blocked_at >= PUBLIC_VISIBILITY_STUCK_FENCE_GRACE_SECONDS,
  );
  if (candidates.length === 0) return { count: 0, scanLimitExceeded: false };
  if (candidates.length > PUBLIC_VISIBILITY_STUCK_FENCE_MAX_CANDIDATES) {
    return { count: candidates.length, scanLimitExceeded: true };
  }

  const statement = db.prepare(`
    WITH candidates AS (
      SELECT
        json_extract(value, '$.entity_type') AS entity_type,
        CASE json_extract(value, '$.entity_type')
          WHEN 'x_user' THEN lower(json_extract(value, '$.entity_id'))
          ELSE json_extract(value, '$.entity_id')
        END AS entity_id,
        json_extract(value, '$.fence_token') AS fence_token
      FROM json_each(?1)
    )
    SELECT COUNT(*) AS count
    FROM candidates AS candidate
    LEFT JOIN public_visibility_fences AS fence
      ON fence.entity_type = candidate.entity_type
     AND fence.entity_id = candidate.entity_id
     AND fence.fence_token = candidate.fence_token
     AND fence.state IN ('blocked', 'release_pending')
    WHERE fence.entity_type IS NULL
  `);
  // Production D1 provides bind(). Keep test doubles that only model the
  // schema probe backwards-compatible rather than turning a local test helper
  // limitation into a health failure.
  if (!statement.bind) return { count: 0, scanLimitExceeded: false };
  const row = await statement
    .bind(JSON.stringify(candidates))
    .first<VisibilityFenceMismatchRow>();
  return {
    count: Math.max(0, Number(row?.count ?? 0) || 0),
    scanLimitExceeded: false,
  };
}

async function checkPublicVisibilityManifestHealth(
  db: DeepHealthEnv["DB"],
  bucket: DeepHealthEnv["BUCKET"],
  nowSec: number,
  guardMode: PublicVisibilityGuardMode,
): Promise<PublicVisibilityHealth> {
  if (guardMode === "off") {
    return { status: "ok", blocksOverallHealth: false, stuckFenceCandidateCount: 0 };
  }

  const reportDegraded = (
    reason: string,
    error?: unknown,
    stuckFenceCandidateCount = 0,
  ) => {
    console.warn(
      JSON.stringify({
        service: "deep-health",
        check: "public_visibility",
        mode: guardMode,
        status: "degraded",
        reason,
        stuck_fence_candidate_count: stuckFenceCandidateCount || undefined,
        error: error instanceof Error ? error.message : undefined,
      }),
    );
    return {
      status: "degraded" as const,
      blocksOverallHealth: guardMode === "enforce",
      stuckFenceCandidateCount,
    };
  };

  try {
    const object = await bucket.get(PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY);
    if (!object) {
      return reportDegraded("manifest_missing");
    }
    if (
      typeof object.size === "number" &&
      (!Number.isSafeInteger(object.size) ||
        object.size < 0 ||
        object.size > PUBLIC_VISIBILITY_MANIFEST_MAX_BYTES)
    ) {
      await cancelR2BodyBestEffort(object);
      return reportDegraded("manifest_too_large");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(await object.text());
    } catch (error) {
      return reportDegraded("manifest_malformed", error);
    }
    const normalized = normalizePublicVisibilityBlockedEntitiesManifest(payload);
    if (!normalized) {
      return reportDegraded("manifest_malformed");
    }
    const generatedAt = Number(normalized.generated_at);
    if (!Number.isFinite(generatedAt) || generatedAt <= 0) {
      return reportDegraded("manifest_invalid_generated_at");
    }
    if (generatedAt > nowSec + 60) {
      return reportDegraded("manifest_generated_at_in_future");
    }
    const stuckFenceCandidates = await countStuckVisibilityFenceCandidates(
      db,
      normalized,
      nowSec,
    );
    if (stuckFenceCandidates.scanLimitExceeded) {
      return reportDegraded(
        "stuck_fence_candidate_scan_limit",
        undefined,
        stuckFenceCandidates.count,
      );
    }
    if (stuckFenceCandidates.count > 0) {
      return reportDegraded(
        "stuck_fence_candidate",
        undefined,
        stuckFenceCandidates.count,
      );
    }
    return { status: "ok", blocksOverallHealth: false, stuckFenceCandidateCount: 0 };
  } catch (error) {
    return reportDegraded("manifest_unavailable", error);
  }
}

export async function runDeepHealthChecks(
  env: DeepHealthEnv,
): Promise<DeepHealthResult> {
  const commit = env.BUILD_COMMIT_SHA?.trim() ?? "";
  if (!COMMIT_PATTERN.test(commit)) throw new Error("invalid deployment commit");

  const quotedTables = RUNTIME_CRITICAL_TABLES.map(
    (table) => `'${table}'`,
  ).join(",");

  const nowSec = Math.floor(Date.now() / 1000);
  const [schema] = await Promise.all([
    env.DB.prepare(
      `SELECT
         (SELECT version FROM flamenode_schema_meta WHERE id = 'current') AS version,
         (SELECT COUNT(*) FROM sqlite_master
          WHERE type = 'table' AND name IN (${quotedTables})) AS required_table_count,
         (SELECT COUNT(*) FROM videos
          WHERE visibility_status = 'public') AS public_video_detail_count,
         (SELECT COUNT(DISTINCT target_id) FROM static_artifacts
          WHERE target_type = 'video' AND deleted_at IS NULL) AS tracked_video_detail_count,
         (SELECT MIN(generated_at) FROM static_artifacts
          WHERE target_type = 'video' AND deleted_at IS NULL) AS oldest_video_detail_generated_at,
         (SELECT COUNT(*) FROM events
          WHERE visibility_status = 'public') AS public_event_detail_count,
         (SELECT COUNT(DISTINCT target_id) FROM static_artifacts
          WHERE target_type = 'event' AND deleted_at IS NULL) AS tracked_event_detail_count,
         (SELECT MIN(generated_at) FROM static_artifacts
          WHERE target_type = 'event' AND deleted_at IS NULL) AS oldest_event_detail_generated_at`,
    ).first<
      {
        version?: string;
        required_table_count?: number;
      } & TrackedDetailArtifactSloRow
    >(),
    env.KV.get(PROBE_KEY),
    env.BUCKET.head(PROBE_KEY),
  ]);
  if (schema?.version !== REQUIRED_SCHEMA_VERSION) {
    throw new Error("schema version mismatch");
  }
  if (Number(schema.required_table_count) !== REQUIRED_RUNTIME_TABLE_COUNT) {
    throw new Error("required runtime table mismatch");
  }

  const queueEvaluation = evaluateDeepHealthQueueConfiguration(env);
  const guardMode = resolvePublicVisibilityGuardMode(
    env.PUBLIC_VISIBILITY_GUARD_MODE,
  );
  // The visibility manifest has its own observe/enforce health semantics. Do
  // not let the generic artifact SLO turn a malformed/missing manifest into a
  // raw 500 before that status can be reported in the response.
  const artifactSloProbes = ARTIFACT_SLO_PROBES.filter(
    (probe) => probe.key !== PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
  );
  assertTrackedDetailArtifactSloFresh(schema, nowSec);
  await assertArtifactSloFresh(env.BUCKET, nowSec, artifactSloProbes);
  const visibilityHealth = await checkPublicVisibilityManifestHealth(
    env.DB,
    env.BUCKET,
    nowSec,
    guardMode,
  );

  const checks: DeepHealthChecks = {
    d1: "ok",
    kv: "ok",
    r2: "ok",
    schema: "ok",
    queues: queueEvaluation.status,
    static_artifacts: "ok",
    public_visibility: visibilityHealth.status,
  };
  const degraded =
    queueEvaluation.status === "degraded" || visibilityHealth.blocksOverallHealth;

  return {
    ok: !degraded,
    status: degraded ? "degraded" : "ok",
    service: "flamenode-web",
    commit: commit.toLowerCase(),
    checks,
    public_visibility_guard_mode: guardMode,
    ...(visibilityHealth.stuckFenceCandidateCount > 0
      ? {
          public_visibility_stuck_fence_candidates:
            visibilityHealth.stuckFenceCandidateCount,
        }
      : {}),
  };
}
