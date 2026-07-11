/**
 * D1 を正本にした Cron lease。
 * `worker_leases(job_name PRIMARY KEY, lease_token, lease_expires_at, updated_at)` を前提にする。
 * KV は整合性のある compare-and-set を提供しないため lease には使わない。
 */

export interface CronLeaseEnv {
  DB: D1Database;
}

export interface CronLease {
  jobName: string;
  token: string;
}

export interface CronLeaseOptions {
  jobName: string;
  leaseSeconds: number;
  now?: number;
}

/** A bad configuration must not leave a lease held indefinitely. */
export const MAX_CRON_LEASE_SECONDS = 24 * 60 * 60;

function boundedLeaseSeconds(value: number): number {
  if (!Number.isFinite(value)) return MAX_CRON_LEASE_SECONDS;
  return Math.min(MAX_CRON_LEASE_SECONDS, Math.max(1, Math.floor(value)));
}

export async function acquireCronLease(
  env: CronLeaseEnv,
  options: CronLeaseOptions,
): Promise<CronLease | null> {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const leaseSeconds = boundedLeaseSeconds(options.leaseSeconds);
  const token = crypto.randomUUID();
  const leaseExpiresAt = now + leaseSeconds;
  const result = await env.DB.prepare(
    `INSERT INTO worker_leases (job_name, lease_token, lease_expires_at, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(job_name) DO UPDATE SET
       lease_token = excluded.lease_token,
       lease_expires_at = excluded.lease_expires_at,
       updated_at = excluded.updated_at
     WHERE worker_leases.lease_expires_at <= ?4`,
  )
    .bind(options.jobName, token, leaseExpiresAt, now)
    .run();

  if ((result.meta?.changes ?? 0) === 0) return null;
  return { jobName: options.jobName, token };
}

export async function releaseCronLease(
  env: CronLeaseEnv,
  lease: CronLease,
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM worker_leases
     WHERE job_name = ?1 AND lease_token = ?2`,
  )
    .bind(lease.jobName, lease.token)
    .run();
}

export async function withCronLease<T>(
  env: CronLeaseEnv,
  options: CronLeaseOptions,
  task: () => Promise<T>,
): Promise<{ acquired: boolean; value?: T }> {
  const lease = await acquireCronLease(env, options);
  if (!lease) return { acquired: false };
  try {
    return { acquired: true, value: await task() };
  } finally {
    await releaseCronLease(env, lease);
  }
}
