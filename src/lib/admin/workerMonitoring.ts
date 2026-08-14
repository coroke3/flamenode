import "server-only";

import { QUEUE_WAKE_KINDS, type QueueWakeKind } from "@/lib/queues/wakeBudget";

export type MonitorLevel = "ok" | "warn" | "critical" | "unknown" | "running";

type LeaseRow = {
  job_name: string;
  lease_token: string | null;
  lease_expires_at: number | null;
  last_started_at: number | null;
  last_succeeded_at: number | null;
  last_failed_at: number | null;
  last_error_code: string | null;
};

type CountValue = number | string | null | undefined;

type QueueRow = {
  pending?: CountValue;
  processing?: CountValue;
  failed?: CountValue;
  dead_letter?: CountValue;
  stuck?: CountValue;
  oldest_pending_at?: CountValue;
};

type SyncRow = {
  eligible?: CountValue;
  pending?: CountValue;
  stale?: CountValue;
  failed?: CountValue;
  oldest_synced_at?: CountValue;
};

type ScoreRow = {
  eligible?: CountValue;
  stale?: CountValue;
  oldest_updated_at?: CountValue;
};

type ArtifactRow = { target_type: string; generated_at: CountValue };

export type WorkerJobStatus = {
  jobName: string;
  label: string;
  cadenceSeconds: number;
  detailHref: string;
  level: MonitorLevel;
  message: string;
  leaseExpiresAt: number | null;
  lastStartedAt: number | null;
  lastSucceededAt: number | null;
  lastFailedAt: number | null;
  lastErrorCode: string | null;
  nextExpectedAt: number | null;
};

export type PipelineSnapshot = {
  id: "notifications" | "static" | "youtube" | "scores";
  label: string;
  level: MonitorLevel;
  backlog: number;
  capacityPerDay: number;
  estimatedDrainMinutes: number;
  note: string;
  detailHref: string;
};

export type QueueWakeFailureRecord = {
  at: number;
  reason: string;
};

export type QueueWakeFailures = Record<QueueWakeKind, QueueWakeFailureRecord | null>;

export type QueueSnapshot = {
  pending: number;
  processing: number;
  failed: number;
  deadLetter: number;
  stuck: number;
  oldestPendingAt: number | null;
};

export type WorkerMonitoringSnapshot = {
  generatedAt: number;
  operationMode: string;
  overallLevel: Exclude<MonitorLevel, "running">;
  overallMessage: string;
  jobs: WorkerJobStatus[];
  notifications: QueueSnapshot;
  staticRebuilds: QueueSnapshot;
  youtube: {
    eligible: number;
    pending: number;
    stale: number;
    failed: number;
    oldestSyncedAt: number | null;
  };
  scores: { eligible: number; stale: number; oldestUpdatedAt: number | null };
  artifacts: { targetType: string; generatedAt: number | null }[];
  pipelines: PipelineSnapshot[];
  /** KV 未接続・読取失敗時は null */
  queueWakeFailures: QueueWakeFailures | null;
};

type JobDefinition = {
  jobName: string;
  label: string;
  cadenceSeconds: number;
  warnAfterSeconds: number;
  criticalAfterSeconds: number;
  detailHref: string;
};

const JOBS: readonly JobDefinition[] = [
  // Recovery Cron は毎時。Queue 本線があるため warn/critical は緩める。
  { jobName: "fast-jobs", label: "通知・リマインダー", cadenceSeconds: 3600, warnAfterSeconds: 7800, criticalAfterSeconds: 14400, detailHref: "/admin/notifications" },
  { jobName: "content-jobs", label: "静的JSON・クリーンアップ", cadenceSeconds: 3600, warnAfterSeconds: 7800, criticalAfterSeconds: 14400, detailHref: "/admin/static-builds" },
  { jobName: "sync-jobs", label: "YouTube同期・スコア更新", cadenceSeconds: 3600, warnAfterSeconds: 7800, criticalAfterSeconds: 14400, detailHref: "/admin/youtube-sync" },
  { jobName: "fast-jobs:slot-deadline-reminders", label: "締切リマインダー生成", cadenceSeconds: 3600, warnAfterSeconds: 7200, criticalAfterSeconds: 10800, detailHref: "/admin/notifications" },
  { jobName: "content-jobs:cleanup", label: "期限切れデータ整理", cadenceSeconds: 86400, warnAfterSeconds: 172800, criticalAfterSeconds: 259200, detailHref: "/admin/static-builds" },
] as const;

/** score-recalc の SCORE_FORCE_REFRESH_SEC（72h）と揃える。 */
const SCORE_STALE_THRESHOLD_SEC = 72 * 60 * 60;

const QUEUE_WAKE_LAST_FAILURE_KV_KEYS = Object.freeze(
  Object.fromEntries(
    QUEUE_WAKE_KINDS.map((kind) => [
      kind,
      `queue_wake:last_failure:${kind}`,
    ]),
  ) as Record<QueueWakeKind, string>,
);

export const PLATFORM_LIMITS = [
  { label: "Workers CPU", value: "10ms / invocation" },
  { label: "Worker subrequests", value: "50 / invocation" },
  { label: "D1 queries", value: "50 / invocation" },
  { label: "D1 rows read", value: "5,000,000 / day" },
  { label: "D1 rows written", value: "100,000 / day" },
  { label: "D1 database size", value: "500MB / database" },
  { label: "YouTube Data API", value: "10,000 units / day" },
] as const;

function numberValue(value: CountValue): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: CountValue): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function queueSnapshot(row: QueueRow | null): QueueSnapshot {
  return {
    pending: numberValue(row?.pending),
    processing: numberValue(row?.processing),
    failed: numberValue(row?.failed),
    deadLetter: numberValue(row?.dead_letter),
    stuck: numberValue(row?.stuck),
    oldestPendingAt: nullableNumber(row?.oldest_pending_at),
  };
}

function parseQueueWakeFailureRecord(value: unknown): QueueWakeFailureRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { at?: unknown; reason?: unknown };
  const at = Number(record.at);
  if (!Number.isFinite(at) || at <= 0) return null;
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";
  if (!reason) return null;
  return { at: Math.floor(at), reason };
}

export async function loadQueueWakeFailures(
  kv: KVNamespace | null | undefined,
): Promise<QueueWakeFailures | null> {
  if (!kv) return null;
  try {
    const entries = await Promise.all(
      QUEUE_WAKE_KINDS.map(async (kind) => {
        const raw = await kv.get(QUEUE_WAKE_LAST_FAILURE_KV_KEYS[kind], "json");
        return [kind, parseQueueWakeFailureRecord(raw)] as const;
      }),
    );
    return Object.fromEntries(entries) as QueueWakeFailures;
  } catch {
    return null;
  }
}

function drainMinutes(backlog: number, batch: number, cadence: number): number {
  return backlog <= 0 ? 0 : Math.ceil(backlog / batch) * cadence;
}

function jobStatus(definition: JobDefinition, row: LeaseRow | undefined, now: number): WorkerJobStatus {
  const success = nullableNumber(row?.last_succeeded_at);
  const failure = nullableNumber(row?.last_failed_at);
  const running = Boolean(row?.lease_token && numberValue(row.lease_expires_at) > now);
  const latestFailed = failure != null && (success == null || failure > success);
  let level: MonitorLevel = "ok";
  let message = "想定間隔内に成功しています。";

  if (running) {
    level = "running";
    message = "実行中です。";
  } else if (latestFailed) {
    level = "critical";
    message = "直近の実行が失敗しています。";
  } else if (success == null) {
    level = "unknown";
    message = "成功履歴がありません。初回Cronまたはデプロイ状態を確認してください。";
  } else if (now - success > definition.criticalAfterSeconds) {
    level = "critical";
    message = "想定間隔を大きく超えて成功していません。";
  } else if (now - success > definition.warnAfterSeconds) {
    level = "warn";
    message = "想定間隔を超えています。次回Cronを確認してください。";
  }

  return {
    ...definition,
    level,
    message,
    leaseExpiresAt: nullableNumber(row?.lease_expires_at),
    lastStartedAt: nullableNumber(row?.last_started_at),
    lastSucceededAt: success,
    lastFailedAt: failure,
    lastErrorCode: row?.last_error_code ?? null,
    nextExpectedAt: success == null ? null : success + definition.cadenceSeconds,
  };
}

function pipelineLevel(
  backlog: number,
  drain: number,
  warn: number,
  critical: number,
  failed = 0,
  stuck = 0,
  deadLetter = 0,
): MonitorLevel {
  if (failed > 0 || stuck > 0 || deadLetter > 0 || drain > critical) return "critical";
  if (backlog > 0 && drain > warn) return "warn";
  return "ok";
}

export async function loadWorkerMonitoring(
  db: D1Database,
  options?: {
    now?: number;
    kv?: KVNamespace | null;
  },
): Promise<WorkerMonitoringSnapshot> {
  const now = options?.now ?? Math.floor(Date.now() / 1000);
  const leaseRows = await db.prepare(
    `SELECT job_name, lease_token, lease_expires_at, last_started_at,
            last_succeeded_at, last_failed_at, last_error_code
       FROM worker_leases
      WHERE job_name IN (${JOBS.map(() => "?").join(",")})`,
  ).bind(...JOBS.map((job) => job.jobName)).all<LeaseRow>();

  const settings = await db.prepare(
    `SELECT operation_mode FROM system_settings WHERE id = 'default' LIMIT 1`,
  ).first<{ operation_mode?: string }>();

  const notificationRow = await db.prepare(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) AS dead_letter,
       SUM(CASE WHEN status = 'processing' AND (processing_started_at IS NULL OR processing_started_at <= ?1) THEN 1 ELSE 0 END) AS stuck,
       MIN(CASE WHEN status = 'pending' THEN created_at END) AS oldest_pending_at
     FROM notification_outbox
     WHERE status IN ('pending', 'processing', 'failed', 'dead_letter')`,
  ).bind(now - 900).first<QueueRow>();

  const staticRow = await db.prepare(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'dead_letter' THEN 1 ELSE 0 END) AS dead_letter,
       SUM(CASE WHEN status = 'processing' AND (lease_expires_at IS NULL OR lease_expires_at <= ?1) THEN 1 ELSE 0 END) AS stuck,
       MIN(CASE WHEN status = 'pending' THEN created_at END) AS oldest_pending_at
     FROM static_rebuild_queue
     WHERE status IN ('pending', 'processing', 'failed', 'dead_letter')`,
  ).bind(now).first<QueueRow>();

  const youtubeRow = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM videos v WHERE v.youtube_video_id IS NOT NULL AND v.youtube_video_id <> '' AND v.visibility_status <> 'voided') AS eligible,
       (SELECT COUNT(*) FROM video_youtube_metadata WHERE sync_status = 'pending') AS pending,
       (SELECT COUNT(*)
          FROM video_youtube_metadata ym
          INNER JOIN videos v ON v.id = ym.video_id
         WHERE v.youtube_video_id IS NOT NULL
           AND v.youtube_video_id <> ''
           AND v.visibility_status <> 'voided'
           AND (
             ym.sync_status = 'pending'
             OR (
               ym.sync_status IN ('synced', 'failed')
               AND ym.synced_at IS NOT NULL
               AND (
                 -- The default lane already covers rows older than a day.
                 -- Keep the active-event EXISTS check only for the 1h..24h band
                 -- so the same metadata row is not scanned twice.
                 ym.synced_at <= ?1 - 86400
                 OR (
                   ym.synced_at > ?1 - 86400
                   AND ym.synced_at <= ?1 - 3600
                   AND (
                     EXISTS (
                       SELECT 1
                         FROM events e
                        WHERE e.id = v.primary_event_id
                          AND e.visibility_status = 'public'
                          AND (e.start_time IS NOT NULL OR e.end_time IS NOT NULL)
                          AND (e.start_time IS NULL OR e.start_time <= ?1 + 86400)
                          AND (e.end_time IS NULL OR e.end_time >= ?1 - 86400)
                     )
                     OR EXISTS (
                       SELECT 1
                         FROM video_events ve
                         INNER JOIN events e ON e.id = ve.event_id
                        WHERE ve.video_id = v.id
                          AND e.visibility_status = 'public'
                          AND (e.start_time IS NOT NULL OR e.end_time IS NOT NULL)
                          AND (e.start_time IS NULL OR e.start_time <= ?1 + 86400)
                          AND (e.end_time IS NULL OR e.end_time >= ?1 - 86400)
                     )
                   )
                 )
               )
             )
           )) AS stale,
       (SELECT COUNT(*) FROM video_youtube_metadata WHERE sync_status = 'failed') AS failed,
       (SELECT MIN(synced_at) FROM video_youtube_metadata) AS oldest_synced_at`,
  ).bind(now).first<SyncRow>();

  const scoreRow = await db.prepare(
    `SELECT COUNT(*) AS eligible,
       SUM(CASE WHEN v.score_updated_at IS NULL
         OR v.score_updated_at < v.updated_at
         OR v.score_updated_at < COALESCE(ym.updated_at, 0)
         OR v.score_updated_at <= ?1 - ?2 THEN 1 ELSE 0 END) AS stale,
       MIN(v.score_updated_at) AS oldest_updated_at
     FROM videos v
     LEFT JOIN video_youtube_metadata ym ON ym.video_id = v.id
     WHERE v.visibility_status = 'public'`,
  ).bind(now, SCORE_STALE_THRESHOLD_SEC).first<ScoreRow>();

  const artifactRows = await db.prepare(
    `SELECT target_type, MAX(generated_at) AS generated_at
       FROM static_artifacts
      WHERE target_id = 'global' AND deleted_at IS NULL
        AND target_type IN ('top', 'list_recent', 'list_popular', 'events_index', 'search_index')
      GROUP BY target_type ORDER BY target_type`,
  ).all<ArtifactRow>();

  const leases = new Map((leaseRows.results ?? []).map((row) => [row.job_name, row]));
  const jobs = JOBS.map((job) => jobStatus(job, leases.get(job.jobName), now));
  const notifications = queueSnapshot(notificationRow);
  const staticRebuilds = queueSnapshot(staticRow);
  const youtube = {
    eligible: numberValue(youtubeRow?.eligible),
    pending: numberValue(youtubeRow?.pending),
    stale: numberValue(youtubeRow?.stale),
    failed: numberValue(youtubeRow?.failed),
    oldestSyncedAt: nullableNumber(youtubeRow?.oldest_synced_at),
  };
  const scores = {
    eligible: numberValue(scoreRow?.eligible),
    stale: numberValue(scoreRow?.stale),
    oldestUpdatedAt: nullableNumber(scoreRow?.oldest_updated_at),
  };

  // Queue wake 有効時は秒単位起動が本線。Recovery Cron は1時間なので下限の目安にも使う。
  const notificationDrain = drainMinutes(notifications.pending, 6, 1);
  const staticDrain = drainMinutes(staticRebuilds.pending, 1, 1);
  const youtubeDrain = drainMinutes(youtube.stale, 50, 60);
  const scoreDrain = drainMinutes(scores.stale, 150, 60);
  const youtubeFailureCritical = Math.max(10, Math.ceil(youtube.eligible * 0.1));
  const queueWakeFailures = await loadQueueWakeFailures(options?.kv);
  const pipelines: PipelineSnapshot[] = [
    {
      id: "notifications",
      label: "通知配信",
      level: pipelineLevel(
        notifications.pending,
        notificationDrain,
        30,
        120,
        notifications.failed,
        notifications.stuck,
        notifications.deadLetter,
      ),
      backlog: notifications.pending,
      capacityPerDay: 8_000,
      estimatedDrainMinutes: notificationDrain,
      note: `処理中 ${notifications.processing}件 / 固着 ${notifications.stuck}件 / 失敗 ${notifications.failed}件 / 最終失敗 ${notifications.deadLetter}件（Queue wake + 毎時Recovery）`,
      detailHref: "/admin/notifications",
    },
    {
      id: "static",
      label: "静的JSON再生成",
      level: pipelineLevel(
        staticRebuilds.pending,
        staticDrain,
        360,
        1440,
        staticRebuilds.failed,
        staticRebuilds.stuck,
        staticRebuilds.deadLetter,
      ),
      backlog: staticRebuilds.pending,
      capacityPerDay: 1_500,
      estimatedDrainMinutes: staticDrain,
      note: `処理中 ${staticRebuilds.processing}件 / 固着 ${staticRebuilds.stuck}件 / 失敗 ${staticRebuilds.failed}件 / 最終失敗 ${staticRebuilds.deadLetter}件（1 target/wake + 毎時Recovery）`,
      detailHref: "/admin/static-builds",
    },
    {
      id: "youtube",
      label: "YouTubeメタデータ同期",
      level: youtube.failed >= youtubeFailureCritical
        ? "critical"
        : youtube.failed > 0 || youtube.pending > 0 || youtubeDrain > 720
          ? "warn"
          : "ok",
      backlog: youtube.stale,
      capacityPerDay: 2_400,
      estimatedDrainMinutes: youtubeDrain,
      note: `対象 ${youtube.eligible}件 / pending ${youtube.pending}件 / 同期失敗 ${youtube.failed}件（Queue wake + 毎時7分Recovery）`,
      detailHref: "/admin/youtube-sync",
    },
    {
      id: "scores",
      label: "スコア差分更新",
      level: pipelineLevel(scores.stale, scoreDrain, 360, 1440),
      backlog: scores.stale,
      capacityPerDay: 3_600,
      estimatedDrainMinutes: scoreDrain,
      note: `公開作品 ${scores.eligible}件。変更動画限定 + 毎時Cron dirty。72h 超過も stale 扱い。`,
      detailHref: "/admin/static-builds",
    },
  ];

  const critical = jobs.some((job) => job.level === "critical") || pipelines.some((pipeline) => pipeline.level === "critical");
  const warning = jobs.some((job) => job.level === "warn" || job.level === "unknown") || pipelines.some((pipeline) => pipeline.level === "warn");

  return {
    generatedAt: now,
    operationMode: settings?.operation_mode ?? "normal",
    overallLevel: critical ? "critical" : warning ? "warn" : "ok",
    overallMessage: critical
      ? "停止・失敗・処理能力超過の可能性があります。該当項目を確認してください。"
      : warning
        ? "即時停止ではありませんが、遅延または未確認の項目があります。"
        : "内部記録上、バックグラウンド処理は想定範囲内です。",
    jobs,
    notifications,
    staticRebuilds,
    youtube,
    scores,
    artifacts: (artifactRows.results ?? []).map((row) => ({ targetType: row.target_type, generatedAt: nullableNumber(row.generated_at) })),
    pipelines,
    queueWakeFailures,
  };
}
