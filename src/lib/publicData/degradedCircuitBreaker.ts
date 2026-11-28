import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getOperationModeKv } from "@/lib/operationMode/kvMirror";
import {
  currentDegradedCircuitMinuteBucket,
  DEGRADED_CIRCUIT_CLOSE_HIT_STREAK,
  DEGRADED_CIRCUIT_LOCAL_PROBE_MS,
  DEGRADED_CIRCUIT_MISS_THRESHOLD,
  DEGRADED_CIRCUIT_MISS_WINDOW_SEC,
  DEGRADED_CIRCUIT_OPEN_TTL_SEC,
  degradedCircuitHitStreakKey,
  degradedCircuitMissKey,
  degradedCircuitOpenKey,
  shouldCloseDegradedCircuit,
  shouldOpenDegradedCircuit,
  shouldSkipDegradedCircuitKvProbe,
} from "./degradedCircuitBreakerCore";

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

// Acknowledged counter writes and OPEN reconciliation are separate receipts.
// Retain one bounded repair intent, never a request-scoped binding or Promise.
type OpenRepair = {
  expiresAt: number;
  lastAttemptAt: number;
  stage: "marker" | "cleanup";
  missCount: number | null;
};
let openRepair: OpenRepair | null = null;
let openRepairInFlight = false;
let hitCloseInFlight = false;
// Reject stale probe receipts after a newer local transition.
let circuitRevision = 0;

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

function markCircuitOpen(nowMs: number, preserveHits = false): void {
  circuitRevision += 1;
  localCircuitState.open = true;
  localCircuitState.openUntil = nowMs + DEGRADED_CIRCUIT_OPEN_TTL_SEC * 1_000;
  if (!preserveHits) localCircuitState.hitStreak = 0;
}

function markCircuitClosed(nowMs: number): void {
  circuitRevision += 1;
  localCircuitState.open = false;
  localCircuitState.openUntil = 0;
  localCircuitState.hitStreak = 0;
  localCircuitState.lastKvProbeAt = nowMs;
  openMarkerKnown = false;
  openRepair = null;
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
  expiresAt = Number.POSITIVE_INFINITY,
  priorHitStreak?: number,
): Promise<number | null> {
  const key = degradedCircuitOpenKey();
  const revision = circuitRevision;
  // A flush that observed OPEN locally may have earned hits since its first
  // marker GET. Keep those hits if we actually refresh the same generation.
  // Ordinary OPEN repair retains its existing hit-preservation behavior.
  const markOpenFromReceipt = (at: number): void => {
    const earnedHits = priorHitStreak === undefined
      ? null
      : Math.max(0, localCircuitState.hitStreak - priorHitStreak);
    markCircuitOpen(at, openRepair !== null);
    if (earnedHits !== null) localCircuitState.hitStreak = earnedHits;
  };
  if (Date.now() >= expiresAt || revision !== circuitRevision) {
    throw new Error("degraded circuit repair expired");
  }
  if (
    openMarkerKnown &&
    localCircuitState.open &&
    nowMs < localCircuitState.openUntil
  ) {
    return null;
  }
  const firstMarker = await kv.get(key);
  if (Date.now() >= expiresAt || revision !== circuitRevision) {
    throw new Error("degraded circuit repair expired");
  }
  if (firstMarker === "1") {
    openMarkerKnown = true;
    markOpenFromReceipt(nowMs);
    return null;
  }

  await waitForKvWriteSlot(key);
  if (Date.now() >= expiresAt || revision !== circuitRevision) {
    throw new Error("degraded circuit repair expired");
  }
  // Re-check after waiting. Another request in this isolate may have completed
  // the marker while this request was waiting for the KV rate window.
  if (
    openMarkerKnown &&
    localCircuitState.open &&
    Date.now() < localCircuitState.openUntil
  ) {
    return null;
  }
  const secondMarker = await kv.get(key);
  if (Date.now() >= expiresAt || revision !== circuitRevision) {
    throw new Error("degraded circuit repair expired");
  }
  if (secondMarker === "1") {
    openMarkerKnown = true;
    markOpenFromReceipt(nowMs);
    return null;
  }
  const writeStartedAt = Date.now();
  lastKvWriteAttemptAt.set(key, writeStartedAt);
  try {
    await kv.put(key, "1", {
      expirationTtl: DEGRADED_CIRCUIT_OPEN_TTL_SEC,
    });
    const writtenUntil = writeStartedAt + DEGRADED_CIRCUIT_OPEN_TTL_SEC * 1_000;
    // An acknowledged write can outlive its conservative local TTL estimate.
    // In that case force a fresh marker probe rather than assuming absence or
    // renewing the local TTL from the time the receipt arrived.
    if (revision !== circuitRevision) {
      // The PUT may have committed remotely, but a newer local transition
      // owns the state. Make the next closed-state probe read the marker.
      openMarkerKnown = false;
      localCircuitState.lastKvProbeAt = Number.NEGATIVE_INFINITY;
      return writtenUntil;
    }
    openMarkerKnown = Date.now() < writtenUntil;
    markOpenFromReceipt(writeStartedAt);
    return writtenUntil;
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
  // An elapsed minute has no role in the current admission window. Do not
  // start a historical counter write just to replay an expired observation.
  if (currentDegradedCircuitMinuteBucket(Date.now()) !== bucket) {
    throw new Error("degraded circuit miss window elapsed");
  }
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

function beginOpenRepair(nowMs: number, missCount: number | null): void {
  markCircuitOpen(nowMs);
  openRepair = {
    expiresAt: localCircuitState.openUntil,
    lastAttemptAt: Number.NEGATIVE_INFINITY,
    stage: "marker",
    missCount,
  };
}

async function attemptOpenRepair(kv: KVNamespace, nowMs: number): Promise<void> {
  const repair = openRepair;
  if (!repair || openRepairInFlight || hitCloseInFlight || missFlushInFlight) return;
  if (nowMs >= repair.expiresAt) {
    openRepair = null;
    return;
  }
  const elapsed = nowMs - repair.lastAttemptAt;
  if (elapsed >= 0 && elapsed < DEGRADED_CIRCUIT_KV_WRITE_INTERVAL_MS) return;
  repair.lastAttemptAt = nowMs;
  openRepairInFlight = true;
  try {
    if (repair.stage === "marker") {
      const writtenUntil = await putOpenMarkerIfNeeded(kv, nowMs, repair.expiresAt);
      if (openRepair !== repair) return;
      if (repair.missCount === null) {
        // Preserve the local-threshold fast-open path: no new cleanup/log.
        openRepair = null;
        return;
      }
      repair.stage = "cleanup";
      if (writtenUntil !== null) repair.expiresAt = writtenUntil;
    } else if ((await kv.get(degradedCircuitOpenKey())) !== "1") {
      // An acknowledged marker may have been closed elsewhere.
      // Cleanup must not reopen that marker.
      if (openRepair === repair) openRepair = null;
      return;
    }
    // The OPEN retry deadline is not the cleanup deadline after our own PUT.
    // Do not start a cleanup after expiry, or repeat a write on this key inside
    // the existing one-second budget. A later miss can retry without waiting.
    const cleanupNow = Date.now();
    if (cleanupNow >= repair.expiresAt) {
      if (openRepair === repair) openRepair = null;
      return;
    }
    const streakKey = degradedCircuitHitStreakKey();
    const lastCleanupAt = lastKvWriteAttemptAt.get(streakKey) ?? Number.NEGATIVE_INFINITY;
    if (cleanupNow - lastCleanupAt < DEGRADED_CIRCUIT_KV_WRITE_INTERVAL_MS) return;
    lastKvWriteAttemptAt.set(streakKey, cleanupNow);
    await kv.delete(streakKey);
    if (openRepair !== repair) return;
    openRepair = null;
    try {
      console.warn(
        JSON.stringify({
          service: "degraded-circuit",
          result: "opened",
          miss_count: repair.missCount,
          threshold: DEGRADED_CIRCUIT_MISS_THRESHOLD,
          window_sec: DEGRADED_CIRCUIT_MISS_WINDOW_SEC,
        }),
      );
    } catch {
      // Diagnostics are best-effort; preserve successful KV accounting.
    }
  } catch {
    // Retry only the unfinished OPEN stage on a later request.
    if (openRepair === repair && Date.now() >= repair.expiresAt) openRepair = null;
  } finally {
    openRepairInFlight = false;
  }
}

async function reconcileOpenRepair(kv: KVNamespace, nowMs: number): Promise<void> {
  await attemptOpenRepair(kv, nowMs);
  // Hits accrued while marker I/O was in flight must not require a fourth hit.
  // Close using this request's binding, not the earlier request's promise.
  if (localCircuitState.open && Date.now() < localCircuitState.openUntil &&
    shouldCloseDegradedCircuit(localCircuitState.hitStreak)) {
    await closeCircuitIfReady(kv, Date.now());
  }
}

async function flushMissCount(
  kv: KVNamespace,
  bucket: number,
  pending: number,
  nowMs: number,
  acknowledge: () => void,
): Promise<void> {
  const readRevision = circuitRevision;
  const priorHitStreak = localCircuitState.hitStreak;
  const wasOpen = localCircuitState.open && nowMs < localCircuitState.openUntil;
  const remoteOpen = (await kv.get(degradedCircuitOpenKey())) === "1";
  if (currentDegradedCircuitMinuteBucket(Date.now()) !== bucket) return;
  // A stale marker receipt cannot reset a newer local transition. A concurrent
  // threshold crossing owns OPEN repair even while the counter flush awaits KV.
  if (readRevision === circuitRevision && !openRepair) {
    if (remoteOpen) {
      // The miss resets hits from before this read, but not hits earned
      // against the same unexpired OPEN while its marker read was pending.
      const earnedHits = wasOpen && Date.now() < localCircuitState.openUntil
        ? Math.max(0, localCircuitState.hitStreak - priorHitStreak)
        : 0;
      markCircuitOpen(nowMs);
      localCircuitState.hitStreak = earnedHits;
    } else if (localCircuitState.open && nowMs < localCircuitState.openUntil) {
      await putOpenMarkerIfNeeded(kv, nowMs, localCircuitState.openUntil, priorHitStreak);
    } else {
      markCircuitClosed(nowMs);
    }
  }

  const nextCount = await persistMissCounter(kv, bucket, pending);
  acknowledge();
  if (currentDegradedCircuitMinuteBucket(Date.now()) !== bucket ||
    !shouldOpenDegradedCircuit(nextCount) || localCircuitState.open || openRepair) return;
  beginOpenRepair(Date.now(), nextCount);
}

async function flushPendingMissesIfReady(
  kv: KVNamespace,
  nowMs: number,
  allowRolloverFollowup = true,
): Promise<boolean> {
  const state = missAccumulator;
  if (!state || state.pending <= 0 || missFlushInFlight || hitCloseInFlight ||
    state.bucket !== currentDegradedCircuitMinuteBucket(Date.now())) return false;
  const elapsed = nowMs - state.lastFlushAt;
  if (elapsed >= 0 && elapsed < DEGRADED_CIRCUIT_MISS_LOCAL_FLUSH_MS) {
    return false;
  }

  const pending = state.pending;
  state.pending = 0;
  state.lastFlushAt = nowMs;
  missFlushInFlight = true;
  let acknowledged = false;
  try {
    await flushMissCount(kv, state.bucket, pending, nowMs, () => {
      acknowledged = true;
    });
  } catch {
    // Keep the count for a later request, but never retain the KV binding or
    // the rejected Promise itself in isolate-global state.
    if (!acknowledged && missAccumulator === state &&
      state.bucket === currentDegradedCircuitMinuteBucket(Date.now())) {
      state.pending += pending;
      state.lastFlushAt = nowMs;
    }
  } finally {
    missFlushInFlight = false;
  }
  // Complete an earned close even when this flush had no OPEN repair.
  if (openRepair || (localCircuitState.open && shouldCloseDegradedCircuit(localCircuitState.hitStreak))) {
    await reconcileOpenRepair(kv, Date.now());
  }
  // At most one follow-up per request: a newer active bucket may have queued
  // misses while the old flush was awaiting I/O. Never re-credit old counts.
  if (allowRolloverFollowup && !openRepair && !localCircuitState.open &&
    missAccumulator !== state && missAccumulator?.bucket === currentDegradedCircuitMinuteBucket(Date.now())) {
    await flushPendingMissesIfReady(kv, Date.now(), false);
  }
  return true;
}

/** degraded D1 へ進む前にサーキット状態を確認する。 */
export async function isDegradedD1CircuitOpen(): Promise<boolean> {
  const kv = getOperationModeKv();
  if (!kv) return false;
  const now = Date.now();
  if (localCircuitState.open && (now < localCircuitState.openUntil || openRepairInFlight)) {
    return true;
  }
  if (
    !localCircuitState.open &&
    shouldSkipDegradedCircuitKvProbe(localCircuitState.lastKvProbeAt, now)
  ) {
    return false;
  }
  const revision = circuitRevision;
  try {
    const open = await kv.get(degradedCircuitOpenKey());
    if (revision !== circuitRevision) {
      return localCircuitState.open && (Date.now() < localCircuitState.openUntil || openRepairInFlight);
    }
    if (open === "1") {
      markCircuitOpen(now);
      return true;
    }
    markCircuitClosed(now);
    return false;
  } catch {
    return revision !== circuitRevision && localCircuitState.open &&
      (Date.now() < localCircuitState.openUntil || openRepairInFlight);
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
    // A queued waitUntil callback can arrive after its observation window.
    // Expire it rather than replacing a newer bucket or reviving old counts.
    if (bucket !== currentDegradedCircuitMinuteBucket(Date.now())) return;
    if (openRepair) {
      const wasOpen = localCircuitState.open && nowMs < localCircuitState.openUntil;
      await reconcileOpenRepair(kv, nowMs);
      // This miss arrived while OPEN, even if accumulated hits close it during repair.
      if (openRepair || (wasOpen && !localCircuitState.open)) return;
    }
    if (bucket !== currentDegradedCircuitMinuteBucket(Date.now())) return;
    if (localCircuitState.open && nowMs < localCircuitState.openUntil) {
      if (missAccumulator?.bucket === bucket && !hitCloseInFlight) {
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
      beginOpenRepair(nowMs, null);
      await reconcileOpenRepair(kv, nowMs);
      return;
    }
    const elapsed = nowMs - missAccumulator.lastFlushAt;
    if (elapsed >= 0 && elapsed < DEGRADED_CIRCUIT_MISS_LOCAL_FLUSH_MS) {
      return;
    }
    if (!hitCloseInFlight) await flushPendingMissesIfReady(kv, nowMs);
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
  openRepair = null;
  openRepairInFlight = false;
  hitCloseInFlight = false;
  circuitRevision = 0;
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

  if (localCircuitState.open && now >= localCircuitState.openUntil &&
    !openRepairInFlight && !hitCloseInFlight && !missFlushInFlight) {
    // Do not erase a pending marker receipt or accumulated hits while an
    // operation is outstanding. A fresh probe is required after expiry.
    markCircuitClosed(now);
    localCircuitState.lastKvProbeAt = Number.NEGATIVE_INFINITY;
  }

  localCircuitState.hitStreak += 1;
  if (
    localCircuitState.open &&
    !shouldCloseDegradedCircuit(localCircuitState.hitStreak)
  ) {
    return;
  }

  await closeCircuitIfReady(kv, now);
}

async function closeCircuitIfReady(
  kv: KVNamespace,
  now: number,
  allowNewerRepairFollowup = true,
): Promise<void> {
  // A repair and close must not mutate the marker concurrently in this isolate.
  if (openRepairInFlight || hitCloseInFlight || missFlushInFlight) return;
  hitCloseInFlight = true;
  const repairAtStart = openRepair;
  try {
    localCircuitState.lastKvProbeAt = now;
    const revision = circuitRevision;
    const remoteOpen = await kv.get(degradedCircuitOpenKey());
    // A miss may have established a newer local threshold while this hit
    // awaited KV. Do not clear that repair from a stale closed receipt.
    if (revision !== circuitRevision) return;
    if (remoteOpen !== "1") {
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
    const closeRevision = circuitRevision;
    await waitForKvWriteSlot(openKey);
    // The old OPEN may expire while waiting for the write slot. Do not
    // delete a marker on behalf of a superseded local transition.
    if (closeRevision !== circuitRevision) return;
    lastKvWriteAttemptAt.set(openKey, Date.now());
    await kv.delete(openKey);
    if (closeRevision !== circuitRevision) {
      // A newer repair can be established while DELETE is outstanding.
      // Its request-local reconciliation must not reuse our old marker receipt.
      openMarkerKnown = false;
      return;
    }
    // Acknowledged close is final locally even if diagnostic cleanup fails.
    markCircuitClosed(now);
    await waitForKvWriteSlot(streakKey);
    lastKvWriteAttemptAt.set(streakKey, Date.now());
    await kv.delete(streakKey);
    console.warn(
      JSON.stringify({
        service: "degraded-circuit",
        result: "closed",
        hit_streak: DEGRADED_CIRCUIT_CLOSE_HIT_STREAK,
      }),
    );
  } catch {
    // Best effort only.
  } finally {
    hitCloseInFlight = false;
    if (openRepair && localCircuitState.open) {
      if (!shouldCloseDegradedCircuit(localCircuitState.hitStreak)) {
        await attemptOpenRepair(kv, Date.now());
      } else if (allowNewerRepairFollowup && openRepair !== repairAtStart &&
        Date.now() < localCircuitState.openUntil) {
        // A newer OPEN accrued its own three hits while this close was busy.
        // Use one fresh probe after releasing the old lock, not its stale read.
        // Bound the follow-up to avoid looping on further overlapping repairs.
        await closeCircuitIfReady(kv, Date.now(), false);
      }
    }
  }
}
