// Static backfill KV state normalization (moved unchanged from src/lib/staticRebuild/backfillStateCore.ts).
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

export type StaticBackfillRunPhase =
  | "shared_inputs"
  | "items";

export interface StaticBackfillRunState {
  cursor: string | null;
  phase: StaticBackfillRunPhase;
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
    phase: "items",
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

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCount(value: unknown): number {
  // Keep the historical null/empty -> 0 fallback, but do not coerce JSON
  // booleans, arrays or objects into apparently valid progress counts.
  if (value == null || value === "") return 0;
  const numberValue = parseFiniteNumber(value);
  return numberValue == null
    ? 0
    : Math.max(0, Math.floor(numberValue));
}

function normalizeNullableTimestamp(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numberValue = parseFiniteNumber(value);
  return numberValue == null ? null : Math.floor(numberValue);
}

function normalizeRun(value: unknown): StaticBackfillRunState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return emptyRun();
  }

  const row = value as Record<string, unknown>;
  const rawStatus = String(row.status ?? "");
  const phase: StaticBackfillRunPhase =
    row.phase === "shared_inputs"
      ? "shared_inputs"
      : "items";

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

  return {
    cursor,
    phase,
    status,
    total: normalizeCount(row.total),
    scanned: normalizeCount(row.scanned),
    enqueued: normalizeCount(row.enqueued),
    last_error: lastError,
    last_run_at: normalizeNullableTimestamp(row.last_run_at),
  };
}

export function parseStaticBackfillState(value: unknown): StaticBackfillState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return createEmptyStaticBackfillState();
  }

  const payload = value as {
    schema_version?: unknown;
    updated_at?: unknown;
    runs?: unknown;
  };

  if (
    payload.schema_version !== 1 ||
    !payload.runs ||
    typeof payload.runs !== "object" ||
    Array.isArray(payload.runs)
  ) {
    return createEmptyStaticBackfillState();
  }

  const runs = payload.runs as Record<string, unknown>;

  return {
    schema_version: 1,
    updated_at: normalizeNullableTimestamp(payload.updated_at),
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
