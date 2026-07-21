import {
  YOUTUBE_PROVIDER_KEY,
  youtubeDailyBudgetUnits,
  youtubeQuotaDay,
} from "../../src/lib/youtube/quotaPolicy.ts";

export interface YoutubeQuotaEnv {
  DB: D1Database;
  YOUTUBE_DAILY_QUOTA_LIMIT?: string;
}

export type YoutubeQuotaReservation = {
  quotaDay: string;
  reservedUnits: number;
  usedUnits: number;
  dailyBudgetUnits: number;
  d1Changes: number;
};

export type YoutubeQuotaSnapshot = {
  quotaDay: string;
  usedUnits: number;
  remainingUnits: number;
  dailyBudgetUnits: number;
};

function positiveInteger(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

/**
 * FlameNode内のYouTube quotaを1日80%までに制限する。
 * INSERT/UPSERTのWHEREで、複数invocationからの予約も上限超過させない。
 */
export async function reserveYoutubeQuota(
  env: YoutubeQuotaEnv,
  requestedUnits: number,
  nowSec: number,
  signal?: AbortSignal,
): Promise<YoutubeQuotaReservation | null> {
  signal?.throwIfAborted();
  const requested = positiveInteger(requestedUnits);
  const dailyBudgetUnits = youtubeDailyBudgetUnits(env.YOUTUBE_DAILY_QUOTA_LIMIT);
  if (requested <= 0 || requested > dailyBudgetUnits) return null;

  const quotaDay = youtubeQuotaDay(new Date(nowSec * 1_000));
  const result = await env.DB.prepare(
    `INSERT INTO external_api_quota_usage (
       provider, quota_day, used_units, limit_units, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(provider, quota_day) DO UPDATE SET
       used_units = external_api_quota_usage.used_units + excluded.used_units,
       limit_units = excluded.limit_units,
       updated_at = excluded.updated_at
     WHERE external_api_quota_usage.used_units + excluded.used_units <= excluded.limit_units
     RETURNING used_units`,
  )
    .bind(YOUTUBE_PROVIDER_KEY, quotaDay, requested, dailyBudgetUnits, nowSec)
    .all<{ used_units: number }>();
  signal?.throwIfAborted();

  const row = result.results?.[0];
  if (!row) return null;
  return {
    quotaDay,
    reservedUnits: requested,
    usedUnits: Number(row.used_units ?? 0),
    dailyBudgetUnits,
    d1Changes: Math.max(0, Number(result.meta?.changes ?? 0)),
  };
}

/** 予約したが実際には外部fetchを行わなかったunitsだけを返却する。 */
export async function refundYoutubeQuota(
  env: YoutubeQuotaEnv,
  reservation: YoutubeQuotaReservation,
  unusedUnits: number,
  nowSec: number,
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  const unused = Math.min(
    reservation.reservedUnits,
    positiveInteger(unusedUnits),
  );
  if (unused <= 0) return 0;

  const result = await env.DB.prepare(
    `UPDATE external_api_quota_usage
        SET used_units = MAX(0, used_units - ?3),
            updated_at = ?4
      WHERE provider = ?1
        AND quota_day = ?2`,
  )
    .bind(YOUTUBE_PROVIDER_KEY, reservation.quotaDay, unused, nowSec)
    .run();
  signal?.throwIfAborted();
  return Math.max(0, Number(result.meta?.changes ?? 0));
}

export async function loadYoutubeQuotaSnapshot(
  env: YoutubeQuotaEnv,
  nowSec: number,
  signal?: AbortSignal,
): Promise<YoutubeQuotaSnapshot> {
  signal?.throwIfAborted();
  const quotaDay = youtubeQuotaDay(new Date(nowSec * 1_000));
  const dailyBudgetUnits = youtubeDailyBudgetUnits(env.YOUTUBE_DAILY_QUOTA_LIMIT);
  const row = await env.DB.prepare(
    `SELECT used_units
       FROM external_api_quota_usage
      WHERE provider = ?1
        AND quota_day = ?2
      LIMIT 1`,
  )
    .bind(YOUTUBE_PROVIDER_KEY, quotaDay)
    .first<{ used_units: number }>();
  signal?.throwIfAborted();
  const usedUnits = Math.max(0, Number(row?.used_units ?? 0));
  return {
    quotaDay,
    usedUnits,
    remainingUnits: Math.max(0, dailyBudgetUnits - usedUnits),
    dailyBudgetUnits,
  };
}
