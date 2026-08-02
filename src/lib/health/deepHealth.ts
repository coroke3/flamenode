import {
  REQUIRED_RUNTIME_TABLE_COUNT,
  REQUIRED_SCHEMA_VERSION,
  RUNTIME_CRITICAL_TABLES,
} from "./schemaContract.ts";
import { assertArtifactSloFresh } from "./artifactSlo.ts";
import { evaluateDeepHealthQueueConfiguration } from "./queueEmergency.ts";
import {
  normalizePublicVisibilityBlockedEntitiesManifest,
  PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY,
  resolvePublicVisibilityGuardMode,
  type PublicVisibilityGuardMode,
} from "../publicData/publicVisibilityManifestCore.ts";

export { REQUIRED_SCHEMA_VERSION } from "./schemaContract.ts";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const PROBE_KEY = "__flamenode_read_only_health_probe__";

type DeepHealthCheckStatus = "ok" | "degraded";

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
    get(key: string): Promise<{ text: () => Promise<string> } | null>;
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

async function assertPublicVisibilityManifestFresh(
  bucket: DeepHealthEnv["BUCKET"],
  nowSec: number,
): Promise<void> {
  const object = await bucket.get(PUBLIC_VISIBILITY_BLOCKED_ENTITIES_OBJECT_KEY);
  if (!object) {
    return;
  }
  let payload: unknown;
  try {
    payload = JSON.parse(await object.text());
  } catch {
    throw new Error("public visibility manifest malformed");
  }
  const normalized = normalizePublicVisibilityBlockedEntitiesManifest(payload);
  if (!normalized) {
    throw new Error("public visibility manifest malformed");
  }
  const generatedAt = Number(normalized.generated_at);
  if (!Number.isFinite(generatedAt) || generatedAt <= 0) {
    throw new Error("public visibility manifest: invalid generated_at");
  }
  if (generatedAt > nowSec + 60) {
    throw new Error("public visibility manifest: generated_at is in the future");
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
          WHERE type = 'table' AND name IN (${quotedTables})) AS required_table_count`,
    ).first<{ version?: string; required_table_count?: number }>(),
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
  await assertArtifactSloFresh(env.BUCKET, nowSec);
  const guardMode = resolvePublicVisibilityGuardMode(
    env.PUBLIC_VISIBILITY_GUARD_MODE,
  );
  await assertPublicVisibilityManifestFresh(env.BUCKET, nowSec);

  const checks: DeepHealthChecks = {
    d1: "ok",
    kv: "ok",
    r2: "ok",
    schema: "ok",
    queues: queueEvaluation.status,
    static_artifacts: "ok",
    public_visibility: "ok",
  };
  const degraded = queueEvaluation.status === "degraded";

  return {
    ok: !degraded,
    status: degraded ? "degraded" : "ok",
    service: "flamenode-web",
    commit: commit.toLowerCase(),
    checks,
    public_visibility_guard_mode: guardMode,
  };
}
