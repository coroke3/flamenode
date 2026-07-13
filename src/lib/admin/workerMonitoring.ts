import "server-only";

export type MonitorLevel = "ok" | "warn" | "critical" | "unknown" | "running";

export interface WorkerJobDefinition {
  jobName: string;
  label: string;
  cadenceSeconds: number;
  warnAfterSeconds: number;
  criticalAfterSeconds: number;
  detailHref: string;
}

export interface WorkerJobStatus extends WorkerJobDefinition {
  level: MonitorLevel;
  message: string;
  leaseActive: boolean;
  leaseExpiresAt: number | null;
  lastStartedAt: number | null;
  lastSucceededAt: number | null;
  lastFailedAt: number | null;
  lastErrorCode: string | null;
  nextExpectedAt: number | null;
}

export interface QueueSnapshot {
  pending: number;
  processing: number;
  failed: number;
  stuck: number;
  oldestPendingAt: number | null;
}

export interface YoutubeSnapshot {
  eligible: number;
  stale: number;
  failed: number;
  oldestSyncedAt: number | null;
}

export interface ScoreSnapshot {
  eligible: number;
  stale: number;
  oldestUpdatedAt: number | null;
}

export interface ArtifactSnapshot {
  targetType: string;
  generatedAt: number | null;
}

export interface PipelineSnapshot {
  id: "notifications" | "static" | "youtube" | "scores";
  label: string;
  level: MonitorLevel;
  backlog: number;
  capacityPerDay: number;
  estimatedDrainMinutes: number;
  note: string;
  detailHref: string;
}

export interface WorkerMonitoringSnapshot {
  generatedAt: number;
  operationMode: string;
  overallLevel: Exclude<MonitorLevel, "running">;
  overallMessage: string;
  jobs: WorkerJobStatus[];
  notifications: QueueSnapshot;
  staticRebuilds: QueueSnapshot;
  youtube: YoutubeSnapshot;
  scores: ScoreSnapshot;
  artifacts: ArtifactSnapshot[];
  pipelines: PipelineSnapshot[];
}

type LeaseRow = {
  job_name: string;
  lease_token: string | null;
  lease_expires_at: number | null;
  last_started_at: number | null;
  last_succeeded_at: number | null;
  last_failed_at: number | null;
  last_error_code: string | null;
};

type QueueRow = {
  pending?: number | string | null;
  processing?: number | string | null;
  failed?: number | string | null;
  stuck?: number | string | null;
  oldest_pending_at?: number | string | null;
};

type YoutubeRow = {
  eligible?: number | string | null;
  stale?: number | string | null;
  failed?: number | string | null;
  oldest_synced_at?: number | string | null;
};

type ScoreRow = {
  eligible?: number | string | null;
  stale?: number | string | null;
  oldest_updated_at?: number | string | null;
};

type ArtifactRow = {
  target_type: string;
  generated_at: number | string | null;
};

export const WORKER_JOB_DEFINITIONS: readonly WorkerJobDefinition[] = [
  {
    jobName: "fast-jobs",
    label: "通知・リマインダー",
    cadenceSeconds: 5 * 60,
    warnAfterSeconds: 12 * 60,
    criticalAfterSeconds: 25 * 60,
    detailHref: "/admin/notifications",
  },
  {
    jobName: "content-jobs",
    label: "静的JSON・クリーンアップ",
    cadenceSeconds: 15 * 60,
    warnAfterSeconds: 35 * 60,
    criticalAfterSeconds: 65 * 60,
    detailHref: "/admin/static-builds",
  },
  {
    jobName: "sync-jobs",
    label: "YouTube同期・スコア更新",
    cadenceSeconds: 15 * 60,
    warnAfterSeconds: 35 * 60,
    criticalAfterSeconds: 65 * 60,
    detailHref: "/admin/youtube-sync",
  },
  {
    jobName: "fast-jobs:slot-deadline-reminders",
    label: "締切リマインダー生成",
    cadenceSeconds: 60 * 60,
    warnAfterSeconds: 2 * 60 * 60,
    criticalAfterSeconds: 3 * 60 * 60,
    detailHref: "/admin/notifications",
  },
  {
    jobName: "content-jobs:cleanup",
    label: "期限切れデータ整理",
    cadenceSeconds: 60 * 60,
    warnAfterSeconds: 2 * 60 * 60,
    criticalAfterSeconds: 3 * 60 * 60,
    detailHref: "/admin/static-builds",
  },
] as const;

export const PLATFORM_LIMITS = [
  { label: "Workers CPU", value: "10ms / invocation" },
  { label: "Worker subrequests", value: "50 / invocation" },
  { label: "D1 queries", value: "50 / invocation" },
  { label: "D1 rows read", value: "5,000,000 / day" },
  { label: "D1 rows written", value: "100,000 / day" },
  { label: "D1 database size", value: "500MB / database" },
  { label: "YouTube Data API", value: "10,000 units / day" },
] as const;

function numberValue(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateWorkerJob(
  definition: WorkerJobDefinition,
  row: LeaseRow | undefined,
  now: number,
): WorkerJobStatus {
  const leaseActive = Boolean(
    row?.lease_token && numberValue(row.lease_expires_at) > now,
  );
  const lastSucceededAt = nullableNumber(row?.last_succeeded_at);
  const lastFailedAt = nullableNumber(row?.last_failed_at);
  const latestRunFailed =
    lastFailedAt != null &&
    (lastSucceededAt == null || lastFailedAt > lastSucceededAt);

  let level: MonitorLevel;
  let message: string;
  if (leaseActive) {
    level = "running";
    message = "実行中です。";
  } else if (latestRunFailed) {
    level = "critical";
    message = "直近の実行が失敗しています。";
  } else if (lastSucceededAt == null) {
    level = "unknown";
    message = "成功履歴がありません。初回Cronまたはデプロイ状態を確認してください。";
  } else {
    const age = Math.max(0, now - lastSucceededAt);
    if (age > definition.criticalAfterSeconds) {
      level = "critical";
      message = "想定間隔を大きく超えて成功していません。";
    } else if (age > definition.warnAfterSeconds) {
      level = "warn";
      message = "想定間隔を超えています。次回Cronを確認してください。";
    } else {
      level = "ok";
      message = "想定間隔内に成功しています。";
    }
  }

  return {
    ...definition,
    level,
    message,
    leaseActive,
    leaseExpiresAt: nullableNumber(row?.lease_expires_at),
    lastStartedAt: nullableNumber(row?.last_started_at),
    lastSucceededAt,
    lastFailedAt,
    lastErrorCode: row?.last_error_code ?? null,
    nextExpectedAt:
      lastSucceededAt == null
        ? null
        : lastSucceededAt + definition.cadenceSeconds,
  };
}

export function estimateDrainMinutes(
  backlog: number,
  batchSize: number,
  cadenceMinutes: number,
): number {
  if (backlog <= 0) return 0;
  return Math.ceil(backlog / Math.max(1, batchSize)) * cadenceMinutes;
}

function queueSnapshot(row: QueueRow | null): QueueSnapshot {
  return {
    pending: numberValue(row?.pending),
    processing: numberValue(row?.processing),
    failed: numberValue(row?.failed),
    stuck: numberValue(row?.stuck),
    oldestPendingAt: nullableNumber(row?.oldest_pending_at),
  };
}

function pipelineLevel(
  backlog: number,
  drainMinutes: number,
  warningMinutes: number,
  criticalMinutes: number,
  failed = 0,
  stuck = 0,
): MonitorLevel {
  if (failed > 0 || stuck > 0 || drainMinutes > criticalMinutes) {
    return "critical";
  }
  if (backlog > 0 && drainMinutes > warningMinutes) return "warn";
  return "ok";
}

function overallStatus(
  jobs: readonly WorkerJobStatus[],
  pipelines: readonly PipelineSnapshot[],
): Pick<WorkerMonitoringSnapshot, "overallLevel" | "overallMessage"> {
  if (
    jobs.some((job) => job.level === "critical") ||
    pipelines.some((pipeline) => pipeline.level === "critical")
  ) {
    return {
      overallLevel: "critical",
      overallMessage: "停止・失敗・処理能力超過の可能性があります。該当項目を確認してください。",
    };
  }
  if (
    jobs.some((job) => job.level === "warn" || job.level === "unknown") ||
    pipelines.some((pipeline) => pipeline.level === "warn")
  ) {
    return {
      overallLevel: "warn",
      overallMessage: "即時停止ではありませんが、遅延または未確認の項目があります。",
    };
  }
  return {
    overallLevel: "ok",
    overallMessage: "内部記録上、バックグラウンド処理は想定範囲内です。",
  };
}

export async function loadWorkerMonitoring(
  db: D1Database,
  now = Math.floor(Date.now() / 1000),
): Promise<WorkerMonitoringSnapshot> {
  const leaseResult = await db.prepare(
    `SELECT job_name, lease_token, lease_expires_at, last_started_at,
            last_succeeded_at, last_failed_at, last_error_code
       FROM worker_leases
      WHERE job_name IN (${WORKER_JOB_DEFINITIONS.map(() => "?").join(",")})`,
  )
    .bind(...WORKER_JOB_DEFINITIONS.map((definition) => definition.jobName))
    .all<LeaseRow>();

  const operationModeRow = await db.prepare(
    `SELECT operation_mode FROM system_settings WHERE id = 'default' LIMIT 1`,
  ).first<{ operation_mode?: string }>();

  const notificationRow = await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
       COALESCE(SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END), 0) AS processing,
       COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
       COALESCE(SUM(CASE WHEN status = 'processing'
         AND (processing_started_at IS NULL OR processing_started_at <= ?1)
         THEN 1 ELSE 0 END), 0) AS stuck,
       MIN(CASE WHEN status = 'pending' THEN created_at END) AS oldest_pending_at
     FROM notification_outbox
     WHERE status IN ('pending', 'processing', 'failed')`,
  ).bind(now - 15 * 60).first<QueueRow>();

  const staticRow = await db.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
       COALESCE(SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END), 0) AS processing,
       COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
       COALESCE(SUM(CASE WHEN status = 'processing'
         AND (lease_expires_at IS NULL OR lease_expires_at <= ?1)
         THEN 1 ELSE 0 END), 0) AS stuck,
       MIN(CASE WHEN status = 'pending' THEN created_at END) AS oldest_pending_at
     FROM static_rebuild_queue
     WHERE status IN ('pending', 'processing', 'failed')`,
  ).bind(now).first<QueueRow>();

  const youtubeRow = await db.prepare(
    `SELECT
       COUNT(*) AS eligible,
       COALESCE(SUM(CASE WHEN ym.synced_at IS NULL OR ym.synced_at <= ?1
         THEN 1 ELSE 0 END), 0) AS stale,
       COALESCE(SUM(CASE WHEN ym.sync_status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
       MIN(ym.synced_at) AS oldest_synced_at
     FROM videos v
     LEFT JOIN video_youtube_metadata ym ON ym.video_id = v.id
     WHERE v.youtube_video_id IS NOT NULL
       AND v.youtube_video_id <> ''
       AND v.visibility_status NOT IN ('archived', 'voided')`,
  ).bind(now - 26 * 60 * 60).first<YoutubeRow>();

  const scoreRow = await db.prepare(
    `SELECT
       COUNT(*) AS eligible,
       COALESCE(SUM(CASE WHEN
         v.score_updated_at IS NULL
         OR v.score_updated_at < v.updated_at
         OR v.score_updated_at < COALESCE(ym.updated_at, 0)
         OR v.score_updated_at <= ?1
         THEN 1 ELSE 0 END), 0) AS stale,
       MIN(v.score_updated_at) AS oldest_updated_at
     FROM videos v
     LEFT JOIN video_youtube_metadata ym ON ym.video_id = v.id
     WHERE v.visibility_status = 'public'`,
  ).bind(now - 24 * 60 * 60).first<ScoreRow>();

  const artifactRows = await db.prepare(
    `SELECT target_type, MAX(generated_at) AS generated_at
       FROM static_artifacts
      WHERE target_id = 'global'
        AND deleted_at IS NULL
        AND target_type IN ('top', 'list_recent', 'list_popular', 'events_index', 'search_index')
      GROUP BY target_type
      ORDER BY target_type ASC`,
  ).all<ArtifactRow>();

  const leases = new Map(
    (leaseResult.results ?? []).map((row) => [row.job_name, row]),
  );
  const jobs = WORKER_JOB_DEFINITIONS.map((definition) =>
    evaluateWorkerJob(definition, leases.get(definition.jobName), now),
  );
  const notifications = queueSnapshot(notificationRow);
  const staticRebuilds = queueSnapshot(staticRow);
  const youtube: YoutubeSnapshot = {
    eligible: numberValue(youtubeRow?.eligible),
    stale: numberValue(youtubeRow?.stale),
    failed: numberValue(youtubeRow?.failed),
    oldestSyncedAt: nullableNumber(youtubeRow?.oldest_synced_at),
  };
  const scores: ScoreSnapshot = {
    eligible: numberValue(scoreRow?.eligible),
    stale: numberValue(scoreRow?.stale),
    oldestUpdatedAt: nullableNumber(scoreRow?.oldest_updated_at),
  };

  const notificationDrain = estimateDrainMinutes(notifications.pending, 6, 5);
  const staticDrain = estimateDrainMinutes(staticRebuilds.pending, 1, 15);
  const youtubeDrain = estimateDrainMinutes(youtube.stale, 50, 15);
  const scoreDrain = estimateDrainMinutes(scores.stale, 160, 15);
  const youtubeCriticalFailures = Math.max(10, Math.ceil(youtube.eligible * 0.1));

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
      ),
      backlog: notifications.pending,
      capacityPerDay: 6 * 12 * 24,
      estimatedDrainMinutes: notificationDrain,
      note: `処理中 ${notifications.processing}件 / 固着 ${notifications.stuck}件 / 失敗 ${notifications.failed}件`,
      detailHref: "/admin/notifications",
    },
    {
      id: "static",
      label: "静的JSON再生成",
      level: pipelineLevel(
        staticRebuilds.pending,
        staticDrain,
        6 * 60,
        24 * 60,
        staticRebuilds.failed,
        staticRebuilds.stuck,
      ),
      backlog: staticRebuilds.pending,
      capacityPerDay: 96,
      estimatedDrainMinutes: staticDrain,
      note: `処理中 ${staticRebuilds.processing}件 / 固着 ${staticRebuilds.stuck}件 / 失敗 ${staticRebuilds.failed}件`,
      detailHref: "/admin/static-builds",
    },
    {
      id: "youtube",
      label: "YouTubeメタデータ同期",
      level:
        youtube.failed >= youtubeCriticalFailures
          ? "critical"
          : youtube.failed > 0 || youtubeDrain > 12 * 60
            ? "warn"
            : "ok",
      backlog: youtube.stale,
      capacityPerDay: 50 * 4 * 24,
      estimatedDrainMinutes: youtubeDrain,
      note: `対象 ${youtube.eligible}件 / 同期失敗 ${youtube.failed}件`,
      detailHref: "/admin/youtube-sync",
    },
    {
      id: "scores",
      label: "スコア差分更新",
      level: pipelineLevel(scores.stale, scoreDrain, 6 * 60, 24 * 60),
      backlog: scores.stale,
      capacityPerDay: 160 * 4 * 24,
      estimatedDrainMinutes: scoreDrain,
      note: `公開作品 ${scores.eligible}件。index書込みを含むD1枠へ余裕を確保した上限です。`,
      detailHref: "/admin/static-builds",
    },
  ];

  const overall = overallStatus(jobs, pipelines);
  return {
    generatedAt: now,
    operationMode: operationModeRow?.operation_mode ?? "normal",
    ...overall,
    jobs,
    notifications,
    staticRebuilds,
    youtube,
    scores,
    artifacts: (artifactRows.results ?? []).map((row) => ({
      targetType: row.target_type,
      generatedAt: nullableNumber(row.generated_at),
    })),
    pipelines,
  };
}
