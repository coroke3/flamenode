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

export function getEnv(): FlameNodeEnv {
  // Cloudflare Pages ランタイム
  const ctx = (globalThis as Record<string | symbol, unknown>)[
    Symbol.for("__cloudflare-request-context__")
  ] as { env?: FlameNodeEnv } | undefined;
  if (ctx?.env) return ctx.env as FlameNodeEnv;

  // process.env から擬似的に組み立てる (next dev 等)
  const env = (process.env as unknown) as Partial<FlameNodeEnv>;
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
