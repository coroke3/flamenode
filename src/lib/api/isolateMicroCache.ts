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

type Entry = { value: string; expiresAt: number };

const entries = new Map<string, Entry>();

export function isolateMicroCacheGet(
  key: string,
  nowMs: number = Date.now(),
): string | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (nowMs >= entry.expiresAt) {
    entries.delete(key);
    return null;
  }
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
  // 再設定は挿入順を更新し、最古のentryから追い出す。
  entries.delete(key);
  if (entries.size >= ISOLATE_MICRO_CACHE_MAX_ENTRIES) {
    // 期限切れを先に掃除し、それでも満杯なら最古を1件ずつ追い出す。
    for (const [k, e] of entries) {
      if (nowMs >= e.expiresAt) entries.delete(k);
    }
    while (entries.size >= ISOLATE_MICRO_CACHE_MAX_ENTRIES) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
  }
  entries.set(key, {
    value,
    expiresAt: nowMs + ISOLATE_MICRO_CACHE_TTL_MS,
  });
}

export function isolateMicroCacheSizeForTests(): number {
  return entries.size;
}

export function resetIsolateMicroCacheForTests(): void {
  entries.clear();
}
