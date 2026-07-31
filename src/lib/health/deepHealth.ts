import {
  REQUIRED_RUNTIME_TABLE_COUNT,
  REQUIRED_SCHEMA_VERSION,
  RUNTIME_CRITICAL_TABLES,
} from "./schemaContract.ts";
import {
  assertDeepHealthQueueConfiguration,
  assertStaticArtifactsFresh,
} from "./deepHealthQueues.ts";

export { REQUIRED_SCHEMA_VERSION } from "./schemaContract.ts";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const PROBE_KEY = "__flamenode_read_only_health_probe__";

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
  QUEUE_DISPATCH_ENABLED?: string;
  QUEUE_CONTINUATION_ENABLED?: string;
  QUEUE_YOUTUBE_SYNC_ENABLED?: string;
  NOTIFICATION_WAKE_QUEUE?: { send?: unknown };
  STATIC_REBUILD_WAKE_QUEUE?: { send?: unknown };
  YOUTUBE_SYNC_WAKE_QUEUE?: { send?: unknown };
}

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

export async function runDeepHealthChecks(env: DeepHealthEnv): Promise<{
  ok: true;
  service: "flamenode-web";
  commit: string;
  checks: {
    d1: "ok";
    kv: "ok";
    r2: "ok";
    schema: "ok";
    queues: "ok";
    static_artifacts: "ok";
  };
}> {
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

  assertDeepHealthQueueConfiguration(env);
  await assertStaticArtifactsFresh(env.BUCKET, nowSec);

  return {
    ok: true,
    service: "flamenode-web",
    commit: commit.toLowerCase(),
    checks: {
      d1: "ok",
      kv: "ok",
      r2: "ok",
      schema: "ok",
      queues: "ok",
      static_artifacts: "ok",
    },
  };
}
