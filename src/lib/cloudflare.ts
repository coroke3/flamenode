import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDb, type DB } from "./db/client";
import { isTransientDbError } from "./db/transientDbErrorCore";

declare global {
  interface CloudflareEnv {
    DB: D1Database;
    BUCKET: R2Bucket;
    KV: KVNamespace;
    NOTIFICATION_WAKE_QUEUE?: Queue;
    STATIC_REBUILD_WAKE_QUEUE?: Queue;
    YOUTUBE_SYNC_WAKE_QUEUE?: Queue;
  }
}

/**
 * OpenNext の request context から D1 / R2 / KV を取り出す。
 * 本番requestでは3 bindingを必須とし、設定漏れを曖昧なnullへ変換しない。
 */
export interface FlameNodeEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  KV: KVNamespace;
  NOTIFICATION_WAKE_QUEUE?: Queue;
  STATIC_REBUILD_WAKE_QUEUE?: Queue;
  YOUTUBE_SYNC_WAKE_QUEUE?: Queue;
  // 認証関連 (Auth.js)
  AUTH_SECRET?: string;
  AUTH_DISCORD_ID?: string;
  AUTH_DISCORD_SECRET?: string;
  SPREADSHEET_IMPORT_PREVIEW_SECRET?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_BOT_TOKEN?: string;
  YOUTUBE_API_KEY?: string;
  YOUTUBE_DAILY_QUOTA_LIMIT?: string;
  BUILD_COMMIT_SHA?: string;
  WORKER_ADMIN_TOKEN?: string;
  AUTH_URL?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  FLAMENODE_LOCAL_PREVIEW?: string;
  FORCE_STATIC_ONLY?: string;
  PUBLIC_DEGRADED_D1_ENABLED?: string;
  QUEUE_DISPATCH_ENABLED?: string;
  QUEUE_CONTINUATION_ENABLED?: string;
  QUEUE_YOUTUBE_SYNC_ENABLED?: string;
}

type BindingName = "DB" | "BUCKET" | "KV" | "context";

export class CloudflareBindingsUnavailableError extends Error {
  readonly missing: readonly BindingName[];

  constructor(missing: readonly BindingName[], cause?: unknown) {
    super(`CLOUDFLARE_BINDINGS_UNAVAILABLE:${missing.join(",")}`, { cause });
    this.name = "CloudflareBindingsUnavailableError";
    this.missing = [...missing];
  }
}

const memoizedDbs = new WeakMap<D1Database, DB>();

function clearDatabaseMemo(binding: D1Database): void {
  memoizedDbs.delete(binding);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 読み取り専用処理向け。瞬断時だけ Drizzle instance を作り直して再試行する。
 * 書き込み処理を渡してはいけない。再実行により二重書き込みになるため。
 */
export async function withDatabaseRead<T>(
  fn: (db: DB) => Promise<T>,
): Promise<T | null> {
  const maxAttempts = 4;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const resolved = resolveDatabaseSync();
    if (!resolved) return null;
    try {
      return await fn(resolved.db);
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt >= maxAttempts - 1) {
        throw error;
      }
      clearDatabaseMemo(resolved.binding);
      await sleep(30 * 2 ** attempt);
    }
  }
  throw lastError;
}

/**
 * 書き込み処理向け。コールバックを再実行しない。
 * retry が必要な処理は、呼び出し側で idempotency key / D1 batch / CAS 条件を持たせる。
 */
export async function withDatabaseWrite<T>(
  fn: (db: DB) => Promise<T>,
): Promise<T | null> {
  const resolved = resolveDatabaseSync();
  if (!resolved) return null;
  return fn(resolved.db);
}

/**
 * 後方互換。既存呼び出しはすべて読み取り用途として扱う。
 * 新規コードでは withDatabaseRead / withDatabaseWrite を明示する。
 */
export const withDatabase = withDatabaseRead;

export async function waitForLocalBindings(): Promise<void> {
  if (!isLocalOrBuildPhase()) return;
  const g = globalThis as Record<string | symbol, unknown>;
  const pending = g.__FLAMENODE_LOCAL_BINDINGS_PROMISE;
  if (pending && typeof (pending as PromiseLike<unknown>).then === "function") {
    await pending;
  }
}

function isD1Database(value: unknown): value is D1Database {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { prepare?: unknown }).prepare === "function" &&
    typeof (value as { batch?: unknown }).batch === "function"
  );
}

function isR2Bucket(value: unknown): value is R2Bucket {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { get?: unknown }).get === "function" &&
    typeof (value as { put?: unknown }).put === "function" &&
    typeof (value as { delete?: unknown }).delete === "function"
  );
}

function isKvNamespace(value: unknown): value is KVNamespace {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { get?: unknown }).get === "function" &&
    typeof (value as { put?: unknown }).put === "function" &&
    typeof (value as { delete?: unknown }).delete === "function"
  );
}

function isQueueBinding(value: unknown): value is Queue {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { send?: unknown }).send === "function"
  );
}

function isLocalOrBuildPhase(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PHASE === "phase-production-build"
  );
}

function recordValue(
  candidate: Record<string, unknown> | undefined,
  key: string,
): unknown {
  return candidate?.[key];
}

function stringValue(
  candidate: Record<string, unknown> | undefined,
  key: string,
  allowProcessFallback: boolean,
): string | undefined {
  const binding = recordValue(candidate, key);
  if (typeof binding === "string" && binding.trim()) return binding.trim();
  if (!allowProcessFallback) return undefined;
  const fallback = process.env[key]?.trim();
  return fallback || undefined;
}

function normalizeBindings(candidate: unknown): FlameNodeEnv {
  const record =
    candidate && typeof candidate === "object"
      ? (candidate as Record<string, unknown>)
      : undefined;
  const db = recordValue(record, "DB");
  const bucket = recordValue(record, "BUCKET");
  const kv = recordValue(record, "KV");
  const validDb = isD1Database(db) ? db : undefined;
  const validBucket = isR2Bucket(bucket) ? bucket : undefined;
  const validKv = isKvNamespace(kv) ? kv : undefined;
  const notificationWakeQueue = recordValue(record, "NOTIFICATION_WAKE_QUEUE");
  const staticRebuildWakeQueue = recordValue(record, "STATIC_REBUILD_WAKE_QUEUE");
  const youtubeSyncWakeQueue = recordValue(record, "YOUTUBE_SYNC_WAKE_QUEUE");
  if (!validDb || !validBucket || !validKv) {
    throw new CloudflareBindingsUnavailableError([
      ...(!validDb ? (["DB"] as const) : []),
      ...(!validBucket ? (["BUCKET"] as const) : []),
      ...(!validKv ? (["KV"] as const) : []),
    ]);
  }

  const allowProcessFallback = isLocalOrBuildPhase();
  return {
    DB: validDb,
    BUCKET: validBucket,
    KV: validKv,
    NOTIFICATION_WAKE_QUEUE: isQueueBinding(notificationWakeQueue)
      ? notificationWakeQueue
      : undefined,
    STATIC_REBUILD_WAKE_QUEUE: isQueueBinding(staticRebuildWakeQueue)
      ? staticRebuildWakeQueue
      : undefined,
    YOUTUBE_SYNC_WAKE_QUEUE: isQueueBinding(youtubeSyncWakeQueue)
      ? youtubeSyncWakeQueue
      : undefined,
    AUTH_SECRET: stringValue(record, "AUTH_SECRET", allowProcessFallback),
    AUTH_DISCORD_ID: stringValue(
      record,
      "AUTH_DISCORD_ID",
      allowProcessFallback,
    ),
    AUTH_DISCORD_SECRET: stringValue(
      record,
      "AUTH_DISCORD_SECRET",
      allowProcessFallback,
    ),
    SPREADSHEET_IMPORT_PREVIEW_SECRET:
      stringValue(
        record,
        "SPREADSHEET_IMPORT_PREVIEW_SECRET",
        allowProcessFallback,
      ),
    DISCORD_GUILD_ID: stringValue(
      record,
      "DISCORD_GUILD_ID",
      allowProcessFallback,
    ),
    DISCORD_BOT_TOKEN: stringValue(
      record,
      "DISCORD_BOT_TOKEN",
      allowProcessFallback,
    ),
    YOUTUBE_API_KEY: stringValue(
      record,
      "YOUTUBE_API_KEY",
      allowProcessFallback,
    ),
    YOUTUBE_DAILY_QUOTA_LIMIT: stringValue(
      record,
      "YOUTUBE_DAILY_QUOTA_LIMIT",
      allowProcessFallback,
    ),
    BUILD_COMMIT_SHA: stringValue(
      record,
      "BUILD_COMMIT_SHA",
      allowProcessFallback,
    ),
    WORKER_ADMIN_TOKEN: stringValue(
      record,
      "WORKER_ADMIN_TOKEN",
      allowProcessFallback,
    ),
    AUTH_URL: stringValue(record, "AUTH_URL", allowProcessFallback),
    NEXT_PUBLIC_SITE_URL: stringValue(
      record,
      "NEXT_PUBLIC_SITE_URL",
      allowProcessFallback,
    ),
    FLAMENODE_LOCAL_PREVIEW: stringValue(
      record,
      "FLAMENODE_LOCAL_PREVIEW",
      allowProcessFallback,
    ),
    FORCE_STATIC_ONLY: stringValue(
      record,
      "FORCE_STATIC_ONLY",
      allowProcessFallback,
    ),
    PUBLIC_DEGRADED_D1_ENABLED: stringValue(
      record,
      "PUBLIC_DEGRADED_D1_ENABLED",
      allowProcessFallback,
    ),
    QUEUE_DISPATCH_ENABLED: stringValue(
      record,
      "QUEUE_DISPATCH_ENABLED",
      allowProcessFallback,
    ),
    QUEUE_CONTINUATION_ENABLED: stringValue(
      record,
      "QUEUE_CONTINUATION_ENABLED",
      allowProcessFallback,
    ),
    QUEUE_YOUTUBE_SYNC_ENABLED: stringValue(
      record,
      "QUEUE_YOUTUBE_SYNC_ENABLED",
      allowProcessFallback,
    ),
  };
}

function localBindings(): unknown {
  if (!isLocalOrBuildPhase()) return undefined;
  const g = globalThis as Record<string | symbol, unknown>;
  return g.__FLAMENODE_LOCAL_BINDINGS;
}

function contextUnavailable(cause: unknown): CloudflareBindingsUnavailableError {
  return new CloudflareBindingsUnavailableError(["context"], cause);
}

export function getEnv(): FlameNodeEnv {
  try {
    return normalizeBindings(getCloudflareContext().env);
  } catch (error) {
    const local = localBindings();
    if (local) return normalizeBindings(local);
    if (error instanceof CloudflareBindingsUnavailableError) throw error;
    throw contextUnavailable(error);
  }
}

export async function getEnvAsync(): Promise<FlameNodeEnv> {
  await waitForLocalBindings();
  try {
    return normalizeBindings(
      (await getCloudflareContext({ async: true })).env,
    );
  } catch (error) {
    const local = localBindings();
    if (local) return normalizeBindings(local);
    if (error instanceof CloudflareBindingsUnavailableError) throw error;
    throw contextUnavailable(error);
  }
}

function databaseForBinding(binding: D1Database): DB {
  const cached = memoizedDbs.get(binding);
  if (cached) return cached;
  const db = getDb(binding);
  memoizedDbs.set(binding, db);
  return db;
}

function resolveDatabaseSync(): { binding: D1Database; db: DB } | null {
  try {
    const binding = getEnv().DB;
    return { binding, db: databaseForBinding(binding) };
  } catch (error) {
    if (
      isLocalOrBuildPhase() &&
      error instanceof CloudflareBindingsUnavailableError
    ) {
      return null;
    }
    throw error;
  }
}

export function getDatabase(): DB | null {
  return resolveDatabaseSync()?.db ?? null;
}

export async function getDatabaseAsync(): Promise<DB | null> {
  try {
    const binding = (await getEnvAsync()).DB;
    return databaseForBinding(binding);
  } catch (error) {
    if (
      isLocalOrBuildPhase() &&
      error instanceof CloudflareBindingsUnavailableError
    ) {
      return null;
    }
    throw error;
  }
}
