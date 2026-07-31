/** R2 miss がこの件数/分を超えたら degraded D1 を一時停止する。 */
export const DEGRADED_CIRCUIT_MISS_THRESHOLD = 20;

export const DEGRADED_CIRCUIT_MISS_WINDOW_SEC = 60;

/** サーキット open 状態の KV TTL（秒）。 */
export const DEGRADED_CIRCUIT_OPEN_TTL_SEC = 90;

/** open 中に R2 が連続ヒットしたら自動解除する。 */
export const DEGRADED_CIRCUIT_CLOSE_HIT_STREAK = 3;

export const DEGRADED_CIRCUIT_KV_PREFIX = "public:degraded_circuit:";

export function degradedCircuitMissKey(minuteBucket: number): string {
  return `${DEGRADED_CIRCUIT_KV_PREFIX}miss:${minuteBucket}`;
}

export function degradedCircuitOpenKey(): string {
  return `${DEGRADED_CIRCUIT_KV_PREFIX}open`;
}

export function degradedCircuitHitStreakKey(): string {
  return `${DEGRADED_CIRCUIT_KV_PREFIX}hit_streak`;
}

export function currentDegradedCircuitMinuteBucket(nowMs: number): number {
  return Math.floor(nowMs / (DEGRADED_CIRCUIT_MISS_WINDOW_SEC * 1000));
}

export function shouldOpenDegradedCircuit(missCount: number): boolean {
  return missCount >= DEGRADED_CIRCUIT_MISS_THRESHOLD;
}

export function shouldCloseDegradedCircuit(hitStreak: number): boolean {
  return hitStreak >= DEGRADED_CIRCUIT_CLOSE_HIT_STREAK;
}
