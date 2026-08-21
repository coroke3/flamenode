import "server-only";

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
}

function parseCount(raw: string | null): number {
  if (raw == null || raw === "") return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/** degraded D1 へ進む前にサーキット状態を確認する。 */
export async function isDegradedD1CircuitOpen(): Promise<boolean> {
  const kv = getOperationModeKv();
  if (!kv) return false;
  try {
    const open = await kv.get(degradedCircuitOpenKey());
    const now = Date.now();
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
    if ((await kv.get(degradedCircuitOpenKey())) === "1") {
      markCircuitOpen(nowMs);
      return;
    }

    markCircuitClosed(nowMs);

    const bucket = currentDegradedCircuitMinuteBucket(nowMs);
    const missKey = degradedCircuitMissKey(bucket);
    const nextCount = parseCount(await kv.get(missKey)) + 1;
    await kv.put(missKey, String(nextCount), {
      expirationTtl: DEGRADED_CIRCUIT_MISS_WINDOW_SEC * 2,
    });

    if (!shouldOpenDegradedCircuit(nextCount)) return;

    await kv.put(degradedCircuitOpenKey(), "1", {
      expirationTtl: DEGRADED_CIRCUIT_OPEN_TTL_SEC,
    });
    markCircuitOpen(nowMs);
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
  } catch {
    // Circuit bookkeeping must not take down public pages.
  }
}

/** open 中の R2 ヒット連続でサーキットを閉じる。 */
export async function recordDegradedCircuitR2Hit(): Promise<void> {
  const kv = getOperationModeKv();
  if (!kv) return;
  const now = Date.now();

  // R2 hits are the hot path.  When this isolate recently observed the
  // circuit closed, avoid one KV read per public request.  An open circuit
  // still probes after the local hit streak reaches the close threshold.
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
    localCircuitState.hitStreak = Math.max(
      hitStreak,
      1,
    );

    const streakKey = degradedCircuitHitStreakKey();
    const nextStreak = localCircuitState.hitStreak;
    if (!shouldCloseDegradedCircuit(nextStreak)) {
      return;
    }

    await kv.delete(degradedCircuitOpenKey());
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
