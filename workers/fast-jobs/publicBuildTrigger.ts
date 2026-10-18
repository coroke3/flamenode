/**
 * FlameNode Phase 4: deploy hook build trigger check (MIG-0410).
 *
 * Implements pure decision function and bounded D1 handler to trigger
 * Cloudflare Workers Builds deploy hook when public data has been updated.
 *
 * INVARIANTS:
 * - Recipe: R-JOB / Runtime: B (< 8ms CPU). Runs as one stage of the existing hourly
 *   `flamenode-fast-jobs` Cron (`0 * * * *`); no new cron expression.
 * - Pure decision: decidePublicBuild({ requestedAt, lastHookAt, hooksDay, hooksToday, now })
 *   - "skip" if requestedAt <= lastHookAt
 *   - "skip" if now - lastHookAt < MIN_BUILD_INTERVAL_MS
 *   - "skip" if hooksDay === todayUtc && hooksToday >= MAX_DATA_BUILDS_PER_DAY
 *   - "trigger" otherwise
 * - Without PUBLIC_BUILD_DEPLOY_HOOK_URL nothing runs: zero D1 statements, no fetch.
 * - Conditional UPDATE (WHERE id = 1 AND last_hook_at = ?) lets exactly one caller fetch.
 * - D1: 1 SELECT + 1 UPDATE. Only when the hook call fails is a third, conditional
 *   UPDATE sent to restore last_hook_at, so the pending request is retried by the next
 *   Cron instead of being dropped (requested_at <= last_hook_at would skip it forever).
 * - The hook URL is a secret: it is never logged.
 * - Timestamps are epoch milliseconds; S3 writers set requested_at with Date.now().
 */

export interface BuildDecisionInput {
  requestedAt: number;
  lastHookAt: number;
  hooksDay: string;
  hooksToday: number;
  now: number;
}

export type BuildDecision = "trigger" | "skip";

// PROVISIONAL — not approved. MIG-0409 U03 (build minutes) is not measured, so these
// are placeholders, not results of the Work Order formula
//   floor((3,000 × 0.8 − code-push build minutes/month) ÷ minutes per build ÷ 30).
// The MIG-0409 STOP requires the user to approve the resulting publish delay first.
// With the hourly Cron the effective ceiling is 24 hooks/day whatever these say.
export const MAX_DATA_BUILDS_PER_DAY = 180;
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
  /** The deploy hook answered 2xx. */
  triggered: boolean;
  /** The hook call failed; last_hook_at was restored so the next Cron retries. */
  hookFailed: boolean;
  d1_changes: number;
}

type BuildStateRow = {
  requested_at: number | string;
  last_hook_at: number | string;
  hooks_day: string | null;
  hooks_today: number | string | null;
};

function changesOf(result: { meta?: { changes?: number }; changes?: number } | undefined): number {
  return result?.meta?.changes ?? result?.changes ?? 0;
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Reads the single state row, decides, claims the hook with a conditional UPDATE and
 * POSTs the deploy hook. See the invariants at the top of this file.
 */
export async function checkAndTriggerPublicBuild(
  env: PublicBuildTriggerEnv,
  options?: PublicBuildTriggerOptions,
): Promise<PublicBuildTriggerResult> {
  const skip = (d1Changes = 0): PublicBuildTriggerResult => ({
    decision: "skip",
    triggered: false,
    hookFailed: false,
    d1_changes: d1Changes,
  });
  const hookUrl = env.PUBLIC_BUILD_DEPLOY_HOOK_URL?.trim();
  // T07: an environment without a hook does nothing (no D1 read, no claim).
  if (!env.DB || !hookUrl) return skip();

  const now = options?.now ?? Date.now();
  const fetchFn = options?.fetchFn ?? fetch;
  options?.signal?.throwIfAborted();

  // Statement 1: the single state row.
  const state = await env.DB.prepare(
    `SELECT requested_at, last_hook_at, hooks_day, hooks_today FROM public_build_state WHERE id = 1 LIMIT 1`,
  )
    .bind()
    .first<BuildStateRow>();
  if (!state) return skip();

  const requestedAt = Number(state.requested_at ?? 0);
  const lastHookAt = Number(state.last_hook_at ?? 0);
  const hooksDay = String(state.hooks_day ?? "");
  const hooksToday = Number(state.hooks_today ?? 0);
  const decision = decidePublicBuild({ requestedAt, lastHookAt, hooksDay, hooksToday, now });
  if (decision === "skip") return skip();

  options?.signal?.throwIfAborted();
  const todayUtc = utcDay(now);
  // T05: a new UTC day starts counting again. A failed call still counts, so retries
  // can never exceed the daily cap.
  const newHooksToday = hooksDay === todayUtc ? hooksToday + 1 : 1;

  // Statement 2: claim (T06). Only the caller whose UPDATE changed the row fetches.
  const claimed = changesOf(
    await env.DB.prepare(
      `UPDATE public_build_state
       SET last_hook_at = ?, hooks_day = ?, hooks_today = ?
       WHERE id = 1 AND last_hook_at = ?`,
    )
      .bind(now, todayUtc, newHooksToday, lastHookAt)
      .run(),
  );
  if (claimed !== 1) return skip();

  let failure: unknown;
  let status = 0;
  try {
    const response = await fetchFn(hookUrl, { method: "POST", signal: options?.signal });
    status = response.status;
    if (response.ok) {
      return { decision: "trigger", triggered: true, hookFailed: false, d1_changes: 1 };
    }
  } catch (error) {
    failure = error;
  }

  // Statement 3 (failure only): give the claim back so requested_at > last_hook_at again.
  let restored = 0;
  try {
    restored = changesOf(
      await env.DB.prepare(
        `UPDATE public_build_state SET last_hook_at = ? WHERE id = 1 AND last_hook_at = ?`,
      )
        .bind(lastHookAt, now)
        .run(),
    );
  } catch {
    // The next change to public data raises requested_at again; nothing else to do here.
  }
  // Never log the URL or the error object (it may carry the URL).
  console.warn(
    `[publicBuildTrigger] deploy hook failed (status=${status || "network"}, restored=${restored})`,
  );
  if (failure && options?.signal?.aborted) throw failure;
  return { decision: "trigger", triggered: false, hookFailed: true, d1_changes: 1 + restored };
}
