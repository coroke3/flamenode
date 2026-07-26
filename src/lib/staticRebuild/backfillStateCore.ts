export const STATIC_BACKFILL_KINDS = [
  "video_v2",
  "user_profile",
  "event_crew",
] as const;

export type StaticBackfillKind = (typeof STATIC_BACKFILL_KINDS)[number];

export type StaticBackfillRunStatus =
  | "idle"
  | "running"
  | "completed"
  | "failed";

export interface StaticBackfillRunState {
  cursor: string | null;
  status: StaticBackfillRunStatus;
  total: number;
  scanned: number;
  enqueued: number;
  last_error: string | null;
  last_run_at: number | null;
}

export interface StaticBackfillState {
  schema_version: 1;
  updated_at: number | null;
  runs: Record<StaticBackfillKind, StaticBackfillRunState>;
}

export const STATIC_BACKFILL_KV_KEY = "static-backfill:state:v1";

function emptyRun(): StaticBackfillRunState {
  return {
    cursor: null,
    status: "idle",
    total: 0,
    scanned: 0,
    enqueued: 0,
    last_error: null,
    last_run_at: null,
  };
}

export function createEmptyStaticBackfillState(): StaticBackfillState {
  return {
    schema_version: 1,
    updated_at: null,
    runs: {
      video_v2: emptyRun(),
      user_profile: emptyRun(),
      event_crew: emptyRun(),
    },
  };
}

function normalizeCount(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue)
    ? Math.max(0, Math.floor(numberValue))
    : 0;
}

function normalizeRun(value: unknown): StaticBackfillRunState {
  if (!value || typeof value !== "object") {
    return emptyRun();
  }

  const row = value as Record<string, unknown>;
  const rawStatus = String(row.status ?? "");

  const status: StaticBackfillRunStatus =
    rawStatus === "running" ||
    rawStatus === "completed" ||
    rawStatus === "failed"
      ? rawStatus
      : "idle";

  const cursor =
    typeof row.cursor === "string" && row.cursor.trim()
      ? row.cursor.trim()
      : null;

  const lastError =
    typeof row.last_error === "string" && row.last_error.trim()
      ? row.last_error.trim().slice(0, 1000)
      : null;

  const lastRunAt = Number(row.last_run_at);

  return {
    cursor,
    status,
    total: normalizeCount(row.total),
    scanned: normalizeCount(row.scanned),
    enqueued: normalizeCount(row.enqueued),
    last_error: lastError,
    last_run_at: Number.isFinite(lastRunAt) ? Math.floor(lastRunAt) : null,
  };
}

export function parseStaticBackfillState(value: unknown): StaticBackfillState {
  if (!value || typeof value !== "object") {
    return createEmptyStaticBackfillState();
  }

  const payload = value as {
    schema_version?: unknown;
    updated_at?: unknown;
    runs?: unknown;
  };

  if (
    Number(payload.schema_version) !== 1 ||
    !payload.runs ||
    typeof payload.runs !== "object"
  ) {
    return createEmptyStaticBackfillState();
  }

  const runs = payload.runs as Record<string, unknown>;
  const updatedAt = Number(payload.updated_at);

  return {
    schema_version: 1,
    updated_at: Number.isFinite(updatedAt) ? Math.floor(updatedAt) : null,
    runs: {
      video_v2: normalizeRun(runs.video_v2),
      user_profile: normalizeRun(runs.user_profile),
      event_crew: normalizeRun(runs.event_crew),
    },
  };
}

export function withStaticBackfillRun(
  state: StaticBackfillState,
  kind: StaticBackfillKind,
  run: StaticBackfillRunState,
  updatedAt: number,
): StaticBackfillState {
  return {
    schema_version: 1,
    updated_at: updatedAt,
    runs: {
      ...state.runs,
      [kind]: run,
    },
  };
}
