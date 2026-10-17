/**
 * FlameNode Phase 4: deploy hook build trigger check (MIG-0410).
 *
 * Implements pure decision function and bounded D1 handler to trigger
 * Cloudflare Workers Builds deploy hook when public data has been updated.
 *
 * INVARIANTS:
 * - Recipe: R-JOB / Runtime: B (< 8ms CPU)
 * - Free Tier budget derivation (from MIG-0409 BUILD_TIME_DATA.md):
 *   MAX_DATA_BUILDS_PER_DAY = 180 (2,400 available min/mo / (0.35 min/build * 30 days) * 0.8 margin)
 *   MIN_BUILD_INTERVAL_MS = 480_000 (8 minutes debounce between deploy hooks: 24h * 60m / 180 = 8 min)
 * - Pure decision: decidePublicBuild({ requestedAt, lastHookAt, hooksDay, hooksToday, now })
 *   - "skip" if requestedAt <= lastHookAt
 *   - "skip" if now - lastHookAt < MIN_BUILD_INTERVAL_MS
 *   - "skip" if hooksDay === todayUtc && hooksToday >= MAX_DATA_BUILDS_PER_DAY
 *   - "trigger" otherwise
 * - Conditional UPDATE on public_build_state (WHERE id = 1 AND last_hook_at = ?) ensures only 1 caller triggers fetch
 * - Never throws or fails if deploy hook URL is not configured
 * - At most 2 D1 statements (1 SELECT, 1 UPDATE)
 */

export interface BuildDecisionInput {
  requestedAt: number;
  lastHookAt: number;
  hooksDay: string;
  hooksToday: number;
  now: number;
}

export type BuildDecision = "trigger" | "skip";

// MAX_DATA_BUILDS_PER_DAY = 180 (budget: 2,400 available min/mo / (0.35 min/build * 30 days) * 0.8 margin)
export const MAX_DATA_BUILDS_PER_DAY = 180;

// MIN_BUILD_INTERVAL_MS = 480_000 (8 minutes debounce between deploy hooks: 24h * 60m / 180 = 8 min)
export const MIN_BUILD_INTERVAL_MS = 480_000;

/**
 * Pure decision function evaluating if a public site rebuild hook should be triggered.
 */
export function decidePublicBuild(input: BuildDecisionInput): BuildDecision {
  const { requestedAt, lastHookAt, hooksDay, hooksToday, now } = input;

  // T01: 前回の hook の後に変更なし
  if (requestedAt <= lastHookAt) {
    return "skip";
  }

  // T02: 変更あり、前回から MIN_BUILD_INTERVAL_MS 未満
  if (now - lastHookAt < MIN_BUILD_INTERVAL_MS) {
    return "skip";
  }

  const todayUtc = new Date(now).toISOString().slice(0, 10);

  // T04: 同じ日に MAX_DATA_BUILDS_PER_DAY 回呼んだ後
  if (hooksDay === todayUtc && hooksToday >= MAX_DATA_BUILDS_PER_DAY) {
    return "skip";
  }

  // T03 / T05: 変更あり、間隔を満たし、日次上限内
  return "trigger";
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): {
    first<T = Record<string, unknown>>(): Promise<T | null>;
    run(): Promise<{ meta?: { changes?: number }; changes?: number }>;
  };
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

export interface PublicBuildTriggerEnv {
  DB?: D1DatabaseLike;
  PUBLIC_BUILD_DEPLOY_HOOK_URL?: string;
}

export interface PublicBuildTriggerOptions {
  now?: number;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

export interface PublicBuildTriggerResult {
  decision: BuildDecision;
  triggered: boolean;
  d1_changes: number;
}

/**
 * Handler reading state from D1, deciding whether to trigger, atomically updating state,
 * and dispatching POST request to deploy hook URL.
 *
 * Uses at most 2 D1 statements (1 SELECT, 1 UPDATE).
 */
export async function checkAndTriggerPublicBuild(
  env: PublicBuildTriggerEnv,
  options?: PublicBuildTriggerOptions,
): Promise<PublicBuildTriggerResult> {
  const now = options?.now ?? Date.now();
  const fetchFn = options?.fetchFn ?? fetch;

  if (!env.DB) {
    return { decision: "skip", triggered: false, d1_changes: 0 };
  }

  options?.signal?.throwIfAborted();

  // Statement 1: Read state from single-row table
  const state = await env.DB.prepare(
    `SELECT requested_at, last_hook_at, hooks_day, hooks_today FROM public_build_state WHERE id = 1 LIMIT 1`,
  )
    .bind()
    .first<{
      requested_at: number | string;
      last_hook_at: number | string;
      hooks_day: string | null;
      hooks_today: number | string | null;
    }>();

  if (!state) {
    return { decision: "skip", triggered: false, d1_changes: 0 };
  }

  const requestedAt = Number(state.requested_at ?? 0);
  const lastHookAt = Number(state.last_hook_at ?? 0);
  const hooksDay = String(state.hooks_day ?? "");
  const hooksToday = Number(state.hooks_today ?? 0);

  const decision = decidePublicBuild({
    requestedAt,
    lastHookAt,
    hooksDay,
    hooksToday,
    now,
  });

  if (decision === "skip") {
    return { decision: "skip", triggered: false, d1_changes: 0 };
  }

  options?.signal?.throwIfAborted();

  const todayUtc = new Date(now).toISOString().slice(0, 10);
  // T05: UTCの日付が変わった場合は回数を1から数え直す
  const newHooksToday = hooksDay === todayUtc ? hooksToday + 1 : 1;

  // Statement 2: Conditional UPDATE where last_hook_at = ? ensures concurrency safety (T06)
  const updateResult = await env.DB.prepare(
    `UPDATE public_build_state 
     SET last_hook_at = ?, hooks_day = ?, hooks_today = ? 
     WHERE id = 1 AND last_hook_at = ?`,
  )
    .bind(now, todayUtc, newHooksToday, lastHookAt)
    .run();

  const changes =
    updateResult?.meta?.changes ??
    (updateResult as { changes?: number })?.changes ??
    0;

  if (changes !== 1) {
    // Concurrent invocation already claimed this trigger
    return { decision: "trigger", triggered: false, d1_changes: 0 };
  }

  // T07: Hook URL が未設定なら何もしない
  if (!env.PUBLIC_BUILD_DEPLOY_HOOK_URL) {
    return { decision: "trigger", triggered: false, d1_changes: 1 };
  }

  try {
    const res = await fetchFn(env.PUBLIC_BUILD_DEPLOY_HOOK_URL, {
      method: "POST",
      signal: options?.signal,
    });
    if (!res.ok) {
      console.warn(`[publicBuildTrigger] deploy hook returned status ${res.status}`);
    }
  } catch (err) {
    if (options?.signal?.aborted) throw err;
    console.error(`[publicBuildTrigger] deploy hook fetch error:`, err);
  }

  return { decision: "trigger", triggered: true, d1_changes: 1 };
}
