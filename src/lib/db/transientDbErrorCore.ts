/**
 * ローカル Miniflare / リモート D1 接続の瞬断や SQLite ロックで付きやすいコード・メッセージ。
 * Cloudflare D1 の retry guidance / error list にある current transient markers もここへ集約する。
 * overloaded / CPU / memory limit は負荷を増幅し得るため自動retry対象にしない。
 */
const TRANSIENT_DB_MARKERS =
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|UND_ERR_SOCKET|socket hang up|Network connection lost|Replica disconnected from primary|Cannot resolve D1 DB due to transient issue on remote node|storage caused object to be reset|reset because its code was updated|SQLITE_BUSY|database is locked|D1_ERROR.*internal error|Failed to parse body as JSON.*internal error/i;

/** 読み取り専用 retry 対象の一時的 DB エラーか判定する。 */
export function isTransientDbError(err: unknown): boolean {
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
        o.code === "ETIMEDOUT" ||
        o.code === "SQLITE_BUSY"
      ) {
        return true;
      }
      if (
        typeof o.message === "string" &&
        TRANSIENT_DB_MARKERS.test(o.message)
      ) {
        return true;
      }
      cur = o.cause;
      continue;
    }
    if (typeof cur === "string" && TRANSIENT_DB_MARKERS.test(cur)) {
      return true;
    }
    break;
  }
  return false;
}
