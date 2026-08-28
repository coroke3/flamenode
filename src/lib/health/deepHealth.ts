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
  type PublicVisibilityGuardMode,
} from "../publicData/publicVisibilityManifestCore.ts";

export { REQUIRED_SCHEMA_VERSION } from "./schemaContract.ts";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const PROBE_KEY = "__flamenode_read_only_health_probe__";

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
};

async function checkPublicVisibilityManifestHealth(
  bucket: DeepHealthEnv["BUCKET"],
  nowSec: number,
  guardMode: PublicVisibilityGuardMode,
): Promise<PublicVisibilityHealth> {
  if (guardMode === "off") {
    return { status: "ok", blocksOverallHealth: false };
  }

  const reportDegraded = (reason: string, error?: unknown) => {
    console.warn(
      JSON.stringify({
        service: "deep-health",
        check: "public_visibility",
        mode: guardMode,
        status: "degraded",
        reason,
        error: error instanceof Error ? error.message : undefined,
      }),
    );
    return {
      status: "degraded" as const,
      blocksOverallHealth: guardMode === "enforce",
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
    return { status: "ok", blocksOverallHealth: false };
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
  };
}
