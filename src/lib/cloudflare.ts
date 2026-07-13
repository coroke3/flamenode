import "server-only";
import { getDb, type DB } from "./db/client";

/**
 * Cloudflare Pages (Next.js) の RuntimeContext から D1 / R2 / KV を取り出す。
 * `@cloudflare/next-on-pages` 環境では `getRequestContext` が提供されるが、
 * 開発時 (`next dev`) では未定義のことがあるため両対応する。
 */
export interface FlameNodeEnv {
  DB: D1Database;
  BUCKET: R2Bucket;
  KV: KVNamespace;
  // 認証関連 (Auth.js)
  AUTH_SECRET?: string;
  AUTH_DISCORD_ID?: string;
  AUTH_DISCORD_SECRET?: string;
  SPREADSHEET_IMPORT_PREVIEW_SECRET?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_BOT_TOKEN?: string;
  YOUTUBE_API_KEY?: string;
  YOUTUBE_DAILY_QUOTA_LIMIT?: string;
  NEXT_PUBLIC_SITE_URL?: string;
}

let memoizedDb: { ref: D1Database | null; db: DB | null } = {
  ref: null,
  db: null,
};

/** ローカル Miniflare / リモート D1 接続の瞬断で付きやすいコード・メッセージ */
const TRANSIENT_DB_MARKERS =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|UND_ERR_SOCKET|socket hang up/i;

function isTransientDbError(err: unknown): boolean {
  let cur: unknown = err;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 6 && cur != null; depth++) {
    if (seen.has(cur)) break;
    seen.add(cur);
    if (typeof cur === "object") {
      const o = cur as { code?: string; message?: string; cause?: unknown };
      if (
        o.code === "ECONNRESET" ||
        o.code === "ECONNREFUSED" ||
        o.code === "ETIMEDOUT"
      )
        return true;
      if (
        typeof o.message === "string" &&
        TRANSIENT_DB_MARKERS.test(o.message)
      )
        return true;
      cur = o.cause;
      continue;
    }
    break;
  }
  return false;
}

function clearDatabaseMemo(): void {
  memoizedDb = { ref: null, db: null };
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
    const db = getDatabase();
    if (!db) return null;
    try {
      return await fn(db);
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt >= maxAttempts - 1) {
        throw error;
      }
      clearDatabaseMemo();
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
  const db = getDatabase();
  if (!db) return null;
  return fn(db);
}

/**
 * 後方互換。既存呼び出しはすべて読み取り用途として扱う。
 * 新規コードでは withDatabaseRead / withDatabaseWrite を明示する。
 */
export const withDatabase = withDatabaseRead;

export async function waitForLocalBindings(): Promise<void> {
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

function normalizeBindings(
  candidate: Partial<FlameNodeEnv> | undefined,
): FlameNodeEnv {
  return {
    DB: (isD1Database(candidate?.DB) ? candidate.DB : undefined) as D1Database,
    BUCKET: (isR2Bucket(candidate?.BUCKET)
      ? candidate.BUCKET
      : undefined) as R2Bucket,
    KV: (isKvNamespace(candidate?.KV) ? candidate.KV : undefined) as KVNamespace,
    AUTH_SECRET: candidate?.AUTH_SECRET ?? process.env.AUTH_SECRET,
    AUTH_DISCORD_ID:
      candidate?.AUTH_DISCORD_ID ?? process.env.AUTH_DISCORD_ID,
    AUTH_DISCORD_SECRET:
      candidate?.AUTH_DISCORD_SECRET ?? process.env.AUTH_DISCORD_SECRET,
    SPREADSHEET_IMPORT_PREVIEW_SECRET:
      candidate?.SPREADSHEET_IMPORT_PREVIEW_SECRET ??
      process.env.SPREADSHEET_IMPORT_PREVIEW_SECRET,
    DISCORD_GUILD_ID:
      candidate?.DISCORD_GUILD_ID ?? process.env.DISCORD_GUILD_ID,
    DISCORD_BOT_TOKEN:
      candidate?.DISCORD_BOT_TOKEN ?? process.env.DISCORD_BOT_TOKEN,
    YOUTUBE_API_KEY:
      candidate?.YOUTUBE_API_KEY ?? process.env.YOUTUBE_API_KEY,
    YOUTUBE_DAILY_QUOTA_LIMIT:
      candidate?.YOUTUBE_DAILY_QUOTA_LIMIT ??
      process.env.YOUTUBE_DAILY_QUOTA_LIMIT,
    NEXT_PUBLIC_SITE_URL:
      candidate?.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL,
  };
}

export function getEnv(): FlameNodeEnv {
  const g = globalThis as Record<string | symbol, unknown>;

  // 1) Cloudflare Pages runtime
  const ctx = g[Symbol.for("__cloudflare-request-context__")] as
    | { env?: Partial<FlameNodeEnv> }
    | undefined;
  if (ctx?.env) return normalizeBindings(ctx.env);

  // 2) instrumentation.ts で初期化された Miniflare bindings
  const local = g.__FLAMENODE_LOCAL_BINDINGS as
    | Partial<FlameNodeEnv>
    | undefined;
  if (local) return normalizeBindings(local);

  // 3) Node の process.env は文字列なので D1/R2/KV binding として扱わない。
  return normalizeBindings(undefined);
}

export function getDatabase(): DB | null {
  const env = getEnv();
  if (!isD1Database(env.DB)) return null;
  if (memoizedDb.ref !== env.DB) {
    memoizedDb = { ref: env.DB, db: getDb(env.DB) };
  }
  return memoizedDb.db;
}

export async function getDatabaseAsync(): Promise<DB | null> {
  await waitForLocalBindings();
  return getDatabase();
}
