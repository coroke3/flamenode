import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getOperationModeKv } from "@/lib/operationMode/kvMirror";
import {
  currentDegradedCircuitMinuteBucket,
  DEGRADED_CIRCUIT_CLOSE_HIT_STREAK,
  DEGRADED_CIRCUIT_MISS_THRESHOLD,
  DEGRADED_CIRCUIT_MISS_WINDOW_SEC,
  DEGRADED_CIRCUIT_OPEN_TTL_SEC,
  degradedCircuitHitStreakKey,
  degradedCircuitMissKey,
  degradedCircuitOpenKey,
  shouldCloseDegradedCircuit,
  shouldOpenDegradedCircuit,
} from "./degradedCircuitBreakerCore";

const DEGRADED_CIRCUIT_LOCAL_PROBE_MS = 30_000;
const DEGRADED_CIRCUIT_MISS_LOCAL_FLUSH_MS = 1_000;
const DEGRADED_CIRCUIT_KV_WRITE_INTERVAL_MS = 1_000;

type MissAccumulator = {
  bucket: number;
  /** Number of misses observed in this isolate/bucket (includes flushed misses). */
  observed: number;
  pending: number;
  lastFlushAt: number;
};

// Workers isolates are reused across requests. Keep only pure bookkeeping in
// module scope; never retain KV bindings or Promises created by another
// request. Cross-request I/O objects can fail with "Cannot perform I/O on
// behalf of a different request" in workerd.
let missAccumulator: MissAccumulator | null = null;
let missFlushInFlight = false;
// KV enforces a one-write-per-key-per-second limit. This map stores timestamps
// only; it deliberately does not retain request-scoped bindings or Promises.
const lastKvWriteAttemptAt = new Map<string, number>();
let lastMissWriteKey: string | null = null;
let openMarkerKnown = false;

let localCircuitState: {
  open: boolean;
  openUntil: number;
  hitStreak: number;
  lastKvProbeAt: number;
} = {
  open: false,
  openUntil: 0,
  hitStreak: 0,
  lastKvProbeAt: 0,
};

function markCircuitOpen(nowMs: number): void {
  localCircuitState.open = true;
  localCircuitState.openUntil = nowMs + DEGRADED_CIRCUIT_OPEN_TTL_SEC * 1_000;
  localCircuitState.hitStreak = 0;
}

function markCircuitClosed(nowMs: number): void {
  localCircuitState.open = false;
  localCircuitState.openUntil = 0;
  localCircuitState.hitStreak = 0;
  localCircuitState.lastKvProbeAt = nowMs;
  openMarkerKnown = false;
}

async function waitForKvWriteSlot(key: string): Promise<void> {
  while (true) {
    const lastAttemptAt = lastKvWriteAttemptAt.get(key) ?? Number.NEGATIVE_INFINITY;
    const remaining =
      DEGRADED_CIRCUIT_KV_WRITE_INTERVAL_MS - (Date.now() - lastAttemptAt);
    if (remaining <= 0) return;
    await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  }
}

async function putOpenMarkerIfNeeded(
  kv: KVNamespace,
  nowMs: number,
): Promise<void> {
  const key = degradedCircuitOpenKey();
  if (
    openMarkerKnown &&
    localCircuitState.open &&
    nowMs < localCircuitState.openUntil
  ) {
    return;
  }
  if ((await kv.get(key)) === "1") {
    openMarkerKnown = true;
    markCircuitOpen(nowMs);
    return;
  }

  await waitForKvWriteSlot(key);
  // Re-check after waiting. Another request in this isolate may have completed
  // the marker while this request was waiting for the KV rate window.
  if (
    openMarkerKnown &&
    localCircuitState.open &&
    Date.now() < localCircuitState.openUntil
  ) {
    return;
  }
  if ((await kv.get(key)) === "1") {
    openMarkerKnown = true;
    markCircuitOpen(nowMs);
    return;
  }

  lastKvWriteAttemptAt.set(key, Date.now());
  try {
    await kv.put(key, "1", {
      expirationTtl: DEGRADED_CIRCUIT_OPEN_TTL_SEC,
    });
    openMarkerKnown = true;
    markCircuitOpen(nowMs);
  } catch (error) {
    openMarkerKnown = false;
    throw error;
  }
}

async function persistMissCounter(
  kv: KVNamespace,
  bucket: number,
  pending: number,
): Promise<number> {
  const missKey = degradedCircuitMissKey(bucket);
  if (lastMissWriteKey && lastMissWriteKey !== missKey) {
    lastKvWriteAttemptAt.delete(lastMissWriteKey);
  }
  lastMissWriteKey = missKey;
  const nextCount = parseCount(await kv.get(missKey)) + pending;
  await waitForKvWriteSlot(missKey);
  lastKvWriteAttemptAt.set(missKey, Date.now());
  await kv.put(missKey, String(nextCount), {
    expirationTtl: DEGRADED_CIRCUIT_MISS_WINDOW_SEC * 2,
  });
  return nextCount;
}

function parseCount(raw: string | null): number {
  if (raw == null || raw === "") return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function resolveWaitUntil(): ((promise: Promise<unknown>) => void) | null {
  try {
    const ctx = getCloudflareContext();
    const waitUntil = (
      ctx as { ctx?: { waitUntil?: (promise: Promise<unknown>) => void } }
    ).ctx?.waitUntil;
    return typeof waitUntil === "function" ? waitUntil.bind(ctx.ctx) : null;
  } catch {
    return null;
  }
}

function scheduleCircuitBookkeeping(taskFactory: () => Promise<void>): void {
  const waitUntil = resolveWaitUntil();
  // Best-effort circuit telemetry must never create an untracked Promise.
  // Direct async helpers remain available for tests/callers that explicitly
  // need to await completion.
  if (!waitUntil) return;
  try {
    const task = taskFactory().catch(() => undefined);
    waitUntil(task);
  } catch {
    // A local/runtime shim may reject waitUntil registration. Do not start a
    // second detached I/O task here.
  }
}

async function flushMissCount(
  kv: KVNamespace,
  bucket: number,
  pending: number,
  nowMs: number,
): Promise<void> {
  if ((await kv.get(degradedCircuitOpenKey())) === "1") {
    markCircuitOpen(nowMs);
    // Keep the bounded miss counter useful for the next window. This is
    // telemetry/safety state only; failure never affects the public response.
    await persistMissCounter(kv, bucket, pending);
    return;
  }
  if (localCircuitState.open && nowMs < localCircuitState.openUntil) {
    await putOpenMarkerIfNeeded(kv, nowMs);
    await persistMissCounter(kv, bucket, pending);
    return;
  }

  markCircuitClosed(nowMs);
  const nextCount = await persistMissCounter(kv, bucket, pending);

  if (!shouldOpenDegradedCircuit(nextCount)) return;

  await putOpenMarkerIfNeeded(kv, nowMs);
  await kv.delete(degradedCircuitHitStreakKey());
  console.warn(
    JSON.stringify({
      service: "degraded-circuit",
      result: "opened",
      miss_count: nextCount,
      threshold: DEGRADED_CIRCUIT_MISS_THRESHOLD,
      window_sec: DEGRADED_CIRCUIT_MISS_WINDOW_SEC,
    }),
  );
}

async function persistOpenMarker(kv: KVNamespace, nowMs: number): Promise<void> {
  await putOpenMarkerIfNeeded(kv, nowMs);
}

async function flushPendingMissesIfReady(
  kv: KVNamespace,
  nowMs: number,
): Promise<boolean> {
  const state = missAccumulator;
  if (!state || state.pending <= 0 || missFlushInFlight) return false;
  const elapsed = nowMs - state.lastFlushAt;
  if (elapsed >= 0 && elapsed < DEGRADED_CIRCUIT_MISS_LOCAL_FLUSH_MS) {
    return false;
  }

  const pending = state.pending;
  state.pending = 0;
  state.lastFlushAt = nowMs;
  missFlushInFlight = true;
  try {
    await flushMissCount(kv, state.bucket, pending, nowMs);
  } catch {
    // Keep the count for a later request, but never retain the KV binding or
    // the rejected Promise itself in isolate-global state.
    if (missAccumulator === state) {
      state.pending += pending;
      state.lastFlushAt = nowMs;
    }
  } finally {
    missFlushInFlight = false;
  }
  return true;
}

/** degraded D1 へ進む前にサーキット状態を確認する。 */
export async function isDegradedD1CircuitOpen(): Promise<boolean> {
  const kv = getOperationModeKv();
  if (!kv) return false;
  const now = Date.now();
  if (localCircuitState.open && now < localCircuitState.openUntil) {
    return true;
  }
  try {
    const open = await kv.get(degradedCircuitOpenKey());
    if (open === "1") {
      markCircuitOpen(now);
      return true;
    }
    markCircuitClosed(now);
    return false;
  } catch {
    return false;
  }
}

/** R2 静的 JSON miss を記録し、閾値超過時にサーキットを open にする（配信安全装置。無料枠 CostGuard ではない）。 */
export async function recordDegradedCircuitR2Miss(
  nowMs: number = Date.now(),
): Promise<void> {
  const kv = getOperationModeKv();
  if (!kv) return;
  try {
    const bucket = currentDegradedCircuitMinuteBucket(nowMs);
    if (localCircuitState.open && nowMs < localCircuitState.openUntil) {
      if (missAccumulator?.bucket === bucket) {
        await flushPendingMissesIfReady(kv, nowMs);
      }
      return;
    }

    if (!missAccumulator || missAccumulator.bucket !== bucket) {
      missAccumulator = {
        bucket,
        observed: 0,
        pending: 0,
        lastFlushAt: Number.NEGATIVE_INFINITY,
      };
    }
    missAccumulator.observed += 1;
    missAccumulator.pending += 1;
    if (
      missAccumulator.observed >= DEGRADED_CIRCUIT_MISS_THRESHOLD &&
      !localCircuitState.open
    ) {
      // Local observation is a fast fail-closed guard. KV only propagates the
      // open marker to other isolates; no request awaits a prior request's I/O.
      markCircuitOpen(nowMs);
      await persistOpenMarker(kv, nowMs);
      return;
    }
    const elapsed = nowMs - missAccumulator.lastFlushAt;
    if (elapsed >= 0 && elapsed < DEGRADED_CIRCUIT_MISS_LOCAL_FLUSH_MS) {
      return;
    }
    await flushPendingMissesIfReady(kv, nowMs);
  } catch {
    // Circuit bookkeeping must not take down public pages.
  }
}

/** Schedule circuit bookkeeping beyond the request lifetime when available. */
export function recordDegradedCircuitR2MissBestEffort(
  nowMs: number = Date.now(),
): void {
  scheduleCircuitBookkeeping(() => recordDegradedCircuitR2Miss(nowMs));
}

/** Schedule hit bookkeeping beyond the request lifetime when available. */
export function recordDegradedCircuitR2HitBestEffort(): void {
  scheduleCircuitBookkeeping(() => recordDegradedCircuitR2Hit());
}

/** Reset isolate-local bookkeeping in tests. */
export function resetDegradedCircuitBookkeepingForTests(): void {
  missAccumulator = null;
  missFlushInFlight = false;
  lastKvWriteAttemptAt.clear();
  lastMissWriteKey = null;
  openMarkerKnown = false;
  localCircuitState = {
    open: false,
    openUntil: 0,
    hitStreak: 0,
    lastKvProbeAt: 0,
  };
}

/* bounded KV miss accounting ends above; hit accounting continues below. */

/** open 中の R2 ヒット連続でサーキットを閉じる。 */
export async function recordDegradedCircuitR2Hit(): Promise<void> {
  const kv = getOperationModeKv();
  if (!kv) return;
  const now = Date.now();

  // R2 hits are the hot path. When this isolate recently observed the circuit
  // closed, avoid one KV read per public request.
  if (
    !localCircuitState.open &&
    now - localCircuitState.lastKvProbeAt < DEGRADED_CIRCUIT_LOCAL_PROBE_MS
  ) {
    return;
  }

  if (localCircuitState.open && now >= localCircuitState.openUntil) {
    localCircuitState.open = false;
    localCircuitState.hitStreak = 0;
  }

  localCircuitState.hitStreak += 1;
  if (
    localCircuitState.open &&
    !shouldCloseDegradedCircuit(localCircuitState.hitStreak)
  ) {
    return;
  }

  try {
    localCircuitState.lastKvProbeAt = now;
    if ((await kv.get(degradedCircuitOpenKey())) !== "1") {
      markCircuitClosed(now);
      return;
    }

    const hitStreak = localCircuitState.hitStreak;
    markCircuitOpen(now);
    localCircuitState.hitStreak = Math.max(hitStreak, 1);

    const streakKey = degradedCircuitHitStreakKey();
    const nextStreak = localCircuitState.hitStreak;
    if (!shouldCloseDegradedCircuit(nextStreak)) {
      return;
    }

    const openKey = degradedCircuitOpenKey();
    await waitForKvWriteSlot(openKey);
    lastKvWriteAttemptAt.set(openKey, Date.now());
    await kv.delete(openKey);
    await kv.delete(streakKey);
    markCircuitClosed(now);
    console.warn(
      JSON.stringify({
        service: "degraded-circuit",
        result: "closed",
        hit_streak: DEGRADED_CIRCUIT_CLOSE_HIT_STREAK,
      }),
    );
  } catch {
    // Best effort only.
  }
}
