import { safeErrorSummary } from "./safeLog.ts";

/**
 * D1 を正本にした Cron lease。
 * `worker_leases` は排他制御と最終実行状態を同じ行で保持する。
 * KV は整合性のある compare-and-set を提供しないため lease / 実行間隔判定には使わない。
 */

export interface CronLeaseEnv {
  DB: D1Database;
}

export interface CronLease {
  jobName: string;
  token: string;
  leaseSeconds: number;
}

export interface CronLeaseOptions {
  jobName: string;
  leaseSeconds: number;
  /** 最終成功からこの秒数が経過するまで再取得しない。 */
  minimumIntervalSeconds?: number;
  /** 未指定時は leaseSeconds / 3。0 を指定すると heartbeat 無効。 */
  heartbeatSeconds?: number;
  now?: number;
}

/** A bad configuration must not leave a lease held indefinitely. */
export const MAX_CRON_LEASE_SECONDS = 24 * 60 * 60;

function boundedLeaseSeconds(value: number): number {
  if (!Number.isFinite(value)) return MAX_CRON_LEASE_SECONDS;
  return Math.min(
    MAX_CRON_LEASE_SECONDS,
    Math.max(1, Math.floor(value)),
  );
}

function boundedIntervalSeconds(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value ?? 0));
}

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

export async function acquireCronLease(
  env: CronLeaseEnv,
  options: CronLeaseOptions,
): Promise<CronLease | null> {
  const now = options.now ?? unixNow();
  const leaseSeconds = boundedLeaseSeconds(options.leaseSeconds);
  const minimumIntervalSeconds = boundedIntervalSeconds(
    options.minimumIntervalSeconds,
  );
  const token = crypto.randomUUID();
  const leaseExpiresAt = now + leaseSeconds;
  const result = await env.DB.prepare(
    `INSERT INTO worker_leases (
       job_name, lease_token, lease_expires_at, updated_at,
       last_started_at, last_error_code
     )
     VALUES (?1, ?2, ?3, ?4, ?4, NULL)
     ON CONFLICT(job_name) DO UPDATE SET
       lease_token = excluded.lease_token,
       lease_expires_at = excluded.lease_expires_at,
       updated_at = excluded.updated_at,
       last_started_at = excluded.last_started_at,
       last_error_code = NULL
     WHERE worker_leases.lease_expires_at <= ?4
       AND (
         ?5 <= 0
         OR worker_leases.last_succeeded_at IS NULL
         OR worker_leases.last_succeeded_at <= ?4 - ?5
       )`,
  )
    .bind(
      options.jobName,
      token,
      leaseExpiresAt,
      now,
      minimumIntervalSeconds,
    )
    .run();

  if ((result.meta?.changes ?? 0) === 0) return null;
  return { jobName: options.jobName, token, leaseSeconds };
}

export async function renewCronLease(
  env: CronLeaseEnv,
  lease: CronLease,
  now = unixNow(),
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE worker_leases
     SET lease_expires_at = ?1, updated_at = ?2
     WHERE job_name = ?3
       AND lease_token = ?4
       AND lease_expires_at > ?2`,
  )
    .bind(now + lease.leaseSeconds, now, lease.jobName, lease.token)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

async function markCronLeaseSucceeded(
  env: CronLeaseEnv,
  lease: CronLease,
  now = unixNow(),
): Promise<void> {
  await env.DB.prepare(
    `UPDATE worker_leases
     SET last_succeeded_at = ?1,
         last_error_code = NULL,
         updated_at = ?1
     WHERE job_name = ?2 AND lease_token = ?3`,
  )
    .bind(now, lease.jobName, lease.token)
    .run();
}

async function markCronLeaseFailed(
  env: CronLeaseEnv,
  lease: CronLease,
  error: unknown,
  now = unixNow(),
): Promise<void> {
  await env.DB.prepare(
    `UPDATE worker_leases
     SET last_failed_at = ?1,
         last_error_code = ?2,
         updated_at = ?1
     WHERE job_name = ?3 AND lease_token = ?4`,
  )
    .bind(
      now,
      safeErrorSummary(error).slice(0, 160),
      lease.jobName,
      lease.token,
    )
    .run();
}

/**
 * 行は削除せず、lease 部分だけ解放する。last_* を次回の実行間隔判定と管理画面表示に残す。
 */
export async function releaseCronLease(
  env: CronLeaseEnv,
  lease: CronLease,
  now = unixNow(),
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE worker_leases
     SET lease_token = '', lease_expires_at = 0, updated_at = ?1
     WHERE job_name = ?2 AND lease_token = ?3`,
  )
    .bind(now, lease.jobName, lease.token)
    .run();
  return (result.meta?.changes ?? 0) === 1;
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done(): void {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

async function runHeartbeat(
  env: CronLeaseEnv,
  lease: CronLease,
  heartbeatSeconds: number,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    await abortableDelay(heartbeatSeconds * 1000, signal);
    if (signal.aborted) return;
    if (!(await renewCronLease(env, lease))) {
      throw new Error(`cron lease lost: ${lease.jobName}`);
    }
  }
}

type PromiseOutcome =
  | { succeeded: true }
  | { succeeded: false; error: unknown };

/** rejection handlerを即時登録し、task実行中の未処理Promiseを防ぐ。 */
function observePromise(promise: Promise<void>): Promise<PromiseOutcome> {
  return promise.then<PromiseOutcome>(
    () => ({ succeeded: true }),
    (error: unknown) => ({ succeeded: false, error }),
  );
}

async function assertPromiseSucceeded(
  outcomePromise: Promise<PromiseOutcome>,
): Promise<void> {
  const outcome = await outcomePromise;
  if (!outcome.succeeded) throw outcome.error;
}

export async function withCronLease<T>(
  env: CronLeaseEnv,
  options: CronLeaseOptions,
  task: () => Promise<T>,
): Promise<{ acquired: boolean; value?: T }> {
  const lease = await acquireCronLease(env, options);
  if (!lease) return { acquired: false };

  const requestedHeartbeat = options.heartbeatSeconds;
  const heartbeatSeconds =
    requestedHeartbeat === 0
      ? 0
      : Math.max(
          1,
          Math.min(
            Math.max(1, lease.leaseSeconds - 1),
            Math.floor(requestedHeartbeat ?? lease.leaseSeconds / 3),
          ),
        );
  const heartbeatController = new AbortController();
  const heartbeat =
    heartbeatSeconds > 0
      ? runHeartbeat(
          env,
          lease,
          heartbeatSeconds,
          heartbeatController.signal,
        )
      : Promise.resolve();
  const heartbeatOutcome = observePromise(heartbeat);

  try {
    const value = await task();
    heartbeatController.abort();
    // task 中に lease を失っていた場合はここで失敗として伝播する。
    await assertPromiseSucceeded(heartbeatOutcome);
    await markCronLeaseSucceeded(env, lease);
    return { acquired: true, value };
  } catch (error) {
    heartbeatController.abort();
    await heartbeatOutcome;
    await markCronLeaseFailed(env, lease, error).catch((markError) => {
      console.error(
        JSON.stringify({
          worker: "cron-lease",
          job: lease.jobName,
          result: "failed",
          error: `failed to record job failure: ${safeErrorSummary(markError)}`,
        }),
      );
    });
    throw error;
  } finally {
    heartbeatController.abort();
    await heartbeatOutcome;
    try {
      await releaseCronLease(env, lease);
    } catch (releaseError) {
      // 本体処理完了後の解放失敗でジョブを再実行させない。lease は期限切れで回復する。
      console.error(
        JSON.stringify({
          worker: "cron-lease",
          job: lease.jobName,
          result: "failed",
          error: `lease release failed: ${safeErrorSummary(releaseError)}`,
        }),
      );
    }
  }
}
