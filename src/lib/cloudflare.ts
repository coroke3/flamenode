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
  DISCORD_GUILD_ID?: string;
  DISCORD_BOT_TOKEN?: string;
  YOUTUBE_API_KEY?: string;
  NEXT_PUBLIC_SITE_URL?: string;
}

let memoizedDb: { ref: D1Database | null; db: DB | null } = {
  ref: null,
  db: null,
};

/** ローカル Miniflare / リモート D1 接続の瞬断で付きやすいコード・メッセージ */
const TRANSIENT_DB_MARKERS = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|UND_ERR_SOCKET|socket hang up/i;

function isTransientDbError(err: unknown): boolean {
  let cur: unknown = err;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 6 && cur != null; depth++) {
    if (seen.has(cur)) break;
    seen.add(cur);
    if (typeof cur === "object") {
      const o = cur as { code?: string; message?: string; cause?: unknown };
      if (o.code === "ECONNRESET" || o.code === "ECONNREFUSED" || o.code === "ETIMEDOUT")
        return true;
      if (typeof o.message === "string" && TRANSIENT_DB_MARKERS.test(o.message))
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

/**
 * D1 クエリの一時的な接続切断（Miniflare workerd 等）に対して数回リトライする。
 * 同一 Drizzle インスタンスが腐っている場合に備え、失敗時はメモを捨てて作り直す。
 */
export async function withDatabase<T>(fn: (db: DB) => Promise<T>): Promise<T | null> {
  const maxAttempts = 4;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const db = getDatabase();
    if (!db) return null;
    try {
      return await fn(db);
    } catch (e) {
      lastError = e;
      if (!isTransientDbError(e) || attempt >= maxAttempts - 1) {
        throw e;
      }
      clearDatabaseMemo();
      await new Promise((r) => setTimeout(r, 30 * 2 ** attempt));
    }
  }
  throw lastError;
}

export function getEnv(): FlameNodeEnv {
  const g = globalThis as Record<string | symbol, unknown>;

  // 1) Cloudflare Pages ランタイム
  const ctx = g[Symbol.for("__cloudflare-request-context__")] as
    | { env?: FlameNodeEnv }
    | undefined;
  if (ctx?.env) return ctx.env as FlameNodeEnv;

  // 2) instrumentation.ts で初期化された Miniflare バインディング
  const local = g.__FLAMENODE_LOCAL_BINDINGS as
    | { DB: D1Database; BUCKET: R2Bucket; KV: KVNamespace }
    | undefined;
  if (local) {
    return {
      DB: local.DB,
      BUCKET: local.BUCKET,
      KV: local.KV,
      AUTH_SECRET: process.env.AUTH_SECRET,
      AUTH_DISCORD_ID: process.env.AUTH_DISCORD_ID,
      AUTH_DISCORD_SECRET: process.env.AUTH_DISCORD_SECRET,
      DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID,
      DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
      YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    };
  }

  // 3) process.env から擬似的に組み立てる (どちらも無いとき: D1/R2/KV は使えない)
  const env = process.env as unknown as Partial<FlameNodeEnv>;
  return {
    DB: env.DB as D1Database,
    BUCKET: env.BUCKET as R2Bucket,
    KV: env.KV as KVNamespace,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_DISCORD_ID: process.env.AUTH_DISCORD_ID,
    AUTH_DISCORD_SECRET: process.env.AUTH_DISCORD_SECRET,
    DISCORD_GUILD_ID: process.env.DISCORD_GUILD_ID,
    DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
    YOUTUBE_API_KEY: process.env.YOUTUBE_API_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  };
}

export function getDatabase(): DB | null {
  const env = getEnv();
  if (!env?.DB) return null;
  if (memoizedDb.ref !== env.DB) {
    memoizedDb = { ref: env.DB, db: getDb(env.DB) };
  }
  return memoizedDb.db;
}
