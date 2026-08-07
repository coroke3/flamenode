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
    return open === "1";
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
    if ((await kv.get(degradedCircuitOpenKey())) === "1") return;

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
  try {
    if ((await kv.get(degradedCircuitOpenKey())) !== "1") return;

    const streakKey = degradedCircuitHitStreakKey();
    const nextStreak = parseCount(await kv.get(streakKey)) + 1;
    if (!shouldCloseDegradedCircuit(nextStreak)) {
      await kv.put(streakKey, String(nextStreak), {
        expirationTtl: DEGRADED_CIRCUIT_OPEN_TTL_SEC,
      });
      return;
    }

    await kv.delete(degradedCircuitOpenKey());
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
  }
}
