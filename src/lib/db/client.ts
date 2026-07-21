import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * D1 (Drizzle) クライアント。
 * Cloudflare Workers / OpenNext のランタイムから `env.DB` を取得して接続する。
 *
 * Next.js (App Router) では `getCloudflareContext().env.DB` からbindingを取得するが、
 * 本ファイルでは引数として D1 を受け取り、
 * 各 Server Action / RSC が `getDb(env.DB)` の形で利用する。
 */
export type DB = ReturnType<typeof drizzle<typeof schema>>;

export function getDb(d1: D1Database): DB {
  return drizzle(d1, { schema });
}

export { schema };
