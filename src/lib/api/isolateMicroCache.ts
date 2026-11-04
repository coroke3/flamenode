// isolate内の短時間coalescing用micro-cache。
//
// polling clientが同一isolateへ短時間に大量に当たっても、D1の全件読取りを
// 5秒に1回へ畳むためだけに使う。認可の正本ではない。呼び出し側は認可判定を
// request毎に済ませた後でだけ読み書きすること。
//
// isolate globalに保持してよいのは解決済みのimmutableなstringだけにする。
// Promise / binding / Request / Response など request context を参照し得る値は
// 別requestからawaitや再利用をしてはならないため、型と実行時の両方で拒否する。

// 15s: a lone client polling every ~5s still coalesces to 1 D1 snapshot per
// window (a 5s TTL would miss on every exact-interval poll).
export const ISOLATE_MICRO_CACHE_TTL_MS = 15_000;
export const ISOLATE_MICRO_CACHE_MAX_ENTRIES = 64;
// Upper bound on retained UTF-16 string storage across the 64-entry isolate cache.
// Cache is an optimization; oversize bodies still reach the HTTP caller uncached.
export const ISOLATE_MICRO_CACHE_MAX_BYTES = 8 * 1024 * 1024;

type Entry = { value: string; expiresAt: number };

const entries = new Map<string, Entry>();

function cachedStringBytes(value: string): number {
  // Two bytes per UTF-16 code unit is an upper bound for JS string content.
  return value.length * 2;
}

export function isolateMicroCacheGet(
  key: string,
  nowMs: number = Date.now(),
): string | null {
  const entry = entries.get(key);
  if (!entry) return null;
  // A wall-clock rollback must not extend a private/public snapshot's TTL.
  // The insertion time is recoverable without changing the cache entry shape.
  if (!Number.isFinite(nowMs) || nowMs < entry.expiresAt - ISOLATE_MICRO_CACHE_TTL_MS ||
      nowMs >= entry.expiresAt) {
    entries.delete(key);
    return null;
  }
  // Refresh recency on successful reads: byte-pressure eviction is true LRU,
  // not just insertion-order FIFO. Preserve expiresAt; reads do not extend TTL.
  entries.delete(key);
  entries.set(key, entry);
  return entry.value;
}

export function isolateMicroCacheSet(
  key: string,
  value: string,
  nowMs: number = Date.now(),
): void {
  if (typeof value !== "string") {
    throw new TypeError("isolateMicroCache stores finished strings only");
  }
  // NaN would make expiresAt=NaN and bypass every expiry comparison.
  if (!Number.isFinite(nowMs)) {
    throw new RangeError("isolateMicroCache requires a finite timestamp");
  }
  // 再設定は挿入順を更新し、最古のentryから追い出す。
  // Cache is best effort: a single huge export must never monopolize isolate memory.
  const incomingBytes = cachedStringBytes(value);
  entries.delete(key);
  if (incomingBytes > ISOLATE_MICRO_CACHE_MAX_BYTES) return;

  // Reclaim expired/clock-rolled-back payloads before enforcing count and bytes.
  let retainedBytes = 0;
  for (const [cachedKey, entry] of entries) {
    if (!Number.isFinite(entry.expiresAt) ||
        nowMs < entry.expiresAt - ISOLATE_MICRO_CACHE_TTL_MS ||
        nowMs >= entry.expiresAt) {
      entries.delete(cachedKey);
      continue;
    }
    retainedBytes += cachedStringBytes(entry.value);
  }
  // Bound combined content size as well as the entry count, evicting LRU-first.
  while (entries.size >= ISOLATE_MICRO_CACHE_MAX_ENTRIES ||
         retainedBytes + incomingBytes > ISOLATE_MICRO_CACHE_MAX_BYTES) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = entries.get(oldestKey)!;
    retainedBytes -= cachedStringBytes(oldest.value);
    entries.delete(oldestKey);
  }
  entries.set(key, { value, expiresAt: nowMs + ISOLATE_MICRO_CACHE_TTL_MS });
}

export function isolateMicroCacheSizeForTests(): number {
  return entries.size;
}

export function resetIsolateMicroCacheForTests(): void {
  entries.clear();
}
